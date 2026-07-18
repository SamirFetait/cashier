from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.overrides import resolve_override
from apps.shifts.services import active_shift

from . import services
from .models import Order, Return
from .serializers import (
    OrderCreateSerializer,
    OrderSerializer,
    ReturnCreateSerializer,
    ReturnSerializer,
    VoidSerializer,
)


class OrderViewSet(viewsets.ModelViewSet):
    """Create (checkout) and read orders.

    A completed sale is never edited. Corrections happen through `void` (same
    session, whole sale) or `return` (afterwards, whole or partial), each of
    which writes its own reversing entries.
    """

    queryset = Order.objects.select_related(
        "customer", "created_by", "storage", "shift"
    ).prefetch_related("items__product", "payments", "returns")
    permission_classes = [IsAuthenticated]
    filterset_fields = ["customer", "status", "payment_method", "created_by", "shift"]
    search_fields = ["receipt_number", "customer__name"]
    ordering_fields = ["created_at", "total"]
    http_method_names = ["get", "post", "head", "options"]

    def get_serializer_class(self):
        if self.action == "create":
            return OrderCreateSerializer
        return OrderSerializer

    @action(detail=True, methods=["post"])
    def void(self, request, pk=None):
        serializer = VoidSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        order = self.get_object()
        authorised_by = resolve_override(
            request, action="void", detail=order.receipt_number or str(order.pk)
        )
        order = services.void_order(
            order=order,
            user=request.user,
            reason=serializer.validated_data["reason"],
            authorised_by=authorised_by,
        )
        return Response(OrderSerializer(order, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="return")
    def create_return(self, request, pk=None):
        serializer = ReturnCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        order = self.get_object()
        authorised_by = resolve_override(
            request, action="refund", detail=order.receipt_number or str(order.pk)
        )
        ret = services.create_return(
            order=order,
            user=request.user,
            lines=data["lines"],
            refund_method=data["refund_method"],
            reason=data["reason"],
            restock=data["restock"],
            shift=active_shift(terminal=request.data.get("terminal", "")),
            authorised_by=authorised_by,
        )
        return Response(ReturnSerializer(ret).data, status=201)

    @action(detail=True, methods=["get"], url_path="returnable")
    def returnable(self, request, pk=None):
        """What is still refundable on this sale, per line."""
        order = self.get_object()
        return Response({
            "order": order.receipt_number,
            "status": order.status,
            "lines": [
                {
                    "order_item": item.id,
                    "product": item.product.name,
                    "sold": str(item.quantity),
                    "returnable": str(services.returnable_quantity(item)),
                }
                for item in order.items.select_related("product").all()
            ],
        })


class ReturnViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    queryset = Return.objects.select_related("order", "created_by").prefetch_related(
        "items__product"
    )
    serializer_class = ReturnSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["order", "refund_method", "created_by", "shift"]
    ordering_fields = ["created_at", "total"]
