"""Shared field definitions.

Quantities are Decimal everywhere so the system handles both whole units
(pcs, boxes) and measured goods (kg, litres, metres). Three decimal places
covers grams and millilitres, which is the practical floor for retail scales.
"""
from decimal import Decimal

from django.db import models

QUANTITY_MAX_DIGITS = 12
QUANTITY_DECIMAL_PLACES = 3
QUANTITY_ZERO = Decimal("0.000")


def quantity_field(**kwargs) -> models.DecimalField:
    """A stock/sale quantity. Signed — callers decide whether negatives are valid."""
    kwargs.setdefault("max_digits", QUANTITY_MAX_DIGITS)
    kwargs.setdefault("decimal_places", QUANTITY_DECIMAL_PLACES)
    return models.DecimalField(**kwargs)


def money_field(**kwargs) -> models.DecimalField:
    kwargs.setdefault("max_digits", 12)
    kwargs.setdefault("decimal_places", 2)
    return models.DecimalField(**kwargs)


def format_quantity(value: Decimal, product=None) -> str:
    """Render a quantity for receipts/UI: '3' for units, '1.250' for weighed goods."""
    if value is None:
        return "0"
    value = Decimal(value)
    if product is not None and not getattr(product, "is_weighed", False):
        return str(int(value))
    normalised = value.normalize()
    # normalize() turns 10.000 into 1E+1 — expand it back out.
    if normalised.as_tuple().exponent > 0:
        normalised = normalised.quantize(Decimal(1))
    return str(normalised)
