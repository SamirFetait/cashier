"""Shared test scaffolding: a small catalogue, staff accounts, and helpers
that drive the website's API the way the two web apps do."""
from decimal import Decimal
from io import BytesIO
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings
from PIL import Image
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.inventory.models import Storage, apply_stock_change
from apps.products.models import Category, Product
from apps.webshop.models import ShopSettings, WebOrder
from apps.whatsapp.client import WhatsAppError

PASSWORD = "secret-pass-123"
SHOP = "/api/shop"


def png_bytes(size=(60, 40), color=(40, 180, 170)) -> BytesIO:
    buffer = BytesIO()
    Image.new("RGB", size, color).save(buffer, "PNG")
    buffer.seek(0)
    buffer.name = "shot.png"
    return buffer


def make_product(name, price, *, stock=None, storage=None, category=None, unit="pcs", sold_by="UNIT", user=None):
    category_obj = Category.objects.get_or_create(name=category)[0] if category else None
    product = Product.objects.create(
        name=name, price=Decimal(str(price)), cost=Decimal(str(price)) * Decimal("0.6"),
        category=category_obj, unit=unit, sold_by=sold_by,
    )
    if stock is not None:
        apply_stock_change(product=product, storage=storage, change=Decimal(str(stock)), reason="PURCHASE", user=user)
    return product


@override_settings(
    SHOP_CATALOG_CACHE_SECONDS=0, SHOP_STORAGE_ID=None, SHOP_TERMINAL="",
    SHOP_SITE_URL="https://shop.example", REQUIRE_OPEN_SHIFT=False,
    # Staff sign in many times per test; the real hasher is slow on purpose.
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
)
class ShopTestCase(TestCase):
    def setUp(self):
        cache.clear()  # rate limits, the catalogue cache and the expiry guard
        # Never reach a real WhatsApp sidecar; tests that care patch these again.
        for target in ("apps.whatsapp.client.get_status", "apps.webshop.alerts.send_message"):
            patcher = mock.patch(target, side_effect=WhatsAppError("not running in tests"))
            patcher.start()
            self.addCleanup(patcher.stop)
        self.admin_user = User.objects.create_user(
            "samir", password=PASSWORD, role=User.Role.SUPERADMIN, is_superuser=True, is_staff=True
        )
        self.admin_user.set_override_pin("4321")
        self.admin_user.save()
        self.cashier_user = User.objects.create_user("cashier", password=PASSWORD, role=User.Role.CASHIER)

        self.storage = Storage.objects.create(name="Main Store", is_default=True)
        self.honey = make_product("Sidr Honey 500g", "250.00", stock=10, storage=self.storage, category="Honey")
        self.dates = make_product("Medjool Dates 1kg", "180.00", stock=4, storage=self.storage, category="Dates")
        self.olives = make_product(
            "Olives", "45.00", stock="9.500", storage=self.storage, category="Deli", unit="kg", sold_by="WEIGHT"
        )
        settings = ShopSettings.load()
        settings.instapay_address = "fatheetkheer@instapay"
        settings.instapay_name = "Fathet Kheer"
        settings.deposit_percent = 50
        settings.save()
        self.client = APIClient()

    def shop_settings(self, **fields) -> ShopSettings:
        settings = ShopSettings.load()
        for name, value in fields.items():
            setattr(settings, name, value)
        settings.save()
        return settings

    # --- storefront helpers ---
    def place(self, items=None, **overrides):
        """A delivery by default: the order that goes through the deposit.
        Pass fulfilment="PICKUP" for one that is accepted at once."""
        body = {
            "name": "Mona Ali",
            "phone": "0101 234 5678",
            "fulfilment": "DELIVERY",
            "address": "12 Nile St, Maadi",
            "items": [{"id": self.honey.pk, "qty": "2"}] if items is None else items,
        }
        body.update(overrides)
        return self.client.post(f"{SHOP}/orders/", body, format="json")

    def place_ok(self, items=None, **overrides) -> dict:
        response = self.place(items, **overrides)
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()["order"]

    def track(self, order) -> dict:
        response = self.client.get(f"{SHOP}/orders/{order['code']}/?t={order['token']}")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["order"]

    def pay(self, order, reference="123456789012", **extra):
        return self.client.post(
            f"{SHOP}/orders/{order['code']}/deposit/",
            {"t": order["token"], "reference": reference, **extra},
            format="multipart",
        )

    def pk_of(self, order) -> int:
        return WebOrder.objects.get(code=order["code"]).pk

    # --- staff helpers ---
    def staff_client(self, username="samir") -> APIClient:
        """Signs in through the cashier's own login, as the orders admin does."""
        client = APIClient()
        response = client.post("/api/auth/login/", {"username": username, "password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.json()['access']}")
        return client

    def act(self, client, order_id, action, body=None):
        return client.post(f"{SHOP}/admin/orders/{order_id}/{action}/", body or {}, format="json")

    def confirmed_order(self, client=None, items=None, **overrides):
        """A web order whose deposit was sent and confirmed.
        Returns (public order, admin order, staff client)."""
        order = self.place_ok(items, **overrides)
        self.assertEqual(self.pay(order).status_code, 200)
        client = client or self.staff_client()
        response = self.act(client, self.pk_of(order), "confirm-deposit", {"amount": order["deposit_required"]})
        self.assertEqual(response.status_code, 200, response.content)
        return order, response.json()["order"], client
