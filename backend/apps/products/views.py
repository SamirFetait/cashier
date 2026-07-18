from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import IsSuperAdminOrReadOnly

from .models import Category, Product
from .serializers import CategorySerializer, ProductSerializer


class CategoryViewSet(viewsets.ModelViewSet):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    permission_classes = [IsSuperAdminOrReadOnly]
    search_fields = ["name"]


class ProductViewSet(viewsets.ModelViewSet):
    queryset = Product.objects.select_related("category").all()
    serializer_class = ProductSerializer
    permission_classes = [IsSuperAdminOrReadOnly]
    search_fields = ["name", "barcode"]
    filterset_fields = ["category", "is_active"]
    ordering_fields = ["name", "price", "created_at"]

    @action(detail=False, methods=["get"])
    def lookup(self, request):
        """Resolve a scanned barcode to a product.

        A dedicated endpoint rather than a search, because the POS needs one
        exact hit per scan and must stay fast on a large catalogue.
        """
        barcode = (request.query_params.get("barcode") or "").strip()
        if not barcode:
            return Response({"detail": "barcode is required."}, status=400)
        product = Product.objects.select_related("category").filter(
            barcode=barcode, is_active=True
        ).first()
        if not product:
            return Response({"detail": f"No active product with barcode {barcode}."}, status=404)
        return Response(ProductSerializer(product).data)
