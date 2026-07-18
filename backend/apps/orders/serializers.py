from decimal import Decimal

from django.conf import settings
from django.db import transaction
from rest_framework import serializers

from apps.accounts.overrides import discount_needs_override, resolve_override
from apps.common.fields import QUANTITY_DECIMAL_PLACES, QUANTITY_MAX_DIGITS
from apps.common.models import Sequence, record_audit
from apps.customers.models import Customer
from apps.inventory.models import StockItem, Storage, apply_stock_change
from apps.products.models import Product

from .models import OrderItem, Payment, Return, ReturnItem

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


class PaymentInputSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=[c[0] for c in Payment.Method.choices])
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    tendered = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, default=ZERO, min_value=ZERO
    )
    reference = serializers.CharField(max_length=120, required=False, allow_blank=True)

    def validate(self, attrs):
        if attrs["method"] == Payment.Method.CASH:
            tendered = attrs.get("tendered") or ZERO
            # Cash must cover the amount it settles, otherwise change is a fiction.
            if tendered and tendered < attrs["amount"]:
                raise serializers.ValidationError(
                    {"tendered": "Cash tendered is less than the amount being paid."}
                )
        return attrs


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ["id", "method", "amount", "tendered", "change", "reference", "created_at"]
        read_only_fields = fields


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
    payments = PaymentSerializer(many=True, read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    created_by_username = serializers.CharField(
        source="created_by.username", read_only=True
    )
    shift_number = serializers.CharField(source="shift.number", read_only=True)
    amount_paid = serializers.DecimalField(
        max_digits=12, decimal_places=2, read_only=True
    )
    change_given = serializers.DecimalField(
        max_digits=12, decimal_places=2, read_only=True
    )

    class Meta:
        from .models import Order

        model = Order
        fields = [
            "id", "receipt_number", "customer", "customer_name", "storage",
            "created_by", "created_by_username", "shift", "shift_number",
            "status", "payment_method", "subtotal", "discount", "tax", "total",
            "amount_paid", "change_given", "note", "items", "payments", "created_at",
        ]
        read_only_fields = fields


class ReturnItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)

    class Meta:
        model = ReturnItem
        fields = [
            "id", "order_item", "product", "product_name",
            "quantity", "unit_refund", "line_refund",
        ]
        read_only_fields = fields


class ReturnSerializer(serializers.ModelSerializer):
    items = ReturnItemSerializer(many=True, read_only=True)
    order_receipt = serializers.CharField(source="order.receipt_number", read_only=True)
    created_by_username = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = Return
        fields = [
            "id", "number", "order", "order_receipt", "created_by",
            "created_by_username", "shift", "refund_method", "total",
            "reason", "restocked", "items", "created_at",
        ]
        read_only_fields = fields


class ReturnLineInputSerializer(serializers.Serializer):
    order_item = serializers.PrimaryKeyRelatedField(queryset=OrderItem.objects.all())
    quantity = serializers.DecimalField(
        max_digits=QUANTITY_MAX_DIGITS,
        decimal_places=QUANTITY_DECIMAL_PLACES,
        min_value=Decimal("0.001"),
    )


class ReturnCreateSerializer(serializers.Serializer):
    lines = ReturnLineInputSerializer(many=True)
    refund_method = serializers.ChoiceField(choices=[c[0] for c in Payment.Method.choices])
    reason = serializers.CharField(max_length=255)
    restock = serializers.BooleanField(default=True)

    def validate_lines(self, value):
        if not value:
            raise serializers.ValidationError("A return must include at least one line.")
        return value


class VoidSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=255)


