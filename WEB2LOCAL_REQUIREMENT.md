# portscope → web2local: launch requirement

> **Status: implemented.** web2local shipped **Option B** below — a `POST /deploy`
> that hash-verifies the source, writes it under `~/.config/web2local/agents/`,
> and (after the user approves) spawns it. portscope's dashboard is wired to it,
> and `install.sh` + systemd + the launcher are gone. This doc is kept as the
> design + security record.

Hand-off note for the **web2local** project. It states *what web2local needs to
be able to do* so the portscope dashboard can start its agent with **zero manual
install** — and deliberately does **not** pick the implementation. That choice is
yours; this doc gives you the contract, the constraints, and the trade-offs.

## Goal

A user who is running **only web2local** opens the public portscope dashboard
and clicks **Start agent**. The local port-scanner agent comes up, the
dashboard flips to live data, and a **Stop** button ends it. No `git clone`, no
`install.sh`, no `~/.local/bin` launcher, no `PATH` edits, no systemd. The only
prerequisites are: web2local running, and `python3` (3.7+) present (the agent is
pure standard library — no pip).

> portscope is removing `install.sh` + the launcher shim + the systemd unit
> entirely. web2local becomes the *only* way an ordinary user runs the agent.
> That is why this gap now matters.

## What already works (no web2local change needed)

From reading web2local's daemon, these are already sufficient and we lean on
them unchanged:

- **`/spawn`** runs a long-lived process via `Popen` (own session, stdout→log,
  returns `{pid, log_path}`). It accepts an **argv list, no shell** — and it
  resolves an **absolute interpreter path or a `python3` on PATH**, so
  `command:"python3", args:["/abs/agent.py","serve","--port","8790",…]`
  **already works** — *if the file is on disk*.
- **`/stop`** (SIGTERM→SIGKILL the group), **`/ps`**, **`/logs?pid=`** — give us
  lifecycle + a log tail on failure.
- **`/status`** for detection; **graylist** + the blocking **approval dialog**
  for consent; the **Host-header** anti-DNS-rebinding guard; the audit log.

## The one gap

web2local can **run** a local script but has **no way to get one onto disk**.
There is no fetch/download, no file-write, and no run-inline-source endpoint.
That delivery step is the *entire* reason a manual install exists today. Close
it and the goal is met.

## The artifact web2local must end up running (the contract)

A **single self-contained, stdlib-only Python file** — shipped by portscope at a
stable URL on the dashboard's own origin:

```
https://portscope.lue-app.com/agent.py
```

Invocation (foreground process; web2local detaches/logs/stops it as it does any
spawn):

```
python3 <path-to>/agent.py serve --host 127.0.0.1 --port <PORT> --allow-origin <CSV-of-origins> --allow-kill
```

- Exits **0** on SIGTERM (so `/stop` is clean). Prints a one-line bind error and
  exits **2** if the port is taken / privileged (so a failed start shows a cause
  in `/logs`, not a silent death).
- Readiness probe: `GET http://127.0.0.1:<PORT>/api/health` →
  `{"ok":true,"service":"portscope",…}`.
- The file is stdlib-only, loopback-only, and command-execution-free. Without
  `--allow-kill` it is inspection-only. With `--allow-kill`, it also serves a
  guarded `POST /api/kill` that re-scans the selected listener before signaling
  its PID. Current SHA-256 (changes when the file changes — compute at deploy
  time, don't hard-code):
  `58ef33fdbceec6eca1d9097561ab1c05959125e97939ff8a3b99f806fe5cb982`

## The requirement: one new capability — "deliver, then run"

web2local needs **a way to place that file on disk under user consent, then
spawn it**. Any of the following satisfies the requirement; **portscope does not
need a specific one** — pick what best fits web2local's design:

### Option A — web2local fetches a URL to disk
A new step that **downloads an (allowlisted) URL** to a daemon-controlled dir
(e.g. `~/.config/web2local/agents/<sha>.py`), **pins a caller-supplied
SHA-256**, size-capped, then the site `/spawn`s `python3 <that path> serve …`.
- 👍 Best consent: the approval dialog can show a real **URL + hash** a human can
  judge.
- 👎 The daemon makes its **first-ever outbound request** — new surface; needs a
  fetch-URL allowlist + the hash pin to stay safe.

### Option B — browser delivers the bytes, daemon writes them
The browser fetches `agent.py` from the page's own (already-trusted) origin and
hands the **source** to web2local, which **writes it to a sandbox dir** and then
`/spawn`s it. (A small `/write` endpoint, or fold a `code`/`sha256` field into
`/spawn`.)
- 👍 Daemon stays **network-silent** (the browser does the fetch); the file is a
  reviewable on-disk artifact you can hash + audit.
- 👎 Introduces "site supplies a code body" — show the SHA-256 (and ideally a
  short summary) in the dialog so consent is meaningful.

### Option C — run inline source, no file, no new endpoint
The browser fetches the source and the site `/spawn`s
`command:"python3", args:["-c", "<entire source>", "serve","--port",…]`.
- 👍 **Zero web2local change** — works with `/spawn` as-is today.
- 👎 The approval dialog shows an **opaque ~770-line blob** — weakest informed
  consent, and the `/ps`/Stop matcher keys off a giant argv. Workable fallback,
  not the clean path.

## Hard constraints (any option must satisfy)

1. **Route through the graylist approval dialog** — a human approves before
   anything runs. **Never** rely on self-whitelisting (see security rule).
2. **No shell.** Keep web2local's argv-exec invariant; no pipes/redirects.
3. **Loopback-only bind + Host-header guard** stay as they are.
4. **Audited.** The fetch/write + the spawn land in the audit log.
5. **Show something a human can judge** in the dialog — prefer a URL + SHA-256
   over raw code.
6. **Re-runnable.** Starting twice shouldn't pile up agents; the spawned argv
   should stay identifiable so `/ps` + `/stop` can find exactly it.

## Security rule (non-negotiable)

`/config/whitelist` and `/config/graylist` are **ungated** today — by design, so
a page can "add itself." That is only safe because execution still requires the
**graylist approval dialog**. A delivery capability that could be reached via
**self-whitelist → silent spawn** would become a **no-prompt RCE primitive**
(fetch-and-run arbitrary code with no human in the loop). So: the no-install
launch **must** go through the approval dialog, and the dialog should disclose
*what gets fetched and run* (URL + hash), not just an argv. portscope's agent
stays loopback-only and command-execution-free; its optional kill endpoint only
signals PIDs that still own a currently scanned listener. The risk being
guarded here is the generic "deliver + execute" power, not portscope itself.

## What portscope provides (so your side is easy)

- `agent.py` — the single stdlib file, hosted at the dashboard origin (same
  origin as the page → same-origin fetch for Option B/C; a trusted URL for A).
- Its SHA-256 at deploy time (for pinning).
- The exact argv + the `/api/health` readiness probe above.
- Dashboard-side wiring to match whatever you pick: the **Start** flow (graylist
  add → deliver → spawn → poll `/api/health` → show dashboard) and the **Stop**
  matcher (find our agent in `/ps`, `/stop` it). portscope adapts the spawn
  `command/args` + the `/ps` match predicate to your chosen mechanism.

## Open question back to the web2local agent

> Which delivery shape do you want to build — **A (fetch URL + hash)**,
> **B (write bytes)**, or **C (inline `-c`, no change)** — and what request
> shape should the dashboard send? portscope will wire the Start/Stop flow to
> match.
