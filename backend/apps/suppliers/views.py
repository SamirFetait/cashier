from rest_framework import viewsets

from apps.accounts.permissions import IsSuperAdminOrReadOnly
from apps.common.deletion import AuditedDestroyMixin

from .models import Supplier
from .serializers import SupplierSerializer


class SupplierViewSet(AuditedDestroyMixin, viewsets.ModelViewSet):
    queryset = Supplier.objects.all()
    serializer_class = SupplierSerializer
    permission_classes = [IsSuperAdminOrReadOnly]
    search_fields = ["name", "phone_number"]
