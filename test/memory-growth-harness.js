const GROWTH_CHANNEL = "ruffle-memory-inspector:v1";
const growthResultNode = document.querySelector("#result");
const initialPages = 32;
const growthTargetOffset = 1_600_000;
const growthTargetValue = 13579.5;
let growthInstance = null;
let growthInstanceId = null;
let memoryWasGrown = false;

function sendGrowthCommand(payload) {
  window.postMessage(
    { channel: GROWTH_CHANNEL, direction: "to-page", payload },
    "*",
  );
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (
    event.source !== window ||
    message?.channel !== GROWTH_CHANNEL ||
    message?.direction !== "from-page"
  ) {
    return;
  }

  const payload = message.payload;
  if (payload?.kind === "instanceCaptured") {
    growthInstanceId = payload.instance.id;
    sendGrowthCommand({
      kind: "exactScan",
      requestId: "memory-growth-scan",
      instanceId: growthInstanceId,
      type: "f64",
      rawValue: String(growthTargetValue),
      refine: false,
    });
  } else if (
    payload?.kind === "scanProgress" &&
    payload.requestId === "memory-growth-scan" &&
    !memoryWasGrown
  ) {
    growthInstance.exports.memory.grow(1);
    memoryWasGrown = true;
  } else if (
    payload?.kind === "scanResults" &&
    payload.requestId === "memory-growth-scan"
  ) {
    const found = payload.total === 1 && payload.preview[0]?.address === growthTargetOffset;
    growthResultNode.textContent = found && memoryWasGrown
      ? "PASS: scan survived WASM memory growth and retained the target value."
      : "FAIL: scan completed without retaining the target after memory growth.";
  } else if (payload?.kind === "error") {
    growthResultNode.textContent = `FAIL: ${payload.message}`;
  }
});

// (module (memory (export "memory") 32))
const growthModuleBytes = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x05, 0x03, 0x01, 0x00, 0x20,
  0x07, 0x0a, 0x01, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
]);

WebAssembly.instantiate(growthModuleBytes).then(({ instance }) => {
  growthInstance = instance;
  new DataView(instance.exports.memory.buffer).setFloat64(
    growthTargetOffset,
    growthTargetValue,
    true,
  );
});
