from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from apps.customers.models import Customer
from apps.inventory.models import StockItem, Storage, apply_stock_change
from apps.products.models import Product


class OrderItemInputSerializer(serializers.Serializer):
    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all())
    quantity = serializers.IntegerField(min_value=1)


class OrderItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)

    class Meta:
        from .models import OrderItem

        model = OrderItem
        fields = ["id", "product", "product_name", "quantity", "unit_price", "line_total"]


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    created_by_username = serializers.CharField(
        source="created_by.username", read_only=True
    )

    class Meta:
        from .models import Order

        model = Order
        fields = [
            "id", "customer", "customer_name", "storage", "created_by",
            "created_by_username", "status", "payment_method", "subtotal",
            "discount", "tax", "total", "items", "created_at",
        ]
        read_only_fields = fields


class OrderCreateSerializer(serializers.Serializer):
    customer = serializers.PrimaryKeyRelatedField(
        queryset=Customer.objects.all(), required=False, allow_null=True
    )
    storage = serializers.PrimaryKeyRelatedField(
        queryset=Storage.objects.all(), required=False, allow_null=True
    )
    payment_method = serializers.ChoiceField(
        choices=["CASH", "CARD", "OTHER"], default="CASH"
    )
    discount = serializers.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0")
    )
    tax = serializers.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0")
    )
    items = OrderItemInputSerializer(many=True)

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError("An order must contain at least one item.")
        return value

    def _resolve_storage(self, validated):
        storage = validated.get("storage")
        if storage:
            return storage
        storage = Storage.objects.filter(is_default=True).first() or Storage.objects.first()
        if not storage:
            raise serializers.ValidationError(
                "No storage location exists. Create one before taking orders."
            )
        return storage

    @transaction.atomic
    def create(self, validated_data):
        from .models import Order, OrderItem

        request = self.context.get("request")
        user = getattr(request, "user", None)
        storage = self._resolve_storage(validated_data)
        discount = validated_data.get("discount") or Decimal("0")
        tax = validated_data.get("tax") or Decimal("0")

        order = Order.objects.create(
            customer=validated_data.get("customer"),
            storage=storage,
            created_by=user,
            payment_method=validated_data.get("payment_method", "CASH"),
            discount=discount,
            tax=tax,
        )

        subtotal = Decimal("0")
        for line in validated_data["items"]:
            product = line["product"]
            qty = line["quantity"]

            stock = (
                StockItem.objects.select_for_update()
                .filter(product=product, storage=storage)
                .first()
            )
            available = stock.quantity if stock else 0
            if available < qty:
                raise serializers.ValidationError(
                    f"Not enough stock for '{product.name}' in {storage.name}: "
                    f"need {qty}, have {available}."
                )

            unit_price = product.price
            line_total = unit_price * qty
            subtotal += line_total

            OrderItem.objects.create(
                order=order,
                product=product,
                quantity=qty,
                unit_price=unit_price,
                line_total=line_total,
            )
            apply_stock_change(
                product=product,
                storage=storage,
                change=-qty,
                reason="SALE",
                reference=f"order:{order.pk}",
                user=user,
            )

        order.subtotal = subtotal
        order.total = subtotal - discount + tax
        order.save(update_fields=["subtotal", "total"])
        return order

    def to_representation(self, instance):
        return OrderSerializer(instance, context=self.context).data
