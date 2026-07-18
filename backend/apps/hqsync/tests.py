from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from apps.inventory.models import Storage, apply_stock_change
from apps.orders.models import Order, OrderItem
from apps.products.models import Product

from .models import DailyReport
from .services import build_report, run_daily_sync, send_report

User = get_user_model()


class FakeResponse:
    def __init__(self, status_code, text=""):
        self.status_code = status_code
        self.text = text


class HqSyncTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user("a", password="p", role=User.Role.SUPERADMIN)
        self.cashier = User.objects.create_user("c", password="p", role=User.Role.CASHIER)
        self.storage = Storage.objects.create(name="Main", is_default=True)
        self.product = Product.objects.create(name="Cola", price=Decimal("5.00"))
        apply_stock_change(product=self.product, storage=self.storage, change=10, reason="PURCHASE")
        order = Order.objects.create(storage=self.storage, created_by=self.cashier, payment_method="CASH")
        OrderItem.objects.create(
            order=order, product=self.product, quantity=2,
            unit_price=Decimal("5.00"), line_total=Decimal("10.00"),
        )
        order.subtotal = Decimal("10.00")
        order.total = Decimal("10.00")
        order.save()

    def test_build_report_aggregates_today(self):
        report = build_report(timezone.localdate())
        self.assertEqual(report.order_count, 1)
        self.assertEqual(report.sales_total, Decimal("10.00"))
        self.assertEqual(report.payload["payment_breakdown"]["CASH"], "10.00")
        self.assertEqual(report.payload["top_products"][0]["product"], "Cola")
        self.assertEqual(report.status, DailyReport.Status.PENDING)

    @override_settings(HQ_API_URL="http://hq.test", HQ_API_KEY="k")
    @patch("apps.hqsync.services.requests.post", return_value=FakeResponse(201))
    def test_send_report_success(self, mock_post):
        report = build_report(timezone.localdate())
        ok = send_report(report)
        self.assertTrue(ok)
        report.refresh_from_db()
        self.assertEqual(report.status, DailyReport.Status.SENT)
        self.assertIsNotNone(report.sent_at)
        mock_post.assert_called_once()

    @override_settings(HQ_API_URL="")
    def test_send_report_unconfigured_fails(self):
        report = build_report(timezone.localdate())
        self.assertFalse(send_report(report))
        report.refresh_from_db()
        self.assertEqual(report.status, DailyReport.Status.FAILED)

    def test_send_now_requires_superadmin(self):
        self.client.force_authenticate(self.cashier)
        self.assertEqual(self.client.post("/api/daily-reports/send-now/").status_code, 403)

    @override_settings(HQ_API_URL="http://hq.test", HQ_API_KEY="k")
    @patch("apps.hqsync.services.requests.post", return_value=FakeResponse(200))
    def test_run_daily_sync_is_idempotent(self, mock_post):
        run_daily_sync()
        run_daily_sync()  # second run must not create a duplicate
        self.assertEqual(DailyReport.objects.filter(date=timezone.localdate()).count(), 1)
