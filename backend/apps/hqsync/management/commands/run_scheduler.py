from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger
from django.conf import settings
from django.core.management.base import BaseCommand

from apps.hqsync.services import run_daily_sync


class Command(BaseCommand):
    help = (
        "Run a long-lived scheduler that pushes the daily report to HQ every day "
        "at REPORT_TIME (close of business). Run as a single dedicated process."
    )

    def handle(self, *args, **options):
        try:
            hour, minute = (int(p) for p in settings.REPORT_TIME.split(":"))
        except ValueError:
            self.stderr.write(f"Invalid REPORT_TIME '{settings.REPORT_TIME}', expected HH:MM")
            return

        scheduler = BlockingScheduler(timezone=settings.TIME_ZONE)

        def job():
            result = run_daily_sync()
            self.stdout.write(
                self.style.SUCCESS(
                    f"[scheduler] daily sync {result['date']}: "
                    f"sent={result['sent']} failed={result['failed']}"
                )
            )

        scheduler.add_job(job, CronTrigger(hour=hour, minute=minute), id="daily_report")
        self.stdout.write(
            self.style.SUCCESS(
                f"Scheduler started — daily report at {settings.REPORT_TIME} "
                f"({settings.TIME_ZONE}). Press Ctrl+C to stop."
            )
        )
        try:
            scheduler.start()
        except (KeyboardInterrupt, SystemExit):
            scheduler.shutdown()
