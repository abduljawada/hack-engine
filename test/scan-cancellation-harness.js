const CANCELLATION_CHANNEL = "ruffle-memory-inspector:v1";
const cancellationResult = document.querySelector("#result");
const recoveryOffset = 0x1800000;
const recoveryValue = 987654321;
let cancellationInstanceId = null;
let cancellationInstance = null;
let cancelSent = false;

function sendCancellationCommand(payload) {
  window.postMessage(
    { channel: CANCELLATION_CHANNEL, direction: "to-page", payload },
    "*",
  );
}

function failCancellation(message) {
  cancellationResult.textContent = `FAIL: ${message}`;
}

window.addEventListener("message", (event) => {
  const message = event.data;
  if (
    event.source !== window ||
    message?.channel !== CANCELLATION_CHANNEL ||
    message?.direction !== "from-page"
  ) {
    return;
  }
  const payload = message.payload;
  if (payload?.kind === "instanceCaptured") {
    cancellationInstanceId = payload.instance.id;
    sendCancellationCommand({
      kind: "memoryScan",
      requestId: "cancel-me",
      instanceId: cancellationInstanceId,
      type: "u8",
      rawValue: "0",
      condition: "exact",
      alignment: "aligned",
      refine: false,
    });
  } else if (
    payload?.kind === "scanProgress" &&
    payload.requestId === "cancel-me" &&
    !cancelSent
  ) {
    cancelSent = true;
    sendCancellationCommand({
      kind: "cancelScan",
      requestId: "cancel-command",
      targetRequestId: "cancel-me",
    });
  } else if (payload?.kind === "scanResults" && payload.requestId === "cancel-me") {
    failCancellation("the cancelled scan still returned results.");
  } else if (payload?.kind === "scanCancelled" && payload.requestId === "cancel-me") {
    sendCancellationCommand({
      kind: "memoryScan",
      requestId: "recovery-scan",
      instanceId: cancellationInstanceId,
      type: "i32",
      rawValue: String(recoveryValue),
      condition: "exact",
      alignment: "aligned",
      refine: false,
    });
  } else if (payload?.kind === "scanResults" && payload.requestId === "recovery-scan") {
    const recovered = payload.total === 1 && payload.preview[0]?.address === recoveryOffset;
    cancellationResult.textContent = recovered
      ? "PASS: an active scan cancels cooperatively and a replacement scan succeeds."
      : `FAIL: recovery scan returned ${payload.total} candidates.`;
  } else if (payload?.kind === "error") {
    failCancellation(`${payload.requestId}: ${payload.message}`);
  }
});

// (module (memory (export "memory") 1))
const cancellationModuleBytes = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x05, 0x03, 0x01, 0x00, 0x01,
  0x07, 0x0a, 0x01, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00,
]);

WebAssembly.instantiate(cancellationModuleBytes).then(({ instance }) => {
  cancellationInstance = instance;
  cancellationInstance.exports.memory.grow(511);
  new DataView(cancellationInstance.exports.memory.buffer).setInt32(
    recoveryOffset,
    recoveryValue,
    true,
  );
});
