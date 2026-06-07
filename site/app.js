/* portscope dashboard — talks to the local read-only agent over localhost. */
(() => {
  "use strict";

  const DEFAULT_PORT = 8790;
  const PORT_KEY = "portscope.port";
  const AUTO_KEY = "portscope.auto";
  const REFRESH_MS = 5000;
  const TIMEOUT_MS = 2500;

  const $ = (id) => document.getElementById(id);
  const els = {
    badge: $("badge"),
    portForm: $("port-form"),
    portInput: $("port-input"),
    refresh: $("refresh-btn"),
    autoWrap: $("auto-wrap"),
    auto: $("auto-toggle"),
    retry: $("retry-btn"),
    dashboard: $("dashboard"),
    setup: $("setup"),
    setupRetry: $("setup-retry"),
    setupEyebrow: $("setup-eyebrow"),
    probeTarget: $("probe-target"),
    connDetail: $("conn-detail"),
    search: $("search"),
    filterProto: $("filter-proto"),
    filterScope: $("filter-scope"),
    filterExposed: $("filter-exposed"),
    rowCount: $("row-count"),
    body: $("ports-body"),
    tableEmpty: $("table-empty"),
    footnote: $("footnote"),
    // stats
    sTotal: $("s-total"), sPorts: $("s-ports"), sProcs: $("s-procs"),
    sTcp: $("s-tcp"), sUdp: $("s-udp"), sExposed: $("s-exposed"), sFree: $("s-free"),
    statExposed: $("stat-exposed"), exposedAlert: $("exposed-alert"), exposedAlertText: $("exposed-alert-text"),
    // setup commands
    cmdQuick: $("cmd-quick"), cmdInstall: $("cmd-install"), cmdEnvPort: $("cmd-env-port"),
  };

  let port = readPort();
  let autoRefresh = localStorage.getItem(AUTO_KEY) !== "0";
  let timer = null;
  let mode = "checking"; // checking | online | offline
  let rows = [];
  let sortKey = "port";
  let sortDir = 1; // 1 asc, -1 desc

  // ---------- helpers ----------
  function readPort() {
    const stored = Number(localStorage.getItem(PORT_KEY));
    return Number.isInteger(stored) && stored >= 1 && stored <= 65535 ? stored : DEFAULT_PORT;
  }
  function base() { return `http://127.0.0.1:${port}`; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }
  function fmt(n) { return n == null ? "—" : Number(n).toLocaleString(); }

  async function api(path) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(base() + path, { mode: "cors", signal: ctrl.signal });
      if (!res.ok) throw new Error(res.status + " " + res.statusText);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  // ---------- view switching ----------
  function setBadge(state, text) {
    els.badge.className = "badge " + state;
    els.badge.textContent = text;
  }
  function showDashboard(on) {
    els.dashboard.hidden = !on;
    els.setup.hidden = on;
    els.refresh.hidden = !on;
    els.autoWrap.hidden = !on;
    els.retry.hidden = on;
  }

  function setChecking() {
    mode = "checking";
    setBadge("checking", "checking…");
    els.connDetail.textContent = `probing 127.0.0.1:${port}`;
  }
  function setOffline() {
    mode = "offline";
    setBadge("offline", `no agent on ${port}`);
    showDashboard(false);
    syncSetupCommands();
    els.setupEyebrow.textContent = "Local service not detected";
    els.connDetail.textContent = `no response from 127.0.0.1:${port}`;
    // Keep polling while auto-refresh is on: the next /api/ports call doubles
    // as a reconnect probe, so the dashboard recovers on its own when the
    // agent comes back. Only stop polling when the user disabled auto.
    if (autoRefresh) startAuto();
    else if (timer) { clearInterval(timer); timer = null; }
  }
  function setOnline(detail) {
    mode = "online";
    setBadge("online", `connected · :${port}`);
    showDashboard(true);
    els.connDetail.textContent = detail || `connected to 127.0.0.1:${port}`;
  }

  // ---------- rendering ----------
  const scopeClass = (scope) => ({
    "loopback": "scope-loopback",
    "all interfaces": "scope-all",
    "private": "scope-private",
    "multicast": "scope-multicast",
    "specific": "scope-specific",
  })[scope] || "scope-private";

  function renderStats(summary, free) {
    els.sTotal.textContent = fmt(summary.total_listeners);
    els.sPorts.textContent = fmt(summary.unique_ports);
    els.sProcs.textContent = fmt(summary.process_count);
    els.sTcp.textContent = fmt(summary.tcp_count);
    els.sUdp.textContent = fmt(summary.udp_count);
    const exposed = Number(summary.all_interfaces_count || 0);
    els.sExposed.textContent = fmt(exposed);
    els.statExposed.classList.toggle("is-exposed", exposed > 0);
    els.statExposed.classList.toggle("is-clear", exposed === 0);
    if (exposed > 0) {
      els.exposedAlert.hidden = false;
      els.exposedAlertText.innerHTML =
        `<b>${esc(exposed)}</b> socket${exposed === 1 ? "" : "s"} bound to ` +
        `<code>0.0.0.0</code> or <code>::</code> — reachable from other machines on your network.`;
    } else {
      els.exposedAlert.hidden = true;
    }
    if (!free || !free.length) {
      els.sFree.innerHTML = '<span class="none">none free in pool</span>';
    } else {
      els.sFree.innerHTML = free.map((p) => `<span class="fport">${esc(p)}</span>`).join("");
    }
  }

  function applyView() {
    const q = els.search.value.trim().toLowerCase();
    const fp = els.filterProto.value;
    const fs = els.filterScope.value;
    const onlyExposed = els.filterExposed.checked;

    let view = rows.filter((r) => {
      if (fp && !r.protocol.startsWith(fp)) return false;
      if (fs && r.scope !== fs) return false;
      if (onlyExposed && !r.exposed) return false;
      if (q) {
        const hay = `${r.protocol} ${r.address} ${r.port} ${r.scope} ${r.pid ?? ""} ${r.process ?? ""} ${r.user ?? ""} ${r.command ?? ""} ${r.container_id ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    view.sort((a, b) => {
      let x = a[sortKey], y = b[sortKey];
      if (sortKey === "port" || sortKey === "pid") {
        x = x == null ? -1 : Number(x); y = y == null ? -1 : Number(y);
        return (x - y) * sortDir;
      }
      x = (x == null ? "" : String(x)).toLowerCase();
      y = (y == null ? "" : String(y)).toLowerCase();
      return x < y ? -sortDir : x > y ? sortDir : 0;
    });

    els.body.innerHTML = view.map(rowHtml).join("");
    els.tableEmpty.hidden = view.length > 0;
    els.rowCount.textContent = `${view.length} of ${rows.length} shown`;
  }

  function rowHtml(r) {
    const exposedTag = r.exposed ? " exposed" : "";
    const dot = `<span class="dot ${r.exposed ? "warn" : ""}" title="${r.exposed ? "reachable off-host" : "local only"}"></span>`;
    const scope = `<span class="pill ${scopeClass(r.scope)}">${esc(r.scope)}</span>`;
    const proto = `<span class="pill proto" data-p="${esc(r.protocol)}">${esc(r.protocol)}</span>`;
    const cmd = r.command ? `<td class="cmd" title="${esc(r.command)}">${esc(r.command)}</td>` : `<td class="dash">—</td>`;
    const proc = r.process ? `<td class="proc">${esc(r.process)}</td>` : `<td class="dash">—</td>`;
    const pid = r.pid != null ? `<td class="num">${esc(r.pid)}</td>` : `<td class="num dash">—</td>`;
    const cid = r.container_id ? `<td class="cid">${esc(r.container_id)}</td>` : `<td class="dash">—</td>`;
    const user = r.user ? `<td>${esc(r.user)}</td>` : `<td class="dash">—</td>`;
    return `<tr class="row${exposedTag}">
      <td class="status-cell">${dot}</td>
      <td>${proto}</td>
      <td class="addr">${esc(r.address)}</td>
      <td class="num"><span class="mono-port">${esc(r.port)}</span></td>
      <td>${scope}</td>
      ${pid}
      ${proc}
      ${user}
      ${cmd}
      ${cid}
    </tr>`;
  }

  function updateSortIndicators() {
    document.querySelectorAll("th.sortable").forEach((th) => {
      const base = th.textContent.replace(/[↑↓].*$/, "").trim();
      th.innerHTML = th.dataset.sort === sortKey
        ? `${base} <span class="arrow">${sortDir === 1 ? "↑" : "↓"}</span>`
        : base;
    });
  }

  // ---------- data flow ----------
  async function refresh() {
    try {
      const data = await api("/api/ports");
      rows = Array.isArray(data.listeners) ? data.listeners : [];
      renderStats(data.summary || {}, data.free_suggestions || []);
      applyView();
      const unresolved = data.summary?.unresolved_pid_count || 0;
      const stamp = data.generated_at ? new Date(data.generated_at * 1000).toLocaleTimeString() : "";
      els.footnote.textContent = unresolved
        ? `Updated ${stamp}. ${unresolved} socket(s) are owned by other users; run the agent as root to resolve their PID/process. Rows on 0.0.0.0 or :: are reachable from outside this machine.`
        : `Updated ${stamp}. Rows highlighted in red (0.0.0.0 or ::) are reachable from outside this machine.`;
      setOnline(`${rows.length} listeners · updated ${stamp}`);
    } catch (err) {
      setOffline();
    }
  }

  async function connect() {
    setChecking();
    if (timer) { clearInterval(timer); timer = null; }
    try {
      const health = await api("/api/health");
      if (!health || health.service !== "portscope") throw new Error("unexpected service");
      await refresh();
      if (autoRefresh) startAuto();
    } catch (err) {
      setOffline();
    }
  }

  function startAuto() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => { if (mode !== "checking") refresh(); }, REFRESH_MS);
  }

  // ---------- setup commands (origin-aware so CORS works on this page) ----------
  function syncSetupCommands() {
    const origin = window.location.origin;
    const allowed = [origin, "http://localhost:4321", "http://127.0.0.1:4321"]
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(",");
    const portArg = port === DEFAULT_PORT ? "" : ` ${port}`;
    els.probeTarget.textContent = `127.0.0.1:${port}`;
    els.cmdEnvPort.textContent = `PORTSCOPE_PORT=${port}`;
    els.cmdQuick.textContent =
      `git clone https://github.com/LueApp/portscope.git\n` +
      `cd portscope\n` +
      `PORTSCOPE_PORT=${port} PORTSCOPE_ALLOWED_ORIGINS="${allowed}" python3 -m portscope.app`;
    els.cmdInstall.textContent =
      `cd portscope\n` +
      `PORTSCOPE_PORT=${port} PORTSCOPE_ALLOWED_ORIGINS="${allowed}" ./install.sh${portArg}`;
  }

  // ---------- events ----------
  els.portForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = Number(els.portInput.value);
    if (!Number.isInteger(v) || v < 1 || v > 65535) { setBadge("offline", "port must be 1–65535"); return; }
    port = v;
    localStorage.setItem(PORT_KEY, String(port));
    connect();
  });
  els.refresh.addEventListener("click", () => refresh());
  els.retry.addEventListener("click", () => connect());
  els.setupRetry.addEventListener("click", () => connect());
  els.auto.addEventListener("change", () => {
    autoRefresh = els.auto.checked;
    localStorage.setItem(AUTO_KEY, autoRefresh ? "1" : "0");
    if (autoRefresh) { startAuto(); refresh(); }
    else if (timer) { clearInterval(timer); timer = null; }
  });

  ["input", "change"].forEach((ev) => {
    els.search.addEventListener(ev, applyView);
  });
  [els.filterProto, els.filterScope, els.filterExposed].forEach((el) => {
    el.addEventListener("change", applyView);
  });
  document.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (sortKey === key) sortDir = -sortDir;
      else { sortKey = key; sortDir = key === "port" || key === "pid" ? 1 : 1; }
      updateSortIndicators();
      applyView();
    });
  });
  document.querySelectorAll(".copy").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = $(btn.dataset.copy)?.textContent || "";
      try {
        await navigator.clipboard.writeText(text);
        const old = btn.textContent;
        btn.textContent = "Copied"; btn.classList.add("done");
        setTimeout(() => { btn.textContent = old; btn.classList.remove("done"); }, 1400);
      } catch { /* clipboard blocked; ignore */ }
    });
  });

  // ---------- init ----------
  els.portInput.value = String(port);
  els.auto.checked = autoRefresh;
  updateSortIndicators();
  syncSetupCommands();
  connect();
})();
