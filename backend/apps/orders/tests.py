from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

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


class ReportsTests(BaseSetup):
    def test_monthly_sales_returns_twelve_months(self):
        self.auth(self.admin)
        resp = self.client.get("/api/reports/monthly-sales/")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data["data"]), 12)