class OrderCreateSerializer(serializers.Serializer):
    customer = serializers.PrimaryKeyRelatedField(
        queryset=Customer.objects.all(), required=False, allow_null=True
    )
    storage = serializers.PrimaryKeyRelatedField(
        queryset=Storage.objects.all(), required=False, allow_null=True
    )
    payment_method = serializers.ChoiceField(
        choices=[c[0] for c in Payment.Method.choices], default="CASH"
    )
    discount = serializers.DecimalField(
        max_digits=12, decimal_places=2, default=ZERO, min_value=ZERO
    )
    tax = serializers.DecimalField(
        max_digits=12, decimal_places=2, default=ZERO, min_value=ZERO
    )
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)
    terminal = serializers.CharField(max_length=64, required=False, allow_blank=True)
    override_pin = serializers.CharField(required=False, allow_blank=True, write_only=True)
    client_uuid = serializers.UUIDField(required=False, allow_null=True)
    was_offline = serializers.BooleanField(default=False)
    items = OrderItemInputSerializer(many=True)
    payments = PaymentInputSerializer(many=True, required=False)

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

        # A large discount needs a supervisor at the till.
        gross = sum(
            ((line["product"].price * line["quantity"]).quantize(MONEY) for line in attrs["items"]),
            ZERO,
        )
        total_discount = attrs.get("discount", ZERO) + sum(
            (line.get("discount", ZERO) for line in attrs["items"]), ZERO
        )
        if total_discount > ZERO and discount_needs_override(total_discount, gross):
            request = self.context.get("request")
            attrs["_authorised_by"] = resolve_override(
                request, action="discount", detail=f"discount {total_discount} on {gross}"
            )

        total = subtotal - attrs.get("discount", ZERO) + attrs.get("tax", ZERO)
        payments = attrs.get("payments") or []
        if payments:
            paid = sum((p["amount"] for p in payments), ZERO)
            if paid != total:
                raise serializers.ValidationError(
                    {"payments": f"Payments total {paid} but the order total is {total}."}
                )
        attrs["_computed_total"] = total
        return attrs

    def _primary_method(self, payments, validated):
        """Denormalised 'headline' method, kept for reporting and back-compat.

        With split tenders the Payment rows are authoritative; this is just the
        largest one so existing payment-breakdown reports stay meaningful.
        """
        if not payments:
            return validated.get("payment_method", "CASH")
        return max(payments, key=lambda p: p["amount"])["method"]

    def _resolve_shift(self, validated, payments):
        """Bind the sale to the open till session.

        Cash must land in a drawer that someone is accountable for, so a cash
        sale without an open shift is refused rather than silently unattributed.
        """
        from apps.shifts.services import active_shift

        shift = active_shift(terminal=validated.get("terminal", ""))
        if shift:
            return shift
        takes_cash = any(p["method"] == Payment.Method.CASH for p in payments)
        if takes_cash or getattr(settings, "REQUIRE_OPEN_SHIFT", False):
            raise serializers.ValidationError(
                "No shift is open on this terminal. Open a shift before taking payment."
            )
        return None

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
        payments = validated_data.get("payments") or []
        shift = self._resolve_shift(validated_data, payments)

        order = Order.objects.create(
            receipt_number=Sequence.next_value("receipt", prefix="R"),
            client_uuid=validated_data.get("client_uuid"),
            was_offline=validated_data.get("was_offline", False),
            customer=validated_data.get("customer"),
            storage=storage,
            created_by=user,
            shift=shift,
            payment_method=self._primary_method(payments, validated_data),
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

        self._record_payments(order, payments, shift, user)

        total_discount = discount + sum(
            (line.get("discount") or ZERO) for line in validated_data["items"]
        )
        if total_discount > ZERO:
            record_audit(
                action="DISCOUNT",
                actor=user,
                authorised_by=validated_data.get("_authorised_by"),
                obj=order,
                summary=f"Discount {total_discount} on {order.receipt_number}",
                detail={"order_discount": str(discount), "total_discount": str(total_discount)},
            )
        return order

    def _record_payments(self, order, payments, shift, user):
        """Write the tender rows and push cash into the drawer.

        Only the `amount` settles the order; `tendered - change` nets to the
        same figure, so the drawer balances regardless of how much the customer
        handed over.
        """
        from apps.shifts.models import CashMovement

        for entry in payments:
            method = entry["method"]
            amount = entry["amount"]
            tendered = entry.get("tendered") or ZERO
            change = ZERO
            if method == Payment.Method.CASH:
                # A blank `tendered` means exact money.
                tendered = tendered or amount
                change = tendered - amount
            Payment.objects.create(
                order=order,
                method=method,
                amount=amount,
                tendered=tendered if method == Payment.Method.CASH else ZERO,
                change=change,
                reference=entry.get("reference", ""),
            )
            if method == Payment.Method.CASH and shift is not None:
                CashMovement.objects.create(
                    shift=shift,
                    kind=CashMovement.Kind.SALE,
                    amount=amount,
                    order=order,
                    reason=f"Sale {order.receipt_number}",
                    created_by=user,
                )

    def to_representation(self, instance):
        return OrderSerializer(instance, context=self.context).data
