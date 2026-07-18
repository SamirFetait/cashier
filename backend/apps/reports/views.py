from django.db.models import F, Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsSuperAdmin
from apps.common.models import AuditLog
from apps.inventory.models import StockItem
from apps.orders.models import Order

from . import analytics


class SummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        now = timezone.localtime()
        today = now.date()
        completed = Order.objects.filter(status=Order.Status.COMPLETED)

        today_total = completed.filter(created_at__date=today).aggregate(
            t=Sum("total")
        )["t"] or 0
        month_qs = completed.filter(
            created_at__year=now.year, created_at__month=now.month
        )
        month_total = month_qs.aggregate(t=Sum("total"))["t"] or 0
        low_stock_count = StockItem.objects.filter(
            quantity__lte=F("reorder_level")
        ).count()

        return Response(
            {
                "today_total": today_total,
                "month_total": month_total,
                "month_order_count": month_qs.count(),
                "low_stock_count": low_stock_count,
            }
        )


class MonthlySalesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        year = int(request.query_params.get("year", timezone.localtime().year))
        rows = (
            Order.objects.filter(
                status=Order.Status.COMPLETED, created_at__year=year
            )
            .annotate(month=TruncMonth("created_at"))
            .values("month")
            .annotate(total=Sum("total"))
            .order_by("month")
        )
        by_month = {r["month"].month: float(r["total"] or 0) for r in rows if r["month"]}
        data = [
            {"month": m, "total": by_month.get(m, 0.0)} for m in range(1, 13)
        ]
        return Response({"year": year, "data": data})


class MarginReportView(APIView):
    """Revenue vs cost of goods sold. Admin-only — it exposes margins."""

    permission_classes = [IsSuperAdmin]

    def get(self, request):
        start, end = analytics.parse_range(request.query_params)
        return Response(analytics.margin_report(start, end))


class CashierReportView(APIView):
    permission_classes = [IsSuperAdmin]

    def get(self, request):
        start, end = analytics.parse_range(request.query_params)
        return Response(analytics.cashier_report(start, end))


class HourlySalesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        start, end = analytics.parse_range(request.query_params)
        return Response(analytics.hourly_report(start, end))


class DailySalesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        start, end = analytics.parse_range(request.query_params)
        return Response(analytics.daily_report(start, end))


class SalesCsvView(APIView):
    permission_classes = [IsSuperAdmin]

    def get(self, request):
        start, end = analytics.parse_range(request.query_params)
        return analytics.sales_csv(start, end)


class StockCsvView(APIView):
    permission_classes = [IsSuperAdmin]

    def get(self, request):
        return analytics.stock_csv()


class AuditLogView(APIView):
    """Who did what. Admin-only, read-only, newest first."""

    permission_classes = [IsSuperAdmin]

    def get(self, request):
        entries = AuditLog.objects.select_related("actor", "authorised_by")
        action = request.query_params.get("action")
        if action:
            entries = entries.filter(action=action)
        actor = request.query_params.get("actor")
        if actor:
            entries = entries.filter(actor__username=actor)
        limit = min(int(request.query_params.get("limit", 100)), 500)
        return Response([
            {
                "id": e.id,
                "action": e.action,
                "actor": e.actor.username if e.actor else None,
                "authorised_by": e.authorised_by.username if e.authorised_by else None,
                "object_type": e.object_type,
                "object_id": e.object_id,
                "summary": e.summary,
                "detail": e.detail,
                "created_at": e.created_at.isoformat(),
            }
            for e in entries[:limit]
        ])


class LowStockView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        items = (
            StockItem.objects.filter(quantity__lte=F("reorder_level"))
            .select_related("product", "storage")
            .order_by("quantity")
        )
        return Response(
            [
                {
                    "product": i.product_id,
                    "product_name": i.product.name,
                    "storage_name": i.storage.name,
                    "quantity": i.quantity,
                    "reorder_level": i.reorder_level,
                }
                for i in items
            ]
        )
