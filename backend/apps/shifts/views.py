from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.permissions import IsSuperAdmin

from . import services
from .models import CashMovement, Shift
from .serializers import (
    CashMovementInputSerializer,
    CashMovementSerializer,
    CloseShiftSerializer,
    OpenShiftSerializer,
    ShiftSerializer,
)


class ShiftViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    """Till sessions. Cashiers open/close their own drawer; admins see all."""

    queryset = Shift.objects.select_related("opened_by", "closed_by")
    serializer_class = ShiftSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["status", "terminal", "opened_by"]
    ordering_fields = ["opened_at", "closed_at"]

    @action(detail=False, methods=["get"])
    def current(self, request):
        """The open shift for this terminal, or null."""
        shift = services.active_shift(terminal=request.query_params.get("terminal", ""))
        if not shift:
            return Response({"shift": None})
        return Response(
            {"shift": ShiftSerializer(shift).data, "report": services.shift_report(shift)}
        )

    @action(detail=False, methods=["post"])
    def open(self, request):
        serializer = OpenShiftSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        shift = services.open_shift(user=request.user, **serializer.validated_data)
        return Response(ShiftSerializer(shift).data, status=201)

    @action(detail=True, methods=["post"])
    def close(self, request, pk=None):
        """Blind close — the count is submitted before expected cash is shown."""
        shift = self.get_object()
        serializer = CloseShiftSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        report = services.close_shift(
            shift=shift, user=request.user, **serializer.validated_data
        )
        return Response(report)

    @action(detail=True, methods=["get"], url_path="x-report")
    def x_report(self, request, pk=None):
        """Mid-shift read. Does not close the drawer."""
        return Response(services.shift_report(self.get_object()))

    @action(detail=True, methods=["post"], url_path="cash-movement")
    def cash_movement(self, request, pk=None):
        shift = self.get_object()
        serializer = CashMovementInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        movement = services.record_cash_movement(
            shift=shift, user=request.user, **serializer.validated_data
        )
        return Response(CashMovementSerializer(movement).data, status=201)


class CashMovementViewSet(
    mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet
):
    queryset = CashMovement.objects.select_related("shift", "created_by", "order")
    serializer_class = CashMovementSerializer
    permission_classes = [IsSuperAdmin]
    filterset_fields = ["shift", "kind"]
