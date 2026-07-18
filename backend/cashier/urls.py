from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.accounts.views import UserViewSet, MeView, LoginView, RefreshView
from apps.products.views import CategoryViewSet, ProductViewSet
from apps.inventory.views import StorageViewSet, StockItemViewSet, StockMovementViewSet
from apps.customers.views import CustomerViewSet
from apps.suppliers.views import SupplierViewSet
from apps.orders.views import OrderViewSet, ReturnViewSet
from apps.shifts.views import CashMovementViewSet, ShiftViewSet
from apps.purchasing.views import GoodsReceiptViewSet, PurchaseOrderViewSet, StockTakeViewSet
from apps.whatsapp.views import WhatsAppStatusView, SupplierWhatsAppView
from apps.reports.views import (
    SummaryView, MonthlySalesView, LowStockView, MarginReportView,
    CashierReportView, HourlySalesView, DailySalesView, SalesCsvView,
    StockCsvView, AuditLogView,
)
from apps.hqsync.views import BranchView, DailyReportViewSet, SendDailyReportNowView

router = DefaultRouter()
router.register("users", UserViewSet, basename="user")
router.register("categories", CategoryViewSet, basename="category")
router.register("products", ProductViewSet, basename="product")
router.register("storages", StorageViewSet, basename="storage")
router.register("stock", StockItemViewSet, basename="stock")
router.register("stock-movements", StockMovementViewSet, basename="stockmovement")
router.register("customers", CustomerViewSet, basename="customer")
router.register("suppliers", SupplierViewSet, basename="supplier")
router.register("orders", OrderViewSet, basename="order")
router.register("returns", ReturnViewSet, basename="return")
router.register("purchase-orders", PurchaseOrderViewSet, basename="purchaseorder")
router.register("goods-receipts", GoodsReceiptViewSet, basename="goodsreceipt")
router.register("stock-takes", StockTakeViewSet, basename="stocktake")
router.register("shifts", ShiftViewSet, basename="shift")
router.register("cash-movements", CashMovementViewSet, basename="cashmovement")
router.register("daily-reports", DailyReportViewSet, basename="dailyreport")

api_patterns = [
    path("auth/login/", LoginView.as_view(), name="login"),
    path("auth/refresh/", RefreshView.as_view(), name="refresh"),
    path("auth/me/", MeView.as_view(), name="me"),
    path("whatsapp/status/", WhatsAppStatusView.as_view(), name="whatsapp-status"),
    path("suppliers/<int:pk>/whatsapp/", SupplierWhatsAppView.as_view(), name="supplier-whatsapp"),
    path("reports/summary/", SummaryView.as_view(), name="reports-summary"),
    path("reports/monthly-sales/", MonthlySalesView.as_view(), name="reports-monthly-sales"),
    path("reports/low-stock/", LowStockView.as_view(), name="reports-low-stock"),
    path("reports/margin/", MarginReportView.as_view(), name="reports-margin"),
    path("reports/by-cashier/", CashierReportView.as_view(), name="reports-cashier"),
    path("reports/hourly/", HourlySalesView.as_view(), name="reports-hourly"),
    path("reports/daily/", DailySalesView.as_view(), name="reports-daily"),
    path("reports/export/sales.csv", SalesCsvView.as_view(), name="reports-sales-csv"),
    path("reports/export/stock.csv", StockCsvView.as_view(), name="reports-stock-csv"),
    path("audit-log/", AuditLogView.as_view(), name="audit-log"),
    path("branch/", BranchView.as_view(), name="branch"),
    path("daily-reports/send-now/", SendDailyReportNowView.as_view(), name="daily-report-send-now"),
    path("", include(router.urls)),
]

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include(api_patterns)),
]
