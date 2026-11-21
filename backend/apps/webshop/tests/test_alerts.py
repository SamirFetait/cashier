"""WhatsApp alerts the server sends the shop: through the WhatsApp sidecar, or
through Meta's Cloud API as approved templates."""
import re
from decimal import Decimal
from io import StringIO
from types import SimpleNamespace
from unittest import mock

from django.core.management import CommandError, call_command
from django.test import SimpleTestCase, override_settings

from apps.whatsapp.client import WhatsAppError
from apps.whatsapp.cloud import CloudError
from apps.whatsapp.models import WhatsAppMessage
from apps.webshop import alerts
from apps.webshop.models import WebOrder

from .base import SHOP, ShopTestCase, png_bytes

STORE = "201553211120"   # the default store number, +20 15 53211120


def inline(fn, *args):
    """Run the alert on the spot instead of on a thread, inside the test's
    database transaction."""
    fn(*args)


class Alerting:
    def place_alerted(self, *args, **kwargs):
        with self.captureOnCommitCallbacks(execute=True):
            return self.place_ok(*args, **kwargs)

    def pay_alerted(self, order, **kwargs):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.pay(order, **kwargs)
        self.assertEqual(response.status_code, 200, response.content)


@mock.patch.object(alerts, "in_background", inline)
@mock.patch.object(alerts, "send_message", return_value={"success": True})
class AlertTests(Alerting, ShopTestCase):
    def test_a_pickup_is_sent_to_the_store_number_when_placed(self, send):
        order = self.place_alerted(
            [{"id": self.honey.pk, "qty": 2}, {"id": self.olives.pk, "qty": "0.5"}],
            fulfilment="PICKUP", notes="After 5pm",
        )
        send.assert_called_once()
        number, text = send.call_args.args
        self.assertEqual(number, STORE)
        self.assertIn(order["code"], text)
        for expected in (
            "Mona Ali", "+201012345678", "استلام من المحل", "After 5pm",
            "• Sidr Honey 500g × 2 = 500.00 ج.م", "• Olives × 0.5 kg = 22.50 ج.م",
            "المطلوب عند الاستلام: 522.50 ج.م",
        ):
            self.assertIn(expected, text)
        logged = WhatsAppMessage.objects.get()
        self.assertEqual((logged.status, logged.to_number), ("SENT", STORE))

    def test_a_delivery_is_sent_when_placed_as_waiting_for_its_deposit(self, send):
        order = self.place_alerted()
        send.assert_called_once()
        number, text = send.call_args.args
        self.assertEqual(number, STORE)
        for expected in (
            f"طلب توصيل جديد من الموقع: {order['code']}", "Mona Ali", "+201012345678",
            "توصيل إلى: 12 Nile St, Maadi", "• Sidr Honey 500g × 2 = 500.00 ج.م",
            "العربون المطلوب: 250.00 ج.م", "في انتظار تحويل العربون",
        ):
            self.assertIn(expected, text)
        self.assertNotIn("المطلوب عند الاستلام", text)
        logged = WhatsAppMessage.objects.get()
        self.assertEqual((logged.status, logged.to_number), ("SENT", STORE))

    def test_a_delivery_is_sent_again_with_the_screenshot_once_the_deposit_is_reported(self, send):
        order = self.place_alerted()
        send.reset_mock()

        self.pay_alerted(order, reference="123456789012", sender="Mona", proof=png_bytes())
        self.assertEqual(send.call_count, 2)
        (number, text), media_call = send.call_args_list[0].args, send.call_args_list[1]
        self.assertEqual(number, STORE)
        for expected in (
            f"عربون للمراجعة: طلب {order['code']}", "توصيل إلى: 12 Nile St, Maadi",
            "العربون المطلوب: 250.00 ج.م", "الرقم المرجعي: 123456789012", "المحوِّل: Mona",
        ):
            self.assertIn(expected, text)
        media = media_call.kwargs["media"]
        self.assertEqual((media["mimetype"], media["filename"]), ("image/jpeg", f"{order['code']}.jpg"))
        self.assertTrue(media["data"].startswith("/9j/"))   # base64 of a JPEG

    def test_a_reference_alone_sends_only_the_text(self, send):
        self.pay_alerted(self.place_ok(), reference="123456789012")
        send.assert_called_once()

    def test_another_number_can_receive_the_alerts(self, send):
        self.shop_settings(alert_whatsapp="0100 111 2222")
        self.place_alerted(fulfilment="PICKUP")
        self.assertEqual(send.call_args.args[0], "201001112222")

    def test_alerts_can_be_switched_off(self, send):
        self.shop_settings(whatsapp_alerts=False)
        self.place_alerted(fulfilment="PICKUP")
        self.place_alerted()
        send.assert_not_called()
        self.assertFalse(WhatsAppMessage.objects.exists())

    def test_whatsapp_being_down_never_fails_the_order(self, send):
        send.side_effect = WhatsAppError("WhatsApp is not connected. Pair it first.")
        order = self.place_alerted(fulfilment="PICKUP")
        self.assertEqual(WebOrder.objects.get(code=order["code"]).status, "CONFIRMED")
        logged = WhatsAppMessage.objects.get()
        self.assertEqual((logged.status, logged.error), ("FAILED", "WhatsApp is not connected. Pair it first."))

    def test_nothing_is_sent_when_the_order_is_not_saved(self, send):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.place(fulfilment="PICKUP", expected_total="1.00")
        self.assertEqual(response.json()["code"], "PRICE_CHANGED")
        send.assert_not_called()


