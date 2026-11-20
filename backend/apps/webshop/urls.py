"""Routes of the website's API, mounted at /api/shop/ by cashier/urls.py."""
from django.urls import path

from . import views_admin as admin
from . import views_public as public

urlpatterns = [
    # Storefront (public)
    path("config/", public.ConfigView.as_view(), name="webshop-config"),
    path("catalog/", public.CatalogView.as_view(), name="webshop-catalog"),
    path("instapay-qr/", public.InstapayQrView.as_view(), name="webshop-instapay-qr"),
    path("events/", public.EventsView.as_view(), name="webshop-events"),
    path("quote/", public.QuoteView.as_view(), name="webshop-quote"),
    path("orders/", public.OrderCreateView.as_view(), name="webshop-order-create"),
    path("orders/lookup/", public.OrderLookupView.as_view(), name="webshop-order-lookup"),
    path("orders/<str:code>/", public.OrderTrackView.as_view(), name="webshop-order"),
    path("orders/<str:code>/deposit/", public.OrderDepositView.as_view(), name="webshop-order-deposit"),
    path("orders/<str:code>/cancel/", public.OrderCancelView.as_view(), name="webshop-order-cancel"),
    path("prizes/", public.PrizeClaimView.as_view(), name="webshop-prize-claim"),
    path("prizes/check/", public.PrizeCheckView.as_view(), name="webshop-prize-check"),
    # Orders admin (cashier staff)
    path("admin/board/", admin.BoardView.as_view(), name="webshop-board"),
    path("admin/orders/", admin.OrderListView.as_view(), name="webshop-admin-orders"),
    path("admin/orders/<int:pk>/", admin.OrderDetailView.as_view(), name="webshop-admin-order"),
    path("admin/orders/<int:pk>/proof/", admin.OrderProofView.as_view(), name="webshop-admin-proof"),
    path("admin/orders/<int:pk>/confirm-deposit/", admin.ConfirmDepositView.as_view()),
    path("admin/orders/<int:pk>/reject-deposit/", admin.RejectDepositView.as_view()),
    path("admin/orders/<int:pk>/status/", admin.OrderStatusView.as_view()),
    path("admin/orders/<int:pk>/cancel/", admin.OrderCancelView.as_view()),
    path("admin/orders/<int:pk>/refund/", admin.OrderRefundView.as_view()),
    path("admin/orders/<int:pk>/note/", admin.OrderNoteView.as_view()),
    path("admin/orders/<int:pk>/sale-plan/", admin.SalePlanView.as_view()),
    path("admin/orders/<int:pk>/complete/", admin.OrderCompleteView.as_view()),
    path("admin/settings/", admin.SettingsView.as_view(), name="webshop-settings"),
    path("admin/settings/instapay-qr/", admin.InstapayQrUploadView.as_view()),
    path("admin/health/", admin.HealthView.as_view()),
    path("admin/listings/", admin.ListingsView.as_view()),
    path("admin/listings/<int:product_id>/", admin.ListingDetailView.as_view()),
    path("admin/videos/", admin.VideosView.as_view()),
    path("admin/videos/<int:pk>/", admin.VideoDetailView.as_view()),
    path("admin/events/", admin.EventsView.as_view()),
    path("admin/events/<int:pk>/", admin.EventDetailView.as_view()),
    path("admin/events/<int:pk>/media/", admin.EventMediaView.as_view()),
    path("admin/events/<int:pk>/media/order/", admin.EventMediaOrderView.as_view()),
    path("admin/events/<int:pk>/media/<int:media_id>/", admin.EventMediaDetailView.as_view()),
    path("admin/swaps/", admin.SwapsView.as_view()),
    path("admin/swaps/<int:pk>/", admin.SwapDetailView.as_view()),
]
