#!/usr/bin/env python3
"""portscope — single-file local read-only port-occupation agent.

Self-contained Python standard-library agent. Reads Linux
``/proc/net/{tcp,tcp6,udp,udp6}`` and serves a localhost-only JSON API that the
public portscope dashboard fetches directly from the browser. No third-party
dependencies, no install step — ONE file you run directly:

    python3 agent.py serve --host 127.0.0.1 --port 8790 \\
        --allow-origin https://portscope.lue-app.com

This is the bundled equivalent of the ``portscope`` package's ``serve`` command,
built so a supervisor (e.g. web2local) can fetch a single file and run it with
flags alone — no PYTHONPATH, no working directory, no environment variables.

Read-only by construction: only GET/HEAD/OPTIONS are served; every mutating
method returns 405. Nothing here executes commands or writes to disk. The
server binds 127.0.0.1 by default and only echoes CORS headers back to a
configured browser-origin allowlist, so no data leaves the machine.
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import logging
import os
import pwd
import re
import signal
import socket
import sys
import time
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Iterable
from urllib.parse import urlsplit

__version__ = "0.1.0"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s: %(message)s",
)
log = logging.getLogger("portscope")


# =========================================================================
# Configuration
# -------------------------------------------------------------------------
# Values live as module globals and are populated by configure() from
# PORTSCOPE_* environment variables. main() translates CLI flags into those
# env vars first, so everything resolves AFTER argv is parsed (a single file
# has no import-time hook to set env before config runs).
# =========================================================================
HTTP_HOST = "127.0.0.1"
HTTP_PORT = 8790
PUBLIC_SITE_URL = "https://portscope.lue-app.com"
ALLOWED_ORIGINS: set[str] = set()
ALLOW_LOOPBACK_ORIGINS = True
FREE_SUGGESTION_LIMIT = 10
FREE_CANDIDATES: list[int] = []

# Candidate pool for free-port suggestions: common dev/server ports. We return
# the ones NOT currently bound. Override with PORTSCOPE_FREE_CANDIDATES.
_DEFAULT_FREE_CANDIDATES = (
    "3000,3001,4000,4173,4200,4321,5000,5173,5500,"
    "8000,8001,8080,8081,8090,8443,8787,8888,9000,9090,9229"
)
_LOOPBACK_HOSTNAMES = {"localhost"}


def _truthy(value: str) -> bool:
    return str(value).strip().lower() not in ("0", "false", "no", "off", "")


def _env(name: str, default: str) -> str:
    return os.environ.get(f"PORTSCOPE_{name}", default)


def _env_int(name: str, default: int) -> int:
    """Parse an integer env var, falling back to the default on a non-numeric
    value instead of crashing configure() — mirrors the lenient handling of
    FREE_CANDIDATES below."""
    raw = _env(name, str(default)).strip()
    try:
        return int(raw)
    except ValueError:
        log.warning("PORTSCOPE_%s=%r is not an integer; using %d", name, raw, default)
        return default


def configure() -> None:
    """Read PORTSCOPE_* env vars into the module globals. Call once, after
    main() has translated CLI flags into those env vars."""
    global HTTP_HOST, HTTP_PORT, PUBLIC_SITE_URL, ALLOWED_ORIGINS
    global ALLOW_LOOPBACK_ORIGINS, FREE_SUGGESTION_LIMIT, FREE_CANDIDATES

    # Default to loopback only. Binding to anything else would expose your
    # machine's full listening-socket inventory to the network — don't.
    HTTP_HOST = _env("HOST", "127.0.0.1")
    HTTP_PORT = _env_int("PORT", 8790)
    PUBLIC_SITE_URL = _env("PUBLIC_SITE", "https://portscope.lue-app.com").rstrip("/")

    # The public dashboard reads this agent from the browser, so the agent must
    # echo CORS back to the page origin. Keep this allowlist tight: any listed
    # origin can read everything listening on this machine while the agent runs.
    default_allowed = ",".join(
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
        for origin in _env("ALLOWED_ORIGINS", default_allowed).split(",")
        if origin.strip()
    }

    # Also accept any loopback origin (http://localhost:*, http://127.0.0.1:*,
    # http://[::1]:*) without listing each dev port. Anything that can serve a
    # page on your localhost could already read /proc directly, so this removes
    # per-port friction at no real cost. Set PORTSCOPE_ALLOW_LOOPBACK_ORIGINS=0
    # to require an exact allowlist match.
    ALLOW_LOOPBACK_ORIGINS = _truthy(_env("ALLOW_LOOPBACK_ORIGINS", "1"))

    FREE_SUGGESTION_LIMIT = _env_int("FREE_SUGGESTION_LIMIT", 10)
    FREE_CANDIDATES = [
        int(p)
        for p in _env("FREE_CANDIDATES", _DEFAULT_FREE_CANDIDATES).split(",")
        if p.strip().isdigit()
    ]


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


# =========================================================================
# /proc socket inspection (read-only)
# -------------------------------------------------------------------------
# 1. Parse /proc/net/{tcp,tcp6} for LISTEN sockets and /proc/net/{udp,udp6}
#    for bound (unconnected) datagram sockets.
# 2. Walk /proc/<pid>/fd/* once to map socket inode -> pid.
# 3. Enrich with process name, command line, owning user, container hint.
# We can only read fds for processes the agent user owns (or all, as root), so
# PID resolution is best-effort: address/port/uid always resolve, pid may not.
# =========================================================================

# Linux TCP state codes (net/tcp_states.h). We only care about LISTEN.
_TCP_LISTEN = "0A"
# Unconnected UDP sockets report TCP_CLOSE (07) as their "state".
_UDP_CLOSE = "07"

_PROC = "/proc"

# Matches the target of a /proc/<pid>/fd/<n> symlink that points at a socket.
_SOCKET_LINK_RE = re.compile(r"socket:\[(\d+)\]")

# Container-id hints inside a cgroup path. Covers cgroup v1 and v2 layouts for
# docker, containerd, podman/libpod, and CRI.
_CONTAINER_RES = (
    re.compile(r"docker[-/]([0-9a-f]{12,64})"),
    re.compile(r"libpod[-/]([0-9a-f]{12,64})"),
    re.compile(r"crio[-/]([0-9a-f]{12,64})"),
    re.compile(r"containerd.*?[-/]([0-9a-f]{12,64})"),
    # Generic kubepods / cri-containerd cgroup ending in a 64-hex id.
    re.compile(r"[-/]([0-9a-f]{64})(?:\.scope)?$"),
)


@dataclass
class Socket:
    protocol: str          # tcp | tcp6 | udp | udp6
    family: str            # ipv4 | ipv6
    address: str           # textual local address
    port: int
    scope: str             # loopback | all interfaces | private | multicast | specific
    exposed: bool          # reachable beyond this host (all-interfaces or global)
    all_interfaces: bool    # bound to 0.0.0.0 / ::
    uid: int
    user: str | None
    inode: int
    pid: int | None = None
    process: str | None = None
    command: str | None = None
    container_id: str | None = None

    def as_dict(self) -> dict:
        return {
            "protocol": self.protocol,
            "family": self.family,
            "address": self.address,
            "port": self.port,
            "scope": self.scope,
            "exposed": self.exposed,
            "all_interfaces": self.all_interfaces,
            "uid": self.uid,
            "user": self.user,
            "pid": self.pid,
            "process": self.process,
            "command": self.command,
            "container_id": self.container_id,
        }


# --- address parsing -------------------------------------------------------

def _parse_ipv4(hex_addr: str) -> str:
    """``0100007F`` -> ``127.0.0.1`` (the 4 bytes are little-endian)."""
    raw = bytes.fromhex(hex_addr)
    return socket.inet_ntop(socket.AF_INET, raw[::-1])


def _parse_ipv6(hex_addr: str) -> str:
    """32-hex /proc IPv6 -> textual.

    The kernel writes the 16 bytes as four host-byte-order (little-endian on
    x86) 32-bit words, so we reverse each 4-byte group before formatting.
    """
    raw = bytes.fromhex(hex_addr)
    reordered = bytearray(16)
    for i in range(4):
        word = raw[i * 4 : i * 4 + 4]
        reordered[i * 4 : i * 4 + 4] = word[::-1]
    return socket.inet_ntop(socket.AF_INET6, bytes(reordered))


def _parse_addr(token: str, family: str) -> tuple[str, int]:
    hex_addr, _, hex_port = token.partition(":")
    port = int(hex_port, 16)
    if family == "ipv6":
        return _parse_ipv6(hex_addr), port
    return _parse_ipv4(hex_addr), port


def classify_scope(address: str) -> tuple[str, bool, bool]:
    """Return (scope, all_interfaces, exposed) for a textual local address.

    - all_interfaces: bound to the unspecified address (0.0.0.0 / ::).
    - exposed: reachable from beyond this host — either all-interfaces or a
      globally-routable address. Loopback and private are not exposed.
    """
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return "specific", False, False

    if ip.is_unspecified:
        return "all interfaces", True, True
    if ip.is_loopback:
        return "loopback", False, False
    if ip.is_multicast:
        # is_global is True for multicast, but a multicast group is only
        # reachable by joined members — not a unicast-exposed listener.
        return "multicast", False, False
    if ip.is_private or ip.is_link_local:
        return "private", False, False
    # A concrete, globally-routable address: a specific bind still reachable
    # off-box.
    return "specific", False, bool(ip.is_global)


# --- /proc/net parsing -----------------------------------------------------

def _read_proc_net(path: str, protocol: str, family: str, want_state: str) -> list[Socket]:
    sockets: list[Socket] = []
    try:
        with open(path, "r") as fh:
            lines = fh.readlines()
    except (FileNotFoundError, PermissionError, OSError):
        return sockets

    for line in lines[1:]:  # skip header
        parts = line.split()
        if len(parts) < 10:
            continue
        local = parts[1]
        rem = parts[2]
        state = parts[3]
        if state != want_state:
            continue
        # UDP "bound server" heuristic: no connected peer (remote port 0).
        # This drops outbound UDP client sockets while keeping listeners.
        if protocol.startswith("udp"):
            _, _, rem_port_hex = rem.partition(":")
            if int(rem_port_hex, 16) != 0:
                continue
        try:
            uid = int(parts[7])
            inode = int(parts[9])
            address, port = _parse_addr(local, family)
        except (ValueError, IndexError):
            continue
        # A bound UDP socket always has a non-zero local port; skip the
        # ephemeral/unbound ones.
        if protocol.startswith("udp") and port == 0:
            continue
        scope, all_ifaces, exposed = classify_scope(address)
        sockets.append(
            Socket(
                protocol=protocol,
                family=family,
                address=address,
                port=port,
                scope=scope,
                exposed=exposed,
                all_interfaces=all_ifaces,
                uid=uid,
                user=_username(uid),
                inode=inode,
            )
        )
    return sockets


def _username(uid: int) -> str | None:
    try:
        return pwd.getpwuid(uid).pw_name
    except (KeyError, OSError):
        return str(uid)


# --- inode -> pid mapping --------------------------------------------------

def _build_inode_pid_map(target_inodes: set[int]) -> dict[int, int]:
    """Walk /proc/<pid>/fd once, returning inode -> pid for sockets we care
    about. Unreadable processes (other users, without root) are skipped."""
    result: dict[int, int] = {}
    if not target_inodes:
        return result
    try:
        pids = [name for name in os.listdir(_PROC) if name.isdigit()]
    except OSError:
        return result

    for pid_s in pids:
        fd_dir = f"{_PROC}/{pid_s}/fd"
        try:
            fds = os.listdir(fd_dir)
        except (FileNotFoundError, PermissionError, NotADirectoryError, OSError):
            continue
        pid = int(pid_s)
        for fd in fds:
            try:
                target = os.readlink(f"{fd_dir}/{fd}")
            except OSError:
                continue
            m = _SOCKET_LINK_RE.fullmatch(target)
            if not m:
                continue
            inode = int(m.group(1))
            if inode in target_inodes and inode not in result:
                result[inode] = pid
        # Early exit once every target inode is mapped.
        if len(result) >= len(target_inodes):
            break
    return result


def _read_first_line(path: str) -> str | None:
    try:
        with open(path, "r") as fh:
            return fh.readline().strip()
    except OSError:
        return None


def _read_cmdline(pid: int) -> str | None:
    try:
        with open(f"{_PROC}/{pid}/cmdline", "rb") as fh:
            raw = fh.read()
    except OSError:
        return None
    if not raw:
        return None
    # cmdline is NUL-separated; trailing NUL produces an empty final field.
    parts = [p.decode("utf-8", "replace") for p in raw.split(b"\x00") if p]
    return " ".join(parts) if parts else None


def _container_hint(pid: int) -> str | None:
    try:
        with open(f"{_PROC}/{pid}/cgroup", "r") as fh:
            data = fh.read()
    except OSError:
        return None
    for line in data.splitlines():
        for rx in _CONTAINER_RES:
            m = rx.search(line)
            if m:
                return m.group(1)[:12]
    return None


def _enrich(sockets: Iterable[Socket]) -> None:
    socks = list(sockets)
    inode_pid = _build_inode_pid_map({s.inode for s in socks})
    # Cache per-pid metadata so two sockets from one process hit /proc once.
    meta_cache: dict[int, tuple[str | None, str | None, str | None]] = {}
    for s in socks:
        pid = inode_pid.get(s.inode)
        if pid is None:
            continue
        s.pid = pid
        if pid not in meta_cache:
            meta_cache[pid] = (
                _read_first_line(f"{_PROC}/{pid}/comm"),
                _read_cmdline(pid),
                _container_hint(pid),
            )
        s.process, s.command, s.container_id = meta_cache[pid]


# --- free-port suggestions -------------------------------------------------

def _free_suggestions(used_ports: set[int], candidates: list[int], limit: int) -> list[int]:
    out = []
    for port in candidates:
        if port not in used_ports:
            out.append(port)
            if len(out) >= limit:
                break
    return out


def scan(free_candidates: list[int], free_limit: int) -> dict:
    """Collect all listening/bound sockets and return the API payload body
    (without ``generated_at``, which the server stamps)."""
    sockets: list[Socket] = []
    sockets += _read_proc_net(f"{_PROC}/net/tcp", "tcp", "ipv4", _TCP_LISTEN)
    sockets += _read_proc_net(f"{_PROC}/net/tcp6", "tcp6", "ipv6", _TCP_LISTEN)
    sockets += _read_proc_net(f"{_PROC}/net/udp", "udp", "ipv4", _UDP_CLOSE)
    sockets += _read_proc_net(f"{_PROC}/net/udp6", "udp6", "ipv6", _UDP_CLOSE)

    _enrich(sockets)

    # Stable, useful order: externally-exposed first, then by port.
    sockets.sort(key=lambda s: (not s.exposed, s.port, s.protocol))

    listeners = [s.as_dict() for s in sockets]
    used_ports = {s.port for s in sockets}
    pids = {s.pid for s in sockets if s.pid is not None}

    summary = {
        "total_listeners": len(sockets),
        "unique_ports": len(used_ports),
        "process_count": len(pids),
        "tcp_count": sum(1 for s in sockets if s.protocol.startswith("tcp")),
        "udp_count": sum(1 for s in sockets if s.protocol.startswith("udp")),
        "all_interfaces_count": sum(1 for s in sockets if s.all_interfaces),
        "exposed_count": sum(1 for s in sockets if s.exposed),
        "unresolved_pid_count": sum(1 for s in sockets if s.pid is None),
    }

    return {
        "summary": summary,
        "listeners": listeners,
        "free_suggestions": _free_suggestions(used_ports, free_candidates, free_limit),
    }


# =========================================================================
# HTTP agent (localhost-only JSON)
# -------------------------------------------------------------------------
#   GET /api/health -> { ok, service: "portscope", version, public_site }
#   GET /api/ports  -> { summary, listeners, free_suggestions, generated_at }
# Only GET/HEAD/OPTIONS are handled; every mutating method returns 405.
# =========================================================================

# Minimal local fallback page served at "/". The real UI is the public static
# site; this just confirms the agent is alive when opened directly.
_LOCAL_INDEX = """<!doctype html>
<meta charset="utf-8">
<title>portscope agent</title>
<style>
  body{{font:14px/1.6 system-ui,sans-serif;max-width:42rem;margin:3rem auto;padding:0 1rem;color:#1c2230}}
  code{{background:#eef1f6;padding:.1rem .35rem;border-radius:4px}}
  a{{color:#2563eb}}
</style>
<h1>portscope agent is running</h1>
<p>This is the local read-only agent (v{version}). It exposes JSON only:</p>
<ul>
  <li><a href="/api/health">/api/health</a></li>
  <li><a href="/api/ports">/api/ports</a></li>
</ul>
<p>Open the dashboard at <a href="{public_site}">{public_site}</a> and point its
&ldquo;Local port&rdquo; field at <code>{port}</code>.</p>
"""


class Handler(BaseHTTPRequestHandler):
    server_version = f"portscope/{__version__}"
    protocol_version = "HTTP/1.1"

    # --- helpers -----------------------------------------------------------

    def _cors(self) -> None:
        """Echo CORS + Private Network Access headers for allowed origins only."""
        origin = (self.headers.get("Origin") or "").rstrip("/")
        if origin and origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "600")
            self.send_header("Vary", "Origin")
            # Chrome Private Network Access: a public/secure page fetching this
            # private (127.0.0.1) address sends this on preflight.
            if self.headers.get("Access-Control-Request-Private-Network") == "true":
                self.send_header("Access-Control-Allow-Private-Network", "true")

    def _send_json(self, payload: dict, status: int = 200, extra_headers: dict | None = None) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for name, value in (extra_headers or {}).items():
            self.send_header(name, value)
        self._cors()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _drain_body(self) -> None:
        """Consume any request body so an unread POST/PUT body can't desync the
        next request on a kept-alive HTTP/1.1 connection."""
        try:
            remaining = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            remaining = 0
        while remaining > 0:
            chunk = self.rfile.read(min(remaining, 65536))
            if not chunk:
                break
            remaining -= len(chunk)

    def _send_html(self, html: str, status: int = 200) -> None:
        body = html.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    # --- methods -----------------------------------------------------------

    def do_OPTIONS(self) -> None:
        # CORS preflight (incl. Private Network Access). Always 204.
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        try:
            if path == "/api/health":
                self._send_json(
                    {
                        "ok": True,
                        "service": "portscope",
                        "version": __version__,
                        "public_site": PUBLIC_SITE_URL,
                    }
                )
            elif path == "/api/ports":
                payload = scan(FREE_CANDIDATES, FREE_SUGGESTION_LIMIT)
                payload["generated_at"] = int(time.time())
                self._send_json(payload)
            elif path == "/":
                self._send_html(
                    _LOCAL_INDEX.format(
                        version=__version__,
                        public_site=PUBLIC_SITE_URL,
                        port=HTTP_PORT,
                    )
                )
            elif path.startswith("/api/"):
                self._send_json({"error": "not found", "path": path}, status=404)
            else:
                self._send_html("<h1>404</h1>", status=404)
        except Exception:  # never leak a stack trace to the client
            log.exception("error handling GET %s", path)
            self._send_json({"error": "internal error"}, status=500)

    def do_HEAD(self) -> None:
        self.do_GET()

    def handle(self) -> None:
        # Browsers poll on keep-alive connections and reset idle ones; a client
        # may also abort an in-flight fetch. Both surface as a connection error
        # while the handler is blocked reading the next request line, which
        # http.server would otherwise dump as a noisy traceback. They are
        # benign — swallow them and let the thread end quietly.
        try:
            super().handle()
        except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError, TimeoutError):
            self.close_connection = True

    def _reject(self) -> None:
        # Read-only agent: refuse every mutating method. Drain the body and
        # close the connection so an unread body can't desync a kept-alive one.
        self._drain_body()
        self.close_connection = True
        self._send_json(
            {"error": "method not allowed (read-only agent)"},
            status=405,
            extra_headers={"Allow": "GET, HEAD, OPTIONS", "Connection": "close"},
        )

    do_POST = do_PUT = do_DELETE = do_PATCH = _reject

    def log_message(self, fmt: str, *args) -> None:  # quieter default logging
        log.info("%s - %s", self.address_string(), fmt % args)


def run_server() -> int:
    try:
        server = ThreadingHTTPServer((HTTP_HOST, HTTP_PORT), Handler)
    except PermissionError:
        # Unprivileged processes can't bind <1024. Surface it on one line so a
        # supervisor (web2local's spawn log) shows a cause, not a traceback that
        # looks like a silent death.
        log.error(
            "cannot bind %s:%d - ports below 1024 need root or CAP_NET_BIND_SERVICE; "
            "pick a port >= 1024 (e.g. 8790).",
            HTTP_HOST, HTTP_PORT,
        )
        return 2
    except OSError as exc:
        log.error("cannot bind %s:%d - %s", HTTP_HOST, HTTP_PORT, exc)
        return 2
    server.daemon_threads = True

    def _shutdown(_sig=None, _frm=None):
        log.info("shutdown signal received")
        # shutdown() must run off the serving thread.
        import threading

        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    log.info(
        "portscope %s listening on http://%s:%d (allowed origins: %s%s)",
        __version__,
        HTTP_HOST,
        HTTP_PORT,
        ", ".join(sorted(ALLOWED_ORIGINS)) or "(none)",
        " + any loopback origin" if ALLOW_LOOPBACK_ORIGINS else "",
    )
    try:
        server.serve_forever()
    finally:
        server.server_close()
    return 0


# =========================================================================
# CLI front-end
# -------------------------------------------------------------------------
# Flags map onto the PORTSCOPE_* env vars configure() reads, so a supervisor
# (web2local, systemd, a shell) configures the agent with argv alone:
#
#     python3 agent.py serve --port 8790 --host 127.0.0.1 \
#         --allow-origin https://portscope.lue-app.com
# =========================================================================
_SUBCOMMANDS = {"serve"}


def _add_serve_args(p: argparse.ArgumentParser) -> None:
    p.add_argument(
        "--port", type=int, metavar="N",
        help="TCP port to bind (sets PORTSCOPE_PORT). Default 8790.",
    )
    p.add_argument(
        "--host", metavar="ADDR",
        help="bind address (sets PORTSCOPE_HOST). Default 127.0.0.1 — keep it on loopback.",
    )
    p.add_argument(
        "--allow-origin", action="append", default=[], metavar="ORIGIN[,ORIGIN...]",
        help="browser origin(s) allowed to read the agent (sets "
             "PORTSCOPE_ALLOWED_ORIGINS). Repeatable; commas allowed.",
    )
    p.add_argument(
        "--public-site", metavar="URL",
        help="deployed dashboard origin (sets PORTSCOPE_PUBLIC_SITE).",
    )


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="agent.py",
        description="portscope — local read-only port-occupation agent (single file).",
    )
    p.add_argument("--version", action="version", version=f"portscope {__version__}")
    sub = p.add_subparsers(dest="cmd")
    serve = sub.add_parser(
        "serve",
        help="run the read-only agent in the foreground (default).",
        description="Run the portscope agent in the foreground. Accepts flags so a "
                    "supervisor can configure it without environment variables.",
    )
    _add_serve_args(serve)
    return p


def _serve(args: argparse.Namespace) -> int:
    if args.port is not None:
        if not (1 <= args.port <= 65535):
            print(f"portscope: --port must be 1-65535, got {args.port}", file=sys.stderr)
            return 2
        os.environ["PORTSCOPE_PORT"] = str(args.port)
    if args.host:
        os.environ["PORTSCOPE_HOST"] = args.host
    if args.public_site:
        os.environ["PORTSCOPE_PUBLIC_SITE"] = args.public_site

    # --allow-origin is repeatable and each value may itself be comma-separated.
    # Flatten, de-dupe (preserving order), and set the allowlist override.
    origins: list[str] = []
    for chunk in args.allow_origin:
        origins.extend(o.strip() for o in chunk.split(",") if o.strip())
    if origins:
        os.environ["PORTSCOPE_ALLOWED_ORIGINS"] = ",".join(dict.fromkeys(origins))

    # Resolve config from the env we just set, then serve.
    configure()
    return run_server()


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)

    # Default to `serve` so a bare run — or `agent.py --port 9000` — works.
    # Leave --version/-h for the top-level parser.
    if not argv:
        argv = ["serve"]
    elif argv[0] not in _SUBCOMMANDS and argv[0] not in ("-h", "--help", "--version"):
        if argv[0].startswith("-"):
            argv = ["serve"] + argv

    args = _build_parser().parse_args(argv)
    if (getattr(args, "cmd", None) or "serve") == "serve":
        return _serve(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
