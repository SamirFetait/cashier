"""The orders admin's API (the app at orders.fatheetkheer.com).

Staff sign in with their cashier account through the usual /api/auth/login/
and send its token. Any staff member works the orders; settings, the website
catalogue, videos and refunds need a super admin, as in the cashier itself.
"""
from datetime import datetime, time
from decimal import Decimal
from zoneinfo import ZoneInfo

from django.conf import settings as django_settings
from django.db.models import Count, Q, Sum
from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.permissions import IsSuperAdmin
from apps.products.models import Product
from apps.whatsapp import client as whatsapp_client

from . import alerts, catalog, media, phones, pricing, services
from .errors import ShopError, ShopView
from .images import MAX_UPLOAD_BYTES, InvalidImage, process_photo, process_qr
from .models import DepositProof, Listing, ShopSettings, ShopVideo, StoredImage, WebOrder
from .presenters import admin_order_json, admin_video_json, image_urls, m, q, settings_json
from .views_public import enforce_body_limit

ZERO = Decimal("0.00")
PAGE_SIZE = 30


class AdminView(ShopView):
    permission_classes = [IsAuthenticated]
    # Methods on this view that only a super admin may use.
    superadmin_methods: tuple[str, ...] = ()

    def get_permissions(self):
        if self.request.method in self.superadmin_methods:
            return [IsSuperAdmin()]
        return super().get_permissions()


# --- Orders -----------------------------------------------------------------


def _orders():
    return WebOrder.objects.select_related(
        "sale", "deposit_confirmed_by", "refunded_by", "completed_by"
    ).prefetch_related("items")


def _detail(order: WebOrder) -> Response:
    order = _orders().prefetch_related("events").get(pk=order.pk)
    return Response({"order": admin_order_json(order, detail=True)})


def _start_of_today() -> datetime:
    """Midnight in the shop's own time zone (the cashier runs on UTC)."""
    zone = ZoneInfo(getattr(django_settings, "SHOP_TIME_ZONE", "Africa/Cairo"))
    return datetime.combine(timezone.now().astimezone(zone).date(), time.min, tzinfo=zone)


def _summary() -> dict:
    start = _start_of_today()
    counts = {row["status"]: row["n"] for row in WebOrder.objects.values("status").annotate(n=Count("id"))}
    deposits = WebOrder.objects.filter(deposit_confirmed_at__gte=start).aggregate(t=Sum("deposit_paid"))
    completed = WebOrder.objects.filter(completed_at__gte=start).aggregate(n=Count("id"), t=Sum("sale__total"))
    open_value = WebOrder.objects.filter(status__in=WebOrder.IN_PROGRESS).aggregate(t=Sum("total"))
    refunds = WebOrder.objects.filter(refund_status=WebOrder.Refund.DUE).aggregate(n=Count("id"), t=Sum("refund_amount"))
    return {
        "counts": counts,
        "orders_today": WebOrder.objects.filter(created_at__gte=start).count(),
        "deposits_today": m(deposits["t"] or ZERO),
        "completed_today": completed["n"] or 0,
        "sales_today": m(completed["t"] or ZERO),
        "open_value": m(open_value["t"] or ZERO),
        "refunds_due": refunds["n"] or 0,
        "refunds_due_amount": m(refunds["t"] or ZERO),
    }


class BoardView(AdminView):
    """Everything still open, for the live board. Polled every few seconds."""

    def get(self, request):
        services.expire_stale(force=True)
        orders = _orders().filter(status__in=WebOrder.ACTIVE).order_by("created_at", "id")
        return Response({
            "orders": [admin_order_json(o) for o in orders],
            "summary": _summary(),
            "server_time": timezone.now().isoformat(),
        })


