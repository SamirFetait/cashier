from decimal import Decimal
from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection
from django.test.utils import CaptureQueriesContext
from PIL import Image
from rest_framework.test import APITestCase

from .barcodes import ean13_check_digit
from .images import THUMB_SIZE
from .models import Category, Product, ProductImage

User = get_user_model()


def image_file(size=(2000, 1000), fmt="PNG", mode="RGBA", color=(200, 30, 30, 128), exif=None):
    buffer = BytesIO()
    options = {"exif": exif} if exif else {}
    Image.new(mode, size, color).save(buffer, fmt, **options)
    return SimpleUploadedFile(
        f"photo.{fmt.lower()}", buffer.getvalue(), content_type=f"image/{fmt.lower()}"
    )


class ProductImageTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin", password="pass12345", role=User.Role.SUPERADMIN
        )
        self.cashier = User.objects.create_user(
            username="cash", password="pass12345", role=User.Role.CASHIER
        )
        self.product = Product.objects.create(
            name="Dates 1kg", price=Decimal("80.00"), barcode="6221234567890"
        )
        self.url = f"/api/products/{self.product.id}/image/"

    def upload(self, file, user=None):
        self.client.force_authenticate(user=user or self.admin)
        return self.client.post(self.url, {"image": file}, format="multipart")

    def stored(self):
        return ProductImage.objects.get(product=self.product)

    def test_upload_is_stored_as_bounded_jpeg(self):
        resp = self.upload(image_file())
        self.assertEqual(resp.status_code, 200, resp.data)
        stored = self.stored()
        self.assertEqual((stored.width, stored.height), (1200, 600))
        full = Image.open(BytesIO(bytes(stored.data)))
        self.assertEqual((full.format, full.mode), ("JPEG", "RGB"))
        thumb = Image.open(BytesIO(bytes(stored.thumbnail)))
        self.assertEqual(max(thumb.size), THUMB_SIZE)

    def test_transparency_becomes_white_not_black(self):
        self.upload(image_file(color=(200, 30, 30, 128)))  # half-transparent red
        red, green, blue = Image.open(BytesIO(bytes(self.stored().data))).getpixel((600, 300))
        # Blended over white the green channel rises well above the 30 it
        # would keep if the alpha were simply dropped.
        self.assertGreater(green, 100)

    def test_phone_rotation_is_applied(self):
        exif = Image.Exif()
        exif[0x0112] = 6  # Orientation: rotate 90° clockwise to display
        resp = self.upload(
            image_file(size=(400, 300), fmt="JPEG", mode="RGB", color=(10, 120, 60), exif=exif.tobytes())
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual((self.stored().width, self.stored().height), (300, 400))

    def test_product_carries_versioned_absolute_url(self):
        resp = self.upload(image_file())
        version = self.stored().checksum[:16]
        self.assertEqual(
            resp.data["image_url"],
            f"http://testserver/api/products/{self.product.id}/image/?v={version}",
        )
        self.client.force_authenticate(user=self.cashier)
        detail = self.client.get(f"/api/products/{self.product.id}/").data
        self.assertEqual(detail["image_url"], resp.data["image_url"])

    def test_barcode_lookup_includes_photo(self):
        self.upload(image_file())
        self.client.force_authenticate(user=self.cashier)
        resp = self.client.get("/api/products/lookup/?barcode=6221234567890")
        self.assertTrue(resp.data["image_url"].startswith("http://testserver/"))

    def test_product_without_photo_has_no_url(self):
        self.client.force_authenticate(user=self.cashier)
        resp = self.client.get(f"/api/products/{self.product.id}/")
        self.assertIsNone(resp.data["image_url"])

    def test_photo_is_public_and_cacheable(self):
        self.upload(image_file())
        version = self.stored().checksum[:16]
        self.client.force_authenticate(user=None)  # an <img> tag sends no token
        resp = self.client.get(f"{self.url}?v={version}")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp["Content-Type"], "image/jpeg")
        self.assertEqual(resp["Cache-Control"], "public, max-age=31536000, immutable")
        again = self.client.get(f"{self.url}?v={version}", HTTP_IF_NONE_MATCH=resp["ETag"])
        self.assertEqual(again.status_code, 304)
        self.assertEqual(self.client.head(self.url).status_code, 200)

    def test_thumbnail_is_served_small(self):
        self.upload(image_file())
        resp = self.client.get(f"{self.url}?size=thumb")
        self.assertEqual(max(Image.open(BytesIO(resp.content)).size), THUMB_SIZE)

    def test_replacing_photo_changes_version(self):
        self.upload(image_file(color=(0, 0, 255, 255)))
        old = self.stored().checksum[:16]
        self.upload(image_file(color=(0, 255, 0, 255)))
        self.assertNotEqual(self.stored().checksum[:16], old)
        self.client.force_authenticate(user=None)
        # The old URL must not be cached forever, or the old photo would stick.
        self.assertEqual(self.client.get(f"{self.url}?v={old}")["Cache-Control"], "no-cache")

    def test_cashier_cannot_change_photo(self):
        self.assertEqual(self.upload(image_file(), user=self.cashier).status_code, 403)
        self.client.force_authenticate(user=self.cashier)
        self.assertEqual(self.client.delete(self.url).status_code, 403)

    def test_rejects_non_image(self):
        bogus = SimpleUploadedFile("notes.png", b"not a picture", content_type="image/png")
        self.assertEqual(self.upload(bogus).status_code, 400)
        self.assertFalse(ProductImage.objects.exists())

    def test_rejects_oversized_upload(self):
        big = SimpleUploadedFile("big.jpg", b"\0" * (10 * 1024 * 1024 + 1), content_type="image/jpeg")
        self.assertEqual(self.upload(big).status_code, 400)

    def test_missing_file_field(self):
        self.client.force_authenticate(user=self.admin)
        self.assertEqual(self.client.post(self.url, {}, format="multipart").status_code, 400)

    def test_delete_removes_photo(self):
        self.upload(image_file())
        self.client.force_authenticate(user=self.admin)
        resp = self.client.delete(self.url)
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.data["image_url"])
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(self.url).status_code, 404)

    def test_unknown_product_is_404(self):
        self.assertEqual(self.client.get("/api/products/999999/image/").status_code, 404)
        self.assertEqual(self.client.get("/api/products/abc/image/").status_code, 404)

    def test_product_list_never_loads_image_bytes(self):
        self.upload(image_file())
        self.client.force_authenticate(user=self.cashier)
        with CaptureQueriesContext(connection) as ctx:
            resp = self.client.get("/api/products/")
        self.assertIsNotNone(resp.data["results"][0]["image_url"])
        sql = " ".join(q["sql"] for q in ctx.captured_queries)
        self.assertNotIn('"products_productimage"."data"', sql)
        self.assertNotIn('"products_productimage"."thumbnail"', sql)


