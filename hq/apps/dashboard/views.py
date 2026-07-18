from django.contrib.auth.mixins import LoginRequiredMixin
from django.db.models import Sum
from django.utils import timezone
from django.views.generic import DetailView, TemplateView

from apps.branches.models import Branch
from apps.ingest.models import DailyReport


class DashboardView(LoginRequiredMixin, TemplateView):
    template_name = "dashboard/index.html"

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        today = timezone.localdate()

        today_reports = DailyReport.objects.filter(date=today).select_related("branch")
        month_total = (
            DailyReport.objects.filter(date__year=today.year, date__month=today.month)
            .aggregate(t=Sum("sales_total"))["t"]
            or 0
        )

        ctx["branches"] = Branch.objects.all()
        ctx["branch_count"] = ctx["branches"].count()
        ctx["today_total"] = today_reports.aggregate(t=Sum("sales_total"))["t"] or 0
        ctx["month_total"] = month_total
        ctx["today_reports"] = today_reports
        ctx["chart_labels"] = [r.branch.code for r in today_reports]
        ctx["chart_values"] = [float(r.sales_total) for r in today_reports]
        ctx["recent_reports"] = DailyReport.objects.select_related("branch")[:25]
        return ctx


class BranchDetailView(LoginRequiredMixin, DetailView):
    model = Branch
    template_name = "dashboard/branch_detail.html"
    context_object_name = "branch"

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        reports = self.object.reports.all()[:60]
        ordered = list(reversed(reports))
        ctx["reports"] = reports
        ctx["chart_labels"] = [r.date.isoformat() for r in ordered]
        ctx["chart_values"] = [float(r.sales_total) for r in ordered]
        return ctx
