from datetime import timedelta
from decimal import Decimal
from io import BytesIO, StringIO

from django.core.management import call_command
from django.utils import timezone

from apps.inventory.models import StockItem
from apps.products.models import Product, ProductImage
from apps.webshop import services
from apps.webshop.models import DepositProof, Listing, StoredImage, WebOrder

from .base import SHOP, ShopTestCase, png_bytes

D = Decimal


class CatalogTests(ShopTestCase):
    def test_config_tells_the_storefront_the_rules(self):
        data = self.client.get(f"{SHOP}/config/").json()
        self.assertEqual(data["ordering"], {"enabled": True, "reason": ""})
        self.assertEqual(data["deposit"]["percent"], 50)
        self.assertEqual(data["limits"]["weight_step"], "0.250")
        self.assertEqual(data["videos"], {"hero": None, "stories": []})

    def test_public_endpoints_ignore_a_stale_login_token(self):
        self.client.credentials(HTTP_AUTHORIZATION="Bearer expired-or-garbage")
        self.assertEqual(self.client.get(f"{SHOP}/catalog/").status_code, 200)

    def test_catalog_lists_active_products_with_orderable_stock(self):
        Product.objects.filter(pk=self.dates.pk).update(is_active=False)
        StockItem.objects.filter(product=self.honey).update(quantity=D("3"))
        data = self.client.get(f"{SHOP}/catalog/").json()
        names = {p["name"]: p for p in data["products"]}
        self.assertNotIn("Medjool Dates 1kg", names)
        self.assertEqual(names["Sidr Honey 500g"]["max_qty"], "3.000")
        self.assertTrue(names["Sidr Honey 500g"]["low_stock"])
        self.assertEqual(names["Olives"]["sold_by"], "WEIGHT")
        self.assertEqual(names["Olives"]["max_qty"], "9.500")
        self.assertEqual({c["name"] for c in data["categories"]}, {"Honey", "Deli"})
        self.assertNotIn("cost", names["Olives"])

    def test_hidden_and_featured_listings(self):
        Listing.objects.create(product=self.dates, hidden=True)
        Listing.objects.create(product=self.honey, featured=True, badge="Raw", description="Mountain sidr.")
        products = {p["id"]: p for p in self.client.get(f"{SHOP}/catalog/").json()["products"]}
        self.assertNotIn(self.dates.pk, products)
        self.assertTrue(products[self.honey.pk]["featured"])
        self.assertEqual(products[self.honey.pk]["badge"], "Raw")

    def test_photos_use_the_cashiers_public_photo_endpoint(self):
        ProductImage.objects.create(
            product=self.honey, data=b"full-bytes", thumbnail=b"thumb-bytes",
            content_type="image/jpeg", width=10, height=10, checksum="ab" * 32,
        )
        product = next(p for p in self.client.get(f"{SHOP}/catalog/").json()["products"] if p["id"] == self.honey.pk)
        self.assertEqual(product["image"], f"/api/products/{self.honey.pk}/image/?v={'ab' * 8}")
        self.assertEqual(self.client.get(product["thumb"]).content, b"thumb-bytes")

    def test_stock_is_the_selling_storage_only(self):
        from apps.inventory.models import Storage, apply_stock_change

        back_room = Storage.objects.create(name="Back room")
        apply_stock_change(product=self.dates, storage=back_room, change=D("500"), reason="PURCHASE")
        product = next(p for p in self.client.get(f"{SHOP}/catalog/").json()["products"] if p["id"] == self.dates.pk)
        self.assertEqual(product["max_qty"], "4.000")

    def test_quote_endpoint(self):
        response = self.client.post(
            f"{SHOP}/quote/",
            {"items": [{"id": self.honey.pk, "qty": 1}, {"id": self.dates.pk, "qty": 9}], "fulfilment": "PICKUP"},
            format="json",
        )
        data = response.json()
        self.assertFalse(data["ok"])
        self.assertEqual((data["subtotal"], data["deposit"]), ("250.00", "125.00"))
        self.assertEqual({l["id"]: l["issue"] for l in data["lines"]}, {self.honey.pk: "", self.dates.pk: "INSUFFICIENT"})
        bad = self.client.post(f"{SHOP}/quote/", {"items": "x"}, format="json")
        self.assertEqual((bad.status_code, bad.json()["code"]), (400, "INVALID"))


