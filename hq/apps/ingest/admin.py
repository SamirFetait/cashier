from django.contrib import admin

from .models import DailyReport


@admin.register(DailyReport)
class DailyReportAdmin(admin.ModelAdmin):
    list_display = ("branch", "date", "sales_total", "order_count", "received_at")
    list_filter = ("branch", "date")
    readonly_fields = ("payload", "received_at", "created_at")
