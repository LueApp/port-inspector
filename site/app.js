/* portscope dashboard — talks to the local read-only agent over localhost. */
(() => {
  "use strict";

  const DEFAULT_PORT = 8790;
  const PORT_KEY = "portscope.port";
  const AUTO_KEY = "portscope.auto";
  const LANG_KEY = "portscope.lang";
  const REFRESH_MS = 5000;
  const TIMEOUT_MS = 2500;

  // ---------- translations ----------
  const translations = {
    en: {
      metaTitle: "portscope — local port dashboard",
      brandSub: "local port dashboard",
      badgeChecking: "checking…",
      agentPort: "Agent port",
      apply: "Apply",
      refresh: "Refresh",
      refreshTitle: "Refresh now",
      auto: "Auto",
      autoTitle: "Auto-refresh every 5s",
      retry: "Retry",
      listeners: "Listeners",
      processes: "Processes",
      uniquePorts: "Unique ports",
      exposed: "Exposed",
      freePorts: "Suggested free ports",
      searchPh: "Search address, port, process, command, user…",
      allProtocols: "All protocols",
      allScopes: "All scopes",
      scopeLoopback: "Loopback",
      scopeAll: "All interfaces",
      scopePrivate: "Private",
      scopeMulticast: "Multicast",
      scopeSpecific: "Specific",
      exposedOnly: "Exposed only",
      colProto: "Proto",
      colAddress: "Address",
      colPort: "Port",
      colScope: "Scope",
      colPid: "PID",
      colProcess: "Process",
      colUser: "User",
      colCommand: "Command",
      colContainer: "Container",
      tableEmpty: "No sockets match the current filters.",
      setupEyebrow: "Local service not detected",
      setupTitle: "Run the portscope agent to see your ports here.",
      setupLead:
        "A website on its own cannot read your machine's open ports — the browser sandbox forbids it. " +
        "portscope ships a tiny <strong>read-only</strong> agent that listens on " +
        '<code id="probe-target">127.0.0.1:8790</code> and serves the port list as JSON. This page reads ' +
        "that agent directly from your browser. Start it once and this page becomes a live dashboard.",
      setupRetry: "I started it — retry",
      viewSource: "View source",
      card1Title: "Quick start (no install)",
      card1Body: "Pure Python standard library — no dependencies to install.",
      card1Note: "Leave it running in a terminal. The dashboard appears here automatically once it responds.",
      card2Title: "Install as a service",
      card2Body: "Sets up a systemd user service that starts at login.",
      card2Note: "The installer binds the agent to <code>127.0.0.1</code> and allowlists this page's origin for CORS.",
      card3Title: "Manage the service",
      card3Note: "Stop with <code>systemctl --user disable --now portscope.service</code>.",
      card4Title: "Change the port",
      card4Body:
        "The agent defaults to <code>8790</code>. To run it on a different port, start it with " +
        '<code id="cmd-env-port">PORTSCOPE_PORT=8790</code> (this updates to match the ' +
        "<strong>Agent port</strong> field above), then set the same number in that field and click Apply.",
      card4Note:
        "Your chosen port is remembered in this browser. The agent is read-only — it exposes JSON only and " +
        "never runs commands.",
      copy: "Copy",
      copied: "Copied",
      footerText: "portscope · local read-only port dashboard",
      badgeConnected: "connected · :{port}",
      badgeOffline: "no agent on {port}",
      badgePortRange: "port must be 1–65535",
      connProbing: "probing 127.0.0.1:{port}",
      connConnected: "{n} listeners · updated {time}",
      connNoResp: "no response from 127.0.0.1:{port}",
      rowCount: "{n} of {total} shown",
      freeNone: "none free in pool",
      alertText:
        "<b>{n}</b> socket{s} bound to <code>0.0.0.0</code> or <code>::</code> — " +
        "reachable from other machines on your network.",
      footPlain: "Updated {time}. Rows highlighted in red (0.0.0.0 or ::) are reachable from outside this machine.",
      footUnresolved:
        "Updated {time}. {n} socket(s) are owned by other users; run the agent as root to resolve their " +
        "PID/process. Rows on 0.0.0.0 or :: are reachable from outside this machine.",
      dotExposed: "reachable off-host",
      dotLocal: "local only",
    },
    zh: {
      metaTitle: "portscope — 本地端口面板",
      brandSub: "本地端口面板",
      badgeChecking: "检查中…",
      agentPort: "代理端口",
      apply: "应用",
      refresh: "刷新",
      refreshTitle: "立即刷新",
      auto: "自动",
      autoTitle: "每 5 秒自动刷新",
      retry: "重试",
      listeners: "监听项",
      processes: "进程",
      uniquePorts: "端口数",
      exposed: "已暴露",
      freePorts: "可用端口建议",
      searchPh: "搜索地址、端口、进程、命令、用户…",
      allProtocols: "所有协议",
      allScopes: "所有范围",
      scopeLoopback: "环回",
      scopeAll: "所有网卡",
      scopePrivate: "内网",
      scopeMulticast: "组播",
      scopeSpecific: "指定地址",
      exposedOnly: "仅暴露",
      colProto: "协议",
      colAddress: "地址",
      colPort: "端口",
      colScope: "范围",
      colPid: "PID",
      colProcess: "进程",
      colUser: "用户",
      colCommand: "命令",
      colContainer: "容器",
      tableEmpty: "没有符合当前筛选的套接字。",
      setupEyebrow: "未检测到本地服务",
      setupTitle: "运行 portscope 代理，即可在此查看端口。",
      setupLead:
        "网页自身无法读取本机的开放端口——浏览器沙箱禁止这样做。portscope 提供一个极小的" +
        "<strong>只读</strong>代理，监听在 " +
        '<code id="probe-target">127.0.0.1:8790</code>，并以 JSON 提供端口列表。本页面直接从你的浏览器' +
        "读取该代理。启动一次后，本页面即成为实时面板。",
      setupRetry: "已启动，重试",
      viewSource: "查看源码",
      card1Title: "快速开始（免安装）",
      card1Body: "纯 Python 标准库——无需安装任何依赖。",
      card1Note: "在终端中保持运行。代理响应后，面板会自动出现在这里。",
      card2Title: "安装为服务",
      card2Body: "创建一个开机自启的 systemd 用户服务。",
      card2Note: "安装器会将代理绑定到 <code>127.0.0.1</code>，并把本页面来源加入 CORS 允许列表。",
      card3Title: "管理服务",
      card3Note: "停止：<code>systemctl --user disable --now portscope.service</code>。",
      card4Title: "更改端口",
      card4Body:
        "代理默认使用 <code>8790</code>。如需使用其他端口，请以 " +
        '<code id="cmd-env-port">PORTSCOPE_PORT=8790</code> 启动（此处会与上方的' +
        "<strong>代理端口</strong>同步），然后在该输入框填入相同端口并点击应用。",
      card4Note: "你选择的端口会记录在此浏览器中。代理为只读——只提供 JSON，绝不执行任何命令。",
      copy: "复制",
      copied: "已复制",
      footerText: "portscope · 本地只读端口面板",
      badgeConnected: "已连接 · :{port}",
      badgeOffline: "{port} 无代理",
      badgePortRange: "端口须为 1–65535",
      connProbing: "正在探测 127.0.0.1:{port}",
      connConnected: "{n} 个监听 · 更新于 {time}",
      connNoResp: "127.0.0.1:{port} 无响应",
      rowCount: "显示 {n} / {total}",
      freeNone: "池中无可用端口",
      alertText:
        "<b>{n}</b> 个套接字绑定到 <code>0.0.0.0</code> 或 <code>::</code>——可被网络中其他机器访问。",
      footPlain: "更新于 {time}。标红的行（0.0.0.0 或 ::）可从本机外部访问。",
      footUnresolved:
        "更新于 {time}。{n} 个套接字属于其他用户；以 root 运行代理可解析其 PID/进程。" +
        "绑定到 0.0.0.0 或 :: 的行可从外部访问。",
      dotExposed: "可从外部访问",
      dotLocal: "仅本机",
    },
  };

  const SCOPE_KEY = {
    "loopback": "scopeLoopback",
    "all interfaces": "scopeAll",
    "private": "scopePrivate",
    "multicast": "scopeMulticast",
    "specific": "scopeSpecific",
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    badge: $("badge"),
    langSelect: $("lang-select"),
    portForm: $("port-form"),
    portInput: $("port-input"),
    refresh: $("refresh-btn"),
    autoWrap: $("auto-wrap"),
    auto: $("auto-toggle"),
    retry: $("retry-btn"),
    dashboard: $("dashboard"),
    setup: $("setup"),
    setupRetry: $("setup-retry"),
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
    // setup commands (cmd-quick/install/manage are stable; probe-target and
    // cmd-env-port live inside i18n-html blocks and are re-queried each sync)
    cmdQuick: $("cmd-quick"), cmdInstall: $("cmd-install"),
  };

  let currentLang = (() => {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored && translations[stored]) return stored;
    return (navigator.language || "en").toLowerCase().startsWith("zh") ? "zh" : "en";
  })();
  let port = readPort();
  let autoRefresh = localStorage.getItem(AUTO_KEY) !== "0";
  let timer = null;
  let mode = "checking"; // checking | online | offline
  let rows = [];
  let sortKey = "port";
  let sortDir = 1; // 1 asc, -1 desc

  // ---------- i18n ----------
  function t(key, params) {
    const dict = translations[currentLang] || translations.en;
    let s = dict[key] != null ? dict[key] : (translations.en[key] != null ? translations.en[key] : key);
    if (params) for (const p in params) s = s.split(`{${p}}`).join(params[p]);
    return s;
  }
  function scopeLabel(scope) {
    const k = SCOPE_KEY[scope];
    return k ? t(k) : scope;
  }
  function applyI18n() {
    const dict = translations[currentLang] || translations.en;
    document.documentElement.lang = currentLang === "zh" ? "zh-CN" : "en";
    if (dict.metaTitle) document.title = dict.metaTitle;
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const v = dict[el.dataset.i18n];
      if (v != null) el.textContent = v;
    });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => {
      const v = dict[el.dataset.i18nHtml];
      if (v != null) el.innerHTML = v;
    });
    document.querySelectorAll("[data-i18n-ph]").forEach((el) => {
      const v = dict[el.dataset.i18nPh];
      if (v != null) el.placeholder = v;
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const v = dict[el.dataset.i18nTitle];
      if (v != null) el.title = v;
    });
  }
  function applyLanguage() {
    applyI18n();
    updateSortIndicators();   // headers were reset by applyI18n; re-add arrow
    syncSetupCommands();      // probe-target / cmd-env-port were recreated
    // Re-render the dynamic strings for the current state in the new language.
    if (mode === "online") refresh().catch(() => setOffline());
    else if (mode === "offline") setOffline();
    else setChecking();
  }

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
    const tm = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(base() + path, { mode: "cors", signal: ctrl.signal });
      if (!res.ok) throw new Error(res.status + " " + res.statusText);
      return await res.json();
    } finally {
      clearTimeout(tm);
    }
  }

  // ---------- view switching ----------
  function setBadge(state, text) {
    els.badge.className = "badge " + state;
    const textEl = els.badge.querySelector(".badge-text");
    if (textEl) textEl.textContent = text;
    else els.badge.textContent = text;
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
    setBadge("checking", t("badgeChecking"));
    els.connDetail.textContent = t("connProbing", { port });
  }
  function setOffline() {
    mode = "offline";
    setBadge("offline", t("badgeOffline", { port }));
    showDashboard(false);
    syncSetupCommands();
    els.connDetail.textContent = t("connNoResp", { port });
    // Keep polling while auto-refresh is on: the next /api/ports call doubles
    // as a reconnect probe, so the dashboard recovers on its own when the
    // agent comes back. Only stop polling when the user disabled auto.
    if (autoRefresh) startAuto();
    else if (timer) { clearInterval(timer); timer = null; }
  }
  function setOnline(detail) {
    mode = "online";
    setBadge("online", t("badgeConnected", { port }));
    showDashboard(true);
    if (detail) els.connDetail.textContent = detail;
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
      const s = currentLang === "en" ? (exposed === 1 ? "" : "s") : "";
      els.exposedAlertText.innerHTML = t("alertText", { n: esc(exposed), s });
    } else {
      els.exposedAlert.hidden = true;
    }
    if (!free || !free.length) {
      els.sFree.innerHTML = `<span class="none">${esc(t("freeNone"))}</span>`;
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
    els.rowCount.textContent = t("rowCount", { n: view.length, total: rows.length });
  }

  function rowHtml(r) {
    const exposedTag = r.exposed ? " exposed" : "";
    const dot = `<span class="dot ${r.exposed ? "warn" : ""}" title="${esc(r.exposed ? t("dotExposed") : t("dotLocal"))}"></span>`;
    const scope = `<span class="pill ${scopeClass(r.scope)}">${esc(scopeLabel(r.scope))}</span>`;
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
        ? t("footUnresolved", { time: stamp, n: unresolved })
        : t("footPlain", { time: stamp });
      setOnline(t("connConnected", { n: rows.length, time: stamp }));
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
    // probe-target and cmd-env-port live inside i18n-html blocks, so re-query.
    const probe = $("probe-target");
    const envPort = $("cmd-env-port");
    if (probe) probe.textContent = `127.0.0.1:${port}`;
    if (envPort) envPort.textContent = `PORTSCOPE_PORT=${port}`;
    els.cmdQuick.textContent =
      `git clone https://github.com/LueApp/portscope.git\n` +
      `cd portscope\n` +
      `PORTSCOPE_PORT=${port} PORTSCOPE_ALLOWED_ORIGINS="${allowed}" python3 -m portscope.app`;
    els.cmdInstall.textContent =
      `cd portscope\n` +
      `PORTSCOPE_PORT=${port} PORTSCOPE_ALLOWED_ORIGINS="${allowed}" ./install.sh${portArg}`;
  }

  // ---------- events ----------
  els.langSelect.addEventListener("change", () => {
    currentLang = translations[els.langSelect.value] ? els.langSelect.value : "en";
    localStorage.setItem(LANG_KEY, currentLang);
    applyLanguage();
  });
  els.portForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = Number(els.portInput.value);
    if (!Number.isInteger(v) || v < 1 || v > 65535) { setBadge("offline", t("badgePortRange")); return; }
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
      else { sortKey = key; sortDir = 1; }
      updateSortIndicators();
      applyView();
    });
  });
  document.querySelectorAll(".copy").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const text = $(btn.dataset.copy)?.textContent || "";
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = t("copied"); btn.classList.add("done");
        setTimeout(() => { btn.textContent = t("copy"); btn.classList.remove("done"); }, 1400);
      } catch { /* clipboard blocked; ignore */ }
    });
  });

  // ---------- init ----------
  els.portInput.value = String(port);
  els.auto.checked = autoRefresh;
  els.langSelect.value = currentLang;
  applyI18n();
  updateSortIndicators();
  syncSetupCommands();
  connect();
})();
