const FREEZE_CHANNEL = "ruffle-memory-inspector:v1";
const freezeResultNode = document.querySelector("#result");
const targetOffset = 4096;
let freezeInstanceId = null;
let overwriteActive = true;

function sendFreezeCommand(payload) {
  window.postMessage(
    { channel: FREEZE_CHANNEL, direction: "to-page", payload },
    "*",
  );
}

function overwriteEachFrame() {
  if (!overwriteActive) {
    return;
  }
  if (window.mockWasmInstance) {
    new DataView(window.mockWasmInstance.exports.memory.buffer).setFloat64(targetOffset, 33, true);
  }
  requestAnimationFrame(overwriteEachFrame);
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (
    event.source !== window ||
    message?.channel !== FREEZE_CHANNEL ||
    message?.direction !== "from-page"
  ) {
    return;
  }

  const payload = message.payload;
  if (payload?.kind === "instanceCaptured") {
    freezeInstanceId = payload.instance.id;
    requestAnimationFrame(() => {
      overwriteEachFrame();
      sendFreezeCommand({
        kind: "writeValue",
        requestId: "reverting-write",
        instanceId: freezeInstanceId,
        type: "f64",
        address: targetOffset,
        rawValue: "10",
      });
    });
  } else if (payload?.kind === "writeVerified" && payload.requestId === "reverting-write") {
    if (payload.persisted || payload.actualValue !== 33) {
      freezeResultNode.textContent = "FAIL: the simulated game write was not detected as reverted.";
      overwriteActive = false;
      return;
    }
    sendFreezeCommand({
      kind: "setFreeze",
      requestId: "enable-freeze",
      instanceId: freezeInstanceId,
      type: "f64",
      address: targetOffset,
      rawValue: "10",
      enabled: true,
    });
  } else if (payload?.kind === "freezeChanged" && payload.requestId === "enable-freeze") {
    setTimeout(() => {
      const actual = new DataView(window.mockWasmInstance.exports.memory.buffer).getFloat64(
        targetOffset,
        true,
      );
      overwriteActive = false;
      sendFreezeCommand({
        kind: "setFreeze",
        requestId: "disable-freeze",
        instanceId: freezeInstanceId,
        type: "f64",
        address: targetOffset,
        enabled: false,
      });
      freezeResultNode.textContent = actual === 10
        ? "PASS: detected a reverted write and held the requested value with freeze."
        : `FAIL: freeze verification returned ${actual}.`;
    }, 150);
  } else if (payload?.kind === "error") {
    overwriteActive = false;
    freezeResultNode.textContent = `FAIL: ${payload.message}`;
  }
});
