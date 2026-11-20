"""Pricing a cart: the one place that decides what a basket costs.

The storefront shows the same sums straight away (shared/money.ts in the website repo
mirrors these rules), but an order is only ever created from the figures
worked out here, from the current prices and stock.
"""
from dataclasses import dataclass, field
from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal, InvalidOperation

from django.db.models import Sum

from . import catalog, prizes
from .catalog import ProductInfo
from .models import GamePrize, Listing, ShopSettings, WebOrder, WebOrderItem

MONEY = Decimal("0.01")
POUND = Decimal("1")
ZERO = Decimal("0.00")
QTY = Decimal("0.001")

# Weighed goods (kg, litres) are ordered in quarter units.
WEIGHT_STEP = Decimal("0.250")
# The most one order may take of a single product, and of distinct products.
MAX_LINE_QTY = Decimal("50")
MAX_LINES = 60
# "Only N left" shows at or below this.
LOW_STOCK_AT = Decimal("5")


def line_total(price: Decimal, quantity: Decimal) -> Decimal:
    """Exactly the cashier's line arithmetic, so the two always agree."""
    return (price * quantity).quantize(MONEY)


def takes_deposit(fulfilment: str) -> bool:
    """Only delivery is paid for up front. A pickup order is accepted at once
    and paid in full at the counter, so it needs no InstaPay at all."""
    return fulfilment == WebOrder.Fulfilment.DELIVERY


def deposit_for(subtotal: Decimal, settings: ShopSettings) -> Decimal:
    """The deposit on a delivery: a share of the goods, rounded up to a whole
    pound (nobody transfers piastres), at least the minimum, never more than
    the goods."""
    share = (subtotal * settings.deposit_percent / Decimal(100)).quantize(
        POUND, rounding=ROUND_CEILING
    )
    deposit = max(share, settings.deposit_min)
    return min(deposit, subtotal).quantize(MONEY)


def delivery_fee_for(subtotal: Decimal, fulfilment: str, settings: ShopSettings) -> Decimal:
    if fulfilment != WebOrder.Fulfilment.DELIVERY:
        return ZERO
    free_over = settings.free_delivery_over
    if free_over is not None and subtotal >= free_over:
        return ZERO
    return settings.delivery_fee.quantize(MONEY)


def reserved_quantities(product_ids=None) -> dict[int, Decimal]:
    """Stock held back by open web orders, per product.

    Checkout knows nothing of these until the sale is rung up, so the
    website subtracts them itself to avoid promising the same goods twice.
    """
    rows = WebOrderItem.objects.filter(order__status__in=WebOrder.RESERVING)
    if product_ids is not None:
        rows = rows.filter(product_id__in=list(product_ids))
    return {
        row["product_id"]: row["total"] or ZERO
        for row in rows.values("product_id").annotate(total=Sum("quantity"))
    }


def orderable_quantity(info: ProductInfo, reserved: Decimal = ZERO) -> Decimal:
    """How much of this product one order may take right now."""
    free = min(max(info.stock - reserved, ZERO), MAX_LINE_QTY)
    if info.is_weighed:
        steps = (free / WEIGHT_STEP).to_integral_value(rounding=ROUND_FLOOR)
        return (steps * WEIGHT_STEP).quantize(QTY)
    return free.to_integral_value(rounding=ROUND_FLOOR).quantize(QTY)


def is_low_stock(orderable: Decimal) -> bool:
    return ZERO < orderable <= LOW_STOCK_AT


def hidden_product_ids() -> set[int]:
    return set(Listing.objects.filter(hidden=True).values_list("product_id", flat=True))


@dataclass
class QuoteLine:
    product_id: int
    quantity: Decimal
    name: str = ""
    unit: str = ""
    sold_by: str = "UNIT"
    unit_price: Decimal = ZERO
    line_total: Decimal = ZERO
    max_quantity: Decimal = ZERO
    image_version: str = ""
    # "" when the line can be ordered as it stands, otherwise one of
    # UNAVAILABLE, OUT_OF_STOCK, INSUFFICIENT, INVALID_QUANTITY.
    issue: str = ""


@dataclass
class Quote:
    fulfilment: str
    lines: list[QuoteLine] = field(default_factory=list)
    subtotal: Decimal = ZERO
    # A game prize's share off the goods; zero on goods under its minimum.
    discount: Decimal = ZERO
    prize_code: str = ""
    delivery_fee: Decimal = ZERO
    total: Decimal = ZERO
    # Always zero for pickup.
    deposit: Decimal = ZERO
    balance: Decimal = ZERO
    # Reasons the cart as a whole cannot be ordered: EMPTY, ORDERING_DISABLED,
    # INSTAPAY_NOT_CONFIGURED (delivery only), FULFILMENT_UNAVAILABLE,
    # MIN_ORDER, LINE_ISSUES.
    problems: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.problems


class InvalidCart(ValueError):
    """The items could not even be read (not a list, bad ids, too many)."""


