from django.db import transaction
from rest_framework import serializers

from .models import StockItem, StockMovement, Storage, apply_stock_change


class StorageSerializer(serializers.ModelSerializer):
    class Meta:
        model = Storage
        fields = ["id", "name", "address", "is_default"]


class StockItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    storage_name = serializers.CharField(source="storage.name", read_only=True)
    is_low = serializers.BooleanField(read_only=True)

    class Meta:
        model = StockItem
        fields = [
            "id", "product", "product_name", "storage", "storage_name",
            "quantity", "reorder_level", "is_low",
        ]


class StockMovementSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    created_by_username = serializers.CharField(
        source="created_by.username", read_only=True
    )

    class Meta:
        model = StockMovement
        fields = [
            "id", "product", "product_name", "storage", "change", "reason",
            "reference", "created_by", "created_by_username", "created_at",
        ]
        read_only_fields = ["created_by", "created_at"]

    def create(self, validated_data):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        with transaction.atomic():
            apply_stock_change(
                product=validated_data["product"],
                storage=validated_data["storage"],
                change=validated_data["change"],
                reason=validated_data["reason"],
                reference=validated_data.get("reference", ""),
                user=user,
            )
        # Return the most recent movement we just created.
        return StockMovement.objects.filter(
            product=validated_data["product"],
            storage=validated_data["storage"],
        ).latest("created_at")
