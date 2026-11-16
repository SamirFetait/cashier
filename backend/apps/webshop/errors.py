"""One error shape for the website's API.

Every error body is ``{"code": "...", "detail": "..."}`` plus optional extras;
the two web apps translate by ``code``. This handler is set on the webshop
views only (see ShopView), so the cashier app's own errors keep their shape.
"""
import logging

from django.db import DatabaseError
from rest_framework import exceptions
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.views import exception_handler as drf_exception_handler

log = logging.getLogger(__name__)


class ShopError(Exception):
    """A request that cannot be carried out, with a code the UI can translate."""

    def __init__(self, code: str, detail: str, *, status: int = 400, **extra):
        super().__init__(detail)
        self.code = code
        self.detail = detail
        self.status = status
        self.extra = extra


def first_message(data) -> str:
    if isinstance(data, str):
        return data
    if isinstance(data, list):
        for item in data:
            text = first_message(item)
            if text:
                return text
        return ""
    if isinstance(data, dict):
        for value in data.values():
            text = first_message(value)
            if text:
                return text
    return ""


def exception_handler(exc, context):
    if isinstance(exc, ShopError):
        return Response({"code": exc.code, "detail": exc.detail, **exc.extra}, status=exc.status)
    if isinstance(exc, DatabaseError):
        log.exception("Database error in the webshop API")
        return Response(
            {"code": "UNAVAILABLE", "detail": "The store is temporarily unavailable."}, status=503
        )

    response = drf_exception_handler(exc, context)
    if response is None:
        return None
    if isinstance(exc, exceptions.ValidationError):
        fields = response.data if isinstance(response.data, dict) else {}
        response.data = {
            "code": "INVALID",
            "detail": first_message(response.data) or "Invalid input.",
            "fields": fields,
        }
    elif isinstance(exc, exceptions.Throttled):
        response.data = {
            "code": "THROTTLED",
            "detail": "Too many requests. Please try again shortly.",
            "retry_after": int(exc.wait) if exc.wait else None,
        }
    elif isinstance(exc, (exceptions.NotAuthenticated, exceptions.AuthenticationFailed)):
        response.data = {"code": "UNAUTHENTICATED", "detail": first_message(response.data)}
    elif isinstance(exc, exceptions.PermissionDenied):
        response.data = {"code": "FORBIDDEN", "detail": first_message(response.data)}
    elif response.status_code == 404:
        response.data = {"code": "NOT_FOUND", "detail": "Not found."}
    elif isinstance(response.data, dict) and "code" not in response.data:
        response.data = {"code": "ERROR", "detail": first_message(response.data)}
    return response


class ShopView(APIView):
    """Base for every webshop view: the shared error shape."""

    def get_exception_handler(self):
        return exception_handler
