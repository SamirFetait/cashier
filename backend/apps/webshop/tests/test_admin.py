from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.webshop.models import Listing, ShopSettings, StoredImage, WebOrder

from .base import SHOP, ShopTestCase, png_bytes


class AccessTests(ShopTestCase):
    def test_staff_sign_in_with_their_cashier_account(self):
        anonymous = APIClient()
        self.assertEqual(anonymous.get(f"{SHOP}/admin/board/").status_code, 401)
        self.assertEqual(anonymous.get(f"{SHOP}/admin/board/").json()["code"], "UNAUTHENTICATED")
        self.assertEqual(self.staff_client("cashier").get(f"{SHOP}/admin/board/").status_code, 200)

    def test_a_deactivated_account_is_locked_out(self):
        client = self.staff_client("cashier")
        User.objects.filter(username="cashier").update(is_active=False)
        self.assertEqual(client.get(f"{SHOP}/admin/board/").status_code, 401)

    def test_super_admin_only_actions(self):
        cashier = self.staff_client("cashier")
        self.assertEqual(cashier.get(f"{SHOP}/admin/settings/").status_code, 200)
        self.assertEqual(cashier.put(f"{SHOP}/admin/settings/", {"deposit_percent": 10}, format="json").status_code, 403)
        self.assertEqual(cashier.put(f"{SHOP}/admin/listings/{self.honey.pk}/", {"hidden": True}, format="json").status_code, 403)
        self.assertEqual(cashier.post(f"{SHOP}/admin/settings/instapay-qr/", {"image": png_bytes()}).status_code, 403)


