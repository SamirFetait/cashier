from django.contrib import admin

from .models import StockItem, StockMovement, Storage


@admin.register(Storage)
class StorageAdmin(admin.ModelAdmin):
    list_display = ("name", "address", "is_default")


@admin.register(StockItem)
class StockItemAdmin(admin.ModelAdmin):
    list_display = ("product", "storage", "quantity", "reorder_level")
    list_filter = ("storage",)
    search_fields = ("product__name",)


@admin.register(StockMovement)
class StockMovementAdmin(admin.ModelAdmin):
    list_display = ("product", "storage", "change", "reason", "created_at")
    list_filter = ("reason", "storage")
    search_fields = ("product__name", "reference")
