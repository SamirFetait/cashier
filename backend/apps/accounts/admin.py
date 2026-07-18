from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import User

admin.site.register(
    User,
    type(
        "CustomUserAdmin",
        (UserAdmin,),
        {
            "fieldsets": UserAdmin.fieldsets
            + (("Cashier", {"fields": ("role", "phone_number")}),),
            "list_display": ("username", "email", "role", "is_active", "is_staff"),
            "list_filter": UserAdmin.list_filter + ("role",),
        },
    ),
)
