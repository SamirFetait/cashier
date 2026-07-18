"""Build the end-of-day report and push it to the central HQ."""
from __future__ import annotations

from datetime import date as date_cls
from decimal import Decimal

import requests
from django.conf import settings
from django.db.models import Count, F, Sum
from django.utils import timezone

from apps.inventory.models import StockItem
from apps.orders.models import Order, OrderItem

from .models import DailyReport


def _d(value) -> str:
    return str(Decimal(value or 0).quantize(Decimal("0.01")))


def build_payload(report_date: date_cls) -> dict:
    completed = Order.objects.filter(
        status=Order.Status.COMPLETED, created_at__date=report_date
    )

    totals = completed.aggregate(total=Sum("total"), count=Count("id"))
    sales_total = totals["total"] or Decimal("0")
    order_count = totals["count"] or 0

    payment_rows = completed.values("payment_method").annotate(total=Sum("total"))
    payment_breakdown = {r["payment_method"]: _d(r["total"]) for r in payment_rows}

    top_rows = (
        OrderItem.objects.filter(order__in=completed)
        .values("product__name")
        .annotate(quantity=Sum("quantity"), revenue=Sum("line_total"))
        .order_by("-quantity")[:10]
    )
    top_products = [
        {
            "product": r["product__name"],
            "quantity": r["quantity"],
            "revenue": _d(r["revenue"]),
        }
        for r in top_rows
    ]

    low_stock_rows = (
        StockItem.objects.filter(quantity__lte=F("reorder_level"))
        .select_related("product", "storage")
        .order_by("quantity")
    )
    low_stock = [
        {
            "product": s.product.name,
            "storage": s.storage.name,
            "quantity": s.quantity,
            "reorder_level": s.reorder_level,
        }
        for s in low_stock_rows
    ]

    return {
        "branch_code": settings.BRANCH_CODE,
        "branch_name": settings.BRANCH_NAME,
        "date": report_date.isoformat(),
        "sales_total": _d(sales_total),
        "order_count": order_count,
        "payment_breakdown": payment_breakdown,
        "top_products": top_products,
        "low_stock": low_stock,
        "generated_at": timezone.now().isoformat(),
    }


def build_report(report_date: date_cls) -> DailyReport:
    """Create or refresh the DailyReport for a date and mark it ready to send."""
    payload = build_payload(report_date)
    report, _ = DailyReport.objects.update_or_create(
        date=report_date,
        defaults={
            "payload": payload,
            "sales_total": Decimal(payload["sales_total"]),
            "order_count": payload["order_count"],
            "status": DailyReport.Status.PENDING,
        },
    )
    return report


def send_report(report: DailyReport) -> bool:
    """Push one report to HQ. Returns True on success."""
    report.attempts += 1
    if not settings.HQ_API_URL:
        report.status = DailyReport.Status.FAILED
        report.last_error = "HQ_API_URL is not configured."
        report.save(update_fields=["attempts", "status", "last_error", "updated_at"])
        return False

    url = settings.HQ_API_URL.rstrip("/") + "/api/ingest/daily-report/"
    headers = {
        "X-Branch-Code": settings.BRANCH_CODE,
        "X-Api-Key": settings.HQ_API_KEY,
    }
    try:
        resp = requests.post(url, json=report.payload, headers=headers, timeout=30)
        if 200 <= resp.status_code < 300:
            report.status = DailyReport.Status.SENT
            report.sent_at = timezone.now()
            report.last_error = ""
        else:
            report.status = DailyReport.Status.FAILED
            report.last_error = f"HTTP {resp.status_code}: {resp.text[:500]}"
    except requests.RequestException as exc:
        report.status = DailyReport.Status.FAILED
        report.last_error = str(exc)[:500]

    report.save(update_fields=["attempts", "status", "sent_at", "last_error", "updated_at"])
    return report.status == DailyReport.Status.SENT


def run_daily_sync(report_date: date_cls | None = None) -> dict:
    """Build today's report and (re)send any pending/failed reports.

    Idempotent: HQ upserts by (branch, date) so re-sends never double-count.
    """
    report_date = report_date or timezone.localdate()
    build_report(report_date)

    pending = DailyReport.objects.exclude(status=DailyReport.Status.SENT)
    sent, failed = 0, 0
    for report in pending:
        if send_report(report):
            sent += 1
        else:
            failed += 1
    return {"date": report_date.isoformat(), "sent": sent, "failed": failed}
