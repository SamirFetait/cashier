"""The life of a web order.

    AWAITING_DEPOSIT -> DEPOSIT_REVIEW -> CONFIRMED -> PREPARING -> READY -> COMPLETED
           |                 |                 \\___________|___________/
           v                 v                             v
        EXPIRED          (rejected: back              CANCELLED
                          to awaiting)             (refund due if paid)

Every step is recorded as a WebOrderEvent. Stock is untouched until
`complete_order`, which rings the sale up through the normal checkout
(orders.serializers.OrderCreateSerializer): stock, receipt number, shift,
manager PIN and audit log all behave exactly as for a sale at the till.
"""
import logging
import secrets
from datetime import timedelta
from decimal import Decimal

from django.conf import settings as django_settings
from django.core.cache import cache
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers as drf_serializers

from apps.customers.models import Customer
from apps.orders.models import Order

from . import catalog, phones, pricing
from .errors import ShopError, first_message
from .images import ProcessedImage
from .models import DepositProof, ShopSettings, WebOrder, WebOrderEvent, WebOrderItem

log = logging.getLogger(__name__)

ZERO = Decimal("0.00")
MONEY = Decimal("0.01")

# No 0/O, 1/I/L: the code is read out over the phone and typed into InstaPay.
CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
CODE_PREFIX = "FK-"
# One phone number may hold this many orders that are holding stock without
# money behind them (deliveries waiting for a deposit, pickups not collected
# yet), so a prankster cannot tie up the shelves.
MAX_OPEN_PER_PHONE = 3
BALANCE_METHODS = ("CASH", "MOBILE", "CARD")

Status = WebOrder.Status
Kind = WebOrderEvent.Kind


def new_code() -> str:
    return CODE_PREFIX + "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))


def log_event(order, kind, *, actor="", public=False, message="", data=None) -> WebOrderEvent:
    return WebOrderEvent.objects.create(
        order=order, kind=kind, actor=actor, public=public, message=message[:500], data=data or {},
    )


def _locked(order: WebOrder) -> WebOrder:
    """The order re-read under a row lock. Call inside a transaction."""
    return WebOrder.objects.select_for_update().get(pk=order.pk)


# --- Expiry -----------------------------------------------------------------


def expire_stale(*, force: bool = False) -> int:
    """Expire unpaid orders whose hold has run out, releasing their stock.

    Called on the way into anything that depends on availability, so no
    scheduler is needed. Public pages ask casually (at most one look every few
    seconds); placing an order and the admin board insist with ``force``.
    """
    if not force:
        if cache.get("webshop:expiry-sweep"):
            return 0
        cache.set("webshop:expiry-sweep", 1, 10)
    now = timezone.now()
    if not WebOrder.objects.filter(status=Status.AWAITING_DEPOSIT, expires_at__lt=now).exists():
        return 0
    with transaction.atomic():
        stale = list(
            WebOrder.objects.select_for_update().filter(status=Status.AWAITING_DEPOSIT, expires_at__lt=now)
        )
        for order in stale:
            order.status = Status.EXPIRED
            order.save(update_fields=["status", "updated_at"])
            log_event(order, Kind.EXPIRED, actor="system", public=True)
    return len(stale)


# --- Placing an order (customer) --------------------------------------------


def open_unpaid_count(phone: str) -> int:
    """Orders on this number holding stock with nothing paid: deliveries
    waiting for their deposit, and pickups not yet collected."""
    return WebOrder.objects.filter(phone=phone, deposit_paid=ZERO).filter(
        Q(status=Status.AWAITING_DEPOSIT)
        | Q(fulfilment=WebOrder.Fulfilment.PICKUP, status__in=WebOrder.IN_PROGRESS)
    ).count()


