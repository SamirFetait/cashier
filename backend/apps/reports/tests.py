from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.inventory.models import Storage, apply_stock_change
from apps.products.models import Product
from apps.shifts.services import open_shift

User = get_user_model()

MANAGER_PIN = "4321"


class ReportsBase(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin", password="pass12345", role=User.Role.SUPERADMIN
        )
        self.admin.set_override_pin(MANAGER_PIN)
        self.admin.save()
        self.cashier = User.objects.create_user(
            username="cash", password="pass12345", role=User.Role.CASHIER
        )
        self.storage = Storage.objects.create(name="Main", is_default=True)
        self.product = Product.objects.create(
            name="Cola", price=Decimal("5.00"), cost=Decimal("2.00")
        )
        apply_stock_change(
            product=self.product, storage=self.storage, change=100,
            reason="PURCHASE", user=self.admin,
        )
        self.shift = open_shift(user=self.cashier, opening_float=Decimal("100.00"))
        self.client.force_authenticate(user=self.cashier)

    def sell(self, qty=4):
        total = Decimal("5.00") * qty
        resp = self.client.post(
            "/api/orders/",
            {
                "items": [{"product": self.product.id, "quantity": qty}],
                "payments": [
                    {"method": "CASH", "amount": str(total), "tendered": str(total)}
                ],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        return resp.data


class MarginReportTests(ReportsBase):
    def test_margin_uses_cost_snapshotted_at_sale_time(self):
        self.sell(qty=10)  # revenue 50.00, cost 20.00

        # Cost rises afterwards; the historic margin must not move.
        self.product.cost = Decimal("4.00")
        self.product.save()

        self.client.force_authenticate(user=self.admin)
        resp = self.client.get("/api/reports/margin/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["revenue"], "50.00")
        self.assertEqual(resp.data["cost_of_goods"], "20.00")
        self.assertEqual(resp.data["gross_margin"], "30.00")
        self.assertEqual(resp.data["margin_percent"], "60.00")

    def test_refunds_reduce_net_revenue(self):
        order = self.sell(qty=4)  # 20.00
        self.client.post(
            f"/api/orders/{order['id']}/return/",
            {
                "lines": [{"order_item": order["items"][0]["id"], "quantity": "2"}],
                "refund_method": "CASH",
                "reason": "returned",
                "override_pin": MANAGER_PIN,
            },
            format="json",
        )
        self.client.force_authenticate(user=self.admin)
        resp = self.client.get("/api/reports/margin/")
        self.assertEqual(resp.data["refunds"], "10.00")
        self.assertEqual(resp.data["net_revenue"], "10.00")

    def test_margin_report_is_admin_only(self):
        resp = self.client.get("/api/reports/margin/")
        self.assertEqual(resp.status_code, 403)


class CashierReportTests(ReportsBase):
    def test_reports_sales_and_average_per_cashier(self):
        self.sell(qty=4)  # 20.00
        self.sell(qty=2)  # 10.00
        self.client.force_authenticate(user=self.admin)
        resp = self.client.get("/api/reports/by-cashier/")
        self.assertEqual(resp.status_code, 200)
        row = next(r for r in resp.data["cashiers"] if r["cashier"] == "cash")
        self.assertEqual(row["sales"], "30.00")
        self.assertEqual(row["order_count"], 2)
        self.assertEqual(row["average_sale"], "15.00")

    def test_voids_and_refunds_are_attributed_to_the_cashier(self):
        order = self.sell(qty=2)
        self.client.post(
            f"/api/orders/{order['id']}/void/",
            {"reason": "mistake", "override_pin": MANAGER_PIN},
            format="json",
        )
        self.client.force_authenticate(user=self.admin)
        resp = self.client.get("/api/reports/by-cashier/")
        row = next(r for r in resp.data["cashiers"] if r["cashier"] == "cash")
        self.assertEqual(row["voids"], 1)


class HourlyReportTests(ReportsBase):
    def test_returns_all_24_hours(self):
        self.sell()
        resp = self.client.get("/api/reports/hourly/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data["data"]), 24)
        self.assertIsNotNone(resp.data["busiest_hour"])


class CsvExportTests(ReportsBase):
    def test_sales_csv_exports_one_row_per_line(self):
        self.sell(qty=3)
        self.client.force_authenticate(user=self.admin)
        resp = self.client.get("/api/reports/export/sales.csv")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Content-Type"], "text/csv")
        body = resp.content.decode()
        lines = [l for l in body.splitlines() if l.strip()]
        self.assertEqual(len(lines), 2)  # header + one item
        self.assertIn("Cola", lines[1])
        self.assertIn("R000001", lines[1])

    def test_stock_csv_includes_valuation(self):
        self.client.force_authenticate(user=self.admin)
        resp = self.client.get("/api/reports/export/stock.csv")
        self.assertEqual(resp.status_code, 200)
        body = resp.content.decode()
        self.assertIn("stock_value", body)
        self.assertIn("Cola", body)

    def test_csv_export_is_admin_only(self):
        resp = self.client.get("/api/reports/export/sales.csv")
        self.assertEqual(resp.status_code, 403)


class AuditLogViewTests(ReportsBase):
    def test_audit_log_shows_actor_and_authoriser(self):
        order = self.sell(qty=2)
        self.client.post(
            f"/api/orders/{order['id']}/void/",
            {"reason": "mistake", "override_pin": MANAGER_PIN},
            format="json",
        )
        self.client.force_authenticate(user=self.admin)
        resp = self.client.get("/api/audit-log/?action=VOID")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data[0]["actor"], "cash")
        self.assertEqual(resp.data[0]["authorised_by"], "admin")

    def test_audit_log_is_admin_only(self):
        resp = self.client.get("/api/audit-log/")
        self.assertEqual(resp.status_code, 403)
