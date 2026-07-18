import json

from django.test import Client, TestCase

from apps.branches.models import Branch

from .models import DailyReport


class IngestTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.branch = Branch.objects.create(code="BR001", name="Downtown", api_key="secret-key")
        self.url = "/api/ingest/daily-report/"
        self.payload = {
            "branch_code": "BR001",
            "date": "2026-05-28",
            "sales_total": "123.45",
            "order_count": 7,
            "payment_breakdown": {"CASH": "123.45"},
            "top_products": [{"product": "Cola", "quantity": 5, "revenue": "25.00"}],
            "low_stock": [],
        }

    def _post(self, headers):
        return self.client.post(
            self.url, data=json.dumps(self.payload),
            content_type="application/json", headers=headers,
        )

    def test_rejects_missing_auth(self):
        self.assertEqual(self.client.post(self.url, data="{}", content_type="application/json").status_code, 401)

    def test_rejects_wrong_key(self):
        resp = self._post({"X-Branch-Code": "BR001", "X-Api-Key": "wrong"})
        self.assertEqual(resp.status_code, 401)

    def test_accepts_valid_report(self):
        resp = self._post({"X-Branch-Code": "BR001", "X-Api-Key": "secret-key"})
        self.assertEqual(resp.status_code, 200)
        report = DailyReport.objects.get(branch=self.branch, date="2026-05-28")
        self.assertEqual(str(report.sales_total), "123.45")
        self.assertEqual(report.order_count, 7)
        self.branch.refresh_from_db()
        self.assertIsNotNone(self.branch.last_report_at)

    def test_upsert_no_duplicate(self):
        h = {"X-Branch-Code": "BR001", "X-Api-Key": "secret-key"}
        self._post(h)
        self.payload["sales_total"] = "200.00"
        self._post(h)
        self.assertEqual(DailyReport.objects.filter(branch=self.branch).count(), 1)
        self.assertEqual(str(DailyReport.objects.get().sales_total), "200.00")

    def test_dashboard_requires_login(self):
        resp = self.client.get("/")
        self.assertEqual(resp.status_code, 302)
        self.assertIn("/login/", resp["Location"])
