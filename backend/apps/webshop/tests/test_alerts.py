"""WhatsApp alerts the server sends the shop, through the WhatsApp sidecar."""
from unittest import mock

from apps.whatsapp.client import WhatsAppError
from apps.whatsapp.models import WhatsAppMessage
from apps.webshop import alerts
from apps.webshop.models import WebOrder

from .base import SHOP, ShopTestCase, png_bytes

STORE = "201553211120"   # the default store number, +20 15 53211120


def inline(fn, *args):
    """Run the alert on the spot instead of on a thread, inside the test's
    database transaction."""
    fn(*args)


@mock.patch.object(alerts, "in_background", inline)
@mock.patch.object(alerts, "send_message", return_value={"success": True})
class AlertTests(ShopTestCase):
    def place_alerted(self, *args, **kwargs):
        with self.captureOnCommitCallbacks(execute=True):
            return self.place_ok(*args, **kwargs)

    def pay_alerted(self, order, **kwargs):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.pay(order, **kwargs)
        self.assertEqual(response.status_code, 200, response.content)

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

    def test_a_delivery_is_sent_with_the_screenshot_once_the_deposit_is_reported(self, send):
        order = self.place_alerted()
        send.assert_not_called()   # nothing for the shop to do until the deposit

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
            {"alerts": True, "to": STORE, "connected": True, "from": STORE, "same_number": True, "error": ""},
        )
        self.shop_settings(alert_whatsapp="01001112222")
        with mock.patch("apps.whatsapp.client.get_status", side_effect=WhatsAppError("unreachable")):
            health = client.get(f"{SHOP}/admin/health/").json()["whatsapp"]
        self.assertEqual((health["to"], health["connected"], health["same_number"]), ("201001112222", False, False))
