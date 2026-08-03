const HARNESS_CHANNEL = "ruffle-memory-inspector:v1";
const resultNode = document.querySelector("#result");
let capturedInstanceId = null;

function command(payload) {
  window.postMessage(
    { channel: HARNESS_CHANNEL, direction: "to-page", payload },
    "*",
  );
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (
    event.source !== window ||
    message?.channel !== HARNESS_CHANNEL ||
    message?.direction !== "from-page"
  ) {
    return;
  }

  const payload = message.payload;
  if (payload?.kind === "instanceCaptured") {
    capturedInstanceId = payload.instance.id;
    setTimeout(() => {
      command({
        kind: "exactScan",
        requestId: "harness-scan",
        instanceId: capturedInstanceId,
        type: "f64",
        rawValue: "12345.5",
        refine: false,
      });
    }, 0);
  } else if (payload?.kind === "scanResults" && payload.requestId === "harness-scan") {
    const found = payload.preview.some((candidate) => candidate.address === 4096);
    if (!found) {
      resultNode.textContent = "FAIL: expected Float64 candidate at 0x1000.";
      return;
    }
    command({
      kind: "writeValue",
      requestId: "harness-write",
      instanceId: capturedInstanceId,
      type: "f64",
      address: 4096,
      rawValue: "67890.25",
    });
  } else if (payload?.kind === "writeComplete" && payload.requestId === "harness-write") {
    const actual = new DataView(window.mockWasmInstance.exports.memory.buffer).getFloat64(4096, true);
    if (actual !== 67890.25) {
      resultNode.textContent = `FAIL: write verification returned ${actual}.`;
      return;
    }
    command({
      kind: "exactScan",
      requestId: "harness-refine",
      instanceId: capturedInstanceId,
      type: "f64",
      rawValue: "67890.25",
      refine: true,
    });
  } else if (payload?.kind === "scanResults" && payload.requestId === "harness-refine") {
    const retained = payload.total === 1 && payload.preview[0]?.address === 4096;
    resultNode.textContent = retained
      ? "PASS: captured, scanned, refined, located, and wrote the mock WASM value."
      : "FAIL: refined scan did not retain the expected 0x1000 candidate.";
  } else if (payload?.kind === "error") {
    resultNode.textContent = `FAIL: ${payload.message}`;
  }
});
