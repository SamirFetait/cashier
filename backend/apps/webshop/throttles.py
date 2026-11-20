"""Rate limits for the website's public endpoints, per client address.

Generous on purpose: Egyptian mobile networks put many customers behind one
address, so these only stop a script, not a busy evening. Each rate can be
changed with SHOP_THROTTLE_RATES in settings.
"""
import ipaddress

from django.conf import settings
from rest_framework.throttling import SimpleRateThrottle

DEFAULT_RATES = {
    "shop_quote": "240/min",
    "shop_order": "30/hour",
    "shop_deposit": "40/hour",
    "shop_lookup": "20/hour",
    "shop_prize": "30/hour",
    "shop_prize_check": "60/hour",
}


def client_ip(request) -> str | None:
    """The caller's address. Behind a tunnel or proxy, the address it reports
    (SHOP_NUM_PROXIES says how many sit in front)."""
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    address = request.META.get("REMOTE_ADDR") or ""
    proxies = getattr(settings, "SHOP_NUM_PROXIES", 0)
    if proxies > 0 and forwarded:
        hops = [part.strip() for part in forwarded.split(",") if part.strip()]
        if hops:
            address = hops[-min(proxies, len(hops))]
    try:
        return str(ipaddress.ip_address(address))
    except ValueError:
        return None


class _ByAddress(SimpleRateThrottle):
    def get_rate(self):
        rates = {**DEFAULT_RATES, **getattr(settings, "SHOP_THROTTLE_RATES", {})}
        return rates[self.scope]

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": client_ip(request) or "unknown"}


class QuoteThrottle(_ByAddress):
    scope = "shop_quote"


class OrderCreateThrottle(_ByAddress):
    scope = "shop_order"


class DepositThrottle(_ByAddress):
    scope = "shop_deposit"


class LookupThrottle(_ByAddress):
    scope = "shop_lookup"


class PrizeThrottle(_ByAddress):
    scope = "shop_prize"


class PrizeCheckThrottle(_ByAddress):
    scope = "shop_prize_check"
