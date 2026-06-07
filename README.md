# portscope

A lightweight dashboard for **what's listening on your machine's ports**.

A website cannot read your local ports — the browser sandbox forbids it. So
portscope uses the same split as [typefreq](../count-words/typefreq): a static
web dashboard that probes a tiny **local read-only agent** over `127.0.0.1`. If
the agent is running, the page shows live port data. If it isn't, the same page
shows setup and start guidance.

```
  browser ──fetch──> http://127.0.0.1:8790/api/ports ──reads──> /proc/net/*
 (static site)            (local read-only agent)
```

Nothing leaves your machine. The agent binds loopback only and exposes JSON
APIs — there is no command-execution endpoint.

## What it shows

For every TCP `LISTEN` socket and bound UDP socket:

- protocol (`tcp` / `tcp6` / `udp` / `udp6`)
- local address and port
- scope: **loopback** / **all interfaces** / **private** / **specific**
- owning PID, process name, and full command (best-effort — see below)
- owning user
- container id hint (when the process runs inside docker/podman/containerd)

The dashboard summarizes total listeners, unique ports, process count, TCP and
UDP counts, an **all-interfaces warning count**, and suggests currently-free
dev ports. Listeners bound to `0.0.0.0` or `::` are highlighted as reachable
from outside the machine.

## Quick start (no install)

The agent is pure Python standard library — nothing to install.

```bash
git clone https://github.com/LueApp/portscope.git
cd portscope
python3 -m portscope.app
```

It listens on `http://127.0.0.1:8790`. Open the dashboard
(`https://portscope.lue-app.com`, or serve `site/` locally) and it connects
automatically.

## Install as a service

```bash
cd portscope
./install.sh            # or: ./install.sh 9000  to pick a port
```

This renders a systemd **user** unit, enables autostart, and starts it. Common
commands:

```bash
systemctl --user enable --now portscope.service
systemctl --user status portscope.service
journalctl --user -u portscope -f
```

To keep the agent running after you log out:

```bash
sudo loginctl enable-linger "$USER"
```

## Configuration

All settings are environment variables read by `portscope/config.py`:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORTSCOPE_HOST` | `127.0.0.1` | Bind address. Keep it on loopback. |
| `PORTSCOPE_PORT` | `8790` | Agent port. |
| `PORTSCOPE_PUBLIC_SITE` | `https://portscope.lue-app.com` | The deployed dashboard origin. |
| `PORTSCOPE_ALLOWED_ORIGINS` | public site + localhost dev | Comma-separated CORS allowlist. |
| `PORTSCOPE_ALLOW_LOOPBACK_ORIGINS` | `1` | Also accept any loopback origin (any local port). Set `0` to require an exact allowlist match. |
| `PORTSCOPE_FREE_CANDIDATES` | common dev ports | Pool to pull free-port suggestions from. |
| `PORTSCOPE_FREE_SUGGESTION_LIMIT` | `10` | Max free-port suggestions. |

Any origin in `PORTSCOPE_ALLOWED_ORIGINS` can read the full list of what's
listening on your machine while the agent runs — keep it tight. The agent
sends CORS headers and Chrome **Private Network Access** headers only for these
origins.

## PID resolution and permissions

`/proc/net/*` lists every socket system-wide (address, port, owning uid), so
the dashboard always shows them. Mapping a socket to its **PID/process/command**
requires reading `/proc/<pid>/fd`, which the kernel only allows for processes
you own. Sockets owned by other users (e.g. system services running as `root`)
appear with their address, port, and user, but a blank PID — the dashboard
notes how many. Run the agent as root if you need every PID resolved; for a
personal dashboard, running as your user is the safer default.

## API

- `GET /api/health` → `{ ok, service: "portscope", version, public_site }`
- `GET /api/ports` → `{ summary, listeners, free_suggestions, generated_at }`

Only `GET` (and `OPTIONS` for CORS preflight) are handled; every mutating
method returns `405`. The agent is read-only.

## The web dashboard

`site/` is a plain static site (HTML/CSS/JS — no build step). Host it anywhere:

- **Locally:** `cd site && python3 -m http.server 5500`, then open
  <http://127.0.0.1:5500>. Any loopback origin (`localhost`/`127.0.0.1`/`[::1]`,
  any port) is accepted by default, so local previews just work without
  touching the allowlist.
- **Cloudflare Pages / any static host:** deploy the `site/` directory. The
  `_headers` file applies security headers. Set `PORTSCOPE_ALLOWED_ORIGINS` (or
  use the setup page's pre-filled command, which bakes in your page origin) so
  the agent allows your deployed (non-loopback) origin.

By default the agent allows any **loopback** origin in addition to
`PORTSCOPE_ALLOWED_ORIGINS`. The agent binds loopback only and anything that can
serve a page on your localhost could already read `/proc`, so this is low-risk
and removes per-port friction. Set `PORTSCOPE_ALLOW_LOOPBACK_ORIGINS=0` to
require an exact allowlist match instead.

The page persists your chosen agent port in `localStorage`, has a manual
refresh button and an auto-refresh toggle, and the listener table supports
search, protocol/scope filtering, an "exposed only" filter, and column sort.

## Tests

```bash
python3 smoke_test.py
```

Covers address parsing, scope classification, `/proc/net` parsing, container
hints, free-port suggestions, a live scan, and the HTTP API (including CORS,
Private Network Access preflight, and read-only method rejection).
