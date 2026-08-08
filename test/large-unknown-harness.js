const LARGE_CHANNEL = "ruffle-memory-inspector:v1";
const largeResultNode = document.querySelector("#result");
const largePageCount = 3608;
const largeMemoryBytes = largePageCount * 65536;
const expectedSlots = largeMemoryBytes / Float64Array.BYTES_PER_ELEMENT;
let largeInstance = null;

function sendLargeCommand(payload) {
  window.postMessage(
    { channel: LARGE_CHANNEL, direction: "to-page", payload },
    "*",
  );
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (
    event.source !== window ||
    message?.channel !== LARGE_CHANNEL ||
    message?.direction !== "from-page"
  ) {
    return;
  }

  const payload = message.payload;
  if (payload?.kind === "instanceCaptured") {
    largeInstance.exports.memory.grow(largePageCount - 1);
    sendLargeCommand({
      kind: "memoryScan",
      requestId: "large-unknown",
      instanceId: payload.instance.id,
      type: "f64",
      condition: "unknown",
      alignment: "aligned",
      refine: false,
    });
  } else if (payload?.kind === "scanResults" && payload.requestId === "large-unknown") {
    const compressedEnough = payload.snapshotBytes < largeMemoryBytes / 10;
    largeResultNode.textContent = payload.total === expectedSlots && compressedEnough
      ? `PASS: completed a 225.5 MiB unknown scan with a ${payload.snapshotBytes}-byte snapshot.`
      : `FAIL: received ${payload.total} slots and a ${payload.snapshotBytes}-byte snapshot.`;
  } else if (payload?.kind === "error") {
    largeResultNode.textContent = `FAIL: ${payload.message}`;
  }
});

// (module (memory (export "memory") 1))
const largeModuleBytes = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x05, 0x03, 0x01, 0x00, 0x01,
  0x07, 0x0a, 0x01, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
]);

WebAssembly.instantiate(largeModuleBytes).then(({ instance }) => {
  largeInstance = instance;
});
