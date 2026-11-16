"""Hand-over: the web order is rung up through the real checkout."""
from decimal import Decimal

from apps.common.models import AuditLog
from apps.customers.models import Customer
from apps.inventory.models import StockItem
from apps.orders.models import Order
from apps.products.models import Product
from apps.shifts.models import CashMovement
from apps.shifts.services import open_shift
from apps.webshop.models import WebOrder

from .base import SHOP, ShopTestCase

D = Decimal


class CompletionTests(ShopTestCase):
    def setUp(self):
        super().setUp()
        self.shift = open_shift(user=self.cashier_user, opening_float=D("100"))

    def complete(self, client, pk, **body):
        return self.act(client, pk, "complete", body)

    def test_the_sale_is_rung_up_with_the_deposit_and_the_balance_as_two_tenders(self):
        public, order, client = self.confirmed_order(
            items=[{"id": self.honey.pk, "qty": 2}, {"id": self.olives.pk, "qty": "0.5"}]
        )   # goods 522.50, deposit 262
        response = self.complete(client, order["id"], balance_method="CASH")
        self.assertEqual(response.status_code, 200, response.content)
        done = response.json()["order"]
        self.assertEqual(done["status"], "COMPLETED")
        self.assertEqual(done["pos"]["total"], "522.50")
        self.assertEqual(done["pos"]["completed_by"], "samir")

        sale = Order.objects.get(pk=done["pos"]["order_id"])
        self.assertEqual(done["pos"]["receipt_number"], sale.receipt_number)
        self.assertEqual(sale.note, f"Web order {public['code']}")
        self.assertEqual(str(sale.client_uuid), str(WebOrder.objects.get(pk=order["id"]).public_id))
        self.assertEqual(sale.shift, self.shift)
        self.assertEqual(sale.created_by, self.admin_user)
        self.assertEqual(
            [(p.method, p.amount) for p in sale.payments.order_by("id")],
            [("MOBILE", D("262.00")), ("CASH", D("260.50"))],
        )
        # Stock left through the ledger, and the cash went into the drawer.
        self.assertEqual(StockItem.objects.get(product=self.honey).quantity, D("8.000"))
        self.assertEqual(StockItem.objects.get(product=self.olives).quantity, D("9.000"))
        self.assertEqual(CashMovement.objects.get(order=sale).amount, D("260.50"))
        # The customer now exists in the cashier and is on the sale.
        self.assertEqual(sale.customer.phone_number, "01012345678")

        tracked = self.track(public)
        self.assertEqual((tracked["status"], tracked["receipt_number"]), ("COMPLETED", sale.receipt_number))
        self.assertEqual(tracked["final_total"], "522.50")
        self.assertEqual(client.get(f"{SHOP}/admin/board/").json()["summary"]["sales_today"], "522.50")

    def test_a_known_customer_is_reused(self):
        existing = Customer.objects.create(name="Mona", phone_number="+201012345678")
        _, order, client = self.confirmed_order()
        done = self.complete(client, order["id"], balance_method="CARD").json()["order"]
        self.assertEqual(Order.objects.get(pk=done["pos"]["order_id"]).customer, existing)

    def test_the_balance_method_is_required_when_something_is_owed(self):
        _, order, client = self.confirmed_order()
        response = self.complete(client, order["id"])
        self.assertEqual((response.status_code, response.json()["code"]), (400, "BALANCE_METHOD_REQUIRED"))
        self.assertEqual(Order.objects.count(), 0)

    def test_a_fully_prepaid_order_has_one_tender_and_needs_no_drawer(self):
        self.shift.status = "CLOSED"
        self.shift.save()
        self.shop_settings(deposit_percent=100)
        _, order, client = self.confirmed_order()
        done = self.complete(client, order["id"]).json()["order"]
        sale = Order.objects.get(pk=done["pos"]["order_id"])
        self.assertEqual([(p.method, p.amount) for p in sale.payments.all()], [("MOBILE", D("500.00"))])
        self.assertIsNone(sale.shift)

    def test_cash_without_an_open_shift_is_refused_and_nothing_is_kept(self):
        self.shift.status = "CLOSED"
        self.shift.save()
        _, order, client = self.confirmed_order()
        response = self.complete(client, order["id"], balance_method="CASH")
        body = response.json()
        self.assertEqual((response.status_code, body["code"]), (409, "POS_REJECTED"))
        self.assertIn("No shift is open", body["detail"])
        self.assertEqual(WebOrder.objects.get(pk=order["id"]).status, "CONFIRMED")
        self.assertEqual((Order.objects.count(), Customer.objects.count()), (0, 0))
        self.assertEqual(StockItem.objects.get(product=self.honey).quantity, D("10.000"))

    def test_the_delivery_fee_stays_outside_the_sale(self):
        self.shop_settings(delivery_fee=D("40.00"))
        public, order, client = self.confirmed_order(fulfilment="DELIVERY", address="12 Nile St, Maadi")
        plan = client.get(f"{SHOP}/admin/orders/{order['id']}/sale-plan/").json()
        self.assertEqual(
            (plan["total"], plan["deposit_applied"], plan["balance"], plan["delivery_fee_due"], plan["to_collect"]),
            ("500.00", "250.00", "250.00", "40.00", "290.00"),
        )
        done = self.complete(client, order["id"], balance_method="CASH").json()["order"]
        self.assertEqual(Order.objects.get(pk=done["pos"]["order_id"]).total, D("500.00"))
        self.assertEqual(self.track(public)["final_total"], "540.00")

    def test_completing_twice_does_not_sell_twice(self):
        _, order, client = self.confirmed_order()
        self.complete(client, order["id"], balance_method="CASH")
        again = self.complete(client, order["id"], balance_method="CASH")
        self.assertEqual((again.status_code, again.json()["code"]), (409, "INVALID_STATE"))
        self.assertEqual(Order.objects.count(), 1)

    def test_stock_sold_at_the_till_meanwhile_blocks_the_sale(self):
        from apps.inventory.models import apply_stock_change

        _, order, client = self.confirmed_order(items=[{"id": self.dates.pk, "qty": 4}])
        apply_stock_change(product=self.dates, storage=self.storage, change=D("-3"), reason="SALE")
        response = self.complete(client, order["id"], balance_method="CASH")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "POS_REJECTED"))
        self.assertIn("Not enough stock", response.json()["detail"])
        self.assertEqual(WebOrder.objects.get(pk=order["id"]).status, "CONFIRMED")


