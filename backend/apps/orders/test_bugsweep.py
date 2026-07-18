"""Scratch: prove suspected bugs before fixing them."""
from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.inventory.models import Storage, apply_stock_change
from apps.products.models import Product
from apps.reports.analytics import hourly_report
from apps.shifts.services import open_shift, shift_report

from .models import Order

User = get_user_model()
PIN = "4321"


class BugSweep(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin", password="pass12345", role=User.Role.SUPERADMIN
        )
        self.admin.set_override_pin(PIN)
        self.admin.save()
        self.storage = Storage.objects.create(name="Main", is_default=True)
        # 10.00 over 3 units -> 3.3333 per unit: does not divide evenly.
        self.product = Product.objects.create(
            name="Rice", price=Decimal("10.00"), cost=Decimal("4.00")
        )
        apply_stock_change(
            product=self.product, storage=self.storage, change=100,
            reason="PURCHASE", user=self.admin,
        )
        self.shift = open_shift(user=self.admin, opening_float=Decimal("100.00"))
        self.client.force_authenticate(user=self.admin)

    def test_bug1_full_return_of_indivisible_line_misrefunds(self):
        """3 x 10.00 = 30.00, discounted by 10.00 -> line_total 20.00 over 3 units."""
        resp = self.client.post(
            "/api/orders/",
            {
                "items": [{"product": self.product.id, "quantity": 3, "discount": "10.00"}],
                "payments": [{"method": "CASH", "amount": "20.00", "tendered": "20.00"}],
                "override_pin": PIN,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        order = resp.data
        item_id = order["items"][0]["id"]
        self.assertEqual(order["total"], "20.00")

        ret = self.client.post(
            f"/api/orders/{order['id']}/return/",
            {
                "lines": [{"order_item": item_id, "quantity": 3}],
                "refund_method": "CASH",
                "reason": "changed mind",
                "override_pin": PIN,
            },
            format="json",
        )
        self.assertEqual(ret.status_code, 201, ret.data)
        # The customer paid 20.00 and returned everything: they must get 20.00.
        self.assertEqual(
            ret.data["total"], "20.00",
            f"BUG: refunded {ret.data['total']} for a fully-returned 20.00 sale",
        )

    def test_bug2_mobile_payment_writes_invalid_order_payment_method(self):
        resp = self.client.post(
            "/api/orders/",
            {
                "items": [{"product": self.product.id, "quantity": 1}],
                "payments": [{"method": "MOBILE", "amount": "10.00"}],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        order = Order.objects.get(pk=resp.data["id"])
        valid = {c[0] for c in Order.Payment.choices}
        self.assertIn(
            order.payment_method, valid,
            f"BUG: payment_method={order.payment_method!r} is not one of {valid}",
        )

    def test_bug3_voided_sale_still_counted_in_shift_payment_breakdown(self):
        resp = self.client.post(
            "/api/orders/",
            {
                "items": [{"product": self.product.id, "quantity": 1}],
                "payments": [{"method": "CASH", "amount": "10.00", "tendered": "10.00"}],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        void = self.client.post(
            f"/api/orders/{resp.data['id']}/void/",
            {"reason": "mistake", "override_pin": PIN},
            format="json",
        )
        self.assertEqual(void.status_code, 200, void.data)

        report = shift_report(self.shift)
        self.assertEqual(report["sales_total"], "0.00")
        cash = next((p for p in report["payments"] if p["method"] == "CASH"), None)
        self.assertIsNone(
            cash,
            f"BUG: voided sale still in payment breakdown: {report['payments']}",
        )

    def test_bug4_busiest_hour_on_a_dead_day(self):
        from datetime import date

        report = hourly_report(date(2020, 1, 1), date(2020, 1, 1))
        self.assertIsNone(
            report["busiest_hour"],
            f"BUG: busiest_hour={report['busiest_hour']} with no trade at all",
        )
