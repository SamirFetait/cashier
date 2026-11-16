from decimal import Decimal

from django.test import SimpleTestCase

from apps.products.models import Product
from apps.webshop import phones, pricing
from apps.webshop.models import Listing, ShopSettings, WebOrder

from .base import ShopTestCase

D = Decimal


class PhoneTests(SimpleTestCase):
    def test_egyptian_spellings_reduce_to_one(self):
        for raw in ("01012345678", "0101 234 5678", "+20 101 234 5678", "00201012345678",
                    "201012345678", "٠١٠١٢٣٤٥٦٧٨", "(010) 1234-5678"):
            self.assertEqual(phones.normalize_phone(raw), "01012345678", raw)

    def test_international_numbers_are_kept(self):
        self.assertEqual(phones.normalize_phone("+966 50 123 4567"), "+966501234567")

    def test_rubbish_is_refused(self):
        for raw in ("", "12345", "0191234567", "0131234567890", "hello", None):
            with self.assertRaises(phones.InvalidPhone, msg=raw):
                phones.normalize_phone(raw)

    def test_whatsapp_and_mask(self):
        self.assertEqual(phones.whatsapp_digits("01553211120"), "201553211120")
        self.assertEqual(phones.whatsapp_digits("+966501234567"), "966501234567")
        self.assertEqual(phones.mask_phone("01012345678"), "010******78")


class MoneyRuleTests(SimpleTestCase):
    def settings(self, **kwargs) -> ShopSettings:
        return ShopSettings(**kwargs)

    def test_line_total_rounds_like_the_cashier(self):
        # Banker's rounding on the half piastre, as Decimal.quantize does by default.
        self.assertEqual(pricing.line_total(D("45.00"), D("0.250")), D("11.25"))
        self.assertEqual(pricing.line_total(D("33.33"), D("0.250")), D("8.33"))   # 8.3325
        self.assertEqual(pricing.line_total(D("0.25"), D("0.250")), D("0.06"))    # 0.0625
        self.assertEqual(pricing.line_total(D("0.05"), D("0.500")), D("0.02"))    # 0.025 -> even
        self.assertEqual(pricing.line_total(D("0.15"), D("0.500")), D("0.08"))    # 0.075 -> even

    def test_deposit_is_a_share_rounded_up_to_a_pound(self):
        half = self.settings(deposit_percent=50)
        self.assertEqual(pricing.deposit_for(D("500.00"), half), D("250.00"))
        self.assertEqual(pricing.deposit_for(D("125.50"), half), D("63.00"))   # 62.75 -> 63
        self.assertEqual(pricing.deposit_for(D("0.50"), half), D("0.50"))      # never above the goods
        third = self.settings(deposit_percent=30)
        self.assertEqual(pricing.deposit_for(D("101.00"), third), D("31.00"))  # 30.3 -> 31
        full = self.settings(deposit_percent=100)
        self.assertEqual(pricing.deposit_for(D("125.50"), full), D("125.50"))

    def test_deposit_minimum(self):
        settings = self.settings(deposit_percent=10, deposit_min=D("50.00"))
        self.assertEqual(pricing.deposit_for(D("200.00"), settings), D("50.00"))
        self.assertEqual(pricing.deposit_for(D("900.00"), settings), D("90.00"))
        self.assertEqual(pricing.deposit_for(D("30.00"), settings), D("30.00"))

    def test_delivery_fee(self):
        settings = self.settings(delivery_fee=D("35.00"), free_delivery_over=D("500.00"))
        self.assertEqual(pricing.delivery_fee_for(D("100"), "DELIVERY", settings), D("35.00"))
        self.assertEqual(pricing.delivery_fee_for(D("500"), "DELIVERY", settings), D("0.00"))
        self.assertEqual(pricing.delivery_fee_for(D("100"), "PICKUP", settings), D("0.00"))
        never_free = self.settings(delivery_fee=D("35.00"), free_delivery_over=None)
        self.assertEqual(pricing.delivery_fee_for(D("9999"), "DELIVERY", never_free), D("35.00"))

    def test_parse_items_merges_and_flags(self):
        parsed = pricing.parse_items([
            {"id": 1, "qty": "2"}, {"id": 1, "qty": 1}, {"id": 2, "qty": "0.25"},
            {"id": 3, "qty": "abc"}, {"id": 4, "qty": "-1"}, {"id": 5, "qty": "1.0001"},
            {"id": 6, "qty": True},
        ])
        self.assertEqual(parsed[1], D("3.000"))
        self.assertEqual(parsed[2], D("0.250"))
        for bad in (3, 4, 5, 6):
            self.assertIsNone(parsed[bad])

    def test_parse_items_refuses_malformed_carts(self):
        for raw in ("nope", [1, 2], [{"qty": 1}], [{"id": "x", "qty": 1}], [{"id": 0, "qty": 1}]):
            with self.assertRaises(pricing.InvalidCart):
                pricing.parse_items(raw)
        with self.assertRaises(pricing.InvalidCart):
            pricing.parse_items([{"id": i, "qty": 1} for i in range(1, pricing.MAX_LINES + 2)])


