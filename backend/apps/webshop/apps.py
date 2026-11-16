from django.apps import AppConfig


class WebshopConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.webshop"
    label = "webshop"
    verbose_name = "Website orders"