class OrderPlacementTests(ShopTestCase):
    def test_placing_an_order_reserves_and_prices_server_side(self):
        order = self.place_ok(
            [{"id": self.honey.pk, "qty": 2}, {"id": self.olives.pk, "qty": "0.5"}],
            fulfilment="DELIVERY", address="12 Nile St, Maadi", notes="Call first",
            expected_total="522.50", language="en",
        )
        self.assertRegex(order["code"], r"^FK-[2-9A-HJKMNP-Z]{6}$")
        self.assertEqual(order["status"], "AWAITING_DEPOSIT")
        self.assertEqual((order["subtotal"], order["total"]), ("522.50", "522.50"))
        self.assertEqual(order["deposit_required"], "262.00")   # 261.25 -> 262
        self.assertEqual(order["phone"], "010******78")
        self.assertEqual(order["payment"]["address"], "fatheetkheer@instapay")
        self.assertEqual([e["kind"] for e in order["timeline"]], ["CREATED"])

        saved = WebOrder.objects.get(code=order["code"])
        self.assertEqual((saved.phone, saved.items.count(), saved.language), ("01012345678", 2, "en"))
        # Nothing is sold yet: the till's stock is untouched.
        self.assertEqual(StockItem.objects.get(product=self.honey).quantity, D("10.000"))

    def test_the_client_cannot_set_prices(self):
        order = self.place_ok([{"id": self.honey.pk, "qty": 1, "price": "1.00", "unit_price": "1"}])
        self.assertEqual(order["total"], "250.00")

    def test_validation(self):
        for overrides, field in [
            ({"phone": "12345"}, "phone"),
            ({"name": "A"}, "name"),
            ({"fulfilment": "DELIVERY", "address": "  "}, "address"),
            ({"fulfilment": "DRONE"}, "fulfilment"),
            ({"items": []}, "items"),
        ]:
            response = self.place(**overrides)
            self.assertEqual(response.status_code, 400, overrides)
            self.assertEqual(response.json()["code"], "INVALID")
            self.assertIn(field, response.json()["fields"], overrides)
        self.assertEqual(WebOrder.objects.count(), 0)

    def test_bots_filling_the_hidden_field_are_refused(self):
        self.assertEqual(self.place(website="http://spam.example").status_code, 400)
        self.assertEqual(WebOrder.objects.count(), 0)

    def test_sold_out_since_the_cart_was_built(self):
        response = self.place([{"id": self.dates.pk, "qty": 5}])
        body = response.json()
        self.assertEqual((response.status_code, body["code"]), (409, "CART_CHANGED"))
        self.assertEqual(body["quote"]["lines"][0]["max_qty"], "4.000")

    def test_price_moved_since_the_cart_was_shown(self):
        response = self.place(expected_total="499.00")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "PRICE_CHANGED"))
        self.assertEqual(WebOrder.objects.count(), 0)

    def test_two_customers_cannot_both_take_the_last_units(self):
        self.place_ok([{"id": self.dates.pk, "qty": 3}])
        second = self.place([{"id": self.dates.pk, "qty": 2}], phone="01112345678")
        self.assertEqual(second.json()["code"], "CART_CHANGED")
        self.place_ok([{"id": self.dates.pk, "qty": 1}], phone="01112345678")

    def test_one_phone_cannot_pile_up_unpaid_orders(self):
        for _ in range(services.MAX_UNPAID_PER_PHONE):
            self.place_ok([{"id": self.honey.pk, "qty": 1}])
        response = self.place([{"id": self.honey.pk, "qty": 1}])
        self.assertEqual((response.status_code, response.json()["code"]), (409, "TOO_MANY_UNPAID"))

    def test_ordering_switched_off(self):
        self.shop_settings(ordering_enabled=False)
        self.assertEqual(self.client.get(f"{SHOP}/config/").json()["ordering"]["reason"], "DISABLED")
        self.assertIn("ORDERING_DISABLED", self.place().json()["quote"]["problems"])


class TrackingTests(ShopTestCase):
    def test_tracking_needs_the_secret_token(self):
        order = self.place_ok()
        url = f"{SHOP}/orders/{order['code']}/"
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.get(url + "?t=wrong").status_code, 404)
        self.assertEqual(self.client.get(f"{SHOP}/orders/FK-ZZZZZZ/?t={order['token']}").status_code, 404)
        ok = self.client.get(url + "?t=" + order["token"])
        self.assertEqual(ok.status_code, 200)
        self.assertNotIn("token", ok.json()["order"])

    def test_lookup_by_code_and_phone(self):
        order = self.place_ok()
        found = self.client.post(
            f"{SHOP}/orders/lookup/", {"code": order["code"][3:].lower(), "phone": "+20 101 234 5678"}, format="json"
        )
        self.assertEqual(found.json(), {"code": order["code"], "token": order["token"]})
        for body in ({"code": order["code"], "phone": "01112345678"}, {"code": "FK-AAAAAA", "phone": "01012345678"}):
            self.assertEqual(self.client.post(f"{SHOP}/orders/lookup/", body, format="json").status_code, 404)

    def test_lookup_is_rate_limited(self):
        statuses = [
            self.client.post(f"{SHOP}/orders/lookup/", {"code": "FK-AAAAAA", "phone": "01012345678"}, format="json").status_code
            for _ in range(22)
        ]
        self.assertEqual((statuses[0], statuses[-1]), (404, 429))


