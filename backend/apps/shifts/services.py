"""Shift lifecycle and drawer reconciliation."""
from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Sum
from django.utils import timezone
from rest_framework import serializers

from apps.common.models import Sequence, record_audit

from .models import CashMovement, Shift

ZERO = Decimal("0.00")


def active_shift(user=None, terminal: str = "") -> Shift | None:
    """The open shift for this terminal, if any.

    Drawers belong to terminals rather than people — a supervisor may close a
    drawer another cashier opened.
    """
    qs = Shift.objects.filter(status=Shift.Status.OPEN)
    if terminal:
        qs = qs.filter(terminal=terminal)
    return qs.order_by("-opened_at").first()


@transaction.atomic
def open_shift(*, user, opening_float=ZERO, terminal: str = "", note: str = "") -> Shift:
    existing = active_shift(terminal=terminal)
    if existing:
        raise serializers.ValidationError(
            f"Shift {existing.number} is already open on this terminal. "
            "Close it before opening another."
        )
    opening_float = Decimal(opening_float or 0)
    if opening_float < ZERO:
        raise serializers.ValidationError("Opening float cannot be negative.")

    shift = Shift.objects.create(
        number=Sequence.next_value("shift", prefix="S", padding=5),
        terminal=terminal,
        opened_by=user,
        opening_float=opening_float,
    )
    if opening_float > ZERO:
        CashMovement.objects.create(
            shift=shift,
            kind=CashMovement.Kind.OPENING_FLOAT,
            amount=opening_float,
            reason=note or "Opening float",
            created_by=user,
        )
    record_audit(
        action="SHIFT_OPEN", actor=user, obj=shift,
        summary=f"Opened shift {shift.number} with float {opening_float}",
        detail={"terminal": terminal, "opening_float": str(opening_float)},
    )
    return shift


def _money(value) -> Decimal:
    """Money is always 2dp — DB SUM() can hand back an unscaled Decimal."""
    return Decimal(value or 0).quantize(Decimal("0.01"))


def expected_cash(shift: Shift) -> Decimal:
    """What should physically be in the drawer right now.

    The opening float is itself recorded as a movement, so this is simply the
    sum of all movements — no double counting.
    """
    total = shift.cash_movements.aggregate(total=Sum("amount"))["total"]
    return _money(total)


def shift_report(shift: Shift) -> dict:
    """The X/Z report body.

    Called mid-shift it is an X report (a read); called at close it is the Z.
    """
    from apps.orders.models import Order, Payment

    orders = Order.objects.filter(shift=shift)
    sales = orders.filter(status=Order.Status.COMPLETED)
    sales_agg = sales.aggregate(total=Sum("total"), count=Count("id"))

    payment_rows = (
        Payment.objects.filter(order__shift=shift)
        .values("method")
        .annotate(total=Sum("amount"), count=Count("id"))
        .order_by("method")
    )

    movement_rows = (
        shift.cash_movements.values("kind")
        .annotate(total=Sum("amount"), count=Count("id"))
        .order_by("kind")
    )

    voided = orders.filter(status=Order.Status.VOIDED)
    refunded = orders.filter(
        status__in=[Order.Status.REFUNDED, Order.Status.PARTIALLY_REFUNDED]
    )

    expected = expected_cash(shift)
    return {
        "shift": shift.number,
        "terminal": shift.terminal,
        "status": shift.status,
        "opened_by": shift.opened_by.username if shift.opened_by else None,
        "opened_at": shift.opened_at.isoformat() if shift.opened_at else None,
        "closed_at": shift.closed_at.isoformat() if shift.closed_at else None,
        "opening_float": str(_money(shift.opening_float)),
        "sales_total": str(_money(sales_agg["total"])),
        "order_count": sales_agg["count"] or 0,
        "void_count": voided.count(),
        "refund_count": refunded.count(),
        "payments": [
            {"method": r["method"], "total": str(_money(r["total"])), "count": r["count"]}
            for r in payment_rows
        ],
        "cash_movements": [
            {"kind": r["kind"], "total": str(_money(r["total"])), "count": r["count"]}
            for r in movement_rows
        ],
        "expected_cash": str(expected),
        "counted_cash": str(_money(shift.counted_cash)) if shift.counted_cash is not None else None,
        "variance": str(_money(shift.variance)) if shift.variance is not None else None,
        "generated_at": timezone.now().isoformat(),
    }


@transaction.atomic
def close_shift(*, shift: Shift, user, counted_cash, note: str = "") -> dict:
    """Blind close: the cashier submits their physical count, then we compare.

    Returns the Z report. The variance is persisted so a short drawer is
    permanently attributable.
    """
    if not shift.is_open:
        raise serializers.ValidationError(f"Shift {shift.number} is already closed.")
    counted = Decimal(counted_cash if counted_cash is not None else 0)
    if counted < ZERO:
        raise serializers.ValidationError("Counted cash cannot be negative.")

    locked = Shift.objects.select_for_update().get(pk=shift.pk)
    expected = expected_cash(locked)

    locked.counted_cash = counted
    locked.expected_cash = expected
    locked.variance = counted - expected
    locked.closed_by = user
    locked.closed_at = timezone.now()
    locked.status = Shift.Status.CLOSED
    if note:
        locked.note = note
    locked.save(
        update_fields=[
            "counted_cash", "expected_cash", "variance",
            "closed_by", "closed_at", "status", "note",
        ]
    )

    record_audit(
        action="SHIFT_CLOSE", actor=user, obj=locked,
        summary=(
            f"Closed shift {locked.number}: counted {counted}, "
            f"expected {expected}, variance {locked.variance}"
        ),
        detail={
            "counted": str(counted),
            "expected": str(expected),
            "variance": str(locked.variance),
        },
    )
    return shift_report(locked)


@transaction.atomic
def record_cash_movement(*, shift: Shift, user, kind: str, amount, reason: str = "") -> CashMovement:
    """Paid-in / paid-out / drop. Amount is given positive; sign is by kind."""
    if not shift.is_open:
        raise serializers.ValidationError("Cannot move cash on a closed shift.")
    amount = Decimal(amount or 0)
    if amount <= ZERO:
        raise serializers.ValidationError("Amount must be greater than zero.")
    if kind not in {
        CashMovement.Kind.PAY_IN, CashMovement.Kind.PAY_OUT, CashMovement.Kind.DROP
    }:
        raise serializers.ValidationError(
            "Only PAY_IN, PAY_OUT and DROP can be recorded manually."
        )
    if kind in {CashMovement.Kind.PAY_OUT, CashMovement.Kind.DROP}:
        amount = -amount
    if not reason:
        raise serializers.ValidationError("A reason is required for manual cash movements.")

    movement = CashMovement.objects.create(
        shift=shift, kind=kind, amount=amount, reason=reason, created_by=user
    )
    record_audit(
        action="CASH_MOVEMENT", actor=user, obj=movement,
        summary=f"{kind} {amount} on {shift.number}: {reason}",
        detail={"kind": kind, "amount": str(amount), "reason": reason},
    )
    return movement
