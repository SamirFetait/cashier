from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from apps.common.models import AuditLog
from apps.inventory.models import Storage, apply_stock_change
from apps.orders.models import Order
from apps.products.models import Product
from apps.shifts.services import open_shift

User = get_user_model()


class OverrideBase(APITestCase):
    def setUp(self):
        self.manager = User.objects.create_user(
            username="boss", password="pass12345", role=User.Role.SUPERADMIN
        )
        self.manager.set_override_pin("4321")
        self.manager.save()

        self.cashier = User.objects.create_user(
            username="cash", password="pass12345", role=User.Role.CASHIER
        )
        self.storage = Storage.objects.create(name="Main", is_default=True)
        self.product = Product.objects.create(name="Cola", price=Decimal("5.00"))
        apply_stock_change(
            product=self.product, storage=self.storage, change=100,
            reason="PURCHASE", user=self.manager,
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


class PinStorageTests(OverrideBase):
    def test_pin_is_hashed_not_stored_raw(self):
        self.manager.refresh_from_db()
        self.assertNotIn("4321", self.manager.override_pin)
        self.assertTrue(self.manager.check_override_pin("4321"))
        self.assertFalse(self.manager.check_override_pin("0000"))

    def test_pin_is_never_returned_by_the_api(self):
        self.client.force_authenticate(user=self.manager)
        resp = self.client.get(f"/api/users/{self.manager.id}/")
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn("override_pin", resp.data)
        self.assertTrue(resp.data["has_override_pin"])


class VoidOverrideTests(OverrideBase):
    def test_cashier_cannot_void_without_a_pin(self):
        order = self.sell()
        resp = self.client.post(
            f"/api/orders/{order['id']}/void/", {"reason": "mistake"}, format="json"
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("override_pin", resp.data)
        self.assertEqual(Order.objects.get(pk=order["id"]).status, "COMPLETED")

    def test_wrong_pin_is_refused_and_recorded(self):
        order = self.sell()
        resp = self.client.post(
            f"/api/orders/{order['id']}/void/",
            {"reason": "mistake", "override_pin": "9999"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertTrue(
            AuditLog.objects.filter(action="LOGIN_FAILED", actor=self.cashier).exists()
        )

    def test_correct_pin_authorises_and_names_both_people(self):
        order = self.sell()
        resp = self.client.post(
            f"/api/orders/{order['id']}/void/",
            {"reason": "mistake", "override_pin": "4321"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        entry = AuditLog.objects.filter(action="VOID").first()
        self.assertEqual(entry.actor, self.cashier)
        self.assertEqual(entry.authorised_by, self.manager)

    def test_manager_does_not_need_their_own_pin(self):
        order = self.sell()
        self.client.force_authenticate(user=self.manager)
        resp = self.client.post(
            f"/api/orders/{order['id']}/void/", {"reason": "mistake"}, format="json"
        )
        self.assertEqual(resp.status_code, 200, resp.data)


class RefundOverrideTests(OverrideBase):
    def test_cashier_cannot_refund_without_a_pin(self):
        order = self.sell(qty=2)
        resp = self.client.post(
            f"/api/orders/{order['id']}/return/",
            {
                "lines": [{"order_item": order["items"][0]["id"], "quantity": "1"}],
                "refund_method": "CASH",
                "reason": "returned",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("override_pin", resp.data)

    def test_refund_with_pin_succeeds(self):
        order = self.sell(qty=2)
        resp = self.client.post(
            f"/api/orders/{order['id']}/return/",
            {
                "lines": [{"order_item": order["items"][0]["id"], "quantity": "1"}],
                "refund_method": "CASH",
                "reason": "returned",
                "override_pin": "4321",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)


@override_settings(DISCOUNT_OVERRIDE_AMOUNT=Decimal("50"), DISCOUNT_OVERRIDE_PERCENT=Decimal("20"))
class DiscountOverrideTests(OverrideBase):
    def test_small_discount_needs_no_override(self):
        resp = self.client.post(
            "/api/orders/",
            {
                "items": [{"product": self.product.id, "quantity": 20}],  # 100.00
                "discount": "5.00",  # 5% — under both thresholds
                "payments": [{"method": "CASH", "amount": "95.00", "tendered": "95.00"}],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)

    def test_discount_over_percentage_threshold_needs_a_pin(self):
        resp = self.client.post(
            "/api/orders/",
            {
                "items": [{"product": self.product.id, "quantity": 20}],  # 100.00
                "discount": "30.00",  # 30% — over the 20% limit
                "payments": [{"method": "CASH", "amount": "70.00", "tendered": "70.00"}],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("override_pin", resp.data)
        self.assertEqual(Order.objects.count(), 0)

    def test_large_discount_with_pin_is_recorded_against_the_manager(self):
        resp = self.client.post(
            "/api/orders/",
            {
                "items": [{"product": self.product.id, "quantity": 20}],
                "discount": "30.00",
                "override_pin": "4321",
                "payments": [{"method": "CASH", "amount": "70.00", "tendered": "70.00"}],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        entry = AuditLog.objects.filter(action="DISCOUNT").first()
        self.assertEqual(entry.actor, self.cashier)
        self.assertEqual(entry.authorised_by, self.manager)
