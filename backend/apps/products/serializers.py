from django.urls import reverse
from rest_framework import serializers

from .models import Category, Product, ProductImage

_NOT_ANNOTATED = object()


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name"]


class ProductSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True)
    quantity_in_storage = serializers.DecimalField(
        max_digits=12, decimal_places=3, read_only=True
    )
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            "id", "name", "category", "category_name", "barcode",
            "price", "cost", "unit", "sold_by", "is_active",
            "quantity_in_storage", "image_url", "created_at",
        ]
        read_only_fields = ["created_at"]

    def get_image_url(self, obj) -> str | None:
        """Versioned photo URL, or None. A new photo gets a new URL, so the
        old one can be cached by browsers indefinitely."""
        version = getattr(obj, "image_version", _NOT_ANNOTATED)
        if version is _NOT_ANNOTATED:
            version = (
                ProductImage.objects.filter(product_id=obj.pk)
                .values_list("checksum", flat=True)
                .first()
            )
        if not version:
            return None
        url = f"{reverse('product-image', args=[obj.pk])}?v={version[:16]}"
        request = self.context.get("request")
        # Absolute, because the desktop app is served from a different origin.
        return request.build_absolute_uri(url) if request else url
