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
  const candidateOrder = (label, expected) => {
    expectOrder(label, ".advanced-candidate", expected);
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
  if (sort.value !== "recommended") failures.push("Results default to recommended");
  setInstances("avm1");
  showResults(preview);
  candidateOrder("AVM1", ["f64:20", "f64:40", "u8:10", "u32:30", "i32:50"]);
  setInstances("avm2");
  const avm2Order = ["i32:50", "u32:30", "f64:20", "f64:40", "u8:10"];
  candidateOrder("Updated runtime metadata", avm2Order);
  showResults(preview);
  candidateOrder("AVM2", avm2Order);
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
  }
  sort.value = "recommended";
  sort.dispatchEvent(new Event("change"));
  setInstances("unknown");
  showResults(preview);
  candidateOrder("Unknown", ["u8:10", "f64:20", "u32:30", "f64:40", "i32:50"]);
  setInstances("avm1", [{ id: "memory-2", memoryBytes: 4096, looksLikeRuffle: true, avmKind: "avm2" }]);
  showResults(preview, "memory-2");
  candidateOrder("Scan instance metadata", avm2Order);
  setInstances("avm1");
  showResults(preview, "memory-1", "avm2");
  candidateOrder("Live source metadata supersedes old scan metadata", ["f64:20", "f64:40", "u8:10", "u32:30", "i32:50"]);
  setInstances("unknown");
  showResults(preview, "memory-1", "unknown");
  popupHarnessState.emitPagePayload({ kind: "instanceUpdated", instance: {
    id: "memory-1", memoryBytes: 4096, looksLikeRuffle: true, avmKind: "avm2",
  } });
  candidateOrder("Delayed source metadata supersedes unknown scan metadata", avm2Order);
  if (document.querySelector("#advanced-avm-type").textContent !== "AVM2") failures.push("Delayed AVM guidance updates");
  setInstances("avm1");
  showResults([
    ...Array.from({ length: 21 }, (_, index) => ({ address: index, type: "i32", value: index })),
    { address: 100, type: "f64", value: 100 },
  ]);
  expectOrder("Sort retains full preview", ".advanced-candidate", [
    "f64:100", ...Array.from({ length: 21 }, (_, index) => `i32:${index}`),
  ]);
  if (document.querySelectorAll(".advanced-candidate").length !== 22) failures.push("Results retain all candidates");
  document.querySelector("#reset-quick-scan").click();
  popupHarnessState.resetInstances();
  popupHarnessState.sortingFailures = failures;
  return failures.length === 0;
}

function checkNarrowLayout() {
  const options = document.querySelector("#scan-options");
  const previous = options.open;
  for (const open of [false, true]) {
    options.open = open;
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth) {
      const overflowing = [...document.querySelectorAll("body *")].filter(element => element.getBoundingClientRect().right > document.documentElement.clientWidth + 1).map(element => `${element.tagName}#${element.id}.${element.className}:${Math.round(element.getBoundingClientRect().right)}`).slice(0, 12);
      throw new Error(`Horizontal overflow at ${innerWidth}px with options ${open ? "open" : "closed"}: ${overflowing.join(", ")}`);
    }
  }
  options.open = previous;
}

async function checkUnifiedOptions() {
  const ui = (id) => document.getElementById(id);
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const count = (kind) => popupHarnessState.commands.filter(({ payload }) => payload?.kind === kind).length;
  assert(!ui("view-switcher") && !document.querySelector("[data-view]"), "Legacy modes remain");
  assert(!ui("scan-options").open, "Specialized options should start collapsed");
  assert(document.querySelectorAll("#quick-scan, #advanced-scan").length === 1, "Duplicate scan controls remain");
  assert(document.querySelectorAll("#quick-editor, #advanced-editor").length === 1, "Duplicate selected editors remain");
  ui("scan-options").open = true;
  ui("advanced-type").value = "f64";
  ui("advanced-type").dispatchEvent(new Event("change"));
  ui("advanced-alignment").value = "byte";
  ui("advanced-alignment").dispatchEvent(new Event("change"));
  ui("scan-options").open = false;
  assert(/Float64/.test(ui("scan-options-summary").textContent) && /byte/i.test(ui("scan-options-summary").textContent), "Collapsed options hide active overrides");
  ui("quick-value").value = "8";
  const before = count("memoryScan");
  ui("quick-scan").click();
  await delay(); await delay();
  const scan = popupHarnessState.commands.filter(({ payload }) => payload?.kind === "memoryScan").at(-1).payload;
  assert(count("memoryScan") === before + 1 && scan.type === "f64" && scan.alignment === "byte", "Unified scan must dispatch once using collapsed options");
  assert(!ui("scan-options").open && ui("advanced-type").value === "f64", "Scan changed option disclosure or configuration");
  ui("reset-quick-scan").click();
  await delay();
  ui("advanced-type").value = "smart";
  ui("advanced-type").dispatchEvent(new Event("change"));
  ui("advanced-alignment").value = "aligned";
  ui("advanced-alignment").dispatchEvent(new Event("change"));
}

