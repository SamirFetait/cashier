from django.contrib import admin

from .models import Listing, ShopSettings, ShopVideo, WebOrder, WebOrderEvent, WebOrderItem


class WebOrderItemInline(admin.TabularInline):
    model = WebOrderItem
    extra = 0
    readonly_fields = ["product", "name", "unit_price", "quantity", "line_total"]
    can_delete = False


class WebOrderEventInline(admin.TabularInline):
    model = WebOrderEvent
    extra = 0
    readonly_fields = ["kind", "actor", "public", "message", "created_at"]
    can_delete = False


@admin.register(WebOrder)
class WebOrderAdmin(admin.ModelAdmin):
    list_display = ["code", "status", "customer_name", "phone", "total", "deposit_paid", "created_at"]
    list_filter = ["status", "fulfilment", "refund_status"]
    search_fields = ["code", "phone", "customer_name", "deposit_reference"]
    readonly_fields = ["public_id", "access_token", "sale", "created_at", "updated_at"]
    inlines = [WebOrderItemInline, WebOrderEventInline]


@admin.register(ShopSettings)
class ShopSettingsAdmin(admin.ModelAdmin):
    pass


@admin.register(Listing)
class ListingAdmin(admin.ModelAdmin):
    list_display = ["product", "hidden", "featured", "badge"]


@admin.register(ShopVideo)
class ShopVideoAdmin(admin.ModelAdmin):
    list_display = ["__str__", "placement", "is_active", "sort", "created_at"]
