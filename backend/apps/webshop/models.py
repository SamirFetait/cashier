"""The website's orders, their InstaPay deposits, and what the site shows.

A web order is not a sale. It waits for an InstaPay deposit, is confirmed by
staff, and only becomes a sale (an orders.Order, through the normal checkout)
when the goods are handed over. Until then it does not touch stock; open web
orders are counted as *reserved* when the website works out availability.
"""
import uuid
from decimal import Decimal

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from apps.common.fields import money_field, quantity_field

ZERO = Decimal("0.00")


def nutrition_field(help_text: str) -> models.DecimalField:
    return models.DecimalField(
        max_digits=5, decimal_places=1, null=True, blank=True,
        validators=[MinValueValidator(Decimal("0"))], help_text=help_text,
    )


class ShopSettings(models.Model):
    """One row (pk=1) of settings edited from the orders admin."""

    ordering_enabled = models.BooleanField(default=True)

    # --- InstaPay: where customers send the deposit ---
    instapay_address = models.CharField(
        max_length=120, blank=True, help_text="Instant Payment Address, e.g. name@instapay"
    )
    instapay_name = models.CharField(max_length=120, blank=True)
    instapay_mobile = models.CharField(max_length=32, blank=True)
    instapay_link = models.URLField(
        max_length=300, blank=True, help_text="Payment link from the InstaPay app (ipn.eg/...)"
    )

    # --- Deposit ---
    deposit_percent = models.PositiveSmallIntegerField(
        default=50, validators=[MinValueValidator(1), MaxValueValidator(100)],
        help_text="Share of the goods total paid up front",
    )
    deposit_min = money_field(default=ZERO, validators=[MinValueValidator(ZERO)])
    hold_minutes = models.PositiveIntegerField(
        default=60, validators=[MinValueValidator(5), MaxValueValidator(7 * 24 * 60)],
        help_text="How long an order waits for its deposit before it expires",
    )

    # --- Fulfilment ---
    delivery_enabled = models.BooleanField(default=True)
    pickup_enabled = models.BooleanField(default=True)
    delivery_fee = money_field(default=ZERO, validators=[MinValueValidator(ZERO)])
    free_delivery_over = money_field(null=True, blank=True, validators=[MinValueValidator(ZERO)])
    min_order = money_field(default=ZERO, validators=[MinValueValidator(ZERO)])

    # --- WhatsApp alerts the server sends the shop (see alerts.py) ---
    whatsapp_alerts = models.BooleanField(
        default=True, help_text="Send each order that needs the shop to WhatsApp"
    )
    alert_whatsapp = models.CharField(
        max_length=32, blank=True,
        help_text="Number that receives the alerts; empty sends them to the store WhatsApp number",
    )

    # --- Shown on the storefront ---
    whatsapp = models.CharField(max_length=32, blank=True, default="+20 15 53211120")
    address_ar = models.CharField(max_length=255, blank=True)
    address_en = models.CharField(max_length=255, blank=True)
    hours_ar = models.CharField(max_length=255, blank=True)
    hours_en = models.CharField(max_length=255, blank=True)
    delivery_note_ar = models.CharField(max_length=255, blank=True)
    delivery_note_en = models.CharField(max_length=255, blank=True)
    announcement_ar = models.CharField(max_length=255, blank=True)
    announcement_en = models.CharField(max_length=255, blank=True)

    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    class Meta:
        verbose_name = "website settings"
        verbose_name_plural = "website settings"

    def __str__(self) -> str:
        return "Website settings"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls) -> "ShopSettings":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    @property
    def instapay_ready(self) -> bool:
        """A customer needs at least one way to find the account."""
        return bool(self.instapay_address or self.instapay_link or self.instapay_mobile)


class StoredImage(models.Model):
    """A small image kept in the database, like product photos. Currently one
    row: the InstaPay QR saved from the app (key ``instapay-qr``)."""

    INSTAPAY_QR = "instapay-qr"

    key = models.CharField(max_length=40, unique=True)
    data = models.BinaryField()
    content_type = models.CharField(max_length=40, default="image/png")
    checksum = models.CharField(max_length=64)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return self.key


