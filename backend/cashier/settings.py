"""Django settings for the Cashier / POS backend."""
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, False),
    ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    CORS_ALLOWED_ORIGINS=(list, ["http://localhost:5173"]),
    DEFAULT_COUNTRY_CODE=(str, ""),
)

# Read .env if present (local dev). In Docker the values come from the environment.
env_file = BASE_DIR / ".env"
if env_file.exists():
    environ.Env.read_env(env_file)

SECRET_KEY = env("SECRET_KEY", default="insecure-dev-key-change-me")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env("ALLOWED_HOSTS")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third party
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",
    "django_filters",
    # Local
    "apps.common",
    "apps.accounts",
    "apps.products",
    "apps.inventory",
    "apps.customers",
    "apps.suppliers",
    "apps.orders",
    "apps.shifts",
    "apps.purchasing",
    "apps.whatsapp",
    "apps.reports",
    "apps.hqsync",
    "apps.webshop",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "cashier.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "cashier.wsgi.application"

DATABASES = {
    "default": env.db("DATABASE_URL", default=f"sqlite:///{BASE_DIR / 'db.sqlite3'}"),
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

AUTH_USER_MODEL = "accounts.User"

# --- Django REST Framework ---
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "apps.common.pagination.Pagination",
    "PAGE_SIZE": 25,
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(hours=8),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": False,
}

# --- Website (apps.webshop) ---
# The storefront (fatheetkheer.com) and the orders admin
# (orders.fatheetkheer.com) are static sites that call this server's API.
SHOP_SITE_URL = env("SHOP_SITE_URL", default="http://localhost:5180").rstrip("/")
SHOP_ORDERS_URL = env("SHOP_ORDERS_URL", default="http://localhost:5181").rstrip("/")
# Stock location web orders are sold from. Blank: the default storage.
SHOP_STORAGE_ID = env.int("SHOP_STORAGE_ID", default=0) or None
# Till whose open shift takes cash from web orders. Blank: any open shift.
SHOP_TERMINAL = env("SHOP_TERMINAL", default="")
# The shop's own clock, for "today" on the orders board (the server runs on UTC).
SHOP_TIME_ZONE = env("SHOP_TIME_ZONE", default="Africa/Cairo")
# Largest video an admin may upload, in MB.
SHOP_VIDEO_MAX_MB = env.int("SHOP_VIDEO_MAX_MB", default=80)
# Proxies or tunnels in front of this server (Cloudflare Tunnel = 1). Decides
# which address the website's rate limits trust.
SHOP_NUM_PROXIES = env.int("SHOP_NUM_PROXIES", default=0)

# Uploaded website videos and their posters.
MEDIA_URL = "/media/"
MEDIA_ROOT = Path(env("MEDIA_ROOT", default=str(BASE_DIR / "media")))

# --- CORS ---
# The two websites are always allowed, on top of the till origins.
CORS_ALLOWED_ORIGINS = list(dict.fromkeys(env("CORS_ALLOWED_ORIGINS") + [SHOP_SITE_URL, SHOP_ORDERS_URL]))
CORS_ALLOW_CREDENTIALS = True

# --- WhatsApp sidecar ---
WHATSAPP_SERVICE_URL = env("WHATSAPP_SERVICE_URL", default="http://localhost:3001")
WHATSAPP_SHARED_SECRET = env("WHATSAPP_SHARED_SECRET", default="")
DEFAULT_COUNTRY_CODE = env("DEFAULT_COUNTRY_CODE")

# --- Branch identity + HQ (head office) reporting ---
# Each POS installation is one branch. These identify it to the central HQ.
BRANCH_CODE = env("BRANCH_CODE", default="BR001")
BRANCH_NAME = env("BRANCH_NAME", default="Main Branch")
HQ_API_URL = env("HQ_API_URL", default="")  # e.g. http://hq.company.local:9000
HQ_API_KEY = env("HQ_API_KEY", default="")
# Close-of-business time (24h "HH:MM", local TIME_ZONE) the scheduler sends the daily report.
REPORT_TIME = env("REPORT_TIME", default="22:00")

# --- Till controls ---
# Refuse any sale (not just cash) when no shift is open. Off by default so a
# card-only terminal can still trade, but recommended for a cash store.
REQUIRE_OPEN_SHIFT = env.bool("REQUIRE_OPEN_SHIFT", default=False)
# A discount above either threshold needs a manager PIN at the till.
# Set both to None to let cashiers discount freely.
DISCOUNT_OVERRIDE_AMOUNT = Decimal(env("DISCOUNT_OVERRIDE_AMOUNT", default="50"))
DISCOUNT_OVERRIDE_PERCENT = Decimal(env("DISCOUNT_OVERRIDE_PERCENT", default="20"))
