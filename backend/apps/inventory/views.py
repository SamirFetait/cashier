from rest_framework import viewsets

from apps.accounts.permissions import IsSuperAdmin, IsSuperAdminOrReadOnly

from .models import StockItem, StockMovement, Storage
from .serializers import (
    StockItemSerializer,
    StockMovementSerializer,
    StorageSerializer,
)


class StorageViewSet(viewsets.ModelViewSet):
    queryset = Storage.objects.all()
    serializer_class = StorageSerializer
    permission_classes = [IsSuperAdminOrReadOnly]
    search_fields = ["name"]


class StockItemViewSet(viewsets.ModelViewSet):
    queryset = StockItem.objects.select_related("product", "storage").all()
    serializer_class = StockItemSerializer
    permission_classes = [IsSuperAdminOrReadOnly]
    filterset_fields = ["product", "storage"]
    search_fields = ["product__name"]


class StockMovementViewSet(viewsets.ModelViewSet):
    queryset = StockMovement.objects.select_related(
        "product", "storage", "created_by"
    ).all()
    serializer_class = StockMovementSerializer
    permission_classes = [IsSuperAdmin]
    filterset_fields = ["product", "storage", "reason"]
    http_method_names = ["get", "post", "head", "options"]  # ledger is append-only
