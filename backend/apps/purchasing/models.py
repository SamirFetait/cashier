"""Purchase orders, goods receipt and stock takes.

Restocking previously happened as untracked manual adjustments. These models
give incoming stock a paper trail — what was ordered, what actually turned up,
and what it cost — and give counts a variance that someone has to explain.
"""
from decimal import Decimal

from django.conf import settings
from django.db import models

from apps.common.fields import QUANTITY_ZERO, money_field, quantity_field


class PurchaseOrder(models.Model):
    """An order placed with a supplier. Receiving it is what moves stock."""

    class Status(models.TextChoices):
        DRAFT = "DRAFT", "Draft"
        SENT = "SENT", "Sent to supplier"
        PARTIAL = "PARTIAL", "Partially received"
        RECEIVED = "RECEIVED", "Fully received"
        CANCELLED = "CANCELLED", "Cancelled"

    number = models.CharField(max_length=32, unique=True, db_index=True)
    supplier = models.ForeignKey(
        "suppliers.Supplier", on_delete=models.PROTECT, related_name="purchase_orders"
    )
    storage = models.ForeignKey(
        "inventory.Storage", on_delete=models.PROTECT, related_name="purchase_orders",
        help_text="Where the goods will land",
    )
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.DRAFT)
    expected_at = models.DateField(null=True, blank=True)
    total_cost = money_field(default=Decimal("0"))
    note = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, related_name="purchase_orders",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"PO {self.number} — {self.supplier}"

    @property
    def is_open(self) -> bool:
        return self.status in {self.Status.DRAFT, self.Status.SENT, self.Status.PARTIAL}


class PurchaseOrderItem(models.Model):
    purchase_order = models.ForeignKey(
        PurchaseOrder, on_delete=models.CASCADE, related_name="items"
    )
    product = models.ForeignKey(
        "products.Product", on_delete=models.PROTECT, related_name="purchase_items"
    )
    quantity_ordered = quantity_field()
    quantity_received = quantity_field(default=QUANTITY_ZERO)
    unit_cost = money_field()

    class Meta:
        unique_together = ("purchase_order", "product")

    def __str__(self) -> str:
        return f"{self.quantity_ordered} x {self.product}"

    @property
    def outstanding(self) -> Decimal:
        return self.quantity_ordered - self.quantity_received

    @property
    def line_cost(self) -> Decimal:
        return (self.unit_cost * self.quantity_ordered).quantize(Decimal("0.01"))


class GoodsReceipt(models.Model):
    """One delivery against a purchase order. A PO may be received in parts."""

    number = models.CharField(max_length=32, unique=True, db_index=True)
    purchase_order = models.ForeignKey(
        PurchaseOrder, on_delete=models.PROTECT, related_name="receipts"
    )
    received_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True
    )
    supplier_reference = models.CharField(
        max_length=120, blank=True, help_text="Delivery note / invoice number"
    )
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Receipt {self.number}"


class GoodsReceiptItem(models.Model):
    receipt = models.ForeignKey(
        GoodsReceipt, on_delete=models.CASCADE, related_name="items"
    )
    purchase_order_item = models.ForeignKey(
        PurchaseOrderItem, on_delete=models.PROTECT, related_name="receipt_items"
    )
    product = models.ForeignKey(
        "products.Product", on_delete=models.PROTECT, related_name="receipt_items"
    )
    quantity = quantity_field()
    unit_cost = money_field()

    def __str__(self) -> str:
        return f"{self.quantity} x {self.product} received"


class StockTake(models.Model):
    """A physical count. Variances are applied as an explicit correction."""

    class Status(models.TextChoices):
        COUNTING = "COUNTING", "Counting"
        APPLIED = "APPLIED", "Applied"
        ABANDONED = "ABANDONED", "Abandoned"

    number = models.CharField(max_length=32, unique=True, db_index=True)
    storage = models.ForeignKey(
        "inventory.Storage", on_delete=models.PROTECT, related_name="stock_takes"
    )
    status = models.CharField(
        max_length=12, choices=Status.choices, default=Status.COUNTING
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, related_name="stock_takes",
    )
    applied_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="stock_takes_applied",
    )
    applied_at = models.DateTimeField(null=True, blank=True)
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Stock take {self.number} [{self.status}]"


class StockTakeLine(models.Model):
    stock_take = models.ForeignKey(
        StockTake, on_delete=models.CASCADE, related_name="lines"
    )
    product = models.ForeignKey(
        "products.Product", on_delete=models.PROTECT, related_name="stock_take_lines"
    )
    # Snapshot of what the system believed at the moment of counting, so the
    # variance is not distorted by sales happening during the count.
    expected_quantity = quantity_field()
    counted_quantity = quantity_field()

    class Meta:
        unique_together = ("stock_take", "product")

    def __str__(self) -> str:
        return f"{self.product}: counted {self.counted_quantity}"

    @property
    def variance(self) -> Decimal:
        return self.counted_quantity - self.expected_quantity