class AlertSettingsTests(ShopTestCase):
    def test_the_alert_number_is_checked_and_stored_in_one_spelling(self):
        client = self.staff_client()
        bad = client.patch(f"{SHOP}/admin/settings/", {"alert_whatsapp": "12345"}, format="json")
        self.assertEqual(bad.status_code, 400)
        ok = client.patch(f"{SHOP}/admin/settings/", {"alert_whatsapp": "+20 100 111 2222"}, format="json")
        self.assertEqual(ok.json()["settings"]["alert_whatsapp"], "01001112222")

    def test_health_warns_when_the_paired_account_would_message_itself(self):
        client = self.staff_client()
        with mock.patch("apps.whatsapp.client.get_status", return_value={"connected": True, "number": STORE}):
            health = client.get(f"{SHOP}/admin/health/").json()["whatsapp"]
        self.assertEqual(
            health,
            {
                "alerts": True, "provider": "sidecar", "to": STORE, "connected": True, "from": STORE,
                "same_number": True, "error": "",
            },
        )
        self.shop_settings(alert_whatsapp="01001112222")
        with mock.patch("apps.whatsapp.client.get_status", side_effect=WhatsAppError("unreachable")):
            health = client.get(f"{SHOP}/admin/health/").json()["whatsapp"]
        self.assertEqual((health["to"], health["connected"], health["same_number"]), ("201001112222", False, False))

    @override_settings(WHATSAPP_CLOUD_WABA_ID="222")
    @mock.patch("apps.whatsapp.cloud.configured", return_value=True)
    @mock.patch("apps.whatsapp.cloud.sending_number", return_value="201099998888")
    def test_health_through_the_cloud_api_needs_the_templates_approved(self, sending_number, configured):
        client = self.staff_client()
        approved = {name: "APPROVED" for name in alerts.TEMPLATES}
        with mock.patch("apps.whatsapp.cloud.template_statuses", return_value=approved):
            health = client.get(f"{SHOP}/admin/health/").json()["whatsapp"]
        self.assertEqual(
            health,
            {
                "alerts": True, "provider": "cloud", "to": STORE, "connected": True, "from": "201099998888",
                "same_number": False, "error": "",
            },
        )
        waiting = {alerts.PICKUP_TEMPLATE: "APPROVED", alerts.DELIVERY_TEMPLATE: "PENDING"}
        with mock.patch("apps.whatsapp.cloud.template_statuses", return_value=waiting):
            health = client.get(f"{SHOP}/admin/health/").json()["whatsapp"]
        self.assertFalse(health["connected"])
        self.assertEqual(
            health["error"],
            "Templates Meta has not approved: fk_web_order_delivery (PENDING), fk_web_order_deposit (missing)",
        )

    @mock.patch("apps.whatsapp.cloud.configured", return_value=True)
    def test_health_passes_on_metas_refusal(self, configured):
        with mock.patch("apps.whatsapp.cloud.sending_number", side_effect=CloudError("Invalid token (code 190)")):
            health = self.staff_client().get(f"{SHOP}/admin/health/").json()["whatsapp"]
        self.assertEqual((health["provider"], health["connected"], health["error"]), ("cloud", False, "Invalid token (code 190)"))


