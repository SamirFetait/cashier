from rest_framework import viewsets

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
