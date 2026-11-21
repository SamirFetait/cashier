from rest_framework import serializers

from apps.whatsapp.client import normalize_number

from .models import Supplier


class SupplierSerializer(serializers.ModelSerializer):
    # The number as wa.me wants it (digits, country code first), for the
    # app's button that opens the supplier's chat in WhatsApp.
    whatsapp = serializers.SerializerMethodField()

    class Meta:
        model = Supplier
        fields = [
            "id", "name", "phone_number", "whatsapp", "address", "notes", "created_at",
        ]
        read_only_fields = ["created_at"]

    def get_whatsapp(self, supplier: Supplier) -> str:
        return normalize_number(supplier.phone_number)
