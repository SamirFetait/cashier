from django.contrib import admin

from .models import AuditLog, Sequence


@admin.register(Sequence)
class SequenceAdmin(admin.ModelAdmin):
    list_display = ("key", "prefix", "last_value", "padding")
    readonly_fields = ("last_value",)


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "actor", "action", "summary")
    list_filter = ("action", "created_at")
    search_fields = ("summary", "object_id", "actor__username")
    date_hierarchy = "created_at"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
