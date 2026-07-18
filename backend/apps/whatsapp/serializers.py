from rest_framework import serializers

from .models import WhatsAppMessage


class WhatsAppMessageSerializer(serializers.ModelSerializer):
    sent_by_username = serializers.CharField(source="sent_by.username", read_only=True)

    class Meta:
        model = WhatsAppMessage
        fields = [
            "id", "to_number", "body", "supplier", "customer", "status",
            "error", "sent_by", "sent_by_username", "created_at",
        ]
        read_only_fields = fields
