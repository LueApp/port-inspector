#!/usr/bin/env bash
# Install portscope as a systemd *user* service.
#
# Pure Python standard library — no venv, no pip, no apt. This script only
# renders the systemd unit, enables it, and starts it.
#
# Idempotent: safe to re-run. Override defaults with env vars or the first arg:
#   ./install.sh 9000
#   PORTSCOPE_ALLOWED_ORIGINS="https://my.site" ./install.sh

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="${PYTHON:-python3}"

if [[ $# -gt 0 ]]; then
  PORTSCOPE_PORT="$1"
fi
PORTSCOPE_PORT="${PORTSCOPE_PORT:-8790}"
PORTSCOPE_HOST="${PORTSCOPE_HOST:-127.0.0.1}"
PORTSCOPE_PUBLIC_SITE="${PORTSCOPE_PUBLIC_SITE:-https://portscope.lue-app.com}"
PORTSCOPE_ALLOWED_ORIGINS="${PORTSCOPE_ALLOWED_ORIGINS:-$PORTSCOPE_PUBLIC_SITE,http://localhost:4321,http://127.0.0.1:4321}"

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mXX\033[0m %s\n' "$*" >&2; exit 1; }

# --- sanity checks ---------------------------------------------------------
if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  die "Run install.sh as your normal user, not root. portscope is a per-user service."
fi

if ! [[ "$PORTSCOPE_PORT" =~ ^[0-9]+$ ]] || (( PORTSCOPE_PORT < 1024 || PORTSCOPE_PORT > 65535 )); then
  die "PORTSCOPE_PORT must be 1024-65535. A systemd *user* service has no CAP_NET_BIND_SERVICE, so it cannot bind privileged ports below 1024. Example: ./install.sh 9000"
fi

PYTHON_BIN="$(command -v "$PYTHON" || true)"
[[ -n "$PYTHON_BIN" ]] || die "python3 not found. Install it first (e.g. sudo apt install python3)."

if ! "$PYTHON_BIN" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] >= (3,7) else 1)'; then
  die "portscope needs Python 3.7+. Found: $("$PYTHON_BIN" --version 2>&1)"
fi

# Confirm the package imports from this directory (catches a broken checkout).
if ! ( cd "$DIR" && "$PYTHON_BIN" -c 'import portscope' >/dev/null 2>&1 ); then
  die "Could not import the 'portscope' package from $DIR. Run install.sh from the repo root."
fi

command -v systemctl >/dev/null 2>&1 || die "systemctl not found. This installer targets systemd user services."

# --- render the unit -------------------------------------------------------
sed_replacement() { printf '%s' "$1" | sed 's/[&|\\]/\\&/g'; }

UNIT_DIR="$HOME/.config/systemd/user"
UNIT_FILE="$UNIT_DIR/portscope.service"
mkdir -p "$UNIT_DIR"

say "Writing $UNIT_FILE"
sed \
  -e "s|__PYTHON__|$(sed_replacement "$PYTHON_BIN")|g" \
  -e "s|__INSTALL_DIR__|$(sed_replacement "$DIR")|g" \
  -e "s|__PORTSCOPE_PORT__|$(sed_replacement "$PORTSCOPE_PORT")|g" \
  -e "s|__PORTSCOPE_PUBLIC_SITE__|$(sed_replacement "$PORTSCOPE_PUBLIC_SITE")|g" \
  -e "s|__PORTSCOPE_ALLOWED_ORIGINS__|$(sed_replacement "$PORTSCOPE_ALLOWED_ORIGINS")|g" \
  "$DIR/systemd/portscope.service" > "$UNIT_FILE"

# --- enable + start --------------------------------------------------------
say "Reloading systemd user units"
systemctl --user daemon-reload

say "Enabling and starting portscope.service on port $PORTSCOPE_PORT"
systemctl --user enable --now portscope.service

sleep 1
if systemctl --user is-active --quiet portscope.service; then
  say "portscope is running."
  say "Local agent:   http://$PORTSCOPE_HOST:$PORTSCOPE_PORT/api/health"
  say "Dashboard:     $PORTSCOPE_PUBLIC_SITE  (set 'Agent port' to $PORTSCOPE_PORT)"
  say "Allowed origins: $PORTSCOPE_ALLOWED_ORIGINS"
  say "Logs:          journalctl --user -u portscope -f"
else
  warn "portscope did not start. Inspect with:"
  warn "    systemctl --user status portscope.service"
  warn "    journalctl --user -u portscope -n 50 --no-pager"
  exit 1
fi

# Persist the user manager across logout so the service keeps running, and
# starts on boot, even without an active session.
if command -v loginctl >/dev/null 2>&1; then
  if ! loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q 'Linger=yes'; then
    say "Tip: 'sudo loginctl enable-linger $USER' keeps the agent running after logout."
  fi
fi
