const panelHarnessResult = document.querySelector("#harness-result");
const panelHarnessPort = panelHarnessState.port;

function emitPanelPayload(payload) {
  panelHarnessPort.onMessage.emit({
    kind: "pageMessage",
    frameId: 0,
    url: location.href,
    payload,
  });
}

function latestScanCommand() {
  return panelHarnessState.commands
    .map((message) => message?.payload)
    .filter((payload) => payload?.kind === "memoryScan")
    .at(-1);
}

emitPanelPayload({
  kind: "instanceList",
  instances: [{
    id: "1",
    hint: "harness",
    memoryBytes: 65536,
    looksLikeRuffle: true,
  }],
});

document.querySelector("#condition").value = "range";
document.querySelector("#condition").dispatchEvent(new Event("change"));
document.querySelector("#scan-value").value = "10";
document.querySelector("#scan-max-value").value = "20";
document.querySelector("#first-scan").click();
const rangeRequest = latestScanCommand();
const rangeControlsWork =
  !document.querySelector("#scan-max-value-label").hidden &&
  document.querySelector("#scan-value-text").textContent === "Minimum value" &&
  rangeRequest?.condition === "range" &&
  rangeRequest?.rawValue === "10" &&
  rangeRequest?.rawMaxValue === "20";
emitPanelPayload({
  kind: "scanResults",
  requestId: rangeRequest?.requestId,
  instanceId: "1",
  type: "f64",
  total: 0,
  preview: [],
  allCandidates: false,
});

document.querySelector("#type").value = "auto";
document.querySelector("#type").dispatchEvent(new Event("change"));
document.querySelector("#condition").value = "exact";
document.querySelector("#condition").dispatchEvent(new Event("change"));
document.querySelector("#scan-value").value = "100";
document.querySelector("#multiplier").value = "8";
document.querySelector("#first-scan").click();
const autoRequest = latestScanCommand();
emitPanelPayload({
  kind: "scanResults",
  requestId: autoRequest?.requestId,
  instanceId: "1",
  type: "auto",
  multiplier: 8,
  total: 1,
  preview: [{
    address: 4096,
    type: "i16",
    multiplier: 8,
    value: 800,
    displayValue: 100,
  }],
  allCandidates: false,
});
document.querySelector("#candidates tr").click();
const automaticallyWatched =
  document.querySelector("#watch-count").textContent === "1" &&
  document.querySelector("#watches").textContent.includes("0x00001000");
document.querySelector("#write-value").value = "125";
document.querySelector("#write").click();
const scaledWrite = panelHarnessState.commands
  .map((message) => message?.payload)
  .findLast((payload) => payload?.kind === "writeValue");
const autoControlsWork =
  autoRequest?.type === "auto" &&
  autoRequest?.multiplier === 8 &&
  document.querySelector("#candidates").textContent.includes("i16 ×8") &&
  scaledWrite?.type === "i16" &&
  scaledWrite?.multiplier === 8 &&
  scaledWrite?.rawValue === "125" &&
  automaticallyWatched;

document.querySelector("#type").value = "f64";
document.querySelector("#type").dispatchEvent(new Event("change"));
document.querySelector("#multiplier").value = "1";
document.querySelector("#condition").value = "unknown";
document.querySelector("#condition").dispatchEvent(new Event("change"));
document.querySelector("#first-scan").click();

const malformedRequest = latestScanCommand();
const watchdogWasArmed = panelHarnessState.watchdogs.size === 1;
emitPanelPayload({
  kind: "scanResults",
  requestId: malformedRequest?.requestId,
  instanceId: "1",
  type: "f64",
  total: 1,
  preview: [{ address: null, value: 0 }],
  allCandidates: false,
});

const malformedHandled =
  watchdogWasArmed &&
  panelHarnessState.watchdogs.size === 0 &&
  !document.querySelector("#first-scan").disabled &&
  document.querySelector("#status").textContent.startsWith("Unable to render scan results:");

document.querySelector("#first-scan").click();
const validRequest = latestScanCommand();
emitPanelPayload({
  kind: "scanResults",
  requestId: validRequest?.requestId,
  instanceId: "1",
  type: "f64",
  total: 8192,
  preview: [],
  allCandidates: true,
  snapshotBytes: 1024,
});

const validHandled =
  panelHarnessState.watchdogs.size === 0 &&
  document.querySelector("#result-count").textContent === (8192).toLocaleString() &&
  document.querySelector("#status").textContent.includes("initial candidates captured");

