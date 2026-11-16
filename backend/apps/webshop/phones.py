"""Phone numbers as customers type them, reduced to one spelling."""
import re

# Arabic-Indic (٠-٩) and Eastern Arabic-Indic (۰-۹) digits to ASCII.
_DIGITS = {ord(c): str(i) for i, c in enumerate("٠١٢٣٤٥٦٧٨٩")}
_DIGITS.update({ord(c): str(i) for i, c in enumerate("۰۱۲۳۴۵۶۷۸۹")})

_EGYPT_MOBILE = re.compile(r"01[0125]\d{8}")
_INTERNATIONAL = re.compile(r"\+[1-9]\d{7,14}")


class InvalidPhone(ValueError):
    pass


def normalize_phone(raw: str) -> str:
    """An Egyptian mobile as ``01XXXXXXXXX``; any other number as ``+<digits>``.

    Accepts spaces, dashes, brackets, Arabic digits and the +20 / 0020 / 20
    prefixes people paste from their contacts.
    """
    text = str(raw or "").translate(_DIGITS)
    text = re.sub(r"[\s\-().]", "", text)
    if text.startswith("00"):
        text = "+" + text[2:]
    if text.startswith("+20"):
        text = "0" + text[3:]
    elif text.startswith("20") and len(text) == 12:
        text = "0" + text[2:]
    if _EGYPT_MOBILE.fullmatch(text):
        return text
    if _INTERNATIONAL.fullmatch(text):
        return text
    raise InvalidPhone("Enter a valid mobile number.")


def whatsapp_digits(phone: str) -> str:
    """The number as wa.me wants it: country code first, digits only."""
    if _EGYPT_MOBILE.fullmatch(phone or ""):
        return "20" + phone[1:]
    return re.sub(r"\D", "", phone or "")


def spellings(phone: str) -> list[str]:
    """The ways the cashier may have this number on file."""
    if _EGYPT_MOBILE.fullmatch(phone or ""):
        rest = phone[1:]
        return [phone, f"+20{rest}", f"20{rest}", f"0020{rest}", f"+20 {rest}"]
    return [phone, phone.lstrip("+")]


def mask_phone(phone: str) -> str:
    """``010******89``: enough for the customer to recognise their number."""
    if len(phone) <= 5:
        return phone
    return phone[:3] + "*" * (len(phone) - 5) + phone[-2:]
