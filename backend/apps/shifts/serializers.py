from decimal import Decimal

from rest_framework import serializers

from .models import CashMovement, Shift


class CashMovementSerializer(serializers.ModelSerializer):
    created_by_username = serializers.CharField(
        source="created_by.username", read_only=True
    )

    class Meta:
        model = CashMovement
        fields = [
            "id", "shift", "kind", "amount", "reason", "order",
            "created_by", "created_by_username", "created_at",
        ]
        read_only_fields = fields


class ShiftSerializer(serializers.ModelSerializer):
    opened_by_username = serializers.CharField(source="opened_by.username", read_only=True)
    closed_by_username = serializers.CharField(source="closed_by.username", read_only=True)

    class Meta:
        model = Shift
        fields = [
            "id", "number", "terminal", "status",
            "opened_by", "opened_by_username", "opened_at",
            "closed_by", "closed_by_username", "closed_at",
            "opening_float", "counted_cash", "expected_cash", "variance", "note",
        ]
        read_only_fields = fields


class OpenShiftSerializer(serializers.Serializer):
    opening_float = serializers.DecimalField(
        max_digits=12, decimal_places=2, default=Decimal("0.00"), min_value=Decimal("0")
    )
    terminal = serializers.CharField(max_length=64, required=False, allow_blank=True)
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)


class CloseShiftSerializer(serializers.Serializer):
    counted_cash = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=Decimal("0")
    )
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)


class CashMovementInputSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=["PAY_IN", "PAY_OUT", "DROP"])
    amount = serializers.DecimalField(
        max_digits=12, decimal_places=2, min_value=Decimal("0.01")
    )
    reason = serializers.CharField(max_length=255)
