from django.db import transaction
from django.db.models import ProtectedError
from rest_framework import status
from rest_framework.response import Response

from .models import AuditLog, record_audit


class AuditedDestroyMixin:
    """DELETE for a ModelViewSet that refuses cleanly and leaves a trace.

    Sales, stock movements, purchase orders and shifts point at products,
    categories, suppliers and users through PROTECT foreign keys, so the books
    can never lose what they refer to. Deleting a record that is still
    referenced answers 409 Conflict, naming what refers to it, rather than
    failing with a 500. Every deletion that goes through is in the audit log.
    """

    def check_destroy(self, instance) -> None:
        """Raise a ValidationError here to refuse a deletion outright."""

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        self.check_destroy(instance)
        label = f"{instance._meta.verbose_name} {instance}"
        try:
            with transaction.atomic():
                # Written first, while the object still has its id; rolled
                # back with the deletion if that is refused.
                record_audit(
                    action=AuditLog.Action.DELETE,
                    actor=request.user,
                    summary=f"Deleted {label}"[:255],
                    obj=instance,
                )
                instance.delete()
        except ProtectedError as exc:
            used_by = sorted({str(obj._meta.verbose_name_plural) for obj in exc.protected_objects})
            return Response(
                {
                    "detail": f"Cannot delete {label}: it is still used by {', '.join(used_by)}.",
                    "code": "protected",
                },
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)
