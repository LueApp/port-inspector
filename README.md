# Port Inspector

A lightweight dashboard for **what's listening on your machine's ports**.

A website cannot read your local ports — the browser sandbox forbids it. So
Port Inspector splits in two: a static web dashboard that probes a tiny **local
agent** over `127.0.0.1`. If the agent is running, the page shows live
port data. If it isn't, the same page shows how to start it.

```
  browser ──fetch──> http://127.0.0.1:8790/api/ports ──reads──> /proc/net/*
 (static site)            (local agent)
```

Nothing leaves your machine. The agent binds loopback only and exposes JSON
APIs — there is no command-execution endpoint. By default it is
inspection-only; when started with `--allow-kill`, the dashboard can send
`SIGTERM` to a selected listener PID after you confirm the row action. The whole
agent is a single standard-library Python file (`site/agent.py`); there is
nothing to install.

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
from outside the machine. When kill is enabled, rows with a resolved PID also
show a **Kill** action.

## Running the agent

You need `python3` (3.7+). That's the only prerequisite — the agent has no
dependencies.

### Start from the dashboard with web2local (recommended)

[web2local](https://web2local-bridge.lue-app.com/) is a small local daemon that
lets an allowlisted website deliver and run a local command **with your
approval**. If it's running, the dashboard's **Start with web2local** card
starts the agent for you — no terminal, no install. It:

1. detects web2local (default port `7878`),
2. fetches the single-file agent (`agent.py`) from this page's origin and
   verifies its SHA-256,
3. adds this page's origin to web2local's *graylist*, then
4. calls web2local's `/deploy`: web2local writes the agent under
   `~/.config/web2local/agents/` and — once you **approve the write + run** in
   its dialog — spawns
   `python3 …/portscope-agent.py serve --port <agent port> --allow-origin <this origin> --allow-kill`.

The same card can **Stop** the agent and tail its log on failure. web2local owns
the process (`/ps`, `/logs`, `/stop`); the dashboard never runs anything itself.
The agent stays loopback-only and never grows a command-execution endpoint. With
`--allow-kill`, `POST /api/kill` is limited to PIDs that still own a currently
scanned listener, refuses the agent's own PID, and enforces the browser Origin
allowlist on mutating requests.

### Run it yourself

No web2local? Download the single file and run it:

```bash
curl -fsSL -o portscope-agent.py https://portscope.lue-app.com/agent.py
python3 portscope-agent.py serve --port 8790 --allow-origin https://portscope.lue-app.com --allow-kill
```

Or from a clone of this repo:
`python3 site/agent.py serve --port 8790 --allow-kill`. It listens on
`http://127.0.0.1:8790`; open the dashboard and it connects automatically. Stop
it with Ctrl-C.

### Flags

`agent.py serve` is configured with flags, so a supervisor (web2local, or your
shell) can set everything without environment variables or a working directory:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--port N` | `8790` | Agent port. |
| `--host ADDR` | `127.0.0.1` | Bind address. Keep it on loopback. |
| `--allow-origin CSV` | public site + localhost dev | Browser origin(s) allowed to read the agent. Repeatable; commas allowed. |
| `--public-site URL` | `https://portscope.lue-app.com` | Deployed dashboard origin. |
| `--allow-kill` | off | Enable `POST /api/kill` and row-level Kill buttons for resolved listener PIDs. |

Each flag has a `PORTSCOPE_*` environment-variable equivalent (`PORTSCOPE_PORT`,
`PORTSCOPE_HOST`, `PORTSCOPE_ALLOWED_ORIGINS`, `PORTSCOPE_PUBLIC_SITE`,
`PORTSCOPE_ALLOW_KILL`); the flags take precedence. Any origin allowed to read
the agent can see the full list of what's listening while it runs — and, if
kill is enabled, can request listener termination — so keep the allowlist tight.
By default the agent **also** accepts any loopback origin (any local port), so
local previews work without listing each one; set
`PORTSCOPE_ALLOW_LOOPBACK_ORIGINS=0` to require an exact allowlist match.

## PID resolution and permissions

`/proc/net/*` lists every socket system-wide (address, port, owning uid), so
the dashboard always shows them. Mapping a socket to its **PID/process/command**
requires reading `/proc/<pid>/fd`, which the kernel only allows for processes
you own. Sockets owned by other users (e.g. system services running as `root`)
appear with their address, port, and user, but a blank PID — the dashboard
notes how many. Run the agent as root if you need every PID resolved; for a
personal dashboard, running as your user is the safer default.

## API

- `GET /api/health` → `{ ok, service: "portscope", version, public_site, capabilities }`
- `GET /api/ports` → `{ summary, listeners, free_suggestions, generated_at, capabilities }`
- `POST /api/kill` → `{ ok, pid, signal, process, ports }` when `--allow-kill`
  is enabled. Body: `{ pid, port, protocol, signal? }`; `signal` defaults to
  `SIGTERM` and may be `SIGKILL`.

Unsupported mutating methods return `405`. `POST /api/kill` drains and closes
the request body, verifies the Origin header for browser requests, re-scans
`/proc` before signaling, and returns `403`/`404` for permission or stale-row
cases.

## The web dashboard

`site/` is a plain static site (HTML/CSS/JS — no build step). The agent
(`agent.py`) is served from the same directory, so web2local fetches it
same-origin. Host `site/` anywhere:

- **Locally:** `cd site && python3 -m http.server 5500`, then open
  <http://127.0.0.1:5500>. Any loopback origin (`localhost`/`127.0.0.1`/`[::1]`,
  any port) is accepted by default, so local previews just work.
- **Cloudflare Pages / any static host:** deploy the `site/` directory (the
  `_headers` file applies security headers). The setup page's **Run it
  yourself** card pre-fills a `curl … && python3 …` command with your deployed
  origin baked into `--allow-origin`.

The page persists your chosen agent port in `localStorage`, has a manual refresh
button and an auto-refresh toggle, and the listener table supports search,
protocol/scope filtering, an "exposed only" filter, and column sort. English and
中文 are both included.

## Tests

```bash
python3 smoke_test.py
```

Covers address parsing, scope classification, `/proc/net` parsing, container
hints, free-port suggestions, guarded process termination, a live scan, the
HTTP API (CORS, Private Network Access preflight, unsupported method rejection),
the `agent.py serve` CLI, and a
**drift guard** that the agent's sha256 matches the hash the dashboard pins for
web2local's `/deploy` (so the two can never silently diverge).