def is_valid_ean13(code: str) -> bool:
    return len(code) == 13 and code.isdigit() and ean13_check_digit(code[:12]) == code[12]


class StoreBarcodeTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin", password="pass12345", role=User.Role.SUPERADMIN
        )
        self.cashier = User.objects.create_user(
            username="cash", password="pass12345", role=User.Role.CASHIER
        )
        self.category = Category.objects.create(name="حلويات")
        self.client.force_authenticate(user=self.admin)

    def create(self, **fields):
        payload = {"name": "Basbousa", "price": "35.00", "category": self.category.id}
        return self.client.post("/api/products/", {**payload, **fields}, format="json")

    def test_check_digit_matches_real_barcodes(self):
        # Published valid EAN-13s (an ISBN among them) and the demo data's in-store pattern.
        for code in ["5900259127204", "4006381333931", "9780306406157", "2000000000015"]:
            self.assertEqual(ean13_check_digit(code[:12]), code[12], code)

    def test_create_with_generated_barcode(self):
        resp = self.create(generate_barcode=True)
        self.assertEqual(resp.status_code, 201, resp.data)
        code = resp.data["barcode"]
        self.assertTrue(code.startswith("20"), code)
        self.assertTrue(is_valid_ean13(code), code)
        self.assertEqual(resp.data["category_name"], "حلويات")
        self.assertNotIn("generate_barcode", resp.data)

    def test_codes_already_in_use_are_skipped(self):
        Product.objects.create(name="Cheddar", price=Decimal("80.00"), barcode="2000000000015")
        first = self.create(generate_barcode=True).data["barcode"]
        second = self.create(name="Konafa", generate_barcode=True).data["barcode"]
        self.assertEqual(first, "2000000000022")
        self.assertEqual(second, "2000000000039")

    def test_existing_barcode_is_never_replaced(self):
        product = Product.objects.create(name="Chips", price=Decimal("10.00"), barcode="5900259127204")
        resp = self.client.patch(f"/api/products/{product.id}/", {"generate_barcode": True}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("barcode", resp.data)
        resp = self.create(barcode="5900259127211", generate_barcode=True)
        self.assertEqual(resp.status_code, 400)
        product.refresh_from_db()
        self.assertEqual(product.barcode, "5900259127204")

    def test_generate_for_existing_product_without_one(self):
        product = Product.objects.create(name="Feteer", price=Decimal("50.00"))
        resp = self.client.patch(f"/api/products/{product.id}/", {"generate_barcode": True}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        product.refresh_from_db()
        self.assertTrue(is_valid_ean13(product.barcode))

    def test_saving_without_the_flag_leaves_barcode_alone(self):
        resp = self.create()
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertIsNone(resp.data["barcode"])

    def test_bulk_fills_only_active_products_missing_a_code(self):
        missing = Product.objects.create(name="A", price=Decimal("1.00"))
        blank = Product.objects.create(name="B", price=Decimal("1.00"), barcode="")
        coded = Product.objects.create(name="C", price=Decimal("1.00"), barcode="5900259127204")
        inactive = Product.objects.create(name="D", price=Decimal("1.00"), is_active=False)

        resp = self.client.post("/api/products/generate-barcodes/", {}, format="json")
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data["updated"], 2)
        self.assertEqual({p["id"] for p in resp.data["products"]}, {missing.id, blank.id})
        for product in (missing, blank, coded, inactive):
            product.refresh_from_db()
        self.assertTrue(is_valid_ean13(missing.barcode))
        self.assertTrue(is_valid_ean13(blank.barcode))
        self.assertNotEqual(missing.barcode, blank.barcode)
        self.assertEqual(coded.barcode, "5900259127204")
        self.assertIsNone(inactive.barcode)

    def test_bulk_with_ids_reaches_inactive_products(self):
        inactive = Product.objects.create(name="D", price=Decimal("1.00"), is_active=False)
        other = Product.objects.create(name="E", price=Decimal("1.00"))
        resp = self.client.post(
            "/api/products/generate-barcodes/", {"ids": [inactive.id]}, format="json"
        )
        self.assertEqual(resp.data["updated"], 1)
        inactive.refresh_from_db()
        other.refresh_from_db()
        self.assertTrue(is_valid_ean13(inactive.barcode))
        self.assertIsNone(other.barcode)

    def test_bulk_rejects_malformed_ids(self):
        resp = self.client.post("/api/products/generate-barcodes/", {"ids": "all"}, format="json")
        self.assertEqual(resp.status_code, 400)

    def test_cashier_cannot_generate(self):
        product = Product.objects.create(name="A", price=Decimal("1.00"))
        self.client.force_authenticate(user=self.cashier)
        self.assertEqual(self.client.post("/api/products/generate-barcodes/", {}, format="json").status_code, 403)
        self.assertEqual(self.create(generate_barcode=True).status_code, 403)
        product.refresh_from_db()
        self.assertIsNone(product.barcode)

    def test_generated_code_scans_at_the_till(self):
        code = self.create(generate_barcode=True).data["barcode"]
        self.client.force_authenticate(user=self.cashier)
        resp = self.client.get(f"/api/products/lookup/?barcode={code}")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["name"], "Basbousa")
        self.assertEqual(resp.data["price"], "35.00")
