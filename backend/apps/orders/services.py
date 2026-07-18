"""Post-sale operations: voids and returns.

A completed sale is never mutated. Voids and returns are recorded as their own
documents so the original receipt stays exactly as it was printed, and the
stock ledger and drawer both carry a matching reversing entry.
"""
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from apps.common.models import Sequence, record_audit
from apps.inventory.models import apply_stock_change

from .models import Order, OrderItem, Payment, Return, ReturnItem

ZERO = Decimal("0.00")
MONEY = Decimal("0.01")


def _money(value) -> Decimal:
    return Decimal(value or 0).quantize(MONEY)


@transaction.atomic
def void_order(*, order: Order, user, reason: str, authorised_by=None) -> Order:
    """Cancel a sale in full, same session — nothing was really sold.

    Distinct from a return: a void reverses the whole transaction and is only
    permitted while the shift that took it is still open.
    """
    if not reason:
        raise serializers.ValidationError("A reason is required to void a sale.")
    locked = Order.objects.select_for_update().get(pk=order.pk)
    if locked.status != Order.Status.COMPLETED:
        raise serializers.ValidationError(
            f"Only a completed sale can be voided (this one is {locked.get_status_display()})."
        )
    if locked.returns.exists():
        raise serializers.ValidationError(
            "This sale has returns against it — void is no longer possible."
        )
    if locked.shift and not locked.shift.is_open:
        raise serializers.ValidationError(
            "The shift for this sale is closed. Process a return instead of a void."
        )

    for item in locked.items.select_related("product").all():
        apply_stock_change(
            product=item.product,
            storage=locked.storage,
            change=item.quantity,
            reason="VOID",
            reference=locked.receipt_number or f"order:{locked.pk}",
            user=user,
            note=reason[:255],
        )

    _reverse_cash(order=locked, user=user, amount=_cash_taken(locked), reason=f"Void {locked.receipt_number}")

    locked.status = Order.Status.VOIDED
    locked.save(update_fields=["status"])

    record_audit(
        action="VOID", actor=user, authorised_by=authorised_by, obj=locked,
        summary=f"Voided {locked.receipt_number}: {reason}",
        detail={"reason": reason, "total": str(locked.total)},
    )
    return locked


def _cash_taken(order: Order) -> Decimal:
    return _money(
        sum(
            (p.amount for p in order.payments.filter(method=Payment.Method.CASH)),
            ZERO,
        )
    )


def _reverse_cash(*, order: Order, user, amount: Decimal, reason: str) -> None:
    """Take cash back out of the drawer for a void/refund."""
    from apps.shifts.models import CashMovement

    if amount <= ZERO or order.shift is None:
        return
    CashMovement.objects.create(
        shift=order.shift,
        kind=CashMovement.Kind.REFUND,
        amount=-amount,
        order=order,
        reason=reason,
        created_by=user,
    )


@transaction.atomic
def create_return(
    *, order: Order, user, lines, refund_method: str, reason: str,
    restock: bool = True, authorised_by=None, shift=None,
) -> Return:
    """Refund some or all of a sale.

    `lines` is [{"order_item": OrderItem, "quantity": Decimal}]. Quantities are
    capped at what remains returnable on each line, so a customer cannot be
    refunded twice for the same item.
    """
    if not reason:
        raise serializers.ValidationError("A reason is required for a return.")
    if not lines:
        raise serializers.ValidationError("A return must include at least one line.")

    locked = Order.objects.select_for_update().get(pk=order.pk)
    if locked.status == Order.Status.VOIDED:
        raise serializers.ValidationError("This sale was voided — there is nothing to return.")
    if locked.status == Order.Status.REFUNDED:
        raise serializers.ValidationError("This sale has already been fully refunded.")

    ret = Return.objects.create(
        number=Sequence.next_value("return", prefix="RT", padding=5),
        order=locked,
        created_by=user,
        shift=shift,
        refund_method=refund_method,
        reason=reason,
        restocked=restock,
    )

    refund_total = ZERO
    for line in lines:
        item: OrderItem = line["order_item"]
        qty = Decimal(line["quantity"])
        if item.order_id != locked.pk:
            raise serializers.ValidationError("That line does not belong to this sale.")
        if qty <= 0:
            raise serializers.ValidationError("Return quantity must be greater than zero.")

        remaining = returnable_quantity(item)
        if qty > remaining:
            raise serializers.ValidationError(
                f"Cannot return {qty} of '{item.product.name}' — only {remaining} remain."
            )
        if not item.product.is_weighed and qty != qty.to_integral_value():
            raise serializers.ValidationError(
                f"'{item.product.name}' is sold per unit — return a whole number."
            )

        # Refund at the price actually charged, net of any discount given on
        # that line, so a discounted item is not refunded at full price.
        effective_unit = (item.line_total / item.quantity).quantize(MONEY)
        line_refund = (effective_unit * qty).quantize(MONEY)
        refund_total += line_refund

        ReturnItem.objects.create(
            return_doc=ret,
            order_item=item,
            product=item.product,
            quantity=qty,
            unit_refund=effective_unit,
            line_refund=line_refund,
        )

        if restock:
            apply_stock_change(
                product=item.product,
                storage=locked.storage,
                change=qty,
                reason="RETURN",
                reference=ret.number,
                user=user,
                note=reason[:255],
            )

    ret.total = refund_total
    ret.save(update_fields=["total"])

    if refund_method == Payment.Method.CASH:
        target_shift = shift or locked.shift
        if target_shift is None:
            raise serializers.ValidationError(
                "No shift is open — a cash refund needs a drawer to come out of."
            )
        from apps.shifts.models import CashMovement

        CashMovement.objects.create(
            shift=target_shift,
            kind=CashMovement.Kind.REFUND,
            amount=-refund_total,
            order=locked,
            reason=f"Refund {ret.number} against {locked.receipt_number}",
            created_by=user,
        )

    locked.status = (
        Order.Status.REFUNDED if is_fully_returned(locked) else Order.Status.PARTIALLY_REFUNDED
    )
    locked.save(update_fields=["status"])

    record_audit(
        action="REFUND", actor=user, authorised_by=authorised_by, obj=ret,
        summary=f"Refund {ret.number} of {refund_total} against {locked.receipt_number}: {reason}",
        detail={
            "order": locked.receipt_number,
            "total": str(refund_total),
            "method": refund_method,
            "restocked": restock,
        },
    )
    return ret


def returnable_quantity(item: OrderItem) -> Decimal:
    """How much of this line has not yet been returned."""
    already = sum(
        (ri.quantity for ri in item.return_items.all()), Decimal("0")
    )
    return item.quantity - already


def is_fully_returned(order: Order) -> bool:
    return all(returnable_quantity(item) <= 0 for item in order.items.all())