class DepositTests(ShopTestCase):
    def test_reference_moves_the_order_to_review(self):
        order = self.place_ok()
        body = self.pay(order, reference=" 123456789012 ", sender="Mona").json()["order"]
        self.assertEqual(body["status"], "DEPOSIT_REVIEW")
        self.assertEqual(body["deposit"]["reference"], "123456789012")
        self.assertIsNone(body["payment"])
        self.assertEqual([e["kind"] for e in body["timeline"]], ["CREATED", "DEPOSIT_SUBMITTED"])

    def test_a_screenshot_alone_is_enough_and_is_reencoded(self):
        order = self.place_ok()
        response = self.pay(order, reference="", proof=png_bytes())
        self.assertEqual(response.status_code, 200, response.content)
        proof = DepositProof.objects.get(order__code=order["code"])
        self.assertEqual(bytes(proof.data)[:3], b"\xff\xd8\xff")
        self.assertTrue(response.json()["order"]["deposit"]["has_proof"])

    def test_nothing_sent_is_refused(self):
        response = self.pay(self.place_ok(), reference="")
        self.assertEqual((response.status_code, response.json()["code"]), (400, "PROOF_REQUIRED"))

    def test_a_file_that_is_not_an_image_is_refused(self):
        order = self.place_ok()
        fake = BytesIO(b"<?php echo 1; ?>" * 50)
        fake.name = "shot.png"
        response = self.pay(order, proof=fake)
        self.assertEqual((response.status_code, response.json()["code"]), (400, "INVALID_IMAGE"))

    def test_cannot_pay_twice_and_cancel_only_before_paying(self):
        order = self.place_ok([{"id": self.dates.pk, "qty": 4}])
        other = self.place_ok([{"id": self.honey.pk, "qty": 1}])
        self.pay(other)
        self.assertEqual(self.pay(other).json()["code"], "NOT_AWAITING_DEPOSIT")

        cancelled = self.client.post(f"{SHOP}/orders/{order['code']}/cancel/", {"t": order["token"]}, format="json")
        self.assertEqual(cancelled.json()["order"]["status"], "CANCELLED")
        self.place_ok([{"id": self.dates.pk, "qty": 4}], phone="01112345678")   # stock freed

        refused = self.client.post(f"{SHOP}/orders/{other['code']}/cancel/", {"t": other["token"]}, format="json")
        self.assertEqual((refused.status_code, refused.json()["code"]), (409, "CANNOT_CANCEL"))


class ExpiryTests(ShopTestCase):
    def expire(self, code):
        WebOrder.objects.filter(code=code).update(expires_at=timezone.now() - timedelta(minutes=1))

    def test_unpaid_orders_expire_and_release_stock(self):
        order = self.place_ok([{"id": self.dates.pk, "qty": 4}])
        self.assertEqual(self.place([{"id": self.dates.pk, "qty": 1}], phone="01112345678").status_code, 409)
        self.expire(order["code"])
        tracked = self.track(order)
        self.assertEqual((tracked["status"], tracked["timeline"][-1]["kind"]), ("EXPIRED", "EXPIRED"))
        self.place_ok([{"id": self.dates.pk, "qty": 4}], phone="01112345678")

    def test_paid_orders_never_expire_and_late_payers_can_still_report(self):
        paid = self.place_ok()
        self.pay(paid)
        WebOrder.objects.filter(code=paid["code"]).update(expires_at=timezone.now() - timedelta(days=1))
        late = self.place_ok(phone="01112345678")
        self.expire(late["code"])
        self.assertEqual(services.expire_stale(force=True), 1)
        self.assertEqual(self.pay(late).json()["order"]["status"], "DEPOSIT_REVIEW")

    def test_command(self):
        self.expire(self.place_ok()["code"])
        out = StringIO()
        call_command("expire_web_orders", stdout=out)
        self.assertIn("Expired 1", out.getvalue())


class InstapayQrTests(ShopTestCase):
    def test_uploaded_qr_is_offered_to_the_customer(self):
        self.assertEqual(self.client.get(f"{SHOP}/instapay-qr/").status_code, 404)
        StoredImage.objects.create(key=StoredImage.INSTAPAY_QR, data=b"png-bytes", content_type="image/png", checksum="cd" * 32)
        url = self.place_ok()["payment"]["qr_image"]
        self.assertEqual(url, f"{SHOP}/instapay-qr/?v={'cd' * 8}")
        response = self.client.get(url)
        self.assertEqual((response.content, response["Content-Type"]), (b"png-bytes", "image/png"))
        self.assertIn("immutable", response["Cache-Control"])
