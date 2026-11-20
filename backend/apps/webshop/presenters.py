"""The JSON the website's API sends. Money and quantities travel as strings
("12.50", "0.250") so nothing is lost to floating point in the browser.

Picture and video addresses are paths on this server ("/api/...", "/media/...");
the web apps prefix them with the server's public address.
"""
from decimal import Decimal

from django.conf import settings as django_settings
from django.urls import reverse
from django.utils import timezone

from apps.products.models import ProductImage

from . import catalog, phones, pricing, prizes
from .models import (
    DepositProof, EventMedia, GamePrize, HealthySwap, Listing, ShopEvent, ShopSettings, ShopVideo, StoredImage,
    WebOrder,
)

MONEY = Decimal("0.01")
QTY = Decimal("0.001")

BRAND = {"name": "Fathet Kheer", "name_ar": "فاتحة خير"}


def m(value) -> str | None:
    return None if value is None else str(Decimal(value).quantize(MONEY))


def q(value) -> str:
    return str(Decimal(value).quantize(QTY))


def iso(value) -> str | None:
    return value.isoformat() if value else None


def image_urls(product_id: int, version: str) -> tuple[str | None, str | None]:
    """(full, thumbnail) addresses of a product photo, using the cashier's own
    public photo endpoint. The version makes them cacheable for good."""
    if not version:
        return None, None
    base = f"{reverse('product-image', args=[product_id])}?v={version}"
    return base, f"{base}&size=thumb"


def image_versions(product_ids) -> dict[int, str]:
    ids = list(product_ids)
    if not ids:
        return {}
    rows = ProductImage.objects.filter(product_id__in=ids).values_list("product_id", "checksum")
    return {product_id: (checksum or "")[:16] for product_id, checksum in rows}


def site_url() -> str:
    """Where customers reach the storefront, for links staff send out."""
    return getattr(django_settings, "SHOP_SITE_URL", "").rstrip("/")


def _user(user) -> str:
    return user.username if user else ""


# --- Storefront -------------------------------------------------------------


def video_json(video: ShopVideo) -> dict:
    return {
        "id": video.pk,
        "placement": video.placement,
        "title": video.title,
        "caption": video.caption,
        "src": video.file.url,
        "poster": video.poster.url if video.poster else None,
        "content_type": video.content_type,
        "duration": video.duration,
        "width": video.width,
        "height": video.height,
        "product_id": video.product_id,
    }


def _fulfilment_state(settings: ShopSettings, fulfilment: str) -> dict:
    offered = settings.delivery_enabled if fulfilment == WebOrder.Fulfilment.DELIVERY else settings.pickup_enabled
    if not settings.ordering_enabled:
        return {"enabled": False, "reason": "DISABLED"}
    if not offered:
        return {"enabled": False, "reason": "FULFILMENT_UNAVAILABLE"}
    if pricing.takes_deposit(fulfilment) and not settings.instapay_ready:
        return {"enabled": False, "reason": "INSTAPAY_NOT_CONFIGURED"}
    return {"enabled": True, "reason": ""}


def ordering_state(settings: ShopSettings) -> dict:
    """Whether the site takes orders, for each way of getting them. Delivery
    waits for InstaPay; pickup needs no payment details, so it can be open
    while delivery is not. The top level says whether either one is."""
    delivery = _fulfilment_state(settings, WebOrder.Fulfilment.DELIVERY)
    pickup = _fulfilment_state(settings, WebOrder.Fulfilment.PICKUP)
    if not settings.ordering_enabled:
        overall = {"enabled": False, "reason": "DISABLED"}
    elif delivery["enabled"] or pickup["enabled"]:
        overall = {"enabled": True, "reason": ""}
    else:
        overall = {"enabled": False, "reason": "INSTAPAY_NOT_CONFIGURED"}
    return {**overall, "delivery": delivery, "pickup": pickup}


