const ADVANCED_CHANNEL = "ruffle-memory-inspector:v1";
const advancedResultNode = document.querySelector("#result");
const unalignedOffset = 4099;
const unalignedValue = 12345.75;
const increasedOffset = 1024;
const decreasedOffset = 2048;
let advancedInstance = null;
let advancedInstanceId = null;

function sendAdvancedCommand(payload) {
  window.postMessage(
    { channel: ADVANCED_CHANNEL, direction: "to-page", payload },
    "*",
  );
}

function failAdvanced(message) {
  advancedResultNode.textContent = `FAIL: ${message}`;
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (
    event.source !== window ||
    message?.channel !== ADVANCED_CHANNEL ||
    message?.direction !== "from-page"
  ) {
    return;
  }

  const payload = message.payload;
  if (payload?.kind !== "scanProgress") {
    advancedResultNode.dataset.lastMessage = `${payload?.kind || "missing"}:${
      payload?.requestId || "none"
    }`;
  }
  if (payload?.kind === "instanceCaptured") {
    advancedInstanceId = payload.instance.id;
    sendAdvancedCommand({
      kind: "memoryScan",
      requestId: "unaligned-exact",
      instanceId: advancedInstanceId,
      type: "f64",
      rawValue: String(unalignedValue),
      condition: "exact",
      alignment: "byte",
      refine: false,
    });
  } else if (payload?.kind === "scanResults" && payload.requestId === "unaligned-exact") {
    if (!payload.preview.some((candidate) => candidate.address === unalignedOffset)) {
      failAdvanced("the byte-aligned scan missed the unaligned Float64 value.");
      return;
    }
    sendAdvancedCommand({
      kind: "memoryScan",
      requestId: "unknown-initial",
      instanceId: advancedInstanceId,
      type: "i32",
      condition: "unknown",
      alignment: "aligned",
      refine: false,
    });
  } else if (payload?.kind === "scanResults" && payload.requestId === "unknown-initial") {
    if (!payload.allCandidates || payload.preview.length !== 0) {
      failAdvanced("the initial unknown scan should return a count without arbitrary preview rows.");
      return;
    }
    const view = new DataView(advancedInstance.exports.memory.buffer);
    view.setInt32(increasedOffset, 15, true);
    view.setInt32(decreasedOffset, 15, true);
    sendAdvancedCommand({
      kind: "memoryScan",
      requestId: "changed-filter",
      instanceId: advancedInstanceId,
      type: "i32",
      condition: "changed",
      alignment: "aligned",
      refine: true,
    });
  } else if (payload?.kind === "scanResults" && payload.requestId === "changed-filter") {
    const addresses = payload.preview.map((candidate) => candidate.address);
    if (
      payload.total !== 2 ||
      !addresses.includes(increasedOffset) ||
      !addresses.includes(decreasedOffset)
    ) {
      failAdvanced(`changed filter returned ${payload.total} candidates instead of the two mutations.`);
      return;
    }
    const view = new DataView(advancedInstance.exports.memory.buffer);
    view.setInt32(increasedOffset, 20, true);
    view.setInt32(decreasedOffset, 10, true);
    sendAdvancedCommand({
      kind: "memoryScan",
      requestId: "increased-filter",
      instanceId: advancedInstanceId,
      type: "i32",
      condition: "increased",
      alignment: "aligned",
      refine: true,
    });
  } else if (payload?.kind === "scanResults" && payload.requestId === "increased-filter") {
    const retained = payload.total === 1 && payload.preview[0]?.address === increasedOffset;
    if (!retained) {
      failAdvanced(`increased filter retained ${payload.total} candidates.`);
      return;
    }
    sendAdvancedCommand({
      kind: "memoryScan",
      requestId: "replacement-first-scan",
      instanceId: advancedInstanceId,
      type: "f64",
      rawValue: "0",
      condition: "exact",
      alignment: "aligned",
      refine: false,
    });
  } else if (
    payload?.kind === "scanResults" &&
    payload.requestId === "replacement-first-scan"
  ) {
    sendAdvancedCommand({
      kind: "memoryScan",
      requestId: "cleared-session-check",
      instanceId: advancedInstanceId,
      type: "i32",
      condition: "changed",
      alignment: "aligned",
      refine: true,
    });
  } else if (payload?.kind === "error") {
    if (
      payload.requestId === "cleared-session-check" &&
      payload.message === "No previous scan exists. Run a first scan before filtering."
    ) {
      advancedResultNode.textContent =
        "PASS: unaligned and comparison scans work, and replacement scans release stale sessions.";
    } else {
      failAdvanced(payload.message);
    }
  }
});

// (module (memory (export "memory") 1))
const advancedModuleBytes = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x05, 0x03, 0x01, 0x00, 0x01,
  0x07, 0x0a, 0x01, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
]);

WebAssembly.instantiate(advancedModuleBytes).then(({ instance }) => {
  advancedInstance = instance;
  const view = new DataView(instance.exports.memory.buffer);
  view.setFloat64(unalignedOffset, unalignedValue, true);
  view.setInt32(increasedOffset, 10, true);
  view.setInt32(decreasedOffset, 20, true);
});
