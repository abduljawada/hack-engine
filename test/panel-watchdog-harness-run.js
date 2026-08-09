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

panelHarnessResult.textContent = malformedHandled && validHandled
  ? "PASS: results end the watchdog before rendering and initial unknown scans render without rows."
  : "FAIL: panel request lifecycle did not complete as expected.";
