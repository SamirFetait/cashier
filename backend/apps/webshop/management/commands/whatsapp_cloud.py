"""Setting up the website's order alerts on Meta's WhatsApp Cloud API."""
from io import BytesIO

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from PIL import Image, ImageDraw

from apps.webshop import alerts, phones
from apps.webshop.models import ShopSettings
from apps.whatsapp import cloud


class Command(BaseCommand):
    help = (
        "Order alerts through Meta's WhatsApp Cloud API. 'templates' submits the alert "
        "templates for Meta's review (skipping any Meta already has); 'status' shows the "
        "sending number, where alerts go and whether each template is approved; 'test' "
        "sends a sample alert to the alert number, or to --to."
    )

    def add_arguments(self, parser):
        parser.add_argument("action", choices=["templates", "status", "test"])
        parser.add_argument("--to", default="", help="test: send to this number instead of the alert number")

    def handle(self, *args, action, to, **options):
        if not cloud.configured():
            raise CommandError(
                "Set WHATSAPP_CLOUD_TOKEN and WHATSAPP_CLOUD_PHONE_ID first "
                "(README: WhatsApp order alerts through Meta's Cloud API)."
            )
        try:
            {"templates": self.templates, "status": self.status, "test": self.test}[action](to)
        except cloud.CloudError as exc:
            raise CommandError(str(exc)) from exc

    def templates(self, _to):
        have = cloud.template_statuses(alerts.LANGUAGE)
        for name in alerts.TEMPLATES:
            if name in have:
                self.stdout.write(f"{name}: Meta already has it, {have[name]}")
                continue
            try:
                handle = ""
                if name == alerts.DEPOSIT_PHOTO_TEMPLATE:
                    handle = cloud.upload_example(example_screenshot(), "image/jpeg")
                answer = cloud.create_template(alerts.template_definition(name, handle))
            except cloud.CloudError as exc:
                fallback = " Deposit alerts go as text until it exists." if name == alerts.DEPOSIT_PHOTO_TEMPLATE else ""
                self.stderr.write(f"{name}: not submitted: {exc}.{fallback}")
                continue
            self.stdout.write(self.style.SUCCESS(f"{name}: submitted, {answer.get('status') or 'PENDING'}"))
        self.stdout.write("Meta reviews them within minutes, at most a day. Check: python manage.py whatsapp_cloud status")

    def status(self, _to):
        info = cloud.phone_number()
        self.stdout.write(
            f"Sends from: {info.get('display_phone_number')} ({info.get('verified_name') or 'no name yet'}), "
            f"quality {info.get('quality_rating') or 'unknown'}"
        )
        to = alerts.alert_number(ShopSettings.load())
        self.stdout.write(f"Alerts go to: +{to}" if to else "Alerts go to: no number set (Website → Settings)")
        if not settings.WHATSAPP_CLOUD_WABA_ID:
            self.stdout.write("Templates: set WHATSAPP_CLOUD_WABA_ID to check them.")
            return
        have = cloud.template_statuses(alerts.LANGUAGE)
        for name in alerts.TEMPLATES:
            self.stdout.write(f"{name}: {have.get(name) or 'missing (run: whatsapp_cloud templates)'}")

    def test(self, to):
        number = _digits(to) if to else alerts.alert_number(ShopSettings.load())
        if not number:
            raise CommandError("No number to send to: set one in Website → Settings, or pass --to.")
        values = list(alerts.TEMPLATE_EXAMPLES[alerts.PICKUP_TEMPLATE])
        values[0], values[1] = "FK-TEST", "تجربة من الخادم"
        message_id = cloud.send_template(number, alerts.PICKUP_TEMPLATE, values, language=alerts.LANGUAGE)
        self.stdout.write(self.style.SUCCESS(
            f"A sample pickup alert went to +{number} (message {message_id}). Check that phone."
        ))


def _digits(raw: str) -> str:
    try:
        return phones.whatsapp_digits(phones.normalize_phone(raw))
    except phones.InvalidPhone:
        return "".join(c for c in raw if c.isdigit())


def example_screenshot() -> bytes:
    """A stand-in transfer screenshot for Meta's review of the photo template."""
    image = Image.new("RGB", (540, 960), (246, 244, 250))
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 540, 180), fill=(84, 38, 140))
    for top in range(260, 820, 90):
        draw.rounded_rectangle((40, top, 500, top + 50), radius=12, fill=(226, 222, 236))
    buffer = BytesIO()
    image.save(buffer, "JPEG", quality=85)
    return buffer.getvalue()
