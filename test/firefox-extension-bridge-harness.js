const EXTENSION_BRIDGE_CHANNEL = "ruffle-memory-inspector:v1";
const bridgeResultNode = document.querySelector("#result");

window.addEventListener("message", (event) => {
  const message = event.data;
  if (
    event.source !== window ||
    message?.channel !== EXTENSION_BRIDGE_CHANNEL ||
    message?.direction !== "to-page" ||
    message.payload?.kind !== "bridgeDiagnosticResult"
  ) {
    return;
  }

  const rows = message.payload.probe?.preview;
  const passed =
    Array.isArray(rows) &&
    rows[0]?.address === 4096 &&
    (Number.isNaN(rows[0]?.value) || rows[0]?.value === null) &&
    rows[1]?.address === 8192 &&
    (rows[1]?.value === Number.POSITIVE_INFINITY || rows[1]?.value === null);
  bridgeResultNode.textContent = passed
    ? "PASS: Browser preserved nested candidate rows across the live extension bridge."
    : "FAIL: Browser changed nested candidate data across the extension bridge.";
});

window.postMessage({
  channel: EXTENSION_BRIDGE_CHANNEL,
  direction: "from-page",
  payload: {
    kind: "bridgeDiagnostic",
    probe: {
      preview: [
        { address: 4096, value: Number.NaN },
        { address: 8192, value: Number.POSITIVE_INFINITY },
      ],
    },
  },
}, "*");
