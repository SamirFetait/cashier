from django.contrib.auth import get_user_model
from rest_framework import viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from apps.common.deletion import AuditedDestroyMixin

from .permissions import IsSuperAdmin
from .serializers import CashierTokenObtainPairSerializer, UserSerializer

User = get_user_model()


class LoginView(TokenObtainPairView):
    serializer_class = CashierTokenObtainPairSerializer


class RefreshView(TokenRefreshView):
    pass


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(UserSerializer(request.user).data)


class UserViewSet(AuditedDestroyMixin, viewsets.ModelViewSet):
    queryset = User.objects.all().order_by("username")
    serializer_class = UserSerializer
    permission_classes = [IsSuperAdmin]
    search_fields = ["username", "first_name", "last_name", "email"]
    filterset_fields = ["role", "is_active"]

    def check_destroy(self, user):
        # Deleting the account you are signed in with would lock you out
        # mid-session (and, for the only super admin, lock everyone out).
        if user.pk == self.request.user.pk:
            raise ValidationError({"detail": "You cannot delete your own account."})
