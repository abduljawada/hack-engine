(() => {
  "use strict";

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const clients = new Map();
  const bridges = new Map();
  const quickSessions = new Map();

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

  function rememberQuickCommand(tabId, frameId, payload) {
    if (!String(payload?.requestId || "").startsWith("quick:")) {
      return;
    }
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
  });
})();
