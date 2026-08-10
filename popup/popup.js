(() => {
  "use strict";

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const CANDIDATE_REFRESH_MS = 250;
  const MAX_ADVANCED_CANDIDATES = 200;
  const MAX_SIDEBAR_WATCHES = 56;
  const popupParameters = new URLSearchParams(location.search);
  const boundTabId = Number(popupParameters.get("tabId"));
  const isSidebarPanel = popupParameters.get("sidebar") === "1";
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
    write: document.querySelector("#quick-write"),
    freeze: document.querySelector("#quick-freeze"),
    advancedTools: document.querySelector("#advanced-tools"),
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
    advancedMultiplier: document.querySelector("#advanced-multiplier"),
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
    advancedWrite: document.querySelector("#advanced-write"),
    advancedFreeze: document.querySelector("#advanced-freeze"),
    openInspector: document.querySelector("#open-inspector"),
    popOut: document.querySelector("#pop-out-window"),
    refreshConnection: document.querySelector("#refresh-connection"),
    howItWorks: document.querySelector("#how-it-works"),
  };

  function nextRequestId(action = "scan") {
    return `quick:${action}:${Date.now()}:${requestSequence++}`;
  }

  function formatAddress(address) {
    return `0x${Number(address).toString(16).padStart(8, "0")}`;
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
    entry.candidate.value = rawValue;
    entry.candidate.displayValue = displayValue;
    for (const valueCell of entry.valueCells || []) {
      valueCell.textContent = String(displayValue);
    }
  }

  function refreshCandidateValues() {
    const liveRecords = new Map(watchedCandidates);
    for (const [key, entry] of candidateRecords) {
      liveRecords.set(key, entry);
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
    for (const [key, entry] of liveRecords) {
      const instanceKey = `${entry.candidate.frameId}:${entry.candidate.instanceId}`;
      if (!groups.has(instanceKey)) {
        groups.set(instanceKey, []);
      }
      groups.get(instanceKey).push({ key, entry });
    }
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
    return records.find((record) => record.looksLikeRuffle) || records[0] || null;
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
    elements.openInspector.disabled = !activeTab?.id;
    updateViewVisibility();

    if (detected) {
      elements.statusTitle.textContent = summary.ruffleCount > 0
        ? "Ruffle memory detected"
        : "WebAssembly memory detected";
    } else if (summary.connected) {
      elements.statusTitle.textContent = "Connected to this tab";
    } else {
      elements.statusTitle.textContent = "No connection yet";
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
      option.textContent = `${record.looksLikeRuffle ? "Ruffle" : "WASM"} · ${Number.isFinite(mib) ? `${mib.toFixed(1)} MiB` : record.id}`;
      elements.advancedInstance.append(option);
    }
    if ([...elements.advancedInstance.options].some((option) => option.value === previous)) {
      elements.advancedInstance.value = previous;
    } else {
      const preferred = selectedInstance();
      elements.advancedInstance.value = preferred ? `${preferred.frameId}:${preferred.id}` : "";
    }
    elements.advancedInstanceLabel.hidden = records.length <= 1;
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
    elements.scan.disabled = scanning || !selectedInstance();
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
    elements.advancedScan.disabled = scanning || !(canRefine ? sessionInstance() : advancedSelectedInstance());
    elements.advancedCancel.hidden = !scanning;
    elements.advancedReset.hidden = !quickSession;
    elements.advancedType.disabled = canRefine || scanning;
    elements.advancedAlignment.disabled = canRefine || scanning;
    elements.advancedInstance.disabled = canRefine || scanning;
    elements.advancedMultiplier.disabled = canRefine || scanning;
    elements.advancedSessionBadge.textContent = scanning
      ? "Scanning"
      : canRefine
        ? `${candidateTotal.toLocaleString()} candidates`
        : "New scan";
    elements.advancedSessionBadge.classList.toggle("active", scanning || canRefine);
    updateConditionControls();
  }

  function candidateValueText(candidate) {
    return String(candidate.displayValue ?? displayCandidateValue(candidate.value, candidate.multiplier));
  }

  function updateSelectionUI() {
    const selectedKey = selectedCandidate ? candidateKey(selectedCandidate) : "";
    for (const row of document.querySelectorAll("[data-candidate-key]")) {
      row.classList.toggle("selected", row.dataset.candidateKey === selectedKey);
    }
    const hasSelection = Boolean(selectedCandidate);
    elements.editor.hidden = !hasSelection;
    elements.advancedEditor.hidden = !hasSelection;
    if (!selectedCandidate) {
      return;
    }
    const address = formatAddress(selectedCandidate.address);
    const value = candidateValueText(selectedCandidate);
    elements.selectedAddress.textContent = address;
    elements.advancedSelectedAddress.textContent = address;
    elements.writeValue.value = value;
    elements.advancedWriteValue.value = value;
    const frozen = frozenCandidates.has(selectedKey);
    for (const button of [elements.freeze, elements.advancedFreeze]) {
      button.textContent = frozen ? "Unfreeze" : "Freeze";
      button.classList.toggle("freeze-active", frozen);
    }
  }

  function addWatch(candidate) {
    const key = candidateKey(candidate);
    if (!watchedCandidates.has(key) && watchedCandidates.size >= MAX_SIDEBAR_WATCHES) {
      setQuickStatus(`The sidebar watch list is limited to ${MAX_SIDEBAR_WATCHES} values.`, "error");
      return;
    }
    const existing = watchedCandidates.get(key);
    watchedCandidates.set(key, existing || { candidate, valueCells: new Set() });
    renderWatches();
  }

  function selectCandidate(candidate) {
    selectedCandidate = candidate;
    addWatch(candidate);
    updateSelectionUI();
  }

  function makeValueCell(entry) {
    const value = document.createElement("span");
    value.className = "candidate-value";
    value.textContent = candidateValueText(entry.candidate);
    entry.valueCells.add(value);
    return value;
  }

  function renderSimpleCandidates() {
    elements.candidates.replaceChildren();
    for (const [key, entry] of [...candidateRecords].slice(0, 20)) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "quick-candidate";
      row.dataset.candidateKey = key;
      const address = document.createElement("span");
      address.className = "candidate-address";
      address.textContent = formatAddress(entry.candidate.address);
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
      return !filter || `${formatAddress(candidate.address)} ${candidateValueText(candidate)} ${candidate.type}`.toLowerCase().includes(filter);
    });
    const sort = elements.advancedSort.value;
    records.sort(([, left], [, right]) => {
      if (sort === "value") {
        return Number(left.candidate.displayValue) - Number(right.candidate.displayValue);
      }
      if (sort === "type") {
        return String(left.candidate.type).localeCompare(String(right.candidate.type)) || left.candidate.address - right.candidate.address;
      }
      return left.candidate.address - right.candidate.address;
    });
    for (const [key, entry] of records) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "advanced-candidate";
      row.dataset.candidateKey = key;
      const address = document.createElement("span");
      address.className = "candidate-address";
      address.textContent = formatAddress(entry.candidate.address);
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
      address.textContent = formatAddress(entry.candidate.address);
      const type = document.createElement("span");
      type.className = "candidate-type";
      type.textContent = entry.candidate.type;
      select.append(address, makeValueCell(entry), type);
      select.addEventListener("click", () => selectCandidate(entry.candidate));
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "watch-remove";
      remove.setAttribute("aria-label", `Remove watch at ${formatAddress(entry.candidate.address)}`);
      remove.textContent = "×";
      remove.addEventListener("click", () => {
        if (frozenCandidates.has(key)) {
          setQuickStatus("Unfreeze this value before removing its watch.", "error");
          return;
        }
        watchedCandidates.delete(key);
        renderWatches();
      });
      row.append(select, remove);
      elements.advancedWatches.append(row);
    }
    elements.advancedWatchCount.textContent = String(watchedCandidates.size);
    elements.advancedWatchEmpty.hidden = watchedCandidates.size > 0;
    elements.advancedWorkspace.hidden = !hasScanResults && watchedCandidates.size === 0;
    updateSelectionUI();
  }

  function renderResults(payload, frameId = quickSession?.frameId) {
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
    renderCandidateLists();
    renderWatches();

    const searchedTypes = Array.isArray(payload?.searchedTypes) ? payload.searchedTypes : [];
    elements.broaden.hidden = !(
      quickSession?.request?.refine === false &&
      ["exact", "range"].includes(quickSession?.request?.condition) &&
      searchedTypes.length > 0 &&
      searchedTypes.length < 8
    );

    if (payload?.allCandidates) {
      setQuickStatus("Baseline captured. Change the game value, choose a comparison, then run Next scan.", "ready");
    } else if (Number(payload?.total) === 0) {
      setQuickStatus("No matching values found. You can broaden the search or reset.", "error");
    } else {
      setQuickStatus(
        `${candidateTotal.toLocaleString()} candidates remain; showing ${preview.length}.`,
        "ready",
      );
    }
    updateScanControls();
    refreshCandidateValues();
  }

  function applyQuickSession(session) {
    quickSession = session || null;
    if (session?.request) {
      elements.condition.value = session.request.condition || "exact";
      elements.value.value = session.request.rawValue ?? elements.value.value;
      elements.maxValue.value = session.request.rawMaxValue ?? elements.maxValue.value;
      elements.advancedCondition.value = session.request.condition || "exact";
      elements.advancedValue.value = session.request.rawValue ?? elements.advancedValue.value;
      elements.advancedMaxValue.value = session.request.rawMaxValue ?? elements.advancedMaxValue.value;
      elements.advancedType.value = session.request.type || "smart";
      elements.advancedAlignment.value = session.request.alignment || "aligned";
      elements.advancedMultiplier.value = session.request.multiplier ?? 1;
    }
    if (session?.status === "scanning") {
      const progress = session.progress;
      setQuickStatus(
        progress?.total
          ? `Scanning… ${Number(progress.inspected).toLocaleString()} / ${Number(progress.total).toLocaleString()}`
          : "Scanning memory…",
      );
    } else if (session?.status === "error" || session?.status === "disconnected") {
      setQuickStatus(session.error || "The scan could not continue.", "error");
    } else if (session?.status === "cancelled") {
      setQuickStatus("Scan cancelled.");
    } else if (session?.results) {
      renderResults(session.results, session.frameId);
    } else if (!session) {
      clearCandidateRefreshState();
      hasScanResults = false;
      candidateTotal = 0;
      selectedCandidate = null;
      elements.results.hidden = true;
      elements.candidates.replaceChildren();
      elements.advancedCandidates.replaceChildren();
      elements.advancedResultCount.textContent = "0";
      renderWatches();
      setQuickStatus("Ready to scan this memory.");
    }
    updateScanControls();
  }

  function addInstances(frameId, url, list) {
    for (const instance of Array.isArray(list) ? list : []) {
      instances.set(`${frameId}:${instance.id}`, { ...instance, frameId, url });
    }
    updateInstanceOptions();
    updateScanControls();
  }

  function handlePagePayload(message, payload) {
    if (payload?.kind === "instanceCaptured") {
      addInstances(message.frameId, message.url, [payload.instance]);
      return;
    }
    if (payload?.kind === "instanceList") {
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
        if (!value.error) {
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
    } else if (payload.kind === "scanProgress") {
      if (quickSession) {
        quickSession.status = "scanning";
        quickSession.progress = payload;
      }
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
      if (quickSession) {
        quickSession.status = "cancelled";
      }
      setQuickStatus("Scan cancelled.");
      updateScanControls();
    } else if (payload.kind === "writeComplete" || payload.kind === "writeVerified") {
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
      setQuickStatus(
        payload.kind === "writeVerified" && payload.persisted === false
          ? "The game restored the old value. Freeze it to keep the replacement."
          : `Wrote ${payload.displayValue ?? payload.value} successfully.`,
        payload.persisted === false ? "error" : "ready",
      );
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
    } else if (message?.kind === "frameConnected") {
      send({ kind: "listInstances", requestId: nextRequestId("instances") }, message.frameId);
    } else if (message?.kind === "frameDisconnected") {
      for (const [key, record] of instances) {
        if (record.frameId === message.frameId) {
          instances.delete(key);
        }
      }
      candidateReadRequests.clear();
      pendingCandidateInstances.clear();
      updateInstanceOptions();
      updateScanControls();
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

  async function initialize() {
    const tab = hasBoundTab
      ? await extensionApi.tabs.get(boundTabId)
      : (await extensionApi.tabs.query({ active: true, currentWindow: true }))[0];
    activeTab = tab || null;
    elements.pin.disabled = !activeTab?.id;
    if (activeTab?.id) {
      port = extensionApi.runtime.connect({ name: `hack-popup:${activeTab.id}` });
      port.onMessage.addListener(handlePortMessage);
      port.onDisconnect.addListener(() => {
        port = null;
        setQuickStatus("The extension connection was closed.", "error");
        updateScanControls();
      });
      const session = await extensionApi.runtime.sendMessage({
        kind: "getQuickSession",
        tabId: activeTab.id,
      });
      applyQuickSession(session);
    }
    await refreshSummary();
    pollTimer = setInterval(refreshSummary, 1000);
    candidateRefreshTimer = setInterval(refreshCandidateValues, CANDIDATE_REFRESH_MS);
  }

  elements.condition.addEventListener("change", updateConditionControls);
  elements.advancedCondition.addEventListener("change", updateConditionControls);
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
        refine ? "The memory used by this scan is no longer available. Reset and scan again." : "No WebAssembly memory is available.",
        "error",
      );
      return false;
    }
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
      setQuickStatus(condition === "unknown" ? "Capturing the initial snapshot…" : "Scanning memory…");
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
      multiplier: elements.advancedMultiplier.value,
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
    send({
      kind: "writeValue",
      requestId: nextRequestId("write"),
      instanceId: selectedCandidate.instanceId,
      type: selectedCandidate.type,
      address: selectedCandidate.address,
      rawValue: input.value,
      multiplier: selectedCandidate.multiplier,
    }, selectedCandidate.frameId);
    setQuickStatus("Writing and checking the value…");
  }
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

  elements.openInspector.addEventListener("click", async () => {
    if (!activeTab?.id) {
      return;
    }
    const url = new URL(extensionApi.runtime.getURL("devtools/panel/panel.html"));
    url.searchParams.set("standalone", "1");
    url.searchParams.set("tabId", String(activeTab.id));
    await extensionApi.tabs.create(newTabOptions(url.href));
    if (!isSidebarPanel && !isPopoutWindow) {
      window.close();
    }
  });

  elements.refreshConnection.addEventListener("click", async () => {
    if (!activeTab?.id) {
      return;
    }
    elements.statusTitle.textContent = "Reloading this tab…";
    await extensionApi.tabs.reload(activeTab.id);
  });

  elements.howItWorks.addEventListener("click", async () => {
    await extensionApi.tabs.create(newTabOptions(
      "https://abduljawada.github.io/hack-engine/#capabilities",
    ));
    if (!isSidebarPanel && !isPopoutWindow) {
      window.close();
    }
  });

  window.addEventListener("unload", () => {
    clearInterval(pollTimer);
    clearInterval(candidateRefreshTimer);
    port?.disconnect?.();
  });

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