class QuoteTests(ShopTestCase):
    def quote(self, items, fulfilment="DELIVERY"):
        return pricing.build_quote(items, fulfilment)

    def test_prices_come_from_the_cashier(self):
        quote = self.quote([{"id": self.honey.pk, "qty": 2}, {"id": self.olives.pk, "qty": "0.75"}])
        self.assertTrue(quote.ok, quote.problems)
        self.assertEqual(quote.subtotal, D("533.75"))   # 500 + 33.75
        self.assertEqual(quote.deposit, D("267.00"))    # 266.875 -> 267
        self.assertEqual(quote.balance, D("266.75"))
        self.assertEqual(quote.total, D("533.75"))

    def test_delivery_fee_is_added_but_not_deposited(self):
        self.shop_settings(delivery_fee=D("40.00"))
        quote = self.quote([{"id": self.honey.pk, "qty": 1}], "DELIVERY")
        self.assertEqual((quote.subtotal, quote.delivery_fee, quote.total), (D("250.00"), D("40.00"), D("290.00")))
        self.assertEqual(quote.deposit, D("125.00"))
        self.assertEqual(quote.balance, D("165.00"))

    def test_line_issues(self):
        gone = self.dates.pk + 999
        hidden = self.dates
        Listing.objects.create(product=hidden, hidden=True)
        quote = self.quote([
            {"id": self.honey.pk, "qty": 11},        # only 10 in stock
            {"id": self.olives.pk, "qty": "0.3"},    # not a quarter step
            {"id": gone, "qty": 1},
            {"id": hidden.pk, "qty": 1},
        ])
        issues = {line.product_id: line.issue for line in quote.lines}
        self.assertEqual(issues[self.honey.pk], "INSUFFICIENT")
        self.assertEqual(issues[self.olives.pk], "INVALID_QUANTITY")
        self.assertEqual(issues[gone], "UNAVAILABLE")
        self.assertEqual(issues[hidden.pk], "UNAVAILABLE")
        self.assertIn("LINE_ISSUES", quote.problems)
        self.assertEqual(quote.subtotal, D("0.00"))
        honey_line = next(l for l in quote.lines if l.product_id == self.honey.pk)
        self.assertEqual(honey_line.max_quantity, D("10.000"))

    def test_unit_goods_need_whole_numbers(self):
        quote = self.quote([{"id": self.honey.pk, "qty": "1.5"}])
        self.assertEqual(quote.lines[0].issue, "INVALID_QUANTITY")

    def test_inactive_products_cannot_be_ordered(self):
        Product.objects.filter(pk=self.honey.pk).update(is_active=False)
        quote = self.quote([{"id": self.honey.pk, "qty": 1}])
        self.assertEqual(quote.lines[0].issue, "UNAVAILABLE")

    def test_cart_level_problems(self):
        self.assertIn("EMPTY", self.quote([]).problems)

        self.shop_settings(min_order=D("300.00"), pickup_enabled=False)
        quote = self.quote([{"id": self.honey.pk, "qty": 1}], "PICKUP")
        self.assertIn("MIN_ORDER", quote.problems)
        self.assertIn("FULFILMENT_UNAVAILABLE", quote.problems)

        self.shop_settings(ordering_enabled=False)
        self.assertIn("ORDERING_DISABLED", self.quote([{"id": self.honey.pk, "qty": 2}], "DELIVERY").problems)

    def test_no_instapay_details_means_no_delivery_ordering(self):
        self.shop_settings(instapay_address="")
        self.assertIn("INSTAPAY_NOT_CONFIGURED", self.quote([{"id": self.honey.pk, "qty": 1}]).problems)
        pickup = self.quote([{"id": self.honey.pk, "qty": 1}], "PICKUP")
        self.assertTrue(pickup.ok, pickup.problems)

    def test_pickup_takes_no_deposit(self):
        quote = self.quote([{"id": self.honey.pk, "qty": 2}], "PICKUP")
        self.assertEqual((quote.total, quote.deposit, quote.balance), (D("500.00"), D("0.00"), D("500.00")))

    def test_open_web_orders_hold_stock_back(self):
        self.place_ok([{"id": self.dates.pk, "qty": 3}])       # 4 in stock, 3 reserved
        quote = self.quote([{"id": self.dates.pk, "qty": 2}])
        self.assertEqual(quote.lines[0].issue, "INSUFFICIENT")
        self.assertEqual(quote.lines[0].max_quantity, D("1.000"))
        self.assertEqual(pricing.reserved_quantities()[self.dates.pk], D("3.000"))

    def test_weighed_stock_is_offered_in_whole_steps(self):
        info = pricing.catalog.load_products([self.olives.pk])[self.olives.pk]
        self.assertEqual(pricing.orderable_quantity(info, D("0.100")), D("9.250"))  # 9.4 free

    def test_unknown_fulfilment_falls_back(self):
        quote = pricing.build_quote([{"id": self.honey.pk, "qty": 1}], None)
        self.assertEqual(quote.fulfilment, WebOrder.Fulfilment.DELIVERY)
