(() => {
  "use strict";

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const queryTabId = Number(new URLSearchParams(location.search).get("tabId"));
  const tabId = extensionApi.devtools?.inspectedWindow?.tabId ?? queryTabId;
  if (!Number.isInteger(tabId) || tabId < 0) {
    throw new Error("Hack Engine could not determine which browser tab to inspect.");
  }
  const instances = new Map();
  const candidateValueCells = new Map();
  const frozenAddresses = new Set();
  const watchedAddresses = new Map();
  const watchReadRequests = new Map();
  const pendingWatchInstances = new Set();
  const selectedCandidates = new Set();
  let candidateRecords = [];
  let scanHistory = [];
  let activeScanMeta = null;
  let requestSequence = 1;
  let selectedCandidateRow = null;
  let selectedAddress = null;
  let selectedValueType = null;
  let selectedMultiplier = 1;
  let port = null;
  let reconnectTimer = null;
  let scanWatchdog = null;
  let activeScanRequestId = null;
  let pendingSharedInstanceKey = null;
  let appliedSharedResultId = null;
  const SCAN_WATCHDOG_MS = 15_000;
  const WATCH_REFRESH_MS = 250;
  const MAX_WATCH_ADDRESSES = 256;
  const MAX_CANDIDATE_PREVIEW = 200;
  const MAX_SCAN_HISTORY = 20;
  const WATCH_STORAGE_KEY = `ruffle-memory-inspector:watches:${tabId}`;
  const HISTORY_STORAGE_KEY = `ruffle-memory-inspector:history:${tabId}`;

  const elements = {
    instance: document.querySelector("#instance"),
    type: document.querySelector("#type"),
    alignment: document.querySelector("#alignment"),
    condition: document.querySelector("#condition"),
    scanValue: document.querySelector("#scan-value"),
    scanValueLabel: document.querySelector("#scan-value-label"),
    scanValueText: document.querySelector("#scan-value-text"),
    scanMaxValue: document.querySelector("#scan-max-value"),
    scanMaxValueLabel: document.querySelector("#scan-max-value-label"),
    multiplier: document.querySelector("#multiplier"),
    multiplierLabel: document.querySelector("#multiplier-label"),
    firstScan: document.querySelector("#first-scan"),
    nextScan: document.querySelector("#next-scan"),
    cancelScan: document.querySelector("#cancel-scan"),
    resetScan: document.querySelector("#reset-scan"),
    refresh: document.querySelector("#refresh"),
    status: document.querySelector("#status"),
    statusDot: document.querySelector("#status-dot"),
    resultCount: document.querySelector("#result-count"),
    visibleCount: document.querySelector("#visible-count"),
    selectedCount: document.querySelector("#selected-count"),
    candidates: document.querySelector("#candidates"),
    candidateFilter: document.querySelector("#candidate-filter"),
    candidateSort: document.querySelector("#candidate-sort"),
    selectVisible: document.querySelector("#select-visible"),
    clearSelection: document.querySelector("#clear-selection"),
    candidateLabel: document.querySelector("#candidate-label"),
    candidateGroup: document.querySelector("#candidate-group"),
    applyMetadata: document.querySelector("#apply-metadata"),
    batchWatch: document.querySelector("#batch-watch"),
    batchWrite: document.querySelector("#batch-write"),
    batchFreeze: document.querySelector("#batch-freeze"),
    batchUnfreeze: document.querySelector("#batch-unfreeze"),
    writeAddress: document.querySelector("#write-address"),
    writeValue: document.querySelector("#write-value"),
    write: document.querySelector("#write"),
    addWatch: document.querySelector("#add-watch"),
    freeze: document.querySelector("#freeze"),
    watchList: document.querySelector(".watch-list"),
    watchCount: document.querySelector("#watch-count"),
    watchEmpty: document.querySelector("#watch-empty"),
    watches: document.querySelector("#watches"),
    historyList: document.querySelector(".history-list"),
    scanHistory: document.querySelector("#scan-history"),
    exportWorkspace: document.querySelector("#export-workspace"),
    importWorkspace: document.querySelector("#import-workspace"),
    workspaceFile: document.querySelector("#workspace-file"),
  };

  function requestId() {
    return `${Date.now()}:${requestSequence++}`;
  }

  function selectedInstance() {
    return instances.get(elements.instance.value);
  }

  function freezeIdentity(record, type, address) {
    return `${record.frameId}:${record.id}:${type}:${address}`;
  }

  function watchIdentity(frameId, instanceId, type, address) {
    return `${frameId}:${instanceId}:${type}:${address}`;
  }

  function instanceFor(frameId, instanceId) {
    return instances.get(`${frameId}:${instanceId}`);
  }

  function parseAddress(rawAddress) {
    const value = rawAddress.trim();
    if (!value) {
      return Number.NaN;
    }
    return value.toLowerCase().startsWith("0x")
      ? Number.parseInt(value.slice(2), 16)
      : Number.parseInt(value, 10);
  }

  function formatAddress(address) {
    return `0x${address.toString(16).padStart(8, "0")}`;
  }

  function updateFreezeButton() {
    const record = selectedInstance();
    const type = selectedValueType ?? elements.type.value;
    const active = Boolean(
      record &&
      selectedAddress !== null &&
      type !== "auto" &&
      frozenAddresses.has(freezeIdentity(record, type, selectedAddress)),
    );
    elements.freeze.textContent = active ? "Unfreeze" : "Freeze value";
    elements.freeze.classList.toggle("freeze-active", active);
  }

  function setScanButtonsDisabled(disabled) {
    const available = instances.size > 0;
    elements.firstScan.disabled = disabled || !available;
    elements.nextScan.disabled = disabled || !available;
    elements.cancelScan.disabled = !disabled;
  }

  function clearScanWatchdog() {
    clearTimeout(scanWatchdog);
    scanWatchdog = null;
  }

  function armScanWatchdog(scanRequestId) {
    clearScanWatchdog();
    scanWatchdog = setTimeout(() => {
      if (activeScanRequestId !== scanRequestId) {
        return;
      }
      const record = activeScanMeta?.instanceKey
        ? instances.get(activeScanMeta.instanceKey)
        : selectedInstance();
      if (record) {
        send({
          kind: "cancelScan",
          requestId: requestId(),
          targetRequestId: scanRequestId,
        }, record.frameId);
      }
      activeScanRequestId = null;
      setScanButtonsDisabled(false);
      completeScanHistory("timeout", null);
      setStatus(
        "The scan stopped reporting progress for 15 seconds. Reload the page and reopen DevTools if the extension was reloaded.",
        "error",
      );
    }, SCAN_WATCHDOG_MS);
  }

  function finishScanRequest(scanRequestId) {
    if (scanRequestId !== activeScanRequestId) {
      return false;
    }
    activeScanRequestId = null;
    clearScanWatchdog();
    setScanButtonsDisabled(false);
    return true;
  }

  function send(payload, frameId = selectedInstance()?.frameId) {
    if (!port) {
      setStatus("Extension connection lost. Reopen DevTools to reconnect.", "error");
      return false;
    }
    try {
      port.postMessage({ kind: "routeCommand", frameId, payload });
      return true;
    } catch {
      port = null;
      clearScanWatchdog();
      setScanButtonsDisabled(false);
      setStatus(
        "Extension connection lost after an add-on reload. Reload the game page, then close and reopen DevTools.",
        "error",
      );
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

  function setStatus(message, state = "working") {
    elements.status.textContent = message;
    elements.statusDot.className = state === "ready" ? "ready" : state === "error" ? "error" : "";
  }

  function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
    }
    return `${Math.round(bytes / 1024)} KiB`;
  }

  function candidateIdentity(type, address, multiplier = 1) {
    return `${type}:${address}:${multiplier}`;
  }

  function persistHistory() {
    try {
      sessionStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(scanHistory));
    } catch {
      // History remains available until this panel closes if storage is unavailable.
    }
  }

  function restoreHistory() {
    try {
      const stored = JSON.parse(sessionStorage.getItem(HISTORY_STORAGE_KEY) || "[]");
      if (Array.isArray(stored)) {
        scanHistory = stored.slice(0, MAX_SCAN_HISTORY);
      }
    } catch {
      scanHistory = [];
    }
  }

  function renderScanHistory() {
    elements.scanHistory.replaceChildren();
    for (const entry of scanHistory) {
      const row = document.createElement("tr");
      const time = document.createElement("td");
      const request = document.createElement("td");
      const result = document.createElement("td");
      const duration = document.createElement("td");
      time.textContent = new Date(entry.startedAt).toLocaleTimeString();
      request.textContent = `${entry.refine ? "Next" : "First"} · ${entry.type} · ${entry.condition}`;
      result.textContent = entry.status === "completed"
        ? `${Number(entry.total || 0).toLocaleString()} candidates`
        : entry.status;
      duration.textContent = entry.completedAt
        ? `${Math.max(0, entry.completedAt - entry.startedAt)} ms`
        : "Running…";
      row.append(time, request, result, duration);
      elements.scanHistory.append(row);
    }
    elements.historyList.classList.toggle("has-history", scanHistory.length > 0);
  }

  function completeScanHistory(status, total) {
    if (!activeScanMeta) {
      return;
    }
    const entry = {
      ...activeScanMeta,
      status,
      total: Number.isSafeInteger(total) ? total : null,
      completedAt: Date.now(),
    };
    scanHistory.unshift(entry);
    scanHistory = scanHistory.slice(0, MAX_SCAN_HISTORY);
    activeScanMeta = null;
    persistHistory();
    renderScanHistory();
  }

  function activeValueType() {
    const type = selectedValueType ?? elements.type.value;
    if (type === "auto") {
      setStatus("Select a typed candidate before writing, watching, or freezing.", "error");
      return null;
    }
    return type;
  }

  function decodedValue(value, multiplier) {
    return typeof value === "number" && Number.isFinite(value)
      ? value / multiplier
      : value;
  }

  function persistWatches() {
    try {
      const watches = [...watchedAddresses.values()].map((entry) => ({
        frameId: entry.frameId,
        instanceId: entry.instanceId,
        type: entry.type,
        multiplier: entry.multiplier,
        address: entry.address,
        label: entry.label,
        group: entry.group,
        hint: entry.hint,
        url: entry.url,
      }));
      sessionStorage.setItem(WATCH_STORAGE_KEY, JSON.stringify(watches));
    } catch {
      // A watch list still works for the current panel if storage is unavailable.
    }
  }

  function sharedWatch(entry) {
    return {
      frameId: entry.frameId,
      instanceId: String(entry.instanceId),
      type: entry.type,
      multiplier: Number(entry.multiplier) || 1,
      address: entry.address,
      label: entry.label || "",
      group: entry.group || "",
      hint: entry.hint || "",
      url: entry.url || "",
    };
  }

  function restoreWatches() {
    let stored;
    try {
      stored = JSON.parse(sessionStorage.getItem(WATCH_STORAGE_KEY) || "[]");
    } catch {
      stored = [];
    }
    if (!Array.isArray(stored)) {
      return;
    }
    for (const value of stored.slice(0, MAX_WATCH_ADDRESSES)) {
      if (
        !Number.isInteger(value?.frameId) ||
        typeof value.instanceId !== "string" ||
        !["i8", "u8", "i16", "u16", "i32", "u32", "f32", "f64"].includes(value.type) ||
        !Number.isSafeInteger(value.address) ||
        value.address < 0
      ) {
        continue;
      }
      const key = watchIdentity(value.frameId, value.instanceId, value.type, value.address);
      watchedAddresses.set(key, {
        key,
        frameId: value.frameId,
        instanceId: value.instanceId,
        type: value.type,
        multiplier: Number.isFinite(value.multiplier) && value.multiplier > 0
          ? value.multiplier
          : 1,
        address: value.address,
        label: typeof value.label === "string" ? value.label.slice(0, 80) : "",
        group: typeof value.group === "string" ? value.group.slice(0, 80) : "",
        hint: typeof value.hint === "string" ? value.hint : "",
        url: typeof value.url === "string" ? value.url : "",
        value: undefined,
        state: "waiting",
        detail: "Waiting for the captured memory.",
        diagnosticState: null,
        diagnosticDetail: "",
      });
    }
  }

  function watchRecord(entry) {
    const record = instanceFor(entry.frameId, entry.instanceId);
    if (!record) {
      return null;
    }
    if (entry.hint && record.hint && entry.hint !== record.hint) {
      return null;
    }
    return record;
  }

  function watchStateLabel(entry) {
    switch (entry.state) {
      case "live": return "Live";
      case "stable": return "Stable";
      case "changed": return "Changed";
      case "checking": return "Checking write…";
      case "persistent": return "Write persisted";
      case "restored": return "Game restored it";
      case "rejected": return "Write rejected";
      case "frozen": return "Frozen";
      case "unavailable": return "Unavailable";
      default: return "Waiting";
    }
  }

  function selectWatch(entry, { broadcast = true } = {}) {
    const instanceKey = `${entry.frameId}:${entry.instanceId}`;
    if (instances.has(instanceKey)) {
      elements.instance.value = instanceKey;
      pendingSharedInstanceKey = null;
    } else {
      pendingSharedInstanceKey = instanceKey;
    }
    elements.type.value = entry.type;
    elements.multiplier.value = String(entry.multiplier);
    selectedValueType = entry.type;
    selectedMultiplier = entry.multiplier;
    selectedCandidateRow?.classList.remove("selected");
    selectedCandidateRow = entry.row;
    selectedAddress = entry.address;
    entry.row?.classList.add("selected");
    elements.writeAddress.value = formatAddress(entry.address);
    const numericValue = typeof entry.value === "number" && Number.isFinite(entry.value)
      ? decodedValue(entry.value, entry.multiplier)
      : null;
    elements.writeValue.value = numericValue === null ? "" : String(numericValue);
    updateFreezeButton();
    if (broadcast) {
      sendWorkspace("select", { key: entry.key });
    }
  }

  function renderWatches() {
    elements.watches.replaceChildren();
    for (const entry of watchedAddresses.values()) {
      const row = document.createElement("tr");
      const address = document.createElement("td");
      const type = document.createElement("td");
      const labelCell = document.createElement("td");
      const groupCell = document.createElement("td");
      const value = document.createElement("td");
      const state = document.createElement("td");
      const actions = document.createElement("td");
      const remove = document.createElement("button");
      const label = document.createElement("input");
      const group = document.createElement("input");
      address.textContent = formatAddress(entry.address);
      type.textContent = entry.multiplier === 1
        ? entry.type
        : `${entry.type} ×${entry.multiplier}`;
      label.className = "watch-meta";
      label.maxLength = 80;
      label.placeholder = "Label";
      label.value = entry.label || "";
      group.className = "watch-meta";
      group.maxLength = 80;
      group.placeholder = "Group";
      group.value = entry.group || "";
      for (const [input, field] of [[label, "label"], [group, "group"]]) {
        input.addEventListener("click", (event) => event.stopPropagation());
        input.addEventListener("change", () => {
          entry[field] = input.value.trim().slice(0, 80);
          persistWatches();
          sendWorkspace("upsertWatch", { watch: sharedWatch(entry), select: false });
        });
      }
      labelCell.append(label);
      groupCell.append(group);
      value.textContent = entry.value === undefined
        ? "—"
        : String(decodedValue(entry.value, entry.multiplier));
      state.textContent = watchStateLabel(entry);
      state.title = entry.detail || "";
      state.className = `watch-state ${entry.state}`;
      remove.type = "button";
      remove.className = "watch-remove";
      remove.textContent = "Remove";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        if (frozenAddresses.has(entry.key)) {
          setStatus("Unfreeze this address before removing it from the watch list.", "error");
          return;
        }
        watchedAddresses.delete(entry.key);
        persistWatches();
        renderWatches();
        sendWorkspace("removeWatch", { key: entry.key });
      });
      actions.append(remove);
      row.append(address, type, labelCell, groupCell, value, state, actions);
      row.addEventListener("click", () => selectWatch(entry));
      entry.row = row;
      entry.valueCell = value;
      entry.stateCell = state;
      elements.watches.append(row);
    }
    elements.watchCount.textContent = watchedAddresses.size.toLocaleString();
    elements.watchList.classList.toggle("has-watches", watchedAddresses.size > 0);
  }

  function updateWatchEntry(entry, value, state, detail = "") {
    if (value !== undefined) {
      entry.value = value;
      if (entry.valueCell) {
        entry.valueCell.textContent = String(decodedValue(value, entry.multiplier));
      }
    }
    entry.state = state;
    entry.detail = detail;
    if (entry.stateCell) {
      entry.stateCell.textContent = watchStateLabel(entry);
      entry.stateCell.className = `watch-state ${entry.state}`;
      entry.stateCell.title = detail;
    }
  }

  function addWatch(
    record,
    type,
    address,
    multiplier = 1,
    { select = true, quiet = false, label = "", group = "", broadcast = true } = {},
  ) {
    multiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
    if (!Number.isSafeInteger(address) || address < 0) {
      setStatus("Enter a valid non-negative address before adding a watch.", "error");
      return;
    }
    const key = watchIdentity(record.frameId, record.id, type, address);
    if (watchedAddresses.has(key)) {
      const existing = watchedAddresses.get(key);
      existing.multiplier = multiplier;
      if (label) {
        existing.label = label.slice(0, 80);
      }
      if (group) {
        existing.group = group.slice(0, 80);
      }
      persistWatches();
      renderWatches();
      if (broadcast) {
        sendWorkspace("upsertWatch", { watch: sharedWatch(existing), select });
      }
      if (select) {
        selectWatch(existing, { broadcast: false });
      }
      if (!quiet) {
        setStatus(`${formatAddress(address)} is already on the watch list.`, "ready");
      }
      return;
    }
    if (watchedAddresses.size >= MAX_WATCH_ADDRESSES) {
      setStatus(`The watch list supports up to ${MAX_WATCH_ADDRESSES} addresses.`, "error");
      return;
    }
    const entry = {
      key,
      frameId: record.frameId,
      instanceId: record.id,
      type,
      multiplier,
      address,
      label: label.slice(0, 80),
      group: group.slice(0, 80),
      hint: record.hint || "",
      url: record.url || "",
      value: undefined,
      state: "waiting",
      detail: "Waiting for the first live refresh.",
      diagnosticState: null,
      diagnosticDetail: "",
    };
    watchedAddresses.set(key, entry);
    persistWatches();
    renderWatches();
    if (broadcast) {
      sendWorkspace("upsertWatch", { watch: sharedWatch(entry), select });
    }
    if (select) {
      selectWatch(entry, { broadcast: false });
    }
    refreshWatchValues();
    if (!quiet) {
      setStatus(`Watching ${type} at ${formatAddress(address)}.`, "ready");
    }
  }

  function refreshWatchValues() {
    if (!port || watchedAddresses.size === 0) {
      return;
    }
    const groups = new Map();
    for (const entry of watchedAddresses.values()) {
      const record = watchRecord(entry);
      if (!record) {
        updateWatchEntry(entry, undefined, "unavailable", "Captured memory is not connected.");
        continue;
      }
      const instanceKey = `${entry.frameId}:${entry.instanceId}`;
      if (!groups.has(instanceKey)) {
        groups.set(instanceKey, { record, entries: [] });
      }
      groups.get(instanceKey).entries.push(entry);
    }

    for (const [instanceKey, group] of groups) {
      if (pendingWatchInstances.has(instanceKey)) {
        continue;
      }
      const watchRequestId = requestId();
      pendingWatchInstances.add(instanceKey);
      watchReadRequests.set(watchRequestId, instanceKey);
      const sent = send({
        kind: "readValues",
        requestId: watchRequestId,
        instanceId: group.record.id,
        entries: group.entries.map((entry) => ({
          id: entry.key,
          type: entry.type,
          address: entry.address,
        })),
      }, group.record.frameId);
      if (!sent) {
        pendingWatchInstances.delete(instanceKey);
        watchReadRequests.delete(watchRequestId);
      }
    }
  }

  function refreshInstanceSelect() {
    const previous = elements.instance.value;
    elements.instance.replaceChildren();

    for (const [key, record] of instances) {
      const option = document.createElement("option");
      option.value = key;
      const marker = record.looksLikeRuffle ? "Ruffle" : "WASM";
      option.textContent = `${marker} · frame ${record.frameId} · ${formatBytes(record.memoryBytes)}`;
      option.title = record.hint || record.url;
      elements.instance.append(option);
    }

    if (pendingSharedInstanceKey && instances.has(pendingSharedInstanceKey)) {
      elements.instance.value = pendingSharedInstanceKey;
      pendingSharedInstanceKey = null;
    } else if (instances.has(previous)) {
      elements.instance.value = previous;
    }

    const available = instances.size > 0;
    setScanButtonsDisabled(false);
    elements.resetScan.disabled = !available;
    elements.write.disabled = !available;
    elements.addWatch.disabled = !available;
    elements.freeze.disabled = !available;
    if (available) {
      setStatus(`${instances.size} WebAssembly memor${instances.size === 1 ? "y" : "ies"} captured.`, "ready");
    }
    refreshWatchValues();
  }

  function listInstances() {
    send({ kind: "listInstances", requestId: requestId() }, undefined);
    setStatus("Looking for embedded WebAssembly instances…");
  }

  function addInstances(frameId, url, list) {
    for (const instance of list) {
      const key = `${frameId}:${instance.id}`;
      instances.set(key, { ...instance, frameId, url });
    }
    refreshInstanceSelect();
  }

  function runScan(refine) {
    const record = selectedInstance();
    if (!record) {
      setStatus("No WebAssembly memory has been captured.", "error");
      return;
    }
    const condition = elements.condition.value;
    const rawValue = elements.scanValue.value;
    const rawMaxValue = elements.scanMaxValue.value;
    const multiplier = Number(elements.multiplier.value);
    const valueConditions = ["exact", "range", "increasedBy", "decreasedBy"];
    if (valueConditions.includes(condition) && rawValue.trim() === "") {
      setStatus("Enter a value to scan for.", "error");
      return;
    }
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      setStatus("The stored-value multiplier must be a positive number.", "error");
      return;
    }
    if (condition === "range" && rawMaxValue.trim() === "") {
      setStatus("Enter a maximum value for the range.", "error");
      return;
    }
    if (condition === "range" && Number(rawValue) > Number(rawMaxValue)) {
      setStatus("The range minimum cannot be greater than its maximum.", "error");
      return;
    }
    if (!refine && !["exact", "range", "unknown"].includes(condition)) {
      setStatus("A first scan must use Exact value, Value range, or Unknown initial value.", "error");
      return;
    }
    if (refine && condition === "unknown") {
      setStatus("Unknown initial value is only available for a first scan.", "error");
      return;
    }
    const scanRequestId = requestId();
    activeScanRequestId = scanRequestId;
    const sent = send({
      kind: "memoryScan",
      requestId: scanRequestId,
      instanceId: record.id,
      type: elements.type.value,
      rawValue,
      rawMaxValue,
      multiplier,
      condition,
      alignment: elements.alignment.value,
      refine,
    }, record.frameId);
    if (!sent) {
      activeScanRequestId = null;
      return;
    }
    activeScanMeta = {
      requestId: scanRequestId,
      startedAt: Date.now(),
      refine,
      type: elements.type.value,
      condition,
      alignment: elements.alignment.value,
      multiplier,
      instanceKey: `${record.frameId}:${record.id}`,
    };
    setScanButtonsDisabled(true);
    setStatus(
      condition === "unknown"
        ? "Capturing an initial memory snapshot…"
        : condition === "range"
          ? refine
            ? "Filtering candidates within the selected range…"
            : "Scanning WASM memory for values in the selected range…"
        : refine && ["increasedBy", "decreasedBy"].includes(condition)
          ? `Filtering candidates that ${condition === "increasedBy" ? "increased" : "decreased"} by ${rawValue}…`
        : refine && condition !== "exact"
          ? `Filtering candidates whose values ${condition}…`
          : refine
            ? "Filtering existing candidates…"
            : "Scanning WASM memory…",
    );
    armScanWatchdog(scanRequestId);
  }

  function updateConditionControls() {
    const condition = elements.condition.value;
    const needsValue = ["exact", "range", "increasedBy", "decreasedBy"].includes(condition);
    const needsMaximum = condition === "range";
    elements.scanValue.disabled = !needsValue;
    elements.scanValueLabel.classList.toggle("disabled-label", !needsValue);
    elements.scanValueText.textContent = needsMaximum
      ? "Minimum value"
      : ["increasedBy", "decreasedBy"].includes(condition)
        ? "Change amount"
        : "Value";
    elements.scanMaxValue.disabled = !needsMaximum;
    elements.scanMaxValueLabel.hidden = !needsMaximum;
    elements.multiplier.disabled = false;
    elements.multiplierLabel.classList.remove("disabled-label");
  }

  function visibleCandidateRecords() {
    const filter = elements.candidateFilter.value.trim().toLowerCase();
    const records = filter
      ? candidateRecords.filter((candidate) => (
        formatAddress(candidate.address).includes(filter) ||
        candidate.type.toLowerCase().includes(filter) ||
        String(candidate.displayValue).toLowerCase().includes(filter)
      ))
      : candidateRecords.slice();
    const numericValue = (candidate) => (
      typeof candidate.displayValue === "number" ? candidate.displayValue : Number.NaN
    );
    switch (elements.candidateSort.value) {
      case "addressDesc": records.sort((a, b) => b.address - a.address); break;
      case "typeAsc": records.sort((a, b) => a.type.localeCompare(b.type) || a.address - b.address); break;
      case "valueAsc": records.sort((a, b) => numericValue(a) - numericValue(b)); break;
      case "valueDesc": records.sort((a, b) => numericValue(b) - numericValue(a)); break;
      default: records.sort((a, b) => a.address - b.address || a.type.localeCompare(b.type));
    }
    return records;
  }

  function watchCandidate(candidate, quiet = true, broadcast = true) {
    const record = selectedInstance();
    if (!record) {
      return;
    }
    addWatch(record, candidate.type, candidate.address, candidate.multiplier, {
      select: false,
      quiet,
      broadcast,
      label: elements.candidateLabel.value.trim(),
      group: elements.candidateGroup.value.trim(),
    });
  }

  function activateCandidate(candidate, row) {
    selectedCandidateRow?.classList.remove("selected");
    selectedCandidateRow = row;
    selectedAddress = candidate.address;
    selectedValueType = candidate.type;
    selectedMultiplier = candidate.multiplier;
    row.classList.add("selected");
    elements.writeAddress.value = formatAddress(candidate.address);
    elements.writeValue.value = String(candidate.displayValue);
    watchCandidate(candidate);
    const record = selectedInstance();
    if (record) {
      sendWorkspace("select", {
        key: watchIdentity(record.frameId, String(record.id), candidate.type, candidate.address),
      });
    }
    updateFreezeButton();
  }

  function selectedCandidateRecords() {
    return candidateRecords.filter((candidate) => selectedCandidates.has(candidate.key));
  }

  function updateCandidateSelectionCount() {
    elements.selectedCount.textContent = selectedCandidates.size.toLocaleString();
  }

  function renderCandidateWorkspace() {
    elements.candidates.replaceChildren();
    candidateValueCells.clear();
    selectedCandidateRow = null;
    const visible = visibleCandidateRecords();
    for (const candidate of visible) {
      const row = document.createElement("tr");
      const selectionCell = document.createElement("td");
      const address = document.createElement("td");
      const type = document.createElement("td");
      const value = document.createElement("td");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selectedCandidates.has(candidate.key);
      checkbox.setAttribute("aria-label", `Select ${formatAddress(candidate.address)} ${candidate.type}`);
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          selectedCandidates.add(candidate.key);
          watchCandidate(candidate);
        } else {
          selectedCandidates.delete(candidate.key);
        }
        updateCandidateSelectionCount();
      });
      selectionCell.append(checkbox);
      address.textContent = formatAddress(candidate.address);
      type.textContent = candidate.multiplier === 1
        ? candidate.type
        : `${candidate.type} ×${candidate.multiplier}`;
      value.textContent = String(candidate.displayValue);
      candidateValueCells.set(`${candidate.type}:${candidate.address}`, value);
      row.append(selectionCell, address, type, value);
      row.addEventListener("click", () => activateCandidate(candidate, row));
      elements.candidates.append(row);
    }
    elements.visibleCount.textContent = visible.length.toLocaleString();
    updateCandidateSelectionCount();
  }

  function renderCandidates(payload) {
    candidateRecords = [];
    selectedCandidates.clear();
    selectedCandidateRow?.classList.remove("selected");
    selectedCandidateRow = null;
    selectedAddress = null;
    selectedValueType = null;
    selectedMultiplier = Number(payload.multiplier) || 1;
    updateFreezeButton();
    for (const candidate of payload.preview.slice(0, MAX_CANDIDATE_PREVIEW)) {
      const candidateType = candidate.type || payload.type;
      const candidateMultiplier = Number(candidate.multiplier ?? payload.multiplier) || 1;
      candidateRecords.push({
        key: candidateIdentity(candidateType, candidate.address, candidateMultiplier),
        address: candidate.address,
        type: candidateType,
        multiplier: candidateMultiplier,
        value: candidate.value,
        displayValue: candidate.displayValue ?? candidate.value,
      });
    }
    renderCandidateWorkspace();

    elements.resultCount.textContent = payload.total.toLocaleString();
    const snapshotNote = payload.snapshotBytes == null
      ? ""
      : ` Compressed snapshot: ${formatBytes(payload.snapshotBytes)}.`;
    setStatus(
      payload.total === 0
        ? `No matching values found. Reset before starting a new scan.${snapshotNote}`
        : payload.allCandidates
          ? `${payload.total.toLocaleString()} initial candidates captured. Change the game value, choose a comparison condition, then use Next scan.${snapshotNote}`
        : `${payload.total.toLocaleString()} candidates remain; showing up to ${payload.preview.length}.${snapshotNote}`,
      "ready",
    );
  }

  function validateScanResults(payload) {
    if (
      !Number.isSafeInteger(payload?.total) ||
      payload.total < 0 ||
      !Array.isArray(payload.preview) ||
      payload.preview.some((candidate) => (
        !candidate ||
        !Number.isSafeInteger(candidate.address) ||
        candidate.address < 0 ||
        !("value" in candidate) ||
        (candidate.type !== undefined && typeof candidate.type !== "string")
      ))
    ) {
      throw new Error("The page returned an invalid scan result.");
    }
  }

  function watchForPayload(message, payload) {
    return watchedAddresses.get(
      watchIdentity(message.frameId, String(payload.instanceId), payload.type, payload.address),
    );
  }

  function diagnosticDetail(payload) {
    const mismatch = payload.samples?.find((sample) => !sample.matches);
    if (payload.classification === "persistent") {
      return `Matched across ${payload.samples.length} samples through 250 ms.`;
    }
    if (mismatch?.error) {
      return mismatch.error;
    }
    if (mismatch) {
      const observed = typeof mismatch.value === "number" && payload.multiplier
        ? mismatch.value / payload.multiplier
        : mismatch.value;
      return `${mismatch.stage}: observed ${observed} after ${mismatch.elapsedMs} ms.`;
    }
    return "The write could not be classified.";
  }

  function sharedScanMeta(session) {
    return {
      requestId: session.requestId,
      startedAt: Date.now(),
      refine: Boolean(session.request?.refine),
      type: session.request?.type || "smart",
      condition: session.request?.condition || "exact",
      alignment: session.request?.alignment || "aligned",
      multiplier: Number(session.request?.multiplier) || 1,
      instanceKey: `${session.frameId}:${session.instanceId}`,
    };
  }

  function applySharedScanSession(session) {
    if (!session) {
      activeScanRequestId = null;
      activeScanMeta = null;
      appliedSharedResultId = null;
      clearScanWatchdog();
      setScanButtonsDisabled(false);
      candidateRecords = [];
      selectedCandidates.clear();
      renderCandidateWorkspace();
      elements.resultCount.textContent = "0";
      setStatus("Scan state reset.", "ready");
      return;
    }
    if (session.request) {
      const { request } = session;
      if ([...elements.type.options].some((option) => option.value === request.type)) {
        elements.type.value = request.type;
      }
      elements.condition.value = request.condition || "exact";
      elements.scanValue.value = request.rawValue ?? "";
      elements.scanMaxValue.value = request.rawMaxValue ?? "";
      elements.alignment.value = request.alignment || "aligned";
      elements.multiplier.value = String(Number(request.multiplier) || 1);
      pendingSharedInstanceKey = `${session.frameId}:${session.instanceId}`;
      if (instances.has(pendingSharedInstanceKey)) {
        elements.instance.value = pendingSharedInstanceKey;
        pendingSharedInstanceKey = null;
      }
      updateConditionControls();
    }
    if (session.status === "scanning") {
      if (activeScanRequestId !== session.requestId) {
        activeScanRequestId = session.requestId;
        activeScanMeta = sharedScanMeta(session);
      }
      setScanButtonsDisabled(true);
      if (session.progress?.total) {
        setStatus(
          `Scanning… ${Number(session.progress.inspected).toLocaleString()} / ${Number(session.progress.total).toLocaleString()}`,
        );
      } else {
        setStatus("Scanning shared memory session…");
      }
      armScanWatchdog(session.requestId);
      return;
    }
    if (session.status === "complete" && session.results && appliedSharedResultId !== session.requestId) {
      if (!activeScanMeta) {
        activeScanMeta = sharedScanMeta(session);
      }
      activeScanRequestId = null;
      clearScanWatchdog();
      setScanButtonsDisabled(false);
      completeScanHistory("completed", session.results.total);
      try {
        validateScanResults(session.results);
        renderCandidates(session.results);
        appliedSharedResultId = session.requestId;
      } catch (error) {
        setStatus(`Unable to render shared scan results: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
      return;
    }
    if (session.status === "cancelled") {
      activeScanRequestId = null;
      clearScanWatchdog();
      setScanButtonsDisabled(false);
      completeScanHistory("cancelled", null);
      setStatus("Shared scan cancelled.", "ready");
    } else if (session.status === "error" || session.status === "disconnected") {
      activeScanRequestId = null;
      clearScanWatchdog();
      setScanButtonsDisabled(false);
      completeScanHistory("error", null);
      setStatus(session.error || "The shared scan could not continue.", "error");
    }
  }

  function applySharedWorkspace(workspace) {
    const incoming = new Map();
    for (const value of Array.isArray(workspace?.watches) ? workspace.watches : []) {
      const key = watchIdentity(value.frameId, String(value.instanceId), value.type, value.address);
      const existing = watchedAddresses.get(key);
      incoming.set(key, existing || {
        key,
        frameId: value.frameId,
        instanceId: String(value.instanceId),
        type: value.type,
        multiplier: Number(value.multiplier) || 1,
        address: value.address,
        label: value.label || "",
        group: value.group || "",
        hint: value.hint || "",
        url: value.url || "",
        value: undefined,
        state: "waiting",
        detail: "Waiting for the first live refresh.",
        diagnosticState: null,
        diagnosticDetail: "",
      });
      const entry = incoming.get(key);
      entry.multiplier = Number(value.multiplier) || 1;
      entry.label = value.label || "";
      entry.group = value.group || "";
    }
    watchedAddresses.clear();
    for (const [key, entry] of incoming) {
      watchedAddresses.set(key, entry);
    }
    frozenAddresses.clear();
    for (const key of Array.isArray(workspace?.frozenKeys) ? workspace.frozenKeys : []) {
      frozenAddresses.add(key);
    }
    persistWatches();
    renderWatches();
    const selected = watchedAddresses.get(workspace?.selectedKey);
    if (selected) {
      selectWatch(selected, { broadcast: false });
    } else {
      selectedCandidateRow?.classList.remove("selected");
      selectedCandidateRow = null;
      selectedAddress = null;
      selectedValueType = null;
      updateFreezeButton();
    }
    refreshWatchValues();
  }

  function handlePortMessage(message) {
    if (message?.kind === "quickSession") {
      applySharedScanSession(message.session);
      return;
    }
    if (message?.kind === "workspaceState") {
      applySharedWorkspace(message.workspace);
      return;
    }
    if (message?.kind === "frameConnected") {
      send({ kind: "listInstances", requestId: requestId() }, message.frameId);
      return;
    }
    if (message?.kind === "frameDisconnected") {
      for (const [key, record] of instances) {
        if (record.frameId === message.frameId) {
          instances.delete(key);
        }
      }
      for (const entry of watchedAddresses.values()) {
        if (entry.frameId === message.frameId) {
          updateWatchEntry(entry, undefined, "unavailable", "The frame disconnected.");
        }
      }
      for (const instanceKey of pendingWatchInstances) {
        if (instanceKey.startsWith(`${message.frameId}:`)) {
          pendingWatchInstances.delete(instanceKey);
        }
      }
      for (const [watchRequestId, instanceKey] of watchReadRequests) {
        if (instanceKey.startsWith(`${message.frameId}:`)) {
          watchReadRequests.delete(watchRequestId);
        }
      }
      refreshInstanceSelect();
      return;
    }
    if (message?.kind !== "pageMessage") {
      return;
    }

    const payload = message.payload;
    switch (payload?.kind) {
      case "instanceCaptured":
        addInstances(message.frameId, message.url, [payload.instance]);
        break;
      case "instanceList":
        addInstances(message.frameId, message.url, payload.instances);
        break;
      case "scanProgress":
        if (payload.requestId !== activeScanRequestId) {
          break;
        }
        armScanWatchdog(payload.requestId);
        setStatus(
          `Scanning… ${payload.inspected.toLocaleString()} / ${payload.total.toLocaleString()}${
            payload.snapshotBytes == null
              ? ""
              : ` · stored ${formatBytes(payload.snapshotBytes)}`
          }`,
        );
        break;
      case "scanResults": {
        if (!finishScanRequest(payload.requestId)) {
          break;
        }
        completeScanHistory("completed", payload.total);
        try {
          validateScanResults(payload);
          renderCandidates(payload);
        } catch (error) {
          setStatus(
            `Unable to render scan results: ${
              error instanceof Error ? error.message : String(error)
            }`,
            "error",
          );
        }
        break;
      }
      case "scanCancelled":
        if (payload.requestId === activeScanRequestId) {
          activeScanRequestId = null;
          clearScanWatchdog();
          setScanButtonsDisabled(false);
          completeScanHistory("cancelled", null);
          setStatus("Scan cancelled; partial snapshot data was released.", "ready");
        }
        break;
      case "watchValues": {
        const instanceKey = watchReadRequests.get(payload.requestId);
        if (!instanceKey) {
          break;
        }
        watchReadRequests.delete(payload.requestId);
        pendingWatchInstances.delete(instanceKey);
        for (const value of Array.isArray(payload.values) ? payload.values : []) {
          const entry = watchedAddresses.get(value.id);
          if (!entry) {
            continue;
          }
          if (value.error) {
            updateWatchEntry(entry, undefined, "unavailable", value.error);
            continue;
          }
          const previousValue = entry.value;
          const frozen = frozenAddresses.has(entry.key);
          let state;
          let detail;
          if (frozen) {
            state = "frozen";
            detail = "The value is being rewritten every animation frame.";
          } else if (entry.diagnosticState) {
            state = entry.diagnosticState;
            detail = entry.diagnosticDetail;
          } else if (previousValue === undefined) {
            state = "live";
            detail = "Live value refreshed.";
          } else if (Object.is(previousValue, value.value)) {
            state = "stable";
            detail = "Live value refreshed.";
          } else {
            state = "changed";
            detail = `Changed from ${previousValue} to ${value.value}.`;
          }
          updateWatchEntry(entry, value.value, state, detail);
        }
        break;
      }
      case "writeComplete":
        elements.writeValue.value = String(payload.displayValue ?? payload.value);
        if (candidateValueCells.has(`${payload.type}:${payload.address}`)) {
          candidateValueCells.get(`${payload.type}:${payload.address}`).textContent = String(
            payload.displayValue ?? payload.value,
          );
        }
        {
          const entry = watchForPayload(message, payload);
          if (entry) {
            entry.diagnosticState = null;
            entry.diagnosticDetail = "";
            updateWatchEntry(
              entry,
              payload.value,
              "checking",
              "Sampling the address across animation frames and 250 ms.",
            );
          }
        }
        setStatus(
          `Wrote ${payload.displayValue ?? payload.value} at 0x${payload.address.toString(16)}.`,
          "ready",
        );
        break;
      case "writeVerified":
        if (candidateValueCells.has(`${payload.type}:${payload.address}`)) {
          candidateValueCells.get(`${payload.type}:${payload.address}`).textContent = String(
            payload.displayValue ?? payload.actualValue,
          );
        }
        {
          const entry = watchForPayload(message, payload);
          if (entry) {
            updateWatchEntry(
              entry,
              payload.actualValue,
              "checking",
              payload.persisted
                ? "The 75 ms sample matched; longer diagnostics are still running."
                : `The 75 ms sample observed ${payload.actualValue}.`,
            );
          }
        }
        setStatus(
          payload.persisted
            ? `Write persisted at 0x${payload.address.toString(16)}.`
            : `The game restored this address to ${payload.displayValue ?? payload.actualValue}. Freeze it or continue narrowing candidates.`,
          payload.persisted ? "ready" : "error",
        );
        break;
      case "writeDiagnostic": {
        const entry = watchForPayload(message, payload);
        const finalSample = payload.samples?.at(-1);
        if (entry) {
          entry.diagnosticState = payload.classification;
          entry.diagnosticDetail = diagnosticDetail(payload);
          updateWatchEntry(
            entry,
            finalSample?.value,
            entry.diagnosticState,
            entry.diagnosticDetail,
          );
        }
        const address = formatAddress(payload.address);
        setStatus(
          payload.classification === "persistent"
            ? `Write at ${address} persisted across frames and 250 ms.`
            : payload.classification === "restored"
              ? `The game restored ${address}; see the watch row for timing details.`
              : `Write diagnostic for ${address}: ${payload.classification}.`,
          payload.classification === "persistent" ? "ready" : "error",
        );
        break;
      }
      case "freezeChanged": {
        const record = instanceFor(message.frameId, String(payload.instanceId));
        if (record) {
          const key = freezeIdentity(record, payload.type, payload.address);
          if (payload.enabled) {
            frozenAddresses.add(key);
            if (candidateValueCells.has(`${payload.type}:${payload.address}`)) {
              candidateValueCells.get(`${payload.type}:${payload.address}`).textContent = String(
                payload.displayValue ?? payload.value,
              );
            }
            setStatus(
              `Freezing ${payload.displayValue ?? payload.value} at 0x${payload.address.toString(16)}.`,
              "ready",
            );
          } else {
            frozenAddresses.delete(key);
            setStatus(`Unfroze 0x${payload.address.toString(16)}.`, "ready");
          }
          const entry = watchedAddresses.get(key);
          if (entry) {
            if (!payload.enabled) {
              entry.diagnosticState = null;
              entry.diagnosticDetail = "";
            }
            updateWatchEntry(
              entry,
              payload.enabled ? payload.value : entry.value,
              payload.enabled ? "frozen" : "live",
              payload.enabled
                ? "The value is being rewritten every animation frame."
                : "Freeze disabled; live refresh resumed.",
            );
          }
          updateFreezeButton();
        }
        break;
      }
      case "scanReset":
        candidateRecords = [];
        selectedCandidates.clear();
        elements.candidates.replaceChildren();
        elements.resultCount.textContent = "0";
        elements.visibleCount.textContent = "0";
        updateCandidateSelectionCount();
        setStatus("Scan state reset.", "ready");
        break;
      case "error":
        if (watchReadRequests.has(payload.requestId)) {
          const instanceKey = watchReadRequests.get(payload.requestId);
          watchReadRequests.delete(payload.requestId);
          pendingWatchInstances.delete(instanceKey);
        }
        if (payload.requestId === activeScanRequestId || !payload.requestId) {
          activeScanRequestId = null;
          clearScanWatchdog();
          setScanButtonsDisabled(false);
          completeScanHistory("error", null);
        }
        setStatus(payload.message, "error");
        break;
    }
  }

  function connectPanel() {
    clearTimeout(reconnectTimer);
    try {
      const nextPort = extensionApi.runtime.connect({ name: `ruffle-panel:${tabId}` });
      port = nextPort;
      nextPort.onMessage.addListener(handlePortMessage);
      nextPort.onDisconnect.addListener(() => {
        if (port !== nextPort) {
          return;
        }
        port = null;
        activeScanRequestId = null;
        completeScanHistory("disconnected", null);
        watchReadRequests.clear();
        pendingWatchInstances.clear();
        clearScanWatchdog();
        setScanButtonsDisabled(false);
        setStatus(
          "Extension connection lost. If the add-on was reloaded, reload the game page and reopen DevTools.",
          "error",
        );
        reconnectTimer = setTimeout(connectPanel, 750);
      });
      sendWorkspace("mergeWatches", { watches: serializableWatches() });
      listInstances();
    } catch {
      port = null;
      setStatus("Unable to connect to the extension. Close and reopen DevTools.", "error");
      reconnectTimer = setTimeout(connectPanel, 750);
    }
  }

  function requireSelectedCandidates() {
    const candidates = selectedCandidateRecords();
    if (candidates.length === 0) {
      setStatus("Select one or more candidate rows first.", "error");
      return null;
    }
    return candidates;
  }

  function watchCandidates(candidates) {
    for (const candidate of candidates) {
      watchCandidate(candidate, true, false);
    }
    sendWorkspace("mergeWatches", { watches: serializableWatches() });
    setStatus(`Watching ${candidates.length.toLocaleString()} selected candidate(s).`, "ready");
  }

  function batchWriteCandidates() {
    const candidates = requireSelectedCandidates();
    const record = selectedInstance();
    const rawValue = elements.writeValue.value;
    if (!candidates || !record) {
      return;
    }
    if (rawValue.trim() === "") {
      setStatus("Enter a new value before writing selected candidates.", "error");
      return;
    }
    for (const candidate of candidates) {
      watchCandidate(candidate);
      send({
        kind: "writeValue",
        requestId: requestId(),
        instanceId: record.id,
        type: candidate.type,
        address: candidate.address,
        rawValue,
        multiplier: candidate.multiplier,
      }, record.frameId);
    }
    setStatus(`Writing ${rawValue} to ${candidates.length.toLocaleString()} selected candidate(s)…`);
  }

  function batchFreezeCandidates(enabled) {
    const candidates = requireSelectedCandidates();
    const record = selectedInstance();
    if (!candidates || !record) {
      return;
    }
    for (const candidate of candidates) {
      watchCandidate(candidate);
      send({
        kind: "setFreeze",
        requestId: requestId(),
        instanceId: record.id,
        type: candidate.type,
        address: candidate.address,
        rawValue: String(candidate.displayValue),
        multiplier: candidate.multiplier,
        enabled,
      }, record.frameId);
    }
    setStatus(
      `${enabled ? "Freezing" : "Unfreezing"} ${candidates.length.toLocaleString()} selected candidate(s)…`,
    );
  }

  function applyCandidateMetadata() {
    const candidates = requireSelectedCandidates();
    const record = selectedInstance();
    if (!candidates || !record) {
      return;
    }
    const label = elements.candidateLabel.value.trim().slice(0, 80);
    const group = elements.candidateGroup.value.trim().slice(0, 80);
    for (const candidate of candidates) {
      addWatch(record, candidate.type, candidate.address, candidate.multiplier, {
        select: false,
        quiet: true,
        label,
        group,
        broadcast: false,
      });
    }
    sendWorkspace("mergeWatches", { watches: serializableWatches() });
    setStatus(`Updated metadata for ${candidates.length.toLocaleString()} candidate(s).`, "ready");
  }

  function serializableWatches() {
    return [...watchedAddresses.values()].map((entry) => ({
      frameId: entry.frameId,
      instanceId: entry.instanceId,
      type: entry.type,
      multiplier: entry.multiplier,
      address: entry.address,
      label: entry.label || "",
      group: entry.group || "",
      hint: entry.hint || "",
      url: entry.url || "",
    }));
  }

  function exportWorkspace() {
    const record = selectedInstance();
    const payload = {
      format: "ruffle-memory-workspace",
      version: 1,
      exportedAt: new Date().toISOString(),
      instance: record ? { hint: record.hint || "", url: record.url || "" } : null,
      candidates: candidateRecords.map(({ address, type, multiplier, value, displayValue }) => ({
        address,
        type,
        multiplier,
        value,
        displayValue,
      })),
      watches: serializableWatches(),
      history: scanHistory,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ruffle-memory-workspace-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setStatus("Workspace exported.", "ready");
  }

  function importWorkspaceData(payload) {
    if (payload?.format !== "ruffle-memory-workspace" || payload.version !== 1) {
      throw new Error("This is not a supported Hack Engine workspace file.");
    }
    const validTypes = new Set(["i8", "u8", "i16", "u16", "i32", "u32", "f32", "f64"]);
    const record = selectedInstance();
    if (record && Array.isArray(payload.watches)) {
      for (const watch of payload.watches.slice(0, MAX_WATCH_ADDRESSES)) {
        if (
          !validTypes.has(watch?.type) ||
          !Number.isSafeInteger(watch.address) ||
          watch.address < 0
        ) {
          continue;
        }
        addWatch(record, watch.type, watch.address, Number(watch.multiplier) || 1, {
          select: false,
          quiet: true,
          label: typeof watch.label === "string" ? watch.label : "",
          group: typeof watch.group === "string" ? watch.group : "",
          broadcast: false,
        });
      }
    }
    if (Array.isArray(payload.candidates)) {
      candidateRecords = payload.candidates.slice(0, MAX_CANDIDATE_PREVIEW).flatMap((candidate) => {
        const multiplier = Number(candidate?.multiplier) || 1;
        if (
          !validTypes.has(candidate?.type) ||
          !Number.isSafeInteger(candidate.address) ||
          candidate.address < 0 ||
          !Number.isFinite(multiplier) ||
          multiplier <= 0
        ) {
          return [];
        }
        return [{
          key: candidateIdentity(candidate.type, candidate.address, multiplier),
          address: candidate.address,
          type: candidate.type,
          multiplier,
          value: candidate.value,
          displayValue: candidate.displayValue ?? candidate.value,
        }];
      });
      selectedCandidates.clear();
      elements.resultCount.textContent = candidateRecords.length.toLocaleString();
      renderCandidateWorkspace();
    }
    if (Array.isArray(payload.history)) {
      scanHistory = payload.history.slice(0, MAX_SCAN_HISTORY);
      persistHistory();
      renderScanHistory();
    }
    persistWatches();
    sendWorkspace("mergeWatches", { watches: serializableWatches() });
    renderWatches();
    refreshWatchValues();
    setStatus("Workspace imported. Verify addresses before writing or freezing.", "ready");
  }

  elements.refresh.addEventListener("click", listInstances);
  elements.firstScan.addEventListener("click", () => runScan(false));
  elements.nextScan.addEventListener("click", () => runScan(true));
  elements.cancelScan.addEventListener("click", () => {
    const record = selectedInstance();
    if (!record || !activeScanRequestId) {
      return;
    }
    const targetRequestId = activeScanRequestId;
    elements.cancelScan.disabled = true;
    send({
      kind: "cancelScan",
      requestId: requestId(),
      targetRequestId,
    }, record.frameId);
    setStatus("Cancelling scan and releasing partial snapshot data…");
  });
  elements.resetScan.addEventListener("click", () => {
    const record = selectedInstance();
    if (record) {
      send({
        kind: "resetScan",
        requestId: requestId(),
        instanceId: record.id,
        type: elements.type.value,
      }, record.frameId);
    }
  });
  elements.write.addEventListener("click", () => {
    const record = selectedInstance();
    if (!record) {
      return;
    }
    const address = parseAddress(elements.writeAddress.value);
    const type = activeValueType();
    if (!type) {
      return;
    }
    addWatch(
      record,
      type,
      address,
      selectedValueType ? selectedMultiplier : Number(elements.multiplier.value),
      { select: false, quiet: true },
    );
    send({
      kind: "writeValue",
      requestId: requestId(),
      instanceId: record.id,
      type,
      address,
      rawValue: elements.writeValue.value,
      multiplier: selectedValueType ? selectedMultiplier : Number(elements.multiplier.value),
    }, record.frameId);
  });
  elements.addWatch.addEventListener("click", () => {
    const record = selectedInstance();
    if (!record) {
      setStatus("No WebAssembly memory has been captured.", "error");
      return;
    }
    const type = activeValueType();
    if (!type) {
      return;
    }
    addWatch(
      record,
      type,
      parseAddress(elements.writeAddress.value),
      selectedValueType ? selectedMultiplier : Number(elements.multiplier.value),
    );
  });
  elements.freeze.addEventListener("click", () => {
    const record = selectedInstance();
    if (!record || selectedAddress === null) {
      setStatus("Select a candidate before freezing it.", "error");
      return;
    }
    const type = activeValueType();
    if (!type) {
      return;
    }
    const key = freezeIdentity(record, type, selectedAddress);
    const enabled = !frozenAddresses.has(key);
    addWatch(
      record,
      type,
      selectedAddress,
      selectedValueType ? selectedMultiplier : Number(elements.multiplier.value),
      { select: false, quiet: true },
    );
    send({
      kind: "setFreeze",
      requestId: requestId(),
      instanceId: record.id,
      type,
      address: selectedAddress,
      rawValue: elements.writeValue.value,
      multiplier: selectedValueType ? selectedMultiplier : Number(elements.multiplier.value),
      enabled,
    }, record.frameId);
  });
  elements.instance.addEventListener("change", updateFreezeButton);
  elements.type.addEventListener("change", () => {
    selectedValueType = null;
    selectedMultiplier = Number(elements.multiplier.value) || 1;
    selectedAddress = null;
    selectedCandidateRow?.classList.remove("selected");
    selectedCandidateRow = null;
    updateFreezeButton();
  });
  elements.condition.addEventListener("change", updateConditionControls);
  elements.candidateFilter.addEventListener("input", renderCandidateWorkspace);
  elements.candidateSort.addEventListener("change", renderCandidateWorkspace);
  elements.selectVisible.addEventListener("click", () => {
    const candidates = visibleCandidateRecords();
    for (const candidate of candidates) {
      selectedCandidates.add(candidate.key);
      watchCandidate(candidate, true, false);
    }
    sendWorkspace("mergeWatches", { watches: serializableWatches() });
    renderCandidateWorkspace();
    setStatus(`Selected and watched ${candidates.length.toLocaleString()} visible candidate(s).`, "ready");
  });
  elements.clearSelection.addEventListener("click", () => {
    selectedCandidates.clear();
    renderCandidateWorkspace();
  });
  elements.batchWatch.addEventListener("click", () => {
    const candidates = requireSelectedCandidates();
    if (candidates) {
      watchCandidates(candidates);
    }
  });
  elements.batchWrite.addEventListener("click", batchWriteCandidates);
  elements.batchFreeze.addEventListener("click", () => batchFreezeCandidates(true));
  elements.batchUnfreeze.addEventListener("click", () => batchFreezeCandidates(false));
  elements.applyMetadata.addEventListener("click", applyCandidateMetadata);
  elements.exportWorkspace.addEventListener("click", exportWorkspace);
  elements.importWorkspace.addEventListener("click", () => elements.workspaceFile.click());
  elements.workspaceFile.addEventListener("change", async () => {
    const [file] = elements.workspaceFile.files || [];
    if (!file) {
      return;
    }
    try {
      importWorkspaceData(JSON.parse(await file.text()));
    } catch (error) {
      setStatus(
        `Unable to import workspace: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    } finally {
      elements.workspaceFile.value = "";
    }
  });

  restoreHistory();
  restoreWatches();
  renderWatches();
  renderScanHistory();
  refreshInstanceSelect();
  updateConditionControls();
  connectPanel();
  setInterval(refreshWatchValues, WATCH_REFRESH_MS);
})();
