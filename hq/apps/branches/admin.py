from django.contrib import admin

from .models import Branch


@admin.register(Branch)
class BranchAdmin(admin.ModelAdmin):
    list_display = ("code", "name", "is_active", "last_report_at", "api_key")
    search_fields = ("code", "name")
    readonly_fields = ("last_report_at", "created_at")