def config_json(settings: ShopSettings) -> dict:
    videos = list(ShopVideo.objects.filter(is_active=True))
    hero = next((v for v in videos if v.placement == ShopVideo.Placement.HERO), None)
    return {
        "brand": BRAND,
        "currency": "EGP",
        "whatsapp": settings.whatsapp,
        "ordering": ordering_state(settings),
        "fulfilment": {
            "delivery": settings.delivery_enabled,
            "pickup": settings.pickup_enabled,
            "delivery_fee": m(settings.delivery_fee),
            "free_delivery_over": m(settings.free_delivery_over),
            "note": {"ar": settings.delivery_note_ar, "en": settings.delivery_note_en},
        },
        "deposit": {"percent": settings.deposit_percent, "min": m(settings.deposit_min)},
        "min_order": m(settings.min_order),
        "hold_minutes": settings.hold_minutes,
        "limits": {
            "weight_step": q(pricing.WEIGHT_STEP),
            "max_line_qty": q(pricing.MAX_LINE_QTY),
            "max_lines": pricing.MAX_LINES,
        },
        "store": {
            "address": {"ar": settings.address_ar, "en": settings.address_en},
            "hours": {"ar": settings.hours_ar, "en": settings.hours_en},
        },
        "announcement": {"ar": settings.announcement_ar, "en": settings.announcement_en},
        "videos": {
            "hero": video_json(hero) if hero else None,
            "stories": [video_json(v) for v in videos if v.placement == ShopVideo.Placement.STORY],
        },
        "swaps": swaps_json(),
        "games": games_json(settings),
    }


def games_json(settings: ShopSettings) -> dict:
    """The games the website shows, and, while prizes are on, what a winning
    score earns and the score that wins in each game."""
    terms = None
    if settings.prizes_enabled:
        terms = {
            "percent": settings.prize_percent,
            "max": m(settings.prize_max),
            "min_order": m(settings.prize_min_order),
            "days": prizes.PRIZE_DAYS,
            "to_win": {game: prizes.to_win(settings, game) for game in prizes.GAMES},
        }
    return {"on": prizes.games_on(settings), "prizes": terms}


def prize_json(prize: GamePrize) -> dict:
    """A prize, for the customer who won it."""
    return {
        "code": prize.code,
        "game": prize.game,
        "phone": phones.mask_phone(prize.phone),
        "percent": prize.percent,
        "max": m(prize.max_discount),
        "min_order": m(prize.min_order),
        "expires_at": iso(prize.expires_at),
    }


# --- Health: nutrition facts and healthy swaps ----------------------------------


def _n(value) -> str | None:
    return None if value is None else format(Decimal(value).quantize(Decimal("0.1")).normalize(), "f")


def nutrition_json(listing: Listing | None) -> dict | None:
    """Per 100 g (or 100 ml), as on the label. None until calories are in."""
    if listing is None or not listing.has_nutrition:
        return None
    data = {name: _n(getattr(listing, name)) for name in Listing.NUTRIENTS}
    data["piece_grams"] = _n(listing.piece_grams)
    return data


def swaps_json() -> list[dict]:
    """Active swaps, each with the products the website can show: hidden and
    inactive ones are left out here, sold-out ones by the site itself."""
    hidden = pricing.hidden_product_ids()
    out = []
    for swap in HealthySwap.objects.filter(is_active=True).prefetch_related("products"):
        out.append({
            "id": swap.pk,
            "craving": swap.craving,
            "emoji": swap.emoji,
            "reason": swap.reason,
            "product_ids": [p.pk for p in swap.products.all() if p.is_active and p.pk not in hidden],
        })
    return out


# --- Events --------------------------------------------------------------------


def event_media_json(item: EventMedia) -> dict:
    return {
        "id": item.pk,
        "kind": item.kind,
        "src": item.file.url,
        "poster": item.poster.url if item.poster else None,
        "content_type": item.content_type,
        "width": item.width,
        "height": item.height,
        "duration": item.duration,
    }


def event_json(event: ShopEvent) -> dict:
    media = [event_media_json(m) for m in event.media.all()]
    # The cover: the first photo, else the first video's still frame.
    cover = next((m["src"] for m in media if m["kind"] == EventMedia.Kind.PHOTO), None) or next(
        (m["poster"] for m in media if m["poster"]), None
    )
    return {
        "id": event.pk,
        "title": event.title,
        "description": event.description,
        "starts_at": iso(event.starts_at),
        "ends_at": iso(event.ends_at),
        "place": event.place,
        "cover": cover,
        "media": media,
    }


