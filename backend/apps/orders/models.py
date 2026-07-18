from decimal import Decimal

from django.conf import settings
from django.db import models

from apps.common.fields import money_field, quantity_field


class Order(models.Model):
    class Status(models.TextChoices):
        COMPLETED = "COMPLETED", "Completed"
        CANCELLED = "CANCELLED", "Cancelled"
        VOIDED = "VOIDED", "Voided"
        REFUNDED = "REFUNDED", "Fully refunded"
        PARTIALLY_REFUNDED = "PARTIALLY_REFUNDED", "Partially refunded"

    class Payment(models.TextChoices):
        CASH = "CASH", "Cash"
        CARD = "CARD", "Card"
        OTHER = "OTHER", "Other"

    receipt_number = models.CharField(
        max_length=32, unique=True, null=True, blank=True, db_index=True,
        help_text="Sequential, gapless document number shown on the receipt",
    )
    customer = models.ForeignKey(
        "customers.Customer", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="orders",
    )
    storage = models.ForeignKey(
        "inventory.Storage", on_delete=models.PROTECT, related_name="orders"
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, related_name="orders",
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.COMPLETED
    )
    payment_method = models.CharField(
        max_length=20, choices=Payment.choices, default=Payment.CASH
    )
    subtotal = money_field(default=Decimal("0"), help_text="Sum of line totals before order discount")
    discount = money_field(default=Decimal("0"), help_text="Order-level discount")
    tax = money_field(default=Decimal("0"))
    total = money_field(default=Decimal("0"))
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Order {self.receipt_number or f'#{self.pk}'} — {self.total}"

    @property
    def line_discount_total(self) -> Decimal:
        return sum((i.discount for i in self.items.all()), Decimal("0"))

    @property
    def cost_total(self) -> Decimal:
        return sum((i.unit_cost * i.quantity for i in self.items.all()), Decimal("0"))

    @property
    def gross_margin(self) -> Decimal:
        return self.total - self.tax - self.cost_total


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(
        "products.Product", on_delete=models.PROTECT, related_name="order_items"
    )
    quantity = quantity_field()
    unit_price = money_field()
    # Snapshot of cost at time of sale, so margin reports stay accurate even
    # after Product.cost is edited.
    unit_cost = money_field(default=Decimal("0"))
    discount = money_field(default=Decimal("0"), help_text="Discount applied to this line")
    line_total = money_field(help_text="quantity * unit_price - discount")

    @property
    def gross_margin(self) -> Decimal:
        return self.line_total - (self.unit_cost * self.quantity)

    def __str__(self) -> str:
        return f"{self.quantity} x {self.product} @ {self.unit_price}"
