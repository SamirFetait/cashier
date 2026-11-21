"""How the server sends WhatsApp: the sidecar (and unlinking the account it
sends from), Meta's Cloud API, and the numbers both are given."""
import json
from unittest import mock

import requests
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APITestCase

from apps.suppliers.models import Supplier
from apps.whatsapp import client, cloud
from apps.whatsapp.client import WhatsAppError

User = get_user_model()
URL = "/api/whatsapp/unlink/"
NO_CLOUD = override_settings(WHATSAPP_CLOUD_TOKEN="", WHATSAPP_CLOUD_PHONE_ID="")
CLOUD = override_settings(
    WHATSAPP_CLOUD_TOKEN="token-1", WHATSAPP_CLOUD_PHONE_ID="111", WHATSAPP_CLOUD_WABA_ID="222",
    WHATSAPP_CLOUD_APP_ID="333", WHATSAPP_CLOUD_API_VERSION="v26.0",
)


@NO_CLOUD
class UnlinkViewTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username="boss", password="pass12345", role=User.Role.SUPERADMIN)
        self.cashier = User.objects.create_user(username="cash", password="pass12345", role=User.Role.CASHIER)

    @mock.patch("apps.whatsapp.views.unlink", return_value={"success": True, "confirmed": True})
    def test_a_super_admin_unlinks(self, unlink):
        self.client.force_authenticate(self.admin)
        response = self.client.post(URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"success": True, "confirmed": True})
        unlink.assert_called_once()

    @mock.patch("apps.whatsapp.views.unlink")
    def test_a_cashier_cannot(self, unlink):
        self.client.force_authenticate(self.cashier)
        self.assertEqual(self.client.post(URL).status_code, 403)
        unlink.assert_not_called()

    @mock.patch("apps.whatsapp.views.unlink", side_effect=WhatsAppError("WhatsApp is not linked."))
    def test_a_refusal_is_passed_on(self, unlink):
        self.client.force_authenticate(self.admin)
        response = self.client.post(URL)
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json(), {"detail": "WhatsApp is not linked."})


def answer(status_code: int, body: bytes) -> requests.Response:
    response = requests.Response()
    response.status_code = status_code
    response._content = body
    return response


class UnlinkClientTests(SimpleTestCase):
    @mock.patch("apps.whatsapp.client.requests.post", return_value=answer(200, b'{"success": true, "confirmed": false}'))
    def test_the_answer_comes_back(self, post):
        self.assertEqual(client.unlink(), {"success": True, "confirmed": False})
        self.assertTrue(post.call_args.args[0].endswith("/unlink"))

    @mock.patch("apps.whatsapp.client.requests.post", return_value=answer(409, b'{"error": "WhatsApp is not linked."}'))
    def test_the_services_reason_is_kept(self, post):
        with self.assertRaisesMessage(WhatsAppError, "WhatsApp is not linked."):
            client.unlink()

    @mock.patch("apps.whatsapp.client.requests.post", side_effect=requests.ConnectionError("refused"))
    def test_an_unreachable_service_says_so(self, post):
        with self.assertRaisesMessage(WhatsAppError, "WhatsApp service unreachable"):
            client.unlink()


def json_answer(status_code: int, data) -> requests.Response:
    return answer(status_code, json.dumps(data).encode())


