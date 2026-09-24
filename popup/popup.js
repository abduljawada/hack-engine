(() => {
  "use strict";

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const CANDIDATE_REFRESH_MS = 250;
  const MAX_ADVANCED_CANDIDATES = 200;
  const MAX_SHARED_WATCHES = 256;
  const MAX_LIVE_READS = 256;
  const AVM_RECOMMENDED_TYPES = Object.freeze({
    avm1: ["f64"],
    avm2: ["i32", "u32", "f64"],
  });
  const TYPE_LABELS = Object.freeze({ i32: "Int32 (i32)", u32: "Uint32 (u32)", f64: "Float64 (f64)" });
  const NUMERIC_LIMITS = Object.freeze({
    i8: ["-128", "127"],
    u8: ["0", "255"],
    i16: ["-32768", "32767"],
    u16: ["0", "65535"],
    i32: ["-2147483648", "2147483647"],
    u32: ["0", "4294967295"],
    f32: ["-3.4028234663852886e+38", "3.4028234663852886e+38"],
    number: ["-1.7976931348623157e+308", "1.7976931348623157e+308"],
    f64: ["-1.7976931348623157e+308", "1.7976931348623157e+308"],
  });
  const popupParameters = new URLSearchParams(location.search);
  const boundTabId = Number(popupParameters.get("tabId"));
  const isSidebarPanel = popupParameters.get("sidebar") === "1" || location.pathname.endsWith("/sidebar.html");
  const isPopoutWindow = popupParameters.get("popout") === "1";
  const hasBoundTab =
    (isSidebarPanel || isPopoutWindow) &&
    popupParameters.has("tabId") &&
    Number.isInteger(boundTabId) &&
    boundTabId >= 0;
  const instances = new Map();
  const frozenCandidates = new Set();
  const candidateRecords = new Map();
  const watchedCandidates = new Map();
  const candidateReadRequests = new Map();
  const pendingCandidateInstances = new Set();
  let activeTab = null;
  let port = null;
  let reconnectTimer = null;
  let closing = false;
  let editorSelectionKey = "";
  let pollTimer = null;
  let candidateRefreshTimer = null;
  let requestSequence = 1;
  let quickSession = null;
  let selectedCandidate = null;
  let activeView = "simple";
  let activeWorkspace = "candidates";
  let memoryDetected = false;
  let hasScanResults = false;
  let candidateTotal = 0;
  let diagnostics = {};
  let scanWatchdog;
  let watchdogRequest = null;
  let watchdogProgress = null;
  let stalledRequest = null;
  let renderedResult = null;
  let rootsRequest = null;
  let sourceChosen = false;
  const ui = (id) => document.getElementById(id);

  const elements = {
    pin: document.querySelector("#pin-popup"),
    statusDot: document.querySelector("#status-dot"),
    statusTitle: document.querySelector("#status-title"),
    connectionState: document.querySelector(".header-status"),
    viewSwitcher: document.querySelector("#view-switcher"),
    viewButtons: [...document.querySelectorAll("#view-switcher [data-view]")],
    quickTools: document.querySelector("#quick-tools"),
    condition: document.querySelector("#quick-condition"),
    value: document.querySelector("#quick-value"),
    valueLabel: document.querySelector("#quick-value-label"),
    valueText: document.querySelector("#quick-value-text"),
    maxValue: document.querySelector("#quick-max-value"),
    maxLabel: document.querySelector("#quick-max-label"),
    scan: document.querySelector("#quick-scan"),
    cancel: document.querySelector("#cancel-quick-scan"),
    reset: document.querySelector("#reset-quick-scan"),
    quickStatus: document.querySelector("#quick-status"),
    results: document.querySelector("#quick-results"),
    resultCount: document.querySelector("#quick-result-count"),
    candidates: document.querySelector("#quick-candidates"),
    broaden: document.querySelector("#broaden-search"),
    editor: document.querySelector("#quick-editor"),
    selectedAddress: document.querySelector("#selected-address"),
    writeValue: document.querySelector("#quick-write-value"),
    quickSetMin: document.querySelector("#quick-set-min"),
    quickSetMax: document.querySelector("#quick-set-max"),
    write: document.querySelector("#quick-write"),
    freeze: document.querySelector("#quick-freeze"),
    advancedTools: document.querySelector("#advanced-tools"),
    advancedAvmType: document.querySelector("#advanced-avm-type"),
    advancedRecommendedTypes: document.querySelector("#advanced-recommended-types"),
    advancedRuntimeHint: document.querySelector("#advanced-runtime-hint"),
    advancedSessionBadge: document.querySelector("#advanced-session-badge"),
    advancedCondition: document.querySelector("#advanced-condition"),
    advancedValue: document.querySelector("#advanced-value"),
    advancedValueLabel: document.querySelector("#advanced-value-label"),
    advancedValueText: document.querySelector("#advanced-value-text"),
    advancedMaxValue: document.querySelector("#advanced-max-value"),
    advancedMaxLabel: document.querySelector("#advanced-max-label"),
    advancedType: document.querySelector("#advanced-type"),
    advancedAlignment: document.querySelector("#advanced-alignment"),
    advancedInstance: document.querySelector("#advanced-instance"),
    advancedInstanceLabel: document.querySelector("#advanced-instance-label"),
    advancedScan: document.querySelector("#advanced-scan"),
    advancedCancel: document.querySelector("#cancel-advanced-scan"),
    advancedReset: document.querySelector("#reset-advanced-scan"),
    advancedStatus: document.querySelector("#advanced-status"),
    advancedWorkspace: document.querySelector("#advanced-workspace"),
    workspaceButtons: [...document.querySelectorAll("[data-workspace]")],
    advancedCandidatePane: document.querySelector("#advanced-candidate-pane"),
    advancedWatchPane: document.querySelector("#advanced-watch-pane"),
    advancedResultCount: document.querySelector("#advanced-result-count"),
    advancedWatchCount: document.querySelector("#advanced-watch-count"),
    advancedFilter: document.querySelector("#advanced-filter"),
    advancedSort: document.querySelector("#advanced-sort"),
    advancedCandidates: document.querySelector("#advanced-candidates"),
    advancedWatches: document.querySelector("#advanced-watches"),
    advancedWatchEmpty: document.querySelector("#advanced-watch-empty"),
    advancedEditor: document.querySelector("#advanced-editor"),
    advancedSelectedAddress: document.querySelector("#advanced-selected-address"),
    advancedWriteValue: document.querySelector("#advanced-write-value"),
    advancedSetMin: document.querySelector("#advanced-set-min"),
    advancedSetMax: document.querySelector("#advanced-set-max"),
    advancedWrite: document.querySelector("#advanced-write"),
    advancedFreeze: document.querySelector("#advanced-freeze"),
    popOut: document.querySelector("#pop-out-window"),
    howItWorks: document.querySelector("#how-it-works"),
  };

  function markUnavailable(entry, reason) {
    entry.readError = reason || "This address could not be read.";
    entry.candidate.value = undefined;
    entry.candidate.displayValue = undefined;
    for (const cell of entry.valueCells) cell.textContent = "—";
  }

  function diagnosticFor(key) {
    const entry = watchedCandidates.get(key) || candidateRecords.get(key);
    const diagnostic = diagnostics[key];
    if (entry?.readError) return { label: "Unavailable", detail: entry.readError };
    if (frozenCandidates.has(key)) return { label: "Frozen", detail: "Rewritten while the game is visible. Use Unfreeze here or Stop all freezes below." };
    const labels = { checking: "Checking write…", verified: "Verified through 250 ms", persistent: "Verified through 250 ms", restored: "Game restored it", rejected: "Write rejected", unavailable: "Unavailable" };
    return diagnostic ? { label: labels[diagnostic.state] || "Live", detail: diagnostic.detail || "" }
      : { label: entry?.candidate.value === undefined ? "Waiting for value" : "Live", detail: "Current read only; no retained write diagnostic." };
  }

  function updateDiagnosticUI() {
    for (const node of document.querySelectorAll("[data-watch-key]")) {
      const state = diagnosticFor(node.dataset.watchKey);
      node.querySelector(".watch-state").textContent = state.label;
      node.querySelector(".watch-detail").textContent = state.detail;
    }
    const state = selectedCandidate ? diagnosticFor(candidateKey(selectedCandidate)) : null;
    for (const node of document.querySelectorAll(".selected-feedback")) node.textContent = state ? `${state.label}${state.detail ? ` · ${state.detail}` : ""}` : "";
  }

  function updateScanWatchdog() {
    if (!port || quickSession?.status !== "scanning") {
      clearTimeout(scanWatchdog); watchdogRequest = null; watchdogProgress = null; stalledRequest = null; return;
    }
    const id = quickSession.requestId;
    const progress = JSON.stringify(quickSession.progress || null);
    if (watchdogRequest === id && watchdogProgress === progress) return;
    clearTimeout(scanWatchdog); watchdogRequest = id; watchdogProgress = progress;
    if (stalledRequest === id) return;
    scanWatchdog = setTimeout(() => {
      if (!port || quickSession?.status !== "scanning" || quickSession.requestId !== id) return;
      stalledRequest = id;
      setQuickStatus("No recent progress. The scan may still be running; Cancel remains available.");
      send({ kind: "getSessionState", requestId: nextRequestId("recover") }, quickSession.frameId);
    }, 15000);
  }

  function installAdvancedControls() {
    ui("advanced-instance").addEventListener("change", () => {
      renderCandidateLists(); renderWatches();
    });
  }

  function nextRequestId(action = "scan") {
    return `quick:${action}:${Date.now()}:${requestSequence++}`;
  }

  function formatAddress(address) {
    return `0x${Number(address).toString(16).padStart(8, "0")}`;
  }

  function candidateLocation(candidate) {
    return candidate.kind === "javascript" || candidate.type === "number"
      ? candidate.displayPath || (candidate.path || []).join(".") || "JavaScript value"
      : formatAddress(candidate.address);
  }

  function newTabOptions(url) {
    return Number.isInteger(activeTab?.windowId)
      ? { url, windowId: activeTab.windowId }
      : { url };
  }

  function panelPath(mode) {
    const parameters = new URLSearchParams({ [mode]: "1", tabId: String(activeTab.id) });
    return `popup/popup.html?${parameters}`;
  }

  async function openDockedPanel() {
    if (!activeTab?.id) {
      return false;
    }
    const path = panelPath("sidebar");
    if (extensionApi.sidebarAction) {
      const settingPanel = extensionApi.sidebarAction.setPanel({
        tabId: activeTab.id,
        panel: extensionApi.runtime.getURL(path),
      });
      const openingPanel = extensionApi.sidebarAction.open();
      await Promise.all([settingPanel, openingPanel]);
      return true;
    }
    if (extensionApi.sidePanel) {
      const settingPanel = extensionApi.sidePanel.setOptions({
        tabId: activeTab.id,
        path,
        enabled: true,
      });
      const openingPanel = extensionApi.sidePanel.open({ tabId: activeTab.id });
      await Promise.all([settingPanel, openingPanel]);
      return true;
    }
    return false;
  }

  async function closeDockedPanel() {
    if (extensionApi.sidebarAction) {
      await extensionApi.sidebarAction.close();
      return;
    }
    if (extensionApi.sidePanel?.close && activeTab?.id) {
      await extensionApi.sidePanel.close({ tabId: activeTab.id });
    } else if (extensionApi.sidePanel && activeTab?.id) {
      await extensionApi.sidePanel.setOptions({ tabId: activeTab.id, enabled: false });
    }
  }

  async function openPopoutWindow() {
    if (!activeTab?.id || !extensionApi.windows) {
      throw new Error("A persistent extension window is not available in this browser.");
    }
    const url = new URL(extensionApi.runtime.getURL("popup/popup.html"));
    url.searchParams.set("popout", "1");
    url.searchParams.set("tabId", String(activeTab.id));
    const browserWindows = await extensionApi.windows.getAll({
      populate: true,
      windowTypes: ["popup"],
    });
    const existing = browserWindows.find((browserWindow) =>
      browserWindow.tabs?.some((tab) => tab.url === url.href),
    );
    if (existing?.id !== undefined) {
      await extensionApi.windows.update(existing.id, { focused: true });
    } else {
      await extensionApi.windows.create({
        url: url.href,
        type: "popup",
        width: 400,
        height: 680,
        focused: true,
      });
    }
  }

  function candidateKey(candidate) {
    return `${candidate.frameId}:${candidate.instanceId}:${candidate.type}:${candidate.address}`;
  }

  function displayCandidateValue(value, multiplier = 1) {
    return typeof value === "number" ? value / multiplier : value;
  }

  function clearCandidateRefreshState() {
    candidateRecords.clear();
    candidateReadRequests.clear();
    pendingCandidateInstances.clear();
  }

  function updateCandidateValue(entry, rawValue) {
    const displayValue = displayCandidateValue(rawValue, entry.candidate.multiplier);
    entry.readError = null;
    entry.candidate.value = rawValue;
    entry.candidate.displayValue = displayValue;
    for (const valueCell of entry.valueCells || []) {
      valueCell.textContent = String(displayValue);
    }
  }

  function refreshCandidateValues() {
    const liveRecords = new Map();
    for (const [key, entry] of watchedCandidates) {
      liveRecords.set(key, entry);
    }
    for (const [key, entry] of candidateRecords) {
      if (!liveRecords.has(key) && liveRecords.size < MAX_LIVE_READS) {
        liveRecords.set(key, entry);
      }
    }
    if (
      !port ||
      liveRecords.size === 0 ||
      quickSession?.status === "scanning" ||
      document.visibilityState === "hidden"
    ) {
      return;
    }
    const groups = new Map();
    let unavailable = false;
    for (const [key, entry] of liveRecords) {
      const instanceKey = `${entry.candidate.frameId}:${entry.candidate.instanceId}`;
      if (!instances.has(instanceKey)) {
        markUnavailable(entry, "Game memory disconnected. Reconnect to read this address.");
        unavailable = true;
        continue;
      }
      if (!groups.has(instanceKey)) {
        groups.set(instanceKey, []);
      }
      groups.get(instanceKey).push({ key, entry });
    }
    if (unavailable) updateDiagnosticUI();
    for (const [instanceKey, entries] of groups) {
      if (pendingCandidateInstances.has(instanceKey)) {
        continue;
      }
      const first = entries[0]?.entry.candidate;
      if (!first) {
        continue;
      }
      const requestId = nextRequestId("candidate-values");
      pendingCandidateInstances.add(instanceKey);
      candidateReadRequests.set(requestId, instanceKey);
      const sent = send({
        kind: "readValues",
        requestId,
        instanceId: first.instanceId,
        entries: entries.map(({ key, entry }) => ({
          id: key,
          type: entry.candidate.type,
          address: entry.candidate.address,
        })),
      }, first.frameId);
      if (!sent) {
        pendingCandidateInstances.delete(instanceKey);
        candidateReadRequests.delete(requestId);
      }
    }
  }

  function selectedInstance() {
    const records = [...instances.values()];
    return instances.get(elements.advancedInstance.value) || records.find((record) => record.looksLikeRuffle) || records.find((record) => record.kind !== "javascript") || records[0] || null;
  }

  function sessionInstance() {
    if (!quickSession) {
      return null;
    }
    return instances.get(`${quickSession.frameId}:${quickSession.instanceId}`) || null;
  }

  function advancedSelectedInstance() {
    const key = elements.advancedInstance.value;
    return instances.get(key) || selectedInstance();
  }

  function send(payload, frameId = selectedInstance()?.frameId) {
    if (!port) {
      setQuickStatus("The extension connection is not ready.", "error");
      return false;
    }
    try {
      port.postMessage({ kind: "routeCommand", frameId, payload });
      return true;
    } catch {
      setQuickStatus("The extension connection was lost.", "error");
      return false;
    }
  }

  function sendWorkspace(action, options = {}) {
    if (!port) {
      return false;
    }
    try {
      port.postMessage({ kind: "workspaceCommand", action, ...options });
      return true;
    } catch {
      return false;
    }
  }

  function setQuickStatus(message, state = "") {
    elements.quickStatus.textContent = message;
    elements.quickStatus.className = `quick-status ${state}`.trim();
    elements.advancedStatus.textContent = message;
    elements.advancedStatus.className = `quick-status ${state}`.trim();
  }

  function updateViewVisibility() {
    const persistentSurface = isSidebarPanel || isPopoutWindow;
    elements.viewSwitcher.hidden = !persistentSurface || !memoryDetected;
    elements.quickTools.hidden = !memoryDetected || activeView !== "simple";
    elements.advancedTools.hidden = !memoryDetected || activeView !== "advanced";
    document.body.classList.toggle("advanced-active", activeView === "advanced");
    for (const button of elements.viewButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.view === activeView));
    }
  }

  function setActiveView(view) {
    activeView = view === "advanced" && (isSidebarPanel || isPopoutWindow)
      ? "advanced"
      : "simple";
    try {
      sessionStorage.setItem("hack-engine-view", activeView);
    } catch {
      // The view still works when session storage is unavailable.
    }
    updateViewVisibility();
  }

  function setActiveWorkspace(workspace) {
    activeWorkspace = workspace === "watches" ? "watches" : "candidates";
    for (const button of elements.workspaceButtons) {
      button.setAttribute("aria-selected", String(button.dataset.workspace === activeWorkspace));
    }
    elements.advancedCandidatePane.hidden = activeWorkspace !== "candidates";
    elements.advancedWatchPane.hidden = activeWorkspace !== "watches";
  }

  function renderSummary(summary) {
    const detected = summary.instanceCount > 0;
    memoryDetected = detected;
    elements.statusDot.className = `status-dot ${
      detected ? "" : summary.connected ? "searching" : "offline"
    }`;
    elements.connectionState.classList.toggle("offline", !summary.connected);
    updateViewVisibility();

    if (detected) {
      elements.statusTitle.textContent = "Game inspection available";
    } else if (summary.connected) {
      elements.statusTitle.textContent = "No source available — start or reload the game";
    } else {
      elements.statusTitle.textContent = /^(about:|chrome:|edge:)/.test(activeTab?.url || "")
        ? "This browser page cannot be inspected"
        : "No capture — reload the game or check site access";
    }
  }

  function updateConditionFields(conditionElement, valueElement, valueLabel, valueText, maxLabel) {
    const condition = conditionElement.value;
    const needsValue = ["exact", "range", "increasedBy", "decreasedBy"].includes(condition);
    const needsMaximum = condition === "range";
    valueElement.disabled = !needsValue;
    valueLabel.hidden = !needsValue;
    maxLabel.hidden = !needsMaximum;
    valueText.textContent = needsMaximum
      ? "Minimum"
      : ["increasedBy", "decreasedBy"].includes(condition)
        ? "Change amount"
        : "Value";
  }

  function updateConditionControls() {
    updateConditionFields(
      elements.condition,
      elements.value,
      elements.valueLabel,
      elements.valueText,
      elements.maxLabel,
    );
    updateConditionFields(
      elements.advancedCondition,
      elements.advancedValue,
      elements.advancedValueLabel,
      elements.advancedValueText,
      elements.advancedMaxLabel,
    );
  }

  function updateInstanceOptions() {
    const previous = elements.advancedInstance.value;
    const records = [...instances.values()];
    elements.advancedInstance.replaceChildren();
    for (const record of records) {
      const option = document.createElement("option");
      option.value = `${record.frameId}:${record.id}`;
      const mib = Number(record.memoryBytes) / (1024 * 1024);
      option.textContent = `${record.displayName || (record.looksLikeRuffle ? "Ruffle" : record.kind === "javascript" ? "JavaScript" : "WebAssembly")} · frame ${record.frameId}${record.kind === "javascript" ? "" : ` · ${mib.toFixed(1)} MiB`}`;
      elements.advancedInstance.append(option);
    }
    if ((sourceChosen || quickSession) && [...elements.advancedInstance.options].some((option) => option.value === previous)) {
      elements.advancedInstance.value = previous;
    } else {
      const preferred = records.find((record) => record.looksLikeRuffle) || records.find((record) => record.kind !== "javascript") || records[0];
      elements.advancedInstance.value = preferred ? `${preferred.frameId}:${preferred.id}` : "";
    }
    elements.advancedInstanceLabel.hidden = records.length <= 1;
    const simple = ui("quick-instance");
    simple.replaceChildren(...[...elements.advancedInstance.options].map((option) => new Option(option.textContent, option.value)));
    simple.value = elements.advancedInstance.value;
    ui("quick-instance-label").hidden = records.length <= 1;
  }

  function updateRuntimeGuidance() {
    const usesSession = quickSession?.canRefine || quickSession?.status === "scanning";
    const record = usesSession ? sessionInstance() : advancedSelectedInstance();
    const javascript = record?.kind === "javascript";
    elements.advancedType.closest("label").hidden = javascript;
    elements.advancedAlignment.closest("label").hidden = javascript;
    ui("javascript-root-controls").hidden = !javascript;
    ui("javascript-root").disabled = !!usesSession;
    ui("javascript-load-roots").disabled = !!usesSession;
    if (javascript) {
      elements.advancedAvmType.textContent = "JavaScript";
      elements.advancedRecommendedTypes.textContent = "Finite numbers";
      elements.advancedRuntimeHint.textContent = "Scans reachable objects, arrays and numeric typed arrays. Private or server-controlled state may be inaccessible. Choose an object below to narrow discovery.";
      return;
    }
    const avmKind = usesSession && quickSession?.results?.avmKind !== undefined
      ? quickSession.results.avmKind
      : record?.looksLikeRuffle ? record.avmKind : "unknown";
    elements.advancedRecommendedTypes.textContent = AVM_RECOMMENDED_TYPES[avmKind]
      ?.map((type) => TYPE_LABELS[type]).join(", ") || "All numeric types";
    if (avmKind === "avm1") {
      elements.advancedAvmType.textContent = "AVM1";
      elements.advancedRuntimeHint.textContent = "Automatic searches Float64 for this runtime.";
    } else if (avmKind === "avm2") {
      elements.advancedAvmType.textContent = "AVM2";
      elements.advancedRuntimeHint.textContent = "Start with Int32 or Uint32 for whole numbers, Float64 for decimals. Automatic narrows decimal searches to Float64.";
    } else {
      elements.advancedAvmType.textContent = "Unknown";
      elements.advancedRuntimeHint.textContent = "Automatic searches all numeric types in this WebAssembly memory.";
    }
  }

  function updateScanControls() {
    const canRefine = Boolean(quickSession?.canRefine);
    const scanning = quickSession?.status === "scanning";
    for (const option of elements.condition.querySelectorAll("[data-refine-only]")) {
      option.disabled = !canRefine;
    }
    elements.condition.querySelector('[value="unknown"]').disabled = canRefine;
    if (!canRefine && elements.condition.selectedOptions[0]?.disabled) {
      elements.condition.value = "exact";
    }
    if (canRefine && elements.condition.value === "unknown") {
      elements.condition.value = "changed";
    }
    elements.scan.textContent = canRefine ? "Next scan" : "First scan";
    elements.scan.disabled = !port || scanning || !selectedInstance();
    elements.cancel.hidden = !scanning;
    elements.reset.hidden = !quickSession;
    for (const option of elements.advancedCondition.querySelectorAll("[data-refine-only]")) {
      option.disabled = !canRefine;
    }
    elements.advancedCondition.querySelector('[value="unknown"]').disabled = canRefine;
    if (!canRefine && elements.advancedCondition.selectedOptions[0]?.disabled) {
      elements.advancedCondition.value = "exact";
    }
    if (canRefine && elements.advancedCondition.value === "unknown") {
      elements.advancedCondition.value = "changed";
    }
    elements.advancedScan.textContent = canRefine ? "Next scan" : "First scan";
    elements.advancedScan.disabled = !port || scanning || !(canRefine ? sessionInstance() : advancedSelectedInstance());
    elements.advancedCancel.hidden = !scanning;
    elements.advancedReset.hidden = !quickSession;
    elements.advancedType.disabled = canRefine || scanning;
    elements.advancedAlignment.disabled = canRefine || scanning;
    elements.advancedInstance.disabled = canRefine || scanning;
    ui("quick-instance").disabled = canRefine || scanning;
    elements.advancedSessionBadge.textContent = scanning
      ? "Scanning"
      : canRefine
        ? `${candidateTotal.toLocaleString()} candidates`
        : "New scan";
    elements.advancedSessionBadge.classList.toggle("active", scanning || canRefine);
    updateRuntimeGuidance();
    updateConditionControls();
    updateScanWatchdog();
  }

  function candidateValueText(candidate) {
    const value = candidate.displayValue ?? displayCandidateValue(candidate.value, candidate.multiplier);
    return value === undefined ? "—" : String(value);
  }

  function updateSelectionUI() {
    const selectedKey = selectedCandidate ? candidateKey(selectedCandidate) : "";
    for (const row of document.querySelectorAll("[data-candidate-key]")) {
      row.classList.toggle("selected", row.dataset.candidateKey === selectedKey);
    }
    updateDiagnosticUI();
    const hasSelection = Boolean(selectedCandidate);
    const liveSelection = !!port && !!selectedCandidate && instances.has(`${selectedCandidate.frameId}:${selectedCandidate.instanceId}`);
    for (const button of [elements.write, elements.advancedWrite, elements.freeze, elements.advancedFreeze]) button.disabled = !liveSelection;
    elements.editor.hidden = !hasSelection;
    elements.advancedEditor.hidden = !hasSelection;
    if (!selectedCandidate) {
      editorSelectionKey = "";
      return;
    }
    const address = candidateLocation(selectedCandidate);
    const value = candidateValueText(selectedCandidate);
    elements.selectedAddress.textContent = address;
    elements.advancedSelectedAddress.textContent = address;
    // Workspace/diagnostic updates must not replace a draft used by Write/Freeze.
    if (editorSelectionKey !== selectedKey) {
      elements.writeValue.value = value;
      elements.advancedWriteValue.value = value;
      editorSelectionKey = selectedKey;
    }
    const frozen = frozenCandidates.has(selectedKey);
    for (const button of [elements.freeze, elements.advancedFreeze]) {
      button.textContent = frozen ? "Unfreeze" : "Freeze";
      button.classList.toggle("freeze-active", frozen);
    }
  }

  function sharedWatch(candidate) {
    const instance = instances.get(`${candidate.frameId}:${candidate.instanceId}`);
    return {
      frameId: candidate.frameId,
      instanceId: String(candidate.instanceId),
      kind: candidate.kind || (candidate.type === "number" ? "javascript" : "wasm"),
      ...(candidate.path ? { path: candidate.path, displayPath: candidate.displayPath } : {}),
      type: candidate.type,
      multiplier: Number(candidate.multiplier) || 1,
      address: candidate.address,
      label: candidate.label || watchedCandidates.get(candidateKey(candidate))?.candidate.label || "",
      hint: instance?.hint || "",
      url: instance?.url || "",
    };
  }

  function addWatch(candidate, { broadcast = true } = {}) {
    const key = candidateKey(candidate);
    if (!watchedCandidates.has(key) && watchedCandidates.size >= MAX_SHARED_WATCHES) {
      setQuickStatus(`The shared watch list is limited to ${MAX_SHARED_WATCHES} values.`, "error");
      return;
    }
    const existing = watchedCandidates.get(key);
    watchedCandidates.set(key, existing || { candidate, valueCells: new Set() });
    renderWatches();
    if (broadcast) {
      sendWorkspace("upsertWatch", { watch: sharedWatch(candidate), select: true });
    }
  }

  function selectCandidate(candidate) {
    editorSelectionKey = "";
    selectedCandidate = candidate;
    addWatch(candidate);
    updateSelectionUI();
  }

  function applySharedWorkspace(workspace) {
    diagnostics = workspace?.diagnostics || {};
    const incoming = new Map();
    for (const watch of Array.isArray(workspace?.watches) ? workspace.watches : []) {
      const key = candidateKey(watch);
      const existing = watchedCandidates.get(key);
      const candidateEntry = candidateRecords.get(key);
      const candidate = existing?.candidate || candidateEntry?.candidate || {
        ...watch,
        displayValue: undefined,
        value: undefined,
      };
      candidate.multiplier = Number(watch.multiplier) || 1;
      candidate.label = watch.label || "";
      incoming.set(key, existing || { candidate, valueCells: new Set() });
    }
    watchedCandidates.clear();
    for (const [key, entry] of incoming) {
      watchedCandidates.set(key, entry);
    }
    frozenCandidates.clear();
    for (const key of Array.isArray(workspace?.frozenKeys) ? workspace.frozenKeys : []) {
      frozenCandidates.add(key);
    }
    const selectedKey = typeof workspace?.selectedKey === "string" ? workspace.selectedKey : null;
    const selected = candidateRecords.get(selectedKey)?.candidate || watchedCandidates.get(selectedKey)?.candidate;
    if (selected) {
      selectedCandidate = selected;
    } else {
      selectedCandidate = null;
    }
    renderWatches();
    updateSelectionUI();
    refreshCandidateValues();
  }

  function makeValueCell(entry) {
    const value = document.createElement("span");
    value.className = "candidate-value";
    value.textContent = candidateValueText(entry.candidate);
    entry.valueCells.add(value);
    return value;
  }

  function candidateTypePriority(candidate) {
    const instance = instances.get(`${candidate.frameId}:${candidate.instanceId}`);
    const belongsToSession = candidate.frameId === quickSession?.frameId &&
      candidate.instanceId === String(quickSession?.instanceId);
    const avmKind = belongsToSession && quickSession?.results?.avmKind !== undefined
      ? quickSession.results.avmKind
      : instance?.looksLikeRuffle ? instance.avmKind : "unknown";
    const types = AVM_RECOMMENDED_TYPES[avmKind] || [];
    const index = types.indexOf(candidate.type);
    return index < 0 ? types.length : index;
  }

  function compareRecommendedCandidates([, left], [, right]) {
    return candidateTypePriority(left.candidate) - candidateTypePriority(right.candidate) ||
      left.candidate.address - right.candidate.address;
  }

  function renderSimpleCandidates() {
    elements.candidates.replaceChildren();
    for (const [key, entry] of [...candidateRecords].sort(compareRecommendedCandidates).slice(0, 20)) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "quick-candidate";
      row.dataset.candidateKey = key;
      const address = document.createElement("span");
      address.className = "candidate-address";
      address.textContent = candidateLocation(entry.candidate);
      row.append(address, makeValueCell(entry));
      row.addEventListener("click", () => selectCandidate(entry.candidate));
      elements.candidates.append(row);
    }
  }

  function renderAdvancedCandidates() {
    elements.advancedCandidates.replaceChildren();
    const filter = elements.advancedFilter.value.trim().toLowerCase();
    const records = [...candidateRecords.entries()].filter(([, entry]) => {
      const candidate = entry.candidate;
      return !filter || `${candidateLocation(candidate)} ${candidateValueText(candidate)} ${candidate.type}`.toLowerCase().includes(filter);
    });
    const sort = elements.advancedSort.value;
    records.sort((leftEntry, rightEntry) => {
      if (sort === "recommended") {
        return compareRecommendedCandidates(leftEntry, rightEntry);
      }
      const [, left] = leftEntry;
      const [, right] = rightEntry;
      if (sort === "value" || sort === "valueDesc") {
        return (Number(left.candidate.displayValue) - Number(right.candidate.displayValue)) * (sort === "valueDesc" ? -1 : 1);
      }
      if (sort === "type") {
        return String(left.candidate.type).localeCompare(String(right.candidate.type)) || left.candidate.address - right.candidate.address;
      }
      const order = left.candidate.type === "number" && right.candidate.type === "number"
        ? candidateLocation(left.candidate).localeCompare(candidateLocation(right.candidate))
        : left.candidate.address - right.candidate.address;
      return order * (sort === "addressDesc" ? -1 : 1);
    });
    ui("advanced-preview-count").textContent = `${records.length} visible · ${candidateRecords.size} previewed · ${candidateTotal.toLocaleString()} total matches`;
    for (const [key, entry] of records) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "advanced-candidate";
      row.dataset.candidateKey = key;
      const address = document.createElement("span");
      address.className = "candidate-address";
      address.textContent = candidateLocation(entry.candidate);
      const type = document.createElement("span");
      type.className = "candidate-type";
      type.textContent = entry.candidate.type;
      row.append(address, makeValueCell(entry), type);
      row.addEventListener("click", () => selectCandidate(entry.candidate));
      elements.advancedCandidates.append(row);
    }
    updateSelectionUI();
  }

  function renderCandidateLists() {
    for (const entry of candidateRecords.values()) {
      entry.valueCells.clear();
    }
    renderSimpleCandidates();
    renderAdvancedCandidates();
  }

  function renderWatches() {
    const focused = document.activeElement;
    const draft = elements.advancedWatches.contains(focused) && focused.dataset.metadataField
      ? { key: focused.dataset.metadataKey, field: focused.dataset.metadataField,
        value: focused.value, start: focused.selectionStart, end: focused.selectionEnd } : null;
    const expanded = new Set([...elements.advancedWatches.querySelectorAll("details[open]")].map((node) => node.dataset.watchKey));
    let restoredInput = null;
    elements.advancedWatches.replaceChildren();
    for (const [key, entry] of watchedCandidates) {
      entry.valueCells.clear();
      const row = document.createElement("div");
      row.className = "watch-row";
      const select = document.createElement("button");
      select.type = "button";
      select.className = "watch-select";
      select.dataset.candidateKey = key;
      const address = document.createElement("span");
      address.className = "candidate-address";
      address.textContent = candidateLocation(entry.candidate);
      const type = document.createElement("span");
      type.className = "candidate-type";
      type.textContent = entry.candidate.type;
      select.append(address, makeValueCell(entry), type);
      select.addEventListener("click", () => selectCandidate(entry.candidate));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "watch-remove";
      remove.setAttribute("aria-label", `Remove watch at ${candidateLocation(entry.candidate)}`);
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        if (frozenCandidates.has(key)) {
          setQuickStatus("Unfreeze this value before removing its watch.", "error");
          return;
        }
        watchedCandidates.delete(key);
        renderWatches();
        sendWorkspace("removeWatch", { key });
      });
      row.append(select, remove);
      const state = document.createElement("details"); state.className = "watch-diagnostic";
      state.dataset.watchKey = key;
      state.open = expanded.has(key);
      const summary = document.createElement("summary"); summary.className = "watch-state";
      const detail = document.createElement("p"); detail.className = "watch-detail";
      state.append(summary, detail); row.append(state);
      const metadata = document.createElement("div");
      metadata.className = "watch-metadata";
      for (const field of ["label"]) {
        const input = document.createElement("input");
        input.type = "text"; input.maxLength = 80;
        input.dataset.metadataKey = key; input.dataset.metadataField = field;
        input.value = entry.candidate[field] || "";
        if (draft?.key === key && draft.field === field) {
          input.value = draft.value;
          restoredInput = input;
        }
        input.placeholder = "Watch label";
        input.setAttribute("aria-label", `${input.placeholder} for ${candidateLocation(entry.candidate)}`);
        input.addEventListener("change", () => {
          entry.candidate[field] = input.value;
          sendWorkspace("upsertWatch", { watch: entry.candidate });
        });
        metadata.append(input);
      }
      row.append(metadata);
      elements.advancedWatches.append(row);
    }
    if (restoredInput) {
      restoredInput.focus({ preventScroll: true });
      restoredInput.setSelectionRange(draft.start, draft.end);
    }
    elements.advancedWatchCount.textContent = String(watchedCandidates.size);
    elements.advancedWatchEmpty.hidden = watchedCandidates.size > 0;
    elements.advancedWorkspace.hidden = false;
    updateSelectionUI();
  }

  function renderResults(payload, frameId = quickSession?.frameId) {
    const resultIdentity = `${frameId}:${payload.instanceId}:${payload.requestId}`;
    const retainedSelection = renderedResult === resultIdentity ? selectedCandidate : null;
    renderedResult = resultIdentity;
    const preview = Array.isArray(payload?.preview)
      ? payload.preview.slice(0, MAX_ADVANCED_CANDIDATES)
      : [];
    candidateTotal = Number(payload?.total || 0);
    hasScanResults = true;
    elements.results.hidden = false;
    elements.resultCount.textContent = candidateTotal.toLocaleString();
    elements.advancedResultCount.textContent = candidateTotal.toLocaleString();
    clearCandidateRefreshState();
    selectedCandidate = null;

    for (const candidate of preview) {
      const record = {
        ...candidate,
        frameId,
        instanceId: String(payload.instanceId),
        multiplier: Number(candidate.multiplier ?? payload.multiplier) || 1,
      };
      candidateRecords.set(candidateKey(record), { candidate: record, valueCells: new Set() });
    }
    if (retainedSelection) {
      const key = candidateKey(retainedSelection);
      selectedCandidate = candidateRecords.get(key)?.candidate || watchedCandidates.get(key)?.candidate || null;
    }
    renderCandidateLists();
    renderWatches();

    const searchedTypes = Array.isArray(payload?.searchedTypes) ? payload.searchedTypes : [];
    elements.broaden.hidden = sessionInstance()?.kind === "javascript" || !(
      quickSession?.request?.refine === false &&
      ["exact", "range"].includes(quickSession?.request?.condition) &&
      searchedTypes.length > 0 &&
      searchedTypes.length < 8
    );

    if (payload?.allCandidates) {
      setQuickStatus("Baseline captured. Change the game value, choose a comparison, then run Next scan.", "ready");
    } else if (Number(payload?.total) === 0) {
      setQuickStatus(payload.coverage?.numbers === 0 || payload.noAccessibleState ? "No accessible numeric state found. Choose another object or source and scan again." : "No matching values. Undo the last scan, widen the range, or reset.", "error");
    } else {
      setQuickStatus(
        `${candidateTotal.toLocaleString()} candidates remain; showing ${preview.length}.`,
        "ready",
      );
    }
    if (payload.coverage?.partial || payload.partial || payload.coverage?.complete === false) {
      setQuickStatus(`${elements.quickStatus.textContent} Discovery was incomplete; choose a narrower object and scan again.`, "ready");
    }
    updateScanControls();
    refreshCandidateValues();
  }

  function applyQuickSession(session) {
    quickSession = session || null;
    updateScanWatchdog();
    if (session?.request) {
      elements.condition.value = session.request.condition || "exact";
      elements.value.value = session.request.rawValue ?? elements.value.value;
      elements.maxValue.value = session.request.rawMaxValue ?? elements.maxValue.value;
      elements.advancedCondition.value = session.request.condition || "exact";
      elements.advancedValue.value = session.request.rawValue ?? elements.advancedValue.value;
      elements.advancedMaxValue.value = session.request.rawMaxValue ?? elements.advancedMaxValue.value;
      elements.advancedType.value = session.request.type || "smart";
      elements.advancedAlignment.value = session.request.alignment || "aligned";
    }
    if (session?.status === "scanning") {
      const progress = session.progress;
      setQuickStatus(
        stalledRequest === session.requestId
          ? "No recent progress. The scan may still be running; Cancel remains available."
          : progress?.total
          ? `Scanning… ${Number(progress.inspected).toLocaleString()} / ${Number(progress.total).toLocaleString()}`
          : "Scanning values…",
      );
    } else if (session?.status === "error" || session?.status === "disconnected") {
      setQuickStatus(session.error || "The scan could not continue.", "error");
    } else if (session?.status === "cancelled") {
      setQuickStatus("Scan cancelled.");
    } else if (session?.results) {
      renderResults(session.results, session.frameId);
    } else if (!session) {
      renderedResult = null;
      clearCandidateRefreshState();
      hasScanResults = false;
      candidateTotal = 0;
      selectedCandidate = null;
      elements.results.hidden = true;
      elements.candidates.replaceChildren();
      elements.advancedCandidates.replaceChildren();
      elements.advancedResultCount.textContent = "0";
      renderWatches();
      setQuickStatus("Ready to scan this source.");
    }
    updateScanControls();
  }

  function addInstances(frameId, url, list) {
    for (const instance of Array.isArray(list) ? list : []) {
      instances.set(`${frameId}:${instance.id}`, { ...instance, frameId, url });
    }
    updateInstanceOptions();
    updateScanControls();
    if (candidateRecords.size) renderCandidateLists();
  }

  function handlePagePayload(message, payload) {
    if (payload?.kind === "javaScriptRoots" && rootsRequest?.requestId === payload.requestId && rootsRequest.frameId === message.frameId) {
      const picker = ui("javascript-root");
      picker.replaceChildren(new Option("Automatic discovery", ""));
      for (const root of payload.roots || []) {
        if (Array.isArray(root.path)) picker.append(new Option(root.displayPath || root.path.join("."), JSON.stringify(root.path)));
      }
      rootsRequest = null;
      setQuickStatus(`${payload.roots?.length || 0} accessible objects available. Select one or use automatic discovery.`);
      return;
    }
    if (payload?.kind === "instanceCaptured") {
      addInstances(message.frameId, message.url, [payload.instance]);
      return;
    }
    if (payload?.kind === "instanceList") {
      for (const [key, record] of instances) {
        if (record.frameId === message.frameId) instances.delete(key);
      }
      addInstances(message.frameId, message.url, payload.instances);
      return;
    }
    if (!String(payload?.requestId || "").startsWith("quick:")) {
      return;
    }
    if (payload.kind === "watchValues" && candidateReadRequests.has(payload.requestId)) {
      const instanceKey = candidateReadRequests.get(payload.requestId);
      candidateReadRequests.delete(payload.requestId);
      pendingCandidateInstances.delete(instanceKey);
      for (const value of Array.isArray(payload.values) ? payload.values : []) {
        if (value.error) {
          for (const entry of [candidateRecords.get(value.id), watchedCandidates.get(value.id)]) if (entry) markUnavailable(entry, value.error);
        } else {
          const candidateEntry = candidateRecords.get(value.id);
          const watchEntry = watchedCandidates.get(value.id);
          if (candidateEntry) {
            updateCandidateValue(candidateEntry, value.value);
          }
          if (watchEntry && watchEntry !== candidateEntry) {
            updateCandidateValue(watchEntry, value.value);
          }
        }
      }
      updateDiagnosticUI();
    } else if (payload.kind === "scanProgress") {
      if (quickSession) {
        quickSession.status = "scanning";
        quickSession.progress = payload;
      }
      updateScanWatchdog();
      setQuickStatus(
        `Scanning… ${Number(payload.inspected).toLocaleString()} / ${Number(payload.total).toLocaleString()}`,
      );
    } else if (payload.kind === "scanResults") {
      quickSession = {
        ...(quickSession || {}),
        status: "complete",
        canRefine: true,
        frameId: message.frameId,
        instanceId: String(payload.instanceId),
        results: payload,
        progress: null,
      };
      renderResults(payload, message.frameId);
      updateScanControls();
    } else if (payload.kind === "scanCancelled") {
      if (quickSession?.requestId !== payload.requestId) {
        setQuickStatus("Scan cancelled; the previous completed results are available.", "ready");
        return;
      }
      if (quickSession) {
        quickSession.status = "cancelled";
      }
      setQuickStatus("Scan cancelled.");
      updateScanControls();
    } else if (payload.kind === "writeComplete" || payload.kind === "writeVerified") {
      const diagnostic = diagnostics[candidateKey({ frameId: message.frameId, instanceId: String(payload.instanceId), type: payload.type, address: payload.address })];
      if (diagnostic && diagnostic.requestId !== payload.requestId) return;
      const entry = candidateRecords.get(candidateKey({
        frameId: message.frameId,
        instanceId: String(payload.instanceId),
        type: payload.type,
        address: payload.address,
      }));
      const refreshedValue = payload.value ?? payload.actualValue;
      if (entry && refreshedValue !== undefined) {
        updateCandidateValue(entry, refreshedValue);
      }
      const watchedEntry = watchedCandidates.get(candidateKey({
        frameId: message.frameId,
        instanceId: String(payload.instanceId),
        type: payload.type,
        address: payload.address,
      }));
      if (watchedEntry && refreshedValue !== undefined && watchedEntry !== entry) {
        updateCandidateValue(watchedEntry, refreshedValue);
      }
      updateDiagnosticUI();
    } else if (payload.kind === "freezeChanged") {
      const record = {
        frameId: message.frameId,
        instanceId: String(payload.instanceId),
        type: payload.type,
        address: payload.address,
      };
      if (payload.enabled) {
        frozenCandidates.add(candidateKey(record));
      } else {
        frozenCandidates.delete(candidateKey(record));
      }
      if (selectedCandidate && candidateKey(selectedCandidate) === candidateKey(record)) {
        updateSelectionUI();
      }
      setQuickStatus(payload.enabled ? "Value frozen." : "Value unfrozen.", "ready");
    } else if (payload.kind === "error") {
      if (candidateReadRequests.has(payload.requestId)) {
        const instanceKey = candidateReadRequests.get(payload.requestId);
        candidateReadRequests.delete(payload.requestId);
        pendingCandidateInstances.delete(instanceKey);
        for (const entry of [...candidateRecords.values(), ...watchedCandidates.values()]) {
          if (`${entry.candidate.frameId}:${entry.candidate.instanceId}` === instanceKey) markUnavailable(entry, payload.message);
        }
        updateDiagnosticUI();
        return;
      }
      if (quickSession?.requestId === payload.requestId) {
        quickSession.status = "error";
      }
      setQuickStatus(payload.message || "The operation failed.", "error");
      updateScanControls();
    }
  }

  function handlePortMessage(message) {
    if (message?.kind === "quickSession") {
      applyQuickSession(message.session);
    } else if (message?.kind === "workspaceState") {
      applySharedWorkspace(message.workspace);
    } else if (message?.kind === "frameConnected") {
      send({ kind: "listInstances", requestId: nextRequestId("instances") }, message.frameId);
    } else if (message?.kind === "frameDisconnected") {
      for (const entry of [...candidateRecords.values(), ...watchedCandidates.values()]) {
        if (entry.candidate.frameId === message.frameId) markUnavailable(entry, "Game memory disconnected. Reconnect to read this address.");
      }
      for (const [key, record] of instances) {
        if (record.frameId === message.frameId) {
          instances.delete(key);
        }
      }
      candidateReadRequests.clear();
      pendingCandidateInstances.clear();
      updateInstanceOptions();
      updateScanControls();
      updateSelectionUI();
    } else if (message?.kind === "pageMessage") {
      handlePagePayload(message, message.payload);
    }
  }

  async function refreshSummary() {
    if (!activeTab?.id) {
      return;
    }
    try {
      const summary = await extensionApi.runtime.sendMessage({
        kind: "getTabSummary",
        tabId: activeTab.id,
      });
      renderSummary(summary || {
        connected: false,
        instanceCount: 0,
        ruffleCount: 0,
        totalMemoryBytes: 0,
      });
    } catch {
      renderSummary({ connected: false, instanceCount: 0, ruffleCount: 0, totalMemoryBytes: 0 });
    }
  }

  function connectPopup() {
    if (closing) return;
    clearTimeout(reconnectTimer);
    try {
      const nextPort = extensionApi.runtime.connect({ name: `hack-popup:${activeTab.id}` });
      port = nextPort;
      nextPort.onMessage.addListener(handlePortMessage);
      nextPort.onDisconnect.addListener(() => {
        if (port !== nextPort) return;
        port = null;
        clearTimeout(scanWatchdog);
        for (const entry of [...candidateRecords.values(), ...watchedCandidates.values()]) markUnavailable(entry, "Connection lost.");
        setQuickStatus("Reconnecting to this game…", "error");
        updateScanControls();
        reconnectTimer = setTimeout(connectPopup, 750);
      });
      send({ kind: "listInstances", requestId: nextRequestId("instances") });
      extensionApi.runtime.sendMessage({ kind: "getQuickSession", tabId: activeTab.id }).then(applyQuickSession).catch(() => {});
    } catch { reconnectTimer = setTimeout(connectPopup, 1000); }
  }

  async function initialize() {
    const tab = hasBoundTab
      ? await extensionApi.tabs.get(boundTabId)
      : (await extensionApi.tabs.query({ active: true, currentWindow: true }))[0];
    activeTab = tab || null;
    elements.pin.disabled = !activeTab?.id;
    if (activeTab?.id) connectPopup();
    await refreshSummary();
    pollTimer = setInterval(refreshSummary, 1000);
    candidateRefreshTimer = setInterval(refreshCandidateValues, CANDIDATE_REFRESH_MS);
  }

  elements.condition.addEventListener("change", updateConditionControls);
  elements.advancedCondition.addEventListener("change", updateConditionControls);
  function sourceChanged() {
    sourceChosen = true;
    ui("quick-instance").value = elements.advancedInstance.value;
    ui("javascript-root").replaceChildren(new Option("Automatic discovery", ""));
    rootsRequest = null;
    updateRuntimeGuidance();
  }
  elements.advancedInstance.addEventListener("change", sourceChanged);
  ui("quick-instance").addEventListener("change", () => {
    elements.advancedInstance.value = ui("quick-instance").value;
    sourceChanged();
  });
  ui("javascript-load-roots").addEventListener("click", () => {
    const record = advancedSelectedInstance();
    if (!record || record.kind !== "javascript") return;
    const requestId = nextRequestId("roots");
    rootsRequest = { requestId, frameId: record.frameId };
    send({ kind: "listJavaScriptRoots", requestId, instanceId: record.id }, record.frameId);
    setQuickStatus("Looking for accessible objects…");
  });
  for (const button of elements.viewButtons) {
    button.addEventListener("click", () => setActiveView(button.dataset.view));
  }
  for (const button of elements.workspaceButtons) {
    button.addEventListener("click", () => setActiveWorkspace(button.dataset.workspace));
  }
  elements.advancedFilter.addEventListener("input", renderCandidateLists);
  elements.advancedSort.addEventListener("change", renderCandidateLists);

  elements.pin.addEventListener("click", async () => {
    try {
      if (isSidebarPanel) {
        await closeDockedPanel();
        return;
      }
      const docked = await openDockedPanel();
      if (!docked) {
        await openPopoutWindow();
      }
      window.close();
    } catch {
      setQuickStatus("Hack Engine could not open its docked panel.", "error");
    }
  });

  elements.popOut.addEventListener("click", async () => {
    try {
      const openingWindow = openPopoutWindow();
      if (isSidebarPanel) {
        const closingPanel = closeDockedPanel();
        await Promise.all([openingWindow, closingPanel]);
      } else {
        await openingWindow;
      }
      if (!isSidebarPanel && !isPopoutWindow) {
        window.close();
      }
    } catch (error) {
      setQuickStatus(error?.message || "Hack Engine could not open the utility window.", "error");
    }
  });

  function startScan({ condition, rawValue, rawMaxValue, multiplier, alignment, type, advanced }) {
    const refine = Boolean(quickSession?.canRefine);
    const record = refine ? sessionInstance() : advanced ? advancedSelectedInstance() : selectedInstance();
    if (!record) {
      setQuickStatus(
        refine ? "The memory used by this scan is no longer available. Reset and scan again." : "No inspection source is available.",
        "error",
      );
      return false;
    }
    if (record.kind === "javascript") { multiplier = 1; type = "smart"; alignment = "aligned"; }
    const needsValue = ["exact", "range", "increasedBy", "decreasedBy"].includes(condition);
    if (needsValue && rawValue.trim() === "") {
      setQuickStatus("Enter a value to scan for.", "error");
      return false;
    }
    if (condition === "range" && rawMaxValue.trim() === "") {
      setQuickStatus("Enter the maximum value.", "error");
      return false;
    }
    if (condition === "range" && Number(rawValue) > Number(rawMaxValue)) {
      setQuickStatus("The minimum cannot be greater than the maximum.", "error");
      return false;
    }
    if (!Number.isFinite(Number(multiplier)) || Number(multiplier) <= 0) {
      setQuickStatus("The stored-value multiplier must be greater than zero.", "error");
      return false;
    }
    const requestId = nextRequestId("scan");
    const previous = quickSession?.request;
    const request = {
      condition,
      rawValue,
      rawMaxValue,
      multiplier: refine ? previous?.multiplier ?? 1 : Number(multiplier),
      alignment: refine ? previous?.alignment || "aligned" : alignment,
      type: refine ? previous?.type || "smart" : type,
      refine,
      ...(record.kind === "javascript" ? { rootPath: refine ? previous?.rootPath : advanced && ui("javascript-root").value ? JSON.parse(ui("javascript-root").value) : undefined } : {}),
    };
    quickSession = {
      requestId,
      frameId: record.frameId,
      instanceId: String(record.id),
      status: "scanning",
      canRefine: refine,
      request,
      results: null,
    };
    if (send({
      kind: "memoryScan",
      requestId,
      instanceId: record.id,
      ...request,
    }, record.frameId)) {
      setQuickStatus(condition === "unknown" ? "Capturing the initial snapshot…" : "Scanning values…");
      updateScanControls();
      return true;
    }
    return false;
  }

  elements.scan.addEventListener("click", () => {
    startScan({
      condition: elements.condition.value,
      rawValue: elements.value.value,
      rawMaxValue: elements.maxValue.value,
      multiplier: 1,
      alignment: "aligned",
      type: "smart",
      advanced: false,
    });
  });

  elements.advancedScan.addEventListener("click", () => {
    startScan({
      condition: elements.advancedCondition.value,
      rawValue: elements.advancedValue.value,
      rawMaxValue: elements.advancedMaxValue.value,
      multiplier: 1,
      alignment: elements.advancedAlignment.value,
      type: elements.advancedType.value,
      advanced: true,
    });
  });

  function cancelScan() {
    if (!quickSession?.requestId) {
      return;
    }
    send({
      kind: "cancelScan",
      requestId: nextRequestId("cancel"),
      targetRequestId: quickSession.requestId,
    }, quickSession.frameId);
  }
  elements.cancel.addEventListener("click", cancelScan);
  elements.advancedCancel.addEventListener("click", cancelScan);

  function resetScan() {
    renderedResult = null;
    const record = sessionInstance() || selectedInstance();
    if (!record) {
      return;
    }
    send({
      kind: "resetScan",
      requestId: nextRequestId("reset"),
      instanceId: record.id,
      type: quickSession?.request?.type || "smart",
    }, record.frameId);
    applyQuickSession(null);
  }
  elements.reset.addEventListener("click", resetScan);
  elements.advancedReset.addEventListener("click", resetScan);

  elements.broaden.addEventListener("click", () => {
    const record = sessionInstance();
    const previousRequest = quickSession?.request;
    if (!record || !previousRequest || previousRequest.refine) {
      return;
    }
    const requestId = nextRequestId("broaden");
    const request = { ...previousRequest, type: "auto", refine: false };
    quickSession = {
      requestId,
      frameId: record.frameId,
      instanceId: String(record.id),
      status: "scanning",
      canRefine: false,
      request,
      results: null,
    };
    if (send({
      kind: "memoryScan",
      requestId,
      instanceId: record.id,
      ...request,
    }, record.frameId)) {
      setQuickStatus("Broadening the scan to every number format…");
      updateScanControls();
    }
  });

  function writeSelected(input) {
    if (!selectedCandidate || input.value.trim() === "") {
      setQuickStatus("Select a candidate and enter its new value.", "error");
      return;
    }
    const rawValue = input.value;
    elements.writeValue.value = rawValue;
    elements.advancedWriteValue.value = rawValue;
    send({
      kind: "writeValue",
      requestId: nextRequestId("write"),
      instanceId: selectedCandidate.instanceId,
      type: selectedCandidate.type,
      address: selectedCandidate.address,
      rawValue,
      multiplier: selectedCandidate.multiplier,
    }, selectedCandidate.frameId);
    setQuickStatus("Writing and checking the value…");
  }

  function setSelectedLimit(input, bound) {
    if (!selectedCandidate) {
      setQuickStatus("Select a candidate before choosing a numeric limit.", "error");
      return;
    }
    const limits = NUMERIC_LIMITS[selectedCandidate.type];
    if (!limits) {
      setQuickStatus(`Numeric limits are unavailable for ${selectedCandidate.type}.`, "error");
      return;
    }
    input.value = limits[bound === "max" ? 1 : 0];
    setQuickStatus(
      `${bound === "max" ? "Maximum" : "Minimum"} ${selectedCandidate.type} value prepared.`,
      "ready",
    );
  }

  elements.quickSetMin.addEventListener("click", () => setSelectedLimit(elements.writeValue, "min"));
  elements.quickSetMax.addEventListener("click", () => setSelectedLimit(elements.writeValue, "max"));
  elements.advancedSetMin.addEventListener("click", () => setSelectedLimit(elements.advancedWriteValue, "min"));
  elements.advancedSetMax.addEventListener("click", () => setSelectedLimit(elements.advancedWriteValue, "max"));
  elements.write.addEventListener("click", () => writeSelected(elements.writeValue));
  elements.advancedWrite.addEventListener("click", () => writeSelected(elements.advancedWriteValue));

  function toggleFreeze(input) {
    if (!selectedCandidate) {
      return;
    }
    const key = candidateKey(selectedCandidate);
    const enabled = !frozenCandidates.has(key);
    send({
      kind: "setFreeze",
      requestId: nextRequestId("freeze"),
      instanceId: selectedCandidate.instanceId,
      type: selectedCandidate.type,
      address: selectedCandidate.address,
      rawValue: input.value || selectedCandidate.displayValue,
      multiplier: selectedCandidate.multiplier,
      enabled,
    }, selectedCandidate.frameId);
  }
  elements.freeze.addEventListener("click", () => toggleFreeze(elements.writeValue));
  elements.advancedFreeze.addEventListener("click", () => toggleFreeze(elements.advancedWriteValue));

  elements.howItWorks.addEventListener("click", async () => {
    await extensionApi.tabs.create(newTabOptions(
      "https://abduljawada.github.io/hack-engine/#capabilities",
    ));
    if (!isSidebarPanel && !isPopoutWindow) {
      window.close();
    }
  });

  window.addEventListener("unload", () => {
    clearTimeout(scanWatchdog);
    clearInterval(pollTimer);
    clearInterval(candidateRefreshTimer);
    closing = true;
    clearTimeout(reconnectTimer);
    port?.disconnect?.();
  });

  installAdvancedControls();
  updateConditionControls();
  updateInstanceOptions();
  setActiveWorkspace("candidates");
  if (isSidebarPanel || isPopoutWindow) {
    try {
      activeView = sessionStorage.getItem("hack-engine-view") === "advanced" ? "advanced" : "simple";
    } catch {
      activeView = "simple";
    }
  }
  updateViewVisibility();
  updateScanControls();
  if (isSidebarPanel) {
    document.body.classList.add("sidebar-panel");
    elements.pin.classList.add("active");
    elements.pin.setAttribute("aria-label", "Close Hack Engine sidebar");
    elements.pin.title = "Close sidebar";
  } else if (isPopoutWindow) {
    document.body.classList.add("popout-window");
    elements.pin.setAttribute("aria-label", "Dock Hack Engine in the sidebar");
    elements.pin.title = "Dock in sidebar";
    elements.popOut.hidden = true;
  }
  initialize().catch(() => {
    elements.pin.disabled = true;
    renderSummary({ connected: false, instanceCount: 0, ruffleCount: 0, totalMemoryBytes: 0 });
  });
})();
