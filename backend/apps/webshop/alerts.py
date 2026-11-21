"""WhatsApp alerts the server sends the shop about website orders.

They go to the number in the website settings (the store's own WhatsApp
number unless another one is set):

* every order, the moment it is placed: a pickup is accepted at once, a
  delivery waits for its deposit;
* a delivery again when the customer reports the deposit, with the transfer
  screenshot attached when they sent one.

They go out one of two ways:

* through Meta's WhatsApp Cloud API when it is set up (apps.whatsapp.cloud),
  straight from this server, so they arrive even when every PC at the shop
  is off. Meta delivers them only as templates it has approved: TEMPLATES
  below, created with ``python manage.py whatsapp_cloud templates``;
* otherwise from the WhatsApp account paired with the whatsapp-service
  sidecar, as the plain text of ``order_message``.

Sending waits until the order is saved and then runs on a thread of its own,
so WhatsApp being slow or down never holds up or fails the customer's order.
Every attempt is logged as a WhatsAppMessage, sent or failed.
"""
import base64
import logging
import re
import threading
import time
from decimal import Decimal

from django.db import connections, transaction

from apps.whatsapp import cloud
from apps.whatsapp.client import WhatsAppError, send_message
from apps.whatsapp.models import WhatsAppMessage

from . import phones
from .models import DepositProof, ShopSettings, WebOrder

log = logging.getLogger(__name__)

PLACED = "PLACED"    # any order, the moment it was placed
DEPOSIT = "DEPOSIT"  # a delivery whose customer says the deposit is sent

# Seconds to wait before each new try while Meta is busy or briefly down.
RETRY_WAITS = (3, 15)


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
    elif pickup:
        title = f"طلب استلام جديد من الموقع: {order.code}"
    else:
        title = f"طلب توصيل جديد من الموقع: {order.code}"
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
    elif pickup:
        lines.append(f"المطلوب عند الاستلام: {_money(order.balance_due)}")
        lines += ["", "الطلب مقبول تلقائياً. جهّزه من «طلبات الموقع» في برنامج الكاشير."]
    else:
        lines.append(f"العربون المطلوب: {_money(order.deposit_required)}")
        lines += ["", "في انتظار تحويل العربون، فلا تجهّزه بعد. ستصلك رسالة أخرى عندما يبلّغ العميل بالتحويل."]
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
    proof = DepositProof.objects.filter(order_id=order_id).first() if kind == DEPOSIT else None
    text = order_message(order, kind)
    entry = WhatsAppMessage.objects.create(to_number=number, body=text, status=WhatsAppMessage.Status.QUEUED)
    try:
        if cloud.configured():
            # The template as filled in; on a sent alert, error says what was left out.
            entry.body, entry.error = _send_cloud(number, order, kind, proof)
        else:
            _send_sidecar(number, order, text, proof)
        entry.status = WhatsAppMessage.Status.SENT
    except WhatsAppError as exc:
        entry.status = WhatsAppMessage.Status.FAILED
        entry.error = str(exc)[:2000]
        log.warning("WhatsApp alert for %s was not sent: %s", order.code, exc)
    entry.save(update_fields=["body", "status", "error"])
    return entry


def _send_sidecar(number: str, order: WebOrder, text: str, proof: DepositProof | None) -> None:
    send_message(number, text)
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


def _send_cloud(number: str, order: WebOrder, kind: str, proof: DepositProof | None) -> tuple[str, str]:
    """Send the alert as its template. Returns the text that went out, and
    what was left out of it: "" when nothing, or the screenshot when its
    template could not carry it."""

    def send(name: str, image_id: str = "") -> str:
        values = template_values(name, order)
        _retrying(lambda: cloud.send_template(number, name, values, language=LANGUAGE, image_id=image_id))
        return _filled(name, values)

    if kind != DEPOSIT:
        pickup = order.fulfilment == WebOrder.Fulfilment.PICKUP
        return send(PICKUP_TEMPLATE if pickup else DELIVERY_TEMPLATE), ""
    if proof is None:
        return send(DEPOSIT_TEMPLATE), ""
    try:
        image = _retrying(lambda: cloud.upload_media(bytes(proof.data), proof.content_type, f"{order.code}.jpg"))
        return send(DEPOSIT_PHOTO_TEMPLATE, image_id=image), ""
    except cloud.CloudError as exc:
        # Better without the picture than not at all.
        log.warning("Deposit alert for %s goes without its screenshot: %s", order.code, exc)
        return send(DEPOSIT_TEMPLATE), f"Sent without the transfer screenshot: {exc}"[:2000]


