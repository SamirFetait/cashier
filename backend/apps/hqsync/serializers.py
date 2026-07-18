from rest_framework import serializers

from .models import DailyReport


class DailyReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = DailyReport
        fields = [
            "id", "date", "sales_total", "order_count", "status",
            "attempts", "last_error", "sent_at", "payload", "created_at",
        ]
        read_only_fields = fields
