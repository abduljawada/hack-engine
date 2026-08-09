const BRIDGE_CHANNEL = "ruffle-memory-inspector:v1";
const bridgeResultNode = document.querySelector("#result");
const pagePayload = {
  kind: "scanResults",
  requestId: "bridge-result",
  total: 2,
  preview: [
    { address: 4096, value: Number.NaN },
    { address: 8192, value: Number.POSITIVE_INFINITY },
  ],
  allCandidates: false,
};

function listenerSlot() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    emit(message) {
      for (const listener of listeners) {
        listener(message);
      }
    },
  };
}

const mockPort = {
  onMessage: listenerSlot(),
  onDisconnect: listenerSlot(),
  postMessage(message) {
    if (message?.kind === "bridgeReady") {
      window.postMessage(
        { channel: BRIDGE_CHANNEL, direction: "from-page", payload: pagePayload },
        "*",
      );
      return;
    }
    if (message?.kind !== "pageMessage") {
      return;
    }
    const payload = message.payload;
    const passed =
      payload !== pagePayload &&
      payload.preview !== pagePayload.preview &&
      payload.preview[0] !== pagePayload.preview[0] &&
      payload.preview[0].address === 4096 &&
      Number.isNaN(payload.preview[0].value) &&
      payload.preview[1].address === 8192 &&
      payload.preview[1].value === Number.POSITIVE_INFINITY;
    bridgeResultNode.textContent = passed
      ? "PASS: bridge cloned nested candidate rows and preserved special numeric values."
      : "FAIL: bridge payload was not independently cloned without data loss.";
  },
};

globalThis.browser = {
  runtime: {
    connect() {
      return mockPort;
    },
  },
};
