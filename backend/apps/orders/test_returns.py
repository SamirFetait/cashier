from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.common.models import AuditLog
from apps.inventory.models import StockItem, StockMovement, Storage, apply_stock_change
from apps.products.models import Product
from apps.shifts.services import close_shift, expected_cash, open_shift

from .models import Order, Return

User = get_user_model()

MANAGER_PIN = "4321"


class ReturnsBase(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin", password="pass12345", role=User.Role.SUPERADMIN
        )
        # Voids and refunds need a manager PIN (see apps.accounts.overrides).
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

    def sell(self, qty=4, discount="0.00"):
        total = (Decimal("5.00") * qty) - Decimal(discount)
        resp = self.client.post(
            "/api/orders/",
            {
                "items": [
                    {"product": self.product.id, "quantity": qty, "discount": discount}
                ],
                "payments": [
                    {"method": "CASH", "amount": str(total), "tendered": str(total)}
                ],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        return resp.data

    def stock(self):
        return StockItem.objects.get(product=self.product, storage=self.storage).quantity


class VoidTests(ReturnsBase):
    def test_void_restocks_and_reverses_cash(self):
        order = self.sell(qty=4)  # 20.00
        self.assertEqual(self.stock(), 96)
        self.assertEqual(expected_cash(self.shift), Decimal("120.00"))

        resp = self.client.post(
            f"/api/orders/{order['id']}/void/",
            {"reason": "Rang up twice", "override_pin": MANAGER_PIN}, format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["status"], "VOIDED")
        self.assertEqual(self.stock(), 100)  # goods back
        self.assertEqual(expected_cash(self.shift), Decimal("100.00"))  # cash back out
        self.assertTrue(AuditLog.objects.filter(action="VOID").exists())

    def test_void_requires_a_reason(self):
        order = self.sell()
        resp = self.client.post(f"/api/orders/{order['id']}/void/", {}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_cannot_void_twice(self):
        order = self.sell()
        self.client.post(
            f"/api/orders/{order['id']}/void/", {"reason": "mistake", "override_pin": MANAGER_PIN}, format="json"
        )
        resp = self.client.post(
            f"/api/orders/{order['id']}/void/", {"reason": "again", "override_pin": MANAGER_PIN}, format="json"
        )
        self.assertEqual(resp.status_code, 400)

    def test_cannot_void_once_the_shift_is_closed(self):
        """After close the drawer is reconciled — corrections must be returns."""
        order = self.sell()
        close_shift(shift=self.shift, user=self.cashier, counted_cash=Decimal("120.00"))
        resp = self.client.post(
            f"/api/orders/{order['id']}/void/", {"reason": "late", "override_pin": MANAGER_PIN}, format="json"
        )
        self.assertEqual(resp.status_code, 400)

    def test_void_writes_a_reversing_ledger_entry(self):
        order = self.sell(qty=2)
        self.client.post(
            f"/api/orders/{order['id']}/void/", {"reason": "mistake", "override_pin": MANAGER_PIN}, format="json"
        )
        self.assertTrue(
            StockMovement.objects.filter(reason="VOID", change=Decimal("2.000")).exists()
        )


class ReturnTests(ReturnsBase):
    def test_full_return_restocks_refunds_and_marks_order(self):
        order = self.sell(qty=4)  # 20.00
        item_id = order["items"][0]["id"]

        resp = self.client.post(
            f"/api/orders/{order['id']}/return/",
            {
                "lines": [{"order_item": item_id, "quantity": "4"}],
                "refund_method": "CASH",
                "reason": "Customer changed their mind",
                "override_pin": MANAGER_PIN,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(Decimal(resp.data["total"]), Decimal("20.00"))
        self.assertEqual(self.stock(), 100)
        self.assertEqual(expected_cash(self.shift), Decimal("100.00"))
        self.assertEqual(Order.objects.get(pk=order["id"]).status, "REFUNDED")

    def test_partial_return_marks_order_partially_refunded(self):
        order = self.sell(qty=4)
        item_id = order["items"][0]["id"]
        resp = self.client.post(
            f"/api/orders/{order['id']}/return/",
            {
                "lines": [{"order_item": item_id, "quantity": "1"}],
                "refund_method": "CASH",
                "reason": "One was damaged",
                "override_pin": MANAGER_PIN,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(Decimal(resp.data["total"]), Decimal("5.00"))
        self.assertEqual(self.stock(), 97)
        self.assertEqual(Order.objects.get(pk=order["id"]).status, "PARTIALLY_REFUNDED")

    def test_cannot_return_more_than_was_sold(self):
        order = self.sell(qty=2)
        item_id = order["items"][0]["id"]
        resp = self.client.post(
            f"/api/orders/{order['id']}/return/",
            {
                "lines": [{"order_item": item_id, "quantity": "5"}],
                "refund_method": "CASH",
                "reason": "trying it on",
                "override_pin": MANAGER_PIN,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.stock(), 98)  # untouched

    def test_cannot_refund_the_same_item_twice(self):
        """The guard that stops a customer being paid out repeatedly."""
        order = self.sell(qty=2)
        item_id = order["items"][0]["id"]
        payload = {
            "lines": [{"order_item": item_id, "quantity": "2"}],
            "refund_method": "CASH",
            "reason": "returned",
            "override_pin": MANAGER_PIN,
        }
        first = self.client.post(
            f"/api/orders/{order['id']}/return/", payload, format="json"
        )
        self.assertEqual(first.status_code, 201, first.data)
        second = self.client.post(
            f"/api/orders/{order['id']}/return/", payload, format="json"
        )
        self.assertEqual(second.status_code, 400)
        self.assertEqual(Return.objects.count(), 1)

    def test_discounted_line_refunds_at_the_price_actually_paid(self):
        """A 20.00 sale discounted to 16.00 must refund 4.00/unit, not 5.00."""
        order = self.sell(qty=4, discount="4.00")  # 16.00 for 4 units
        item_id = order["items"][0]["id"]
        resp = self.client.post(
            f"/api/orders/{order['id']}/return/",
            {
                "lines": [{"order_item": item_id, "quantity": "1"}],
                "refund_method": "CASH",
                "reason": "one back",
                "override_pin": MANAGER_PIN,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(Decimal(resp.data["total"]), Decimal("4.00"))

    def test_damaged_goods_can_be_refunded_without_restocking(self):
        order = self.sell(qty=2)
        item_id = order["items"][0]["id"]
        resp = self.client.post(
            f"/api/orders/{order['id']}/return/",
            {
                "lines": [{"order_item": item_id, "quantity": "2"}],
                "refund_method": "CASH",
                "reason": "Arrived broken",
                "override_pin": MANAGER_PIN,
                "restock": False,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(self.stock(), 98)  # money back, goods written off
        self.assertEqual(expected_cash(self.shift), Decimal("100.00"))

    def test_card_refund_does_not_touch_the_drawer(self):
        order = self.sell(qty=2)
        item_id = order["items"][0]["id"]
        before = expected_cash(self.shift)
        resp = self.client.post(
            f"/api/orders/{order['id']}/return/",
            {
                "lines": [{"order_item": item_id, "quantity": "2"}],
                "refund_method": "CARD",
                "reason": "back to card",
                "override_pin": MANAGER_PIN,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(expected_cash(self.shift), before)

    def test_returnable_endpoint_tracks_remaining_quantity(self):
        order = self.sell(qty=4)
        item_id = order["items"][0]["id"]
        self.client.post(
            f"/api/orders/{order['id']}/return/",
            {
                "lines": [{"order_item": item_id, "quantity": "1"}],
                "refund_method": "CASH",
                "reason": "one back",
                "override_pin": MANAGER_PIN,
            },
            format="json",
        )
        resp = self.client.get(f"/api/orders/{order['id']}/returnable/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["lines"][0]["returnable"], "3.000")

    def test_cannot_return_against_a_voided_sale(self):
        order = self.sell(qty=2)
        item_id = order["items"][0]["id"]
        self.client.post(
            f"/api/orders/{order['id']}/void/", {"reason": "mistake", "override_pin": MANAGER_PIN}, format="json"
        )
        resp = self.client.post(
            f"/api/orders/{order['id']}/return/",
            {
                "lines": [{"order_item": item_id, "quantity": "1"}],
                "refund_method": "CASH",
                "reason": "double dipping",
                "override_pin": MANAGER_PIN,
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_return_appears_on_the_shift_report(self):
        order = self.sell(qty=2)
        item_id = order["items"][0]["id"]
        self.client.post(
            f"/api/orders/{order['id']}/return/",
            {
                "lines": [{"order_item": item_id, "quantity": "1"}],
                "refund_method": "CASH",
                "reason": "one back",
                "override_pin": MANAGER_PIN,
            },
            format="json",
        )
        resp = self.client.get(f"/api/shifts/{self.shift.id}/x-report/")
        self.assertEqual(resp.data["refund_count"], 1)