def _retrying(call):
    """``call()``, tried again while Meta is busy or briefly unreachable."""
    for wait in (*RETRY_WAITS, None):
        try:
            return call()
        except cloud.CloudError as exc:
            if not exc.transient or wait is None:
                raise
            log.info("WhatsApp Cloud API did not take it (%s); trying again in %s s", exc, wait)
            time.sleep(wait)


# --- The Cloud API's templates --------------------------------------------------
#
# The alerts as Meta has approved them, with {{1}}, {{2}}... filled in from the
# order. Meta's rules: a value is one line (no line breaks, tabs or more than
# four spaces in a row) and never empty; a template neither starts nor ends
# with a value and has about three fixed words per value; the filled-in text
# stays within 1024 characters. `whatsapp_cloud templates` creates missing
# templates but never changes one Meta already has: new wording here needs the
# same edit in WhatsApp Manager (Meta reviews it again), or a new name.
#
# The deposit alert carries only what checking the transfer needs; the first
# alert had the address and the items.

LANGUAGE = "ar"
PICKUP_TEMPLATE = "fk_web_order_pickup"
DELIVERY_TEMPLATE = "fk_web_order_delivery"
DEPOSIT_TEMPLATE = "fk_web_order_deposit"
DEPOSIT_PHOTO_TEMPLATE = "fk_web_order_deposit_photo"  # the same, under the transfer screenshot
# Without these an alert cannot go out; without the photo one, the deposit
# alert goes as text.
REQUIRED_TEMPLATES = (PICKUP_TEMPLATE, DELIVERY_TEMPLATE, DEPOSIT_TEMPLATE)
BODY_LIMIT = 1024

_DEPOSIT_BODY = (
    "عربون للمراجعة: طلب {{1}}\n\n"
    "الاسم: {{2}}\n"
    "الموبايل: {{3}}\n"
    "إجمالي الطلب: {{4}}\n"
    "العربون المطلوب: {{5}}\n"
    "الرقم المرجعي للتحويل: {{6}}\n"
    "اسم المحوِّل: {{7}}\n\n"
    "راجع التحويل في إنستا باي، ثم أكّده من «طلبات الموقع» في برنامج الكاشير."
)

TEMPLATES = {
    PICKUP_TEMPLATE: (
        "طلب استلام جديد من الموقع: {{1}}\n\n"
        "الاسم: {{2}}\n"
        "الموبايل: {{3}}\n"
        "ملاحظات العميل: {{4}}\n\n"
        "الأصناف المطلوبة: {{5}}\n\n"
        "الإجمالي: {{6}}\n"
        "المطلوب عند الاستلام: {{7}}\n\n"
        "الطلب مقبول تلقائياً. جهّزه من «طلبات الموقع» في برنامج الكاشير."
    ),
    DELIVERY_TEMPLATE: (
        "طلب توصيل جديد من الموقع: {{1}}\n\n"
        "الاسم: {{2}}\n"
        "الموبايل: {{3}}\n"
        "توصيل إلى: {{4}}\n"
        "ملاحظات العميل: {{5}}\n\n"
        "الأصناف المطلوبة: {{6}}\n\n"
        "التوصيل: {{7}}\n"
        "الإجمالي شامل التوصيل: {{8}}\n"
        "العربون المطلوب: {{9}}\n\n"
        "في انتظار تحويل العربون، فلا تجهّزه بعد. ستصلك رسالة أخرى عندما يبلّغ العميل بالتحويل."
    ),
    DEPOSIT_TEMPLATE: _DEPOSIT_BODY,
    DEPOSIT_PHOTO_TEMPLATE: _DEPOSIT_BODY,
}

