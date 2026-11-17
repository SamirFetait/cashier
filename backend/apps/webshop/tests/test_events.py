"""Events on the website: written in the orders admin, with photos and short
videos, shown publicly while they are current and for a while after."""
import shutil
import tempfile
from datetime import timedelta
from io import BytesIO
from pathlib import Path

from django.test import override_settings
from django.utils import timezone

from apps.webshop import services
from apps.webshop.models import EventMedia, ShopEvent

from .base import SHOP, ShopTestCase, png_bytes
from .test_media import mp4

EVENTS = f"{SHOP}/admin/events/"


class EventTests(ShopTestCase):
    def setUp(self):
        super().setUp()
        self.media_root = tempfile.mkdtemp(prefix="fk-events-")
        self.addCleanup(shutil.rmtree, self.media_root, ignore_errors=True)
        override = override_settings(MEDIA_ROOT=Path(self.media_root), SHOP_VIDEO_MAX_MB=1)
        override.enable()
        self.addCleanup(override.disable)
        self.admin = self.staff_client()

    def create(self, days=3, **fields):
        body = {
            "title": "Honey tasting",
            "description": "  Taste five kinds of honey.\nFree for everyone.  ",
            "starts_at": (timezone.now() + timedelta(days=days)).isoformat(),
            **fields,
        }
        response = self.admin.post(EVENTS, body, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()["event"]

    def add(self, event, file, **fields):
        return self.admin.post(f"{EVENTS}{event['id']}/media/", {"file": file, **fields}, format="multipart")

    def public(self):
        return self.client.get(f"{SHOP}/events/").json()

    def test_an_event_with_photos_and_a_video_shows_on_the_website(self):
        event = self.create(place="Fathet Kheer, Maadi")
        self.assertEqual(event["description"], "Taste five kinds of honey.\nFree for everyone.")
        self.assertIsNone(event["cover"])

        video = self.add(event, mp4(), poster=png_bytes((320, 568)), duration="12.5", width="720", height="1280")
        self.assertEqual(video.status_code, 201, video.content)
        photo = self.add(event, png_bytes((2400, 1600)))
        self.assertEqual(photo.status_code, 201, photo.content)
        media = photo.json()["event"]["media"]
        self.assertEqual([m["kind"] for m in media], ["VIDEO", "PHOTO"])
        self.assertRegex(media[0]["src"], r"^/media/events/[0-9a-f]{32}\.mp4$")
        self.assertEqual((media[0]["duration"], media[0]["width"]), (12.5, 720))
        # Photos are re-encoded as JPEG and shrunk to 1600px at most.
        self.assertRegex(media[1]["src"], r"^/media/events/[0-9a-f]{32}\.jpg$")
        self.assertEqual((media[1]["width"], media[1]["height"]), (1600, 1067))
        self.assertEqual(self.client.get(media[1]["src"])["Content-Type"], "image/jpeg")

        shown = self.public()["upcoming"]
        self.assertEqual([e["title"] for e in shown], ["Honey tasting"])
        # The cover is the first photo, even when a video comes first.
        self.assertEqual(shown[0]["cover"], media[1]["src"])
        self.assertEqual(shown[0]["place"], "Fathet Kheer, Maadi")
        self.assertNotIn("is_published", shown[0])

    def test_videos_stream_with_byte_ranges(self):
        event = self.create()
        src = self.add(event, mp4()).json()["event"]["media"][0]["src"]
        part = self.client.get(src, HTTP_RANGE="bytes=0-99")
        self.assertEqual((part.status_code, part["Content-Range"]), (206, "bytes 0-99/4096"))

    def test_upcoming_first_then_recent_past(self):
        later = self.create(days=10, title="Later")
        soon = self.create(days=1, title="Soon")
        # Today, already started, with no end: still shown as current all day.
        today = self.create(title="Today", starts_at=services.start_of_today().isoformat())
        ended = self.create(title="Ended", starts_at=(timezone.now() - timedelta(days=3)).isoformat(),
                            ends_at=(timezone.now() - timedelta(days=2)).isoformat())
        running = self.create(title="Running", starts_at=(timezone.now() - timedelta(days=2)).isoformat(),
                              ends_at=(timezone.now() + timedelta(days=2)).isoformat())
        for days in range(10, 18):
            self.create(title=f"Old {days}", days=-days)
        self.create(title="Draft", is_published=False)

        data = self.public()
        self.assertEqual([e["title"] for e in data["upcoming"]], ["Running", "Today", "Soon", "Later"])
        self.assertEqual(
            [e["title"] for e in data["past"]], ["Ended", "Old 10", "Old 11", "Old 12", "Old 13", "Old 14"]
        )
        self.assertTrue(all(e["id"] not in (later["id"], soon["id"], today["id"], running["id"]) for e in data["past"]))
        self.assertNotIn(ended["id"], [e["id"] for e in data["upcoming"]])

    def test_publish_edit_and_validation(self):
        event = self.create()
        hidden = self.admin.patch(f"{EVENTS}{event['id']}/", {"is_published": False}, format="json")
        self.assertFalse(hidden.json()["event"]["is_published"])
        self.assertEqual(self.public()["upcoming"], [])

        bad = self.admin.patch(
            f"{EVENTS}{event['id']}/", {"ends_at": (timezone.now() - timedelta(days=30)).isoformat()}, format="json"
        )
        self.assertEqual((bad.status_code, bad.json()["code"]), (400, "INVALID"))
        self.assertIn("ends_at", bad.json()["fields"])
        self.assertEqual(self.admin.post(EVENTS, {"title": "X"}, format="json").status_code, 400)

    def test_what_is_neither_a_photo_nor_a_video_is_refused(self):
        event = self.create()
        fake = BytesIO(b"<?php echo 1; ?>" * 100)
        fake.name = "party.jpg"
        response = self.add(event, fake)
        self.assertEqual((response.status_code, response.json()["code"]), (400, "INVALID_MEDIA"))
        too_big = self.add(event, mp4(size=2 * 1024 * 1024))
        self.assertEqual(too_big.json()["code"], "INVALID_VIDEO")
        self.assertFalse(EventMedia.objects.exists())

    def test_an_event_holds_at_most_twenty_items(self):
        event = self.create()
        shown = ShopEvent.objects.get(pk=event["id"])
        EventMedia.objects.bulk_create(
            EventMedia(event=shown, kind="PHOTO", file=f"events/{i}.jpg", content_type="image/jpeg", sort=i)
            for i in range(EventMedia.MAX_PER_EVENT)
        )
        self.assertEqual(self.add(event, png_bytes()).json()["code"], "TOO_MANY_MEDIA")

    def test_reorder_and_delete_remove_the_files(self):
        event = self.create()
        first = self.add(event, png_bytes()).json()["event"]["media"][0]
        media = self.add(event, mp4(), poster=png_bytes()).json()["event"]["media"]
        second = media[1]
        reordered = self.admin.post(f"{EVENTS}{event['id']}/media/order/", {"ids": [second["id"], first["id"]]}, format="json")
        self.assertEqual([m["id"] for m in reordered.json()["event"]["media"]], [second["id"], first["id"]])
        partial = self.admin.post(f"{EVENTS}{event['id']}/media/order/", {"ids": [first["id"]]}, format="json")
        self.assertEqual(partial.status_code, 400)

        files = lambda: sorted(p.name for p in Path(self.media_root, "events").iterdir())  # noqa: E731
        self.assertEqual(len(files()), 3)   # photo, video and its poster
        left = self.admin.delete(f"{EVENTS}{event['id']}/media/{first['id']}/")
        self.assertEqual([m["id"] for m in left.json()["event"]["media"]], [second["id"]])
        self.assertEqual(len(files()), 2)
        self.assertEqual(self.admin.delete(f"{EVENTS}{event['id']}/").status_code, 204)
        self.assertEqual(files(), [])
        self.assertFalse(ShopEvent.objects.exists())

    def test_only_super_admins_change_events(self):
        event = self.create()
        cashier = self.staff_client("cashier")
        self.assertEqual(cashier.get(EVENTS).status_code, 200)
        self.assertEqual(cashier.post(EVENTS, {"title": "Mine", "starts_at": timezone.now().isoformat()}, format="json").status_code, 403)
        self.assertEqual(cashier.patch(f"{EVENTS}{event['id']}/", {"title": "Changed"}, format="json").status_code, 403)
        self.assertEqual(cashier.post(f"{EVENTS}{event['id']}/media/", {"file": png_bytes()}, format="multipart").status_code, 403)
        self.assertEqual(cashier.delete(f"{EVENTS}{event['id']}/").status_code, 403)
        self.assertEqual(self.client.get(EVENTS).status_code, 401)
