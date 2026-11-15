"""In-store barcodes for items that come without one.

GS1 sets the 20-29 prefixes aside for numbers a store assigns itself, so these
never clash with a manufacturer's code. They are ordinary EAN-13s, which every
retail scanner reads with its factory settings.
"""
from apps.common.models import Sequence

from .models import Product

STORE_PREFIX = "20"
SEQUENCE_KEY = "store_barcode"


def ean13_check_digit(data: str) -> str:
    """The check digit for the first 12 digits of an EAN-13."""
    if len(data) != 12 or not data.isdigit():
        raise ValueError("EAN-13 data must be 12 digits.")
    total = sum(int(digit) * (3 if index % 2 else 1) for index, digit in enumerate(data))
    return str((10 - total % 10) % 10)


def next_store_barcode() -> str:
    """Claim an in-store code no product uses yet. Must run inside a transaction.

    Codes typed in by hand can sit in the same range (the demo data has two),
    so a claimed number that is already taken is skipped.
    """
    while True:
        data = STORE_PREFIX + Sequence.next_value(SEQUENCE_KEY, padding=10)
        code = data + ean13_check_digit(data)
        if not Product.objects.filter(barcode=code).exists():
            return code