def admin_event_json(event: ShopEvent) -> dict:
    data = event_json(event)
    data.update({
        "is_published": event.is_published,
        "created_by": _user(event.created_by),
        "created_at": iso(event.created_at),
        "media": [
            {**event_media_json(m), "size": m.size, "sort": m.sort} for m in event.media.all()
        ],
    })
    return data


def admin_swap_json(swap: HealthySwap, versions: dict[int, str] | None = None) -> dict:
    products = list(swap.products.all())
    versions = versions if versions is not None else image_versions(p.pk for p in products)
    return {
        "id": swap.pk,
        "craving": swap.craving,
        "emoji": swap.emoji,
        "reason": swap.reason,
        "sort": swap.sort,
        "is_active": swap.is_active,
        "products": [
            {"id": p.pk, "name": p.name, "is_active": p.is_active, "thumb": image_urls(p.pk, versions.get(p.pk, ""))[1]}
            for p in products
        ],
    }


def catalog_json() -> dict:
    categories, products = catalog.load_catalog()
    listings = {l.product_id: l for l in Listing.objects.all()}
    reserved = pricing.reserved_quantities()
    out, counts = [], {}
    for info in products:
        listing = listings.get(info.id)
        if listing and listing.hidden:
            continue
        orderable = pricing.orderable_quantity(info, reserved.get(info.id, pricing.ZERO))
        image, thumb = image_urls(info.id, info.image_version)
        out.append({
            "id": info.id,
            "name": info.name,
            "category": info.category_id,
            "price": m(info.price),
            "unit": info.unit,
            "sold_by": info.sold_by,
            "max_qty": q(orderable),
            "low_stock": pricing.is_low_stock(orderable),
            "image": image,
            "thumb": thumb,
            "featured": bool(listing and listing.featured),
            "badge": listing.badge if listing else "",
            "description": listing.description if listing else "",
            "nutrition": nutrition_json(listing),
        })
        if info.category_id:
            counts[info.category_id] = counts.get(info.category_id, 0) + 1
    return {
        "categories": [
            {"id": c.id, "name": c.name, "count": counts[c.id]} for c in categories if counts.get(c.id)
        ],
        "products": out,
        "generated_at": iso(timezone.now()),
    }


def quote_json(quote: pricing.Quote) -> dict:
    return {
        "ok": quote.ok,
        "problems": quote.problems,
        "fulfilment": quote.fulfilment,
        "lines": [
            {
                "id": line.product_id,
                "name": line.name,
                "unit": line.unit,
                "sold_by": line.sold_by,
                "unit_price": m(line.unit_price),
                "qty": q(line.quantity),
                "line_total": m(line.line_total),
                "max_qty": q(line.max_quantity),
                "issue": line.issue,
            }
            for line in quote.lines
        ],
        "subtotal": m(quote.subtotal),
        "discount": m(quote.discount),
        "prize_code": quote.prize_code,
        "delivery_fee": m(quote.delivery_fee),
        "total": m(quote.total),
        "deposit": m(quote.deposit),
        "balance": m(quote.balance),
    }


def instapay_json(settings: ShopSettings) -> dict:
    qr = StoredImage.objects.filter(key=StoredImage.INSTAPAY_QR).values_list("checksum", flat=True).first()
    return {
        "address": settings.instapay_address,
        "name": settings.instapay_name,
        "mobile": settings.instapay_mobile,
        "link": settings.instapay_link,
        "qr_image": f"{reverse('webshop-instapay-qr')}?v={qr[:16]}" if qr else None,
    }


def _items_json(order: WebOrder) -> list[dict]:
    items = list(order.items.all())
    versions = image_versions(item.product_id for item in items)
    out = []
    for item in items:
        _, thumb = image_urls(item.product_id, versions.get(item.product_id, ""))
        out.append({
            "product_id": item.product_id,
            "name": item.name,
            "unit": item.unit,
            "sold_by": item.sold_by,
            "unit_price": m(item.unit_price),
            "qty": q(item.quantity),
            "line_total": m(item.line_total),
            "thumb": thumb,
        })
    return out


def _has_proof(order: WebOrder) -> bool:
    return DepositProof.objects.filter(order_id=order.pk).exists()


