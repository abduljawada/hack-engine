(() => {
  "use strict";
  const api = globalThis.browser ?? globalThis.chrome;
  const types = new Set(["i8", "u8", "i16", "u16", "i32", "u32", "f32", "f64"]);
  const host = document.createElement("section");
  host.className = "session-tools";
  host.innerHTML = `
    <div class="session-target" aria-live="polite"></div>
    <div class="session-actions">
      <button type="button" data-action="undo" disabled>Undo scan</button>
      <button type="button" data-action="stop" title="Freezes also stop when the game tab is hidden or the extension disconnects">Stop all freezes <span data-count>0</span></button>
      <button type="button" data-action="restore" disabled>Restore last write</button>
    </div>
    <p class="session-feedback" role="status"></p>
    <details><summary>Saved workspaces</summary>
      <label>Workspace name <input data-name maxlength="80" placeholder="My game"></label>
      <div class="session-actions"><button type="button" data-action="save">Save locally</button><button type="button" data-action="export">Export</button><button type="button" data-action="import">Import</button></div>
      <label>Saved workspace <select data-saved><option value="">Choose a workspace</option></select></label>
      <div class="session-actions"><button type="button" data-action="load">Load preview</button><button type="button" data-action="delete">Delete saved copy</button></div>
      <div data-preview hidden>
        <p data-preview-summary></p><pre data-preview-values></pre>
        <label>Current game memory <select data-target></select></label>
        <label class="verification"><input type="checkbox" data-verified> I have verified these addresses belong to the selected game session.</label>
        <button type="button" data-action="apply">Use verified addresses</button>
      </div>
      <input data-file type="file" accept="application/json,.json" hidden>
    </details>
    <button class="practice-action" type="button" data-action="practice">Open practice game</button>`;
  (document.querySelector("header") || document.querySelector("main") || document.body).after(host);
  const el = (selector) => host.querySelector(selector);
  const action = (name) => el(`[data-action="${name}"]`);
  let port, tabId, tab, session, workspace = { watches: [], frozenKeys: [] }, staged, stopped = false;
  let reconnectTimer;
  let pendingImport = null;
  let sequence = 0;
  const memories = new Map();
  const pendingWatches = new Map();
  const removedWatches = new Set();
  const pendingCommands = new Map();
  const watchKey = (watch) => `${watch.frameId}:${watch.instanceId}:${watch.type}:${watch.address}`;
  document.addEventListener("hack-engine-workspace-edit", ({ detail }) => {
    if (detail.requestId) pendingCommands.set(detail.requestId, (detail.watches || [detail.watch]).filter(Boolean).map(watchKey));
    if (detail.action === "removeWatch") { pendingWatches.delete(detail.key); removedWatches.add(detail.key); }
    for (const watch of detail.action === "upsertWatch" ? [detail.watch] : detail.action === "mergeWatches" ? detail.watches : []) {
      pendingWatches.set(watchKey(watch), { ...watch }); removedWatches.delete(watchKey(watch));
    }
  });
  document.addEventListener("hack-engine-workspace-result", ({ detail }) => {
    if (!pendingCommands.has(detail.requestId)) return;
    const liveKeys = new Set(detail.acceptedKeys || (workspace.watches || []).map(watchKey));
    for (const key of pendingCommands.get(detail.requestId)) if (!liveKeys.has(key)) pendingWatches.delete(key);
    pendingCommands.delete(detail.requestId);
  });
  const notice = (text) => { el(".session-feedback").textContent = text; };
  const requestId = () => `quick:tools:${Date.now()}:${++sequence}`;
  function send(payload, frameId) {
    if (!port) return notice("Reconnecting to this game…");
    try { port.postMessage({ kind: "routeCommand", frameId, payload: { requestId: requestId(), ...payload } }); }
    catch { notice("Connection lost. Reconnecting…"); }
  }
  function refresh() {
    action("undo").disabled = !port || session?.status !== "complete" || !session?.results?.canUndo;
    action("restore").disabled = !port || !workspace.lastWrite;
    action("stop").disabled = !port;
    el("[data-count]").textContent = String(workspace.frozenKeys?.length || 0);
  }
  function renderTargets() {
    const select = el("[data-target]");
    const selected = select.value;
    select.replaceChildren();
    for (const [key, record] of memories) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = `${record.looksLikeRuffle ? "Ruffle" : "WASM"} · frame ${record.frameId} · ${(record.memoryBytes / 1048576).toFixed(1)} MiB · ${record.id.slice(-8)}`;
      select.append(option);
    }
    if (memories.has(selected)) select.value = selected;
    el("[data-verified]").checked = false;
  }
  function connect() {
    if (stopped) return;
    clearTimeout(reconnectTimer);
    try {
      const current = api.runtime.connect({ name: `hack-popup:${tabId}` });
      port = current;
      current.onMessage.addListener((message) => {
        if (message.kind === "workspaceCommandResult" && message.requestId === pendingImport?.requestId) {
          const imported = pendingImport; pendingImport = null; action("apply").disabled = false;
          document.dispatchEvent(new CustomEvent("hack-engine-settings", { detail: imported.settings }));
          if (!message.skipped) { el("[data-preview]").hidden = true; staged = null; }
          notice(`${message.accepted} watches accepted; ${message.skipped} skipped${message.skipped ? " (watch limit reached or invalid address); remove watches before retrying" : ""}. Reset any current scan to use saved settings. Nothing was written or frozen.`);
        }
        if (message.kind === "workspaceCommandResult" && pendingCommands.has(message.requestId)) {
          const liveKeys = new Set((workspace.watches || []).map(watchKey));
          for (const key of pendingCommands.get(message.requestId)) if (!liveKeys.has(key)) pendingWatches.delete(key);
          pendingCommands.delete(message.requestId);
        }
        if (message.kind === "quickSession") session = message.session;
        if (message.kind === "workspaceState") {
          workspace = message.workspace;
          for (const watch of workspace.watches || []) {
            const pending = pendingWatches.get(watchKey(watch));
            if (pending && (pending.label || "") === (watch.label || "") && (pending.group || "") === (watch.group || "")) pendingWatches.delete(watchKey(watch));
          }
          for (const key of removedWatches) if (!(workspace.watches || []).some((watch) => watchKey(watch) === key)) removedWatches.delete(key);
        }
        if (message.kind === "frameConnected") send({ kind: "listInstances" }, message.frameId);
        if (message.kind === "frameDisconnected") {
          for (const [key, record] of memories) if (record.frameId === message.frameId) memories.delete(key);
          renderTargets();
        }
        const payload = message.payload;
        if (message.kind === "pageMessage" && ["instanceList", "instanceCaptured"].includes(payload?.kind)) {
          if (payload.kind === "instanceList") {
            for (const [key, record] of memories) if (record.frameId === message.frameId) memories.delete(key);
          }
          for (const record of payload.instances || [payload.instance]) {
            memories.set(`${message.frameId}:${record.id}`, { ...record, frameId: message.frameId });
          }
          renderTargets();
        }
        if (String(payload?.requestId || "").startsWith("quick:tools:")) {
          if (payload.kind === "error") notice(payload.message);
          if (payload.kind === "writeRestored") notice("Previous bytes restored. This does not roll back the game's overall state.");
          if (payload.kind === "scanResults") notice("Previous scan restored.");
        }
        refresh();
      });
      current.onDisconnect.addListener(() => {
        if (port !== current) return;
        port = null;
        pendingImport = null; action("apply").disabled = false;
        notice("Reconnecting to this game…");
        refresh();
        reconnectTimer = setTimeout(connect, 750);
      });
      send({ kind: "listInstances" });
      refresh();
    } catch { port = null; reconnectTimer = setTimeout(connect, 1000); }
  }
  function validate(payload) {
    if (payload?.format !== "hack-engine-workspace" || payload.version !== 2) throw new Error("Unsupported workspace format.");
    if (!Array.isArray(payload.watches) || payload.watches.length > 256) throw new Error("A workspace supports up to 256 watches.");
    const watches = payload.watches.map((watch) => {
      if (!types.has(watch?.type) || !Number.isSafeInteger(watch.address) || watch.address < 0 || !Number.isFinite(watch.multiplier ?? 1) || (watch.multiplier ?? 1) <= 0) throw new Error("The workspace contains an invalid address or number format.");
      return { type: watch.type, address: watch.address, multiplier: watch.multiplier ?? 1,
        label: String(watch.label || "").slice(0, 80), group: String(watch.group || "").slice(0, 80) };
    });
    return { format: "hack-engine-workspace", version: 2, name: String(payload.name || "Imported workspace").slice(0, 80), watches,
      settings: payload.settings && typeof payload.settings === "object" ? {
        type: [...types, "smart", "auto"].includes(payload.settings.type) ? payload.settings.type : "smart",
        alignment: payload.settings.alignment === "byte" ? "byte" : "aligned",
        multiplier: Number.isFinite(payload.settings.multiplier) && payload.settings.multiplier > 0 ? payload.settings.multiplier : 1,
      } : { type: "smart", alignment: "aligned", multiplier: 1 } };
  }
  function snapshot() {
    const watches = new Map((workspace.watches || []).map((watch) => [watchKey(watch), watch]));
    for (const [key, watch] of pendingWatches) watches.set(key, watch);
    for (const key of removedWatches) watches.delete(key);
    return validate({ format: "hack-engine-workspace", version: 2, name: el("[data-name]").value.trim() || tab?.title || "My game",
      watches: [...watches.values()], settings: session?.request });
  }
  async function saved() { return (await api.storage.local.get("savedWorkspaces")).savedWorkspaces || {}; }
  async function refreshSaved() {
    if (!api.storage?.local) return;
    const items = await saved();
    const select = el("[data-saved]");
    select.replaceChildren(new Option("Choose a workspace", ""));
    for (const [id, value] of Object.entries(items)) select.add(new Option(value.name, id));
  }
  function preview(payload) {
    staged = validate(payload);
    el("[data-preview]").hidden = false;
    host.querySelector("details").open = true;
    el("[data-preview-summary]").textContent = `${staged.name}: ${staged.watches.length} unverified addresses. Reloaded games can move values to different addresses.`;
    el("[data-preview-values]").textContent = staged.watches.map((watch) => `${watch.label || "Watch"} · ${watch.type} · 0x${watch.address.toString(16)}`).join("\n");
    renderTargets();
    notice("Preview only. No values or freezes have been applied.");
  }
  host.addEventListener("click", async (event) => {
    const name = event.target.closest("[data-action]")?.dataset.action;
    try {
      if (name === "undo" && session) send({ kind: "undoScan", instanceId: session.instanceId, type: session.request.type }, session.frameId);
      if (name === "stop") { send({ kind: "stopAllFreezes" }); notice("Stop requested for all freezes in this tab."); }
      if (name === "restore" && workspace.lastWrite) send({ kind: "restoreWrite", ...workspace.lastWrite }, workspace.lastWrite.frameId);
      if (name === "practice") await api.tabs.create({ url: api.runtime.getURL("practice/index.html") });
      if (name === "save") {
        const items = await saved();
        if (Object.keys(items).length >= 30) throw new Error("Remove a saved workspace before adding another (limit: 30).");
        items[crypto.randomUUID()] = snapshot();
        await api.storage.local.set({ savedWorkspaces: items });
        await refreshSaved(); notice("Workspace saved locally. Freezes are never saved.");
      }
      if (name === "load") {
        const value = (await saved())[el("[data-saved]").value];
        if (!value) throw new Error("Choose a saved workspace first.");
        preview(value);
      }
      if (name === "delete") {
        const items = await saved(); delete items[el("[data-saved]").value];
        await api.storage.local.set({ savedWorkspaces: items }); await refreshSaved(); notice("Saved copy deleted; current watches remain.");
      }
      if (name === "export") {
        const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot(), null, 2)], { type: "application/json" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = "hack-engine-workspace.json"; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      if (name === "import") el("[data-file]").click();
      if (name === "apply") {
        if (!port) throw new Error("Wait for the game connection to recover.");
        const record = memories.get(el("[data-target]").value);
        if (!staged || !record || !el("[data-verified]").checked) throw new Error("Select the current game and verify its addresses first.");
        const widths = { i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, f32: 4, f64: 8 };
        if (staged.watches.some((watch) => watch.address + widths[watch.type] > record.memoryBytes)) throw new Error("An address is outside this game's memory.");
        const id = requestId();
        pendingImport = { requestId: id, settings: staged.settings };
        action("apply").disabled = true;
        port.postMessage({ kind: "workspaceCommand", requestId: id, action: "mergeWatches", watches: staged.watches.map((watch) => ({ ...watch, frameId: record.frameId, instanceId: record.id })) });
        notice("Applying verified watches…");
      }
    } catch (error) { pendingImport = null; action("apply").disabled = false; notice(error.message || String(error)); }
  });
  el("[data-file]").addEventListener("change", async () => {
    try {
      const file = el("[data-file]").files[0]; if (!file) return;
      if (file.size > 1048576) throw new Error("Workspace files must be smaller than 1 MiB.");
      preview(JSON.parse(await file.text()));
    } catch (error) { notice(error.message); }
    el("[data-file]").value = "";
  });
  document.addEventListener("hack-engine-import", (event) => {
    try { preview(event.detail); } catch (error) { notice(error.message); }
  });
  window.addEventListener("pagehide", () => { stopped = true; clearTimeout(reconnectTimer); port?.disconnect(); });
  (async () => {
    const parameters = new URLSearchParams(location.search);
    tabId = parameters.has("tabId") ? Number(parameters.get("tabId")) : null;
    tab = tabId === null ? (await api.tabs.query({ active: true, currentWindow: true }))[0] : await api.tabs.get(tabId);
    if (!tab || !Number.isInteger(tab.id)) throw new Error("The inspected tab is no longer available.");
    tabId = tab.id;
    el(".session-target").textContent = `Inspecting: ${tab.title || new URL(tab.url).hostname || "this game"}`;
    connect(); await refreshSaved();
  })().catch((error) => notice(error.message));
})();
