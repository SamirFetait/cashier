from rest_framework.permissions import SAFE_METHODS, BasePermission


def _is_superadmin(user) -> bool:
    return bool(user and user.is_authenticated and user.is_superadmin)


class IsSuperAdmin(BasePermission):
    """Only super admins may access. Used for users, storages, stock movements."""

    def has_permission(self, request, view):
        return _is_superadmin(request.user)


class IsSuperAdminOrReadOnly(BasePermission):
    """Everyone authenticated may read; only super admins may write.

    Used for the product catalog, suppliers and storage views — cashiers see
    them but cannot modify.
    """

    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return bool(request.user and request.user.is_authenticated)
        return _is_superadmin(request.user)
