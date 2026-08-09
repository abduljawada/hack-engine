const WATCH_CHANNEL = "ruffle-memory-inspector:v1";
const watchResultNode = document.querySelector("#result");
const watchAddress = 4096;
let watchInstanceId = null;
let overwriteWatchValue = false;

function sendWatchCommand(payload) {
  window.postMessage({ channel: WATCH_CHANNEL, direction: "to-page", payload }, "*");
}

function overwriteWatchedAddress() {
  if (!overwriteWatchValue) {
    return;
  }
  new DataView(window.mockWasmInstance.exports.memory.buffer).setFloat64(watchAddress, 33, true);
  requestAnimationFrame(overwriteWatchedAddress);
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (
    event.source !== window ||
    message?.channel !== WATCH_CHANNEL ||
    message?.direction !== "from-page"
  ) {
    return;
  }

  const payload = message.payload;
  if (payload?.kind === "instanceCaptured") {
    watchInstanceId = payload.instance.id;
    sendWatchCommand({
      kind: "readValues",
      requestId: "initial-watch-read",
      instanceId: watchInstanceId,
      entries: [{ id: "target", type: "f64", address: watchAddress }],
    });
  } else if (payload?.kind === "watchValues" && payload.requestId === "initial-watch-read") {
    if (payload.values[0]?.value !== 12345.5) {
      watchResultNode.textContent = `FAIL: watch read returned ${payload.values[0]?.value}.`;
      return;
    }
    overwriteWatchValue = true;
    requestAnimationFrame(() => {
      overwriteWatchedAddress();
      sendWatchCommand({
        kind: "writeValue",
        requestId: "restored-write",
        instanceId: watchInstanceId,
        type: "f64",
        address: watchAddress,
        rawValue: "10",
      });
    });
  } else if (payload?.kind === "writeDiagnostic" && payload.requestId === "restored-write") {
    if (
      payload.classification !== "restored" ||
      !payload.samples.some((sample) => !sample.matches && sample.value === 33)
    ) {
      overwriteWatchValue = false;
      watchResultNode.textContent =
        `FAIL: overwritten write was classified as ${payload.classification}.`;
      return;
    }
    overwriteWatchValue = false;
    sendWatchCommand({
      kind: "writeValue",
      requestId: "persistent-write",
      instanceId: watchInstanceId,
      type: "f64",
      address: watchAddress,
      rawValue: "20",
    });
  } else if (payload?.kind === "writeDiagnostic" && payload.requestId === "persistent-write") {
    const passed =
      payload.classification === "persistent" &&
      payload.samples.length === 5 &&
      payload.samples.every((sample) => sample.matches && sample.value === 20);
    watchResultNode.textContent = passed
      ? "PASS: live watch reads and multi-frame write diagnostics classify restored and persistent values."
      : `FAIL: persistent write was classified as ${payload.classification}.`;
  } else if (payload?.kind === "error") {
    overwriteWatchValue = false;
    watchResultNode.textContent = `FAIL: ${payload.message}`;
  }
});
