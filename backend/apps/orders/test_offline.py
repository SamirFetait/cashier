from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.inventory.models import StockItem, Storage, apply_stock_change
from apps.products.models import Product
from apps.shifts.services import expected_cash, open_shift

from .models import Order

User = get_user_model()

UUID_A = "11111111-1111-4111-8111-111111111111"
UUID_B = "22222222-2222-4222-8222-222222222222"


class OfflineSyncTests(APITestCase):
    """Replaying a queued sale must never ring it up twice."""

    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin", password="pass12345", role=User.Role.SUPERADMIN
        )
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

    def post_sale(self, client_uuid=None, qty=4, was_offline=False):
        total = Decimal("5.00") * qty
        body = {
            "items": [{"product": self.product.id, "quantity": qty}],
            "payments": [
                {"method": "CASH", "amount": str(total), "tendered": str(total)}
            ],
            "was_offline": was_offline,
        }
        if client_uuid:
            body["client_uuid"] = client_uuid
        return self.client.post("/api/orders/", body, format="json")

    def stock(self):
        return StockItem.objects.get(
            product=self.product, storage=self.storage
        ).quantity

    def test_replaying_the_same_client_uuid_does_not_duplicate(self):
        first = self.post_sale(UUID_A, qty=4)
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(self.stock(), 96)

        # The till never saw the response and replays the queued sale.
        second = self.post_sale(UUID_A, qty=4)
        self.assertEqual(second.status_code, 200)  # 200, not 201 — nothing new
        self.assertEqual(second.data["id"], first.data["id"])
        self.assertEqual(second.data["receipt_number"], first.data["receipt_number"])

        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(self.stock(), 96)  # stock moved once
        self.assertEqual(expected_cash(self.shift), Decimal("120.00"))  # cash once

    def test_different_uuids_create_separate_sales(self):
        self.post_sale(UUID_A, qty=2)
        self.post_sale(UUID_B, qty=2)
        self.assertEqual(Order.objects.count(), 2)
        self.assertEqual(self.stock(), 96)

    def test_sale_without_a_uuid_still_works(self):
        """Older clients and the browser build do not send one."""
        resp = self.post_sale(qty=1)
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertIsNone(Order.objects.get(pk=resp.data["id"]).client_uuid)

    def test_offline_sales_are_flagged(self):
        resp = self.post_sale(UUID_A, qty=1, was_offline=True)
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertTrue(Order.objects.get(pk=resp.data["id"]).was_offline)

    def test_replay_is_rejected_when_stock_ran_out_while_offline(self):
        """The queue must surface this rather than silently overselling."""
        StockItem.objects.filter(
            product=self.product, storage=self.storage
        ).update(quantity=Decimal("1.000"))

        resp = self.post_sale(UUID_A, qty=5)
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(Order.objects.count(), 0)

    def test_replayed_sale_keeps_its_original_receipt_number(self):
        first = self.post_sale(UUID_A, qty=1)
        self.post_sale(UUID_B, qty=1)
        replay = self.post_sale(UUID_A, qty=1)
        self.assertEqual(replay.data["receipt_number"], first.data["receipt_number"])
