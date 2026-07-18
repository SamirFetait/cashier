from rest_framework import serializers

from .models import Supplier


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = [
            "id", "name", "phone_number", "address", "notes", "created_at",
        ]
        read_only_fields = ["created_at"]
