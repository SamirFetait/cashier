from django.db import models


class DailyReport(models.Model):
    """One end-of-day report per calendar date, pushed to the central HQ."""

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        SENT = "SENT", "Sent"
        FAILED = "FAILED", "Failed"

    date = models.DateField(unique=True)
    payload = models.JSONField()
    sales_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    order_count = models.IntegerField(default=0)
    status = models.CharField(
        max_length=10, choices=Status.choices, default=Status.PENDING
    )
    attempts = models.IntegerField(default=0)
    last_error = models.TextField(blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date"]

    def __str__(self) -> str:
        return f"Report {self.date} [{self.status}]"
