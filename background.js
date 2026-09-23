(() => {
  "use strict";

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const clients = new Map();
  const bridges = new Map();
  const quickSessions = new Map();
  const scanBaselines = new Map();
  const workspaces = new Map();
  const MAX_SHARED_WATCHES = 256;
  const sessionStorage = extensionApi.storage?.session;
  let storageReady = !sessionStorage;
  let persistence = Promise.resolve();
  const hydration = sessionStorage ? sessionStorage.get("liveWorkspaces").then((data) => {
    for (const [tabId, value] of Object.entries(data.liveWorkspaces || {})) {
      if (!Number.isSafeInteger(Number(tabId)) || !Array.isArray(value.watches)) continue;
      workspaces.set(Number(tabId), { watches: new Map(value.watches.map(normalizeWatch).filter(Boolean).map((watch) => [watch.key, watch])),
        selectedKey: value.selectedKey || null, frozenKeys: new Set(), lastWrite: null, diagnostics: {} });
    }
  }).catch(() => {}).finally(() => { storageReady = true; }) : Promise.resolve();

  function persistWorkspaces() {
    if (!sessionStorage) return;
    const value = Object.fromEntries([...workspaces].map(([tabId, workspace]) => [tabId,
      { watches: [...workspace.watches.values()], selectedKey: workspace.selectedKey }]));
    persistence = persistence.catch(() => {}).then(() => sessionStorage.set({ liveWorkspaces: value })).catch(() => {});
  }

  function bridgeKey(tabId, frameId) {
    return `${tabId}:${frameId}`;
  }

  function clientsFor(tabId) {
    const numericTabId = Number(tabId);
    if (!clients.has(numericTabId)) {
      clients.set(numericTabId, new Set());
    }
    return clients.get(numericTabId);
  }

  function broadcast(tabId, message) {
    for (const port of clients.get(Number(tabId)) || []) {
      try {
        port.postMessage(message);
      } catch {
        // Disconnect cleanup removes stale clients.
      }
    }
  }

  function quickSessionSnapshot(tabId) {
    return quickSessions.get(Number(tabId)) || null;
  }

  function workspaceFor(tabId) {
    const numericTabId = Number(tabId);
    if (!workspaces.has(numericTabId)) {
      workspaces.set(numericTabId, {
        watches: new Map(),
        selectedKey: null,
        frozenKeys: new Set(),
        diagnostics: {},
      });
    }
    return workspaces.get(numericTabId);
  }

  function workspaceSnapshot(tabId) {
    const workspace = workspaceFor(tabId);
    return {
      watches: [...workspace.watches.values()],
      selectedKey: workspace.selectedKey,
      frozenKeys: [...workspace.frozenKeys],
      lastWrite: workspace.lastWrite || null,
      diagnostics: { ...workspace.diagnostics },
    };
  }

  function watchKey(watch) {
    return `${watch.frameId}:${watch.instanceId}:${watch.type}:${watch.address}`;
  }

  function normalizeWatch(watch) {
    const multiplier = Number(watch?.multiplier);
    if (
      !Number.isInteger(watch?.frameId) ||
      typeof watch.instanceId !== "string" ||
      !["i8", "u8", "i16", "u16", "i32", "u32", "f32", "f64"].includes(watch.type) ||
      !Number.isSafeInteger(watch.address) ||
      watch.address < 0 ||
      !Number.isFinite(multiplier) ||
      multiplier <= 0
    ) {
      return null;
    }
    return {
      key: watchKey(watch),
      frameId: watch.frameId,
      instanceId: watch.instanceId,
      type: watch.type,
      multiplier,
      address: watch.address,
      label: typeof watch.label === "string" ? watch.label.slice(0, 80) : "",
      group: typeof watch.group === "string" ? watch.group.slice(0, 80) : "",
      hint: typeof watch.hint === "string" ? watch.hint : "",
      url: typeof watch.url === "string" ? watch.url : "",
    };
  }

  function broadcastWorkspace(tabId) {
    persistWorkspaces();
    broadcast(tabId, { kind: "workspaceState", workspace: workspaceSnapshot(tabId) });
  }

  function updateWorkspace(tabId, message) {
    let accepted = 0;
    let skipped = 0;
    const workspace = workspaceFor(tabId);
    const watch = normalizeWatch(message.watch);
    if (message.action === "upsertWatch" && watch) {
      if (workspace.watches.has(watch.key) || workspace.watches.size < MAX_SHARED_WATCHES) {
        workspace.watches.set(watch.key, watch);
        accepted++;
        if (message.select) {
          workspace.selectedKey = watch.key;
        }
      } else skipped++;
    } else if (message.action === "upsertWatch") {
      skipped++;
    } else if (message.action === "mergeWatches" && Array.isArray(message.watches)) {
      for (const value of message.watches) {
        const merged = normalizeWatch(value);
        if (!merged || (!workspace.watches.has(merged.key) && workspace.watches.size >= MAX_SHARED_WATCHES)) {
          skipped++;
          continue;
        }
        workspace.watches.set(merged.key, merged);
        accepted++;
      }
    } else if (message.action === "removeWatch" && typeof message.key === "string") {
      if (!workspace.frozenKeys.has(message.key)) {
        workspace.watches.delete(message.key);
        if (workspace.selectedKey === message.key) {
          workspace.selectedKey = null;
        }
      }
    } else if (message.action === "select" && typeof message.key === "string") {
      workspace.selectedKey = workspace.watches.has(message.key) ? message.key : null;
    }
    broadcastWorkspace(tabId);
    return { kind: "workspaceCommandResult", requestId: message.requestId, accepted, skipped };
  }

  function rememberQuickCommand(tabId, frameId, payload) {
    const numericTabId = Number(tabId);
    if (payload?.kind === "resetScan") {
      quickSessions.delete(numericTabId);
      scanBaselines.delete(numericTabId);
      broadcast(numericTabId, { kind: "quickSession", session: null });
      return;
    }
    if (payload?.kind !== "memoryScan") {
      return;
    }
    const prior = quickSessions.get(numericTabId);
    if (payload.refine && prior?.canRefine && prior.frameId === frameId && prior.instanceId === String(payload.instanceId)) {
      scanBaselines.set(numericTabId, prior);
    } else scanBaselines.delete(numericTabId);
    quickSessions.set(numericTabId, {
      requestId: payload.requestId,
      frameId,
      instanceId: String(payload.instanceId),
      status: "scanning",
      canRefine: Boolean(payload.refine),
      request: {
        condition: payload.condition,
        rawValue: payload.rawValue,
        rawMaxValue: payload.rawMaxValue,
        multiplier: payload.multiplier,
        alignment: payload.alignment,
        type: payload.type,
        refine: Boolean(payload.refine),
      },
      progress: null,
      results: null,
      error: null,
    });
    broadcast(numericTabId, {
      kind: "quickSession",
      session: quickSessionSnapshot(numericTabId),
    });
  }

  function rememberQuickPayload(entry, payload) {
    const session = quickSessions.get(entry.tabId);
    if (!session || entry.frameId !== session.frameId || payload?.requestId !== session.requestId) {
      return;
    }
    if (payload.kind === "scanProgress") {
      session.progress = payload;
    } else if (payload.kind === "scanResults") {
      scanBaselines.delete(entry.tabId);
      session.status = "complete";
      session.canRefine = true;
      session.results = payload;
      session.progress = null;
    } else if (payload.kind === "scanCancelled") {
      session.status = "cancelled";
      session.progress = null;
    } else if (payload.kind === "error") {
      session.status = "error";
      session.error = payload.message || "The scan failed.";
      session.progress = null;
    }
    if (["scanCancelled", "error"].includes(payload.kind)) {
      const baseline = scanBaselines.get(entry.tabId);
      scanBaselines.delete(entry.tabId);
      if (baseline) {
        quickSessions.set(entry.tabId, baseline);
        broadcast(entry.tabId, { kind: "quickSession", session: baseline });
        return;
      }
    }
    broadcast(entry.tabId, { kind: "quickSession", session });
  }

  function rememberWriteCommand(tabId, frameId, payload) {
    const workspace = workspaceFor(tabId);
    if (payload.kind !== "writeValue" || typeof payload.requestId !== "string") return;
    const key = watchKey({ ...payload, frameId });
    delete workspace.diagnostics[key];
    workspace.diagnostics[key] = { requestId: payload.requestId, state: "checking", detail: "Checking whether the game keeps this value." };
    const keys = Object.keys(workspace.diagnostics);
    if (keys.length > MAX_SHARED_WATCHES + 1) {
      const removable = keys.find((item) => item !== key && !workspace.watches.has(item)) || keys[0];
      delete workspace.diagnostics[removable];
    }
    broadcastWorkspace(tabId);
  }

  function rememberWritePayload(entry, payload) {
    if (!["writeComplete", "writeVerified", "writeDiagnostic", "writeRestored", "error"].includes(payload?.kind)) return false;
    const workspace = workspaceFor(entry.tabId);
    if (payload.kind === "error") {
      for (const [key, diagnostic] of Object.entries(workspace.diagnostics)) {
        if (key.startsWith(`${entry.frameId}:`) && diagnostic.requestId === payload.requestId) {
          workspace.diagnostics[key] = { requestId: payload.requestId, state: "rejected", detail: payload.message || "The write failed." };
          broadcastWorkspace(entry.tabId);
        }
      }
      return false;
    }
    const key = watchKey({ ...payload, frameId: entry.frameId });
    if (payload.kind === "writeRestored") {
      delete workspace.diagnostics[key];
      broadcastWorkspace(entry.tabId);
      return true;
    }
    const diagnostic = workspace.diagnostics[key];
    if (!diagnostic || diagnostic.requestId !== payload.requestId) return true;
    if (payload.kind === "writeComplete") {
      if (diagnostic.state !== "checking") return true;
      diagnostic.value = payload.value;
    } else if (payload.kind === "writeVerified") {
      // Early verification is provisional; the final multi-frame diagnosis wins.
      if (diagnostic.state !== "checking") return true;
      diagnostic.value = payload.actualValue;
      diagnostic.detail = payload.persisted ? "Value held at 75 ms; checking through 250 ms." : "Value changed at 75 ms; checking through 250 ms.";
    } else {
      diagnostic.state = { persistent: "verified", restored: "restored", rejected: "rejected", unavailable: "unavailable" }[payload.classification] || "unavailable";
      const samples = Array.isArray(payload.samples) ? payload.samples : [];
      diagnostic.detail = samples.map((sample) => `${sample.label || sample.stage || "Sample"} (${Math.round(sample.elapsedMs || 0)} ms): ${sample.error || (sample.matches ? "held" : "changed")}`).join("; ");
      const last = samples.at(-1);
      if (last && !last.error) diagnostic.value = last.value;
      else delete diagnostic.value;
    }
    broadcastWorkspace(entry.tabId);
    return true;
  }

  function rememberWorkspacePayload(entry, payload) {
    if (rememberWritePayload(entry, payload)) return;
    if (payload?.kind !== "freezeChanged") {
      return;
    }
    const workspace = workspaceFor(entry.tabId);
    const key = watchKey({
      frameId: entry.frameId,
      instanceId: String(payload.instanceId),
      type: payload.type,
      address: payload.address,
    });
    if (payload.enabled) {
      workspace.frozenKeys.add(key);
    } else {
      workspace.frozenKeys.delete(key);
    }
    broadcastWorkspace(entry.tabId);
  }

  function reconcileAgent(entry, state) {
    const ids = new Set((state.instances || []).map((instance) => String(instance.id)));
    const workspace = workspaceFor(entry.tabId);
    for (const [key, watch] of workspace.watches) {
      if (watch.frameId === entry.frameId && !ids.has(watch.instanceId)) workspace.watches.delete(key);
    }
    for (const key of Object.keys(workspace.diagnostics)) {
      if (key.startsWith(`${entry.frameId}:`) && ![...ids].some((id) => key.startsWith(`${entry.frameId}:${id}:`))) delete workspace.diagnostics[key];
    }
    for (const key of workspace.frozenKeys) {
      if (key.startsWith(`${entry.frameId}:`)) workspace.frozenKeys.delete(key);
    }
    for (const freeze of (state.freezes || []).slice(0, MAX_SHARED_WATCHES)) {
      if (ids.has(freeze.instanceId)) workspace.frozenKeys.add(watchKey({ ...freeze, frameId: entry.frameId }));
    }
    if (state.lastWrite) workspace.lastWrite = { ...state.lastWrite, frameId: entry.frameId };
    else if (workspace.lastWrite?.frameId === entry.frameId) workspace.lastWrite = null;
    if (!workspace.watches.has(workspace.selectedKey)) workspace.selectedKey = null;
    const existing = quickSessions.get(entry.tabId);
    if (!existing || existing.frameId === entry.frameId || (state.session?.updatedAt || 0) > (existing.updatedAt || 0)) {
      if (state.session) quickSessions.set(entry.tabId, { ...state.session, frameId: entry.frameId });
      else if (existing?.frameId === entry.frameId) quickSessions.delete(entry.tabId);
      broadcast(entry.tabId, { kind: "quickSession", session: quickSessionSnapshot(entry.tabId) });
    }
    rememberInstances(entry, { kind: "instanceList", instances: state.instances });
    broadcast(entry.tabId, { kind: "pageMessage", frameId: entry.frameId, url: entry.url,
      payload: { kind: "instanceList", instances: state.instances } });
    broadcastWorkspace(entry.tabId);
  }

  function rememberInstances(entry, payload) {
    if (payload?.kind === "instanceCaptured" && payload.instance?.id) {
      entry.instances.set(String(payload.instance.id), payload.instance);
    } else if (payload?.kind === "instanceList" && Array.isArray(payload.instances)) {
      entry.instances.clear();
      for (const instance of payload.instances) {
        if (instance?.id) {
          entry.instances.set(String(instance.id), instance);
        }
      }
    }
  }

  function tabSummary(tabId) {
    const frames = [...bridges.values()].filter((entry) => entry.tabId === Number(tabId));
    const instances = frames.flatMap((entry) => [...entry.instances.values()]);
    return {
      connected: frames.length > 0,
      frameCount: frames.length,
      instanceCount: instances.length,
      ruffleCount: instances.filter((instance) => instance.looksLikeRuffle).length,
      totalMemoryBytes: instances.reduce(
        (total, instance) => total + (Number(instance.memoryBytes) || 0),
        0,
      ),
    };
  }

  extensionApi.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.kind === "getTabSummary") {
      sendResponse(tabSummary(message.tabId));
    } else if (message?.kind === "getQuickSession") {
      sendResponse(quickSessionSnapshot(message.tabId));
    }
  });

  function connectPort(port) {
    const clientPrefix = port.name.startsWith("hack-popup:") ? "hack-popup:" : null;
    if (clientPrefix) {
      const tabId = Number(port.name.slice(clientPrefix.length));
      const tabClients = clientsFor(tabId);
      tabClients.add(port);

      port.onMessage.addListener((message) => {
        if (message?.kind === "workspaceCommand") {
          const result = updateWorkspace(tabId, message);
          if (["upsertWatch", "mergeWatches"].includes(message.action)) port.postMessage(result);
          return;
        }
        if (message?.kind !== "routeCommand") {
          return;
        }
        const targetFrameId = message.frameId;
        if (!message.payload || typeof message.payload.kind !== "string") return;
        if (!["listInstances", "getSessionState", "stopAllFreezes"].includes(message.payload.kind) && !Number.isInteger(targetFrameId)) return;
        if (["memoryScan", "resetScan"].includes(message.payload.kind) && quickSessions.get(tabId)?.status === "scanning") {
          port.postMessage({ kind: "pageMessage", frameId: targetFrameId, payload: { kind: "error", requestId: message.payload.requestId, message: "A scan is already running. Cancel it before starting or resetting another scan." } });
          return;
        }
        rememberQuickCommand(tabId, targetFrameId, message.payload);
        rememberWriteCommand(tabId, targetFrameId, message.payload);
        for (const entry of bridges.values()) {
          if (
            entry.tabId === tabId &&
            (targetFrameId === undefined || entry.frameId === targetFrameId)
          ) {
            entry.port.postMessage({ kind: "pageCommand", payload: message.payload });
          }
        }
      });

      port.onDisconnect.addListener(() => {
        tabClients.delete(port);
        if (tabClients.size === 0) {
          clients.delete(tabId);
        }
      });

      port.postMessage({ kind: "quickSession", session: quickSessionSnapshot(tabId) });
      port.postMessage({ kind: "workspaceState", workspace: workspaceSnapshot(tabId) });

      for (const entry of bridges.values()) {
        if (entry.tabId === tabId) {
          port.postMessage({ kind: "frameConnected", frameId: entry.frameId, url: entry.url });
        }
      }
      return;
    }

    const practiceTab = port.name.startsWith("hack-practice:") &&
      port.sender?.url === extensionApi.runtime.getURL?.("practice/index.html")
      ? Number(port.name.slice("hack-practice:".length)) : null;
    if ((port.name !== "ruffle-frame-bridge" || !port.sender?.tab) && !Number.isSafeInteger(practiceTab)) return;
    const tabId = practiceTab ?? port.sender.tab.id;
    const frameId = port.sender.frameId ?? 0;
    const key = bridgeKey(tabId, frameId);
    const entry = {
      port,
      tabId,
      frameId,
      url: port.sender.url || "",
      instances: new Map(),
    };
    bridges.set(key, entry);

    port.onMessage.addListener((message) => {
      if (bridges.get(key)?.port !== port) return;
      if (message?.kind === "bridgeReady") {
        entry.url = message.url || entry.url;
        broadcast(tabId, { kind: "frameConnected", frameId, url: entry.url });
        port.postMessage({ kind: "pageCommand", payload: { kind: "getSessionState" } });
      } else if (message?.kind === "pageMessage") {
        if (message.payload?.kind === "agentState") {
          reconcileAgent(entry, message.payload);
          return;
        }
        rememberInstances(entry, message.payload);
        rememberQuickPayload(entry, message.payload);
        rememberWorkspacePayload(entry, message.payload);
        if (message.payload?.kind === "bridgeDiagnostic") {
          entry.port.postMessage({
            kind: "pageCommand",
            payload: {
              kind: "bridgeDiagnosticResult",
              probe: message.payload.probe,
            },
          });
          return;
        }
        broadcast(tabId, {
          kind: "pageMessage",
          frameId,
          url: entry.url,
          payload: message.payload,
        });
      }
    });

    port.postMessage({ kind: "pageCommand", payload: { kind: "getSessionState" } });

    port.onDisconnect.addListener(() => {
      if (bridges.get(key)?.port === port) {
        bridges.delete(key);
        const session = quickSessions.get(tabId);
        if (session?.frameId === frameId) {
          scanBaselines.delete(tabId);
          session.status = "disconnected";
          session.canRefine = false;
          session.error = "The game frame disconnected. Reconnecting will verify its memory identity.";
          broadcast(tabId, { kind: "quickSession", session });
        }
        const workspace = workspaceFor(tabId);
        for (const diagnostic of Object.keys(workspace.diagnostics)) if (diagnostic.startsWith(`${frameId}:`)) delete workspace.diagnostics[diagnostic];
        for (const frozen of workspace.frozenKeys) if (frozen.startsWith(`${frameId}:`)) workspace.frozenKeys.delete(frozen);
        if (workspace.lastWrite?.frameId === frameId) workspace.lastWrite = null;
        broadcastWorkspace(tabId);
        broadcast(tabId, { kind: "frameDisconnected", frameId });
      }
    });
  }

  extensionApi.runtime.onConnect.addListener((port) => {
    if (storageReady) return connectPort(port);
    let disconnected = false;
    const collect = () => {};
    port.onMessage.addListener(collect);
    port.onDisconnect.addListener(() => { disconnected = true; });
    hydration.then(() => {
      port.onMessage.removeListener(collect);
      if (disconnected) return;
      connectPort(port);
      // Ask peers to resynchronize rather than replaying stale write commands.
      if (port.name === "ruffle-frame-bridge") port.postMessage({ kind: "pageCommand", payload: { kind: "getSessionState" } });
    });
  });

  extensionApi.tabs?.onRemoved?.addListener((tabId) => {
    clients.delete(Number(tabId));
    quickSessions.delete(Number(tabId));
    scanBaselines.delete(Number(tabId));
    workspaces.delete(Number(tabId));
    persistWorkspaces();
  });
})();