async function checkPlaybackControls() {
  const ui = (id) => document.getElementById(id);
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  popupHarnessState.emitMessage({ kind: "quickSession", session: null });
  popupHarnessState.resetInstances();
  assert(!ui("game-controls").hidden, "Playback controls are visible");
  assert(ui("pause-while-scanning").checked, "Saved scan pause preference is restored");
  assert(!ui("pause-game").disabled && ui("pause-game").textContent === "Pause game", "Supported games expose pause");
  ui("pause-game").click();
  await delay();
  const command = popupHarnessState.commands.filter(({ payload }) => payload.kind === "setGamePaused").at(-1);
  assert(command.frameId === 0 && command.payload.instanceId === "memory-1" && command.payload.paused === true, "Pause is routed to the selected game frame");
  assert(ui("pause-game").textContent === "Resume game" && ui("pause-game").getAttribute("aria-pressed") === "true", "Backend pause state updates the control");
  ui("pause-game").click();
  await delay();
  assert(ui("pause-game").textContent === "Pause game", "Resume restores the pause control");
  ui("quick-value").value = "8";
  ui("quick-scan").click();
  assert(ui("pause-game").disabled && ui("pause-while-scanning").disabled, "Playback controls are locked during a scan");
  await delay();
  assert(popupHarnessState.commands.filter(({ payload }) => payload.kind === "memoryScan").at(-1).payload.pauseWhileScanning === true, "Scan includes the supported pause preference");
  ui("broaden-search").click();
  await delay();
  assert(popupHarnessState.commands.filter(({ payload }) => payload.kind === "memoryScan").at(-1).payload.pauseWhileScanning === true, "Broaden scan preserves the pause preference");
  ui("pause-while-scanning").checked = false;
  ui("pause-while-scanning").dispatchEvent(new Event("change"));
  await delay();
  assert(popupHarnessState.preferences.pauseWhileScanning === false, "Scan pause preference is persisted");
  browser.storage.onChanged.emit({ pauseWhileScanning: { newValue: true } }, "local");
  assert(ui("pause-while-scanning").checked, "Scan pause preference synchronizes across open controls");
  ui("pause-while-scanning").checked = true;
  ui("pause-while-scanning").dispatchEvent(new Event("change"));
  await delay();
}

