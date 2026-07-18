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

    @property
    def is_superadmin(self) -> bool:
        return self.role == self.Role.SUPERADMIN or self.is_superuser

    @property
    def is_cashier(self) -> bool:
        return self.role == self.Role.CASHIER

    def __str__(self) -> str:
        return f"{self.username} ({self.get_role_display()})"
