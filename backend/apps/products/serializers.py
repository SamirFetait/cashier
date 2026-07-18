from rest_framework import serializers

from .models import Category, Product


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name"]


class ProductSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)
    quantity_in_storage = serializers.DecimalField(
        max_digits=12, decimal_places=3, read_only=True
    )

    class Meta:
        model = Product
        fields = [
            "id", "name", "category", "category_name", "barcode",
            "price", "cost", "unit", "sold_by", "is_active",
            "quantity_in_storage", "created_at",
        ]
        read_only_fields = ["created_at"]
