from django.conf import settings
from django.db import models


class WhatsAppMessage(models.Model):
    class Status(models.TextChoices):
        QUEUED = "QUEUED", "Queued"
        SENT = "SENT", "Sent"
        FAILED = "FAILED", "Failed"

    to_number = models.CharField(max_length=32)
    body = models.TextField()
    supplier = models.ForeignKey(
        "suppliers.Supplier", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="messages",
    )
    customer = models.ForeignKey(
        "customers.Customer", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="messages",
    )
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.QUEUED
    )
    error = models.TextField(blank=True)
    sent_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"WA to {self.to_number} [{self.status}]"