@mock.patch.object(alerts, "in_background", inline)
@mock.patch.object(alerts, "RETRY_WAITS", (0, 0))
@mock.patch("apps.whatsapp.cloud.upload_media", return_value="media-1")
@mock.patch("apps.whatsapp.cloud.send_template", return_value="wamid.1")
@mock.patch("apps.whatsapp.cloud.configured", return_value=True)
class CloudAlertTests(Alerting, ShopTestCase):
    """Through Meta's Cloud API, each alert is an approved template filled in
    from the order, and the sidecar is not used."""

    def sent(self, send) -> list[tuple]:
        """(to, template, values, image id) of each message, in order."""
        return [(*c.args, c.kwargs.get("image_id", "")) for c in send.call_args_list]

    def test_a_pickup_goes_as_its_template(self, configured, send, upload):
        order = self.place_alerted(
            [{"id": self.honey.pk, "qty": 2}, {"id": self.olives.pk, "qty": "0.5"}],
            fulfilment="PICKUP", notes="After 5pm\nring twice",
        )
        self.assertEqual(self.sent(send), [(STORE, alerts.PICKUP_TEMPLATE, [
            order["code"], "Mona Ali", "+201012345678", "After 5pm ring twice",
            "• Sidr Honey 500g × 2 = 500.00 ج.م • Olives × 0.5 kg = 22.50 ج.م",
            "522.50 ج.م", "522.50 ج.م",
        ], "")])
        self.assertEqual(send.call_args.kwargs["language"], "ar")
        alerts.send_message.assert_not_called()
        logged = WhatsAppMessage.objects.get()
        self.assertEqual((logged.status, logged.to_number, logged.error), ("SENT", STORE, ""))
        self.assertIn(f"طلب استلام جديد من الموقع: {order['code']}", logged.body)   # what went out
        self.assertNotIn("{{", logged.body)

    def test_a_delivery_goes_as_its_template(self, configured, send, upload):
        order = self.place_alerted()
        self.assertEqual(self.sent(send), [(STORE, alerts.DELIVERY_TEMPLATE, [
            order["code"], "Mona Ali", "+201012345678", "12 Nile St, Maadi", "—",
            "• Sidr Honey 500g × 2 = 500.00 ج.م", "مجاناً", "500.00 ج.م", "250.00 ج.م",
        ], "")])

    def test_the_deposit_goes_under_its_screenshot(self, configured, send, upload):
        order = self.place_alerted()
        send.reset_mock()
        self.pay_alerted(order, reference="123456789012", sender="Mona", proof=png_bytes())
        data, content_type, filename = upload.call_args.args
        self.assertEqual((content_type, filename), ("image/jpeg", f"{order['code']}.jpg"))
        self.assertTrue(data.startswith(b"\xff\xd8"))   # a JPEG
        self.assertEqual(self.sent(send), [(STORE, alerts.DEPOSIT_PHOTO_TEMPLATE, [
            order["code"], "Mona Ali", "+201012345678", "500.00 ج.م", "250.00 ج.م", "123456789012", "Mona",
        ], "media-1")])

    def test_a_deposit_without_a_screenshot_goes_as_text(self, configured, send, upload):
        order = self.place_alerted()
        send.reset_mock()
        self.pay_alerted(order, reference="123456789012")
        upload.assert_not_called()
        [(_, name, values, image)] = self.sent(send)
        self.assertEqual((name, values[-1], image), (alerts.DEPOSIT_TEMPLATE, "—", ""))

    def test_the_deposit_still_goes_when_its_photo_template_cannot(self, configured, send, upload):
        order = self.place_alerted()
        send.side_effect = [CloudError("template name does not exist in ar (code 132001)", code=132001), "wamid.3"]
        self.pay_alerted(order, reference="123456789012", proof=png_bytes())
        self.assertEqual(
            [name for _, name, _, _ in self.sent(send)],
            [alerts.DELIVERY_TEMPLATE, alerts.DEPOSIT_PHOTO_TEMPLATE, alerts.DEPOSIT_TEMPLATE],
        )
        deposit = WhatsAppMessage.objects.order_by("-pk").first()
        self.assertEqual(deposit.status, "SENT")
        self.assertEqual(
            deposit.error, "Sent without the transfer screenshot: template name does not exist in ar (code 132001)"
        )

    def test_meta_being_busy_is_tried_again(self, configured, send, upload):
        send.side_effect = [CloudError("Rate limit hit (code 130429)", code=130429, transient=True), "wamid.2"]
        self.place_alerted(fulfilment="PICKUP")
        self.assertEqual(send.call_count, 2)
        self.assertEqual(WhatsAppMessage.objects.get().status, "SENT")

    def test_a_refusal_is_logged_without_failing_the_order(self, configured, send, upload):
        send.side_effect = CloudError("Template is paused (code 132015)", code=132015)
        order = self.place_alerted(fulfilment="PICKUP")
        send.assert_called_once()   # not worth another try
        self.assertEqual(WebOrder.objects.get(code=order["code"]).status, "CONFIRMED")
        logged = WhatsAppMessage.objects.get()
        self.assertEqual((logged.status, logged.error), ("FAILED", "Template is paused (code 132015)"))

    def test_a_long_order_is_shortened_to_fit(self, configured, send, upload):
        lines = [
            SimpleNamespace(
                name=f"Product number {i} with quite a long name", quantity=Decimal("2"),
                sold_by="UNIT", unit="pcs", line_total=Decimal("100.00"),
            )
            for i in range(40)
        ]
        order = SimpleNamespace(
            code="FK-LONG01", customer_name="Mona Ali", phone="01012345678", notes="Leave it\twith the guard",
            total=Decimal("4000.00"), balance_due=Decimal("4000.00"), items=SimpleNamespace(all=lambda: lines),
        )
        values = alerts.template_values(alerts.PICKUP_TEMPLATE, order)
        self.assertLessEqual(len(alerts._filled(alerts.PICKUP_TEMPLATE, values)), alerts.BODY_LIMIT)
        self.assertEqual(values[3], "Leave it with the guard")
        self.assertRegex(values[4], r"^• Product number 0 .* • و\d+ صنفاً آخر$")


