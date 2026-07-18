"""Operational reports: margin, per-cashier, hourly trade and CSV export.

These answer the questions a store owner actually asks — what did we make,
who sold it, when are we busy — none of which the sales-total chart covers.
"""
import csv
from datetime import timedelta
from decimal import Decimal

from django.db.models import Count, DecimalField, ExpressionWrapper, F, Sum
from django.db.models.functions import ExtractHour, TruncDate
from django.http import HttpResponse
from django.utils import timezone

from apps.orders.models import Order, OrderItem, Return

MONEY = Decimal("0.01")


def _money(value) -> Decimal:
    return Decimal(value or 0).quantize(MONEY)


def parse_range(params):
    """Resolve ?from=&to= into dates, defaulting to the last 30 days."""
    today = timezone.localdate()
    try:
        start = timezone.datetime.fromisoformat(params["from"]).date() if params.get("from") else today - timedelta(days=29)
    except ValueError:
        start = today - timedelta(days=29)
    try:
        end = timezone.datetime.fromisoformat(params["to"]).date() if params.get("to") else today
    except ValueError:
        end = today
    if start > end:
        start, end = end, start
    return start, end


def completed_orders(start, end):
    return Order.objects.filter(
        status__in=[
            Order.Status.COMPLETED,
            Order.Status.PARTIALLY_REFUNDED,
            Order.Status.REFUNDED,
        ],
        created_at__date__gte=start,
        created_at__date__lte=end,
    )


def margin_report(start, end) -> dict:
    """Revenue vs cost of goods, using the cost snapshotted at sale time."""
    orders = completed_orders(start, end)
    items = OrderItem.objects.filter(order__in=orders)

    cost_expr = ExpressionWrapper(
        F("unit_cost") * F("quantity"), output_field=DecimalField(max_digits=14, decimal_places=4)
    )
    totals = items.aggregate(
        revenue=Sum("line_total"),
        cost=Sum(cost_expr),
    )
    revenue = _money(totals["revenue"])
    cost = _money(totals["cost"])
    refunds = _money(
        Return.objects.filter(
            created_at__date__gte=start, created_at__date__lte=end
        ).aggregate(t=Sum("total"))["t"]
    )

    by_product = (
        items.values("product__name")
        .annotate(revenue=Sum("line_total"), cost=Sum(cost_expr), units=Sum("quantity"))
        .order_by("-revenue")[:20]
    )

    net = revenue - refunds
    gross = revenue - cost
    return {
        "from": start.isoformat(),
        "to": end.isoformat(),
        "revenue": str(revenue),
        "refunds": str(refunds),
        "net_revenue": str(net),
        "cost_of_goods": str(cost),
        "gross_margin": str(gross),
        "margin_percent": str(
            (gross / revenue * 100).quantize(MONEY) if revenue else Decimal("0.00")
        ),
        "by_product": [
            {
                "product": r["product__name"],
                "units": str(r["units"] or 0),
                "revenue": str(_money(r["revenue"])),
                "cost": str(_money(r["cost"])),
                "margin": str(_money(r["revenue"]) - _money(r["cost"])),
            }
            for r in by_product
        ],
    }


def cashier_report(start, end) -> dict:
    """Per-cashier performance, including voids and refunds.

    Void and refund counts sit next to sales deliberately: an outlier there is
    the first thing a manager wants to see.
    """
    orders = completed_orders(start, end)
    rows = (
        orders.values("created_by__username")
        .annotate(sales=Sum("total"), order_count=Count("id"))
        .order_by("-sales")
    )

    voids = dict(
        Order.objects.filter(
            status=Order.Status.VOIDED,
            created_at__date__gte=start,
            created_at__date__lte=end,
        )
        .values_list("created_by__username")
        .annotate(n=Count("id"))
    )
    refunds = dict(
        Return.objects.filter(created_at__date__gte=start, created_at__date__lte=end)
        .values_list("created_by__username")
        .annotate(n=Count("id"))
    )
    refund_values = dict(
        Return.objects.filter(created_at__date__gte=start, created_at__date__lte=end)
        .values_list("created_by__username")
        .annotate(t=Sum("total"))
    )

    data = []
    seen = set()
    for row in rows:
        name = row["created_by__username"] or "(deleted user)"
        seen.add(name)
        sales = _money(row["sales"])
        count = row["order_count"]
        data.append(
            {
                "cashier": name,
                "sales": str(sales),
                "order_count": count,
                "average_sale": str((sales / count).quantize(MONEY) if count else Decimal("0.00")),
                "voids": voids.get(name, 0),
                "refunds": refunds.get(name, 0),
                "refund_value": str(_money(refund_values.get(name))),
            }
        )

    # Someone whose every sale was voided has no completed orders, so they would
    # otherwise vanish from this report — which is exactly who a manager is
    # looking for. Include them with zero sales.
    for name in set(voids) | set(refunds):
        if name is None or name in seen:
            continue
        data.append(
            {
                "cashier": name,
                "sales": "0.00",
                "order_count": 0,
                "average_sale": "0.00",
                "voids": voids.get(name, 0),
                "refunds": refunds.get(name, 0),
                "refund_value": str(_money(refund_values.get(name))),
            }
        )
    return {"from": start.isoformat(), "to": end.isoformat(), "cashiers": data}


