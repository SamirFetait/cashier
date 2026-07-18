from django.conf import settings
from rest_framework import mixins, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsSuperAdmin

from .models import DailyReport
from .serializers import DailyReportSerializer
from .services import run_daily_sync


class BranchView(APIView):
    """Branch identity for the app header (any authenticated user)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(
            {
                "code": settings.BRANCH_CODE,
                "name": settings.BRANCH_NAME,
                "hq_configured": bool(settings.HQ_API_URL),
                "report_time": settings.REPORT_TIME,
            }
        )


class DailyReportViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = DailyReport.objects.all()
    serializer_class = DailyReportSerializer
    permission_classes = [IsSuperAdmin]


class SendDailyReportNowView(APIView):
    """Generate today's report and push all pending reports to HQ immediately."""

    permission_classes = [IsSuperAdmin]

    def post(self, request):
        result = run_daily_sync()
        return Response(result)
