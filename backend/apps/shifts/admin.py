from django.contrib import admin

from .models import CashMovement, Shift


class CashMovementInline(admin.TabularInline):
    model = CashMovement
    extra = 0
    readonly_fields = ("kind", "amount", "reason", "order", "created_by", "created_at")
    can_delete = False


@admin.register(Shift)
class ShiftAdmin(admin.ModelAdmin):
    list_display = (
        "number", "terminal", "status", "opened_by", "opened_at",
        "opening_float", "counted_cash", "expected_cash", "variance",
    )
    list_filter = ("status", "terminal")
    search_fields = ("number", "opened_by__username")
    readonly_fields = ("number", "expected_cash", "variance", "opened_at", "closed_at")
    inlines = [CashMovementInline]


@admin.register(CashMovement)
class CashMovementAdmin(admin.ModelAdmin):
    list_display = ("created_at", "shift", "kind", "amount", "reason", "created_by")
    list_filter = ("kind",)
    search_fields = ("reason", "shift__number")