class OrderListView(AdminView):
    """Search and browse all web orders, newest first."""

    def get(self, request):
        orders = _orders()
        statuses = [s for s in request.query_params.get("status", "").split(",") if s]
        if statuses:
            orders = orders.filter(status__in=statuses)
        if request.query_params.get("refund") in WebOrder.Refund.values:
            orders = orders.filter(refund_status=request.query_params["refund"])
        term = request.query_params.get("q", "").strip()
        if term:
            orders = orders.filter(
                Q(code__icontains=term) | Q(phone__icontains=term) | Q(customer_name__icontains=term)
                | Q(sale__receipt_number__icontains=term) | Q(deposit_reference__icontains=term)
            )
        try:
            page = max(int(request.query_params.get("page", 1)), 1)
        except ValueError:
            page = 1
        total = orders.count()
        rows = orders[(page - 1) * PAGE_SIZE: page * PAGE_SIZE]
        return Response({
            "results": [admin_order_json(o) for o in rows],
            "count": total,
            "page": page,
            "pages": max((total + PAGE_SIZE - 1) // PAGE_SIZE, 1),
        })


class OrderDetailView(AdminView):
    def get(self, request, pk):
        return _detail(get_object_or_404(WebOrder, pk=pk))


class OrderProofView(AdminView):
    """The customer's transfer screenshot. Staff only, never cached."""

    def get(self, request, pk):
        proof = get_object_or_404(DepositProof, order_id=pk)
        response = HttpResponse(bytes(proof.data), content_type=proof.content_type)
        response["Cache-Control"] = "private, no-store"
        return response


class ConfirmDepositSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    force = serializers.BooleanField(required=False, default=False)


class ConfirmDepositView(AdminView):
    def post(self, request, pk):
        serializer = ConfirmDepositSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        order = services.confirm_deposit(
            get_object_or_404(WebOrder, pk=pk), user=request.user, **serializer.validated_data
        )
        return _detail(order)


class RejectDepositView(AdminView):
    def post(self, request, pk):
        order = services.reject_deposit(
            get_object_or_404(WebOrder, pk=pk), user=request.user, reason=str(request.data.get("reason") or "")
        )
        return _detail(order)


class OrderStatusView(AdminView):
    def post(self, request, pk):
        order = services.set_status(
            get_object_or_404(WebOrder, pk=pk), user=request.user, status=str(request.data.get("status") or "")
        )
        return _detail(order)


class OrderCancelView(AdminView):
    def post(self, request, pk):
        order = services.cancel_order(
            get_object_or_404(WebOrder, pk=pk), user=request.user, reason=str(request.data.get("reason") or "")
        )
        return _detail(order)


class OrderRefundView(AdminView):
    def post(self, request, pk):
        order = services.mark_refunded(
            get_object_or_404(WebOrder, pk=pk), user=request.user,
            reference=str(request.data.get("reference") or ""),
        )
        return _detail(order)


class OrderNoteView(AdminView):
    def post(self, request, pk):
        order = get_object_or_404(WebOrder, pk=pk)
        services.add_note(order, user=request.user, message=str(request.data.get("message") or ""))
        return _detail(order)


class SalePlanView(AdminView):
    """What ringing this order up would look like right now."""

    def get(self, request, pk):
        order = get_object_or_404(WebOrder, pk=pk)
        mode = request.query_params.get("price_mode") or None
        plan = services.sale_plan(order, mode if mode in ("quoted", "current") else None)
        fee_covered = min(order.deposit_paid - plan["deposit_applied"], order.delivery_fee)
        return Response({
            "changes": plan["changes"],
            "total": m(plan["total"]),
            "quoted_total": m(plan["quoted_total"]),
            "current_total": m(plan["current_total"]),
            "honoured_total": m(plan["honoured_total"]),
            "deposit_applied": m(plan["deposit_applied"]),
            "balance": m(plan["balance"]),
            "delivery_fee_due": m(order.delivery_fee - fee_covered),
            "to_collect": m(plan["balance"] + order.delivery_fee - fee_covered),
        })


class CompleteSerializer(serializers.Serializer):
    balance_method = serializers.ChoiceField(
        choices=services.BALANCE_METHODS, required=False, allow_blank=True, default=""
    )
    balance_reference = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    price_mode = serializers.ChoiceField(choices=["quoted", "current"], required=False, allow_null=True, default=None)
    override_pin = serializers.CharField(max_length=12, required=False, allow_blank=True, default="")


class OrderCompleteView(AdminView):
    def post(self, request, pk):
        serializer = CompleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        order = services.complete_order(
            get_object_or_404(WebOrder, pk=pk), request=request, **serializer.validated_data
        )
        return _detail(order)


# --- Settings ---------------------------------------------------------------


class SettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShopSettings
        exclude = ["id", "updated_at", "updated_by"]

    def validate_instapay_link(self, value):
        if value and not value.lower().startswith("https://"):
            raise serializers.ValidationError("The payment link must start with https://")
        return value

    def validate_alert_whatsapp(self, value):
        if not value.strip():
            return ""
        try:
            return phones.normalize_phone(value)
        except phones.InvalidPhone as exc:
            raise serializers.ValidationError(str(exc))

    def validate(self, attrs):
        delivery = attrs.get("delivery_enabled", getattr(self.instance, "delivery_enabled", True))
        pickup = attrs.get("pickup_enabled", getattr(self.instance, "pickup_enabled", True))
        if not delivery and not pickup:
            raise serializers.ValidationError(
                {"pickup_enabled": "Keep at least one of delivery and pickup switched on."}
            )
        return attrs


class SettingsView(AdminView):
    superadmin_methods = ("PUT", "PATCH")

    def get(self, request):
        return Response({"settings": settings_json(ShopSettings.load())})

    def put(self, request):
        serializer = SettingsSerializer(ShopSettings.load(), data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(updated_by=request.user)
        return Response({"settings": settings_json(ShopSettings.load())})

    patch = put


class InstapayQrUploadView(AdminView):
    """The QR image saved from the InstaPay app, shown to customers as it is."""

    superadmin_methods = ("POST", "DELETE")

    def post(self, request):
        enforce_body_limit(request, MAX_UPLOAD_BYTES + 512 * 1024)
        upload = request.FILES.get("image")
        if upload is None:
            raise ShopError("INVALID", "Send the QR picture as the 'image' field.")
        try:
            image = process_qr(upload)
        except InvalidImage as exc:
            raise ShopError("INVALID_IMAGE", str(exc))
        StoredImage.objects.update_or_create(
            key=StoredImage.INSTAPAY_QR,
            defaults={"data": image.data, "content_type": image.content_type, "checksum": image.checksum},
        )
        return Response({"settings": settings_json(ShopSettings.load())})

    def delete(self, request):
        StoredImage.objects.filter(key=StoredImage.INSTAPAY_QR).delete()
        return Response({"settings": settings_json(ShopSettings.load())})


class HealthView(AdminView):
    """What the settings page shows about the setup."""

    def get(self, request):
        storage = catalog.fulfilment_storage()
        settings = ShopSettings.load()
        return Response({
            "storage": {"ok": storage is not None, "name": storage.name if storage else ""},
            "products": Product.objects.filter(is_active=True).count(),
            "instapay_ready": settings.instapay_ready,
            "ordering_enabled": settings.ordering_enabled,
            "site_url": getattr(django_settings, "SHOP_SITE_URL", ""),
            "whatsapp": _whatsapp_health(settings),
        })


def _whatsapp_health(settings: ShopSettings) -> dict:
    """Whether order alerts can reach the shop. A paired account messaging
    its own number lands in "Message yourself", which rings no phone."""
    to = alerts.alert_number(settings)
    try:
        status = whatsapp_client.get_status(timeout=3)
        connected, sender, error = bool(status.get("connected")), status.get("number") or "", ""
    except whatsapp_client.WhatsAppError as exc:
        connected, sender, error = False, "", str(exc)
    return {
        "alerts": settings.whatsapp_alerts,
        "to": to,
        "connected": connected,
        "from": sender,
        "same_number": bool(sender) and sender == to,
        "error": error,
    }


# --- Website catalogue ------------------------------------------------------


class ListingSerializer(serializers.Serializer):
    hidden = serializers.BooleanField(required=False)
    featured = serializers.BooleanField(required=False)
    badge = serializers.CharField(max_length=40, required=False, allow_blank=True)
    description = serializers.CharField(max_length=600, required=False, allow_blank=True)


def _listing_row(info, listing, reserved) -> dict:
    _, thumb = image_urls(info.id, info.image_version)
    return {
        "id": info.id,
        "name": info.name,
        "category": info.category_name,
        "price": m(info.price),
        "unit": info.unit,
        "sold_by": info.sold_by,
        "stock": q(info.stock),
        "reserved": q(reserved.get(info.id, ZERO)),
        "thumb": thumb,
        "hidden": bool(listing and listing.hidden),
        "featured": bool(listing and listing.featured),
        "badge": listing.badge if listing else "",
        "description": listing.description if listing else "",
    }


class ListingsView(AdminView):
    """Every active product with how the website presents it."""

    def get(self, request):
        _, products = catalog.load_catalog(fresh=True)
        listings = {l.product_id: l for l in Listing.objects.all()}
        reserved = pricing.reserved_quantities()
        return Response({"products": [_listing_row(p, listings.get(p.id), reserved) for p in products]})


class ListingDetailView(AdminView):
    superadmin_methods = ("PUT", "PATCH")

    def put(self, request, product_id):
        products = catalog.load_products([product_id])
        if product_id not in products:
            raise Http404
        serializer = ListingSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        listing, _ = Listing.objects.get_or_create(product_id=product_id)
        for name, value in serializer.validated_data.items():
            setattr(listing, name, value.strip() if isinstance(value, str) else value)
        listing.save()
        reserved = pricing.reserved_quantities([product_id])
        return Response({"product": _listing_row(products[product_id], listing, reserved)})

    patch = put


# --- Videos -----------------------------------------------------------------


class VideoSerializer(serializers.Serializer):
    placement = serializers.ChoiceField(choices=ShopVideo.Placement.values, required=False)
    title = serializers.CharField(max_length=120, required=False, allow_blank=True)
    caption = serializers.CharField(max_length=255, required=False, allow_blank=True)
    product_id = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    sort = serializers.IntegerField(required=False)
    is_active = serializers.BooleanField(required=False)
    duration = serializers.FloatField(required=False, allow_null=True, min_value=0, max_value=36000)
    width = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=20000)
    height = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=20000)

    def validate_product_id(self, value):
        if value is not None and not Product.objects.filter(pk=value).exists():
            raise serializers.ValidationError("No such product.")
        return value


