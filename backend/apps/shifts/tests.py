from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.common.models import AuditLog
from apps.inventory.models import Storage, apply_stock_change
from apps.products.models import Product

from .models import CashMovement, Shift
from .services import close_shift, expected_cash, open_shift, record_cash_movement

User = get_user_model()


class ShiftBase(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin", password="pass12345", role=User.Role.SUPERADMIN
        )
        self.cashier = User.objects.create_user(
            username="cash", password="pass12345", role=User.Role.CASHIER
        )
        self.storage = Storage.objects.create(name="Main", is_default=True)
        self.product = Product.objects.create(name="Cola", price=Decimal("5.00"))
        apply_stock_change(
            product=self.product, storage=self.storage, change=100,
            reason="PURCHASE", user=self.admin,
        )

    def auth(self, user):
        self.client.force_authenticate(user=user)


class ShiftLifecycleTests(ShiftBase):
    def test_open_shift_records_float_and_audit(self):
        shift = open_shift(user=self.cashier, opening_float=Decimal("100.00"))
        self.assertEqual(shift.status, Shift.Status.OPEN)
        self.assertEqual(expected_cash(shift), Decimal("100.00"))
        self.assertTrue(AuditLog.objects.filter(action="SHIFT_OPEN").exists())

    def test_cannot_open_two_shifts_on_one_terminal(self):
        open_shift(user=self.cashier, opening_float=Decimal("50.00"), terminal="T1")
        with self.assertRaises(Exception):
            open_shift(user=self.admin, opening_float=Decimal("50.00"), terminal="T1")

    def test_close_computes_variance_and_locks_shift(self):
        shift = open_shift(user=self.cashier, opening_float=Decimal("100.00"))
        report = close_shift(
            shift=shift, user=self.cashier, counted_cash=Decimal("95.00")
        )
        shift.refresh_from_db()
        self.assertEqual(shift.status, Shift.Status.CLOSED)
        self.assertEqual(shift.expected_cash, Decimal("100.00"))
        self.assertEqual(shift.variance, Decimal("-5.00"))  # drawer is 5 short
        self.assertEqual(report["variance"], "-5.00")
        self.assertTrue(AuditLog.objects.filter(action="SHIFT_CLOSE").exists())

    def test_cannot_close_twice(self):
        shift = open_shift(user=self.cashier, opening_float=Decimal("10.00"))
        close_shift(shift=shift, user=self.cashier, counted_cash=Decimal("10.00"))
        shift.refresh_from_db()
        with self.assertRaises(Exception):
            close_shift(shift=shift, user=self.cashier, counted_cash=Decimal("10.00"))


class CashMovementTests(ShiftBase):
    def test_pay_out_reduces_expected_cash(self):
        shift = open_shift(user=self.cashier, opening_float=Decimal("200.00"))
        record_cash_movement(
            shift=shift, user=self.cashier, kind="PAY_OUT",
            amount=Decimal("30.00"), reason="Window cleaner",
        )
        self.assertEqual(expected_cash(shift), Decimal("170.00"))

    def test_pay_in_increases_expected_cash(self):
        shift = open_shift(user=self.cashier, opening_float=Decimal("200.00"))
        record_cash_movement(
            shift=shift, user=self.cashier, kind="PAY_IN",
            amount=Decimal("25.00"), reason="Change from safe",
        )
        self.assertEqual(expected_cash(shift), Decimal("225.00"))

    def test_manual_movement_requires_a_reason(self):
        shift = open_shift(user=self.cashier, opening_float=Decimal("10.00"))
        with self.assertRaises(Exception):
            record_cash_movement(
                shift=shift, user=self.cashier, kind="PAY_OUT",
                amount=Decimal("5.00"), reason="",
            )

    def test_cannot_record_a_sale_movement_manually(self):
        shift = open_shift(user=self.cashier, opening_float=Decimal("10.00"))
        with self.assertRaises(Exception):
            record_cash_movement(
                shift=shift, user=self.cashier, kind="SALE",
                amount=Decimal("5.00"), reason="fiddling",
            )