def hourly_report(start, end) -> dict:
    """Trade by hour of day — staffing and opening-hours evidence."""
    orders = completed_orders(start, end)
    rows = (
        orders.annotate(hour=ExtractHour("created_at"))
        .values("hour")
        .annotate(total=Sum("total"), count=Count("id"))
        .order_by("hour")
    )
    by_hour = {r["hour"]: r for r in rows}
    data = [
        {
            "hour": h,
            "total": str(_money(by_hour.get(h, {}).get("total"))),
            "order_count": by_hour.get(h, {}).get("count", 0),
        }
        for h in range(24)
    ]
    busiest = max(data, key=lambda d: Decimal(d["total"])) if data else None
    return {
        "from": start.isoformat(),
        "to": end.isoformat(),
        "data": data,
        "busiest_hour": busiest["hour"] if busiest else None,
    }


def daily_report(start, end) -> dict:
    orders = completed_orders(start, end)
    rows = (
        orders.annotate(day=TruncDate("created_at"))
        .values("day")
        .annotate(total=Sum("total"), count=Count("id"))
        .order_by("day")
    )
    return {
        "from": start.isoformat(),
        "to": end.isoformat(),
        "data": [
            {
                "date": r["day"].isoformat() if r["day"] else None,
                "total": str(_money(r["total"])),
                "order_count": r["count"],
            }
            for r in rows
        ],
    }


def sales_csv(start, end) -> HttpResponse:
    """Line-level export — what an accountant or spreadsheet actually needs."""
    response = HttpResponse(content_type="text/csv")
    response["Content-Disposition"] = (
        f'attachment; filename="sales_{start.isoformat()}_{end.isoformat()}.csv"'
    )
    writer = csv.writer(response)
    writer.writerow([
        "receipt", "date", "time", "cashier", "customer", "status",
        "product", "quantity", "unit", "unit_price", "line_discount",
        "line_total", "unit_cost", "line_margin", "order_total", "payment_methods",
    ])

    items = (
        OrderItem.objects.filter(order__in=completed_orders(start, end))
        .select_related("order", "product", "order__created_by", "order__customer")
        .prefetch_related("order__payments")
        .order_by("order__created_at", "id")
    )
    for item in items:
        order = item.order
        local = timezone.localtime(order.created_at)
        methods = "+".join(sorted({p.method for p in order.payments.all()}))
        writer.writerow([
            order.receipt_number or f"#{order.pk}",
            local.date().isoformat(),
            local.strftime("%H:%M:%S"),
            order.created_by.username if order.created_by else "",
            order.customer.name if order.customer else "",
            order.status,
            item.product.name,
            item.quantity,
            item.product.unit,
            item.unit_price,
            item.discount,
            item.line_total,
            item.unit_cost,
            _money(item.line_total - item.unit_cost * item.quantity),
            order.total,
            methods,
        ])
    return response


def stock_csv() -> HttpResponse:
    from apps.inventory.models import StockItem

    response = HttpResponse(content_type="text/csv")
    response["Content-Disposition"] = (
        f'attachment; filename="stock_{timezone.localdate().isoformat()}.csv"'
    )
    writer = csv.writer(response)
    writer.writerow([
        "product", "barcode", "category", "storage", "unit", "sold_by",
        "quantity", "reorder_level", "low_stock", "cost", "price", "stock_value",
    ])
    for item in (
        StockItem.objects.select_related("product", "storage", "product__category")
        .order_by("product__name")
    ):
        product = item.product
        writer.writerow([
            product.name,
            product.barcode or "",
            product.category.name if product.category else "",
            item.storage.name,
            product.unit,
            product.sold_by,
            item.quantity,
            item.reorder_level,
            "yes" if item.is_low else "no",
            product.cost,
            product.price,
            _money(item.quantity * product.cost),
        ])
    return response
