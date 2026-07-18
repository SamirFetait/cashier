import secrets

from django.db import models


def generate_api_key() -> str:
    return secrets.token_urlsafe(32)


class Branch(models.Model):
    """A POS installation that reports to this HQ."""

    code = models.CharField(max_length=32, unique=True)
    name = models.CharField(max_length=200)
    api_key = models.CharField(max_length=64, default=generate_api_key, db_index=True)
    is_active = models.BooleanField(default=True)
    last_report_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["code"]
        verbose_name_plural = "branches"

    def __str__(self) -> str:
        return f"{self.code} — {self.name}"
