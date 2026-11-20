"""The website's games, switched on and off from the orders admin, and the
prizes a good score wins: a share off the next web order (prizes.py)."""
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from apps.common.models import AuditLog
from apps.orders.models import Order
from apps.products.models import Product
from apps.shifts.services import open_shift
from apps.webshop.models import GamePrize, WebOrder

from .base import SHOP, ShopTestCase

D = Decimal
# The number ShopTestCase.place() orders with, as a customer would type it.
PHONE = "0101 234 5678"
ALL_GAMES = ["push-ups", "memory", "calorie-challenge", "hungry-bee"]


class PrizeTestCase(ShopTestCase):
    """Prizes on, at their first terms: 10% off goods of 200 or more, at
    most 50 off; 25 push-ups win."""

    def setUp(self):
        super().setUp()
        self.shop_settings(prizes_enabled=True)

    def claim(self, game="push-ups", score=30, phone=PHONE, **extra):
        body = {"game": game, "score": score, "phone": phone, **extra}
        return self.client.post(f"{SHOP}/prizes/", body, format="json")

    def won(self, **kwargs) -> dict:
        response = self.claim(**kwargs)
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()["prize"]

    def check(self, code, phone=PHONE):
        return self.client.post(f"{SHOP}/prizes/check/", {"code": code, "phone": phone}, format="json")

    def run_out(self, order):
        WebOrder.objects.filter(code=order["code"]).update(expires_at=timezone.now() - timedelta(minutes=1))


class GameSettingsTests(ShopTestCase):
    def test_every_game_is_on_and_prizes_are_off_at_first(self):
        games = self.client.get(f"{SHOP}/config/").json()["games"]
        self.assertEqual(games, {"on": ALL_GAMES, "prizes": None})

    def test_a_game_switched_off_leaves_the_website(self):
        self.shop_settings(memory_on=False)
        on = self.client.get(f"{SHOP}/config/").json()["games"]["on"]
        self.assertEqual(on, ["push-ups", "calorie-challenge", "hungry-bee"])

    def test_the_storefront_learns_the_prize_and_the_scores_that_win(self):
        self.shop_settings(prizes_enabled=True, prize_percent=15, prize_max=D("75.00"), quiz_to_win=8)
        terms = self.client.get(f"{SHOP}/config/").json()["games"]["prizes"]
        self.assertEqual(terms, {
            "percent": 15, "max": "75.00", "min_order": "200.00", "days": 7,
            "to_win": {"push-ups": 25, "memory": 3, "calorie-challenge": 8, "hungry-bee": 45},
        })

    def test_only_a_super_admin_sets_the_games_and_the_prizes(self):
        body = {
            "memory_on": False, "prizes_enabled": True, "prize_percent": 20, "prize_max": "100",
            "prize_min_order": "300", "push_ups_to_win": 40,
        }
        cashier = self.staff_client("cashier")
        self.assertEqual(cashier.get(f"{SHOP}/admin/settings/").json()["settings"]["prizes_enabled"], False)
        self.assertEqual(cashier.put(f"{SHOP}/admin/settings/", body, format="json").status_code, 403)
        saved = self.staff_client().put(f"{SHOP}/admin/settings/", body, format="json")
        self.assertEqual(saved.status_code, 200, saved.content)
        settings = saved.json()["settings"]
        self.assertEqual(
            [settings[k] for k in ("memory_on", "prizes_enabled", "prize_percent", "prize_max", "prize_min_order",
                                   "push_ups_to_win", "quiz_to_win")],
            [False, True, 20, "100.00", "300.00", 40, 9],
        )

    def test_prize_settings_are_checked(self):
        admin = self.staff_client()
        for body in (
            {"prize_percent": 0}, {"prize_percent": 51}, {"prize_max": "0.50"}, {"prize_min_order": "-1"},
            {"memory_stars_to_win": 4}, {"quiz_to_win": 11}, {"push_ups_to_win": 0}, {"hungry_bee_to_win": 1001},
        ):
            with self.subTest(body=body):
                response = admin.put(f"{SHOP}/admin/settings/", body, format="json")
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn(next(iter(body)), response.json()["fields"])


