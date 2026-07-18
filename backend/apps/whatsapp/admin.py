from django.contrib import admin

from .models import WhatsAppMessage


@admin.register(WhatsAppMessage)
class WhatsAppMessageAdmin(admin.ModelAdmin):
    list_display = ("to_number", "supplier", "status", "sent_by", "created_at")
    list_filter = ("status",)
    search_fields = ("to_number", "body")
