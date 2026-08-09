const popupHarnessResult = document.querySelector("#harness-result");

function delay() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

setTimeout(async () => {
  const pinnedMode = new URLSearchParams(location.search).get("pinned") === "1";
  const rendered =
    document.querySelector(".popup-header h1").textContent === "Hack Engine" &&
    !document.querySelector(".brand-row") &&
    !document.querySelector(".tab-context") &&
    !document.querySelector("#hostname") &&
    document.querySelector("#status-title").textContent === "Ruffle memory detected" &&
    document.querySelector("#memory-count").textContent === "1 captured memory" &&
    document.querySelector("#memory-size").textContent === "4.5 MiB available" &&
    !document.querySelector("#quick-tools").hidden &&
    getComputedStyle(document.querySelector("#quick-max-label")).display === "none" &&
    getComputedStyle(document.querySelector("#quick-editor")).display === "none" &&
    document.querySelector("#scan-strategy").textContent.includes("ActionScript 3") &&
    !document.querySelector("#open-inspector").disabled &&
    !document.querySelector("#type");

  if (pinnedMode) {
    const pin = document.querySelector("#pin-popup");
    const boundToOriginalTab =
      document.body.classList.contains("pinned-window") &&
      pin.classList.contains("active") &&
      pin.getAttribute("aria-label").includes("Close pinned") &&
      popupHarnessState.retrievedTabs.length === 1 &&
      popupHarnessState.retrievedTabs[0] === 77 &&
      popupHarnessState.queriedTabs === 0;
    document.querySelector("#open-inspector").click();
    await delay();
    const inspectorUrl = new URL(popupHarnessState.createdTabs[0]?.url || location.href);
    const openedInOriginalWindow =
      inspectorUrl.pathname.endsWith("/devtools/panel/panel.html") &&
      popupHarnessState.createdTabs[0]?.windowId === 10 &&
      !popupHarnessState.closed;
    pin.click();
    await delay();
    popupHarnessResult.textContent = rendered && boundToOriginalTab && openedInOriginalWindow && popupHarnessState.closed
      ? "PASS: pinned popup stays bound to its original inspected tab and exposes unpin behavior."
      : "FAIL: pinned popup did not preserve its target tab or window state.";
    return;
  }

  const pin = document.querySelector("#pin-popup");
  pin.click();
  await delay();
  const pinnedUrl = new URL(popupHarnessState.createdWindows[0]?.url || location.href);
  const firstPinOpened =
    popupHarnessState.createdWindows.length === 1 &&
    popupHarnessState.createdWindows[0].type === "popup" &&
    popupHarnessState.createdWindows[0].width === 400 &&
    popupHarnessState.createdWindows[0].height === 680 &&
    pinnedUrl.pathname.endsWith("/popup/popup.html") &&
    pinnedUrl.searchParams.get("pinned") === "1" &&
    pinnedUrl.searchParams.get("tabId") === "77" &&
    popupHarnessState.closed;

  popupHarnessState.closed = false;
  pin.click();
  await delay();
  const secondPinReused =
    popupHarnessState.createdWindows.length === 1 &&
    popupHarnessState.updatedWindows.length === 1 &&
    popupHarnessState.updatedWindows[0].windowId === 91 &&
    popupHarnessState.updatedWindows[0].options.focused === true;
  popupHarnessState.closed = false;

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
    popupHarnessState.createdTabs[0]?.windowId === 10 &&
    popupHarnessState.closed;

  popupHarnessState.closed = false;
  document.querySelector("#refresh-connection").click();
  await delay();
  const refreshed = popupHarnessState.reloadedTabs.at(-1) === 77;

  document.querySelector("#how-it-works").click();
  await delay();
  const helpOpened =
    popupHarnessState.createdTabs.at(-1)?.url.includes("#capabilities") &&
    popupHarnessState.createdTabs.at(-1)?.windowId === 10;

  popupHarnessResult.textContent =
    rendered && firstPinOpened && secondPinReused && automaticScan && typedActions && inspectorOpened && refreshed && helpOpened
      ? "PASS: compact toolbar popup, persistent pinning, and typed quick-scan actions work."
      : "FAIL: toolbar quick-scan behavior did not match the active Ruffle state.";
}, 80);