class TemplateRulesTests(SimpleTestCase):
    """The templates keep to what Meta's review accepts."""

    def test_each_template_keeps_metas_rules(self):
        for name, body in alerts.TEMPLATES.items():
            with self.subTest(name):
                numbers = [int(n) for n in re.findall(r"\{\{(\d+)\}\}", body)]
                self.assertEqual(numbers, list(range(1, len(numbers) + 1)))
                self.assertFalse(body.startswith("{{") or body.endswith("}}"))
                self.assertNotRegex(body, r"\}\}\s*\{\{")   # no two values side by side
                fixed_words = len(re.sub(r"\{\{\d+\}\}", " ", body).split())
                self.assertGreaterEqual(fixed_words, 3 * len(numbers) + 1)
                example = alerts.TEMPLATE_EXAMPLES[name]
                self.assertEqual(len(example), len(numbers))
                for value in example:
                    self.assertNotRegex(value, r"[\n\t]| {5}")
                self.assertLessEqual(len(alerts._filled(name, example)), alerts.BODY_LIMIT)

    def test_only_the_photo_template_carries_a_picture(self):
        photo = alerts.template_definition(alerts.DEPOSIT_PHOTO_TEMPLATE, "handle-1")
        self.assertEqual(photo["components"][0], {"type": "HEADER", "format": "IMAGE", "example": {"header_handle": ["handle-1"]}})
        for name in alerts.REQUIRED_TEMPLATES:
            definition = alerts.template_definition(name)
            self.assertEqual((definition["language"], definition["category"]), ("ar", "UTILITY"))
            self.assertEqual([c["type"] for c in definition["components"]], ["BODY"])