def _blank_to_none(data):
    """Multipart forms send "" for an empty number; treat that as not set."""
    cleaned = {}
    for key in data:
        if key in ("file", "poster"):
            continue
        value = data.get(key)
        if value == "" and key in ("product_id", "duration", "width", "height"):
            value = None
        cleaned[key] = value
    return cleaned


class VideosView(AdminView):
    superadmin_methods = ("POST",)

    def get(self, request):
        return Response({
            "videos": [admin_video_json(v) for v in ShopVideo.objects.select_related("created_by")],
            "max_mb": media.video_max_mb(),
        })

    def post(self, request):
        enforce_body_limit(request, (media.video_max_mb() + 12) * 1024 * 1024)
        upload = request.FILES.get("file")
        if upload is None:
            raise ShopError("INVALID", "Send the video as the 'file' field.")
        try:
            content_type = media.check_video(upload)
        except media.InvalidVideo as exc:
            raise ShopError("INVALID_VIDEO", str(exc))
        poster = None
        if request.FILES.get("poster") is not None:
            try:
                poster = process_photo(request.FILES["poster"], longest_side=1280, quality=80)
            except InvalidImage as exc:
                raise ShopError("INVALID_IMAGE", str(exc))
        serializer = VideoSerializer(data=_blank_to_none(request.data))
        serializer.is_valid(raise_exception=True)
        video = ShopVideo(created_by=request.user, **serializer.validated_data)
        media.store_video(video, upload, content_type, poster)
        video.save()
        return Response({"video": admin_video_json(video)}, status=201)


class VideoDetailView(AdminView):
    superadmin_methods = ("PATCH", "PUT", "DELETE")

    def patch(self, request, pk):
        video = get_object_or_404(ShopVideo, pk=pk)
        serializer = VideoSerializer(data=_blank_to_none(request.data), partial=True)
        serializer.is_valid(raise_exception=True)
        for name, value in serializer.validated_data.items():
            setattr(video, name, value)
        video.save()
        return Response({"video": admin_video_json(video)})

    put = patch

    def delete(self, request, pk):
        video = get_object_or_404(ShopVideo, pk=pk)
        media.delete_files(video)
        video.delete()
        return Response(status=204)
