from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.common.models import Sequence
from apps.customers.models import Customer
from apps.inventory.models import StockItem, Storage, apply_stock_change
from apps.orders.models import Order, OrderItem, Payment
from apps.products.models import Category, Product
from apps.shifts.models import Shift
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
            admin.set_override_pin("4321")
            admin.save()
            self.stdout.write(self.style.SUCCESS("Created superadmin: admin / admin12345"))
            self.stdout.write(self.style.SUCCESS("Manager override PIN: 4321"))

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

        # (name, price, stock, barcode, unit, sold_by) — barcodes let the
        # scanner be demoed; the deli items exercise weighed goods.
        catalog = {
            "Beverages": [
                ("Cola 330ml", "5.00", 100, "5000112637922", "pcs", Product.SoldBy.UNIT),
                ("Water 600ml", "3.00", 200, "5000112637939", "pcs", Product.SoldBy.UNIT),
            ],
            "Snacks": [
                ("Chips", "10.00", 60, "5900259127204", "pcs", Product.SoldBy.UNIT),
                ("Chocolate Bar", "12.50", 40, "7622210951965", "pcs", Product.SoldBy.UNIT),
            ],
            "Grocery": [
                ("Rice 1kg", "25.00", 30, "8901030865278", "pcs", Product.SoldBy.UNIT),
                ("Sugar 1kg", "22.00", 8, "8901030865285", "pcs", Product.SoldBy.UNIT),
            ],
            "Deli": [
                ("Cheddar Cheese", "80.00", 15, "2000000000015", "kg", Product.SoldBy.WEIGHT),
                ("Olives", "45.00", 10, "2000000000022", "kg", Product.SoldBy.WEIGHT),
            ],
        }
        products = []
        for cat_name, items in catalog.items():
            category, _ = Category.objects.get_or_create(name=cat_name)
            for name, price, qty, barcode, unit, sold_by in items:
                product, _ = Product.objects.get_or_create(
                    name=name,
                    defaults={
                        "category": category,
                        "price": Decimal(price),
                        "cost": Decimal(price) * Decimal("0.6"),
                        "barcode": barcode,
                        "unit": unit,
                        "sold_by": sold_by,
                    },
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
            # Historic sales belong to a closed shift so the demo data looks
            # like a real trading history rather than orphaned orders.
            history_shift = Shift.objects.create(
                number=Sequence.next_value("shift", prefix="S", padding=5),
                terminal="Till 1",
                opened_by=cashier,
                opening_float=Decimal("100.00"),
                status=Shift.Status.CLOSED,
                closed_by=admin,
                closed_at=now,
            )
            for i in range(8):
                created_at = now - timedelta(days=i * 11)
                product = products[i % len(products)]
                qty = Decimal("0.500") if product.is_weighed else Decimal((i % 3) + 1)
                order = Order.objects.create(
                    receipt_number=Sequence.next_value("receipt", prefix="R"),
                    customer=customer if i % 2 == 0 else None,
                    storage=storage, created_by=cashier,
                    shift=history_shift,
                    payment_method="CASH" if i % 3 else "CARD",
                )
                line_total = (product.price * qty).quantize(Decimal("0.01"))
                OrderItem.objects.create(
                    order=order, product=product, quantity=qty,
                    unit_price=product.price, unit_cost=product.cost,
                    line_total=line_total,
                )
                Payment.objects.create(
                    order=order,
                    method=order.payment_method,
                    amount=line_total,
                    tendered=line_total if order.payment_method == "CASH" else Decimal("0"),
                )
                apply_stock_change(
                    product=product, storage=storage, change=-qty,
                    reason="SALE", reference=order.receipt_number, user=cashier,
                )
                order.subtotal = line_total
                order.total = line_total
                order.save(update_fields=["subtotal", "total"])
                # Back-date so the monthly dashboard chart has spread.
                Order.objects.filter(pk=order.pk).update(created_at=created_at)
            self.stdout.write(self.style.SUCCESS("Created 8 demo orders."))

        self.stdout.write(self.style.SUCCESS("Seed complete."))