def create_order(
    *, items, fulfilment, customer_name, phone, address="", notes="",
    language="ar", expected_total=None, client_ip=None,
) -> WebOrder:
    """Price the cart from live prices and stock, and reserve it.

    A delivery waits for its InstaPay deposit. A pickup is accepted at once:
    it is created confirmed, with nothing to pay until the customer collects.

    Raises ShopError with the fresh quote attached when the cart can no longer
    be ordered as the customer saw it (something sold out, a price moved).
    """
    from .presenters import quote_json

    ShopSettings.load()  # make sure the row exists before locking it
    with transaction.atomic():
        # Locking the settings row makes placement one-at-a-time, so the
        # availability check and the reservation cannot interleave.
        settings = ShopSettings.objects.select_for_update().get(pk=1)
        expire_stale(force=True)
        quote = pricing.build_quote(items, fulfilment, settings)
        if not quote.ok:
            raise ShopError(
                "CART_CHANGED", "The cart can no longer be ordered as it is.",
                status=409, quote=quote_json(quote),
            )
        if expected_total is not None and Decimal(expected_total) != quote.total:
            raise ShopError(
                "PRICE_CHANGED", "Prices have changed since the cart was shown.",
                status=409, quote=quote_json(quote),
            )
        if open_unpaid_count(phone) >= MAX_OPEN_PER_PHONE:
            raise ShopError(
                "TOO_MANY_OPEN", "This number already has several open orders.", status=409
            )

        pickup = not pricing.takes_deposit(quote.fulfilment)
        now = timezone.now()
        order = WebOrder(
            status=Status.CONFIRMED if pickup else Status.AWAITING_DEPOSIT,
            confirmed_at=now if pickup else None,
            access_token=secrets.token_urlsafe(24),
            language=language if language in ("ar", "en") else "ar",
            customer_name=customer_name,
            phone=phone,
            fulfilment=quote.fulfilment,
            address=address if quote.fulfilment == WebOrder.Fulfilment.DELIVERY else "",
            notes=notes,
            subtotal=quote.subtotal,
            delivery_fee=quote.delivery_fee,
            total=quote.total,
            deposit_required=quote.deposit,
            # Only a deposit can be waited for; a pickup holds until staff
            # hand it over or cancel it.
            expires_at=None if pickup else now + timedelta(minutes=settings.hold_minutes),
            client_ip=client_ip,
        )
        for _ in range(8):
            order.code = new_code()
            if not WebOrder.objects.filter(code=order.code).exists():
                break
        order.save()
        WebOrderItem.objects.bulk_create(
            WebOrderItem(
                order=order, product_id=line.product_id, name=line.name, unit=line.unit,
                sold_by=line.sold_by, unit_price=line.unit_price, quantity=line.quantity,
                line_total=line.line_total,
            )
            for line in quote.lines
        )
        log_event(order, Kind.CREATED, actor="customer", public=True)
        if pickup:
            log_event(
                order, Kind.STATUS, actor="system", public=True,
                data={"from": Status.AWAITING_DEPOSIT, "to": Status.CONFIRMED, "auto": True},
            )
    return order


def customer_can_cancel(order: WebOrder) -> bool:
    """Before saying they paid, or, for a pickup, until staff start on it."""
    if order.status == Status.AWAITING_DEPOSIT:
        return True
    return (
        order.status == Status.CONFIRMED
        and order.fulfilment == WebOrder.Fulfilment.PICKUP
        and order.deposit_paid == ZERO
    )


def submit_deposit(order: WebOrder, *, reference="", sender="", proof: ProcessedImage | None = None) -> WebOrder:
    """The customer says they have sent the deposit.

    Accepted on an expired order too: someone who paid a little late must
    still be able to say so, and staff then decide to confirm or refund.
    """
    reference = reference.strip()
    with transaction.atomic():
        order = _locked(order)
        if order.status not in (Status.AWAITING_DEPOSIT, Status.EXPIRED):
            raise ShopError("NOT_AWAITING_DEPOSIT", "This order is not waiting for a deposit.", status=409)
        has_proof = proof is not None or DepositProof.objects.filter(order=order).exists()
        if not reference and not has_proof:
            raise ShopError("PROOF_REQUIRED", "Send the transfer reference number or a screenshot.")
        order.deposit_reference = reference[:64]
        order.deposit_sender = sender.strip()[:120]
        order.deposit_submitted_at = timezone.now()
        order.deposit_reject_reason = ""
        order.status = Status.DEPOSIT_REVIEW
        order.expires_at = None
        order.save()
        if proof is not None:
            DepositProof.objects.update_or_create(
                order=order,
                defaults={
                    "data": proof.data, "content_type": proof.content_type,
                    "width": proof.width, "height": proof.height,
                },
            )
        log_event(
            order, Kind.DEPOSIT_SUBMITTED, actor="customer", public=True,
            data={"reference": order.deposit_reference, "proof": proof is not None},
        )
    return order