async function checkJavaScriptSources() {
  document.querySelector("#advanced-filter").value = "";
  document.querySelector("#advanced-filter").dispatchEvent(new Event("input"));
  document.querySelector('[data-workspace="candidates"]').click();
  await checkPlaybackControls();
  const ui = (id) => document.getElementById(id);
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  popupHarnessState.emitMessage({ kind: "quickSession", session: null });
  popupHarnessState.emitPagePayload({ kind: "instanceList", instances: [
    { id: "js-1", kind: "javascript", displayName: "JavaScript objects", memoryBytes: 0 },
    { id: "memory-1", kind: "wasm", memoryBytes: 4096 },
  ] });
  ui("advanced-instance").value = "0:js-1";
  ui("advanced-instance").dispatchEvent(new Event("change"));
  assert(ui("pause-game").disabled && ui("pause-while-scanning").disabled && ui("pause-while-scanning").checked, "Unsupported sources disable pause without clearing the saved preference");
  assert(ui("pause-status").textContent === "Pause is available for supported Ruffle games.", "Unsupported pause explains its scope");
  assert(ui("advanced-instance").value === "0:js-1", "Selected source is retained");
  assert(!ui("advanced-type").closest("label").hidden, "JavaScript exposes targeted number formats");
  assert(!ui("advanced-type").querySelector('[value="number"]').disabled, "JavaScript allows Number properties");
  ui("advanced-type").value = "number";
  popupHarnessState.interceptCommand = ({ payload }, emit) => {
    if (payload?.kind === "listJavaScriptRoots") {
      emit({ kind: "javaScriptRoots", requestId: payload.requestId, roots: [{ path: ["game"], displayPath: "game" }] });
      return true;
    }
    if (payload?.kind === "memoryScan" && payload.instanceId === "js-1") {
      queueMicrotask(() => emit({ kind: "scanResults", requestId: payload.requestId, instanceId: "js-1", type: payload.type, total: 1, multiplier: 1,
        searchedTypes: ["number"], coverage: { complete: false, numbers: 1 },
        preview: [{ kind: "javascript", type: "number", address: 1, value: 42, path: ["game", "score"], displayPath: "game.score" }] }));
      return true;
    }
    return false;
  };
  ui("javascript-load-roots").click();
  assert(ui("javascript-root").options.length === 2, "Object picker lists accessible roots");
  ui("javascript-root").value = '["game"]';
  ui("javascript-root").dispatchEvent(new Event("change"));
  assert(ui("scan-options-summary").textContent.includes("Selected object"), "Selected object is missing from collapsed summary");
  ui("javascript-load-roots").click();
  assert(!ui("scan-options-summary").textContent.includes("Selected object"), "Refreshed root picker left a stale selected-object summary");
  ui("javascript-root").value = '["game"]';
  ui("javascript-root").dispatchEvent(new Event("change"));
  ui("quick-scan").click();
  await delay();
  const scan = popupHarnessState.commands.filter(({ payload }) => payload.kind === "memoryScan").at(-1).payload;
  assert(scan.instanceId === "js-1" && scan.type === "number" && scan.multiplier === 1 && JSON.stringify(scan.rootPath) === '["game"]', "JavaScript scan uses selected object and no multiplier");
  assert(scan.pauseWhileScanning === false, "Unsupported scans never request pausing");
  assert(ui("quick-status").textContent.includes("incomplete"), "Partial discovery must be visible");
  assert(ui("broaden-search").hidden, "JavaScript does not offer byte formats");
  const row = document.querySelector(".advanced-candidate");
  assert(row.querySelector(".candidate-address").textContent === "game.score", "JavaScript candidates show paths");
  row.click();
  checkNarrowLayout();
  const watch = popupHarnessState.commands.filter((command) => command.action === "upsertWatch").at(-1)?.watch;
  assert(watch?.kind === "javascript" && watch.displayPath === "game.score" && watch.path[0] === "game", "Shared watch retains JavaScript identity metadata");
  popupHarnessState.emitPagePayload({ kind: "scanResults", requestId: "quick:empty-js", instanceId: "js-1", total: 0, preview: [], coverage: { complete: true, numbers: 0 } });
  assert(ui("quick-status").textContent.includes("No accessible numeric state"), "No accessible state differs from no matches");
  delete popupHarnessState.interceptCommand;
  return true;
}

