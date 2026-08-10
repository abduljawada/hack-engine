const popupHarnessResult = document.querySelector("#harness-result");

function delay(milliseconds = 0) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

setTimeout(async () => {
  const parameters = new URLSearchParams(location.search);
  const sidebarMode = parameters.get("sidebar") === "1";
  const popoutMode = parameters.get("popout") === "1";
  const rendered =
    document.querySelector(".popup-header h1").textContent === "Hack Engine" &&
    !document.querySelector(".brand-row") &&
    !document.querySelector(".tab-context") &&
    !document.querySelector("#hostname") &&
    document.querySelector(".popup-header #status-title")?.textContent === "Ruffle memory detected" &&
    !document.querySelector(".connection-state") &&
    !document.querySelector("#memory-summary") &&
    !document.querySelector("#quick-tools").hidden &&
    getComputedStyle(document.querySelector("#quick-max-label")).display === "none" &&
    getComputedStyle(document.querySelector("#quick-editor")).display === "none" &&
    !document.querySelector("#scan-strategy") &&
    !document.querySelector("#open-inspector").disabled &&
    !document.querySelector("#type");

  if (sidebarMode) {
    const pin = document.querySelector("#pin-popup");
    const viewSwitcher = document.querySelector("#view-switcher");
    const boundToOriginalTab =
      document.body.classList.contains("sidebar-panel") &&
      !viewSwitcher.hidden &&
      pin.classList.contains("active") &&
      pin.getAttribute("aria-label").includes("Close Hack Engine sidebar") &&
      popupHarnessState.retrievedTabs.length === 1 &&
      popupHarnessState.retrievedTabs[0] === 77 &&
      popupHarnessState.queriedTabs === 0;

    viewSwitcher.querySelector('[data-view="advanced"]').click();
    document.querySelector("#advanced-type").value = "f64";
    document.querySelector("#advanced-alignment").value = "byte";
    document.querySelector("#advanced-multiplier").value = "4";
    document.querySelector("#advanced-value").value = "8";
    document.querySelector("#advanced-scan").click();
    await delay();
    await delay();
    const advancedCommand = popupHarnessState.commands.find(({ payload }) =>
      payload.kind === "memoryScan" && payload.type === "f64",
    );
    await delay(280);
    const advancedRow = document.querySelector(".advanced-candidate");
    const advancedScanWorked =
      document.body.classList.contains("advanced-active") &&
      document.querySelector("#quick-tools").hidden &&
      !document.querySelector("#advanced-tools").hidden &&
      advancedCommand?.payload.alignment === "byte" &&
      advancedCommand.payload.multiplier === 4 &&
      advancedRow?.querySelector(".candidate-value")?.textContent === "9" &&
      advancedRow?.querySelector(".candidate-type")?.textContent === "f64" &&
      document.querySelector("#advanced-scan").textContent === "Next scan";
    advancedRow?.click();
    document.querySelector("#advanced-set-min").click();
    const advancedMinPreset = Number(document.querySelector("#advanced-write-value").value) === -Number.MAX_VALUE;
    document.querySelector("#advanced-set-max").click();
    const advancedMaxPreset = Number(document.querySelector("#advanced-write-value").value) === Number.MAX_VALUE;
    const watchAdded =
      document.querySelector("#advanced-watch-count").textContent === "1" &&
      document.querySelectorAll(".watch-row").length === 1 &&
      !document.querySelector("#advanced-editor").hidden;
    document.querySelector("#advanced-filter").value = "missing";
    document.querySelector("#advanced-filter").dispatchEvent(new Event("input"));
    const filterWorked = document.querySelectorAll(".advanced-candidate").length === 0;
    viewSwitcher.querySelector('[data-view="simple"]').click();
    const sharedSession =
      !document.querySelector("#quick-tools").hidden &&
      document.querySelector("#quick-scan").textContent === "Next scan" &&
      document.querySelector("#quick-result-count").textContent === "1";
    viewSwitcher.querySelector('[data-view="advanced"]').click();
    document.querySelector('[data-workspace="watches"]').click();
    const watchWorkspace =
      !document.querySelector("#advanced-watch-pane").hidden &&
      document.querySelector("#advanced-candidate-pane").hidden;
    document.querySelector("#reset-advanced-scan").click();
    await delay();
    const watchSurvivedReset =
      document.querySelector("#advanced-watch-count").textContent === "1" &&
      document.querySelectorAll(".watch-row").length === 1 &&
      document.querySelectorAll(".advanced-candidate").length === 0 &&
      document.querySelector("#advanced-scan").textContent === "First scan";

    document.querySelector("#open-inspector").click();
    await delay();
    const inspectorUrl = new URL(popupHarnessState.createdTabs[0]?.url || location.href);
    const openedInOriginalWindow =
      inspectorUrl.pathname.endsWith("/devtools/panel/panel.html") &&
      popupHarnessState.createdTabs[0]?.windowId === 10 &&
      !popupHarnessState.closed;
    pin.click();
    await delay();
    const sidebarClosed = popupHarnessState.sidebarCloseCount === 1 && !popupHarnessState.closed;
    popupHarnessResult.textContent = rendered && boundToOriginalTab && advancedScanWorked && advancedMinPreset && advancedMaxPreset && watchAdded && filterWorked && sharedSession && watchWorkspace && watchSurvivedReset && openedInOriginalWindow && sidebarClosed
      ? "PASS: Firefox sidebar shares Simple and Advanced scans, live candidates, watches, and tab-bound docking."
      : "FAIL: Firefox sidebar Advanced mode did not preserve its scan, candidates, watches, or docked state.";
    return;
  }

  if (popoutMode) {
    const pin = document.querySelector("#pin-popup");
    const boundToOriginalTab =
      document.body.classList.contains("popout-window") &&
      !document.querySelector("#view-switcher").hidden &&
      !pin.classList.contains("active") &&
      pin.getAttribute("aria-label").includes("Dock Hack Engine") &&
      document.querySelector("#pop-out-window").hidden &&
      popupHarnessState.retrievedTabs.length === 1 &&
      popupHarnessState.retrievedTabs[0] === 77 &&
      popupHarnessState.queriedTabs === 0;
    pin.click();
    await delay();
    const docked =
      popupHarnessState.sidebarPanels.length === 1 &&
      popupHarnessState.sidebarPanels[0].tabId === 77 &&
      new URL(popupHarnessState.sidebarPanels[0].panel).searchParams.get("sidebar") === "1" &&
      popupHarnessState.sidebarOpenCount === 1 &&
      popupHarnessState.sidebarOpenedDuringUserAction &&
      popupHarnessState.closed;
    popupHarnessResult.textContent = rendered && boundToOriginalTab && docked
      ? "PASS: pop-out mode remains tab-bound and can dock into the Firefox sidebar."
      : "FAIL: pop-out mode did not preserve or dock its target tab.";
    return;
  }

  const pin = document.querySelector("#pin-popup");
  const nativePopupStayedSimple = document.querySelector("#view-switcher").hidden;
  pin.click();
  await delay();
  const sidebarUrl = new URL(popupHarnessState.sidebarPanels[0]?.panel || location.href);
  const pinDocked =
    popupHarnessState.sidebarPanels.length === 1 &&
    popupHarnessState.sidebarPanels[0].tabId === 77 &&
    sidebarUrl.pathname.endsWith("/popup/popup.html") &&
    sidebarUrl.searchParams.get("sidebar") === "1" &&
    sidebarUrl.searchParams.get("tabId") === "77" &&
    popupHarnessState.sidebarOpenCount === 1 &&
    popupHarnessState.sidebarOpenedDuringUserAction &&
    popupHarnessState.closed;

  popupHarnessState.closed = false;
  const popOut = document.querySelector("#pop-out-window");
  popOut.click();
  await delay();
  const popoutUrl = new URL(popupHarnessState.createdWindows[0]?.url || location.href);
  const firstPopoutOpened =
    popupHarnessState.createdWindows.length === 1 &&
    popupHarnessState.createdWindows[0].type === "popup" &&
    popupHarnessState.createdWindows[0].width === 400 &&
    popupHarnessState.createdWindows[0].height === 680 &&
    popoutUrl.pathname.endsWith("/popup/popup.html") &&
    popoutUrl.searchParams.get("popout") === "1" &&
    popoutUrl.searchParams.get("tabId") === "77" &&
    popupHarnessState.closed;

  popupHarnessState.closed = false;
  popOut.click();
  await delay();
  const secondPopoutReused =
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
  await delay();
  const liveCandidateRefresh =
    popupHarnessState.candidateReadCount >= 1 &&
    popupHarnessState.commands.some(({ payload }) => payload.kind === "readValues") &&
    document.querySelector(".candidate-value").textContent === "9";

  document.querySelector(".quick-candidate").click();
  document.querySelector("#quick-set-min").click();
  const quickMinPreset = document.querySelector("#quick-write-value").value === "-2147483648";
  document.querySelector("#quick-set-max").click();
  const quickMaxPreset = document.querySelector("#quick-write-value").value === "2147483647";
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
    rendered && nativePopupStayedSimple && pinDocked && firstPopoutOpened && secondPopoutReused && automaticScan && liveCandidateRefresh && quickMinPreset && quickMaxPreset && typedActions && inspectorOpened && refreshed && helpOpened
      ? "PASS: compact toolbar popup, live candidates, Firefox sidebar docking, pop-out reuse, and typed quick-scan actions work."
      : "FAIL: toolbar quick-scan behavior did not match the active Ruffle state.";
}, 80);