class DrawerReconciliationTests(ShiftBase):
    """The end-to-end money path: sales and cash events must reconcile exactly."""

    def test_cash_sale_lands_in_the_drawer(self):
        shift = open_shift(user=self.cashier, opening_float=Decimal("100.00"))
        self.auth(self.cashier)
        resp = self.client.post(
            "/api/orders/",
            {
                "items": [{"product": self.product.id, "quantity": 4}],
                "payments": [
                    {"method": "CASH", "amount": "20.00", "tendered": "50.00"}
                ],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(Decimal(str(resp.data["change_given"])), Decimal("30.00"))
        # Only the 20.00 settled belongs in the drawer, not the 50 handed over.
        self.assertEqual(expected_cash(shift), Decimal("120.00"))

    def test_card_sale_does_not_touch_the_drawer(self):
        shift = open_shift(user=self.cashier, opening_float=Decimal("100.00"))
        self.auth(self.cashier)
        resp = self.client.post(
            "/api/orders/",
            {
                "items": [{"product": self.product.id, "quantity": 2}],
                "payments": [{"method": "CARD", "amount": "10.00", "reference": "auth-1"}],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(expected_cash(shift), Decimal("100.00"))

    def test_split_payment_only_posts_the_cash_portion(self):
        shift = open_shift(user=self.cashier, opening_float=Decimal("100.00"))
        self.auth(self.cashier)
        resp = self.client.post(
            "/api/orders/",
            {
                "items": [{"product": self.product.id, "quantity": 10}],  # 50.00
                "payments": [
                    {"method": "CASH", "amount": "20.00", "tendered": "20.00"},
                    {"method": "CARD", "amount": "30.00", "reference": "auth-2"},
                ],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(len(resp.data["payments"]), 2)
        self.assertEqual(expected_cash(shift), Decimal("120.00"))
        # Headline method is the larger tender, for the payment-breakdown report.
        self.assertEqual(resp.data["payment_method"], "CARD")

    def test_payments_must_equal_the_order_total(self):
        open_shift(user=self.cashier, opening_float=Decimal("100.00"))
        self.auth(self.cashier)
        resp = self.client.post(
            "/api/orders/",
            {
                "items": [{"product": self.product.id, "quantity": 4}],  # 20.00
                "payments": [{"method": "CASH", "amount": "15.00", "tendered": "15.00"}],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("payments", resp.data)

    def test_cash_sale_requires_an_open_shift(self):
        """Cash with no drawer open would be unattributable."""
        self.auth(self.cashier)
        resp = self.client.post(
            "/api/orders/",
            {
                "items": [{"product": self.product.id, "quantity": 1}],
                "payments": [{"method": "CASH", "amount": "5.00", "tendered": "5.00"}],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_full_shift_reconciles_to_zero_variance(self):
        shift = open_shift(user=self.cashier, opening_float=Decimal("100.00"))
        self.auth(self.cashier)
        self.client.post(
            "/api/orders/",
            {
                "items": [{"product": self.product.id, "quantity": 4}],  # 20.00
                "payments": [{"method": "CASH", "amount": "20.00", "tendered": "20.00"}],
            },
            format="json",
        )
        record_cash_movement(
            shift=shift, user=self.cashier, kind="PAY_OUT",
            amount=Decimal("15.00"), reason="Milk for the staff room",
        )
        # 100 float + 20 sale - 15 paid out = 105 expected
        report = close_shift(
            shift=shift, user=self.cashier, counted_cash=Decimal("105.00")
        )
        self.assertEqual(report["expected_cash"], "105.00")
        self.assertEqual(report["variance"], "0.00")
        self.assertEqual(report["sales_total"], "20.00")
        self.assertEqual(report["order_count"], 1)


class ShiftApiTests(ShiftBase):
    def test_open_and_close_via_api(self):
        self.auth(self.cashier)
        resp = self.client.post(
            "/api/shifts/open/", {"opening_float": "50.00", "terminal": "T1"},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        shift_id = resp.data["id"]

        current = self.client.get("/api/shifts/current/?terminal=T1")
        self.assertEqual(current.data["shift"]["number"], resp.data["number"])

        x = self.client.get(f"/api/shifts/{shift_id}/x-report/")
        self.assertEqual(x.status_code, 200)
        self.assertEqual(x.data["expected_cash"], "50.00")
        # An X report must not close the drawer.
        self.assertEqual(Shift.objects.get(pk=shift_id).status, Shift.Status.OPEN)

        z = self.client.post(
            f"/api/shifts/{shift_id}/close/", {"counted_cash": "50.00"}, format="json"
        )
        self.assertEqual(z.status_code, 200, z.data)
        self.assertEqual(z.data["variance"], "0.00")

    def test_cash_movements_are_admin_only(self):
        self.auth(self.cashier)
        resp = self.client.get("/api/cash-movements/")
        self.assertEqual(resp.status_code, 403)
