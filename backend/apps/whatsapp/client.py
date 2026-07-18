"""Thin HTTP client for the whatsapp-service Node sidecar."""
import re

import requests
from django.conf import settings


class WhatsAppError(Exception):
    pass


def normalize_number(raw: str) -> str:
    """Return a digits-only international number (no '+', no separators).

    Handles common local formats by stripping a leading 0 and prepending the
    configured default country code.
    """
    digits = re.sub(r"\D", "", raw or "")
    cc = settings.DEFAULT_COUNTRY_CODE
    if not digits:
        return digits
    if cc and digits.startswith("0"):
        digits = cc + digits[1:]
    elif cc and not digits.startswith(cc) and len(digits) <= 10:
        digits = cc + digits
    return digits


def _headers():
    return {"x-api-key": settings.WHATSAPP_SHARED_SECRET}


def get_status() -> dict:
    try:
        resp = requests.get(
            f"{settings.WHATSAPP_SERVICE_URL}/status", headers=_headers(), timeout=10
        )
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as exc:
        raise WhatsAppError(f"WhatsApp service unreachable: {exc}") from exc


def send_message(number: str, message: str) -> dict:
    payload = {"number": normalize_number(number), "message": message}
    try:
        resp = requests.post(
            f"{settings.WHATSAPP_SERVICE_URL}/send",
            json=payload,
            headers=_headers(),
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as exc:
        raise WhatsAppError(str(exc)) from exc
