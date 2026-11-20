"""Unlinking the WhatsApp account the server sends from."""
from unittest import mock

import requests
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase
from rest_framework.test import APITestCase

from apps.whatsapp import client
from apps.whatsapp.client import WhatsAppError

User = get_user_model()
URL = "/api/whatsapp/unlink/"


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
