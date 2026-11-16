import shutil
import tempfile
from io import BytesIO
from pathlib import Path

from django.test import override_settings

from apps.webshop.models import ShopVideo

from .base import SHOP, ShopTestCase, png_bytes



def mp4(size=4096) -> BytesIO:
    body = b"\x00\x00\x00\x18ftypmp42" + bytes(range(256)) * (size // 256)
    upload = BytesIO(body[:size])
    upload.name = "clip.mp4"
    return upload


def webm() -> BytesIO:
    upload = BytesIO(b"\x1a\x45\xdf\xa3" + b"\x01" * 2048)
    upload.name = "clip.webm"
    return upload


class VideoTests(ShopTestCase):
    def setUp(self):
        super().setUp()
        self.media_root = tempfile.mkdtemp(prefix="fk-media-")
        self.addCleanup(shutil.rmtree, self.media_root, ignore_errors=True)
        override = override_settings(MEDIA_ROOT=Path(self.media_root), SHOP_VIDEO_MAX_MB=1)
        override.enable()
        self.addCleanup(override.disable)
        self.admin = self.staff_client()

    def upload(self, client=None, **fields):
        body = {"file": mp4(), "placement": "STORY", "title": "Honey harvest", **fields}
        return (client or self.admin).post(f"{SHOP}/admin/videos/", body, format="multipart")

    def test_upload_shows_on_the_storefront(self):
        response = self.upload(
            poster=png_bytes((320, 568)), duration="6.5", width="720", height="1280",
            product_id=str(self.honey.pk), caption="Straight from the hive",
        )
        self.assertEqual(response.status_code, 201, response.content)
        video = response.json()["video"]
        self.assertRegex(video["src"], r"^/media/videos/[0-9a-f]{32}\.mp4$")
        self.assertRegex(video["poster"], r"^/media/videos/posters/[0-9a-f]{32}\.jpg$")
        self.assertEqual((video["duration"], video["width"], video["height"]), (6.5, 720, 1280))
        self.assertEqual((video["product_id"], video["size"], video["created_by"]), (self.honey.pk, 4096, "samir"))

        hero = self.upload(placement="HERO", title="", file=webm()).json()["video"]
        self.assertTrue(hero["src"].endswith(".webm"))
        self.assertIsNone(hero["poster"])

        videos = self.client.get(f"{SHOP}/config/").json()["videos"]
        self.assertEqual(videos["hero"]["id"], hero["id"])
        self.assertEqual([v["title"] for v in videos["stories"]], ["Honey harvest"])
        self.assertNotIn("created_by", videos["stories"][0])

    def test_what_is_not_a_video_is_refused(self):
        fake = BytesIO(b"MZ\x90\x00" + b"\x00" * 4096)
        fake.name = "clip.mp4"   # an executable wearing a video's name
        response = self.upload(file=fake)
        self.assertEqual((response.status_code, response.json()["code"]), (400, "INVALID_VIDEO"))
        too_big = self.upload(file=mp4(size=1024 * 1024 + 4096))
        self.assertEqual(too_big.json()["code"], "INVALID_VIDEO")
        self.assertEqual(self.admin.post(f"{SHOP}/admin/videos/", {"title": "x"}, format="multipart").json()["code"], "INVALID")
        self.assertEqual(ShopVideo.objects.count(), 0)
        self.assertEqual(list(Path(self.media_root).rglob("*.*")), [])

    def test_only_super_admins_manage_videos(self):
        cashier = self.staff_client("cashier")
        self.assertEqual(self.upload(cashier).status_code, 403)
        video = self.upload().json()["video"]
        self.assertEqual(cashier.get(f"{SHOP}/admin/videos/").json()["videos"][0]["id"], video["id"])
        url = f"{SHOP}/admin/videos/{video['id']}/"
        self.assertEqual(cashier.patch(url, {"title": "x"}, format="json").status_code, 403)
        self.assertEqual(cashier.delete(url).status_code, 403)

    def test_edit_hide_and_delete(self):
        video = self.upload(poster=png_bytes()).json()["video"]
        url = f"{SHOP}/admin/videos/{video['id']}/"
        edited = self.admin.patch(
            url, {"title": "New title", "is_active": False, "sort": 5, "product_id": None}, format="json"
        ).json()["video"]
        self.assertEqual((edited["title"], edited["is_active"], edited["sort"]), ("New title", False, 5))
        self.assertEqual(self.client.get(f"{SHOP}/config/").json()["videos"]["stories"], [])

        files = [Path(self.media_root) / video["src"][len("/media/"):],
                 Path(self.media_root) / video["poster"][len("/media/"):]]
        self.assertTrue(all(f.is_file() for f in files))
        self.assertEqual(self.admin.delete(url).status_code, 204)
        self.assertFalse(any(f.exists() for f in files))
        self.assertEqual(self.admin.delete(url).status_code, 404)

    def test_videos_stream_with_byte_ranges(self):
        src = self.upload().json()["video"]["src"]
        whole = self.client.get(src)
        body = b"".join(whole.streaming_content)
        self.assertEqual((whole.status_code, len(body), whole["Content-Type"]), (200, 4096, "video/mp4"))
        self.assertEqual(whole["Accept-Ranges"], "bytes")
        self.assertIn("immutable", whole["Cache-Control"])

        part = self.client.get(src, HTTP_RANGE="bytes=100-199")
        self.assertEqual(part.status_code, 206)
        self.assertEqual(part["Content-Range"], "bytes 100-199/4096")
        self.assertEqual(b"".join(part.streaming_content), body[100:200])

        tail = self.client.get(src, HTTP_RANGE="bytes=-96")
        self.assertEqual((tail["Content-Range"], tail["Content-Length"]), ("bytes 4000-4095/4096", "96"))
        open_ended = self.client.get(src, HTTP_RANGE="bytes=4000-")
        self.assertEqual(b"".join(open_ended.streaming_content), body[4000:])
        clamped = self.client.get(src, HTTP_RANGE="bytes=4000-999999")
        self.assertEqual(clamped["Content-Range"], "bytes 4000-4095/4096")

        beyond = self.client.get(src, HTTP_RANGE="bytes=5000-6000")
        self.assertEqual((beyond.status_code, beyond["Content-Range"]), (416, "bytes */4096"))
        head = self.client.head(src)
        self.assertEqual((head.status_code, head["Content-Length"]), (200, "4096"))
        cached = self.client.get(src, HTTP_IF_NONE_MATCH=whole["ETag"])
        self.assertEqual(cached.status_code, 304)

    def test_media_cannot_reach_outside_the_uploads(self):
        Path(self.media_root, "secret.mp4").write_bytes(b"x" * 10)
        for path in ("/media/secret.mp4", "/media/videos/../secret.mp4", "/media/videos/missing.mp4",
                     "/media/videos/..%2f..%2fmanage.py", "/media/videos/"):
            self.assertEqual(self.client.get(path).status_code, 404, path)
