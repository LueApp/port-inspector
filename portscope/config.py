"""Runtime configuration. Override via ``PORTSCOPE_*`` environment variables.

Everything here is read once at import time. The systemd user unit and
``install.sh`` set these variables; running ``python -m portscope.app`` with
no env vars uses the localhost-only defaults below.
"""
from __future__ import annotations

import ipaddress
import os
from urllib.parse import urlsplit

from . import __version__

VERSION = __version__


def _truthy(value: str) -> bool:
    return str(value).strip().lower() not in ("0", "false", "no", "off", "")


def _env(name: str, default: str) -> str:
    return os.environ.get(f"PORTSCOPE_{name}", default)


# --- HTTP bind -------------------------------------------------------------
# Default to loopback only. Binding to anything else would expose your
# machine's full listening-socket inventory to the network — don't.
HTTP_HOST = _env("HOST", "127.0.0.1")
HTTP_PORT = int(_env("PORT", "8790"))

# --- Public web UI / CORS --------------------------------------------------
# The public static dashboard reads this agent from the user's browser, so
# the agent must echo CORS + Private Network Access headers back to the page
# origin. Keep this allowlist tight: any listed origin can read the full list
# of what's listening on this machine while the agent is running.
PUBLIC_SITE_URL = _env("PUBLIC_SITE", "https://portscope.lue-app.com").rstrip("/")

_DEFAULT_ALLOWED_ORIGINS = ",".join(
    [
        PUBLIC_SITE_URL,
        "http://localhost:4321",
        "http://127.0.0.1:4321",
        "http://localhost:8788",
        "http://127.0.0.1:8788",
        # The agent's own origin, so the built-in local fallback page works.
        f"http://127.0.0.1:{HTTP_PORT}",
        f"http://localhost:{HTTP_PORT}",
    ]
)

ALLOWED_ORIGINS = {
    origin.strip().rstrip("/")
    for origin in _env("ALLOWED_ORIGINS", _DEFAULT_ALLOWED_ORIGINS).split(",")
    if origin.strip()
}

# Also accept any loopback origin (http://localhost:*, http://127.0.0.1:*,
# http://[::1]:*) without listing each dev port. The agent is loopback-only,
# and anything that can serve a page on your machine's localhost could already
# read /proc directly — so this removes per-port friction at no real cost.
# Set PORTSCOPE_ALLOW_LOOPBACK_ORIGINS=0 to require an exact allowlist match.
ALLOW_LOOPBACK_ORIGINS = _truthy(_env("ALLOW_LOOPBACK_ORIGINS", "1"))

_LOOPBACK_HOSTNAMES = {"localhost"}


def origin_allowed(origin: str) -> bool:
    """True if this browser Origin may read the agent's JSON."""
    origin = (origin or "").rstrip("/")
    if not origin:
        return False
    if origin in ALLOWED_ORIGINS:
        return True
    if ALLOW_LOOPBACK_ORIGINS:
        try:
            parts = urlsplit(origin)
        except ValueError:
            return False
        if parts.scheme not in ("http", "https"):
            return False
        host = parts.hostname or ""
        if host in _LOOPBACK_HOSTNAMES:
            return True
        try:
            return ipaddress.ip_address(host).is_loopback
        except ValueError:
            return False
    return False

# --- Scan tuning -----------------------------------------------------------
# How many free-port suggestions to return at most.
FREE_SUGGESTION_LIMIT = int(_env("FREE_SUGGESTION_LIMIT", "10"))

# Candidate pool for free-port suggestions: common dev/server ports. We return
# the ones from this list that are NOT currently bound. Override with a
# comma-separated list to tailor it to your stack.
_DEFAULT_FREE_CANDIDATES = (
    "3000,3001,4000,4173,4200,4321,5000,5173,5500,"
    "8000,8001,8080,8081,8090,8443,8787,8888,9000,9090,9229"
)
FREE_CANDIDATES = [
    int(p)
    for p in _env("FREE_CANDIDATES", _DEFAULT_FREE_CANDIDATES).split(",")
    if p.strip().isdigit()
]
