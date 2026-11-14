from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from apps.customers.models import Customer
from apps.inventory.models import Storage, apply_stock_change
from apps.products.models import Category, Product
from apps.shifts.models import Shift
from apps.suppliers.models import Supplier

from .models import AuditLog

User = get_user_model()


class DeletionTests(APITestCase):
    """Super admins can delete every kind of record the app lists, nobody else
    can, and whatever the books still refer to is refused with a 409."""

    def setUp(self):
        self.admin = User.objects.create_user(
            username="admin", password="pass12345", role=User.Role.SUPERADMIN
        )
        self.cashier = User.objects.create_user(
            username="cash", password="pass12345", role=User.Role.CASHIER
        )

    def delete(self, user, url):
        self.client.force_authenticate(user=user)
        return self.client.delete(url)

    def unused_records(self, user):
        return {
            "/api/products/{}/": Product.objects.create(name="Old", price=Decimal("1.00")),
            "/api/categories/{}/": Category.objects.create(name="Unused"),
            "/api/customers/{}/": Customer.objects.create(name="Ahmed", phone_number="01000000000"),
            "/api/suppliers/{}/": Supplier.objects.create(name="Acme", phone_number="01100000000"),
            "/api/users/{}/": user,
        }

    def test_super_admin_deletes_each_kind_and_it_is_audited(self):
        for url, obj in self.unused_records(self.cashier).items():
            with self.subTest(url=url):
                resp = self.delete(self.admin, url.format(obj.pk))
                self.assertEqual(resp.status_code, 204)
                self.assertFalse(type(obj).objects.filter(pk=obj.pk).exists())
                entry = AuditLog.objects.get(
                    action=AuditLog.Action.DELETE,
                    object_type=type(obj).__name__,
                    object_id=str(obj.pk),
                )
                self.assertEqual(entry.actor, self.admin)

    def test_cashier_cannot_delete_any_kind(self):
        other = User.objects.create_user(
            username="other", password="pass12345", role=User.Role.CASHIER
        )
        for url, obj in self.unused_records(other).items():
            with self.subTest(url=url):
                resp = self.delete(self.cashier, url.format(obj.pk))
                self.assertEqual(resp.status_code, 403)
                self.assertTrue(type(obj).objects.filter(pk=obj.pk).exists())
        self.assertFalse(AuditLog.objects.filter(action=AuditLog.Action.DELETE).exists())

    def test_cashier_still_adds_and_edits_customers(self):
        self.client.force_authenticate(user=self.cashier)
        resp = self.client.post("/api/customers/", {"name": "Mona", "phone_number": "01200000000"})
        self.assertEqual(resp.status_code, 201, resp.data)
        resp = self.client.patch(f"/api/customers/{resp.data['id']}/", {"notes": "Regular"})
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_records_the_books_still_use_are_refused_with_409(self):
        storage = Storage.objects.create(name="Main", is_default=True)
        category = Category.objects.create(name="Drinks")
        product = Product.objects.create(name="Cola", price=Decimal("5.00"), category=category)
        apply_stock_change(
            product=product, storage=storage, change=10, reason="PURCHASE", user=self.admin
        )
        Shift.objects.create(number="SH-TEST-1", opened_by=self.cashier)

        cases = [
            (f"/api/products/{product.pk}/", Product, product.pk, "stock movements"),
            (f"/api/categories/{category.pk}/", Category, category.pk, "products"),
            (f"/api/users/{self.cashier.pk}/", User, self.cashier.pk, "shifts"),
        ]
        for url, model, pk, used_by in cases:
            with self.subTest(url=url):
                resp = self.delete(self.admin, url)
                self.assertEqual(resp.status_code, 409)
                self.assertEqual(resp.data["code"], "protected")
                self.assertIn(used_by, resp.data["detail"])
                self.assertTrue(model.objects.filter(pk=pk).exists())
        # A refused deletion leaves no audit entry behind.
        self.assertFalse(AuditLog.objects.filter(action=AuditLog.Action.DELETE).exists())

    def test_nobody_can_delete_their_own_account(self):
        resp = self.delete(self.admin, f"/api/users/{self.admin.pk}/")
        self.assertEqual(resp.status_code, 400)
        self.assertTrue(User.objects.filter(pk=self.admin.pk).exists())
