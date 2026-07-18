from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.common.models import AuditLog
from apps.inventory.models import StockItem, Storage, apply_stock_change
from apps.products.models import Product
from .models import Order

User = get_user_model()


class BaseSetup(APITestCase):
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
            product=self.product, storage=self.storage, change=10,
            reason="PURCHASE", user=self.admin,
        )

    def auth(self, user):
        self.client.force_authenticate(user=user)


class PermissionTests(BaseSetup):
    def test_cashier_cannot_create_product(self):
        self.auth(self.cashier)
        resp = self.client.post("/api/products/", {"name": "X", "price": "1.00"})
        self.assertEqual(resp.status_code, 403)

    def test_cashier_can_read_products(self):
        self.auth(self.cashier)
        resp = self.client.get("/api/products/")
        self.assertEqual(resp.status_code, 200)

    def test_admin_can_create_product(self):
        self.auth(self.admin)
        resp = self.client.post("/api/products/", {"name": "Y", "price": "2.00"})
        self.assertEqual(resp.status_code, 201)


class CheckoutTests(BaseSetup):
    def test_order_decrements_stock(self):
        self.auth(self.cashier)
        resp = self.client.post(
            "/api/orders/",
            {"items": [{"product": self.product.id, "quantity": 3}]},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(Decimal(str(resp.data["total"])), Decimal("15.00"))
        stock = StockItem.objects.get(product=self.product, storage=self.storage)
        self.assertEqual(stock.quantity, 7)

    def test_insufficient_stock_rolls_back(self):
        self.auth(self.cashier)
        resp = self.client.post(
            "/api/orders/",
            {"items": [{"product": self.product.id, "quantity": 99}]},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(Order.objects.count(), 0)
        stock = StockItem.objects.get(product=self.product, storage=self.storage)
        self.assertEqual(stock.quantity, 10)  # unchanged


class WeighedGoodsTests(BaseSetup):
    def setUp(self):
        super().setUp()
        self.cheese = Product.objects.create(
            name="Cheese", price=Decimal("20.00"), unit="kg",
            sold_by=Product.SoldBy.WEIGHT,
        )
        apply_stock_change(
            product=self.cheese, storage=self.storage, change=Decimal("5.000"),
            reason="PURCHASE", user=self.admin,
        )

    def test_weighed_product_accepts_fractional_quantity(self):
        self.auth(self.cashier)
        resp = self.client.post(
            "/api/orders/",
            {"items": [{"product": self.cheese.id, "quantity": "1.250"}]},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(Decimal(str(resp.data["total"])), Decimal("25.00"))
        stock = StockItem.objects.get(product=self.cheese, storage=self.storage)
        self.assertEqual(stock.quantity, Decimal("3.750"))

    def test_unit_product_rejects_fractional_quantity(self):
        self.auth(self.cashier)
        resp = self.client.post(
            "/api/orders/",
            {"items": [{"product": self.product.id, "quantity": "0.500"}]},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(Order.objects.count(), 0)


class DiscountTests(BaseSetup):
    def test_order_discount_cannot_exceed_subtotal(self):
        """Regression: an over-large discount used to write a negative total."""
        self.auth(self.cashier)
        resp = self.client.post(
            "/api/orders/",
            {
                "items": [{"product": self.product.id, "quantity": 1}],
                "discount": "9999.00",
            },
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(Order.objects.count(), 0)
        stock = StockItem.objects.get(product=self.product, storage=self.storage)
        self.assertEqual(stock.quantity, 10)  # no stock leaked out

    def test_line_discount_cannot_exceed_line_total(self):
        self.auth(self.cashier)
        resp = self.client.post(
            "/api/orders/",
            {"items": [{"product": self.product.id, "quantity": 1, "discount": "500.00"}]},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_line_discount_reduces_total_and_is_audited(self):
        self.auth(self.cashier)
        resp = self.client.post(
            "/api/orders/",
            {"items": [{"product": self.product.id, "quantity": 2, "discount": "2.00"}]},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(Decimal(str(resp.data["total"])), Decimal("8.00"))
        self.assertTrue(
            AuditLog.objects.filter(action="DISCOUNT", actor=self.cashier).exists()
        )


class ReceiptNumberTests(BaseSetup):
    def test_receipt_numbers_are_sequential_and_unique(self):
        self.auth(self.cashier)
        numbers = []
        for _ in range(3):
            resp = self.client.post(
                "/api/orders/",
                {"items": [{"product": self.product.id, "quantity": 1}]},
                format="json",
            )
            self.assertEqual(resp.status_code, 201, resp.data)
            numbers.append(resp.data["receipt_number"])
        self.assertEqual(numbers, ["R000001", "R000002", "R000003"])

    def test_failed_checkout_does_not_consume_a_receipt_number(self):
        """Gapless numbering: a rolled-back sale must not burn a number."""
        self.auth(self.cashier)
        self.client.post(
            "/api/orders/",
            {"items": [{"product": self.product.id, "quantity": 1}]},
            format="json",
        )
        self.client.post(
            "/api/orders/",
            {"items": [{"product": self.product.id, "quantity": 999}]},
            format="json",
        )
        resp = self.client.post(
            "/api/orders/",
            {"items": [{"product": self.product.id, "quantity": 1}]},
            format="json",
        )
        self.assertEqual(resp.data["receipt_number"], "R000002")


class CostSnapshotTests(BaseSetup):
    def test_unit_cost_is_snapshotted_at_sale_time(self):
        self.product.cost = Decimal("3.00")
        self.product.save()
        self.auth(self.cashier)
        resp = self.client.post(
            "/api/orders/",
            {"items": [{"product": self.product.id, "quantity": 2}]},
            format="json",
        )
        self.assertEqual(resp.status_code, 201, resp.data)

        # Cost rises later — the historic order must keep the original margin.
        self.product.cost = Decimal("9.00")
        self.product.save()

        order = Order.objects.get(pk=resp.data["id"])
        item = order.items.first()
        self.assertEqual(item.unit_cost, Decimal("3.00"))
        self.assertEqual(order.gross_margin, Decimal("4.00"))


class ReportsTests(BaseSetup):
    def test_monthly_sales_returns_twelve_months(self):
        self.auth(self.admin)
        resp = self.client.get("/api/reports/monthly-sales/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data["data"]), 12)
