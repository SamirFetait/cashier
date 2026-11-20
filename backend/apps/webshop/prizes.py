"""Prizes won in the website's games: a share off the goods of the next web
order, on the terms a super admin sets in the orders admin.

A good enough score wins a code. The code is kept to the phone number it was
won with and lasts a week, and a number can win once a week, so scores
faked on a device cannot be farmed. An order that takes a prize holds it;
should that order be cancelled or expire, the prize can be used again until
its week is out. A prize keeps the terms of the day it was won (its share,
the most it takes off, the goods it needs), and turning prizes off stops new
ones without taking back those already won.
"""
import secrets
from datetime import timedelta
from decimal import ROUND_FLOOR, Decimal
from math import ceil

from django.db import transaction
from django.utils import timezone

from .errors import ShopError
from .models import GamePrize, ShopSettings, WebOrder

ZERO = Decimal("0.00")
MONEY = Decimal("0.01")
POUND = Decimal("1")

# The website's games, by the names in their addresses (/games/push-ups/).
GAMES = ("push-ups", "memory", "calorie-challenge", "hungry-bee")
# How long a prize lasts, and how often one phone number can win one.
PRIZE_DAYS = 7
# The memory game's boards, and how many pairs each holds.
MEMORY_PAIRS = {"easy": 6, "medium": 8, "hard": 10}
# No score beyond these can come from a real game.
MOST = {"push-ups": 2000, "memory": 500, "calorie-challenge": 10, "hungry-bee": 5000}

CODE_PREFIX = "BEE-"
# No 0/O, 1/I/L: the code may be read out or typed in by hand.
CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
CODE_LENGTH = 6

# Each game's switch, and the score that wins, on ShopSettings.
_FIELDS = {
    "push-ups": ("push_ups_on", "push_ups_to_win"),
    "memory": ("memory_on", "memory_stars_to_win"),
    "calorie-challenge": ("calorie_challenge_on", "quiz_to_win"),
    "hungry-bee": ("hungry_bee_on", "hungry_bee_to_win"),
}


def game_on(settings: ShopSettings, game: str) -> bool:
    fields = _FIELDS.get(game)
    return bool(fields and getattr(settings, fields[0]))


def games_on(settings: ShopSettings) -> list[str]:
    return [game for game in GAMES if game_on(settings, game)]


def to_win(settings: ShopSettings, game: str) -> int:
    """The score that wins: push-ups, stars on a memory board, right answers
    out of ten, or the hungry bee's points."""
    return getattr(settings, _FIELDS[game][1])


def memory_stars(moves: int, level: str) -> int:
    """Stars for finishing a memory board in so many moves, as the game
    gives them: three for a good memory, one for many moves."""
    pairs = MEMORY_PAIRS.get(level)
    if not pairs or moves < pairs:
        return 0  # not a board, or fewer moves than any board can take
    if moves <= ceil(pairs * 1.75):
        return 3
    if moves <= ceil(pairs * 2.5):
        return 2
    return 1


def wins(settings: ShopSettings, game: str, score: int, level: str = "") -> bool:
    """Whether a finished game's score wins. The memory game counts stars,
    worked out from its moves; the others count their own points."""
    if game == "memory":
        return memory_stars(score, level) >= to_win(settings, game)
    return score >= to_win(settings, game)


def is_held(prize: GamePrize) -> bool:
    """Taken by an order that still stands: not cancelled, not run out."""
    return prize.order_id is not None and prize.order.status not in (
        WebOrder.Status.CANCELLED, WebOrder.Status.EXPIRED,
    )


def is_free(prize: GamePrize, now=None) -> bool:
    """In date, and not held by an order: unused, or used only by an order
    that came to nothing."""
    now = now or timezone.now()
    return prize.expires_at > now and not is_held(prize)


