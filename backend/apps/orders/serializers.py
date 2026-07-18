from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from apps.common.fields import QUANTITY_DECIMAL_PLACES, QUANTITY_MAX_DIGITS
from apps.common.models import Sequence, record_audit
from apps.customers.models import Customer
from apps.inventory.models import StockItem, Storage, apply_stock_change
from apps.products.models import Product

ZERO = Decimal("0")
MONEY = Decimal("0.01")


class OrderItemInputSerializer(serializers.Serializer):
    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all())
    quantity = serializers.DecimalField(
        max_digits=QUANTITY_MAX_DIGITS,
        decimal_places=QUANTITY_DECIMAL_PLACES,
        min_value=Decimal("0.001"),
    )
    discount = serializers.DecimalField(
        max_digits=12, decimal_places=2, default=ZERO, min_value=ZERO
    )

    def validate(self, attrs):
        product = attrs["product"]
        qty = attrs["quantity"]
        # Whole-unit goods must not be sold in fractions — a scanned tin of beans
        # cannot be 0.4 of a tin.
        if not product.is_weighed and qty != qty.to_integral_value():
            raise serializers.ValidationError(
                {"quantity": f"'{product.name}' is sold per unit — quantity must be a whole number."}
            )
        line_gross = (product.price * qty).quantize(MONEY)
        if attrs.get("discount", ZERO) > line_gross:
            raise serializers.ValidationError(
                {"discount": f"Discount for '{product.name}' exceeds the line total ({line_gross})."}
            )
        return attrs


class OrderItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_unit = serializers.CharField(source="product.unit", read_only=True)
    sold_by = serializers.CharField(source="product.sold_by", read_only=True)

    class Meta:
        from .models import OrderItem

        model = OrderItem
        fields = [
            "id", "product", "product_name", "product_unit", "sold_by",
            "quantity", "unit_price", "discount", "line_total",
        ]


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
            "id", "receipt_number", "customer", "customer_name", "storage",
            "created_by", "created_by_username", "status", "payment_method",
            "subtotal", "discount", "tax", "total", "note", "items", "created_at",
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
        max_digits=12, decimal_places=2, default=ZERO, min_value=ZERO
    )
    tax = serializers.DecimalField(
        max_digits=12, decimal_places=2, default=ZERO, min_value=ZERO
    )
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)
    items = OrderItemInputSerializer(many=True)

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError("An order must contain at least one item.")
        return value

    def validate(self, attrs):
        # Guard the whole-order arithmetic: without this an over-large discount
        # writes a negative total and silently corrupts sales figures.
        subtotal = ZERO
        for line in attrs["items"]:
            gross = (line["product"].price * line["quantity"]).quantize(MONEY)
            subtotal += gross - line.get("discount", ZERO)
        if attrs.get("discount", ZERO) > subtotal:
            raise serializers.ValidationError(
                {"discount": f"Order discount exceeds the net subtotal ({subtotal})."}
            )
        return attrs

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
        discount = validated_data.get("discount") or ZERO
        tax = validated_data.get("tax") or ZERO

        order = Order.objects.create(
            receipt_number=Sequence.next_value("receipt", prefix="R"),
            customer=validated_data.get("customer"),
            storage=storage,
            created_by=user,
            payment_method=validated_data.get("payment_method", "CASH"),
            discount=discount,
            tax=tax,
            note=validated_data.get("note", ""),
        )

        subtotal = ZERO
        for line in validated_data["items"]:
            product = line["product"]
            qty = line["quantity"]
            line_discount = line.get("discount") or ZERO

            stock = (
                StockItem.objects.select_for_update()
                .filter(product=product, storage=storage)
                .first()
            )
            available = stock.quantity if stock else ZERO
            if available < qty:
                raise serializers.ValidationError(
                    f"Not enough stock for '{product.name}' in {storage.name}: "
                    f"need {qty}, have {available}."
                )

            unit_price = product.price
            line_total = (unit_price * qty).quantize(MONEY) - line_discount
            subtotal += line_total

            OrderItem.objects.create(
                order=order,
                product=product,
                quantity=qty,
                unit_price=unit_price,
                unit_cost=product.cost,
                discount=line_discount,
                line_total=line_total,
            )
            apply_stock_change(
                product=product,
                storage=storage,
                change=-qty,
                reason="SALE",
                reference=order.receipt_number or f"order:{order.pk}",
                user=user,
            )

        order.subtotal = subtotal
        order.total = subtotal - discount + tax
        order.save(update_fields=["subtotal", "total"])

        total_discount = discount + sum(
            (line.get("discount") or ZERO) for line in validated_data["items"]
        )
        if total_discount > ZERO:
            record_audit(
                action="DISCOUNT",
                actor=user,
                obj=order,
                summary=f"Discount {total_discount} on {order.receipt_number}",
                detail={"order_discount": str(discount), "total_discount": str(total_discount)},
            )
        return order

    def to_representation(self, instance):
        return OrderSerializer(instance, context=self.context).data
