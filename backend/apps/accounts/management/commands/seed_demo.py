from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.customers.models import Customer
from apps.inventory.models import StockItem, Storage, apply_stock_change
from apps.orders.models import Order, OrderItem
from apps.products.models import Category, Product
from apps.suppliers.models import Supplier

User = get_user_model()


class Command(BaseCommand):
    help = "Create demo users, catalog, stock and a few back-dated orders."

    @transaction.atomic
    def handle(self, *args, **options):
        admin, created = User.objects.get_or_create(
            username="admin",
            defaults={"role": User.Role.SUPERADMIN, "is_staff": True, "is_superuser": True},
        )
        if created:
            admin.set_password("admin12345")
            admin.save()
            self.stdout.write(self.style.SUCCESS("Created superadmin: admin / admin12345"))

        cashier, created = User.objects.get_or_create(
            username="cashier", defaults={"role": User.Role.CASHIER}
        )
        if created:
            cashier.set_password("cashier12345")
            cashier.save()
            self.stdout.write(self.style.SUCCESS("Created cashier: cashier / cashier12345"))

        storage, _ = Storage.objects.get_or_create(
            name="Main Store", defaults={"is_default": True, "address": "Front counter"}
        )

        catalog = {
            "Beverages": [("Cola 330ml", "5.00", 100), ("Water 600ml", "3.00", 200)],
            "Snacks": [("Chips", "10.00", 60), ("Chocolate Bar", "12.50", 40)],
            "Grocery": [("Rice 1kg", "25.00", 30), ("Sugar 1kg", "22.00", 8)],
        }
        products = []
        for cat_name, items in catalog.items():
            category, _ = Category.objects.get_or_create(name=cat_name)
            for name, price, qty in items:
                product, _ = Product.objects.get_or_create(
                    name=name,
                    defaults={"category": category, "price": Decimal(price), "cost": Decimal(price) * Decimal("0.6")},
                )
                stock, _ = StockItem.objects.get_or_create(
                    product=product, storage=storage,
                    defaults={"quantity": 0, "reorder_level": 10},
                )
                if stock.quantity == 0:
                    apply_stock_change(
                        product=product, storage=storage, change=qty,
                        reason="PURCHASE", reference="seed", user=admin,
                    )
                products.append(product)

        customer, _ = Customer.objects.get_or_create(
            phone_number="01000000001",
            defaults={"name": "Walk-in Regular", "address": "Nearby"},
        )
        Supplier.objects.get_or_create(
            name="Acme Distribution",
            defaults={"phone_number": "01122223333", "address": "Industrial Zone"},
        )

        if not Order.objects.exists():
            now = timezone.now()
            for i in range(8):
                created_at = now - timedelta(days=i * 11)
                product = products[i % len(products)]
                qty = (i % 3) + 1
                order = Order.objects.create(
                    customer=customer if i % 2 == 0 else None,
                    storage=storage, created_by=cashier,
                    payment_method="CASH",
                )
                line_total = product.price * qty
                OrderItem.objects.create(
                    order=order, product=product, quantity=qty,
                    unit_price=product.price, line_total=line_total,
                )
                apply_stock_change(
                    product=product, storage=storage, change=-qty,
                    reason="SALE", reference=f"order:{order.pk}", user=cashier,
                )
                order.subtotal = line_total
                order.total = line_total
                order.save(update_fields=["subtotal", "total"])
                # Back-date so the monthly dashboard chart has spread.
                Order.objects.filter(pk=order.pk).update(created_at=created_at)
            self.stdout.write(self.style.SUCCESS("Created 8 demo orders."))

        self.stdout.write(self.style.SUCCESS("Seed complete."))