class PriceChangeTests(ShopTestCase):
    """Checkout sells at the current price; staff decide when it moved."""

    def setUp(self):
        super().setUp()
        open_shift(user=self.cashier_user)
        _, self.order, self.admin = self.confirmed_order(
            items=[{"id": self.honey.pk, "qty": 2}, {"id": self.dates.pk, "qty": 1}]
        )   # quoted 500 + 180 = 680, deposit 340
        Product.objects.filter(pk=self.honey.pk).update(price=D("275.00"))   # up
        Product.objects.filter(pk=self.dates.pk).update(price=D("170.00"))   # down

    def complete(self, client=None, **body):
        return self.act(client or self.admin, self.order["id"], "complete", {"balance_method": "CASH", **body})

    def sale(self, done) -> Order:
        return Order.objects.get(pk=done["pos"]["order_id"])

    def test_staff_are_asked_before_anything_is_sold(self):
        response = self.complete()
        body = response.json()
        self.assertEqual((response.status_code, body["code"]), (409, "PRICE_CHANGED"))
        self.assertEqual((body["quoted_total"], body["current_total"], body["honoured_total"]), ("680.00", "720.00", "670.00"))
        self.assertEqual(Order.objects.count(), 0)

    def test_keeping_the_customers_price_discounts_the_rise(self):
        sale = self.sale(self.complete(price_mode="quoted").json()["order"])
        self.assertEqual(sale.total, D("670.00"))
        lines = {i.product_id: i for i in sale.items.all()}
        self.assertEqual((lines[self.honey.pk].discount, lines[self.dates.pk].discount), (D("50.00"), D("0.00")))
        # The discount is in the audit log, like any till discount.
        self.assertTrue(AuditLog.objects.filter(action="DISCOUNT", object_id=str(sale.pk)).exists())

    def test_charging_todays_prices(self):
        sale = self.sale(self.complete(price_mode="current").json()["order"])
        self.assertEqual(sale.total, D("720.00"))
        self.assertEqual([p.amount for p in sale.payments.order_by("id")], [D("340.00"), D("380.00")])

    def test_a_cashier_needs_the_manager_pin_for_a_large_discount(self):
        Product.objects.filter(pk=self.honey.pk).update(price=D("400.00"))   # 300 off: above the limit
        cashier = self.staff_client("cashier")
        asked = self.complete(cashier, price_mode="quoted")
        self.assertEqual((asked.status_code, asked.json()["code"]), (409, "PIN_REQUIRED"))
        wrong = self.complete(cashier, price_mode="quoted", override_pin="0000")
        self.assertEqual(wrong.json()["code"], "PIN_INVALID")
        right = self.complete(cashier, price_mode="quoted", override_pin="4321")
        self.assertEqual(right.status_code, 200, right.content)
        entry = AuditLog.objects.get(action="DISCOUNT")
        self.assertEqual((entry.actor.username, entry.authorised_by.username), ("cashier", "samir"))

    def test_a_product_taken_off_sale_blocks_completion(self):
        Product.objects.filter(pk=self.dates.pk).update(is_active=False)
        response = self.complete(price_mode="current")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "PRODUCT_MISSING"))


class OverpaymentTests(ShopTestCase):
    def test_a_deposit_larger_than_the_sale_is_owed_back(self):
        _, order, client = self.confirmed_order()   # 500, deposit 250
        Product.objects.filter(pk=self.honey.pk).update(price=D("100.00"))
        done = self.act(client, order["id"], "complete", {"price_mode": "current"}).json()["order"]
        self.assertEqual(done["status"], "COMPLETED")
        sale = Order.objects.get(pk=done["pos"]["order_id"])
        self.assertEqual([(p.method, p.amount) for p in sale.payments.all()], [("MOBILE", D("200.00"))])
        self.assertEqual((done["refund"]["status"], done["refund"]["amount"]), ("DUE", "50.00"))
