from django.db.models import F, Sum
from django.db.models.functions import TruncMonth
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.inventory.models import StockItem
from apps.orders.models import Order


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