@CLOUD
class CloudClientTests(SimpleTestCase):
    @mock.patch("apps.whatsapp.cloud.requests.request", return_value=json_answer(200, {"messages": [{"id": "wamid.1"}]}))
    def test_a_template_goes_to_meta_with_its_values(self, request):
        message_id = cloud.send_template("201553211120", "fk_web_order_pickup", ["FK-1", "Mona"], language="ar")
        self.assertEqual(message_id, "wamid.1")
        self.assertEqual(request.call_args.args, ("POST", "https://graph.facebook.com/v26.0/111/messages"))
        self.assertEqual(request.call_args.kwargs["headers"], {"Authorization": "Bearer token-1"})
        self.assertEqual(request.call_args.kwargs["json"], {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": "201553211120",
            "type": "template",
            "template": {
                "name": "fk_web_order_pickup",
                "language": {"code": "ar"},
                "components": [{"type": "body", "parameters": [
                    {"type": "text", "text": "FK-1"}, {"type": "text", "text": "Mona"},
                ]}],
            },
        })

    @mock.patch("apps.whatsapp.cloud.requests.request", return_value=json_answer(200, {"messages": [{"id": "wamid.2"}]}))
    def test_a_picture_goes_on_top(self, request):
        cloud.send_template("201553211120", "fk_web_order_deposit_photo", ["FK-1"], language="ar", image_id="m-1")
        components = request.call_args.kwargs["json"]["template"]["components"]
        self.assertEqual(components[0], {"type": "header", "parameters": [{"type": "image", "image": {"id": "m-1"}}]})

    def test_metas_reason_comes_back_and_says_whether_to_try_again(self):
        refusals = [
            (400, {"message": "(#132001) Template name does not exist in the translation", "code": 132001,
                   "error_data": {"details": "template name (x) does not exist in ar"}},
             "template name (x) does not exist in ar (code 132001)", False),
            (400, {"message": "(#130429) Rate limit hit", "code": 130429}, "(#130429) Rate limit hit (code 130429)", True),
            (503, {"message": "Service temporarily unavailable", "code": 2}, "Service temporarily unavailable (code 2)", True),
            (401, {"message": "Invalid OAuth access token", "code": 190}, "Invalid OAuth access token (code 190)", False),
        ]
        for status_code, error, text, transient in refusals:
            with self.subTest(text):
                reply = json_answer(status_code, {"error": error})
                with mock.patch("apps.whatsapp.cloud.requests.request", return_value=reply):
                    with self.assertRaises(cloud.CloudError) as caught:
                        cloud.send_template("201553211120", "x", [], language="ar")
                self.assertEqual((str(caught.exception), caught.exception.transient), (text, transient))

    @mock.patch("apps.whatsapp.cloud.requests.request", side_effect=requests.ConnectionError("refused"))
    def test_unreachable_is_worth_another_try(self, request):
        with self.assertRaises(cloud.CloudError) as caught:
            cloud.upload_media(b"\xff\xd8", "image/jpeg", "FK-1.jpg")
        self.assertTrue(caught.exception.transient)
        self.assertIn("WhatsApp Cloud API unreachable", str(caught.exception))

    @mock.patch("apps.whatsapp.cloud.requests.request", return_value=json_answer(200, {
        "display_phone_number": "+20 15 5321 1120", "verified_name": "Fathet Kheer",
    }))
    def test_the_sending_number_comes_as_digits(self, request):
        self.assertEqual(cloud.sending_number(), "201553211120")
        self.assertEqual(request.call_args.args, ("GET", "https://graph.facebook.com/v26.0/111"))

    @mock.patch("apps.whatsapp.cloud.requests.request", return_value=json_answer(200, {"data": [
        {"name": "fk_web_order_pickup", "language": "ar", "status": "APPROVED"},
        {"name": "fk_web_order_pickup", "language": "en", "status": "REJECTED"},
        {"name": "fk_web_order_delivery", "language": "ar", "status": "PENDING"},
    ]}))
    def test_templates_are_read_for_one_language(self, request):
        self.assertEqual(
            cloud.template_statuses("ar"),
            {"fk_web_order_pickup": "APPROVED", "fk_web_order_delivery": "PENDING"},
        )
        self.assertEqual(request.call_args.args[1], "https://graph.facebook.com/v26.0/222/message_templates")

    @override_settings(WHATSAPP_CLOUD_WABA_ID="")
    def test_templates_need_the_business_account(self):
        with self.assertRaisesMessage(cloud.CloudError, "Set WHATSAPP_CLOUD_WABA_ID"):
            cloud.template_statuses("ar")

    @mock.patch("apps.whatsapp.cloud.requests.post", return_value=json_answer(200, {"h": "handle-1"}))
    @mock.patch("apps.whatsapp.cloud.requests.request", return_value=json_answer(200, {"id": "upload:abc"}))
    def test_a_sample_picture_is_uploaded_through_the_app(self, request, post):
        self.assertEqual(cloud.upload_example(b"\xff\xd8jpeg", "image/jpeg"), "handle-1")
        self.assertEqual(request.call_args.args, ("POST", "https://graph.facebook.com/v26.0/333/uploads"))
        self.assertEqual(post.call_args.args, ("https://graph.facebook.com/v26.0/upload:abc",))
        self.assertEqual(post.call_args.kwargs["headers"], {"Authorization": "OAuth token-1", "file_offset": "0"})
        self.assertEqual(post.call_args.kwargs["data"], b"\xff\xd8jpeg")


