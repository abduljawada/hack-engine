(() => {
  "use strict";

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const panels = new Map();
  const bridges = new Map();

  function bridgeKey(tabId, frameId) {
    return `${tabId}:${frameId}`;
  }

  function panelFor(tabId) {
    return panels.get(Number(tabId));
  }

  extensionApi.runtime.onConnect.addListener((port) => {
    if (port.name.startsWith("ruffle-panel:")) {
      const tabId = Number(port.name.slice("ruffle-panel:".length));
      panels.set(tabId, port);

      port.onMessage.addListener((message) => {
        if (message?.kind !== "routeCommand") {
          return;
        }
        const targetFrameId = message.frameId;
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
        if (panels.get(tabId) === port) {
          panels.delete(tabId);
        }
      });

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
    const entry = { port, tabId, frameId, url: port.sender.url || "" };
    bridges.set(key, entry);

    port.onMessage.addListener((message) => {
      if (message?.kind === "bridgeReady") {
        entry.url = message.url || entry.url;
        panelFor(tabId)?.postMessage({ kind: "frameConnected", frameId, url: entry.url });
      } else if (message?.kind === "pageMessage") {
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
        panelFor(tabId)?.postMessage({
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
        panelFor(tabId)?.postMessage({ kind: "frameDisconnected", frameId });
      }
    });
  });
})();
