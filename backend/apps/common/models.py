"""Cross-cutting models: document sequences and the audit log."""
from django.conf import settings
from django.db import models, transaction


class Sequence(models.Model):
    """A named, gapless counter (receipt numbers, PO numbers, stock takes).

    Sequential document numbers are a legal requirement in many jurisdictions,
    so this deliberately does NOT use a database AUTOINCREMENT — those skip
    values on rollback. Callers must be inside a transaction; the row lock
    serialises concurrent terminals.
    """

    key = models.CharField(max_length=64, unique=True)
    prefix = models.CharField(max_length=16, blank=True)
    last_value = models.BigIntegerField(default=0)
    padding = models.PositiveSmallIntegerField(default=6)

    def __str__(self) -> str:
        return f"{self.key} @ {self.last_value}"

    @classmethod
    def next_value(cls, key: str, *, prefix: str = "", padding: int = 6) -> str:
        """Claim the next number for `key`. Must run inside a transaction."""
        seq, created = cls.objects.get_or_create(
            key=key, defaults={"prefix": prefix, "padding": padding}
        )
        if not created:
            seq = cls.objects.select_for_update().get(pk=seq.pk)
        seq.last_value += 1
        seq.save(update_fields=["last_value"])
        return f"{seq.prefix}{str(seq.last_value).zfill(seq.padding)}"


class AuditLog(models.Model):
    """Append-only record of sensitive actions.

    Answers "who discounted this", "who voided that", "who changed the price".
    Never updated or deleted through the application.
    """

    class Action(models.TextChoices):
        CREATE = "CREATE", "Created"
        UPDATE = "UPDATE", "Updated"
        DELETE = "DELETE", "Deleted"
        VOID = "VOID", "Voided"
        REFUND = "REFUND", "Refunded"
        DISCOUNT = "DISCOUNT", "Discount applied"
        PRICE_CHANGE = "PRICE_CHANGE", "Price changed"
        SHIFT_OPEN = "SHIFT_OPEN", "Shift opened"
        SHIFT_CLOSE = "SHIFT_CLOSE", "Shift closed"
        CASH_MOVEMENT = "CASH_MOVEMENT", "Cash in/out"
        STOCK_ADJUST = "STOCK_ADJUST", "Stock adjusted"
        LOGIN_FAILED = "LOGIN_FAILED", "Failed login"
        OVERRIDE = "OVERRIDE", "Manager override"

    action = models.CharField(max_length=20, choices=Action.choices)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="audit_entries",
    )
    # Who authorised it, when an override was required.
    authorised_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="authorised_audit_entries",
    )
    object_type = models.CharField(max_length=64, blank=True)
    object_id = models.CharField(max_length=64, blank=True)
    summary = models.CharField(max_length=255)
    detail = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["object_type", "object_id"]),
            models.Index(fields=["-created_at"]),
        ]

    def __str__(self) -> str:
        who = self.actor.username if self.actor else "system"
        return f"[{self.created_at:%Y-%m-%d %H:%M}] {who} {self.action}: {self.summary}"


def record_audit(
    *, action, actor=None, summary="", obj=None, detail=None, authorised_by=None
) -> AuditLog:
    """Write an audit entry. Safe to call inside the caller's transaction."""
    object_type = ""
    object_id = ""
    if obj is not None:
        object_type = obj.__class__.__name__
        object_id = str(getattr(obj, "pk", "") or "")
    return AuditLog.objects.create(
        action=action,
        actor=actor if getattr(actor, "pk", None) else None,
        authorised_by=authorised_by if getattr(authorised_by, "pk", None) else None,
        object_type=object_type,
        object_id=object_id,
        summary=summary[:255],
        detail=detail or {},
    )
