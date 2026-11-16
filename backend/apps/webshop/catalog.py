"""The products the website sells, with stock as the website sees it.

Stock is the quantity in one storage location, the one web orders are sold
from, because checkout takes stock from a single location.
"""
from dataclasses import dataclass
from decimal import Decimal

from django.conf import settings
from django.core.cache import cache
from django.db.models import F

from apps.inventory.models import StockItem, Storage
from apps.products.models import Category, Product

ZERO = Decimal("0")
_CATALOG_CACHE_KEY = "webshop:catalog"


@dataclass(frozen=True)
class ProductInfo:
    id: int
    name: str
    category_id: int | None
    category_name: str
    price: Decimal
    unit: str
    sold_by: str
    is_active: bool
    stock: Decimal
    image_version: str  # "" when the product has no photo

    @property
    def is_weighed(self) -> bool:
        return self.sold_by == Product.SoldBy.WEIGHT


@dataclass(frozen=True)
class CategoryInfo:
    id: int
    name: str


def fulfilment_storage() -> Storage | None:
    """Where web orders are sold from: SHOP_STORAGE_ID, otherwise the same
    choice checkout makes when no storage is given."""
    storage_id = getattr(settings, "SHOP_STORAGE_ID", None)
    if storage_id:
        return Storage.objects.filter(pk=storage_id).first()
    return Storage.objects.filter(is_default=True).first() or Storage.objects.first()


def _stock_map(product_ids=None) -> dict[int, Decimal]:
    storage = fulfilment_storage()
    if storage is None:
        return {}
    rows = StockItem.objects.filter(storage=storage)
    if product_ids is not None:
        rows = rows.filter(product_id__in=product_ids)
    return dict(rows.values_list("product_id", "quantity"))


def _products():
    # Only the checksum is selected from the photo table, never the bytes.
    return Product.objects.select_related("category").annotate(image_version=F("image__checksum"))


def _to_info(product, stock: dict[int, Decimal]) -> ProductInfo:
    return ProductInfo(
        id=product.pk,
        name=product.name,
        category_id=product.category_id,
        category_name=product.category.name if product.category_id else "",
        price=product.price,
        unit=product.unit,
        sold_by=product.sold_by,
        is_active=product.is_active,
        stock=stock.get(product.pk, ZERO),
        image_version=(product.image_version or "")[:16],
    )


def load_products(ids, *, active_only: bool = False) -> dict[int, ProductInfo]:
    """Current price and stock of the given products, read fresh."""
    ids = list(ids)
    if not ids:
        return {}
    products = _products().filter(pk__in=ids)
    if active_only:
        products = products.filter(is_active=True)
    stock = _stock_map(ids)
    return {p.pk: _to_info(p, stock) for p in products}


def load_catalog(*, fresh: bool = False) -> tuple[list[CategoryInfo], list[ProductInfo]]:
    """Every active product with its stock, plus the categories. Reused for a
    few seconds so a busy storefront does not query on every page view."""
    ttl = getattr(settings, "SHOP_CATALOG_CACHE_SECONDS", 5)
    if not fresh and ttl > 0:
        cached = cache.get(_CATALOG_CACHE_KEY)
        if cached is not None:
            return cached
    stock = _stock_map()
    products = [_to_info(p, stock) for p in _products().filter(is_active=True).order_by("name", "id")]
    categories = [CategoryInfo(id=c.pk, name=c.name) for c in Category.objects.order_by("name", "id")]
    result = (categories, products)
    if ttl > 0:
        cache.set(_CATALOG_CACHE_KEY, result, ttl)
    return result
