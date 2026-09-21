(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  if (!api?.tabs?.getCurrent) return; // The same fixture can be served locally.
  let port;
  const channel = "ruffle-memory-inspector:v1";
  const post = (payload) => window.postMessage({ channel, direction: "to-page", payload }, "*");
  async function connect() {
    try {
      const tab = await api.tabs.getCurrent();
      port = api.runtime.connect({ name: `hack-practice:${tab.id}` });
      port.onMessage.addListener((message) => { if (message.kind === "pageCommand") post(message.payload); });
      port.onDisconnect.addListener(() => { port = null; post({ kind: "bridgeDisconnected" }); setTimeout(connect, 750); });
      port.postMessage({ kind: "bridgeReady", url: location.href });
      post({ kind: "getSessionState" });
    } catch { setTimeout(connect, 1000); }
  }
  window.addEventListener("message", (event) => {
    if (event.source === window && event.data?.channel === channel && event.data.direction === "from-page") {
      try { port?.postMessage({ kind: "pageMessage", payload: event.data.payload }); } catch {}
    }
  });
  connect();
})();
