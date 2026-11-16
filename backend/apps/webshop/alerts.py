"""WhatsApp alerts the server sends the shop when a website order needs it.

They go out from the WhatsApp account paired with the whatsapp-service
sidecar, to the number in the website settings (the store's own WhatsApp
number unless another one is set):

* a pickup, the moment it is placed (it is accepted at once);
* a delivery, the moment the customer reports the deposit, with the transfer
  screenshot attached when they sent one.

Sending waits until the order is saved and then runs on a thread of its own,
so WhatsApp being slow or down never holds up or fails the customer's order.
Every attempt is logged as a WhatsAppMessage, sent or failed.
"""
import base64
import logging
import re
import threading
from decimal import Decimal

from django.db import connections, transaction

from apps.whatsapp.client import WhatsAppError, send_message
from apps.whatsapp.models import WhatsAppMessage

from . import phones
from .models import DepositProof, ShopSettings, WebOrder

log = logging.getLogger(__name__)

PLACED = "PLACED"    # a pickup, accepted the moment it was placed
DEPOSIT = "DEPOSIT"  # a delivery whose customer says the deposit is sent


def alert_number(settings: ShopSettings) -> str:
    """Where alerts go, as WhatsApp wants it (digits, country code first);
    "" when there is nowhere to send them."""
    raw = settings.alert_whatsapp or settings.whatsapp
    if not raw:
        return ""
    try:
        return phones.whatsapp_digits(phones.normalize_phone(raw))
    except phones.InvalidPhone:
        return re.sub(r"\D", "", raw)


def _money(value) -> str:
    return f"{Decimal(value):.2f} ج.م"


def _quantity(item) -> str:
    plain = format(item.quantity.normalize(), "f")
    return f"{plain} {item.unit}" if item.sold_by == "WEIGHT" else plain


def order_message(order: WebOrder, kind: str) -> str:
    """The order as staff need it, in Arabic: who, what, and what to do."""
    pickup = order.fulfilment == WebOrder.Fulfilment.PICKUP
    if kind == DEPOSIT:
        title = f"عربون للمراجعة: طلب {order.code}"
    else:
        title = f"طلب استلام جديد من الموقع: {order.code}"
    lines = [
        title,
        "",
        f"الاسم: {order.customer_name}",
        # International form, so WhatsApp makes it a tap-to-chat link.
        f"الموبايل: +{phones.whatsapp_digits(order.phone)}",
        "استلام من المحل" if pickup else f"توصيل إلى: {order.address}",
    ]
    if order.notes:
        lines.append(f"ملاحظات: {order.notes}")
    lines.append("")
    for item in order.items.all():
        lines.append(f"• {item.name} × {_quantity(item)} = {_money(item.line_total)}")
    lines.append("")
    if order.delivery_fee > 0:
        lines.append(f"التوصيل: {_money(order.delivery_fee)}")
    lines.append(f"الإجمالي: {_money(order.total)}")
    if kind == DEPOSIT:
        lines.append(f"العربون المطلوب: {_money(order.deposit_required)}")
        if order.deposit_reference:
            lines.append(f"الرقم المرجعي: {order.deposit_reference}")
        if order.deposit_sender:
            lines.append(f"المحوِّل: {order.deposit_sender}")
        lines += ["", "راجع التحويل في إنستا باي، ثم أكّده من «طلبات الموقع» في برنامج الكاشير."]
    else:
        lines.append(f"المطلوب عند الاستلام: {_money(order.balance_due)}")
        lines += ["", "الطلب مقبول تلقائياً. جهّزه من «طلبات الموقع» في برنامج الكاشير."]
    return "\n".join(lines)


def alert_shop(order: WebOrder, kind: str) -> None:
    """Send the alert once the current transaction is saved. Call it from
    inside the transaction that changes the order."""
    settings = ShopSettings.load()
    if not settings.whatsapp_alerts or not alert_number(settings):
        return
    order_id = order.pk
    transaction.on_commit(lambda: in_background(send_alert, order_id, kind))


def in_background(fn, *args) -> None:
    """Run off the request. The thread's own database connection is closed
    when it is done."""

    def run():
        try:
            fn(*args)
        except Exception:
            log.exception("WhatsApp alert crashed")
        finally:
            connections.close_all()

    threading.Thread(target=run, daemon=True, name="webshop-whatsapp-alert").start()


def send_alert(order_id: int, kind: str) -> WhatsAppMessage:
    number = alert_number(ShopSettings.load())
    order = WebOrder.objects.prefetch_related("items").get(pk=order_id)
    text = order_message(order, kind)
    entry = WhatsAppMessage.objects.create(to_number=number, body=text, status=WhatsAppMessage.Status.QUEUED)
    try:
        send_message(number, text)
        proof = DepositProof.objects.filter(order_id=order_id).first() if kind == DEPOSIT else None
        if proof is not None:
            send_message(
                number,
                f"صورة التحويل: {order.code}",
                media={
                    "mimetype": proof.content_type,
                    "data": base64.b64encode(bytes(proof.data)).decode("ascii"),
                    "filename": f"{order.code}.jpg",
                },
            )
        entry.status = WhatsAppMessage.Status.SENT
    except WhatsAppError as exc:
        entry.status = WhatsAppMessage.Status.FAILED
        entry.error = str(exc)[:2000]
        log.warning("WhatsApp alert for %s was not sent: %s", order.code, exc)
    entry.save(update_fields=["status", "error"])
    return entry
