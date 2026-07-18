"""Manager override.

Voids, refunds and large discounts are the classic shrinkage routes in retail,
so a cashier cannot perform them alone: a supervisor keys in their PIN at the
till. The authorising user is recorded on the audit entry, which is the whole
point — the action becomes attributable to two named people.
"""
from django.conf import settings
from rest_framework import serializers

from apps.common.models import record_audit

from .models import User


def _needs_override(user) -> bool:
    return not (user and user.is_authenticated and user.is_superadmin)


def resolve_override(request, *, action: str, detail: str = ""):
    """Return the user who authorised this action.

    None means the actor was already privileged enough and no second person
    was involved. Raises if an override is required but not supplied.
    """
    if not _needs_override(request.user):
        return None

    pin = str(request.data.get("override_pin") or "").strip()
    if not pin:
        raise serializers.ValidationError(
            {"override_pin": "A manager PIN is required to authorise this."}
        )

    for manager in User.objects.filter(
        role=User.Role.SUPERADMIN, is_active=True
    ).exclude(override_pin=""):
        if manager.check_override_pin(pin):
            return manager

    # A wrong PIN is itself worth recording — repeated failures are a signal.
    record_audit(
        action="LOGIN_FAILED",
        actor=request.user if request.user.is_authenticated else None,
        summary=f"Bad manager PIN attempting {action}",
        detail={"action": action, "context": detail},
    )
    raise serializers.ValidationError({"override_pin": "That PIN was not recognised."})


def discount_needs_override(total_discount, subtotal) -> bool:
    """Whether this discount is large enough to need a supervisor.

    Triggered by either an absolute amount or a percentage of the sale, so a
    big discount on a small basket is caught as well as one on a large basket.
    """
    limit = getattr(settings, "DISCOUNT_OVERRIDE_AMOUNT", None)
    pct_limit = getattr(settings, "DISCOUNT_OVERRIDE_PERCENT", None)
    if limit is not None and total_discount > limit:
        return True
    if pct_limit is not None and subtotal > 0:
        pct = (total_discount / subtotal) * 100
        if pct > pct_limit:
            return True
    return False