setTimeout(async () => {
  try {
  const parameters = new URLSearchParams(location.search);
  const sidebarMode = parameters.get("sidebar") === "1";
  const popoutMode = parameters.get("popout") === "1";
  const rendered =
    document.querySelector(".popup-header h1").textContent === "Hack Engine" &&
    !document.querySelector(".brand-row") &&
    !document.querySelector(".tab-context") &&
    !document.querySelector("#hostname") &&
    document.querySelector(".popup-header #status-title")?.textContent === "Game inspection available" &&
    !document.querySelector(".connection-state") &&
    !document.querySelector("#memory-summary") &&
    !document.querySelector("#scan-tools").hidden &&
    getComputedStyle(document.querySelector("#quick-max-label")).display === "none" &&
    getComputedStyle(document.querySelector("#quick-editor")).display === "none" &&
    !document.querySelector("#scan-strategy") &&
    !document.querySelector("#open-inspector") &&
    !document.querySelector("#type");
  const recommendedSorting = checkRecommendedSorting();
  await checkUnifiedOptions();

  if (sidebarMode) {
    const pin = document.querySelector("#pin-popup");
    const scanOptions = document.querySelector("#scan-options");
    const boundToOriginalTab =
      document.body.classList.contains("sidebar-panel") &&
      !scanOptions.open &&
      pin.classList.contains("active") &&
      pin.getAttribute("aria-label").includes("Close Hack Engine sidebar") &&
      popupHarnessState.retrievedTabs.length === 1 &&
      popupHarnessState.retrievedTabs[0] === 77 &&
      popupHarnessState.queriedTabs === 0;

    scanOptions.open = true;
    document.querySelector("#advanced-type").value = "f64";
    document.querySelector("#advanced-alignment").value = "byte";
    document.querySelector("#quick-value").value = "8";
    document.querySelector("#quick-scan").click();
    await delay();
    await delay();
    const advancedCommand = popupHarnessState.commands.find(({ payload }) =>
      payload.kind === "memoryScan" && payload.type === "f64",
    );
    await delay(280);
    const advancedRow = document.querySelector(".advanced-candidate");
    const advancedScanWorked =
      !document.querySelector("#scan-tools").hidden &&
      advancedCommand?.payload.alignment === "byte" &&
      advancedCommand.payload.multiplier === 1 &&
      advancedRow?.querySelector(".candidate-value")?.textContent === "9" &&
      advancedRow?.querySelector(".candidate-type")?.textContent === "f64" &&
      document.querySelector("#quick-scan").textContent === "Next scan";
    advancedRow?.click();
    checkNarrowLayout();
    document.querySelector("#quick-set-min").click();
    const advancedMinPreset = Number(document.querySelector("#quick-write-value").value) === -Number.MAX_VALUE;
    document.querySelector("#quick-set-max").click();
    const advancedMaxPreset = Number(document.querySelector("#quick-write-value").value) === Number.MAX_VALUE;
    const watchAdded =
      document.querySelector("#advanced-watch-count").textContent === "1" &&
      document.querySelectorAll(".watch-row").length === 1 &&
      !document.querySelector("#quick-editor").hidden;
    document.querySelector("#advanced-filter").value = "missing";
    document.querySelector("#advanced-filter").dispatchEvent(new Event("input"));
    const filterWorked = document.querySelectorAll(".advanced-candidate").length === 0;
    scanOptions.open = false;
    const sharedSession =
      !document.querySelector("#scan-tools").hidden &&
      document.querySelector("#quick-scan").textContent === "Next scan" &&
      document.querySelector("#advanced-result-count").textContent === "1";
    scanOptions.open = true;
    document.querySelector('[data-workspace="watches"]').click();
    const watchWorkspace =
      !document.querySelector("#advanced-watch-pane").hidden &&
      document.querySelector("#advanced-candidate-pane").hidden;
    document.querySelector("#reset-quick-scan").click();
    await delay();
    const watchSurvivedReset =
      document.querySelector("#advanced-watch-count").textContent === "1" &&
      document.querySelectorAll(".watch-row").length === 1 &&
      document.querySelectorAll(".advanced-candidate").length === 0 &&
      document.querySelector("#quick-scan").textContent === "First scan";

    document.querySelector("#how-it-works").click();
    await delay();
    const openedInOriginalWindow =
      popupHarnessState.createdTabs[0]?.url.includes("#capabilities") &&
      popupHarnessState.createdTabs[0]?.windowId === 10 &&
      !popupHarnessState.closed;
    pin.click();
    await delay();
    const sidebarClosed = popupHarnessState.sidebarCloseCount === 1 && !popupHarnessState.closed;
    const javascriptSources = await checkJavaScriptSources();
    popupHarnessResult.textContent = javascriptSources && rendered && recommendedSorting && boundToOriginalTab && advancedScanWorked && advancedMinPreset && advancedMaxPreset && watchAdded && filterWorked && sharedSession && watchWorkspace && watchSurvivedReset && openedInOriginalWindow && sidebarClosed
      ? "PASS: Firefox sidebar exposes unified scans, live candidates, watches, and tab-bound docking."
      : "FAIL: Firefox sidebar unified controls did not preserve its scan, candidates, watches, or docked state.";
    return;
  }

  if (popoutMode) {
    const pin = document.querySelector("#pin-popup");
    const boundToOriginalTab =
      document.body.classList.contains("popout-window") &&
      !document.querySelector("#view-switcher") &&
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
    const javascriptSources = await checkJavaScriptSources();
    popupHarnessResult.textContent = javascriptSources && rendered && recommendedSorting && boundToOriginalTab && docked
      ? "PASS: pop-out mode remains tab-bound and can dock into the Firefox sidebar."
      : "FAIL: pop-out mode did not preserve or dock its target tab.";
    return;
  }

  const pin = document.querySelector("#pin-popup");
  const nativePopupUnified = !document.querySelector("#view-switcher") && !document.querySelector("#scan-options").open;
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
  const scanCommand = popupHarnessState.commands.filter(({ payload }) => payload.kind === "memoryScan").at(-1);
  const automaticScan =
    scanCommand?.payload.type === "smart" &&
    scanCommand.payload.rawValue === "8" &&
    document.querySelector("#advanced-result-count").textContent === "1" &&
    document.querySelectorAll(".advanced-candidate").length === 1 &&
    document.querySelector("#quick-scan").textContent === "Next scan";
  await delay();
  const liveCandidateRefresh =
    popupHarnessState.candidateReadCount >= 1 &&
    popupHarnessState.commands.some(({ payload }) => payload.kind === "readValues") &&
    document.querySelector(".candidate-value").textContent === "9";

  document.querySelector(".advanced-candidate").click();
  checkNarrowLayout();
  document.querySelector("#quick-set-min").click();
  const quickMinPreset = document.querySelector("#quick-write-value").value === "-2147483648";
  document.querySelector("#quick-set-max").click();
  const quickMaxPreset = document.querySelector("#quick-write-value").value === "2147483647";
  document.querySelector("#quick-write-value").value = "999";
  const writesBefore = popupHarnessState.commands.filter(({ payload }) => payload?.kind === "writeValue").length;
  const freezesBefore = popupHarnessState.commands.filter(({ payload }) => payload?.kind === "setFreeze").length;
  document.querySelector("#quick-write").click();
  document.querySelector("#quick-freeze").click();
  await delay();
  const writeCommand = popupHarnessState.commands.find(({ payload }) => payload.kind === "writeValue");
  const freezeCommand = popupHarnessState.commands.find(({ payload }) => payload.kind === "setFreeze");
  const typedActions =
    popupHarnessState.commands.filter(({ payload }) => payload?.kind === "writeValue").length === writesBefore + 1 &&
    popupHarnessState.commands.filter(({ payload }) => payload?.kind === "setFreeze").length === freezesBefore + 1 &&
    writeCommand?.payload.type === "i32" &&
    writeCommand.payload.address === 4096 &&
    writeCommand.payload.rawValue === "999" &&
    freezeCommand?.payload.type === "i32" &&
    freezeCommand.payload.enabled === true &&
    document.querySelector("#quick-freeze").classList.contains("freeze-active");

  document.querySelector("#how-it-works").click();
  await delay();
  const helpOpened =
    popupHarnessState.createdTabs.at(-1)?.url.includes("#capabilities") &&
    popupHarnessState.createdTabs.at(-1)?.windowId === 10;

  const javascriptSources = await checkJavaScriptSources();
  popupHarnessResult.textContent =
    javascriptSources && rendered && recommendedSorting && nativePopupUnified && pinDocked && firstPopoutOpened && secondPopoutReused && automaticScan && liveCandidateRefresh && quickMinPreset && quickMaxPreset && typedActions && helpOpened
      ? "PASS: compact toolbar popup, live candidates, Firefox sidebar docking, pop-out reuse, and typed quick-scan actions work."
      : "FAIL: toolbar quick-scan behavior did not match the active Ruffle state.";
  } catch (error) { popupHarnessResult.textContent = `FAIL: ${error.stack || error}`; }
}, 80);
