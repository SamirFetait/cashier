from django.db.models import Count, Sum
from rest_framework import serializers

from .models import Customer


class CustomerSerializer(serializers.ModelSerializer):
    order_count = serializers.SerializerMethodField()
    total_spent = serializers.SerializerMethodField()

    class Meta:
        model = Customer
        fields = [
            "id", "name", "phone_number", "address", "notes",
            "order_count", "total_spent", "created_at",
        ]
        read_only_fields = ["created_at"]

    def get_order_count(self, obj) -> int:
        return obj.orders.filter(status="COMPLETED").count()

    def get_total_spent(self, obj):
        agg = obj.orders.filter(status="COMPLETED").aggregate(t=Sum("total"))
        return agg["t"] or 0
