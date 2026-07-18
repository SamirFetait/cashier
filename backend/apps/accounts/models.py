from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    """Store staff account. Role drives API permissions."""

    class Role(models.TextChoices):
        SUPERADMIN = "SUPERADMIN", "Super Admin"
        CASHIER = "CASHIER", "Cashier"

    role = models.CharField(
        max_length=20, choices=Role.choices, default=Role.CASHIER
    )
    phone_number = models.CharField(max_length=32, blank=True)
    # Short numeric code a supervisor keys in at the till to authorise a void,
    # refund or large discount. Stored hashed — never the digits themselves.
    override_pin = models.CharField(max_length=128, blank=True)

    def set_override_pin(self, raw_pin: str) -> None:
        self.override_pin = make_password(raw_pin) if raw_pin else ""

    def check_override_pin(self, raw_pin: str) -> bool:
        if not self.override_pin or not raw_pin:
            return False
        return check_password(raw_pin, self.override_pin)

    @property
    def is_superadmin(self) -> bool:
        return self.role == self.Role.SUPERADMIN or self.is_superuser

    @property
    def is_cashier(self) -> bool:
        return self.role == self.Role.CASHIER

    def __str__(self) -> str:
        return f"{self.username} ({self.get_role_display()})"