def public_order_json(order: WebOrder, *, with_token: bool = False) -> dict:
    """What the customer sees on the tracking page."""
    from . import services  # late: services imports this module

    settings = ShopSettings.load()
    awaiting = order.status in (WebOrder.Status.AWAITING_DEPOSIT, WebOrder.Status.EXPIRED)
    sale = order.sale
    data = {
        "code": order.code,
        "status": order.status,
        "fulfilment": order.fulfilment,
        "language": order.language,
        "customer_name": order.customer_name,
        "phone": phones.mask_phone(order.phone),
        "address": order.address,
        "notes": order.notes,
        "created_at": iso(order.created_at),
        "expires_at": iso(order.expires_at) if order.status == WebOrder.Status.AWAITING_DEPOSIT else None,
        "server_time": iso(timezone.now()),
        "items": _items_json(order),
        "subtotal": m(order.subtotal),
        "discount": m(order.discount),
        "prize_code": order.prize_code,
        "delivery_fee": m(order.delivery_fee),
        "total": m(order.total),
        "deposit_required": m(order.deposit_required),
        "deposit_paid": m(order.deposit_paid),
        "balance_due": m(order.balance_due),
        "deposit": {
            "reference": order.deposit_reference,
            "sender": order.deposit_sender,
            "submitted_at": iso(order.deposit_submitted_at),
            "confirmed_at": iso(order.deposit_confirmed_at),
            "reject_reason": order.deposit_reject_reason,
            "has_proof": _has_proof(order),
        },
        "payment": instapay_json(settings) if awaiting else None,
        "timeline": [
            {"kind": e.kind, "at": iso(e.created_at), "message": e.message, "to": e.data.get("to", "")}
            for e in order.events.all() if e.public
        ],
        "cancel_reason": order.cancel_reason,
        "can_cancel": services.customer_can_cancel(order),
        "refund": {"status": order.refund_status, "amount": m(order.refund_amount)},
        "receipt_number": sale.receipt_number if sale else "",
        "final_total": m(sale.total + order.delivery_fee) if sale else None,
        "whatsapp": settings.whatsapp,
    }
    if with_token:
        data["token"] = order.access_token
    return data


# --- Orders admin -----------------------------------------------------------


def _plain_qty(quantity: Decimal) -> str:
    """'2' rather than '2.000', '0.25' rather than '0.250'."""
    return format(quantity.normalize(), "f")


def admin_order_json(order: WebOrder, *, detail: bool = False) -> dict:
    items = list(order.items.all())
    sale = order.sale
    data = {
        "id": order.pk,
        "code": order.code,
        "status": order.status,
        "fulfilment": order.fulfilment,
        "language": order.language,
        "customer_name": order.customer_name,
        "phone": order.phone,
        "whatsapp": phones.whatsapp_digits(order.phone),
        "address": order.address,
        "notes": order.notes,
        "created_at": iso(order.created_at),
        "updated_at": iso(order.updated_at),
        "expires_at": iso(order.expires_at) if order.status == WebOrder.Status.AWAITING_DEPOSIT else None,
        "subtotal": m(order.subtotal),
        "discount": m(order.discount),
        "prize_code": order.prize_code,
        "delivery_fee": m(order.delivery_fee),
        "total": m(order.total),
        "deposit_required": m(order.deposit_required),
        "deposit_paid": m(order.deposit_paid),
        "balance_due": m(order.balance_due),
        "items_count": len(items),
        "items_summary": [f"{_plain_qty(i.quantity)} × {i.name}" for i in items[:4]],
        "deposit": {
            "reference": order.deposit_reference,
            "sender": order.deposit_sender,
            "submitted_at": iso(order.deposit_submitted_at),
            "confirmed_at": iso(order.deposit_confirmed_at),
            "confirmed_by": _user(order.deposit_confirmed_by),
            "reject_reason": order.deposit_reject_reason,
        },
        "refund": {
            "status": order.refund_status,
            "amount": m(order.refund_amount),
            "reference": order.refund_reference,
            "at": iso(order.refunded_at),
            "by": _user(order.refunded_by),
        },
        "pos": {
            "order_id": sale.pk if sale else None,
            "receipt_number": (sale.receipt_number or "") if sale else "",
            "total": m(sale.total) if sale else None,
            "balance_method": order.balance_method,
            "completed_by": _user(order.completed_by),
            "completed_at": iso(order.completed_at),
        },
        "cancel": {"reason": order.cancel_reason, "by": order.cancelled_by, "at": iso(order.cancelled_at)},
    }
    if not detail:
        return data

    from . import services  # late: services imports this module

    data["items"] = _items_json(order)
    data["deposit"]["has_proof"] = _has_proof(order)
    data["tracking_url"] = f"{site_url()}/order/{order.code}?t={order.access_token}"
    data["events"] = [
        {
            "id": e.pk, "kind": e.kind, "actor": e.actor, "public": e.public,
            "message": e.message, "data": e.data, "at": iso(e.created_at),
        }
        for e in order.events.all()
    ]
    # Worth working out only while the goods are still owed (an expired
    # order can be revived by a late deposit, so it counts).
    still_owed = order.status in WebOrder.ACTIVE or order.status == WebOrder.Status.EXPIRED
    data["shortages"] = services.shortages(order) if still_owed else []
    data["duplicate_reference"] = (
        list(
            WebOrder.objects.filter(deposit_reference__iexact=order.deposit_reference)
            .exclude(pk=order.pk).values_list("code", flat=True)[:5]
        )
        if order.deposit_reference else []
    )
    earlier = WebOrder.objects.filter(phone=order.phone).exclude(pk=order.pk)
    data["history"] = {
        "orders": earlier.count(),
        "completed": earlier.filter(status=WebOrder.Status.COMPLETED).count(),
        "cancelled": earlier.filter(status__in=[WebOrder.Status.CANCELLED, WebOrder.Status.EXPIRED]).count(),
    }
    return data


