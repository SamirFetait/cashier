from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from apps.accounts.permissions import IsSuperAdmin
from apps.common.deletion import AuditedDestroyMixin

from .models import Customer
from .serializers import CustomerSerializer


class CustomerViewSet(AuditedDestroyMixin, viewsets.ModelViewSet):
    """Cashiers and admins both add and edit customers (part of the POS flow);
    only super admins delete them."""

    queryset = Customer.objects.all()
    serializer_class = CustomerSerializer
    permission_classes = [IsAuthenticated]
    search_fields = ["name", "phone_number"]
    ordering_fields = ["name", "created_at"]

    def get_permissions(self):
        if self.action == "destroy":
            return [IsSuperAdmin()]
        return super().get_permissions()
