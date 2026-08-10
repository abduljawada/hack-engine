(() => {
  "use strict";

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const clients = new Map();
  const bridges = new Map();
  const quickSessions = new Map();
  const workspaces = new Map();
  const MAX_SHARED_WATCHES = 256;

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
    broadcast(tabId, { kind: "workspaceState", workspace: workspaceSnapshot(tabId) });
  }

  function updateWorkspace(tabId, message) {
    const workspace = workspaceFor(tabId);
    const watch = normalizeWatch(message.watch);
    if (message.action === "upsertWatch" && watch) {
      if (workspace.watches.has(watch.key) || workspace.watches.size < MAX_SHARED_WATCHES) {
        workspace.watches.set(watch.key, watch);
        if (message.select) {
          workspace.selectedKey = watch.key;
        }
      }
    } else if (message.action === "mergeWatches" && Array.isArray(message.watches)) {
      for (const value of message.watches) {
        const merged = normalizeWatch(value);
        if (!merged || (!workspace.watches.has(merged.key) && workspace.watches.size >= MAX_SHARED_WATCHES)) {
          continue;
        }
        workspace.watches.set(merged.key, merged);
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
  }

  function rememberQuickCommand(tabId, frameId, payload) {
    const numericTabId = Number(tabId);
    if (payload.kind === "resetScan") {
      quickSessions.delete(numericTabId);
      broadcast(numericTabId, { kind: "quickSession", session: null });
      return;
    }
    if (payload.kind !== "memoryScan") {
      return;
    }
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
    if (!session || payload?.requestId !== session.requestId) {
      return;
    }
    if (payload.kind === "scanProgress") {
      session.progress = payload;
    } else if (payload.kind === "scanResults") {
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
    broadcast(entry.tabId, { kind: "quickSession", session });
  }

  function rememberWorkspacePayload(entry, payload) {
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

  extensionApi.runtime.onConnect.addListener((port) => {
    const clientPrefix = port.name.startsWith("ruffle-panel:")
      ? "ruffle-panel:"
      : port.name.startsWith("hack-popup:")
        ? "hack-popup:"
        : null;
    if (clientPrefix) {
      const tabId = Number(port.name.slice(clientPrefix.length));
      const tabClients = clientsFor(tabId);
      tabClients.add(port);

      port.onMessage.addListener((message) => {
        if (message?.kind === "workspaceCommand") {
          updateWorkspace(tabId, message);
          return;
        }
        if (message?.kind !== "routeCommand") {
          return;
        }
        const targetFrameId = message.frameId;
        rememberQuickCommand(tabId, targetFrameId, message.payload);
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

    if (port.name !== "ruffle-frame-bridge" || !port.sender?.tab) {
      return;
    }

    const tabId = port.sender.tab.id;
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
      if (message?.kind === "bridgeReady") {
        entry.url = message.url || entry.url;
        broadcast(tabId, { kind: "frameConnected", frameId, url: entry.url });
      } else if (message?.kind === "pageMessage") {
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

    port.onDisconnect.addListener(() => {
      if (bridges.get(key)?.port === port) {
        bridges.delete(key);
        const session = quickSessions.get(tabId);
        if (session?.frameId === frameId) {
          session.status = "disconnected";
          session.error = "The game frame disconnected.";
        }
        broadcast(tabId, { kind: "frameDisconnected", frameId });
      }
    });
  });

  extensionApi.tabs?.onRemoved?.addListener((tabId) => {
    clients.delete(Number(tabId));
    quickSessions.delete(Number(tabId));
    workspaces.delete(Number(tabId));
  });
})();
