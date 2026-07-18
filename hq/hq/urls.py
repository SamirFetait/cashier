from django.contrib import admin
from django.contrib.auth import views as auth_views
from django.urls import path

from apps.dashboard.views import BranchDetailView, DashboardView
from apps.ingest.views import ingest_daily_report

urlpatterns = [
    path("admin/", admin.site.urls),
    path("login/", auth_views.LoginView.as_view(template_name="registration/login.html"), name="login"),
    path("logout/", auth_views.LogoutView.as_view(), name="logout"),
    path("", DashboardView.as_view(), name="dashboard"),
    path("branch/<int:pk>/", BranchDetailView.as_view(), name="branch-detail"),
    path("api/ingest/daily-report/", ingest_daily_report, name="ingest-daily-report"),
]
