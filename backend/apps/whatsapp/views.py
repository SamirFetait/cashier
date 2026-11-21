import logging

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsSuperAdmin

from . import cloud
from .client import WhatsAppError, get_status, unlink

log = logging.getLogger(__name__)


class WhatsAppStatusView(APIView):
    """How the server sends WhatsApp order alerts: through the Cloud API from
    its number, or through the sidecar (its connection state, and the QR to
    scan while it is not paired)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if cloud.configured():
            try:
                number = cloud.sending_number()
            except cloud.CloudError as exc:
                return Response(
                    {"provider": "cloud", "connected": False, "number": None, "qr": None, "error": str(exc)},
                    status=status.HTTP_503_SERVICE_UNAVAILABLE,
                )
            return Response({"provider": "cloud", "connected": True, "number": number, "qr": None, "error": None})
        try:
            return Response({**get_status(), "provider": "sidecar"})
        except WhatsAppError as exc:
            return Response(
                {"provider": "sidecar", "connected": False, "error": str(exc)},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )


class WhatsAppUnlinkView(APIView):
    """Unlink the WhatsApp account the sidecar sends order alerts from. A new
    QR follows, to link this or another phone."""

    permission_classes = [IsSuperAdmin]

    def post(self, request):
        if cloud.configured():
            return Response(
                {"detail": "Order alerts go through WhatsApp's Cloud API, which has no linked phone to unlink."},
                status=status.HTTP_409_CONFLICT,
            )
        try:
            result = unlink()
        except WhatsAppError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        log.info("WhatsApp unlinked by %s", request.user)
        return Response(result)