# What Meta's reviewers see filled in.
_EXAMPLE_HEAD = ["FK-7KQ2MX", "منى علي", "+201012345678"]
_EXAMPLE_ITEMS = "• عسل سدر 500 جم × 2 = 500.00 ج.م • زيتون × 0.5 كجم = 22.50 ج.م"
_EXAMPLE_DEPOSIT = [*_EXAMPLE_HEAD, "552.50 ج.م", "276.25 ج.م", "123456789012", "منى علي"]
TEMPLATE_EXAMPLES = {
    PICKUP_TEMPLATE: [*_EXAMPLE_HEAD, "بعد الساعة 5 مساءً", _EXAMPLE_ITEMS, "522.50 ج.م", "522.50 ج.م"],
    DELIVERY_TEMPLATE: [
        *_EXAMPLE_HEAD, "12 شارع النيل، المعادي", "الدور الثالث", _EXAMPLE_ITEMS,
        "30.00 ج.م", "552.50 ج.م", "276.25 ج.م",
    ],
    DEPOSIT_TEMPLATE: _EXAMPLE_DEPOSIT,
    DEPOSIT_PHOTO_TEMPLATE: _EXAMPLE_DEPOSIT,
}


def template_definition(name: str, image_handle: str = "") -> dict:
    """The template as Meta's API takes it for review. The photo one needs a
    sample picture, uploaded first (``cloud.upload_example``)."""
    components = []
    if name == DEPOSIT_PHOTO_TEMPLATE:
        components.append({"type": "HEADER", "format": "IMAGE", "example": {"header_handle": [image_handle]}})
    components.append({"type": "BODY", "text": TEMPLATES[name], "example": {"body_text": [TEMPLATE_EXAMPLES[name]]}})
    return {"name": name, "language": LANGUAGE, "category": "UTILITY", "components": components}


def _one_line(value, limit: int = 200) -> str:
    """A value as a template takes it: one line, never empty, cut at ``limit``."""
    text = re.sub(r"\s+", " ", str(value or "")).strip() or "—"
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _more_items(count: int) -> str:
    if count == 1:
        return "وصنف آخر"
    if count == 2:
        return "وصنفان آخران"
    return f"و{count} أصناف أخرى" if count <= 10 else f"و{count} صنفاً آخر"


def _items(order: WebOrder, room: int) -> str:
    """The order's lines on one line, as many as fit in ``room`` characters."""
    lines = [
        f"• {_one_line(item.name, 80)} × {_quantity(item)} = {_money(item.line_total)}"
        for item in order.items.all()
    ]
    for shown in range(len(lines), 0, -1):
        text = " ".join(lines[:shown])
        if shown < len(lines):
            text += f" • {_more_items(len(lines) - shown)}"
        if len(text) <= room:
            return text
    return _one_line(f"{len(lines)} أصناف")


def _filled(name: str, values: list[str]) -> str:
    text = TEMPLATES[name]
    for i, value in enumerate(values, 1):
        text = text.replace(f"{{{{{i}}}}}", value)
    return text


def template_values(name: str, order: WebOrder) -> list[str]:
    """The values for template ``name``'s {{1}}, {{2}}... from the order."""
    values = [_one_line(order.code), _one_line(order.customer_name), f"+{phones.whatsapp_digits(order.phone)}"]
    if name in (DEPOSIT_TEMPLATE, DEPOSIT_PHOTO_TEMPLATE):
        return values + [
            _money(order.total), _money(order.deposit_required),
            _one_line(order.deposit_reference), _one_line(order.deposit_sender),
        ]
    if name == PICKUP_TEMPLATE:
        values += [_one_line(order.notes), "", _money(order.total), _money(order.balance_due)]
    else:
        fee = _money(order.delivery_fee) if order.delivery_fee > 0 else "مجاناً"
        values += [
            _one_line(order.address), _one_line(order.notes), "", fee,
            _money(order.total), _money(order.deposit_required),
        ]
    at = values.index("")
    values[at] = _items(order, room=BODY_LIMIT - len(_filled(name, values)))
    return values
