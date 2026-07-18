from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from .models import Order
from .serializers import OrderCreateSerializer, OrderSerializer


class OrderViewSet(viewsets.ModelViewSet):
    """Create (checkout) and read orders. Orders are immutable once placed."""

    queryset = Order.objects.select_related("customer", "created_by", "storage").prefetch_related("items__product")
    permission_classes = [IsAuthenticated]
    filterset_fields = ["customer", "status", "payment_method", "created_by"]
    ordering_fields = ["created_at", "total"]
    http_method_names = ["get", "post", "head", "options"]

    def get_serializer_class(self):
        if self.action == "create":
            return OrderCreateSerializer
        return OrderSerializer