document.querySelector("#first-scan").click();
const cancelledRequest = latestScanCommand();
document.querySelector("#cancel-scan").click();
const cancelCommand = panelHarnessState.commands
  .map((message) => message?.payload)
  .findLast((payload) => payload?.kind === "cancelScan");
emitPanelPayload({ kind: "scanCancelled", requestId: cancelledRequest?.requestId });
const cancellationWorks =
  cancelCommand?.targetRequestId === cancelledRequest?.requestId &&
  !document.querySelector("#first-scan").disabled &&
  document.querySelector("#status").textContent.includes("Scan cancelled") &&
  document.querySelector("#scan-history").textContent.includes("cancelled");

document.querySelector("#first-scan").click();
const timedOutRequest = latestScanCommand();
const watchdogCallback = [...panelHarnessState.watchdogs.values()].at(-1);
watchdogCallback?.();
const watchdogCancel = panelHarnessState.commands
  .map((message) => message?.payload)
  .findLast((payload) => payload?.kind === "cancelScan");
const timeoutCancelsWork =
  watchdogCancel?.targetRequestId === timedOutRequest?.requestId &&
  document.querySelector("#status").textContent.includes("15 seconds") &&
  document.querySelector("#scan-history").textContent.includes("timeout");

document.querySelector("#condition").value = "exact";
document.querySelector("#condition").dispatchEvent(new Event("change"));
document.querySelector("#first-scan").click();
const previewLimitRequest = latestScanCommand();
emitPanelPayload({
  kind: "scanResults",
  requestId: previewLimitRequest?.requestId,
  instanceId: "1",
  type: "f64",
  total: 205,
  preview: Array.from({ length: 205 }, (_, index) => ({
    address: index * 8,
    value: index,
    displayValue: index,
  })),
  allCandidates: false,
});
const previewLimitWorks =
  document.querySelectorAll("#candidates tr").length === 200 &&
  document.querySelector("#visible-count").textContent === "200" &&
  document.querySelector("#result-count").textContent === "205";

document.querySelector("#write-address").value = "0x00001000";
document.querySelector("#add-watch").click();
for (const refresh of panelHarnessState.intervals.values()) {
  refresh();
}
const watchCommand = panelHarnessState.commands
  .map((message) => message?.payload)
  .findLast((payload) => payload?.kind === "readValues");
emitPanelPayload({
  kind: "watchValues",
  requestId: watchCommand?.requestId,
  instanceId: "1",
  values: [{
    id: watchCommand?.entries[0]?.id,
    type: "f64",
    address: 4096,
    value: 33,
  }],
});
const watched =
  document.querySelector("#watch-count").textContent === "2" &&
  document.querySelector("#watches").textContent.includes("0x00001000") &&
  document.querySelector("#watches").textContent.includes("4.125");

emitPanelPayload({
  kind: "writeDiagnostic",
  requestId: "write-diagnostic",
  instanceId: "1",
  type: "f64",
  address: 4096,
  requestedValue: 10,
  classification: "restored",
  samples: [
    { stage: "immediate", elapsedMs: 0, value: 10, matches: true },
    { stage: "next-frame", elapsedMs: 16, value: 33, matches: false },
  ],
});
for (const refresh of panelHarnessState.intervals.values()) {
  refresh();
}
const postDiagnosticRead = panelHarnessState.commands
  .map((message) => message?.payload)
  .findLast((payload) => payload?.kind === "readValues");
emitPanelPayload({
  kind: "watchValues",
  requestId: postDiagnosticRead?.requestId,
  instanceId: "1",
  values: [{
    id: postDiagnosticRead?.entries[0]?.id,
    type: "f64",
    address: 4096,
    value: 33,
  }],
});
const diagnosed =
  document.querySelector("#watches").textContent.includes("Game restored it") &&
  document.querySelector("#status").textContent.includes("game restored");

const panelChecks = {
  rangeControlsWork,
  autoControlsWork,
  malformedHandled,
  validHandled,
  cancellationWorks,
  timeoutCancelsWork,
  previewLimitWorks,
  watched,
  diagnosed,
};
panelHarnessResult.textContent = Object.values(panelChecks).every(Boolean)
  ? "PASS: panel scanning, cancellation, auto-watch, live watches, and write diagnostics work."
  : `FAIL: panel checks failed: ${Object.entries(panelChecks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)
    .join(", ")}.`;