def settings_json(settings: ShopSettings) -> dict:
    return {
        "ordering_enabled": settings.ordering_enabled,
        "instapay_address": settings.instapay_address,
        "instapay_name": settings.instapay_name,
        "instapay_mobile": settings.instapay_mobile,
        "instapay_link": settings.instapay_link,
        "instapay_qr_image": instapay_json(settings)["qr_image"],
        "instapay_ready": settings.instapay_ready,
        "deposit_percent": settings.deposit_percent,
        "deposit_min": m(settings.deposit_min),
        "hold_minutes": settings.hold_minutes,
        "delivery_enabled": settings.delivery_enabled,
        "pickup_enabled": settings.pickup_enabled,
        "delivery_fee": m(settings.delivery_fee),
        "free_delivery_over": m(settings.free_delivery_over),
        "min_order": m(settings.min_order),
        "whatsapp": settings.whatsapp,
        "whatsapp_alerts": settings.whatsapp_alerts,
        "alert_whatsapp": settings.alert_whatsapp,
        "address_ar": settings.address_ar,
        "address_en": settings.address_en,
        "hours_ar": settings.hours_ar,
        "hours_en": settings.hours_en,
        "delivery_note_ar": settings.delivery_note_ar,
        "delivery_note_en": settings.delivery_note_en,
        "announcement_ar": settings.announcement_ar,
        "announcement_en": settings.announcement_en,
        "push_ups_on": settings.push_ups_on,
        "memory_on": settings.memory_on,
        "calorie_challenge_on": settings.calorie_challenge_on,
        "hungry_bee_on": settings.hungry_bee_on,
        "prizes_enabled": settings.prizes_enabled,
        "prize_percent": settings.prize_percent,
        "prize_max": m(settings.prize_max),
        "prize_min_order": m(settings.prize_min_order),
        "push_ups_to_win": settings.push_ups_to_win,
        "memory_stars_to_win": settings.memory_stars_to_win,
        "quiz_to_win": settings.quiz_to_win,
        "hungry_bee_to_win": settings.hungry_bee_to_win,
        "updated_at": iso(settings.updated_at),
        "updated_by": _user(settings.updated_by),
    }


def admin_video_json(video: ShopVideo) -> dict:
    data = video_json(video)
    data.update({
        "is_active": video.is_active,
        "sort": video.sort,
        "size": video.size,
        "created_at": iso(video.created_at),
        "created_by": _user(video.created_by),
    })
    return data