def parse_items(raw_items) -> dict[int, Decimal | None]:
    """``[{"id": 3, "qty": "2"}]`` to ``{3: Decimal("2.000")}``.

    Repeated products are added together. A quantity that cannot be read maps
    to None so the line can be reported instead of failing the whole cart.
    """
    if not isinstance(raw_items, list):
        raise InvalidCart("items must be a list.")
    if len(raw_items) > MAX_LINES * 2:
        raise InvalidCart("Too many items.")
    merged: dict[int, Decimal | None] = {}
    for raw in raw_items:
        if not isinstance(raw, dict):
            raise InvalidCart("Each item must be an object.")
        try:
            product_id = int(raw.get("id"))
        except (TypeError, ValueError):
            raise InvalidCart("Each item needs a product id.")
        if product_id <= 0:
            raise InvalidCart("Each item needs a product id.")
        quantity = _parse_quantity(raw.get("qty"))
        if product_id in merged:
            previous = merged[product_id]
            quantity = None if previous is None or quantity is None else previous + quantity
        merged[product_id] = quantity
    if len(merged) > MAX_LINES:
        raise InvalidCart(f"An order can hold at most {MAX_LINES} different products.")
    return merged


def _parse_quantity(raw) -> Decimal | None:
    if isinstance(raw, bool) or raw is None:
        return None
    try:
        value = Decimal(str(raw).strip())
    except (InvalidOperation, ValueError):
        return None
    if not value.is_finite() or value <= 0 or value > Decimal("100000"):
        return None
    if value != value.quantize(QTY):
        return None  # more precision than the cashier stores
    return value.quantize(QTY)


def _quantity_is_valid(info: ProductInfo, quantity: Decimal | None) -> bool:
    if quantity is None:
        return False
    if info.is_weighed:
        return quantity % WEIGHT_STEP == 0
    return quantity == quantity.to_integral_value()


def default_fulfilment(settings: ShopSettings) -> str:
    if settings.delivery_enabled or not settings.pickup_enabled:
        return WebOrder.Fulfilment.DELIVERY
    return WebOrder.Fulfilment.PICKUP


def build_quote(
    raw_items, fulfilment: str | None, settings: ShopSettings | None = None, prize: GamePrize | None = None
) -> Quote:
    """Price a cart against live prices and stock, less a game prize when one
    is given. The prize comes off the goods, and the deposit is a share of
    what is left; free delivery and the minimum order go by the goods in
    full."""
    settings = settings or ShopSettings.load()
    wanted = parse_items(raw_items)

    if fulfilment not in WebOrder.Fulfilment.values:
        fulfilment = default_fulfilment(settings)
    quote = Quote(fulfilment=fulfilment)

    products = catalog.load_products(wanted.keys(), active_only=True)
    hidden = hidden_product_ids() if products else set()
    reserved = reserved_quantities(products.keys()) if products else {}

    for product_id, quantity in wanted.items():
        info = products.get(product_id)
        if info is None or product_id in hidden:
            quote.lines.append(
                QuoteLine(product_id=product_id, quantity=quantity or ZERO, issue="UNAVAILABLE")
            )
            continue
        orderable = orderable_quantity(info, reserved.get(product_id, ZERO))
        line = QuoteLine(
            product_id=product_id,
            quantity=quantity or ZERO,
            name=info.name,
            unit=info.unit,
            sold_by=info.sold_by,
            unit_price=info.price,
            max_quantity=orderable,
            image_version=info.image_version,
        )
        if not _quantity_is_valid(info, quantity):
            line.issue = "INVALID_QUANTITY"
        elif orderable <= 0:
            line.issue = "OUT_OF_STOCK"
        elif quantity > orderable:
            line.issue = "INSUFFICIENT"
        else:
            line.line_total = line_total(info.price, quantity)
        quote.lines.append(line)

    quote.subtotal = sum((l.line_total for l in quote.lines if not l.issue), ZERO).quantize(MONEY)
    if prize is not None:
        quote.prize_code = prize.code
        quote.discount = prizes.discount_for(prize, quote.subtotal)
    goods = quote.subtotal - quote.discount
    quote.delivery_fee = delivery_fee_for(quote.subtotal, fulfilment, settings)
    quote.total = goods + quote.delivery_fee
    quote.deposit = deposit_for(goods, settings) if takes_deposit(fulfilment) else ZERO
    quote.balance = quote.total - quote.deposit

    if not settings.ordering_enabled:
        quote.problems.append("ORDERING_DISABLED")
    elif takes_deposit(fulfilment) and not settings.instapay_ready:
        quote.problems.append("INSTAPAY_NOT_CONFIGURED")
    if not quote.lines:
        quote.problems.append("EMPTY")
    if any(l.issue for l in quote.lines):
        quote.problems.append("LINE_ISSUES")
    enabled = settings.delivery_enabled if fulfilment == WebOrder.Fulfilment.DELIVERY else settings.pickup_enabled
    if not enabled:
        quote.problems.append("FULFILMENT_UNAVAILABLE")
    if quote.lines and quote.subtotal < settings.min_order:
        quote.problems.append("MIN_ORDER")
    return quote
