from django.conf import settings
from django.db import models
from django.db.models import F


class Storage(models.Model):
    """A physical location (warehouse / store room) holding products."""

    name = models.CharField(max_length=120, unique=True)
    address = models.CharField(max_length=255, blank=True)
    is_default = models.BooleanField(default=False)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "storages"

    def __str__(self) -> str:
        return self.name


class StockItem(models.Model):
    """Quantity of one product held in one storage location."""

    product = models.ForeignKey(
        "products.Product", on_delete=models.CASCADE, related_name="stock_items"
    )
    storage = models.ForeignKey(
        Storage, on_delete=models.CASCADE, related_name="stock_items"
    )
    quantity = models.IntegerField(default=0)
    reorder_level = models.IntegerField(default=0)

    class Meta:
        unique_together = ("product", "storage")
        ordering = ["product__name"]

    def __str__(self) -> str:
        return f"{self.product} @ {self.storage}: {self.quantity}"

    @property
    def is_low(self) -> bool:
        return self.quantity <= self.reorder_level


class StockMovement(models.Model):
    """Append-only ledger of every change to stock (sales, restocks, fixes)."""

    class Reason(models.TextChoices):
        SALE = "SALE", "Sale"
        PURCHASE = "PURCHASE", "Purchase / restock"
        ADJUSTMENT = "ADJUSTMENT", "Manual adjustment"

    product = models.ForeignKey(
        "products.Product", on_delete=models.PROTECT, related_name="movements"
    )
    storage = models.ForeignKey(
        Storage, on_delete=models.PROTECT, related_name="movements"
    )
    change = models.IntegerField(help_text="Positive to add stock, negative to remove")
    reason = models.CharField(max_length=20, choices=Reason.choices)
    reference = models.CharField(max_length=120, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.get_reason_display()} {self.change:+d} {self.product}"


def apply_stock_change(*, product, storage, change, reason, reference="", user=None):
    """Atomically record a movement and update the StockItem balance.

    Must be called inside a transaction. Uses F() to avoid lost updates under
    concurrent writes. Returns the updated StockItem.
    """
    stock_item, _ = StockItem.objects.select_for_update().get_or_create(
        product=product, storage=storage
    )
    StockItem.objects.filter(pk=stock_item.pk).update(quantity=F("quantity") + change)
    StockMovement.objects.create(
        product=product,
        storage=storage,
        change=change,
        reason=reason,
        reference=reference,
        created_by=user,
    )
    stock_item.refresh_from_db()
    return stock_item
