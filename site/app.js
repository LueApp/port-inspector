/* portscope dashboard — talks to the local agent over localhost. */
(() => {
  "use strict";

  const DEFAULT_PORT = 8790;
  const PORT_KEY = "portscope.port";
  const AUTO_KEY = "portscope.auto";
  const LANG_KEY = "portscope.lang";
  const REFRESH_MS = 5000;
  const TIMEOUT_MS = 2500;
  const W2L_PORT_KEY = "portscope.w2lPort";
  const W2L_DEFAULT_PORT = 7878;
  // The single-file agent web2local deploys. AGENT_SHA256 MUST equal the
  // sha256 of site/agent.py — web2local's /deploy rejects a content/hash
  // mismatch. smoke_test.py enforces this so the two can't silently drift.
  const AGENT_URL = "agent.py";                 // served from this origin
  const AGENT_FILENAME = "portscope-agent.py";  // on-disk name web2local writes
  const AGENT_SHA256 = "58ef33fdbceec6eca1d9097561ab1c05959125e97939ff8a3b99f806fe5cb982";

  // ---------- translations ----------
  const translations = {
    en: {
      metaTitle: "Port Inspector — what's listening locally",
      brandSub: "what's listening on your machine",
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
      colAction: "Action",
      kill: "Kill",
      killTitle: "Send SIGTERM to PID {pid}",
      killConfirm: "Send SIGTERM to PID {pid} ({process}) on port {port}?",
      killWorking: "Killing…",
      killDone: "Sent {signal} to PID {pid}",
      killDenied: "No permission to kill PID {pid}.",
      killStale: "PID {pid} no longer owns that listener; refreshed.",
      killSelf: "Refused to kill the agent.",
      killDisabled: "Kill is disabled for this agent.",
      killError: "Kill failed: {msg}",
      tableEmpty: "No sockets match the current filters.",
      setupEyebrow: "Local service not detected",
      setupTitle: "Run the local agent to see your ports here.",
      setupLead:
        "A website on its own cannot read your machine's open ports — the browser sandbox forbids it. " +
        "Port Inspector uses a tiny local agent that listens on " +
        '<code id="probe-target">127.0.0.1:8790</code> and serves the port list as JSON. This page reads ' +
        "that agent directly from your browser. Start it once and this page becomes a live dashboard.",
      setupRetry: "I started it — retry",
      viewSource: "View source",
      manualTitle: "Run it yourself (no web2local)",
      manualBody:
        "No web2local? Download the agent and run it — pure Python standard library, nothing to install. " +
        "Set the <strong>Agent port</strong> above to match.",
      manualNote:
        "It binds <code>127.0.0.1</code> only. With <code>--allow-kill</code>, row actions can send SIGTERM after confirmation. Stop the agent with Ctrl-C.",
      copy: "Copy",
      copied: "Copied",
      footerText: "Port Inspector · local port dashboard",
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
      w2lTitle: "Start with web2local",
      w2lBody:
        'Running <a href="https://web2local-bridge.lue-app.com/" target="_blank" rel="noopener noreferrer">web2local</a>? ' +
        "Start the agent from here — no terminal, no install. web2local writes the agent and asks you to approve running it.",
      w2lPortLabel: "web2local port",
      w2lRecheck: "Check",
      w2lStart: "Start agent",
      w2lStop: "Stop agent",
      w2lGet: "Get web2local ↗",
      w2lChecking: "checking…",
      w2lWorking: "working…",
      w2lDetected: "detected",
      w2lAbsent: "not detected",
      w2lRunningChip: "agent running",
      w2lHintIdle:
        "web2local writes + runs the agent and tracks it; Stop ends it. You approve the write + run first.",
      w2lHintAbsent:
        "Not detected on port {port}. Start web2local, or set its port above and click Check.",
      w2lAlreadyRunning: "An agent is already running via web2local (pid {pid}).",
      w2lApprove: "Approve writing + running the agent in web2local's dialog…",
      w2lStarting: "Agent started — connecting…",
      w2lTimeout:
        "Agent started but hasn't answered yet. Check the log below, or that the Agent port above matches.",
      w2lDenied: "Start was denied in web2local.",
      w2lApprovalTimeout:
        "Timed out waiting for approval in web2local. Approve faster, or click Start agent again.",
      w2lOpaqueOrigin:
        "Open this dashboard over http(s) from a real origin to use web2local — it can't start the agent from a file:// page.",
      w2lHashMismatch:
        "The agent served here doesn't match its expected hash — the site may be mid-deploy. Reload and try again.",
      w2lNoPython:
        "web2local couldn't find python3 to run the agent. Install Python 3 (3.7+) and restart web2local.",
      w2lOriginRejected: "web2local rejected this origin. Reload the page and try again.",
      w2lFetchFailed: "Couldn't load the agent from this site. Reload and try again.",
      w2lStopped: "Agent stopped.",
      w2lError: "web2local error: {msg}",
    },
    zh: {
      metaTitle: "Port Inspector — 本地端口面板",
      brandSub: "本机正在监听的端口",
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
      colAction: "操作",
      kill: "结束",
      killTitle: "向 PID {pid} 发送 SIGTERM",
      killConfirm: "向端口 {port} 的 PID {pid}（{process}）发送 SIGTERM？",
      killWorking: "结束中…",
      killDone: "已向 PID {pid} 发送 {signal}",
      killDenied: "没有权限结束 PID {pid}。",
      killStale: "PID {pid} 已不再占用该监听项；已刷新。",
      killSelf: "已拒绝结束当前代理。",
      killDisabled: "当前代理未启用结束进程。",
      killError: "结束失败：{msg}",
      tableEmpty: "没有符合当前筛选的套接字。",
      setupEyebrow: "未检测到本地服务",
      setupTitle: "运行本地代理，即可在此查看端口。",
      setupLead:
        "网页自身无法读取本机的开放端口——浏览器沙箱禁止这样做。Port Inspector 提供一个极小的" +
        "本地代理，监听在 " +
        '<code id="probe-target">127.0.0.1:8790</code>，并以 JSON 提供端口列表。本页面直接从你的浏览器' +
        "读取该代理。启动一次后，本页面即成为实时面板。",
      setupRetry: "已启动，重试",
      viewSource: "查看源码",
      manualTitle: "自行运行（无需 web2local）",
      manualBody:
        "没有 web2local？下载代理并运行——纯 Python 标准库，无需安装。请将上方的" +
        "<strong>代理端口</strong>设为一致。",
      manualNote:
        "它仅绑定 <code>127.0.0.1</code>。使用 <code>--allow-kill</code> 时，行操作可在确认后发送 SIGTERM。按 Ctrl-C 停止代理。",
      copy: "复制",
      copied: "已复制",
      footerText: "Port Inspector · 本地端口面板",
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
      w2lTitle: "用 web2local 启动",
      w2lBody:
        '正在运行 <a href="https://web2local-bridge.lue-app.com/" target="_blank" rel="noopener noreferrer">web2local</a>？' +
        "可直接从这里启动代理——无需终端、无需安装。web2local 会写入代理并请你确认运行。",
      w2lPortLabel: "web2local 端口",
      w2lRecheck: "检查",
      w2lStart: "启动代理",
      w2lStop: "停止代理",
      w2lGet: "获取 web2local ↗",
      w2lChecking: "检查中…",
      w2lWorking: "处理中…",
      w2lDetected: "已检测到",
      w2lAbsent: "未检测到",
      w2lRunningChip: "代理运行中",
      w2lHintIdle: "web2local 会写入并运行这个代理并进行管理；点击停止即可结束。运行前需先确认写入与运行。",
      w2lHintAbsent: "未在端口 {port} 检测到。请启动 web2local，或在上方填写其端口后点击检查。",
      w2lAlreadyRunning: "已有代理通过 web2local 运行（pid {pid}）。",
      w2lApprove: "请在 web2local 的对话框中确认写入并运行代理…",
      w2lStarting: "代理已启动——正在连接…",
      w2lTimeout: "代理已启动但尚无响应。请查看下方日志，或确认上方的代理端口是否一致。",
      w2lDenied: "已在 web2local 中拒绝启动。",
      w2lApprovalTimeout: "等待 web2local 确认超时。请尽快确认，或再次点击启动代理。",
      w2lOpaqueOrigin: "请通过 http(s) 从真实来源打开此面板才能使用 web2local；file:// 页面无法启动代理。",
      w2lHashMismatch: "此处提供的代理与预期哈希不匹配——站点可能正在部署。请刷新后重试。",
      w2lNoPython: "web2local 找不到 python3 来运行代理。请安装 Python 3（3.7+）并重启 web2local。",
      w2lOriginRejected: "web2local 拒绝了此来源。请刷新页面后重试。",
      w2lFetchFailed: "无法从本站点加载代理。请刷新后重试。",
      w2lStopped: "代理已停止。",
      w2lError: "web2local 错误：{msg}",
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
    // setup commands: cmd-manual is the "run it yourself" block; probe-target
    // lives inside an i18n-html block and is re-queried each sync.
    cmdManual: $("cmd-manual"),
    // web2local card
    w2lCard: $("w2l-card"), w2lStatus: $("w2l-status"), w2lPortInput: $("w2l-port"),
    w2lRecheck: $("w2l-recheck"), w2lStart: $("w2l-start"), w2lStop: $("w2l-stop"),
    w2lGet: $("w2l-get"),            // "Get web2local" link, shown when it isn't detected
    w2lStopTop: $("w2l-stop-top"),   // Stop control in the header, shown on the live dashboard
    w2lMsg: $("w2l-msg"), w2lLog: $("w2l-log"),
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
  let canKill = false;
  let sortKey = "port";
  let sortDir = 1; // 1 asc, -1 desc
  let w2lPort = readW2lPort();
  let w2lState = "checking";   // checking|absent|present|running|starting|approving|error
  let w2lAgentPid = null;
  let w2lBusy = false;         // true while a start/stop is mid-flight
  let w2lMsgKey = null, w2lMsgParams = null;

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
    syncSetupCommands();      // probe-target was recreated by applyI18n
    renderW2lText();          // re-translate the web2local card chip + message
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
  async function apiPost(path, body) {
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(base() + path, {
        method: "POST",
        mode: "cors",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      let data = {};
      try { data = await res.json(); } catch { /* tolerate non-JSON errors */ }
      if (!res.ok) {
        const err = new Error(data.error || `${res.status} ${res.statusText}`);
        err.code = data.code || "";
        err.status = res.status;
        throw err;
      }
      return data;
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
    // The header Stop control is dashboard-only; refreshStopControl() reveals it
    // when the live agent is one web2local can actually stop.
    if (!on && els.w2lStopTop) els.w2lStopTop.hidden = true;
  }

  function setChecking() {
    mode = "checking";
    setBadge("checking", t("badgeChecking"));
    els.connDetail.textContent = t("connProbing", { port });
  }
  function setOffline() {
    const was = mode;
    mode = "offline";
    canKill = false;
    setBadge("offline", t("badgeOffline", { port }));
    showDashboard(false);
    syncSetupCommands();
    // Probe web2local once on entering the setup view — not on every failed
    // poll while already offline (that would clobber an in-progress start).
    if (was !== "offline") refreshW2lCard();
    els.connDetail.textContent = t("connNoResp", { port });
    // Keep polling while auto-refresh is on: the next /api/ports call doubles
    // as a reconnect probe, so the dashboard recovers on its own when the
    // agent comes back. Only stop polling when the user disabled auto.
    if (autoRefresh) startAuto();
    else if (timer) { clearInterval(timer); timer = null; }
  }
  function setOnline(detail) {
    const was = mode;
    mode = "online";
    setBadge("online", t("badgeConnected", { port }));
    showDashboard(true);
    if (detail) els.connDetail.textContent = detail;
    // One-shot when we *just* connected (not on every 5s refresh tick): if this
    // live agent is one web2local spawned, reveal the header Stop control.
    if (was !== "online") refreshStopControl();
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
    const action = (canKill && r.killable && r.pid != null)
      ? `<td class="action-cell"><button class="row-kill" type="button"
           data-pid="${esc(r.pid)}" data-port="${esc(r.port)}" data-protocol="${esc(r.protocol)}"
           data-process="${esc(r.process || "")}"
           title="${esc(t("killTitle", { pid: r.pid }))}">${esc(t("kill"))}</button></td>`
      : `<td class="action-cell dash">—</td>`;
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
      ${action}
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

  function killErrorText(err, pid) {
    if (err.code === "permission_denied") return t("killDenied", { pid });
    if (err.code === "stale_listener" || err.code === "process_gone") return t("killStale", { pid });
    if (err.code === "refused_self" || err.code === "refused_pid") return t("killSelf");
    if (err.code === "kill_disabled") return t("killDisabled");
    return t("killError", { msg: err.message || String(err) });
  }

  async function killListener(btn) {
    const pid = Number(btn.dataset.pid);
    const rowPort = Number(btn.dataset.port);
    const protocol = btn.dataset.protocol || "";
    const procName = btn.dataset.process || `PID ${pid}`;
    if (!Number.isInteger(pid) || !Number.isInteger(rowPort)) return;
    if (!window.confirm(t("killConfirm", { pid, port: rowPort, process: procName }))) return;

    btn.disabled = true;
    btn.textContent = t("killWorking");
    try {
      const data = await apiPost("/api/kill", {
        pid,
        port: rowPort,
        protocol,
        signal: "SIGTERM",
      });
      await refresh();
      els.connDetail.textContent = t("killDone", { pid, signal: data.signal || "SIGTERM" });
    } catch (err) {
      try { await refresh(); } catch { /* keep the error visible if refresh also failed */ }
      els.connDetail.textContent = killErrorText(err, pid);
    } finally {
      if (document.body.contains(btn)) {
        btn.disabled = false;
        btn.textContent = t("kill");
      }
    }
  }

  // ---------- data flow ----------
  async function refresh() {
    try {
      const data = await api("/api/ports");
      rows = Array.isArray(data.listeners) ? data.listeners : [];
      canKill = !!data.capabilities?.kill_processes;
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
      canKill = !!health.capabilities?.kill_processes;
      await refresh();
      if (autoRefresh) startAuto();
    } catch (err) {
      setOffline();
    }
  }

  function startAuto() {
    if (timer) clearInterval(timer);
    // Skip the reconnect tick during a web2local start/stop so it can't flip to
    // the dashboard mid-flight and race pollAgentUp()/connect().
    timer = setInterval(() => { if (mode !== "checking" && !w2lBusy) refresh(); }, REFRESH_MS);
  }

  // ---------- setup commands (origin-aware so CORS works on this page) ----------
  function syncSetupCommands() {
    const origin = window.location.origin;
    // probe-target lives inside an i18n-html block, so re-query each call.
    const probe = $("probe-target");
    if (probe) probe.textContent = `127.0.0.1:${port}`;
    // The "run it yourself" fallback: download agent.py from this very origin
    // and run it on the chosen port, allowlisting this origin for CORS.
    if (els.cmdManual) {
      els.cmdManual.textContent =
        `curl -fsSL -o ${AGENT_FILENAME} ${origin}/${AGENT_URL}\n` +
        `python3 ${AGENT_FILENAME} serve --port ${port} --allow-origin ${origin} --allow-kill`;
    }
  }

  // ---------- web2local integration ----------
  // web2local (https://github.com/LueApp/web2local) is a generic local daemon
  // that lets an allowlisted website deliver + run local commands under a user
  // approval dialog. One-click start: fetch our single-file agent from this
  // origin, add this origin to web2local's graylist (its ungated config
  // endpoint), POST /deploy {source, sha256, …} so web2local writes the file and
  // — after the user approves the write + run — spawns it, then poll until the
  // agent answers. web2local owns the agent process
  // (/ps, /logs, /stop). The dashboard never runs anything itself.
  function readW2lPort() {
    const stored = Number(localStorage.getItem(W2L_PORT_KEY));
    return Number.isInteger(stored) && stored >= 1 && stored <= 65535 ? stored : W2L_DEFAULT_PORT;
  }
  function w2lBase() { return `http://127.0.0.1:${w2lPort}`; }
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  function buildAllowedOrigins() {
    return [window.location.origin, "http://localhost:4321", "http://127.0.0.1:4321"]
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(",");
  }
  // A file:// page has an opaque origin ("null") the agent's CORS can never
  // accept; starting from there would only persist a junk "null" graylist entry
  // in web2local and dead-end. web2local needs a real http(s) origin.
  function w2lOriginUsable() {
    return window.location.origin !== "null" &&
           /^https?:$/i.test(window.location.protocol);
  }

  // Fetch our single-file agent from this origin and verify it matches the
  // pinned hash *before* handing it to web2local — turns a stale-deploy mismatch
  // into a clear message instead of web2local's generic content rejection.
  async function fetchAgentSource() {
    let res;
    try {
      res = await fetch(new URL(AGENT_URL, document.baseURI).href, { cache: "no-store" });
    } catch { const e = new Error("agent fetch failed"); e.code = "fetch"; throw e; }
    if (!res.ok) { const e = new Error("agent fetch failed"); e.code = "fetch"; throw e; }
    const source = await res.text();
    const got = await sha256Hex(source);
    if (got && got !== AGENT_SHA256) { const e = new Error("agent hash mismatch"); e.code = "hash"; throw e; }
    return source;
  }
  async function sha256Hex(text) {
    // Secure contexts only (https / localhost / 127.0.0.1) — all valid here. If
    // crypto.subtle is unavailable, skip the local check; web2local re-verifies.
    if (!(window.crypto && crypto.subtle)) return null;
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function w2lFetch(path, opts, timeoutMs) {
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), timeoutMs || 4000);
    try {
      return await fetch(w2lBase() + path, { mode: "cors", signal: ctrl.signal, ...(opts || {}) });
    } finally {
      clearTimeout(tm);
    }
  }
  async function w2lPostJson(path, body, timeoutMs) {
    const res = await w2lFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    }, timeoutMs);
    let data = {};
    try { data = await res.json(); } catch { /* tolerate empty/non-JSON */ }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  const W2L_CHIP = {
    checking: "w2lChecking", absent: "w2lAbsent", present: "w2lDetected",
    running: "w2lRunningChip", starting: "w2lWorking", approving: "w2lWorking",
    error: "w2lAbsent",
  };
  function setW2lState(state) {
    w2lState = state;
    if (els.w2lStatus) {
      els.w2lStatus.dataset.state = state;
      els.w2lStatus.textContent = t(W2L_CHIP[state] || "w2lChecking");
    }
    const reachable = state === "present" || state === "running" ||
                      state === "starting" || state === "approving";
    const busy = state === "checking" || state === "starting" || state === "approving";
    if (els.w2lStart) els.w2lStart.disabled = !reachable || busy || state === "running";
    if (els.w2lStop) els.w2lStop.hidden = state !== "running";
    // Offer the "Get web2local" link exactly when it isn't reachable.
    if (els.w2lGet) els.w2lGet.hidden = !(state === "absent" || state === "error");
  }
  function setW2lMsg(key, params) {
    w2lMsgKey = key; w2lMsgParams = params || null;
    if (els.w2lMsg) els.w2lMsg.textContent = key ? t(key, params) : "";
  }
  function renderW2lText() {
    // Re-apply chip + message in the current language (called on lang switch).
    setW2lState(w2lState);
    if (els.w2lMsg) els.w2lMsg.textContent = w2lMsgKey ? t(w2lMsgKey, w2lMsgParams) : "";
  }

  async function w2lFindAgentPid(forPort) {
    // Snapshot the target port so a port change mid-probe (the global `port`
    // can change across the awaits below) can't make us search the wrong port.
    const want = String(forPort != null ? forPort : port);
    try {
      const res = await w2lFetch("/ps");
      if (!res.ok) return null;
      const { processes } = await res.json();
      if (!Array.isArray(processes)) return null;
      // web2local spawns ["python3", "<dir>/<sha8>-portscope-agent.py", "serve",
      // "--port", N, …]. Match our agent file AND this dashboard's port, so Stop
      // never targets an instance on another port. (--port and its value are
      // separate argv entries.)
      const hit = processes.find((p) => {
        const cmd = p.command;
        if (!Array.isArray(cmd)) return false;
        if (!cmd.some((a) => typeof a === "string" && a.endsWith(AGENT_FILENAME))) return false;
        if (!cmd.includes("serve")) return false;
        const i = cmd.indexOf("--port");
        return i >= 0 && String(cmd[i + 1]) === want;
      });
      return hit ? hit.pid : null;
    } catch { return null; }
  }

  let w2lProbing = false;
  async function refreshW2lCard() {
    if (!els.w2lCard || w2lBusy || w2lProbing) return;
    if (!w2lOriginUsable()) {
      setW2lState("absent");        // also disables Start
      setW2lMsg("w2lOpaqueOrigin");
      return;
    }
    w2lProbing = true;
    const probePort = port;   // snapshot: a mid-probe port change must not skew the result
    setW2lState("checking");
    try {
      let ok = false;
      try { ok = (await w2lFetch("/status")).ok; } catch { ok = false; }
      if (!ok) {
        setW2lState("absent");
        setW2lMsg("w2lHintAbsent", { port: w2lPort });
        return;
      }
      const pid = await w2lFindAgentPid(probePort);
      if (pid) {
        w2lAgentPid = pid;
        setW2lState("running");
        setW2lMsg("w2lAlreadyRunning", { pid });
      } else {
        w2lAgentPid = null;
        setW2lState("present");
        setW2lMsg("w2lHintIdle", { port: probePort });
      }
    } finally {
      w2lProbing = false;
    }
  }

  async function pollAgentUp(maxMs) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      try {
        const h = await api("/api/health");
        if (h && h.service === "portscope") return true;
      } catch { /* not up yet */ }
      await sleep(900);
    }
    return false;
  }

  async function showW2lLog(pid) {
    if (!els.w2lLog || !pid) return;
    try {
      const res = await w2lFetch(`/logs?pid=${encodeURIComponent(pid)}`);
      if (!res.ok) return;
      const { tail } = await res.json();
      if (tail) { els.w2lLog.textContent = tail; els.w2lLog.hidden = false; }
    } catch { /* log is best-effort */ }
  }

  function w2lError(err) {
    // An aborted fetch (our own timeout) is a DOMException named AbortError; its
    // message is browser-specific, so key off the name, not the text.
    if (err && err.name === "AbortError") { setW2lMsg("w2lApprovalTimeout"); return; }
    if (err && err.code === "hash") { setW2lMsg("w2lHashMismatch"); return; }
    if (err && err.code === "fetch") { setW2lMsg("w2lFetchFailed"); return; }
    const msg = (err && err.message) || String(err);
    if (/denied/i.test(msg)) setW2lMsg("w2lDenied");
    else if (/hash|sha-?256|mismatch/i.test(msg)) setW2lMsg("w2lHashMismatch");
    else if (/python3|not found|no such file|executable/i.test(msg)) setW2lMsg("w2lNoPython");
    else if (/origin|whitelist|graylist/i.test(msg)) setW2lMsg("w2lOriginRejected");
    else setW2lMsg("w2lError", { msg });
  }

  async function w2lStartAgent() {
    if (w2lBusy) return;
    if (!w2lOriginUsable()) { setW2lMsg("w2lOpaqueOrigin"); return; }
    w2lBusy = true;
    if (els.w2lLog) els.w2lLog.hidden = true;
    setW2lState("approving");
    setW2lMsg("w2lApprove");
    try {
      // 1. Load the single-file agent from our own origin (and verify its hash).
      const source = await fetchAgentSource();
      // 2. Add ourselves to the graylist (ungated) so /deploy is permitted — the
      //    user still approves the write + run in web2local's dialog.
      await w2lPostJson("/config/graylist", { origin: window.location.origin });
      // 3. web2local writes the file, then spawns `python3 <file> serve …`.
      const args = ["serve", "--host", "127.0.0.1", "--port", String(port),
                    "--allow-origin", buildAllowedOrigins(), "--allow-kill"];
      // Long timeout, above web2local's ~135s approval cap, so a slow (or queued)
      // approval isn't aborted out from under the user.
      const res = await w2lPostJson("/deploy", {
        source, sha256: AGENT_SHA256, filename: AGENT_FILENAME,
        command: "python3", args,
      }, 150000);
      // A fresh spawn and {already_running:true} (same file already up) both just
      // need a health poll on our port below; the poll handles either case.
      w2lAgentPid = res.pid || null;
      setW2lState("starting");
      setW2lMsg("w2lStarting");
      const up = await pollAgentUp(15000);
      if (up) { connect(); return; }     // flips the page to the dashboard
      setW2lState("running");
      setW2lMsg("w2lTimeout");
      showW2lLog(w2lAgentPid);
    } catch (err) {
      setW2lState(w2lAgentPid ? "running" : "present");
      w2lError(err);
    } finally {
      w2lBusy = false;
    }
  }

  async function w2lStopAgent() {
    if (w2lBusy) return;
    w2lBusy = true;
    let stopped = false;
    try {
      // Recover the pid if we lost it (a start that timed out, or a /deploy that
      // returned none) by asking web2local's /ps — so Stop is never a no-op while
      // the card shows "running".
      const pid = w2lAgentPid || await w2lFindAgentPid(port);
      if (pid) {
        await w2lPostJson("/stop", { pid });
        w2lAgentPid = null;
        if (els.w2lLog) els.w2lLog.hidden = true;
        stopped = true;
      }
    } catch (err) {
      w2lError(err);   // leave the error visible; agent may still be running
    } finally {
      w2lBusy = false;
    }
    // w2lBusy is false now, so refreshW2lCard re-detects the true state.
    await refreshW2lCard();
    if (stopped) setW2lMsg("w2lStopped");
  }

  // The live dashboard hides the setup screen (and its Stop button), so surface a
  // Stop control in the header — but only for an agent web2local is tracking.
  // Probe /ps once when we connect; reveal Stop + remember the pid if our
  // current-port agent is there. A manually-launched agent isn't in web2local's
  // registry, so no button appears — you stop those where you started them.
  async function refreshStopControl() {
    if (!els.w2lStopTop) return;
    if (mode !== "online" || !w2lOriginUsable()) { els.w2lStopTop.hidden = true; return; }
    const probePort = port;
    let pid = null;
    try {
      if ((await w2lFetch("/status")).ok) pid = await w2lFindAgentPid(probePort);
    } catch { pid = null; }
    // Drop the result if we left online or the port changed during the probe.
    if (mode !== "online" || port !== probePort) return;
    if (pid) { w2lAgentPid = pid; els.w2lStopTop.hidden = false; }
    else { els.w2lStopTop.hidden = true; }
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
  if (els.w2lPortInput) {
    els.w2lPortInput.addEventListener("change", () => {
      const v = Number(els.w2lPortInput.value);
      if (Number.isInteger(v) && v >= 1 && v <= 65535) {
        w2lPort = v;
        localStorage.setItem(W2L_PORT_KEY, String(w2lPort));
      }
      refreshW2lCard();
    });
  }
  if (els.w2lRecheck) els.w2lRecheck.addEventListener("click", () => refreshW2lCard());
  if (els.w2lStart) els.w2lStart.addEventListener("click", () => w2lStartAgent());
  if (els.w2lStop) els.w2lStop.addEventListener("click", () => w2lStopAgent());
  if (els.w2lStopTop) els.w2lStopTop.addEventListener("click", async () => {
    els.w2lStopTop.disabled = true;
    try { await w2lStopAgent(); } finally { els.w2lStopTop.disabled = false; }
    connect();   // agent should be down now → page falls back to the setup screen
  });
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
  els.body.addEventListener("click", (e) => {
    const target = e.target instanceof Element ? e.target : e.target.parentElement;
    const btn = target?.closest(".row-kill");
    if (btn) killListener(btn);
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
  if (els.w2lPortInput) els.w2lPortInput.value = String(w2lPort);
  applyI18n();
  updateSortIndicators();
  syncSetupCommands();
  if (els.w2lCard) setW2lState("checking");  // paint the chip; setOffline() probes
  connect();
})();
