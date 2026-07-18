"""Till sessions and the cash drawer.

A shift is the unit of cash accountability: one cashier, one drawer, from
opening float to blind close. Every movement of physical cash is recorded so
the drawer can be reconciled and a variance attributed to a named person.
"""
from decimal import Decimal

from django.conf import settings
from django.db import models

from apps.common.fields import money_field

ZERO = Decimal("0.00")


class Shift(models.Model):
    class Status(models.TextChoices):
        OPEN = "OPEN", "Open"
        CLOSED = "CLOSED", "Closed"

    number = models.CharField(max_length=32, unique=True, db_index=True)
    terminal = models.CharField(
        max_length=64, blank=True, help_text="Which till/terminal this drawer belongs to"
    )
    opened_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="shifts_opened"
    )
    closed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="shifts_closed",
    )
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)

    opening_float = money_field(default=ZERO, help_text="Cash placed in the drawer at open")
    opened_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    # Filled in at close. counted is what the cashier physically counted
    # (entered blind — the UI does not reveal `expected` beforehand).
    counted_cash = money_field(null=True, blank=True)
    expected_cash = money_field(null=True, blank=True)
    variance = money_field(null=True, blank=True, help_text="counted - expected")

    note = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-opened_at"]
        indexes = [models.Index(fields=["status", "-opened_at"])]

    def __str__(self) -> str:
        return f"Shift {self.number} ({self.get_status_display()})"

    @property
    def is_open(self) -> bool:
        return self.status == self.Status.OPEN


class CashMovement(models.Model):
    """Every physical cash event on a drawer, including sales and refunds.

    Signed: positive puts money in the drawer, negative takes it out. The sum
    of these plus the opening float is the expected drawer contents.
    """

    class Kind(models.TextChoices):
        OPENING_FLOAT = "OPENING_FLOAT", "Opening float"
        SALE = "SALE", "Cash sale"
        REFUND = "REFUND", "Cash refund"
        PAY_IN = "PAY_IN", "Paid in"
        PAY_OUT = "PAY_OUT", "Paid out (expense)"
        DROP = "DROP", "Cash drop to safe"

    shift = models.ForeignKey(Shift, on_delete=models.PROTECT, related_name="cash_movements")
    kind = models.CharField(max_length=20, choices=Kind.choices)
    amount = money_field(help_text="Positive into the drawer, negative out")
    reason = models.CharField(max_length=255, blank=True)
    order = models.ForeignKey(
        "orders.Order", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="cash_movements",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.get_kind_display()} {self.amount:+}"