class WebOrder(models.Model):
    class Status(models.TextChoices):
        AWAITING_DEPOSIT = "AWAITING_DEPOSIT", "Awaiting deposit"
        DEPOSIT_REVIEW = "DEPOSIT_REVIEW", "Deposit under review"
        CONFIRMED = "CONFIRMED", "Confirmed"
        PREPARING = "PREPARING", "Preparing"
        READY = "READY", "Ready / out for delivery"
        COMPLETED = "COMPLETED", "Completed"
        CANCELLED = "CANCELLED", "Cancelled"
        EXPIRED = "EXPIRED", "Expired"

    class Fulfilment(models.TextChoices):
        DELIVERY = "DELIVERY", "Delivery"
        PICKUP = "PICKUP", "Pickup"

    class Refund(models.TextChoices):
        NONE = "NONE", "Nothing to refund"
        DUE = "DUE", "Refund due"
        DONE = "DONE", "Refunded"

    # Orders that hold stock back from the storefront. An expired or cancelled
    # order releases it; a completed one became a sale, which took the stock.
    RESERVING = (
        Status.AWAITING_DEPOSIT, Status.DEPOSIT_REVIEW, Status.CONFIRMED,
        Status.PREPARING, Status.READY,
    )
    # Deposit accepted, goods not handed over yet.
    IN_PROGRESS = (Status.CONFIRMED, Status.PREPARING, Status.READY)
    ACTIVE = RESERVING
    CLOSED = (Status.COMPLETED, Status.CANCELLED, Status.EXPIRED)

    # Used as the sale's client_uuid, so ringing it up can never happen twice.
    public_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    code = models.CharField(max_length=16, unique=True)
    # Secret part of the customer's tracking link.
    access_token = models.CharField(max_length=64)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.AWAITING_DEPOSIT, db_index=True
    )
    language = models.CharField(max_length=2, default="ar")

    customer_name = models.CharField(max_length=120)
    phone = models.CharField(max_length=20, db_index=True)
    fulfilment = models.CharField(max_length=10, choices=Fulfilment.choices)
    address = models.CharField(max_length=300, blank=True)
    notes = models.CharField(max_length=500, blank=True)

    # What the customer was quoted. The deposit is a share of the goods
    # (subtotal); the delivery fee is collected on delivery, outside the sale.
    subtotal = money_field()
    delivery_fee = money_field(default=ZERO)
    total = money_field()
    deposit_required = money_field()
    deposit_paid = money_field(default=ZERO)

    deposit_reference = models.CharField(max_length=64, blank=True)
    deposit_sender = models.CharField(max_length=120, blank=True)
    deposit_submitted_at = models.DateTimeField(null=True, blank=True)
    deposit_confirmed_at = models.DateTimeField(null=True, blank=True)
    deposit_confirmed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    deposit_reject_reason = models.CharField(max_length=255, blank=True)

    expires_at = models.DateTimeField(null=True, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancel_reason = models.CharField(max_length=255, blank=True)
    # "customer", or the staff member's username.
    cancelled_by = models.CharField(max_length=150, blank=True)

    refund_status = models.CharField(
        max_length=10, choices=Refund.choices, default=Refund.NONE, db_index=True
    )
    refund_amount = money_field(default=ZERO)
    refund_reference = models.CharField(max_length=120, blank=True)
    refunded_at = models.DateTimeField(null=True, blank=True)
    refunded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    # The sale this order became at hand-over.
    sale = models.OneToOneField(
        "orders.Order", on_delete=models.PROTECT, null=True, blank=True, related_name="web_order"
    )
    balance_method = models.CharField(max_length=20, blank=True)
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    client_ip = models.GenericIPAddressField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["status", "-created_at"])]

    def __str__(self) -> str:
        return f"{self.code} ({self.get_status_display()})"

    @property
    def balance_due(self) -> Decimal:
        """Still owed against the quoted total, delivery fee included."""
        return max(self.total - self.deposit_paid, ZERO)


class WebOrderItem(models.Model):
    order = models.ForeignKey(WebOrder, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(
        "products.Product", on_delete=models.PROTECT, related_name="web_order_items"
    )
    # Copied, so the order still reads correctly after a rename or reprice.
    name = models.CharField(max_length=200)
    unit = models.CharField(max_length=32, default="pcs")
    sold_by = models.CharField(max_length=10, default="UNIT")
    unit_price = money_field()
    quantity = quantity_field()
    line_total = money_field()

    class Meta:
        ordering = ["id"]

    def __str__(self) -> str:
        return f"{self.quantity} x {self.name}"


class DepositProof(models.Model):
    """The customer's screenshot of the transfer, re-encoded as JPEG."""

    order = models.OneToOneField(
        WebOrder, on_delete=models.CASCADE, primary_key=True, related_name="proof"
    )
    data = models.BinaryField()
    content_type = models.CharField(max_length=40, default="image/jpeg")
    width = models.PositiveIntegerField(default=0)
    height = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now=True)


class WebOrderEvent(models.Model):
    """Timeline of a web order. Append-only; ``public`` ones show to the customer."""

    class Kind(models.TextChoices):
        CREATED = "CREATED", "Order placed"
        DEPOSIT_SUBMITTED = "DEPOSIT_SUBMITTED", "Deposit details sent"
        DEPOSIT_CONFIRMED = "DEPOSIT_CONFIRMED", "Deposit confirmed"
        DEPOSIT_REJECTED = "DEPOSIT_REJECTED", "Deposit not found"
        STATUS = "STATUS", "Status changed"
        COMPLETED = "COMPLETED", "Completed"
        CANCELLED = "CANCELLED", "Cancelled"
        EXPIRED = "EXPIRED", "Expired"
        REFUNDED = "REFUNDED", "Deposit refunded"
        NOTE = "NOTE", "Note"

    order = models.ForeignKey(WebOrder, on_delete=models.CASCADE, related_name="events")
    kind = models.CharField(max_length=20, choices=Kind.choices)
    # "customer", "system", or the staff member's username.
    actor = models.CharField(max_length=150, blank=True)
    public = models.BooleanField(default=False)
    message = models.CharField(max_length=500, blank=True)
    data = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]


