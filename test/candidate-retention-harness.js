const RETENTION_CHANNEL = "ruffle-memory-inspector:v1";
const retentionResultNode = document.querySelector("#result");
const wasmPages = 64;
const expectedCandidates = (wasmPages * 65536) / Float64Array.BYTES_PER_ELEMENT;
const targetOffset = wasmPages * 65536 - Float64Array.BYTES_PER_ELEMENT;
const replacementValue = 777.25;
let retentionInstance = null;
let retentionInstanceId = null;

function sendRetentionCommand(payload) {
  window.postMessage(
    { channel: RETENTION_CHANNEL, direction: "to-page", payload },
    "*",
  );
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (
    event.source !== window ||
    message?.channel !== RETENTION_CHANNEL ||
    message?.direction !== "from-page"
  ) {
    return;
  }

  const payload = message.payload;
  if (payload?.kind === "instanceCaptured") {
    retentionInstanceId = payload.instance.id;
    sendRetentionCommand({
      kind: "exactScan",
      requestId: "retention-first-scan",
      instanceId: retentionInstanceId,
      type: "f64",
      rawValue: "0",
      refine: false,
    });
  } else if (
    payload?.kind === "scanResults" &&
    payload.requestId === "retention-first-scan"
  ) {
    if (payload.total !== expectedCandidates) {
      retentionResultNode.textContent =
        `FAIL: expected ${expectedCandidates} initial candidates, received ${payload.total}.`;
      return;
    }

    new DataView(retentionInstance.exports.memory.buffer).setFloat64(
      targetOffset,
      replacementValue,
      true,
    );
    sendRetentionCommand({
      kind: "exactScan",
      requestId: "retention-next-scan",
      instanceId: retentionInstanceId,
      type: "f64",
      rawValue: String(replacementValue),
      refine: true,
    });
  } else if (
    payload?.kind === "scanResults" &&
    payload.requestId === "retention-next-scan"
  ) {
    const retained = payload.total === 1 && payload.preview[0]?.address === targetOffset;
    retentionResultNode.textContent = retained
      ? "PASS: retained and refined a candidate after more than 250,000 earlier matches."
      : `FAIL: late-memory candidate 0x${targetOffset.toString(16)} was lost.`;
  } else if (payload?.kind === "error") {
    retentionResultNode.textContent = `FAIL: ${payload.message}`;
  }
});

// (module (memory (export "memory") 64))
const retentionModuleBytes = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x05, 0x03, 0x01, 0x00, 0x40,
  0x07, 0x0a, 0x01, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
]);

WebAssembly.instantiate(retentionModuleBytes).then(({ instance }) => {
  retentionInstance = instance;
});