class ClaimTests(PrizeTestCase):
    def test_a_winning_score_wins_a_code_kept_to_the_number(self):
        response = self.claim(score=25)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertTrue(response.json()["new"])
        prize = response.json()["prize"]
        self.assertRegex(prize["code"], r"^BEE-[2-9A-HJKMNP-Z]{6}$")
        self.assertEqual(
            (prize["game"], prize["phone"], prize["percent"], prize["max"], prize["min_order"]),
            ("push-ups", "010******78", 10, "50.00", "200.00"),
        )
        saved = GamePrize.objects.get(code=prize["code"])
        self.assertEqual((saved.phone, saved.score, saved.order), ("01012345678", 25, None))
        self.assertAlmostEqual(saved.expires_at, timezone.now() + timedelta(days=7), delta=timedelta(minutes=1))

    def test_a_score_short_of_the_mark_wins_nothing(self):
        response = self.claim(score=24)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "SCORE_TOO_LOW"))
        self.assertFalse(GamePrize.objects.exists())

    def test_each_game_counts_its_own_score(self):
        cases = [
            ("calorie-challenge", 9, "", True), ("calorie-challenge", 8, "", False),
            ("hungry-bee", 45, "", True), ("hungry-bee", 44, "", False),
            # The memory game sends its moves: three stars on 6 pairs take
            # at most 11, on 10 pairs at most 18.
            ("memory", 11, "easy", True), ("memory", 12, "easy", False),
            ("memory", 18, "hard", True), ("memory", 19, "hard", False),
        ]
        for index, (game, score, level, wins) in enumerate(cases):
            with self.subTest(game=game, score=score, level=level):
                response = self.claim(game=game, score=score, level=level, phone=f"0111111{index:04d}")
                self.assertEqual(response.status_code, 201 if wins else 409, response.content)

    def test_two_stars_win_when_the_shop_asks_for_two(self):
        self.shop_settings(memory_stars_to_win=2)
        self.assertEqual(self.claim(game="memory", score=20, level="medium").status_code, 201)   # 8 pairs: 2 stars

    def test_impossible_scores_and_boards(self):
        self.assertEqual(self.claim(game="memory", score=8).json()["code"], "SCORE_TOO_LOW")   # which board?
        self.assertEqual(self.claim(game="memory", score=5, level="easy").json()["code"], "SCORE_TOO_LOW")
        self.assertEqual(self.claim(score=2001).json()["code"], "INVALID")
        self.assertEqual(self.claim(score=-1).status_code, 400)
        self.assertEqual(self.claim(game="chess").status_code, 400)
        self.assertEqual(self.claim(phone="12345").status_code, 400)
        self.assertFalse(GamePrize.objects.exists())

    def test_no_prizes_while_they_are_off_or_for_a_game_that_is_off(self):
        self.shop_settings(hungry_bee_on=False)
        self.assertEqual(self.claim(game="hungry-bee", score=60).json()["code"], "GAME_OFF")
        self.shop_settings(prizes_enabled=False)
        response = self.claim()
        self.assertEqual((response.status_code, response.json()["code"]), (409, "PRIZES_OFF"))
        self.assertFalse(GamePrize.objects.exists())

    def test_one_prize_a_week_for_each_number(self):
        first = self.won()
        # Still unused, it comes back rather than a second one.
        again = self.claim(game="calorie-challenge", score=10, phone="+20 101 234 5678")
        self.assertEqual((again.status_code, again.json()["new"]), (200, False))
        self.assertEqual(again.json()["prize"]["code"], first["code"])
        # Once used, the number waits for the week to pass.
        self.place_ok(prize_code=first["code"])
        used = self.claim()
        self.assertEqual((used.status_code, used.json()["code"]), (409, "ALREADY_WON"))
        self.assertIn("next_at", used.json())
        # Another number wins its own.
        self.assertNotEqual(self.won(phone="01112345678")["code"], first["code"])
        GamePrize.objects.filter(phone="01012345678").update(created_at=timezone.now() - timedelta(days=7, minutes=1))
        self.assertEqual(self.claim().status_code, 201)
        self.assertEqual(GamePrize.objects.count(), 3)

    def test_a_prize_whose_order_ran_out_comes_back(self):
        prize = self.won()
        self.run_out(self.place_ok(prize_code=prize["code"]))
        again = self.claim()
        self.assertEqual((again.status_code, again.json()["prize"]["code"]), (200, prize["code"]))