def customer_cancel(order: WebOrder) -> WebOrder:
    """A customer may back out as long as they have not said they paid, or,
    for a pickup, until the store starts preparing it."""
    with transaction.atomic():
        order = _locked(order)
        if not customer_can_cancel(order):
            raise ShopError("CANNOT_CANCEL", "This order can no longer be cancelled online.", status=409)
        order.status = Status.CANCELLED
        order.cancelled_at = timezone.now()
        order.cancelled_by = "customer"
        order.expires_at = None
        order.save()
        log_event(order, Kind.CANCELLED, actor="customer", public=True)
    return order


# --- Staff actions ----------------------------------------------------------


def shortages(order: WebOrder) -> list[dict]:
    """Lines the store can no longer cover, counting other open web orders.
    While this order holds its own reservation, that is not counted against it."""
    items = list(order.items.all())
    ids = [item.product_id for item in items]
    products = catalog.load_products(ids)
    reserved = pricing.reserved_quantities(ids)
    short = []
    for item in items:
        info = products.get(item.product_id)
        stock = info.stock if info else ZERO
        others = reserved.get(item.product_id, ZERO)
        if order.status in WebOrder.RESERVING:
            others -= item.quantity
        free = stock - max(others, ZERO)
        if info is None or not info.is_active or free < item.quantity:
            short.append({
                "product_id": item.product_id, "name": item.name,
                "needed": str(item.quantity), "free": str(max(free, ZERO)),
                "missing": info is None or not info.is_active,
            })
    return short


def confirm_deposit(order: WebOrder, *, user, amount, force: bool = False) -> WebOrder:
    """Staff found the transfer: the order is now a firm one."""
    amount = Decimal(amount).quantize(MONEY)
    if amount <= ZERO:
        raise ShopError("INVALID_AMOUNT", "Enter the amount that was received.")
    with transaction.atomic():
        order = _locked(order)
        if order.status not in (Status.AWAITING_DEPOSIT, Status.DEPOSIT_REVIEW, Status.EXPIRED):
            raise ShopError("INVALID_STATE", "This order's deposit is not open for confirmation.", status=409)
        if order.status == Status.EXPIRED and not force:
            # Its stock was released when it expired, so look before promising.
            short = shortages(order)
            if short:
                raise ShopError("STOCK_GONE", "Some items are no longer available.", status=409, lines=short)
        now = timezone.now()
        order.deposit_paid = amount
        order.deposit_confirmed_at = now
        order.deposit_confirmed_by = user
        order.deposit_reject_reason = ""
        order.status = Status.CONFIRMED
        order.confirmed_at = now
        order.expires_at = None
        order.save()
        log_event(
            order, Kind.DEPOSIT_CONFIRMED, actor=user.username, public=True,
            data={"amount": str(amount), "required": str(order.deposit_required)},
        )
    return order


def reject_deposit(order: WebOrder, *, user, reason: str) -> WebOrder:
    """The transfer could not be found. The customer gets a fresh hold to send
    the right details."""
    reason = reason.strip()
    if not reason:
        raise ShopError("REASON_REQUIRED", "Say what the customer should check.")
    hold = ShopSettings.load().hold_minutes
    with transaction.atomic():
        order = _locked(order)
        if order.status != Status.DEPOSIT_REVIEW:
            raise ShopError("INVALID_STATE", "This order has no deposit to review.", status=409)
        order.status = Status.AWAITING_DEPOSIT
        order.deposit_reject_reason = reason[:255]
        order.expires_at = timezone.now() + timedelta(minutes=hold)
        order.save()
        log_event(
            order, Kind.DEPOSIT_REJECTED, actor=user.username, public=True,
            message=reason, data={"reference": order.deposit_reference},
        )
    return order


def set_status(order: WebOrder, *, user, status: str) -> WebOrder:
    """Move a confirmed order between confirmed / preparing / ready."""
    if status not in WebOrder.IN_PROGRESS:
        raise ShopError("INVALID", "Unknown status.")
    with transaction.atomic():
        order = _locked(order)
        if order.status not in WebOrder.IN_PROGRESS:
            raise ShopError("INVALID_STATE", "Only a confirmed order can be moved along.", status=409)
        if order.status != status:
            previous = order.status
            order.status = status
            order.save()
            log_event(order, Kind.STATUS, actor=user.username, public=True, data={"from": previous, "to": status})
    return order


