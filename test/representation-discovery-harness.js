const REPRESENTATION_CHANNEL = "ruffle-memory-inspector:v1";
const representationResult = document.querySelector("#result");
const scaledOffset = 3000;
const deltaOffset = 5000;
const byteOffset = 6000;
const float32Offset = 7000;
let representationInstance;
let representationInstanceId;

function representationCommand(payload) {
  window.postMessage({
    channel: REPRESENTATION_CHANNEL,
    direction: "to-page",
    payload,
  }, "*");
}

function failRepresentation(message) {
  representationResult.textContent = `FAIL: ${message}`;
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (
    event.source !== window ||
    message?.channel !== REPRESENTATION_CHANNEL ||
    message?.direction !== "from-page"
  ) {
    return;
  }
  const payload = message.payload;
  if (payload?.kind === "instanceCaptured") {
    representationInstanceId = payload.instance.id;
    representationCommand({
      kind: "memoryScan",
      requestId: "auto-scaled-exact",
      instanceId: representationInstanceId,
      type: "auto",
      rawValue: "100",
      multiplier: 8,
      condition: "exact",
      alignment: "aligned",
      refine: false,
    });
  } else if (payload?.kind === "scanResults" && payload.requestId === "auto-scaled-exact") {
    const detected = payload.preview.find((candidate) => (
      candidate.address === scaledOffset &&
      candidate.type === "i16" &&
      candidate.value === 800 &&
      candidate.displayValue === 100
    ));
    if (!detected) {
      failRepresentation("auto scan did not identify the scaled Int16 value.");
      return;
    }
    representationCommand({
      kind: "writeValue",
      requestId: "scaled-write",
      instanceId: representationInstanceId,
      type: "i16",
      address: scaledOffset,
      rawValue: "125",
      multiplier: 8,
    });
  } else if (payload?.kind === "writeComplete" && payload.requestId === "scaled-write") {
    const stored = new DataView(representationInstance.exports.memory.buffer)
      .getInt16(scaledOffset, true);
    if (stored !== 1000 || payload.displayValue !== 125) {
      failRepresentation("scaled write did not encode the displayed value.");
      return;
    }
    representationCommand({
      kind: "memoryScan",
      requestId: "auto-known-delta",
      instanceId: representationInstanceId,
      type: "auto",
      rawValue: "25",
      multiplier: 8,
      condition: "increasedBy",
      alignment: "aligned",
      refine: true,
    });
  } else if (payload?.kind === "scanResults" && payload.requestId === "auto-known-delta") {
    const retained = payload.preview.some((candidate) => (
      candidate.address === scaledOffset && candidate.type === "i16"
    ));
    if (!retained) {
      failRepresentation("auto comparison missed a candidate from a known exact scan.");
      return;
    }
    representationCommand({
      kind: "memoryScan",
      requestId: "auto-unknown",
      instanceId: representationInstanceId,
      type: "auto",
      multiplier: 8,
      condition: "unknown",
      alignment: "aligned",
      refine: false,
    });
  } else if (payload?.kind === "scanResults" && payload.requestId === "auto-unknown") {
    if (!payload.allCandidates || payload.preview.length !== 0 || !payload.snapshotBytes) {
      failRepresentation("auto unknown scan did not create one shared snapshot.");
      return;
    }
    new DataView(representationInstance.exports.memory.buffer).setInt16(deltaOffset, 1040, true);
    representationCommand({
      kind: "memoryScan",
      requestId: "auto-increased-by",
      instanceId: representationInstanceId,
      type: "auto",
      rawValue: "5",
      multiplier: 8,
      condition: "increasedBy",
      alignment: "aligned",
      refine: true,
    });
  } else if (payload?.kind === "scanResults" && payload.requestId === "auto-increased-by") {
    const retained = payload.preview.some((candidate) => (
      candidate.address === deltaOffset && candidate.type === "i16"
    ));
    if (!retained) {
      failRepresentation("exact-delta refinement missed the scaled Int16 candidate.");
      return;
    }
    representationCommand({
      kind: "memoryScan",
      requestId: "byte-width-scan",
      instanceId: representationInstanceId,
      type: "u8",
      rawValue: "250",
      multiplier: 1,
      condition: "exact",
      alignment: "aligned",
      refine: false,
    });
  } else if (payload?.kind === "scanResults" && payload.requestId === "byte-width-scan") {
    const retained = payload.preview.some((candidate) => candidate.address === byteOffset);
    if (!retained) {
      failRepresentation("Uint8 scan missed its target.");
      return;
    }
    representationCommand({
      kind: "memoryScan",
      requestId: "float32-normalized-scan",
      instanceId: representationInstanceId,
      type: "f32",
      rawValue: "0.1",
      multiplier: 1,
      condition: "exact",
      alignment: "aligned",
      refine: false,
    });
  } else if (
    payload?.kind === "scanResults" &&
    payload.requestId === "float32-normalized-scan"
  ) {
    const retained = payload.preview.some((candidate) => candidate.address === float32Offset);
    representationResult.textContent = retained
      ? "PASS: extra widths, auto types, known baselines, Float32 normalization, scaled writes, and exact-delta refinement work."
      : "FAIL: normalized Float32 scan missed its target.";
  } else if (payload?.kind === "error") {
    failRepresentation(payload.message);
  }
});

// (module (memory (export "memory") 1))
const representationModule = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x05, 0x03, 0x01, 0x00, 0x01,
  0x07, 0x0a, 0x01, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
]);

WebAssembly.instantiate(representationModule).then(({ instance }) => {
  representationInstance = instance;
  const view = new DataView(instance.exports.memory.buffer);
  view.setInt16(scaledOffset, 800, true);
  view.setInt16(deltaOffset, 1000, true);
  view.setUint8(byteOffset, 250);
  view.setFloat32(float32Offset, 0.1, true);
});
