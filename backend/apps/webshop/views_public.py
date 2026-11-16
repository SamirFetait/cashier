"""The storefront's API: settings, catalogue, cart quote, placing and tracking
an order. No login: a customer proves an order is theirs with the secret
token in their tracking link."""
import secrets

from django.http import Http404, HttpResponse, HttpResponseNotModified
from django.utils import timezone
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from . import phones, pricing, services
from .errors import ShopError, ShopView
from .images import MAX_UPLOAD_BYTES, InvalidImage, process_photo
from .models import ShopSettings, StoredImage, WebOrder
from .presenters import catalog_json, config_json, public_order_json, quote_json
from .throttles import DepositThrottle, LookupThrottle, OrderCreateThrottle, QuoteThrottle, client_ip

# A versioned URL names one exact picture, so it can be cached for good.
IMMUTABLE = "public, max-age=31536000, immutable"


def enforce_body_limit(request, max_bytes: int) -> None:
    """Refuse an oversized upload before reading any of it."""
    try:
        length = int(request.META.get("CONTENT_LENGTH") or 0)
    except ValueError:
        length = 0
    if length > max_bytes:
        raise ShopError("TOO_LARGE", "The upload is too large.", status=413)


class PublicView(ShopView):
    authentication_classes = []
    permission_classes = [AllowAny]


class ConfigView(PublicView):
    def get(self, request):
        return Response(config_json(ShopSettings.load()))


class CatalogView(PublicView):
    def get(self, request):
        services.expire_stale()
        return Response(catalog_json())


class InstapayQrView(PublicView):
    """The InstaPay QR the store saved from the app, if one was uploaded."""

    def get(self, request):
        image = StoredImage.objects.filter(key=StoredImage.INSTAPAY_QR).first()
        if image is None:
            raise Http404
        version = image.checksum[:16]
        etag = f'"{version}-qr"'
        if request.headers.get("If-None-Match") == etag:
            response = HttpResponseNotModified()
        else:
            response = HttpResponse(bytes(image.data), content_type=image.content_type)
        response["ETag"] = etag
        response["Cache-Control"] = IMMUTABLE if request.query_params.get("v") == version else "no-cache"
        return response


class QuoteView(PublicView):
    throttle_classes = [QuoteThrottle]

    def post(self, request):
        services.expire_stale()
        try:
            quote = pricing.build_quote(request.data.get("items"), request.data.get("fulfilment"))
        except pricing.InvalidCart as exc:
            raise ShopError("INVALID", str(exc))
        return Response(quote_json(quote))


class OrderCreateSerializer(serializers.Serializer):
    name = serializers.CharField(min_length=2, max_length=120)
    phone = serializers.CharField(max_length=40)
    fulfilment = serializers.ChoiceField(choices=WebOrder.Fulfilment.values)
    address = serializers.CharField(max_length=300, required=False, allow_blank=True, default="")
    notes = serializers.CharField(max_length=500, required=False, allow_blank=True, default="")
    language = serializers.ChoiceField(choices=["ar", "en"], required=False, default="ar")
    expected_total = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True, default=None
    )
    items = serializers.ListField(child=serializers.DictField(), allow_empty=False)
    # Hidden from people; a bot that fills every field gives itself away.
    website = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_phone(self, value):
        try:
            return phones.normalize_phone(value)
        except phones.InvalidPhone as exc:
            raise serializers.ValidationError(str(exc))

    def validate(self, attrs):
        if attrs["fulfilment"] == WebOrder.Fulfilment.DELIVERY and len(attrs["address"].strip()) < 5:
            raise serializers.ValidationError({"address": "Enter the delivery address."})
        if attrs["website"]:
            raise serializers.ValidationError("Could not place the order.")
        return attrs


class OrderCreateView(PublicView):
    throttle_classes = [OrderCreateThrottle]

    def post(self, request):
        serializer = OrderCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            order = services.create_order(
                items=data["items"],
                fulfilment=data["fulfilment"],
                customer_name=data["name"].strip(),
                phone=data["phone"],
                address=data["address"].strip(),
                notes=data["notes"].strip(),
                language=data["language"],
                expected_total=data["expected_total"],
                client_ip=client_ip(request),
            )
        except pricing.InvalidCart as exc:
            raise ShopError("INVALID", str(exc))
        return Response({"order": public_order_json(order, with_token=True)}, status=201)


def customer_order(request, code: str, token: str | None = None) -> WebOrder:
    """The order behind a tracking link. A wrong token looks exactly like a
    wrong code, so codes cannot be probed."""
    token = token or request.query_params.get("t") or ""
    order = WebOrder.objects.filter(code=code.strip().upper()).first()
    if order is None or not token or not secrets.compare_digest(order.access_token, str(token)):
        raise ShopError("NOT_FOUND", "Order not found.", status=404)
    return order


class OrderTrackView(PublicView):
    def get(self, request, code):
        order = customer_order(request, code)
        overdue = (
            order.status == WebOrder.Status.AWAITING_DEPOSIT
            and order.expires_at is not None
            and order.expires_at < timezone.now()
        )
        if overdue:
            services.expire_stale(force=True)
            order.refresh_from_db()
        return Response({"order": public_order_json(order)})


class OrderDepositView(PublicView):
    throttle_classes = [DepositThrottle]

    def post(self, request, code):
        enforce_body_limit(request, MAX_UPLOAD_BYTES + 512 * 1024)
        order = customer_order(request, code, request.data.get("t"))
        proof = None
        upload = request.FILES.get("proof")
        if upload is not None:
            try:
                proof = process_photo(upload)
            except InvalidImage as exc:
                raise ShopError("INVALID_IMAGE", str(exc))
        order = services.submit_deposit(
            order,
            reference=str(request.data.get("reference") or ""),
            sender=str(request.data.get("sender") or ""),
            proof=proof,
        )
        return Response({"order": public_order_json(order)})


class OrderCancelView(PublicView):
    throttle_classes = [DepositThrottle]

    def post(self, request, code):
        order = customer_order(request, code, request.data.get("t"))
        return Response({"order": public_order_json(services.customer_cancel(order))})


class OrderLookupView(PublicView):
    """Find a lost tracking link from the order code and the phone number."""

    throttle_classes = [LookupThrottle]

    def post(self, request):
        code = str(request.data.get("code") or "").strip().upper()
        try:
            phone = phones.normalize_phone(request.data.get("phone"))
        except phones.InvalidPhone:
            raise ShopError("NOT_FOUND", "Order not found.", status=404)
        if code and not code.startswith(services.CODE_PREFIX):
            code = services.CODE_PREFIX + code
        order = WebOrder.objects.filter(code=code, phone=phone).first()
        if order is None:
            raise ShopError("NOT_FOUND", "Order not found.", status=404)
        return Response({"code": order.code, "token": order.access_token})
