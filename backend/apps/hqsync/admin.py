from django.contrib import admin

from .models import DailyReport


@admin.register(DailyReport)
class DailyReportAdmin(admin.ModelAdmin):
    list_display = ("date", "sales_total", "order_count", "status", "attempts", "sent_at")
    list_filter = ("status",)
    readonly_fields = ("payload", "created_at", "updated_at")
