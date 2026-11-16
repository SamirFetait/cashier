from django.core.management.base import BaseCommand

from apps.webshop import services


class Command(BaseCommand):
    help = (
        "Expire web orders whose deposit hold has run out. The API does this by "
        "itself whenever the website or the orders admin is used; schedule this "
        "only if stock must be released on time even when nobody is looking."
    )

    def handle(self, *args, **options):
        count = services.expire_stale(force=True)
        self.stdout.write(f"Expired {count} web order(s).")
