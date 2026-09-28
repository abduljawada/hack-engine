(() => {
  "use strict";
  const api = globalThis.browser ?? globalThis.chrome;
  const host = document.createElement("section");
  host.className = "session-tools";
  host.innerHTML = `
    <div class="session-target" aria-live="polite"></div>
    <div class="session-actions">
      <button type="button" data-action="undo" disabled hidden>Undo scan</button>
      <button type="button" data-action="stop" hidden title="Freezes also stop when the game tab is hidden or the extension disconnects">Stop all freezes <span data-count>0</span></button>
      <button type="button" data-action="restore" disabled hidden title="Restore the value before your most recent write">Undo write</button>
    </div>
    <p class="session-feedback" role="status"></p>`;
  const popupTools = document.querySelector("main > .secondary-actions");
  if (popupTools) popupTools.before(host);
  else (document.querySelector("header") || document.querySelector("main") || document.body).after(host);
  const el = (selector) => host.querySelector(selector);
  const sessionTarget = el(".session-target");
  document.querySelector(".header-copy")?.append(sessionTarget);
  const action = (name) => el(`[data-action="${name}"]`);
  const undoButtons = [action("undo")];
  const scanRows = document.querySelectorAll("#quick-tools > .scan-actions, #advanced-tools > .scan-actions");
  if (scanRows.length) {
    const original = undoButtons.pop();
    for (const row of scanRows) {
      const button = original.cloneNode(true);
      button.className = "compact-action scan-undo";
      button.title = "Restore the candidates from before the last refinement";
      button.addEventListener("click", () => {
        if (session && !button.disabled) send({ kind: "undoScan", instanceId: session.instanceId, type: session.request.type }, session.frameId);
      });
      row.insertBefore(button, row.querySelector('[id^="reset-"]'));
      undoButtons.push(button);
    }
    original.remove();
  }
  const restoreButtons = [];
  const stopButtons = [];
  const restoreTemplate = action("restore");
  const stopTemplate = action("stop");
  for (const write of document.querySelectorAll("#quick-write, #advanced-write")) {
    const button = restoreTemplate.cloneNode(true);
    button.className = "compact-action";
    write.after(button);
    restoreButtons.push(button);
  }
  const tabs = document.querySelector(".workspace-tabs");
  if (tabs) {
    const heading = document.createElement("div");
    heading.className = "workspace-heading";
    tabs.before(heading);
    heading.append(tabs);
    const button = stopTemplate.cloneNode(true);
    button.className = "compact-action";
    heading.append(button);
    stopButtons.push(button);
  }
  const quickEditor = document.querySelector("#quick-editor");
  if (quickEditor) {
    const button = stopTemplate.cloneNode(true);
    button.className = "compact-action stop-freezes";
    quickEditor.after(button);
    stopButtons.push(button);
  }
  restoreTemplate.remove();
  stopTemplate.remove();
  el(".session-actions").remove();
  let port, tabId, tab, session, workspace = { watches: [], frozenKeys: [] }, stopped = false;
  let reconnectTimer;
  let sequence = 0;
  const notice = (text) => { el(".session-feedback").textContent = text; };
  const requestId = () => `quick:tools:${Date.now()}:${++sequence}`;
  function send(payload, frameId) {
    if (!port) return notice("Reconnecting to this game…");
    try { port.postMessage({ kind: "routeCommand", frameId, payload: { requestId: requestId(), ...payload } }); }
    catch { notice("Connection lost. Reconnecting…"); }
  }
  function refresh() {
    const canUndo = Boolean(port && session?.status === "complete" && session?.results?.canUndo);
    for (const button of undoButtons) {
      button.disabled = !canUndo;
      button.hidden = !canUndo;
    }
    for (const button of restoreButtons) {
      button.disabled = !port || !workspace.lastWrite;
      button.hidden = !workspace.lastWrite;
    }
    for (const button of stopButtons) {
      button.disabled = !port;
      button.hidden = !workspace.frozenKeys?.length;
      button.querySelector("[data-count]").textContent = String(workspace.frozenKeys?.length || 0);
    }
  }
  function connect() {
    if (stopped) return;
    clearTimeout(reconnectTimer);
    try {
      const current = api.runtime.connect({ name: `hack-popup:${tabId}` });
      port = current;
      current.onMessage.addListener((message) => {
        if (message.kind === "quickSession") session = message.session;
        if (message.kind === "workspaceState") workspace = message.workspace;
        const payload = message.payload;
        if (String(payload?.requestId || "").startsWith("quick:tools:")) {
          if (payload.kind === "error") notice(payload.message);
          if (payload.kind === "writeRestored") notice("Previous value restored. This does not roll back the game's overall state.");
          if (payload.kind === "scanResults") notice("Previous scan restored.");
        }
        refresh();
      });
      current.onDisconnect.addListener(() => {
        if (port !== current) return;
        port = null;
        notice("Reconnecting to this game…");
        refresh();
        reconnectTimer = setTimeout(connect, 750);
      });
      refresh();
    } catch { port = null; reconnectTimer = setTimeout(connect, 1000); }
  }
  for (const button of [...restoreButtons, ...stopButtons]) button.addEventListener("click", async (event) => {
    const name = event.target.closest("[data-action]")?.dataset.action;
    try {
      if (name === "undo" && session) send({ kind: "undoScan", instanceId: session.instanceId, type: session.request.type }, session.frameId);
      if (name === "stop") { send({ kind: "stopAllFreezes" }); notice("Stop requested for all freezes in this tab."); }
      if (name === "restore" && workspace.lastWrite) send({ kind: "restoreWrite", ...workspace.lastWrite }, workspace.lastWrite.frameId);
    } catch (error) { notice(error.message || String(error)); }
  });
  window.addEventListener("pagehide", () => { stopped = true; clearTimeout(reconnectTimer); port?.disconnect(); });
  (async () => {
    const parameters = new URLSearchParams(location.search);
    tabId = parameters.has("tabId") ? Number(parameters.get("tabId")) : null;
    tab = tabId === null ? (await api.tabs.query({ active: true, currentWindow: true }))[0] : await api.tabs.get(tabId);
    if (!tab || !Number.isInteger(tab.id)) throw new Error("The inspected tab is no longer available.");
    tabId = tab.id;
    sessionTarget.textContent = `Inspecting: ${tab.title || new URL(tab.url).hostname || "this game"}`;
    connect();
  })().catch((error) => notice(error.message));
})();
