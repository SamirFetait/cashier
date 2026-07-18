from django.db import models


class Customer(models.Model):
    name = models.CharField(max_length=200)
    phone_number = models.CharField(max_length=32, db_index=True)
    address = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name} ({self.phone_number})"
