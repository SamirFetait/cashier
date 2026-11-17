"""Nutrition facts on products, and the healthy swap finder."""
from apps.products.models import Product
from apps.webshop.models import HealthySwap, Listing

from .base import SHOP, ShopTestCase


class NutritionTests(ShopTestCase):
    def listing(self, client, product, **body):
        return client.patch(f"{SHOP}/admin/listings/{product.pk}/", body, format="json")

    def catalog_product(self, product):
        return next(p for p in self.client.get(f"{SHOP}/catalog/").json()["products"] if p["id"] == product.pk)

    def test_facts_per_100g_reach_the_catalogue(self):
        self.assertIsNone(self.catalog_product(self.honey)["nutrition"])
        admin = self.staff_client()
        response = self.listing(
            admin, self.honey, kcal="304", protein="0.3", carbs="82.4", sugar="82.1", fat="0", fiber="0.2",
            piece_grams="500",
        )
        self.assertEqual(response.status_code, 200, response.content)
        row = response.json()["product"]
        self.assertEqual((row["kcal"], row["sugar"], row["piece_grams"]), ("304", "82.1", "500"))
        self.assertEqual(
            self.catalog_product(self.honey)["nutrition"],
            {"kcal": "304", "protein": "0.3", "carbs": "82.4", "sugar": "82.1", "fat": "0", "fiber": "0.2",
             "piece_grams": "500"},
        )
        # Other fields are left as they were.
        self.listing(admin, self.honey, badge="Raw")
        self.assertEqual(Listing.objects.get(product=self.honey).kcal, 304)

    def test_shown_only_once_calories_are_in(self):
        admin = self.staff_client()
        self.listing(admin, self.olives, protein="1.0", fat="15.3")
        self.assertIsNone(self.catalog_product(self.olives)["nutrition"])
        self.listing(admin, self.olives, kcal="145")
        nutrition = self.catalog_product(self.olives)["nutrition"]
        self.assertEqual((nutrition["kcal"], nutrition["fat"], nutrition["carbs"]), ("145", "15.3", None))
        # Clearing the calories takes the facts off the website again.
        self.listing(admin, self.olives, kcal=None)
        self.assertIsNone(self.catalog_product(self.olives)["nutrition"])

    def test_impossible_figures_are_refused(self):
        admin = self.staff_client()
        for body, field in [
            ({"kcal": "-1"}, "kcal"),
            ({"kcal": "950"}, "kcal"),
            ({"protein": "120"}, "protein"),
            ({"carbs": "10", "sugar": "12"}, "sugar"),
            ({"piece_grams": "0"}, "piece_grams"),
        ]:
            response = self.listing(admin, self.honey, **body)
            self.assertEqual(response.status_code, 400, body)
            self.assertIn(field, response.json()["fields"], body)

    def test_only_super_admins_edit_facts(self):
        response = self.listing(self.staff_client("cashier"), self.honey, kcal="304")
        self.assertEqual(response.status_code, 403)


class SwapTests(ShopTestCase):
    SWAPS = f"{SHOP}/admin/swaps/"

    def test_a_swap_reaches_the_website_with_its_visible_products(self):
        admin = self.staff_client()
        response = admin.post(
            self.SWAPS,
            {"craving": " Sweets ", "emoji": "🍫", "reason": "Natural sugars and fibre.",
             "product_ids": [self.honey.pk, self.dates.pk, self.honey.pk]},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        swap = response.json()["swap"]
        # Repeats dropped; listed in the catalogue's own order.
        self.assertEqual((swap["craving"], [p["name"] for p in swap["products"]]), ("Sweets", ["Medjool Dates 1kg", "Sidr Honey 500g"]))

        Listing.objects.create(product=self.dates, hidden=True)
        shown = self.client.get(f"{SHOP}/config/").json()["swaps"]
        self.assertEqual(shown, [{"id": swap["id"], "craving": "Sweets", "emoji": "🍫",
                                  "reason": "Natural sugars and fibre.", "product_ids": [self.honey.pk]}])

        Product.objects.filter(pk=self.honey.pk).update(is_active=False)
        self.assertEqual(self.client.get(f"{SHOP}/config/").json()["swaps"][0]["product_ids"], [])

    def test_edit_switch_off_and_delete(self):
        admin = self.staff_client()
        swap = admin.post(self.SWAPS, {"craving": "Soft drinks", "product_ids": [self.honey.pk]}, format="json").json()["swap"]
        edited = admin.patch(f"{self.SWAPS}{swap['id']}/", {"product_ids": [self.olives.pk], "sort": 3}, format="json")
        self.assertEqual([p["id"] for p in edited.json()["swap"]["products"]], [self.olives.pk])

        admin.patch(f"{self.SWAPS}{swap['id']}/", {"is_active": False}, format="json")
        self.assertEqual(self.client.get(f"{SHOP}/config/").json()["swaps"], [])
        self.assertEqual([s["craving"] for s in admin.get(self.SWAPS).json()["swaps"]], ["Soft drinks"])

        self.assertEqual(admin.delete(f"{self.SWAPS}{swap['id']}/").status_code, 204)
        self.assertFalse(HealthySwap.objects.exists())

    def test_unknown_products_and_cashiers_are_refused(self):
        admin = self.staff_client()
        bad = admin.post(self.SWAPS, {"craving": "Chips", "product_ids": [999999]}, format="json")
        self.assertEqual(bad.status_code, 400)
        self.assertIn("product_ids", bad.json()["fields"])
        cashier = self.staff_client("cashier")
        self.assertEqual(cashier.get(self.SWAPS).status_code, 200)
        self.assertEqual(cashier.post(self.SWAPS, {"craving": "Chips"}, format="json").status_code, 403)
