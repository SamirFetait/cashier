from django.contrib import admin

from .models import Supplier


@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display = ("name", "phone_number", "address", "created_at")
    search_fields = ("name", "phone_number")