class ConfiguredTests(SimpleTestCase):
    def test_both_the_token_and_the_number_are_needed(self):
        with override_settings(WHATSAPP_CLOUD_TOKEN="t", WHATSAPP_CLOUD_PHONE_ID="111"):
            self.assertTrue(cloud.configured())
        with override_settings(WHATSAPP_CLOUD_TOKEN="t", WHATSAPP_CLOUD_PHONE_ID=""):
            self.assertFalse(cloud.configured())
        with override_settings(WHATSAPP_CLOUD_TOKEN="", WHATSAPP_CLOUD_PHONE_ID="111"):
            self.assertFalse(cloud.configured())


@CLOUD
class CloudViewTests(APITestCase):
    def setUp(self):
        admin = User.objects.create_user(username="boss", password="pass12345", role=User.Role.SUPERADMIN)
        self.client.force_authenticate(admin)

    @mock.patch("apps.whatsapp.cloud.sending_number", return_value="201099998888")
    def test_the_status_is_the_cloud_number(self, sending_number):
        response = self.client.get("/api/whatsapp/status/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "provider": "cloud", "connected": True, "number": "201099998888", "qr": None, "error": None,
        })

    @mock.patch("apps.whatsapp.cloud.sending_number", side_effect=cloud.CloudError("Invalid token (code 190)"))
    def test_metas_refusal_shows_in_the_status(self, sending_number):
        response = self.client.get("/api/whatsapp/status/")
        self.assertEqual(response.status_code, 503)
        self.assertEqual((response.json()["connected"], response.json()["error"]), (False, "Invalid token (code 190)"))

    @mock.patch("apps.whatsapp.views.unlink")
    def test_there_is_no_phone_to_unlink(self, unlink):
        self.assertEqual(self.client.post(URL).status_code, 409)
        unlink.assert_not_called()


@NO_CLOUD
class SidecarStatusTests(APITestCase):
    @mock.patch("apps.whatsapp.views.get_status", return_value={"connected": True, "number": "201553211120", "qr": None})
    def test_the_status_says_it_is_the_sidecar(self, get_status):
        self.client.force_authenticate(User.objects.create_user(username="cash", password="pass12345"))
        self.assertEqual(self.client.get("/api/whatsapp/status/").json()["provider"], "sidecar")


@override_settings(DEFAULT_COUNTRY_CODE="20")
class NumberTests(APITestCase):
    def test_numbers_come_out_as_wa_me_wants_them(self):
        for raw, digits in [
            ("0100 123 4567", "201001234567"),
            ("+20 100 123 4567", "201001234567"),
            ("0020 100 123 4567", "201001234567"),
            ("٠١٠٠١٢٣٤٥٦٧", "201001234567"),
            ("+44 20 7946 0958", "442079460958"),
        ]:
            with self.subTest(raw):
                self.assertEqual(client.normalize_number(raw), digits)

    def test_suppliers_carry_the_number_their_chat_opens_with(self):
        Supplier.objects.create(name="Dates Co", phone_number="0100 123 4567")
        self.client.force_authenticate(User.objects.create_user(username="cash", password="pass12345"))
        [supplier] = self.client.get("/api/suppliers/").json()["results"]
        self.assertEqual((supplier["phone_number"], supplier["whatsapp"]), ("0100 123 4567", "201001234567"))
