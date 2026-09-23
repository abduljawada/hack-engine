const popupHarnessResult = document.querySelector("#harness-result");

function delay(milliseconds = 0) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function checkRecommendedSorting() {
  const failures = [];
  const sort = document.querySelector("#advanced-sort");
  const order = (selector) => [...document.querySelectorAll(selector)]
    .map((row) => row.dataset.candidateKey.split(":").slice(-2).join(":"));
  const expectOrder = (label, selector, expected) => {
    if (JSON.stringify(order(selector)) !== JSON.stringify(expected)) failures.push(label);
  };
  const bothOrders = (label, expected) => {
    expectOrder(`${label} Simple`, ".quick-candidate", expected);
    expectOrder(`${label} Advanced`, ".advanced-candidate", expected);
  };
  const setInstances = (avmKind, additional = []) => popupHarnessState.emitPagePayload({
    kind: "instanceList",
    instances: [{ id: "memory-1", memoryBytes: 4096, looksLikeRuffle: true, avmKind }, ...additional],
  });
  const showResults = (preview, instanceId = "memory-1", avmKind) => popupHarnessState.emitPagePayload({
    kind: "scanResults",
    requestId: "quick:harness-sort",
    instanceId,
    ...(avmKind ? { avmKind } : {}),
    type: "auto",
    multiplier: 1,
    total: preview.length,
    preview: preview.map((candidate) => ({ ...candidate, displayValue: candidate.value, multiplier: 1 })),
    allCandidates: false,
  });
  const preview = [
    { address: 10, type: "u8", value: 1 },
    { address: 40, type: "f64", value: 2 },
    { address: 30, type: "u32", value: 5 },
    { address: 50, type: "i32", value: 4 },
    { address: 20, type: "f64", value: 3 },
  ];
  if (sort.value !== "recommended") failures.push("Advanced defaults to recommended");
  setInstances("avm1");
  showResults(preview);
  bothOrders("AVM1", ["f64:20", "f64:40", "u8:10", "u32:30", "i32:50"]);
  setInstances("avm2");
  const avm2Order = ["i32:50", "u32:30", "f64:20", "f64:40", "u8:10"];
  bothOrders("Updated runtime metadata", avm2Order);
  showResults(preview);
  bothOrders("AVM2", avm2Order);
  for (const [mode, expected] of [
    ["address", ["u8:10", "f64:20", "u32:30", "f64:40", "i32:50"]],
    ["value", ["u8:10", "f64:40", "f64:20", "i32:50", "u32:30"]],
    ["addressDesc", ["i32:50", "f64:40", "u32:30", "f64:20", "u8:10"]],
    ["valueDesc", ["u32:30", "i32:50", "f64:20", "f64:40", "u8:10"]],
    ["type", ["f64:20", "f64:40", "i32:50", "u32:30", "u8:10"]],
  ]) {
    sort.value = mode;
    sort.dispatchEvent(new Event("change"));
    expectOrder(`${mode} override`, ".advanced-candidate", expected);
    expectOrder(`${mode} leaves Simple recommended`, ".quick-candidate", avm2Order);
  }
  sort.value = "recommended";
  sort.dispatchEvent(new Event("change"));
  setInstances("unknown");
  showResults(preview);
  bothOrders("Unknown", ["u8:10", "f64:20", "u32:30", "f64:40", "i32:50"]);
  setInstances("avm1", [{ id: "memory-2", memoryBytes: 4096, looksLikeRuffle: true, avmKind: "avm2" }]);
  showResults(preview, "memory-2");
  bothOrders("Scan instance metadata", avm2Order);
  setInstances("avm1");
  showResults(preview, "memory-1", "avm2");
  bothOrders("Scan result runtime metadata", avm2Order);
  showResults([
    ...Array.from({ length: 21 }, (_, index) => ({ address: index, type: "i32", value: index })),
    { address: 100, type: "f64", value: 100 },
  ]);
  expectOrder("Sort before Simple cap", ".quick-candidate", [
    "f64:100", ...Array.from({ length: 19 }, (_, index) => `i32:${index}`),
  ]);
  if (document.querySelectorAll(".advanced-candidate").length !== 22) failures.push("Advanced retains all candidates");
  document.querySelector("#reset-quick-scan").click();
  popupHarnessState.resetInstances();
  popupHarnessState.sortingFailures = failures;
  return failures.length === 0;
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
    !document.querySelector("#open-inspector") &&
    !document.querySelector("#type");
  const recommendedSorting = checkRecommendedSorting();

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

    document.querySelector("#how-it-works").click();
    await delay();
    const openedInOriginalWindow =
      popupHarnessState.createdTabs[0]?.url.includes("#capabilities") &&
      popupHarnessState.createdTabs[0]?.windowId === 10 &&
      !popupHarnessState.closed;
    pin.click();
    await delay();
    const sidebarClosed = popupHarnessState.sidebarCloseCount === 1 && !popupHarnessState.closed;
    popupHarnessResult.textContent = rendered && recommendedSorting && boundToOriginalTab && advancedScanWorked && advancedMinPreset && advancedMaxPreset && watchAdded && filterWorked && sharedSession && watchWorkspace && watchSurvivedReset && openedInOriginalWindow && sidebarClosed
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
    popupHarnessResult.textContent = rendered && recommendedSorting && boundToOriginalTab && docked
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
    rendered && recommendedSorting && nativePopupStayedSimple && pinDocked && firstPopoutOpened && secondPopoutReused && automaticScan && liveCandidateRefresh && quickMinPreset && quickMaxPreset && typedActions && refreshed && helpOpened
      ? "PASS: compact toolbar popup, live candidates, Firefox sidebar docking, pop-out reuse, and typed quick-scan actions work."
      : "FAIL: toolbar quick-scan behavior did not match the active Ruffle state.";
}, 80);
