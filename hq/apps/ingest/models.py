from django.db import models


class DailyReport(models.Model):
    """A daily report received from a branch (one row per branch per date)."""

    branch = models.ForeignKey(
        "branches.Branch", on_delete=models.CASCADE, related_name="reports"
    )
    date = models.DateField()
    sales_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    order_count = models.IntegerField(default=0)
    payload = models.JSONField()
    received_at = models.DateTimeField(auto_now=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("branch", "date")
        ordering = ["-date", "branch__code"]

    def __str__(self) -> str:
        return f"{self.branch.code} {self.date}: {self.sales_total}"
