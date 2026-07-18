from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.accounts.permissions import IsSuperAdmin, IsSuperAdminOrReadOnly

from . import services
from .models import GoodsReceipt, PurchaseOrder, StockTake
from .serializers import (
    GoodsReceiptSerializer,
    PurchaseOrderCreateSerializer,
    PurchaseOrderSerializer,
    ReceiveGoodsSerializer,
    StartStockTakeSerializer,
    StockTakeSerializer,
    SubmitCountSerializer,
)


class PurchaseOrderViewSet(viewsets.ModelViewSet):
    """Purchase orders. Receiving a PO is what actually moves stock."""

    queryset = PurchaseOrder.objects.select_related(
        "supplier", "storage", "created_by"
    ).prefetch_related("items__product")
    permission_classes = [IsSuperAdminOrReadOnly]
    filterset_fields = ["supplier", "status", "storage"]
    search_fields = ["number", "supplier__name"]
    ordering_fields = ["created_at", "expected_at", "total_cost"]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_serializer_class(self):
        if self.action == "create":
            return PurchaseOrderCreateSerializer
        return PurchaseOrderSerializer

    @action(detail=True, methods=["post"])
    def send(self, request, pk=None):
        po = self.get_object()
        if po.status != PurchaseOrder.Status.DRAFT:
            return Response({"detail": "Only a draft PO can be sent."}, status=400)
        po.status = PurchaseOrder.Status.SENT
        po.save(update_fields=["status", "updated_at"])
        return Response(PurchaseOrderSerializer(po).data)

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        po = self.get_object()
        if po.receipts.exists():
            return Response(
                {"detail": "Goods have already been received against this PO."},
                status=400,
            )
        po.status = PurchaseOrder.Status.CANCELLED
        po.save(update_fields=["status", "updated_at"])
        return Response(PurchaseOrderSerializer(po).data)

    @action(detail=True, methods=["post"])
    def receive(self, request, pk=None):
        serializer = ReceiveGoodsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        receipt = services.receive_goods(
            purchase_order=self.get_object(),
            user=request.user,
            lines=data["lines"],
            supplier_reference=data.get("supplier_reference", ""),
            note=data.get("note", ""),
        )
        return Response(GoodsReceiptSerializer(receipt).data, status=201)


class GoodsReceiptViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    queryset = GoodsReceipt.objects.select_related(
        "purchase_order", "received_by"
    ).prefetch_related("items__product")
    serializer_class = GoodsReceiptSerializer
    permission_classes = [IsSuperAdminOrReadOnly]
    filterset_fields = ["purchase_order"]


class StockTakeViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """Physical counts. Variances are applied as explicit corrections."""

    queryset = StockTake.objects.select_related("storage").prefetch_related(
        "lines__product"
    )
    serializer_class = StockTakeSerializer
    permission_classes = [IsSuperAdmin]
    filterset_fields = ["storage", "status"]

    @action(detail=False, methods=["post"])
    def start(self, request):
        serializer = StartStockTakeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        take = services.start_stock_take(
            storage=serializer.validated_data["storage"],
            user=request.user,
            note=serializer.validated_data.get("note", ""),
        )
        return Response(StockTakeSerializer(take).data, status=201)

    @action(detail=True, methods=["post"])
    def count(self, request, pk=None):
        """Record counted figures without applying them yet."""
        take = self.get_object()
        if take.status != StockTake.Status.COUNTING:
            return Response({"detail": "This stock take is no longer open."}, status=400)
        serializer = SubmitCountSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        for entry in serializer.validated_data["counts"]:
            line = entry["line"]
            if line.stock_take_id != take.pk:
                return Response(
                    {"detail": "That line belongs to a different stock take."}, status=400
                )
            line.counted_quantity = entry["counted_quantity"]
            line.save(update_fields=["counted_quantity"])
        return Response(StockTakeSerializer(take).data)

    @action(detail=True, methods=["post"])
    def apply(self, request, pk=None):
        result = services.apply_stock_take(take=self.get_object(), user=request.user)
        return Response(result)

    @action(detail=True, methods=["get"])
    def variances(self, request, pk=None):
        """Only the lines that disagree — what a manager actually reviews."""
        take = self.get_object()
        rows = [
            {
                "product": line.product.name,
                "unit": line.product.unit,
                "expected": str(line.expected_quantity),
                "counted": str(line.counted_quantity),
                "variance": str(line.variance),
            }
            for line in take.lines.select_related("product").all()
            if line.variance != 0
        ]
        return Response({"stock_take": take.number, "variances": rows})
