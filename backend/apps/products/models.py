from decimal import Decimal

from django.db import models


class Category(models.Model):
    name = models.CharField(max_length=120, unique=True)

    class Meta:
        verbose_name_plural = "categories"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class Product(models.Model):
    class SoldBy(models.TextChoices):
        UNIT = "UNIT", "Per unit"
        WEIGHT = "WEIGHT", "By weight / measure"

    name = models.CharField(max_length=200)
    category = models.ForeignKey(
        Category, on_delete=models.PROTECT, related_name="products",
        null=True, blank=True,
    )
    barcode = models.CharField(max_length=64, blank=True, null=True, unique=True)
    price = models.DecimalField(
        max_digits=12, decimal_places=2, help_text="Price per unit, or per unit of measure"
    )
    cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    unit = models.CharField(max_length=32, default="pcs")
    sold_by = models.CharField(
        max_length=10, choices=SoldBy.choices, default=SoldBy.UNIT,
        help_text="UNIT items must be sold in whole numbers; WEIGHT items accept fractions",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name

    @property
    def is_weighed(self) -> bool:
        return self.sold_by == self.SoldBy.WEIGHT

    @property
    def quantity_in_storage(self):
        agg = self.stock_items.aggregate(total=models.Sum("quantity"))
        return agg["total"] or Decimal("0")


class ProductImage(models.Model):
    """A product's photo, stored in the database rather than on disk.

    The database is what the POS and the store's website share, so a photo
    kept here is visible to both with no file storage to sync, back up or
    serve separately. It lives in its own table so the image bytes never ride
    along on ordinary product queries.

    Uploads are normalised to JPEG (see images.py): ``data`` is at most
    FULL_SIZE px on its long side, ``thumbnail`` at most THUMB_SIZE.
    """

    product = models.OneToOneField(
        Product, on_delete=models.CASCADE, primary_key=True, related_name="image"
    )
    data = models.BinaryField()
    thumbnail = models.BinaryField()
    content_type = models.CharField(max_length=40, default="image/jpeg")
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    # SHA-256 of ``data``: changes whenever the photo does, so it versions
    # image URLs and doubles as the HTTP ETag.
    checksum = models.CharField(max_length=64)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"Photo of {self.product}"
