#!/usr/bin/env python3
"""Smoke tests for the portscope agent. Pure stdlib, no network egress.

The agent is the single self-contained file ``site/agent.py`` — the same file
web2local deploys + runs. These tests load it by path and exercise address
parsing, scope classification, ``/proc/net`` parsing, container hints,
free-port suggestions, a live scan, the HTTP API, and the CLI front-end — plus
a drift guard that the agent's sha256 matches the hash the dashboard pins in
``site/app.js`` (web2local's ``/deploy`` rejects a mismatch).

Run:  python3 smoke_test.py
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

REPO = os.path.dirname(os.path.abspath(__file__))
AGENT_PY = os.path.join(REPO, "site", "agent.py")
APP_JS = os.path.join(REPO, "site", "app.js")


def _load_agent():
    """Load site/agent.py as a module (its `if __name__ == '__main__'` guard
    keeps it from serving on import)."""
    spec = importlib.util.spec_from_file_location("portscope_agent", AGENT_PY)
    mod = importlib.util.module_from_spec(spec)
    # Register before exec so @dataclass / typing can resolve the module's own
    # namespace (Python 3.14 looks it up via sys.modules during class build).
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


agent = _load_agent()
agent.configure()  # populate the config globals from defaults (no PORTSCOPE_* env)


class AddressParsing(unittest.TestCase):
    def test_ipv4(self):
        self.assertEqual(agent._parse_ipv4("0100007F"), "127.0.0.1")
        self.assertEqual(agent._parse_ipv4("00000000"), "0.0.0.0")
        self.assertEqual(agent._parse_ipv4("0101A8C0"), "192.168.1.1")

    def test_ipv6(self):
        self.assertEqual(agent._parse_ipv6("0" * 32), "::")
        self.assertEqual(
            agent._parse_ipv6("00000000000000000000000001000000"), "::1"
        )

    def test_addr_port(self):
        addr, port = agent._parse_addr("0100007F:1F90", "ipv4")
        self.assertEqual((addr, port), ("127.0.0.1", 8080))


class ScopeClassification(unittest.TestCase):
    def test_scopes(self):
        cases = {
            "0.0.0.0": ("all interfaces", True, True),
            "::": ("all interfaces", True, True),
            "127.0.0.1": ("loopback", False, False),
            "::1": ("loopback", False, False),
            "192.168.1.5": ("private", False, False),
            "10.0.0.1": ("private", False, False),
            "8.8.8.8": ("specific", False, True),
            "224.0.0.1": ("multicast", False, False),
            "ff02::1": ("multicast", False, False),
        }
        for addr, expected in cases.items():
            self.assertEqual(agent.classify_scope(addr), expected, addr)


class ProcNetParsing(unittest.TestCase):
    def test_listen_filtering(self):
        # One LISTEN row (state 0A) and one ESTABLISHED row (state 01).
        content = (
            "  sl  local_address rem_address   st ... inode\n"
            "   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000  0 99001 1 0 100 0 0 10 0\n"
            "   1: 0100007F:9999 0100007F:1234 01 00000000:00000000 00:00000000 00000000  1000  0 99002 1 0 100 0 0 10 0\n"
        )
        with tempfile.NamedTemporaryFile("w", suffix=".tcp", delete=False) as fh:
            fh.write(content)
            path = fh.name
        socks = agent._read_proc_net(path, "tcp", "ipv4", agent._TCP_LISTEN)
        self.assertEqual(len(socks), 1)
        self.assertEqual(socks[0].port, 8080)
        self.assertEqual(socks[0].address, "127.0.0.1")
        self.assertEqual(socks[0].scope, "loopback")
        self.assertEqual(socks[0].uid, 1000)
        self.assertEqual(socks[0].inode, 99001)

    def test_udp_drops_connected(self):
        # Bound UDP (rem port 0) kept; connected UDP (rem port != 0) dropped.
        content = (
            "header\n"
            "   0: 00000000:14E9 00000000:0000 07 0 0 0 0 0 42001 1 0 100\n"
            "   1: 0100007F:CAFE 08080808:0035 07 0 0 0 0 0 42002 1 0 100\n"
        )
        with tempfile.NamedTemporaryFile("w", suffix=".udp", delete=False) as fh:
            fh.write(content)
            path = fh.name
        socks = agent._read_proc_net(path, "udp", "ipv4", agent._UDP_CLOSE)
        self.assertEqual([s.port for s in socks], [5353])
        self.assertEqual(socks[0].scope, "all interfaces")


class ContainerHint(unittest.TestCase):
    def test_regexes(self):
        cid = "a" * 64
        samples = [
            f"0::/system.slice/docker-{cid}.scope",
            f"12:cpu:/docker/{cid}",
            f"0::/machine.slice/libpod-{cid}.scope",
        ]
        for line in samples:
            hit = None
            for rx in agent._CONTAINER_RES:
                m = rx.search(line)
                if m:
                    hit = m.group(1)[:12]
                    break
            self.assertEqual(hit, "a" * 12, line)

    def test_no_false_positive(self):
        line = "0::/user.slice/user-1000.slice/session-3.scope"
        self.assertFalse(any(rx.search(line) for rx in agent._CONTAINER_RES))


class FreeSuggestions(unittest.TestCase):
    def test_excludes_used(self):
        out = agent._free_suggestions({3000, 8080}, [3000, 3001, 8080, 9000], 10)
        self.assertEqual(out, [3001, 9000])

    def test_limit(self):
        out = agent._free_suggestions(set(), [1, 2, 3, 4, 5], 3)
        self.assertEqual(out, [1, 2, 3])


class LiveScan(unittest.TestCase):
    def test_scan_shape(self):
        r = agent.scan(agent.FREE_CANDIDATES, agent.FREE_SUGGESTION_LIMIT)
        self.assertIn("summary", r)
        self.assertIn("listeners", r)
        self.assertIn("free_suggestions", r)
        s = r["summary"]
        for key in ("total_listeners", "unique_ports", "process_count",
                    "tcp_count", "udp_count", "all_interfaces_count"):
            self.assertIn(key, s)
        # The agent reads real /proc, so totals should be internally consistent.
        self.assertEqual(s["tcp_count"] + s["udp_count"], s["total_listeners"])


class HttpApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        agent.ALLOWED_ORIGINS = {"https://portscope.example"}
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), agent.Handler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def _url(self, path):
        return f"http://127.0.0.1:{self.port}{path}"

    def test_health(self):
        with urllib.request.urlopen(self._url("/api/health"), timeout=5) as resp:
            data = json.load(resp)
        self.assertTrue(data["ok"])
        self.assertEqual(data["service"], "portscope")

    def test_ports_shape(self):
        with urllib.request.urlopen(self._url("/api/ports"), timeout=5) as resp:
            data = json.load(resp)
        self.assertEqual(
            set(data) >= {"summary", "listeners", "free_suggestions", "generated_at"},
            True,
        )

    def test_cors_allowed_origin(self):
        req = urllib.request.Request(self._url("/api/health"))
        req.add_header("Origin", "https://portscope.example")
        with urllib.request.urlopen(req, timeout=5) as resp:
            self.assertEqual(
                resp.headers.get("Access-Control-Allow-Origin"),
                "https://portscope.example",
            )

    def test_cors_disallowed_origin(self):
        req = urllib.request.Request(self._url("/api/health"))
        req.add_header("Origin", "https://evil.example")
        with urllib.request.urlopen(req, timeout=5) as resp:
            self.assertIsNone(resp.headers.get("Access-Control-Allow-Origin"))

    def test_cors_loopback_origin_allowed(self):
        # Any loopback origin is accepted by default, so local previews on any
        # port work without an exact allowlist entry.
        for origin in ("http://localhost:5500", "http://127.0.0.1:9999", "http://[::1]:3000"):
            req = urllib.request.Request(self._url("/api/health"))
            req.add_header("Origin", origin)
            with urllib.request.urlopen(req, timeout=5) as resp:
                self.assertEqual(resp.headers.get("Access-Control-Allow-Origin"), origin, origin)

    def test_pna_preflight(self):
        req = urllib.request.Request(self._url("/api/ports"), method="OPTIONS")
        req.add_header("Origin", "https://portscope.example")
        req.add_header("Access-Control-Request-Private-Network", "true")
        with urllib.request.urlopen(req, timeout=5) as resp:
            self.assertEqual(resp.status, 204)
            self.assertEqual(
                resp.headers.get("Access-Control-Allow-Private-Network"), "true"
            )

    def test_post_rejected(self):
        req = urllib.request.Request(self._url("/api/ports"), data=b"{}", method="POST")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req, timeout=5)
        self.assertEqual(ctx.exception.code, 405)
        self.assertEqual(ctx.exception.headers.get("Allow"), "GET, HEAD, OPTIONS")

    def test_idle_reset_is_silent(self):
        # A browser resets idle keep-alive connections; that must be swallowed
        # by Handler.handle(), not bubble up to the server's error handler
        # (which would dump a traceback to the console).
        import socket as _sock
        import struct
        import time

        errors = []
        original = self.server.handle_error
        self.server.handle_error = lambda req, addr: errors.append(addr)
        try:
            conn = _sock.create_connection(("127.0.0.1", self.port), timeout=5)
            conn.sendall(
                b"GET /api/health HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n"
            )
            buf = b""
            while b"\r\n\r\n" not in buf:
                buf += conn.recv(4096)
            hdr, _, rest = buf.partition(b"\r\n\r\n")
            clen = int(
                dict(l.split(b": ", 1) for l in hdr.split(b"\r\n")[1:] if b": " in l)
                .get(b"Content-Length", b"0")
            )
            while len(rest) < clen:
                rest += conn.recv(4096)
            time.sleep(0.2)  # let the server loop back to readline()
            # SO_LINGER (1, 0) makes close() send a RST instead of a clean FIN.
            conn.setsockopt(_sock.SOL_SOCKET, _sock.SO_LINGER, struct.pack("ii", 1, 0))
            conn.close()
            time.sleep(0.3)
            self.assertEqual(errors, [], "idle connection reset must not reach handle_error")
        finally:
            self.server.handle_error = original

    def test_post_drains_body_and_closes(self):
        # A POST with a body must not desync a kept-alive HTTP/1.1 connection:
        # the agent drains the body and signals Connection: close.
        import socket as _sock

        conn = _sock.create_connection(("127.0.0.1", self.port), timeout=5)
        try:
            body = b'{"payload":"x"}'
            req = (
                b"POST /api/ports HTTP/1.1\r\n"
                b"Host: 127.0.0.1\r\n"
                b"Content-Length: %d\r\n"
                b"Connection: keep-alive\r\n\r\n" % len(body)
            ) + body
            conn.sendall(req)
            raw = b""
            while b"\r\n\r\n" not in raw:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                raw += chunk
        finally:
            conn.close()
        self.assertIn(b" 405 ", raw[:40])
        self.assertIn(b"connection: close", raw.lower())
        # Exactly one Connection header (no framework/explicit duplicate).
        self.assertEqual(raw.lower().count(b"connection: close"), 1)


class CliLauncher(unittest.TestCase):
    """`python3 agent.py serve --port N …` is how web2local (and a plain shell)
    start the agent: flags instead of env vars, no install, no PYTHONPATH."""

    @staticmethod
    def _free_port() -> int:
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        return port

    def test_parser_defaults(self):
        args = agent._build_parser().parse_args(["serve"])
        self.assertEqual(args.cmd, "serve")
        self.assertIsNone(args.port)
        self.assertEqual(args.allow_origin, [])

    def test_version(self):
        out = subprocess.run(
            [sys.executable, AGENT_PY, "--version"],
            capture_output=True, text=True, timeout=20,
        )
        self.assertEqual(out.returncode, 0)
        self.assertIn("portscope", out.stdout)

    def test_bad_port_exit_code(self):
        out = subprocess.run(
            [sys.executable, AGENT_PY, "serve", "--port", "70000"],
            capture_output=True, text=True, timeout=20,
        )
        self.assertEqual(out.returncode, 2)

    def test_serve_boots_honors_flags_and_stops_on_sigterm(self):
        # Spawn exactly the way web2local's /deploy does: own session, so a
        # later os.killpg() (web2local's /stop) reaches the whole group.
        port = self._free_port()
        proc = subprocess.Popen(
            [sys.executable, AGENT_PY, "serve",
             "--port", str(port), "--host", "127.0.0.1",
             "--allow-origin", "https://cli.example,http://localhost:4321"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL, start_new_session=True,
        )
        try:
            up = False
            for _ in range(50):
                try:
                    urllib.request.urlopen(
                        f"http://127.0.0.1:{port}/api/health", timeout=1
                    ).read()
                    up = True
                    break
                except Exception:
                    if proc.poll() is not None:
                        break
                    time.sleep(0.2)
            self.assertTrue(up, "agent did not boot via `python3 agent.py serve`")

            # The --allow-origin flag must reach config: the agent echoes CORS
            # only for an allowed origin.
            req = urllib.request.Request(f"http://127.0.0.1:{port}/api/health")
            req.add_header("Origin", "https://cli.example")
            with urllib.request.urlopen(req, timeout=3) as resp:
                self.assertEqual(
                    resp.headers.get("Access-Control-Allow-Origin"),
                    "https://cli.example",
                )
        finally:
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except (ProcessLookupError, PermissionError):
                pass
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait(timeout=5)
            if proc.stdout:
                proc.stdout.close()
        # Graceful SIGTERM handling → clean exit (what web2local /stop relies on).
        self.assertEqual(proc.returncode, 0)


class AgentHashPin(unittest.TestCase):
    """The dashboard pins the agent's sha256 in site/app.js; web2local's
    /deploy rejects a content/hash mismatch. Guard against agent.py / app.js
    drift so a stale pin can't silently break the Start button."""

    def test_app_js_pin_matches_agent_file(self):
        with open(AGENT_PY, "rb") as fh:
            digest = hashlib.sha256(fh.read()).hexdigest()
        with open(APP_JS, "r", encoding="utf-8") as fh:
            js = fh.read()
        m = re.search(r'AGENT_SHA256\s*=\s*"([0-9a-f]{64})"', js)
        self.assertIsNotNone(m, "AGENT_SHA256 constant not found in site/app.js")
        self.assertEqual(
            m.group(1), digest,
            "site/app.js AGENT_SHA256 is stale — set it to the sha256 of "
            f"site/agent.py ({digest}); web2local /deploy rejects a mismatch.",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
