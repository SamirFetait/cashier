from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.common.models import AuditLog
from apps.inventory.models import StockItem, StockMovement, Storage, apply_stock_change
from apps.products.models import Product
from apps.suppliers.models import Supplier

from .models import PurchaseOrder, StockTake
from .services import apply_stock_take, start_stock_take

User = get_user_model()


class PurchasingBase(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin", password="pass12345", role=User.Role.SUPERADMIN
        )
        self.cashier = User.objects.create_user(
            username="cash", password="pass12345", role=User.Role.CASHIER
        )
        self.storage = Storage.objects.create(name="Main", is_default=True)
        self.supplier = Supplier.objects.create(name="Acme", phone_number="0100")
        self.product = Product.objects.create(
            name="Cola", price=Decimal("5.00"), cost=Decimal("2.00")
        )
        self.cheese = Product.objects.create(
            name="Cheese", price=Decimal("80.00"), cost=Decimal("50.00"),
            unit="kg", sold_by=Product.SoldBy.WEIGHT,
        )
        apply_stock_change(
            product=self.product, storage=self.storage, change=10,
            reason="PURCHASE", user=self.admin,
        )
        self.client.force_authenticate(user=self.admin)

    def stock(self, product=None):
        return StockItem.objects.get(
            product=product or self.product, storage=self.storage
        ).quantity

    def make_po(self, qty=20, unit_cost="2.50", product=None):
        resp = self.client.post(
            "/api/purchase-orders/",
            {
                "supplier": self.supplier.id,
                "storage": self.storage.id,
                "items": [
                    {
                        "product": (product or self.product).id,
                        "quantity_ordered": str(qty),
                        "unit_cost": unit_cost,
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        return resp.data


class PurchaseOrderTests(PurchasingBase):
    def test_creating_a_po_numbers_it_and_totals_the_cost(self):
        po = self.make_po(qty=20, unit_cost="2.50")
        self.assertEqual(po["number"], "PO00001")
        self.assertEqual(Decimal(po["total_cost"]), Decimal("50.00"))
        self.assertEqual(po["status"], "DRAFT")

    def test_po_does_not_move_stock_until_received(self):
        self.make_po(qty=20)
        self.assertEqual(self.stock(), 10)

    def test_cashier_cannot_create_a_po(self):
        self.client.force_authenticate(user=self.cashier)
        resp = self.client.post(
            "/api/purchase-orders/",
            {"supplier": self.supplier.id, "storage": self.storage.id, "items": []},
            format="json",
        )
        self.assertEqual(resp.status_code, 403)

    def test_unit_product_rejects_a_fractional_order(self):
        resp = self.client.post(
            "/api/purchase-orders/",
            {
                "supplier": self.supplier.id,
                "storage": self.storage.id,
                "items": [
                    {
                        "product": self.product.id,
                        "quantity_ordered": "1.5",
                        "unit_cost": "2.00",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_duplicate_product_lines_are_rejected(self):
        resp = self.client.post(
            "/api/purchase-orders/",
            {
                "supplier": self.supplier.id,
                "storage": self.storage.id,
                "items": [
                    {"product": self.product.id, "quantity_ordered": "5", "unit_cost": "2.00"},
                    {"product": self.product.id, "quantity_ordered": "3", "unit_cost": "2.00"},
                ],
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)


class GoodsReceiptTests(PurchasingBase):
    def test_receiving_adds_stock_and_closes_the_po(self):
        po = self.make_po(qty=20, unit_cost="2.50")
        item_id = po["items"][0]["id"]

        resp = self.client.post(
            f"/api/purchase-orders/{po['id']}/receive/",
            {
                "lines": [{"purchase_order_item": item_id, "quantity": "20"}],
                "supplier_reference": "DN-4471",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data["number"], "GR00001")
        self.assertEqual(self.stock(), 30)  # 10 + 20
        self.assertEqual(
            PurchaseOrder.objects.get(pk=po["id"]).status, "RECEIVED"
        )
        self.assertTrue(
            StockMovement.objects.filter(reason="PURCHASE", reference="GR00001").exists()
        )

    def test_partial_delivery_leaves_the_po_open(self):
        po = self.make_po(qty=20)
        item_id = po["items"][0]["id"]
        resp = self.client.post(
            f"/api/purchase-orders/{po['id']}/receive/",
            {"lines": [{"purchase_order_item": item_id, "quantity": "8"}]},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(self.stock(), 18)
        po_obj = PurchaseOrder.objects.get(pk=po["id"])
        self.assertEqual(po_obj.status, "PARTIAL")
        self.assertEqual(po_obj.items.first().outstanding, Decimal("12.000"))

    def test_cannot_receive_more_than_ordered(self):
        """Stops a delivery quietly inflating stock beyond the order."""
        po = self.make_po(qty=10)
        item_id = po["items"][0]["id"]
        resp = self.client.post(
            f"/api/purchase-orders/{po['id']}/receive/",
            {"lines": [{"purchase_order_item": item_id, "quantity": "25"}]},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(self.stock(), 10)  # untouched

    def test_receiving_at_a_new_price_updates_product_cost(self):
        po = self.make_po(qty=10, unit_cost="2.50")
        item_id = po["items"][0]["id"]
        self.client.post(
            f"/api/purchase-orders/{po['id']}/receive/",
            {
                "lines": [
                    {"purchase_order_item": item_id, "quantity": "10", "unit_cost": "3.10"}
                ]
            },
            format="json",
        )
        self.product.refresh_from_db()
        self.assertEqual(self.product.cost, Decimal("3.10"))
        self.assertTrue(AuditLog.objects.filter(action="PRICE_CHANGE").exists())

    def test_weighed_goods_can_be_received_fractionally(self):
        po = self.make_po(qty="12.500", unit_cost="50.00", product=self.cheese)
        item_id = po["items"][0]["id"]
        resp = self.client.post(
            f"/api/purchase-orders/{po['id']}/receive/",
            {"lines": [{"purchase_order_item": item_id, "quantity": "12.500"}]},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(self.stock(self.cheese), Decimal("12.500"))

    def test_cannot_receive_against_a_cancelled_po(self):
        po = self.make_po(qty=5)
        self.client.post(f"/api/purchase-orders/{po['id']}/cancel/")
        resp = self.client.post(
            f"/api/purchase-orders/{po['id']}/receive/",
            {"lines": [{"purchase_order_item": po["items"][0]["id"], "quantity": "5"}]},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_cannot_cancel_a_po_that_has_deliveries(self):
        po = self.make_po(qty=10)
        self.client.post(
            f"/api/purchase-orders/{po['id']}/receive/",
            {"lines": [{"purchase_order_item": po["items"][0]["id"], "quantity": "4"}]},
            format="json",
        )
        resp = self.client.post(f"/api/purchase-orders/{po['id']}/cancel/")
        self.assertEqual(resp.status_code, 400)


class StockTakeTests(PurchasingBase):
    def test_starting_a_count_snapshots_expected_levels(self):
        take = start_stock_take(storage=self.storage, user=self.admin)
        line = take.lines.get(product=self.product)
        self.assertEqual(line.expected_quantity, Decimal("10.000"))
        self.assertEqual(line.counted_quantity, Decimal("10.000"))
        self.assertEqual(line.variance, Decimal("0"))

    def test_applying_a_shortfall_writes_a_correction(self):
        take = start_stock_take(storage=self.storage, user=self.admin)
        line = take.lines.get(product=self.product)
        line.counted_quantity = Decimal("7.000")  # three missing
        line.save()

        result = apply_stock_take(take=take, user=self.admin)
        self.assertEqual(result["lines_adjusted"], 1)
        self.assertEqual(result["net_variance"], "-3.000")
        self.assertEqual(self.stock(), Decimal("7.000"))
        self.assertTrue(
            StockMovement.objects.filter(
                reason="STOCKTAKE", change=Decimal("-3.000")
            ).exists()
        )

    def test_matching_count_adjusts_nothing(self):
        take = start_stock_take(storage=self.storage, user=self.admin)
        result = apply_stock_take(take=take, user=self.admin)
        self.assertEqual(result["lines_adjusted"], 0)
        self.assertEqual(self.stock(), Decimal("10.000"))

    def test_cannot_apply_a_stock_take_twice(self):
        take = start_stock_take(storage=self.storage, user=self.admin)
        apply_stock_take(take=take, user=self.admin)
        take.refresh_from_db()
        with self.assertRaises(Exception):
            apply_stock_take(take=take, user=self.admin)

    def test_variances_endpoint_lists_only_discrepancies(self):
        take = start_stock_take(storage=self.storage, user=self.admin)
        line = take.lines.get(product=self.product)
        line.counted_quantity = Decimal("12.000")
        line.save()

        resp = self.client.get(f"/api/stock-takes/{take.id}/variances/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data["variances"]), 1)
        self.assertEqual(resp.data["variances"][0]["variance"], "2.000")

    def test_count_endpoint_records_without_applying(self):
        take = start_stock_take(storage=self.storage, user=self.admin)
        line = take.lines.get(product=self.product)
        resp = self.client.post(
            f"/api/stock-takes/{take.id}/count/",
            {"counts": [{"line": line.id, "counted_quantity": "6"}]},
            format="json",
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        line.refresh_from_db()
        self.assertEqual(line.counted_quantity, Decimal("6.000"))
        self.assertEqual(self.stock(), Decimal("10.000"))  # not applied yet
        self.assertEqual(StockTake.objects.get(pk=take.pk).status, "COUNTING")

    def test_stock_takes_are_admin_only(self):
        self.client.force_authenticate(user=self.cashier)
        resp = self.client.get("/api/stock-takes/")
        self.assertEqual(resp.status_code, 403)
