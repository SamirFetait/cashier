from django.contrib import admin

from .models import (
    GoodsReceipt,
    GoodsReceiptItem,
    PurchaseOrder,
    PurchaseOrderItem,
    StockTake,
    StockTakeLine,
)


class PurchaseOrderItemInline(admin.TabularInline):
    model = PurchaseOrderItem
    extra = 0
    readonly_fields = ("quantity_received",)


@admin.register(PurchaseOrder)
class PurchaseOrderAdmin(admin.ModelAdmin):
    list_display = ("number", "supplier", "storage", "status", "total_cost", "created_at")
    list_filter = ("status", "supplier")
    search_fields = ("number", "supplier__name")
    readonly_fields = ("number", "total_cost")
    inlines = [PurchaseOrderItemInline]


class GoodsReceiptItemInline(admin.TabularInline):
    model = GoodsReceiptItem
    extra = 0
    readonly_fields = ("purchase_order_item", "product", "quantity", "unit_cost")
    can_delete = False


@admin.register(GoodsReceipt)
class GoodsReceiptAdmin(admin.ModelAdmin):
    list_display = ("number", "purchase_order", "supplier_reference", "received_by", "created_at")
    search_fields = ("number", "supplier_reference")
    readonly_fields = ("number",)
    inlines = [GoodsReceiptItemInline]


class StockTakeLineInline(admin.TabularInline):
    model = StockTakeLine
    extra = 0
    readonly_fields = ("product", "expected_quantity")


@admin.register(StockTake)
class StockTakeAdmin(admin.ModelAdmin):
    list_display = ("number", "storage", "status", "created_by", "applied_at")
    list_filter = ("status", "storage")
    readonly_fields = ("number", "applied_by", "applied_at")
    inlines = [StockTakeLineInline]
