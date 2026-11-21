"""The server's entry point on cPanel ("Setup Python App", which runs Phusion
Passenger): the app's startup file is this file, its entry point
``application``. See the README, "The server on cPanel"."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "cashier.settings")

from cashier.wsgi import application  # noqa: E402,F401
