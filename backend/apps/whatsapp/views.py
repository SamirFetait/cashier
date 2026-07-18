from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.suppliers.models import Supplier

from .client import WhatsAppError, get_status, send_message
from .models import WhatsAppMessage
from .serializers import WhatsAppMessageSerializer


class WhatsAppStatusView(APIView):
    """Return sidecar connection state (and the QR to scan when not paired)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            return Response(get_status())
        except WhatsAppError as exc:
            return Response(
                {"connected": False, "error": str(exc)},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )


class SupplierWhatsAppView(APIView):
    """Send a WhatsApp message to a supplier and log it."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        supplier = get_object_or_404(Supplier, pk=pk)
        message = (request.data.get("message") or "").strip()
        if not message:
            return Response(
                {"detail": "message is required"}, status=status.HTTP_400_BAD_REQUEST
            )

        log = WhatsAppMessage.objects.create(
            to_number=supplier.phone_number,
            body=message,
            supplier=supplier,
            sent_by=request.user,
            status=WhatsAppMessage.Status.QUEUED,
        )
        try:
            result = send_message(supplier.phone_number, message)
            log.status = WhatsAppMessage.Status.SENT
            log.save(update_fields=["status"])
            return Response(
                {"message": WhatsAppMessageSerializer(log).data, "result": result}
            )
        except WhatsAppError as exc:
            log.status = WhatsAppMessage.Status.FAILED
            log.error = str(exc)
            log.save(update_fields=["status", "error"])
            return Response(
                {"message": WhatsAppMessageSerializer(log).data, "detail": str(exc)},
                status=status.HTTP_502_BAD_GATEWAY,
            )
