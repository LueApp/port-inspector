"""Localhost-only JSON agent for portscope.

Pure stdlib HTTP server. Endpoints:

  GET /api/health  -> { ok, service: "portscope", version, public_site }
  GET /api/ports   -> { summary, listeners, free_suggestions, generated_at }

Read-only by construction: only GET and OPTIONS are handled; every other
method returns 405. There is no endpoint that runs a command or mutates state.

Run with:  python -m portscope.app
"""
from __future__ import annotations

import json
import logging
import signal
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import __version__
from . import config
from . import procscan

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s: %(message)s",
)
log = logging.getLogger("portscope")

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
        if origin and config.origin_allowed(origin):
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
                        "public_site": config.PUBLIC_SITE_URL,
                    }
                )
            elif path == "/api/ports":
                payload = procscan.scan(config.FREE_CANDIDATES, config.FREE_SUGGESTION_LIMIT)
                payload["generated_at"] = int(time.time())
                self._send_json(payload)
            elif path == "/":
                self._send_html(
                    _LOCAL_INDEX.format(
                        version=__version__,
                        public_site=config.PUBLIC_SITE_URL,
                        port=config.HTTP_PORT,
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


def main() -> int:
    server = ThreadingHTTPServer((config.HTTP_HOST, config.HTTP_PORT), Handler)
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
        config.HTTP_HOST,
        config.HTTP_PORT,
        ", ".join(sorted(config.ALLOWED_ORIGINS)) or "(none)",
        " + any loopback origin" if config.ALLOW_LOOPBACK_ORIGINS else "",
    )
    try:
        server.serve_forever()
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