class BoardTests(ShopTestCase):
    def test_board_lists_open_orders_and_todays_figures(self):
        waiting = self.place_ok([{"id": self.honey.pk, "qty": 1}])
        _, confirmed, client = self.confirmed_order(items=[{"id": self.dates.pk, "qty": 1}])
        gone = self.place_ok([{"id": self.honey.pk, "qty": 1}])
        self.client.post(f"{SHOP}/orders/{gone['code']}/cancel/", {"t": gone["token"]}, format="json")

        board = client.get(f"{SHOP}/admin/board/").json()
        codes = {o["code"]: o for o in board["orders"]}
        self.assertEqual(set(codes), {waiting["code"], confirmed["code"]})
        row = codes[confirmed["code"]]
        self.assertEqual((row["status"], row["phone"], row["whatsapp"]), ("CONFIRMED", "01012345678", "201012345678"))
        self.assertEqual(row["items_summary"], ["1 × Medjool Dates 1kg"])
        summary = board["summary"]
        self.assertEqual((summary["orders_today"], summary["deposits_today"], summary["open_value"]), (3, "90.00", "180.00"))

    def test_board_expires_overdue_orders(self):
        order = self.place_ok()
        client = self.staff_client()
        WebOrder.objects.filter(code=order["code"]).update(expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(client.get(f"{SHOP}/admin/board/").json()["orders"], [])

    def test_search_and_paging(self):
        first = self.place_ok(name="Mona Ali")
        second = self.place_ok(name="Karim Samy", phone="01112345678")
        client = self.staff_client()
        everything = client.get(f"{SHOP}/admin/orders/").json()
        self.assertEqual((everything["count"], everything["pages"]), (2, 1))
        self.assertEqual(everything["results"][0]["code"], second["code"])

        def codes(query):
            return [o["code"] for o in client.get(f"{SHOP}/admin/orders/?{query}").json()["results"]]

        self.assertEqual(codes("q=karim"), [second["code"]])
        self.assertEqual(codes("q=0101234"), [first["code"]])
        self.assertEqual(codes("status=COMPLETED,CANCELLED"), [])


class DepositReviewTests(ShopTestCase):
    def setUp(self):
        super().setUp()
        self.order = self.place_ok([{"id": self.honey.pk, "qty": 2}])   # total 500, deposit 250
        self.pk = self.pk_of(self.order)

    def test_detail_shows_the_transfer_and_tracking_link(self):
        self.pay(self.order, proof=png_bytes())
        client = self.staff_client("cashier")
        detail = client.get(f"{SHOP}/admin/orders/{self.pk}/").json()["order"]
        self.assertEqual((detail["status"], detail["deposit"]["reference"]), ("DEPOSIT_REVIEW", "123456789012"))
        self.assertTrue(detail["deposit"]["has_proof"])
        self.assertEqual(detail["tracking_url"], f"https://shop.example/order/{self.order['code']}?t={self.order['token']}")
        self.assertEqual(detail["shortages"], [])
        proof = client.get(f"{SHOP}/admin/orders/{self.pk}/proof/")
        self.assertEqual((proof["Content-Type"], proof["Cache-Control"]), ("image/jpeg", "private, no-store"))
        self.assertEqual(APIClient().get(f"{SHOP}/admin/orders/{self.pk}/proof/").status_code, 401)

    def test_confirming_the_deposit(self):
        self.pay(self.order)
        client = self.staff_client("cashier")
        order = self.act(client, self.pk, "confirm-deposit", {"amount": "250.00"}).json()["order"]
        self.assertEqual((order["status"], order["deposit_paid"], order["balance_due"]), ("CONFIRMED", "250.00", "250.00"))
        self.assertEqual(order["deposit"]["confirmed_by"], "cashier")
        self.assertEqual(self.track(self.order)["status"], "CONFIRMED")
        again = self.act(client, self.pk, "confirm-deposit", {"amount": "250.00"})
        self.assertEqual((again.status_code, again.json()["code"]), (409, "INVALID_STATE"))

    def test_rejecting_sends_the_customer_back_to_pay(self):
        self.pay(self.order)
        client = self.staff_client("cashier")
        self.assertEqual(self.act(client, self.pk, "reject-deposit", {"reason": " "}).json()["code"], "REASON_REQUIRED")
        order = self.act(client, self.pk, "reject-deposit", {"reason": "No transfer with this reference"}).json()["order"]
        self.assertEqual(order["status"], "AWAITING_DEPOSIT")
        self.assertIsNotNone(order["expires_at"])
        self.assertEqual(self.track(self.order)["deposit"]["reject_reason"], "No transfer with this reference")

    def test_a_reference_used_on_two_orders_is_flagged(self):
        self.pay(self.order, reference="DUP-1")
        other = self.place_ok(phone="01112345678")
        self.pay(other, reference="dup-1")
        detail = self.staff_client().get(f"{SHOP}/admin/orders/{self.pk}/").json()["order"]
        self.assertEqual(detail["duplicate_reference"], [other["code"]])

    def test_confirming_an_expired_order_checks_the_stock_is_still_there(self):
        late = self.place_ok([{"id": self.dates.pk, "qty": 4}], phone="01112345678")
        late_pk = self.pk_of(late)
        WebOrder.objects.filter(pk=late_pk).update(expires_at=timezone.now() - timedelta(minutes=1))
        client = self.staff_client()
        client.get(f"{SHOP}/admin/board/")
        self.place_ok([{"id": self.dates.pk, "qty": 3}], phone="01212345678")
        refused = self.act(client, late_pk, "confirm-deposit", {"amount": "360"})
        self.assertEqual((refused.status_code, refused.json()["code"]), (409, "STOCK_GONE"))
        forced = self.act(client, late_pk, "confirm-deposit", {"amount": "360", "force": True})
        self.assertEqual(forced.json()["order"]["status"], "CONFIRMED")


class ProgressCancelRefundTests(ShopTestCase):
    def test_moving_a_confirmed_order_along(self):
        public, order, client = self.confirmed_order()
        for status in ("PREPARING", "READY"):
            self.assertEqual(self.act(client, order["id"], "status", {"status": status}).json()["order"]["status"], status)
        self.assertEqual(self.track(public)["timeline"][-1], {**self.track(public)["timeline"][-1], "kind": "STATUS", "to": "READY"})
        self.assertEqual(self.act(client, order["id"], "status", {"status": "COMPLETED"}).status_code, 400)

    def test_notes_are_internal(self):
        public, order, client = self.confirmed_order()
        detail = self.act(client, order["id"], "note", {"message": "Gift wrap"}).json()["order"]
        self.assertFalse(detail["events"][-1]["public"])
        self.assertNotIn("NOTE", [e["kind"] for e in self.track(public)["timeline"]])

    def test_only_a_super_admin_cancels_a_paid_order_and_the_deposit_is_owed_back(self):
        public, order, admin = self.confirmed_order()
        cashier = self.staff_client("cashier")
        refused = self.act(cashier, order["id"], "cancel", {"reason": "Out of stock"})
        self.assertEqual((refused.status_code, refused.json()["code"]), (403, "FORBIDDEN_ROLE"))
        cancelled = self.act(admin, order["id"], "cancel", {"reason": "Out of stock"}).json()["order"]
        self.assertEqual((cancelled["refund"]["status"], cancelled["refund"]["amount"]), ("DUE", "250.00"))
        self.assertEqual(admin.get(f"{SHOP}/admin/board/").json()["summary"]["refunds_due"], 1)
        self.assertEqual(self.act(cashier, order["id"], "refund", {}).status_code, 403)
        refunded = self.act(admin, order["id"], "refund", {"reference": "IPN-778"}).json()["order"]
        self.assertEqual((refunded["refund"]["status"], refunded["refund"]["by"]), ("DONE", "samir"))
        self.assertEqual(self.track(public)["refund"]["status"], "DONE")

    def test_a_cashier_cancels_an_unpaid_order(self):
        order = self.place_ok([{"id": self.dates.pk, "qty": 4}])
        cancelled = self.act(self.staff_client("cashier"), self.pk_of(order), "cancel", {"reason": "Duplicate"}).json()["order"]
        self.assertEqual((cancelled["status"], cancelled["cancel"]["by"]), ("CANCELLED", "cashier"))
        self.place_ok([{"id": self.dates.pk, "qty": 4}], phone="01112345678")


class SettingsAndCatalogueTests(ShopTestCase):
    def test_saving_settings(self):
        admin = self.staff_client()
        saved = admin.put(f"{SHOP}/admin/settings/", {
            "deposit_percent": 30, "deposit_min": "20", "delivery_fee": "35.5", "free_delivery_over": None,
            "instapay_link": "https://ipn.eg/S/fatheetkheer/instapay/abc123",
        }, format="json").json()["settings"]
        self.assertEqual((saved["deposit_percent"], saved["delivery_fee"], saved["updated_by"]), (30, "35.50", "samir"))
        self.assertEqual(self.client.get(f"{SHOP}/config/").json()["deposit"], {"percent": 30, "min": "20.00"})

    def test_settings_validation(self):
        admin = self.staff_client()
        for body, field in [
            ({"deposit_percent": 0}, "deposit_percent"),
            ({"hold_minutes": 1}, "hold_minutes"),
            ({"instapay_link": "javascript:alert(1)"}, "instapay_link"),
            ({"delivery_enabled": False, "pickup_enabled": False}, "pickup_enabled"),
        ]:
            response = admin.put(f"{SHOP}/admin/settings/", body, format="json")
            self.assertEqual(response.status_code, 400, body)
            self.assertIn(field, response.json()["fields"], body)
        self.assertEqual(ShopSettings.load().deposit_percent, 50)

    def test_instapay_qr_upload_is_kept_lossless(self):
        admin = self.staff_client()
        saved = admin.post(f"{SHOP}/admin/settings/instapay-qr/", {"image": png_bytes((300, 300))}).json()["settings"]
        self.assertTrue(saved["instapay_qr_image"].startswith(f"{SHOP}/instapay-qr/?v="))
        self.assertEqual(bytes(StoredImage.objects.get().data)[:4], b"\x89PNG")
        self.assertIsNone(admin.delete(f"{SHOP}/admin/settings/instapay-qr/").json()["settings"]["instapay_qr_image"])

    def test_curating_the_website_catalogue(self):
        self.place_ok([{"id": self.honey.pk, "qty": 2}])
        admin = self.staff_client()
        rows = {r["id"]: r for r in admin.get(f"{SHOP}/admin/listings/").json()["products"]}
        self.assertEqual((rows[self.honey.pk]["stock"], rows[self.honey.pk]["reserved"]), ("10.000", "2.000"))
        saved = admin.put(
            f"{SHOP}/admin/listings/{self.dates.pk}/", {"featured": True, "badge": " Premium "}, format="json"
        ).json()["product"]
        self.assertEqual((saved["featured"], saved["badge"]), (True, "Premium"))
        admin.put(f"{SHOP}/admin/listings/{self.dates.pk}/", {"hidden": True}, format="json")
        self.assertTrue(Listing.objects.get(product=self.dates).hidden)
        self.assertNotIn(self.dates.pk, [p["id"] for p in self.client.get(f"{SHOP}/catalog/").json()["products"]])
        self.assertEqual(admin.put(f"{SHOP}/admin/listings/99999/", {"hidden": True}, format="json").status_code, 404)

    def test_health(self):
        health = self.staff_client("cashier").get(f"{SHOP}/admin/health/").json()
        self.assertEqual((health["storage"], health["products"], health["instapay_ready"]), ({"ok": True, "name": "Main Store"}, 3, True))