@override_settings(WHATSAPP_CLOUD_WABA_ID="222")
class WhatsAppCloudCommandTests(ShopTestCase):
    def setUp(self):
        super().setUp()
        patcher = mock.patch("apps.whatsapp.cloud.configured", return_value=True)
        patcher.start()
        self.addCleanup(patcher.stop)

    @mock.patch("apps.whatsapp.cloud.upload_example", return_value="handle-1")
    @mock.patch("apps.whatsapp.cloud.create_template", return_value={"status": "PENDING"})
    @mock.patch("apps.whatsapp.cloud.template_statuses", return_value={alerts.PICKUP_TEMPLATE: "APPROVED"})
    def test_templates_submits_the_ones_meta_lacks(self, statuses, create, example):
        call_command("whatsapp_cloud", "templates", stdout=StringIO(), stderr=StringIO())
        submitted = [c.args[0] for c in create.call_args_list]
        self.assertEqual(
            [d["name"] for d in submitted],
            [alerts.DELIVERY_TEMPLATE, alerts.DEPOSIT_TEMPLATE, alerts.DEPOSIT_PHOTO_TEMPLATE],
        )
        self.assertEqual(submitted[-1]["components"][0]["example"], {"header_handle": ["handle-1"]})
        data, content_type = example.call_args.args
        self.assertEqual((data[:2], content_type), (b"\xff\xd8", "image/jpeg"))

    @mock.patch("apps.whatsapp.cloud.create_template", return_value={"status": "PENDING"})
    @mock.patch("apps.whatsapp.cloud.template_statuses", return_value={})
    def test_templates_carries_on_without_the_photo_one(self, statuses, create):
        errors = StringIO()
        with mock.patch("apps.whatsapp.cloud.upload_example", side_effect=CloudError("Set WHATSAPP_CLOUD_APP_ID")):
            call_command("whatsapp_cloud", "templates", stdout=StringIO(), stderr=errors)
        self.assertEqual([c.args[0]["name"] for c in create.call_args_list], list(alerts.REQUIRED_TEMPLATES))
        self.assertIn("fk_web_order_deposit_photo: not submitted: Set WHATSAPP_CLOUD_APP_ID", errors.getvalue())

    @mock.patch("apps.whatsapp.cloud.send_template", return_value="wamid.9")
    def test_test_sends_a_sample_pickup_alert(self, send):
        call_command("whatsapp_cloud", "test", "--to", "0100 111 2222", stdout=StringIO())
        number, name, values = send.call_args.args
        self.assertEqual((number, name, values[:2]), ("201001112222", alerts.PICKUP_TEMPLATE, ["FK-TEST", "تجربة من الخادم"]))

    def test_it_needs_the_cloud_api_set_up(self):
        with mock.patch("apps.whatsapp.cloud.configured", return_value=False):
            with self.assertRaisesMessage(CommandError, "Set WHATSAPP_CLOUD_TOKEN"):
                call_command("whatsapp_cloud", "status", stdout=StringIO())
