from datetime import date

from django.core.management.base import BaseCommand

from apps.hqsync.services import run_daily_sync


class Command(BaseCommand):
    help = "Build today's end-of-day report and push pending reports to HQ."

    def add_arguments(self, parser):
        parser.add_argument(
            "--date",
            help="Report date as YYYY-MM-DD (defaults to today, local time).",
        )

    def handle(self, *args, **options):
        report_date = date.fromisoformat(options["date"]) if options.get("date") else None
        result = run_daily_sync(report_date)
        self.stdout.write(
            self.style.SUCCESS(
                f"Daily sync for {result['date']}: sent={result['sent']} failed={result['failed']}"
            )
        )