class Listing(models.Model):
    """How one product is presented on the website. Optional: a product with
    no row here is simply shown as it is in the cashier."""

    product = models.OneToOneField(
        "products.Product", on_delete=models.CASCADE, primary_key=True, related_name="listing"
    )
    hidden = models.BooleanField(default=False, help_text="Keep this product off the website")
    featured = models.BooleanField(default=False)
    badge = models.CharField(max_length=40, blank=True)
    description = models.CharField(max_length=600, blank=True)

    # --- Nutrition facts per 100 g (or 100 ml), as printed on the label ---
    # A product shows them once its calories are filled in.
    kcal = nutrition_field("Calories (kcal) per 100 g")
    protein = nutrition_field("Protein (g) per 100 g")
    carbs = nutrition_field("Carbohydrates (g) per 100 g")
    sugar = nutrition_field("Of which sugars (g) per 100 g")
    fat = nutrition_field("Fat (g) per 100 g")
    fiber = nutrition_field("Fibre (g) per 100 g")
    # For a product sold by the piece: how much one piece weighs, so a cart
    # can count what a whole jar or pack holds.
    piece_grams = models.DecimalField(
        max_digits=8, decimal_places=1, null=True, blank=True,
        validators=[MinValueValidator(Decimal("0.1"))],
        help_text="Weight of one piece in grams (products sold by the piece)",
    )
    updated_at = models.DateTimeField(auto_now=True)

    NUTRIENTS = ("kcal", "protein", "carbs", "sugar", "fat", "fiber")

    @property
    def has_nutrition(self) -> bool:
        return self.kcal is not None


class ShopVideo(models.Model):
    """A video on the storefront, uploaded from the orders admin."""

    class Placement(models.TextChoices):
        HERO = "HERO", "Hero background"
        STORY = "STORY", "Stories strip"

    placement = models.CharField(
        max_length=10, choices=Placement.choices, default=Placement.STORY, db_index=True
    )
    title = models.CharField(max_length=120, blank=True)
    caption = models.CharField(max_length=255, blank=True)
    file = models.FileField(upload_to="videos/")
    poster = models.FileField(upload_to="videos/posters/", blank=True)
    content_type = models.CharField(max_length=40, default="video/mp4")
    size = models.PositiveBigIntegerField(default=0)
    duration = models.FloatField(null=True, blank=True)
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)
    # The product the video sells, so a story can carry an "add to cart".
    product = models.ForeignKey(
        "products.Product", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    sort = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sort", "-created_at"]

    def __str__(self) -> str:
        return self.title or f"Video #{self.pk}"


class ShopEvent(models.Model):
    """A public event at (or by) the shop, written in the orders admin: a
    tasting, a workshop, a market stall. Shown on the website, no booking."""

    title = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    starts_at = models.DateTimeField(db_index=True)
    ends_at = models.DateTimeField(null=True, blank=True)
    # Empty means at the shop itself.
    place = models.CharField(max_length=200, blank=True)
    is_published = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-starts_at", "-id"]

    def __str__(self) -> str:
        return self.title


class EventMedia(models.Model):
    """A photo or short video of an event, in the order staff set. Files live
    under MEDIA_ROOT/events/ and are served by media.serve_media."""

    class Kind(models.TextChoices):
        PHOTO = "PHOTO", "Photo"
        VIDEO = "VIDEO", "Video"

    MAX_PER_EVENT = 20

    event = models.ForeignKey(ShopEvent, on_delete=models.CASCADE, related_name="media")
    kind = models.CharField(max_length=10, choices=Kind.choices)
    file = models.FileField(upload_to="events/")
    # A video's still frame, made in the browser when it was uploaded.
    poster = models.FileField(upload_to="events/", blank=True)
    content_type = models.CharField(max_length=40)
    size = models.PositiveBigIntegerField(default=0)
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)
    duration = models.FloatField(null=True, blank=True)
    sort = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sort", "id"]


class HealthySwap(models.Model):
    """A craving and the healthier products from the shop that answer it,
    for the website's swap finder."""

    craving = models.CharField(max_length=80)
    emoji = models.CharField(max_length=16, blank=True)
    reason = models.CharField(max_length=500, blank=True)
    products = models.ManyToManyField("products.Product", blank=True, related_name="+")
    sort = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["sort", "id"]

    def __str__(self) -> str:
        return self.craving
