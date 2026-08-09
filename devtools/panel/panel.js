(() => {
  "use strict";

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const tabId = extensionApi.devtools.inspectedWindow.tabId;
  const instances = new Map();
  const candidateValueCells = new Map();
  const frozenAddresses = new Set();
  const watchedAddresses = new Map();
  const watchReadRequests = new Map();
  const pendingWatchInstances = new Set();
  let requestSequence = 1;
  let selectedCandidateRow = null;
  let selectedAddress = null;
  let selectedValueType = null;
  let selectedMultiplier = 1;
  let port = null;
  let reconnectTimer = null;
  let scanWatchdog = null;
  let activeScanRequestId = null;
  const SCAN_WATCHDOG_MS = 15_000;
  const WATCH_REFRESH_MS = 250;
  const MAX_WATCH_ADDRESSES = 256;
  const WATCH_STORAGE_KEY = `ruffle-memory-inspector:watches:${tabId}`;

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
    resetScan: document.querySelector("#reset-scan"),
    refresh: document.querySelector("#refresh"),
    status: document.querySelector("#status"),
    statusDot: document.querySelector("#status-dot"),
    resultCount: document.querySelector("#result-count"),
    candidates: document.querySelector("#candidates"),
    writeAddress: document.querySelector("#write-address"),
    writeValue: document.querySelector("#write-value"),
    write: document.querySelector("#write"),
    addWatch: document.querySelector("#add-watch"),
    freeze: document.querySelector("#freeze"),
    watchList: document.querySelector(".watch-list"),
    watchCount: document.querySelector("#watch-count"),
    watchEmpty: document.querySelector("#watch-empty"),
    watches: document.querySelector("#watches"),
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
      setScanButtonsDisabled(false);
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
        hint: entry.hint,
        url: entry.url,
      }));
      sessionStorage.setItem(WATCH_STORAGE_KEY, JSON.stringify(watches));
    } catch {
      // A watch list still works for the current panel if storage is unavailable.
    }
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

  function selectWatch(entry) {
    const instanceKey = `${entry.frameId}:${entry.instanceId}`;
    if (instances.has(instanceKey)) {
      elements.instance.value = instanceKey;
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
  }

  function renderWatches() {
    elements.watches.replaceChildren();
    for (const entry of watchedAddresses.values()) {
      const row = document.createElement("tr");
      const address = document.createElement("td");
      const type = document.createElement("td");
      const value = document.createElement("td");
      const state = document.createElement("td");
      const actions = document.createElement("td");
      const remove = document.createElement("button");
      address.textContent = formatAddress(entry.address);
      type.textContent = entry.multiplier === 1
        ? entry.type
        : `${entry.type} ×${entry.multiplier}`;
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
      });
      actions.append(remove);
      row.append(address, type, value, state, actions);
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

  function addWatch(record, type, address, multiplier = 1) {
    multiplier = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
    if (!Number.isSafeInteger(address) || address < 0) {
      setStatus("Enter a valid non-negative address before adding a watch.", "error");
      return;
    }
    const key = watchIdentity(record.frameId, record.id, type, address);
    if (watchedAddresses.has(key)) {
      const existing = watchedAddresses.get(key);
      existing.multiplier = multiplier;
      persistWatches();
      renderWatches();
      selectWatch(existing);
      setStatus(`${formatAddress(address)} is already on the watch list.`, "ready");
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
    selectWatch(entry);
    refreshWatchValues();
    setStatus(`Watching ${type} at ${formatAddress(address)}.`, "ready");
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

    if (instances.has(previous)) {
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

  function renderCandidates(payload) {
    elements.candidates.replaceChildren();
    candidateValueCells.clear();
    selectedCandidateRow?.classList.remove("selected");
    selectedCandidateRow = null;
    selectedAddress = null;
    selectedValueType = null;
    selectedMultiplier = Number(payload.multiplier) || 1;
    updateFreezeButton();
    for (const candidate of payload.preview) {
      const row = document.createElement("tr");
      const address = document.createElement("td");
      const type = document.createElement("td");
      const value = document.createElement("td");
      const candidateType = candidate.type || payload.type;
      const candidateMultiplier = Number(candidate.multiplier ?? payload.multiplier) || 1;
      address.textContent = formatAddress(candidate.address);
      type.textContent = candidateMultiplier === 1
        ? candidateType
        : `${candidateType} ×${candidateMultiplier}`;
      value.textContent = String(candidate.displayValue ?? candidate.value);
      candidateValueCells.set(`${candidateType}:${candidate.address}`, value);
      row.append(address, type, value);
      row.addEventListener("click", () => {
        selectedCandidateRow?.classList.remove("selected");
        selectedCandidateRow = row;
        selectedAddress = candidate.address;
        selectedValueType = candidateType;
        selectedMultiplier = candidateMultiplier;
        row.classList.add("selected");
        elements.writeAddress.value = address.textContent;
        elements.writeValue.value = String(candidate.displayValue ?? candidate.value);
        updateFreezeButton();
      });
      elements.candidates.append(row);
    }

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

  function handlePortMessage(message) {
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
        elements.candidates.replaceChildren();
        elements.resultCount.textContent = "0";
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
      listInstances();
    } catch {
      port = null;
      setStatus("Unable to connect to the extension. Close and reopen DevTools.", "error");
      reconnectTimer = setTimeout(connectPanel, 750);
    }
  }

  elements.refresh.addEventListener("click", listInstances);
  elements.firstScan.addEventListener("click", () => runScan(false));
  elements.nextScan.addEventListener("click", () => runScan(true));
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

  restoreWatches();
  renderWatches();
  refreshInstanceSelect();
  updateConditionControls();
  connectPanel();
  setInterval(refreshWatchValues, WATCH_REFRESH_MS);
})();
