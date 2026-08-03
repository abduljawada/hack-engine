(() => {
  "use strict";

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const tabId = extensionApi.devtools.inspectedWindow.tabId;
  const instances = new Map();
  const candidateValueCells = new Map();
  const frozenAddresses = new Set();
  let requestSequence = 1;
  let selectedCandidateRow = null;
  let selectedAddress = null;
  let port = null;
  let reconnectTimer = null;
  let scanWatchdog = null;

  const elements = {
    instance: document.querySelector("#instance"),
    type: document.querySelector("#type"),
    alignment: document.querySelector("#alignment"),
    condition: document.querySelector("#condition"),
    scanValue: document.querySelector("#scan-value"),
    scanValueLabel: document.querySelector("#scan-value-label"),
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
    freeze: document.querySelector("#freeze"),
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

  function updateFreezeButton() {
    const record = selectedInstance();
    const active = Boolean(
      record &&
      selectedAddress !== null &&
      frozenAddresses.has(freezeIdentity(record, elements.type.value, selectedAddress)),
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

  function armScanWatchdog() {
    clearScanWatchdog();
    scanWatchdog = setTimeout(() => {
      setScanButtonsDisabled(false);
      setStatus(
        "The scan did not answer within 15 seconds. Reload the page and reopen DevTools if the extension was reloaded.",
        "error",
      );
    }, 15_000);
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
    elements.freeze.disabled = !available;
    if (available) {
      setStatus(`${instances.size} WebAssembly memor${instances.size === 1 ? "y" : "ies"} captured.`, "ready");
    }
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
    if (condition === "exact" && rawValue.trim() === "") {
      setStatus("Enter a value to scan for.", "error");
      return;
    }
    if (!refine && !["exact", "unknown"].includes(condition)) {
      setStatus("A first scan must use Exact value or Unknown initial value.", "error");
      return;
    }
    if (refine && condition === "unknown") {
      setStatus("Unknown initial value is only available for a first scan.", "error");
      return;
    }
    const sent = send({
      kind: "memoryScan",
      requestId: requestId(),
      instanceId: record.id,
      type: elements.type.value,
      rawValue,
      condition,
      alignment: elements.alignment.value,
      refine,
    }, record.frameId);
    if (!sent) {
      return;
    }
    setScanButtonsDisabled(true);
    setStatus(
      condition === "unknown"
        ? "Capturing an initial memory snapshot…"
        : refine && condition !== "exact"
          ? `Filtering candidates whose values ${condition}…`
          : refine
            ? "Filtering existing candidates…"
            : "Scanning WASM memory…",
    );
    armScanWatchdog();
  }

  function updateConditionControls() {
    const needsValue = elements.condition.value === "exact";
    elements.scanValue.disabled = !needsValue;
    elements.scanValueLabel.classList.toggle("disabled-label", !needsValue);
  }

  function renderCandidates(payload) {
    elements.candidates.replaceChildren();
    candidateValueCells.clear();
    selectedCandidateRow = null;
    selectedAddress = null;
    updateFreezeButton();
    for (const candidate of payload.preview) {
      const row = document.createElement("tr");
      const address = document.createElement("td");
      const value = document.createElement("td");
      address.textContent = `0x${candidate.address.toString(16).padStart(8, "0")}`;
      value.textContent = String(candidate.value);
      candidateValueCells.set(candidate.address, value);
      row.append(address, value);
      row.addEventListener("click", () => {
        selectedCandidateRow?.classList.remove("selected");
        selectedCandidateRow = row;
        selectedAddress = candidate.address;
        row.classList.add("selected");
        elements.writeAddress.value = address.textContent;
        elements.writeValue.value = String(candidate.value);
        updateFreezeButton();
      });
      elements.candidates.append(row);
    }

    elements.resultCount.textContent = payload.total.toLocaleString();
    clearScanWatchdog();
    setScanButtonsDisabled(false);
    setStatus(
      payload.total === 0
        ? "No matching values found. Reset before starting a new scan."
        : `${payload.total.toLocaleString()} candidates remain; showing up to ${payload.preview.length}.`,
      "ready",
    );
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
        armScanWatchdog();
        setStatus(`Scanning… ${payload.inspected.toLocaleString()} / ${payload.total.toLocaleString()}`);
        break;
      case "scanResults":
        renderCandidates(payload);
        break;
      case "writeComplete":
        elements.writeValue.value = String(payload.value);
        if (candidateValueCells.has(payload.address)) {
          candidateValueCells.get(payload.address).textContent = String(payload.value);
        }
        setStatus(`Wrote ${payload.value} at 0x${payload.address.toString(16)}.`, "ready");
        break;
      case "writeVerified":
        if (candidateValueCells.has(payload.address)) {
          candidateValueCells.get(payload.address).textContent = String(payload.actualValue);
        }
        setStatus(
          payload.persisted
            ? `Write persisted at 0x${payload.address.toString(16)}.`
            : `The game restored this address to ${payload.actualValue}. Freeze it or continue narrowing candidates.`,
          payload.persisted ? "ready" : "error",
        );
        break;
      case "freezeChanged": {
        const record = selectedInstance();
        if (record) {
          const key = freezeIdentity(record, payload.type, payload.address);
          if (payload.enabled) {
            frozenAddresses.add(key);
            if (candidateValueCells.has(payload.address)) {
              candidateValueCells.get(payload.address).textContent = String(payload.value);
            }
            setStatus(`Freezing ${payload.value} at 0x${payload.address.toString(16)}.`, "ready");
          } else {
            frozenAddresses.delete(key);
            setStatus(`Unfroze 0x${payload.address.toString(16)}.`, "ready");
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
        clearScanWatchdog();
        setScanButtonsDisabled(false);
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
    const rawAddress = elements.writeAddress.value.trim();
    const address = rawAddress.toLowerCase().startsWith("0x")
      ? Number.parseInt(rawAddress.slice(2), 16)
      : Number.parseInt(rawAddress, 10);
    send({
      kind: "writeValue",
      requestId: requestId(),
      instanceId: record.id,
      type: elements.type.value,
      address,
      rawValue: elements.writeValue.value,
    }, record.frameId);
  });
  elements.freeze.addEventListener("click", () => {
    const record = selectedInstance();
    if (!record || selectedAddress === null) {
      setStatus("Select a candidate before freezing it.", "error");
      return;
    }
    const key = freezeIdentity(record, elements.type.value, selectedAddress);
    const enabled = !frozenAddresses.has(key);
    send({
      kind: "setFreeze",
      requestId: requestId(),
      instanceId: record.id,
      type: elements.type.value,
      address: selectedAddress,
      rawValue: elements.writeValue.value,
      enabled,
    }, record.frameId);
  });
  elements.instance.addEventListener("change", updateFreezeButton);
  elements.type.addEventListener("change", updateFreezeButton);
  elements.condition.addEventListener("change", updateConditionControls);

  refreshInstanceSelect();
  updateConditionControls();
  connectPanel();
})();