class CheckTests(PrizeTestCase):
    def test_a_code_is_checked_with_its_number_however_it_is_typed(self):
        prize = self.won()
        for typed in (prize["code"], prize["code"].lower().replace("-", " "), prize["code"][4:]):
            with self.subTest(typed=typed):
                response = self.check(typed)
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(response.json()["prize"]["code"], prize["code"])

    def test_another_number_or_a_made_up_code_finds_nothing(self):
        prize = self.won()
        for code, phone in ((prize["code"], "01112345678"), ("BEE-2222222", PHONE), ("", PHONE), (prize["code"], "")):
            with self.subTest(code=code, phone=phone):
                response = self.check(code, phone)
                self.assertEqual((response.status_code, response.json()["code"]), (404, "PRIZE_NOT_FOUND"))

    def test_a_used_prize_and_one_past_its_week(self):
        prize = self.won()
        order = self.place_ok(prize_code=prize["code"])
        self.assertEqual(self.check(prize["code"]).json()["code"], "PRIZE_USED")
        self.run_out(order)
        self.assertEqual(self.check(prize["code"]).status_code, 200)
        GamePrize.objects.update(expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(self.check(prize["code"]).json()["code"], "PRIZE_EXPIRED")


class PrizeOrderTests(PrizeTestCase):
    def test_the_prize_comes_off_the_goods_and_the_deposit_follows(self):
        prize = self.won()
        order = self.place_ok(prize_code=prize["code"])   # goods 500: 10% is 50, the most it takes
        self.assertEqual(
            [order[k] for k in ("subtotal", "discount", "prize_code", "total", "deposit_required")],
            ["500.00", "50.00", prize["code"], "450.00", "225.00"],
        )
        self.assertEqual(GamePrize.objects.get().order.code, order["code"])
        self.assertEqual(self.track(order)["discount"], "50.00")

    def test_the_share_is_in_whole_pounds(self):
        prize = self.won()
        # 2 x 180 + 0.75 kg x 45 = 393.75, and 10% of it is 39.37: 39 off.
        order = self.place_ok(
            [{"id": self.dates.pk, "qty": 2}, {"id": self.olives.pk, "qty": "0.75"}], prize_code=prize["code"]
        )
        self.assertEqual(
            [order[k] for k in ("subtotal", "discount", "total", "deposit_required")],
            ["393.75", "39.00", "354.75", "178.00"],
        )

    def test_free_delivery_and_the_minimum_order_go_by_the_goods_in_full(self):
        self.shop_settings(delivery_fee=D("40.00"), free_delivery_over=D("500.00"), min_order=D("480.00"))
        prize = self.won()
        order = self.place_ok(prize_code=prize["code"])   # 500 of goods, 450 after the prize
        self.assertEqual((order["delivery_fee"], order["total"]), ("0.00", "450.00"))

    def test_the_expected_total_is_the_one_after_the_prize(self):
        prize = self.won()
        self.assertEqual(self.place(prize_code=prize["code"], expected_total="500.00").json()["code"], "PRICE_CHANGED")
        self.assertIsNone(GamePrize.objects.get().order)
        self.place_ok(prize_code=prize["code"], expected_total="450.00")

    def test_goods_under_the_prizes_minimum_are_refused(self):
        prize = self.won()
        response = self.place([{"id": self.dates.pk, "qty": 1}], prize_code=prize["code"])   # 180
        body = response.json()
        self.assertEqual((response.status_code, body["code"], body["min_order"]), (409, "PRIZE_MIN_ORDER", "200.00"))
        self.assertEqual(body["quote"]["discount"], "0.00")
        self.assertEqual((WebOrder.objects.count(), GamePrize.objects.get().order), (0, None))

    def test_a_code_works_only_with_the_number_that_won_it(self):
        prize = self.won()
        response = self.place(prize_code=prize["code"], phone="01112345678")
        self.assertEqual((response.status_code, response.json()["code"]), (404, "PRIZE_NOT_FOUND"))
        self.assertFalse(WebOrder.objects.exists())

    def test_a_prize_goes_to_one_order_and_is_free_again_if_that_order_is_cancelled(self):
        prize = self.won()
        first = self.place_ok(prize_code=prize["code"])
        again = self.place(prize_code=prize["code"])
        self.assertEqual((again.status_code, again.json()["code"]), (409, "PRIZE_USED"))
        cancelled = self.client.post(f"{SHOP}/orders/{first['code']}/cancel/", {"t": first["token"]}, format="json")
        self.assertEqual(cancelled.json()["order"]["status"], "CANCELLED")
        second = self.place_ok(prize_code=prize["code"])
        self.assertEqual((second["discount"], GamePrize.objects.get().order.code), ("50.00", second["code"]))

    def test_a_prize_keeps_the_terms_of_the_day_it_was_won(self):
        prize = self.won()
        self.shop_settings(prize_percent=5, prize_max=D("10.00"), prize_min_order=D("1000.00"), prizes_enabled=False)
        # Prizes switched off since: those already won still count.
        self.assertEqual(self.place_ok(prize_code=prize["code"])["discount"], "50.00")

    def test_staff_see_the_prize_on_the_order(self):
        prize = self.won()
        public = self.place_ok(prize_code=prize["code"])
        detail = self.staff_client("cashier").get(f"{SHOP}/admin/orders/{self.pk_of(public)}/").json()["order"]
        self.assertEqual((detail["discount"], detail["prize_code"]), ("50.00", prize["code"]))
        created = next(e for e in detail["events"] if e["kind"] == "CREATED")
        self.assertEqual(created["data"], {"prize": prize["code"], "discount": "50.00"})

    def test_a_late_deposit_brings_the_prize_back_to_its_order(self):
        prize = self.won()
        order = self.place_ok(prize_code=prize["code"])
        self.run_out(order)
        self.assertEqual(self.check(prize["code"]).status_code, 200)   # free again, and the order expired
        self.assertEqual(self.pay(order).json()["order"]["status"], "DEPOSIT_REVIEW")
        self.assertEqual(GamePrize.objects.get().order.code, order["code"])
        self.assertEqual(self.check(prize["code"]).json()["code"], "PRIZE_USED")

    def test_staff_are_told_when_a_late_deposit_finds_the_prize_used_again(self):
        prize = self.won()
        old = self.place_ok(prize_code=prize["code"])
        self.run_out(old)
        new = self.place_ok(prize_code=prize["code"])
        self.assertEqual(self.pay(old).json()["order"]["status"], "DEPOSIT_REVIEW")
        self.assertEqual(GamePrize.objects.get().order.code, new["code"])
        detail = self.staff_client().get(f"{SHOP}/admin/orders/{self.pk_of(old)}/").json()["order"]
        note = next(e for e in detail["events"] if e["kind"] == "NOTE")
        self.assertEqual((note["public"], note["data"]["other_order"]), (False, new["code"]))
        self.assertIn(new["code"], note["message"])


class PrizeHandOverTests(PrizeTestCase):
    def setUp(self):
        super().setUp()
        open_shift(user=self.cashier_user)

    def test_the_prize_is_the_sales_discount_and_needs_no_manager_pin(self):
        # 100 off is over the till's own limit (50), but a super admin set it.
        self.shop_settings(prize_percent=20, prize_max=D("100.00"))
        prize = self.won()
        public, order, _ = self.confirmed_order(prize_code=prize["code"])   # 500 less 100; deposit 200
        cashier = self.staff_client("cashier")
        plan = cashier.get(f"{SHOP}/admin/orders/{order['id']}/sale-plan/").json()
        self.assertEqual(
            [plan[k] for k in ("goods", "discount", "prize_code", "total", "deposit_applied", "balance", "to_collect")],
            ["500.00", "100.00", prize["code"], "400.00", "200.00", "200.00", "200.00"],
        )
        done = self.act(cashier, order["id"], "complete", {"balance_method": "CASH"})
        self.assertEqual(done.status_code, 200, done.content)
        sale = Order.objects.get(pk=done.json()["order"]["pos"]["order_id"])
        self.assertEqual((sale.subtotal, sale.discount, sale.total), (D("500.00"), D("100.00"), D("400.00")))
        self.assertEqual([p.amount for p in sale.payments.order_by("id")], [D("200.00"), D("200.00")])
        self.assertEqual(sale.note, f"Web order {public['code']}, prize {prize['code']}")
        # In the audit log like any till discount, with no second person.
        entry = AuditLog.objects.get(action="DISCOUNT")
        self.assertEqual((entry.actor.username, entry.authorised_by), ("cashier", None))
        self.assertEqual(self.track(public)["final_total"], "400.00")

    def test_only_the_prize_is_authorised_already(self):
        prize = self.won()
        _, order, _ = self.confirmed_order(prize_code=prize["code"])
        Product.objects.filter(pk=self.honey.pk).update(price=D("400.00"))   # the customer's price: 300 off
        cashier = self.staff_client("cashier")
        body = {"balance_method": "CASH", "price_mode": "quoted"}
        asked = self.act(cashier, order["id"], "complete", body)
        self.assertEqual((asked.status_code, asked.json()["code"]), (409, "PIN_REQUIRED"))
        done = self.act(cashier, order["id"], "complete", {**body, "override_pin": "4321"})
        self.assertEqual(done.status_code, 200, done.content)
        sale = Order.objects.get(pk=done.json()["order"]["pos"]["order_id"])
        self.assertEqual((sale.discount, sale.total), (D("50.00"), D("450.00")))

    def test_a_prize_is_never_more_than_the_goods_at_hand_over(self):
        prize = self.won()
        _, order, admin = self.confirmed_order(prize_code=prize["code"])   # 50 off 500; deposit 225
        Product.objects.filter(pk=self.honey.pk).update(price=D("20.00"))
        plan = admin.get(f"{SHOP}/admin/orders/{order['id']}/sale-plan/?price_mode=current").json()
        self.assertEqual((plan["goods"], plan["discount"], plan["total"]), ("40.00", "40.00", "0.00"))