def retake(order: WebOrder) -> str:
    """An order that ran out, brought back by a late deposit, takes its prize
    back, on the terms it was placed with. Returns the code of the order that
    has the prize instead, when another one took it in the meantime: both
    then carry it, for staff to settle. Call inside a transaction."""
    if not order.prize_code:
        return ""
    prize = GamePrize.objects.select_for_update().select_related("order").filter(code=order.prize_code).first()
    if prize is None or prize.order_id == order.pk:
        return ""
    if is_held(prize):
        return prize.order.code
    prize.order = order
    prize.save(update_fields=["order"])
    return ""


def new_code() -> str:
    return CODE_PREFIX + "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def normalize_code(raw) -> str:
    """A code as people type it (lower case, spaces, with or without its
    "BEE-") as it is kept; empty when it cannot be one."""
    text = "".join(ch for ch in str(raw or "").upper() if ch.isalnum())
    prefix = CODE_PREFIX.rstrip("-")
    if len(text) == len(prefix) + CODE_LENGTH and text.startswith(prefix):
        text = text[len(prefix):]
    return CODE_PREFIX + text if len(text) == CODE_LENGTH else ""


def discount_for(prize: GamePrize, goods: Decimal) -> Decimal:
    """What a prize takes off goods worth so much: its share in whole pounds,
    at most its cap; nothing on goods under its minimum."""
    if goods <= ZERO or goods < prize.min_order:
        return ZERO
    share = (goods * prize.percent / Decimal(100)).quantize(POUND, rounding=ROUND_FLOOR)
    return min(share, prize.max_discount, goods).quantize(MONEY)


def claim(*, game: str, score: int, level: str, phone: str, client_ip=None) -> tuple[GamePrize, bool]:
    """The prize for a winning score: a new one, or the one this number won
    this week while it is still unused. Returns (prize, whether it is new)."""
    if score > MOST.get(game, 0):
        raise ShopError("INVALID", "That score is not possible.")
    ShopSettings.load()  # make sure the row exists before locking it
    with transaction.atomic():
        # One claim at a time, so a number cannot win twice at once.
        settings = ShopSettings.objects.select_for_update().get(pk=1)
        if not settings.prizes_enabled:
            raise ShopError("PRIZES_OFF", "There are no prizes at the moment.", status=409)
        if game not in GAMES or not game_on(settings, game):
            raise ShopError("GAME_OFF", "This game is not on the website.", status=409)
        if not wins(settings, game, score, level):
            raise ShopError("SCORE_TOO_LOW", "That score does not win a prize.", status=409)
        now = timezone.now()
        latest = (
            GamePrize.objects.select_related("order")
            .filter(phone=phone, created_at__gt=now - timedelta(days=PRIZE_DAYS))
            .order_by("-created_at")
            .first()
        )
        if latest is not None:
            if is_free(latest, now):
                return latest, False
            raise ShopError(
                "ALREADY_WON", "This number has had its prize this week.", status=409,
                next_at=(latest.created_at + timedelta(days=PRIZE_DAYS)).isoformat(),
            )
        prize = GamePrize(
            phone=phone, game=game, score=score, level=level if game == "memory" else "",
            percent=settings.prize_percent, max_discount=settings.prize_max, min_order=settings.prize_min_order,
            expires_at=now + timedelta(days=PRIZE_DAYS), client_ip=client_ip,
        )
        for _ in range(8):
            prize.code = new_code()
            if not GamePrize.objects.filter(code=prize.code).exists():
                break
        prize.save()
    return prize, True


def find(code, phone: str, now=None) -> GamePrize:
    """The prize behind a code, for the number it was won with, still to be
    used. A code given with another number looks like no code at all, so
    codes cannot be tried against numbers."""
    now = now or timezone.now()
    prize = GamePrize.objects.select_related("order").filter(code=normalize_code(code)).first()
    if prize is None or prize.phone != phone:
        raise ShopError("PRIZE_NOT_FOUND", "There is no prize with this code for this number.", status=404)
    if prize.expires_at <= now:
        raise ShopError("PRIZE_EXPIRED", "This prize's week is over.", status=409)
    if not is_free(prize, now):
        raise ShopError("PRIZE_USED", "This prize has been used on an order.", status=409)
    return prize
