"""Receiving goods and applying stock takes.

Both write through apply_stock_change so the ledger stays the single source of
truth for how stock arrived at its current level.
"""
from decimal import Decimal

from django.db import transaction
from django.db.models import F
from django.utils import timezone
from rest_framework import serializers

from apps.common.models import Sequence, record_audit
from apps.inventory.models import StockItem, apply_stock_change

from .models import (
    GoodsReceipt,
    GoodsReceiptItem,
    PurchaseOrder,
    PurchaseOrderItem,
    StockTake,
    StockTakeLine,
)

ZERO = Decimal("0")


@transaction.atomic
def receive_goods(*, purchase_order: PurchaseOrder, user, lines, supplier_reference="", note=""):
    """Book in a delivery.

    `lines` is [{"purchase_order_item": POItem, "quantity": Decimal,
    "unit_cost": Decimal | None}]. Over-receiving is refused so a delivery
    cannot quietly inflate stock beyond what was ordered.
    """
    if not lines:
        raise serializers.ValidationError("A receipt must include at least one line.")

    # Lock the PO before checking it: two deliveries booked in at the same
    # moment would otherwise both see the same `outstanding` and between them
    # receive more than was ever ordered.
    purchase_order = PurchaseOrder.objects.select_for_update().get(pk=purchase_order.pk)
    if not purchase_order.is_open:
        raise serializers.ValidationError(
            f"PO {purchase_order.number} is {purchase_order.get_status_display()} "
            "and cannot receive more goods."
        )

    receipt = GoodsReceipt.objects.create(
        number=Sequence.next_value("receipt_goods", prefix="GR", padding=5),
        purchase_order=purchase_order,
        received_by=user,
        supplier_reference=supplier_reference,
        note=note,
    )

    for line in lines:
        po_item = line["purchase_order_item"]
        qty = Decimal(line["quantity"])
        if po_item.purchase_order_id != purchase_order.pk:
            raise serializers.ValidationError("That line does not belong to this PO.")
        # Loaded before we took the PO lock, so its quantity_received may be
        # one delivery out of date.
        po_item.refresh_from_db()
        if qty <= ZERO:
            raise serializers.ValidationError("Received quantity must be greater than zero.")
        if qty > po_item.outstanding:
            raise serializers.ValidationError(
                f"Cannot receive {qty} of '{po_item.product.name}' — only "
                f"{po_item.outstanding} outstanding on this PO."
            )
        if not po_item.product.is_weighed and qty != qty.to_integral_value():
            raise serializers.ValidationError(
                f"'{po_item.product.name}' is sold per unit — receive a whole number."
            )

        # The delivered price can differ from the ordered price.
        unit_cost = line.get("unit_cost")
        unit_cost = Decimal(unit_cost) if unit_cost is not None else po_item.unit_cost

        GoodsReceiptItem.objects.create(
            receipt=receipt,
            purchase_order_item=po_item,
            product=po_item.product,
            quantity=qty,
            unit_cost=unit_cost,
        )
        po_item.quantity_received += qty
        po_item.save(update_fields=["quantity_received"])

        apply_stock_change(
            product=po_item.product,
            storage=purchase_order.storage,
            change=qty,
            reason="PURCHASE",
            reference=receipt.number,
            user=user,
            note=f"PO {purchase_order.number}",
        )

        # Keep the product's standard cost aligned with the latest landed cost,
        # so margin on future sales reflects what we actually paid.
        if unit_cost > ZERO and po_item.product.cost != unit_cost:
            old = po_item.product.cost
            po_item.product.cost = unit_cost
            po_item.product.save(update_fields=["cost"])
            record_audit(
                action="PRICE_CHANGE", actor=user, obj=po_item.product,
                summary=f"Cost of {po_item.product.name} {old} -> {unit_cost} via {receipt.number}",
                detail={"from": str(old), "to": str(unit_cost), "receipt": receipt.number},
            )

    # Query fresh rather than purchase_order.items.all(): the view prefetches
    # items, and that cache still holds the pre-receipt quantities.
    outstanding = (
        PurchaseOrderItem.objects.filter(purchase_order=purchase_order)
        .filter(quantity_received__lt=F("quantity_ordered"))
        .exists()
    )
    purchase_order.status = (
        PurchaseOrder.Status.PARTIAL if outstanding else PurchaseOrder.Status.RECEIVED
    )
    purchase_order.save(update_fields=["status", "updated_at"])

    record_audit(
        action="CREATE", actor=user, obj=receipt,
        summary=f"Received {receipt.number} against PO {purchase_order.number}",
        detail={"po": purchase_order.number, "reference": supplier_reference},
    )
    return receipt


@transaction.atomic
def start_stock_take(*, storage, user, products=None, note="") -> StockTake:
    """Open a count, snapshotting current levels as the expected figures."""
    take = StockTake.objects.create(
        number=Sequence.next_value("stocktake", prefix="ST", padding=5),
        storage=storage,
        created_by=user,
        note=note,
    )
    items = StockItem.objects.filter(storage=storage).select_related("product")
    if products:
        items = items.filter(product__in=products)
    for item in items:
        StockTakeLine.objects.create(
            stock_take=take,
            product=item.product,
            expected_quantity=item.quantity,
            counted_quantity=item.quantity,
        )
    return take


@transaction.atomic
def apply_stock_take(*, take: StockTake, user) -> dict:
    """Write the counted figures into stock as explicit corrections."""
    if take.status != StockTake.Status.COUNTING:
        raise serializers.ValidationError(
            f"Stock take {take.number} is already {take.get_status_display()}."
        )

    adjusted = 0
    total_variance = ZERO
    for line in take.lines.select_related("product").all():
        variance = line.variance
        if variance == ZERO:
            continue
        apply_stock_change(
            product=line.product,
            storage=take.storage,
            change=variance,
            reason="STOCKTAKE",
            reference=take.number,
            user=user,
            note=take.note[:255],
        )
        adjusted += 1
        total_variance += variance

    take.status = StockTake.Status.APPLIED
    take.applied_by = user
    take.applied_at = timezone.now()
    take.save(update_fields=["status", "applied_by", "applied_at"])

    record_audit(
        action="STOCK_ADJUST", actor=user, obj=take,
        summary=f"Applied stock take {take.number}: {adjusted} lines adjusted",
        detail={"lines_adjusted": adjusted, "net_variance": str(total_variance)},
    )
    return {
        "stock_take": take.number,
        "lines_adjusted": adjusted,
        "net_variance": str(total_variance),
    }
