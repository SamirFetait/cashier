"""Thin HTTP client for the whatsapp-service Node sidecar."""
import unicodedata

import requests
from django.conf import settings


class WhatsAppError(Exception):
    pass


def normalize_number(raw: str) -> str:
    """Return a digits-only international number (no '+', no separators).

    Handles common local formats by stripping a leading 0 and prepending the
    configured default country code. A 00 prefix is the international one,
    and Arabic digits count as digits.
    """
    digits = "".join(str(unicodedata.decimal(c)) for c in str(raw or "") if c.isdecimal())
    cc = settings.DEFAULT_COUNTRY_CODE
    if not digits:
        return digits
    if digits.startswith("00"):
        return digits[2:]
    if cc and digits.startswith("0"):
        digits = cc + digits[1:]
    elif cc and not digits.startswith(cc) and len(digits) <= 10:
        digits = cc + digits
    return digits


def _headers():
    return {"x-api-key": settings.WHATSAPP_SHARED_SECRET}


def get_status(timeout: float = 10) -> dict:
    """{connected, number (the paired account's), qr, error}."""
    try:
        resp = requests.get(
            f"{settings.WHATSAPP_SERVICE_URL}/status", headers=_headers(), timeout=timeout
        )
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as exc:
        raise WhatsAppError(f"WhatsApp service unreachable: {exc}") from exc


def unlink(timeout: float = 60) -> dict:
    """Unlink the paired account. The sidecar then shows a new QR.

    Returns ``{"success": True, "confirmed": bool}``. ``confirmed`` is False
    when WhatsApp did not answer the logout, so the phone may still list the
    device under Linked devices.
    """
    try:
        resp = requests.post(
            f"{settings.WHATSAPP_SERVICE_URL}/unlink", headers=_headers(), timeout=timeout
        )
    except requests.RequestException as exc:
        raise WhatsAppError(f"WhatsApp service unreachable: {exc}") from exc
    if not resp.ok:
        try:
            reason = resp.json().get("error")
        except ValueError:
            reason = None
        raise WhatsAppError(reason or f"WhatsApp service answered {resp.status_code}")
    return resp.json()


def send_message(number: str, message: str, media: dict | None = None) -> dict:
    """Send text, or a file with the text as its caption.

    ``media`` is ``{"mimetype": ..., "data": <base64>, "filename": ...}``.
    """
    payload = {"number": normalize_number(number), "message": message}
    if media:
        payload["media"] = media
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
