"""The server's 404: JSON for the API and for programs, the lost-bee page for
people. SimpleTestCase, so a 404 is also shown never to touch the database."""
import json

from django.test import SimpleTestCase, override_settings

BROWSER = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"


@override_settings(SHOP_SITE_URL="https://fatheetkheer.com")
class NotFoundTests(SimpleTestCase):
    def page(self, url, **headers):
        response = self.client.get(url, headers={"Accept": BROWSER, **headers})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response["Content-Type"], "text/html; charset=utf-8")
        return response.content.decode()

    def test_a_person_gets_the_lost_bee_page_in_arabic_by_default(self):
        html = self.page("/no-such-page/")
        self.assertIn('<html lang="ar" dir="rtl">', html)
        self.assertIn("الصفحة دي طارت!", html)
        self.assertIn('<meta name="robots" content="noindex">', html)
        # It points to the shop, and offers the other language.
        self.assertIn('href="https://fatheetkheer.com"', html)
        self.assertIn('href="?lang=en"', html)
        # The bee's words for the script, in the page's language.
        words = html.split('<script id="nf-words" type="application/json">')[1].split("</script>")[0]
        self.assertEqual(json.loads(words), {"thoughts": ["همم…", "مش هنا…", "؟"], "give_up": "؟!"})

    def test_the_page_follows_the_browsers_languages(self):
        html = self.page("/missing", **{"Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8,ar;q=0.7"})
        self.assertIn('<html lang="en" dir="ltr">', html)
        self.assertIn("This page flew away", html)
        html = self.page("/missing", **{"Accept-Language": "en;q=0.5, ar-EG"})
        self.assertIn('<html lang="ar" dir="rtl">', html)

    def test_a_language_picked_on_the_page_wins(self):
        html = self.page("/missing?lang=en", **{"Accept-Language": "ar-EG,ar"})
        self.assertIn('<html lang="en" dir="ltr">', html)
        html = self.page("/missing?lang=ar", **{"Accept-Language": "en-GB,en"})
        self.assertIn('<html lang="ar" dir="rtl">', html)
        html = self.page("/missing?lang=xx", **{"Accept-Language": "en"})
        self.assertIn('<html lang="en" dir="ltr">', html)

    def test_the_answer_depends_on_what_was_asked_for(self):
        response = self.client.get("/missing", headers={"Accept": BROWSER})
        self.assertIn("Accept", response["Vary"])
        self.assertIn("Accept-Language", response["Vary"])

    def test_the_api_answers_in_its_own_json_shape(self):
        for url in ("/api/no-such-thing/", "/api/shop/nothing-here/"):
            with self.subTest(url=url):
                # Even a browser asking for HTML: the API speaks JSON.
                response = self.client.get(url, headers={"Accept": BROWSER})
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response["Content-Type"], "application/json")
                self.assertEqual(response.json(), {"code": "NOT_FOUND", "detail": "Not found."})

    def test_a_program_asking_for_json_gets_json(self):
        response = self.client.get("/missing", headers={"Accept": "application/json"})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"code": "NOT_FOUND", "detail": "Not found."})
