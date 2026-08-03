(() => {
  "use strict";

  const CHANNEL = "ruffle-memory-inspector:v1";
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  let port = null;
  let reconnectTimer = null;

  function connect() {
    try {
      port = extensionApi.runtime.connect({ name: "ruffle-frame-bridge" });
      port.onMessage.addListener((message) => {
        if (message?.kind === "pageCommand") {
          window.postMessage(
            { channel: CHANNEL, direction: "to-page", payload: message.payload },
            "*",
          );
        }
      });
      port.onDisconnect.addListener(() => {
        port = null;
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 500);
      });
      port.postMessage({ kind: "bridgeReady", url: location.href });
    } catch {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 500);
    }
  }

  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.data?.channel !== CHANNEL ||
      event.data?.direction !== "from-page" ||
      !port
    ) {
      return;
    }
    port.postMessage({ kind: "pageMessage", payload: event.data.payload });
  });

  connect();
})();
