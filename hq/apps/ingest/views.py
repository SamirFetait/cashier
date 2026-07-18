import json
from datetime import date as date_cls
from decimal import Decimal, InvalidOperation

from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from apps.branches.models import Branch

from .models import DailyReport


def _authenticate(request) -> Branch | None:
    code = request.headers.get("X-Branch-Code")
    key = request.headers.get("X-Api-Key")
    if not code or not key:
        return None
    try:
        branch = Branch.objects.get(code=code, is_active=True)
    except Branch.DoesNotExist:
        return None
    # constant-time-ish comparison
    if not key or key != branch.api_key:
        return None
    return branch


@csrf_exempt
@require_POST
def ingest_daily_report(request):
    branch = _authenticate(request)
    if branch is None:
        return JsonResponse({"detail": "unauthorized"}, status=401)

    try:
        body = json.loads(request.body.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return JsonResponse({"detail": "invalid JSON"}, status=400)

    raw_date = body.get("date")
    if not raw_date:
        return JsonResponse({"detail": "date is required"}, status=400)
    try:
        report_date = date_cls.fromisoformat(raw_date)
    except ValueError:
        return JsonResponse({"detail": "date must be YYYY-MM-DD"}, status=400)

    try:
        sales_total = Decimal(str(body.get("sales_total", "0")))
    except (InvalidOperation, TypeError):
        sales_total = Decimal("0")

    DailyReport.objects.update_or_create(
        branch=branch,
        date=report_date,
        defaults={
            "sales_total": sales_total,
            "order_count": int(body.get("order_count", 0) or 0),
            "payload": body,
        },
    )
    branch.last_report_at = timezone.now()
    branch.save(update_fields=["last_report_at"])

    return JsonResponse({"status": "ok", "branch": branch.code, "date": raw_date})
