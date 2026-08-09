const popupHarnessResult = document.querySelector("#harness-result");

function delay() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

setTimeout(async () => {
  const rendered =
    document.querySelector("#hostname").textContent === "bubblebox.com" &&
    document.querySelector("#status-title").textContent === "Ruffle memory detected" &&
    document.querySelector("#memory-count").textContent === "1 captured memory" &&
    document.querySelector("#memory-size").textContent === "4.5 MiB available" &&
    !document.querySelector("#quick-tools").hidden &&
    getComputedStyle(document.querySelector("#quick-max-label")).display === "none" &&
    getComputedStyle(document.querySelector("#quick-editor")).display === "none" &&
    document.querySelector("#scan-strategy").textContent.includes("ActionScript 3") &&
    !document.querySelector("#open-inspector").disabled &&
    !document.querySelector("#type");

  document.querySelector("#quick-value").value = "8";
  document.querySelector("#quick-scan").click();
  await delay();
  await delay();
  const scanCommand = popupHarnessState.commands.find(({ payload }) => payload.kind === "memoryScan");
  const automaticScan =
    scanCommand?.payload.type === "smart" &&
    scanCommand.payload.rawValue === "8" &&
    document.querySelector("#quick-result-count").textContent === "1" &&
    document.querySelectorAll(".quick-candidate").length === 1 &&
    document.querySelector("#quick-scan").textContent === "Next scan";

  document.querySelector(".quick-candidate").click();
  document.querySelector("#quick-write-value").value = "999";
  document.querySelector("#quick-write").click();
  document.querySelector("#quick-freeze").click();
  await delay();
  const writeCommand = popupHarnessState.commands.find(({ payload }) => payload.kind === "writeValue");
  const freezeCommand = popupHarnessState.commands.find(({ payload }) => payload.kind === "setFreeze");
  const typedActions =
    writeCommand?.payload.type === "i32" &&
    writeCommand.payload.address === 4096 &&
    writeCommand.payload.rawValue === "999" &&
    freezeCommand?.payload.type === "i32" &&
    freezeCommand.payload.enabled === true &&
    document.querySelector("#quick-freeze").classList.contains("freeze-active");

  document.querySelector("#open-inspector").click();
  await delay();
  const inspectorUrl = new URL(popupHarnessState.createdTabs[0]?.url || location.href);
  const inspectorOpened =
    inspectorUrl.pathname.endsWith("/devtools/panel/panel.html") &&
    inspectorUrl.searchParams.get("standalone") === "1" &&
    inspectorUrl.searchParams.get("tabId") === "77" &&
    popupHarnessState.closed;

  popupHarnessState.closed = false;
  document.querySelector("#refresh-connection").click();
  await delay();
  const refreshed = popupHarnessState.reloadedTabs.at(-1) === 77;

  document.querySelector("#how-it-works").click();
  await delay();
  const helpOpened = popupHarnessState.createdTabs.at(-1)?.url.includes("#capabilities");

  popupHarnessResult.textContent =
    rendered && automaticScan && typedActions && inspectorOpened && refreshed && helpOpened
      ? "PASS: type-free quick scan and its typed candidate actions work in the toolbar popup."
      : "FAIL: toolbar quick-scan behavior did not match the active Ruffle state.";
}, 80);