def cancel_order(order: WebOrder, *, user, reason: str) -> WebOrder:
    """Staff cancel an open order. A deposit already received becomes a refund
    that is owed, which only a super admin may decide."""
    reason = reason.strip()
    if not reason:
        raise ShopError("REASON_REQUIRED", "A reason is required to cancel an order.")
    with transaction.atomic():
        order = _locked(order)
        if order.status not in WebOrder.ACTIVE:
            raise ShopError("INVALID_STATE", "This order is already closed.", status=409)
        if order.deposit_paid > ZERO and not user.is_superadmin:
            raise ShopError(
                "FORBIDDEN_ROLE", "Only a super admin can cancel an order whose deposit was received.",
                status=403,
            )
        order.status = Status.CANCELLED
        order.cancelled_at = timezone.now()
        order.cancelled_by = user.username
        order.cancel_reason = reason[:255]
        order.expires_at = None
        if order.deposit_paid > ZERO:
            order.refund_status = WebOrder.Refund.DUE
            order.refund_amount = order.deposit_paid
        order.save()
        log_event(
            order, Kind.CANCELLED, actor=user.username, public=True, message=reason,
            data={"refund_due": str(order.refund_amount)},
        )
    return order


def mark_refunded(order: WebOrder, *, user, reference: str = "") -> WebOrder:
    if not user.is_superadmin:
        raise ShopError("FORBIDDEN_ROLE", "Only a super admin can record a refund.", status=403)
    with transaction.atomic():
        order = _locked(order)
        if order.refund_status != WebOrder.Refund.DUE:
            raise ShopError("INVALID_STATE", "No refund is due on this order.", status=409)
        order.refund_status = WebOrder.Refund.DONE
        order.refund_reference = reference.strip()[:120]
        order.refunded_at = timezone.now()
        order.refunded_by = user
        order.save()
        log_event(
            order, Kind.REFUNDED, actor=user.username, public=True,
            data={"amount": str(order.refund_amount), "reference": order.refund_reference},
        )
    return order


def add_note(order: WebOrder, *, user, message: str) -> WebOrderEvent:
    message = message.strip()
    if not message:
        raise ShopError("INVALID", "Write the note first.")
    return log_event(order, Kind.NOTE, actor=user.username, public=False, message=message)


# --- Completing: the web order becomes a sale -------------------------------


def sale_plan(order: WebOrder, price_mode: str | None = None) -> dict:
    """The sale as it would be rung up now, at current prices.

    Checkout always sells at the current price, so when a price has moved since
    the customer ordered, staff choose: ``quoted`` keeps the customer's price by
    discounting a rise (a price that dropped is simply charged lower), and
    ``current`` charges today's.
    """
    items = list(order.items.all())
    products = catalog.load_products(item.product_id for item in items)
    lines, changes = [], []
    current_total = quoted_total = honoured_total = ZERO
    for item in items:
        info = products.get(item.product_id)
        if info is None or not info.is_active:
            raise ShopError(
                "PRODUCT_MISSING",
                f"'{item.name}' is no longer sold. Cancel this order instead.",
                status=409,
            )
        current = pricing.line_total(info.price, item.quantity)
        honoured = min(item.line_total, current)
        current_total += current
        quoted_total += item.line_total
        honoured_total += honoured
        if current != item.line_total:
            changes.append({
                "product_id": item.product_id, "name": item.name, "quantity": str(item.quantity),
                "quoted_price": str(item.unit_price), "current_price": str(info.price),
                "quoted_line": str(item.line_total), "current_line": str(current),
            })
        charged = honoured if price_mode == "quoted" else current
        lines.append({"product": item.product_id, "quantity": item.quantity, "discount": current - charged})
    total = honoured_total if price_mode == "quoted" else current_total
    deposit_applied = min(order.deposit_paid, total)
    return {
        "lines": lines,
        "changes": changes,
        "total": total,
        "quoted_total": quoted_total,
        "current_total": current_total,
        "honoured_total": honoured_total,
        "deposit_applied": deposit_applied,
        "balance": total - deposit_applied,
    }


def _customer_for(order: WebOrder) -> Customer:
    """The cashier customer with this phone number, or a new one."""
    existing = Customer.objects.filter(phone_number__in=phones.spellings(order.phone)).order_by("id").first()
    if existing:
        return existing
    return Customer.objects.create(
        name=order.customer_name,
        phone_number=order.phone,
        address=order.address[:255],
        notes=f"From web order {order.code}",
    )


