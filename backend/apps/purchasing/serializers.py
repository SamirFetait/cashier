from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from apps.common.fields import QUANTITY_DECIMAL_PLACES, QUANTITY_MAX_DIGITS
from apps.common.models import Sequence
from apps.inventory.models import Storage
from apps.products.models import Product
from apps.suppliers.models import Supplier

from .models import (
    GoodsReceipt,
    GoodsReceiptItem,
    PurchaseOrder,
    PurchaseOrderItem,
    StockTake,
    StockTakeLine,
)

ZERO = Decimal("0")


def quantity_field(**kwargs):
    kwargs.setdefault("max_digits", QUANTITY_MAX_DIGITS)
    kwargs.setdefault("decimal_places", QUANTITY_DECIMAL_PLACES)
    return serializers.DecimalField(**kwargs)


class PurchaseOrderItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    outstanding = quantity_field(read_only=True)
    line_cost = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = PurchaseOrderItem
        fields = [
            "id", "product", "product_name", "quantity_ordered",
            "quantity_received", "outstanding", "unit_cost", "line_cost",
        ]
        read_only_fields = ["quantity_received"]


class PurchaseOrderSerializer(serializers.ModelSerializer):
    items = PurchaseOrderItemSerializer(many=True, read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    created_by_username = serializers.CharField(
        source="created_by.username", read_only=True
    )

    class Meta:
        model = PurchaseOrder
        fields = [
            "id", "number", "supplier", "supplier_name", "storage", "status",
            "expected_at", "total_cost", "note", "created_by",
            "created_by_username", "items", "created_at", "updated_at",
        ]
        read_only_fields = ["number", "status", "total_cost", "created_at", "updated_at"]


class PurchaseOrderItemInputSerializer(serializers.Serializer):
    product = serializers.PrimaryKeyRelatedField(queryset=Product.objects.all())
    quantity_ordered = quantity_field(min_value=Decimal("0.001"))
    unit_cost = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=ZERO
    )


class PurchaseOrderCreateSerializer(serializers.Serializer):
    supplier = serializers.PrimaryKeyRelatedField(queryset=Supplier.objects.all())
    storage = serializers.PrimaryKeyRelatedField(queryset=Storage.objects.all())
    expected_at = serializers.DateField(required=False, allow_null=True)
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)
    items = PurchaseOrderItemInputSerializer(many=True)

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError("A purchase order needs at least one line.")
        seen = set()
        for line in value:
            pid = line["product"].pk
            if pid in seen:
                raise serializers.ValidationError(
                    f"'{line['product'].name}' appears more than once."
                )
            seen.add(pid)
            qty = line["quantity_ordered"]
            if not line["product"].is_weighed and qty != qty.to_integral_value():
                raise serializers.ValidationError(
                    f"'{line['product'].name}' is sold per unit — order a whole number."
                )
        return value

    @transaction.atomic
    def create(self, validated_data):
        request = self.context.get("request")
        po = PurchaseOrder.objects.create(
            number=Sequence.next_value("po", prefix="PO", padding=5),
            supplier=validated_data["supplier"],
            storage=validated_data["storage"],
            expected_at=validated_data.get("expected_at"),
            note=validated_data.get("note", ""),
            created_by=getattr(request, "user", None),
        )
        total = ZERO
        for line in validated_data["items"]:
            item = PurchaseOrderItem.objects.create(
                purchase_order=po,
                product=line["product"],
                quantity_ordered=line["quantity_ordered"],
                unit_cost=line["unit_cost"],
            )
            total += item.line_cost
        po.total_cost = total
        po.save(update_fields=["total_cost"])
        return po

    def to_representation(self, instance):
        return PurchaseOrderSerializer(instance, context=self.context).data


class GoodsReceiptItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)

    class Meta:
        model = GoodsReceiptItem
        fields = [
            "id", "purchase_order_item", "product", "product_name",
            "quantity", "unit_cost",
        ]
        read_only_fields = fields


class GoodsReceiptSerializer(serializers.ModelSerializer):
    items = GoodsReceiptItemSerializer(many=True, read_only=True)
    po_number = serializers.CharField(source="purchase_order.number", read_only=True)

    class Meta:
        model = GoodsReceipt
        fields = [
            "id", "number", "purchase_order", "po_number", "received_by",
            "supplier_reference", "note", "items", "created_at",
        ]
        read_only_fields = fields


class ReceiveLineInputSerializer(serializers.Serializer):
    purchase_order_item = serializers.PrimaryKeyRelatedField(
        queryset=PurchaseOrderItem.objects.all()
    )
    quantity = quantity_field(min_value=Decimal("0.001"))
    unit_cost = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True, min_value=ZERO
    )


class ReceiveGoodsSerializer(serializers.Serializer):
    lines = ReceiveLineInputSerializer(many=True)
    supplier_reference = serializers.CharField(
        max_length=120, required=False, allow_blank=True
    )
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)


class StockTakeLineSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    product_unit = serializers.CharField(source="product.unit", read_only=True)
    variance = quantity_field(read_only=True)

    class Meta:
        model = StockTakeLine
        fields = [
            "id", "product", "product_name", "product_unit",
            "expected_quantity", "counted_quantity", "variance",
        ]
        read_only_fields = ["expected_quantity", "variance"]


class StockTakeSerializer(serializers.ModelSerializer):
    lines = StockTakeLineSerializer(many=True, read_only=True)
    storage_name = serializers.CharField(source="storage.name", read_only=True)

    class Meta:
        model = StockTake
        fields = [
            "id", "number", "storage", "storage_name", "status", "created_by",
            "applied_by", "applied_at", "note", "lines", "created_at",
        ]
        read_only_fields = fields


class StartStockTakeSerializer(serializers.Serializer):
    storage = serializers.PrimaryKeyRelatedField(queryset=Storage.objects.all())
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)


class CountLineInputSerializer(serializers.Serializer):
    line = serializers.PrimaryKeyRelatedField(queryset=StockTakeLine.objects.all())
    counted_quantity = quantity_field(min_value=ZERO)


class SubmitCountSerializer(serializers.Serializer):
    counts = CountLineInputSerializer(many=True)
