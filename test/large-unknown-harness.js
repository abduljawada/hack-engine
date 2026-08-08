const LARGE_CHANNEL = "ruffle-memory-inspector:v1";
const largeResultNode = document.querySelector("#result");
const largePageCount = 3608;
const largeMemoryBytes = largePageCount * 65536;
const expectedSlots = largeMemoryBytes / Float64Array.BYTES_PER_ELEMENT;
const changedSlot = 123456;
const changedAddress = changedSlot * Float64Array.BYTES_PER_ELEMENT;
let largeInstance = null;
let initialSnapshotBytes = 0;

function fillWithHighEntropyBytes(memory) {
  const words = new Uint32Array(memory.buffer);
  let state = 0x6d2b79f5;
  for (let index = 0; index < words.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    words[index] = state >>> 0;
  }
}

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
    fillWithHighEntropyBytes(largeInstance.exports.memory);
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
    initialSnapshotBytes = payload.snapshotBytes;
    if (payload.total !== expectedSlots || payload.snapshotBytes < largeMemoryBytes * 0.8) {
      largeResultNode.textContent =
        `FAIL: received ${payload.total} slots and a ${payload.snapshotBytes}-byte snapshot.`;
      return;
    }
    new DataView(largeInstance.exports.memory.buffer).setFloat64(changedAddress, 42.25, true);
    sendLargeCommand({
      kind: "memoryScan",
      requestId: "large-changed",
      instanceId: payload.instanceId,
      type: "f64",
      condition: "changed",
      alignment: "aligned",
      refine: true,
    });
  } else if (payload?.kind === "scanResults" && payload.requestId === "large-changed") {
    const foundChangedSlot = payload.total === 1 && payload.preview[0]?.address === changedAddress;
    largeResultNode.textContent = foundChangedSlot
      ? `PASS: stored a ${initialSnapshotBytes}-byte high-entropy snapshot and refined it from browser storage.`
      : `FAIL: refinement returned ${payload.total} candidates.`;
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