def _checkout_error(exc: drf_serializers.ValidationError, pin_given: bool) -> ShopError:
    """Checkout's refusal (no open shift, not enough stock, a PIN needed) in
    the website's error shape."""
    detail = exc.detail
    if isinstance(detail, dict) and "override_pin" in detail:
        code = "PIN_INVALID" if pin_given else "PIN_REQUIRED"
        return ShopError(code, first_message(detail["override_pin"]), status=409)
    return ShopError("POS_REJECTED", first_message(detail) or "Checkout refused the sale.", status=409)


def complete_order(
    order: WebOrder, *, request, balance_method: str = "", balance_reference: str = "",
    price_mode: str | None = None, override_pin: str = "",
) -> WebOrder:
    """Hand-over: ring the order up as a sale and close it, in one transaction.

    The sale is paid by two tenders: the InstaPay deposit (MOBILE) and the
    balance by whatever the customer used. The delivery fee stays outside the
    sale. `request` is the staff member's API request; checkout reads the
    signed-in user and the manager PIN from it, as it does at the till.
    """
    from apps.orders.serializers import OrderCreateSerializer

    if price_mode not in (None, "quoted", "current"):
        raise ShopError("INVALID", "Unknown price mode.")

    with transaction.atomic():
        order = _locked(order)
        if order.status not in WebOrder.IN_PROGRESS:
            raise ShopError("INVALID_STATE", "Only a confirmed order can be completed.", status=409)

        # A sale already rung up for this order (a lost answer, a double
        # click) is picked up instead of being sold twice.
        sale = Order.objects.filter(client_uuid=order.public_id).first()
        plan = sale_plan(order, price_mode)
        if sale is None:
            if plan["changes"] and price_mode is None:
                raise ShopError(
                    "PRICE_CHANGED", "Prices have changed since this order was placed.",
                    status=409, lines=plan["changes"],
                    quoted_total=str(plan["quoted_total"]),
                    current_total=str(plan["current_total"]),
                    honoured_total=str(plan["honoured_total"]),
                )
            payments = []
            if plan["deposit_applied"] > ZERO:
                payments.append({
                    "method": "MOBILE",
                    "amount": plan["deposit_applied"],
                    "reference": f"InstaPay {order.deposit_reference}".strip()[:120],
                })
            if plan["balance"] > ZERO:
                if balance_method not in BALANCE_METHODS:
                    raise ShopError("BALANCE_METHOD_REQUIRED", "Choose how the balance was paid.")
                payments.append({
                    "method": balance_method, "amount": plan["balance"],
                    "reference": balance_reference.strip()[:120],
                })
            storage = catalog.fulfilment_storage()
            checkout = OrderCreateSerializer(
                data={
                    "client_uuid": str(order.public_id),
                    "customer": _customer_for(order).pk,
                    "storage": storage.pk if storage else None,
                    "items": [
                        {"product": l["product"], "quantity": str(l["quantity"]), "discount": str(l["discount"])}
                        for l in plan["lines"]
                    ],
                    "payments": [{**p, "amount": str(p["amount"])} for p in payments],
                    "note": f"Web order {order.code}",
                    "terminal": getattr(django_settings, "SHOP_TERMINAL", ""),
                },
                context={"request": request},
            )
            try:
                checkout.is_valid(raise_exception=True)
                sale = checkout.save()
            except drf_serializers.ValidationError as exc:
                # Leaving the transaction with this error undoes everything,
                # the customer row included.
                raise _checkout_error(exc, bool(override_pin)) from None

        deposit_applied = min(order.deposit_paid, sale.total)
        balance = sale.total - deposit_applied
        # A deposit larger than the goods first covers the delivery fee;
        # anything beyond that goes back to the customer.
        fee_covered = min(order.deposit_paid - deposit_applied, order.delivery_fee)
        overpaid = order.deposit_paid - deposit_applied - fee_covered

        order.status = Status.COMPLETED
        order.completed_at = timezone.now()
        order.completed_by = request.user
        order.sale = sale
        order.balance_method = balance_method if balance > ZERO else ""
        if overpaid > ZERO:
            order.refund_status = WebOrder.Refund.DUE
            order.refund_amount = overpaid
        order.save()
        log_event(
            order, Kind.COMPLETED, actor=request.user.username, public=True,
            data={
                "receipt": sale.receipt_number or "",
                "sale_total": str(sale.total),
                "deposit_applied": str(deposit_applied),
                "balance": str(balance),
                "balance_method": order.balance_method,
                "price_mode": price_mode or "",
                "overpaid": str(overpaid),
            },
        )
    return order
