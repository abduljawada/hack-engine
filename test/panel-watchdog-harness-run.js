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
  document.querySelector("#watch-count").textContent === "1" &&
  document.querySelector("#watches").textContent.includes("0x00001000") &&
  document.querySelector("#watches").textContent.includes("33");

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

panelHarnessResult.textContent = malformedHandled && validHandled && watched && diagnosed
  ? "PASS: panel watchdog, initial unknown results, live watches, and write diagnostics work."
  : "FAIL: panel request lifecycle did not complete as expected.";
