(() => {
  "use strict";

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const instances = new Map();
  const frozenCandidates = new Set();
  let activeTab = null;
  let port = null;
  let pollTimer = null;
  let requestSequence = 1;
  let quickSession = null;
  let selectedCandidate = null;

  const elements = {
    hostname: document.querySelector("#hostname"),
    statusDot: document.querySelector("#status-dot"),
    statusTitle: document.querySelector("#status-title"),
    statusDetail: document.querySelector("#status-detail"),
    connectionState: document.querySelector(".connection-state"),
    memorySummary: document.querySelector("#memory-summary"),
    memoryCount: document.querySelector("#memory-count"),
    memorySize: document.querySelector("#memory-size"),
    quickTools: document.querySelector("#quick-tools"),
    automaticBadge: document.querySelector("#automatic-badge"),
    condition: document.querySelector("#quick-condition"),
    value: document.querySelector("#quick-value"),
    valueLabel: document.querySelector("#quick-value-label"),
    valueText: document.querySelector("#quick-value-text"),
    maxValue: document.querySelector("#quick-max-value"),
    maxLabel: document.querySelector("#quick-max-label"),
    strategy: document.querySelector("#scan-strategy"),
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
    openInspector: document.querySelector("#open-inspector"),
    refreshConnection: document.querySelector("#refresh-connection"),
    howItWorks: document.querySelector("#how-it-works"),
  };

  function nextRequestId(action = "scan") {
    return `quick:${action}:${Date.now()}:${requestSequence++}`;
  }

  function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
    }
    return `${Math.max(0, Math.round(bytes / 1024))} KiB`;
  }

  function formatAddress(address) {
    return `0x${Number(address).toString(16).padStart(8, "0")}`;
  }

  function hostnameFor(tab) {
    try {
      return new URL(tab.url).hostname || "Browser page";
    } catch {
      return "Browser page";
    }
  }

  function candidateKey(candidate) {
    return `${candidate.frameId}:${candidate.instanceId}:${candidate.type}:${candidate.address}`;
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
  }

  function renderSummary(summary) {
    const detected = summary.instanceCount > 0;
    elements.statusDot.className = `status-dot ${
      detected ? "" : summary.connected ? "searching" : "offline"
    }`;
    elements.connectionState.classList.toggle("offline", !summary.connected);
    elements.openInspector.disabled = !activeTab?.id;
    elements.memorySummary.hidden = !detected;
    elements.quickTools.hidden = !detected;

    if (detected) {
      elements.statusTitle.textContent = summary.ruffleCount > 0
        ? "Ruffle memory detected"
        : "WebAssembly memory detected";
      elements.statusDetail.textContent = "Memory is available for inspection on this tab.";
      elements.memoryCount.textContent = `${summary.instanceCount} captured memor${
        summary.instanceCount === 1 ? "y" : "ies"
      }`;
      elements.memorySize.textContent = `${formatBytes(summary.totalMemoryBytes)} available`;
    } else if (summary.connected) {
      elements.statusTitle.textContent = "Connected to this tab";
      elements.statusDetail.textContent = "Waiting for an embedded WebAssembly memory to initialize.";
    } else {
      elements.statusTitle.textContent = "No connection yet";
      elements.statusDetail.textContent = "Reload this tab after installing or updating Hack Engine.";
    }
  }

  function renderStrategy() {
    const record = selectedInstance();
    const avmKind = record?.avmKind || "unknown";
    elements.automaticBadge.textContent = "Automatic";
    if (avmKind === "avm1") {
      elements.strategy.textContent = "ActionScript 1/2 detected; its common number format will be searched first.";
    } else if (avmKind === "avm2") {
      elements.strategy.textContent = "ActionScript 3 detected; its common number formats will be searched first.";
    } else {
      elements.strategy.textContent = "Runtime metadata is unavailable, so all number formats will be searched.";
    }
  }

  function updateConditionControls() {
    const condition = elements.condition.value;
    const needsValue = ["exact", "range", "increasedBy", "decreasedBy"].includes(condition);
    const needsMaximum = condition === "range";
    elements.value.disabled = !needsValue;
    elements.valueLabel.hidden = !needsValue;
    elements.maxLabel.hidden = !needsMaximum;
    elements.valueText.textContent = needsMaximum
      ? "Minimum"
      : ["increasedBy", "decreasedBy"].includes(condition)
        ? "Change amount"
        : "Value";
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
    updateConditionControls();
  }

  function selectCandidate(candidate, row) {
    selectedCandidate = candidate;
    for (const button of elements.candidates.querySelectorAll(".quick-candidate")) {
      button.classList.remove("selected");
    }
    row.classList.add("selected");
    elements.editor.hidden = false;
    elements.selectedAddress.textContent = formatAddress(candidate.address);
    elements.writeValue.value = String(candidate.displayValue ?? candidate.value);
    const frozen = frozenCandidates.has(candidateKey(candidate));
    elements.freeze.textContent = frozen ? "Unfreeze" : "Freeze";
    elements.freeze.classList.toggle("freeze-active", frozen);
  }

  function renderResults(payload, frameId = quickSession?.frameId) {
    const preview = Array.isArray(payload?.preview) ? payload.preview.slice(0, 20) : [];
    elements.results.hidden = false;
    elements.resultCount.textContent = Number(payload?.total || 0).toLocaleString();
    elements.candidates.replaceChildren();
    selectedCandidate = null;
    elements.editor.hidden = true;

    for (const candidate of preview) {
      const record = {
        ...candidate,
        frameId,
        instanceId: String(payload.instanceId),
        multiplier: Number(candidate.multiplier ?? payload.multiplier) || 1,
      };
      const row = document.createElement("button");
      row.type = "button";
      row.className = "quick-candidate";
      const address = document.createElement("span");
      address.className = "candidate-address";
      address.textContent = formatAddress(record.address);
      const value = document.createElement("span");
      value.className = "candidate-value";
      value.textContent = String(record.displayValue ?? record.value);
      row.append(address, value);
      row.addEventListener("click", () => selectCandidate(record, row));
      elements.candidates.append(row);
    }

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
        `${Number(payload.total).toLocaleString()} candidates remain; showing ${preview.length}.`,
        "ready",
      );
    }
  }

  function applyQuickSession(session) {
    quickSession = session || null;
    if (session?.request) {
      elements.condition.value = session.request.condition || "exact";
      elements.value.value = session.request.rawValue ?? elements.value.value;
      elements.maxValue.value = session.request.rawMaxValue ?? elements.maxValue.value;
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
      elements.results.hidden = true;
      elements.editor.hidden = true;
      setQuickStatus("Ready to scan this memory.");
    }
    updateScanControls();
  }

  function addInstances(frameId, url, list) {
    for (const instance of Array.isArray(list) ? list : []) {
      instances.set(`${frameId}:${instance.id}`, { ...instance, frameId, url });
    }
    renderStrategy();
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
    if (payload.kind === "scanProgress") {
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
        elements.freeze.textContent = payload.enabled ? "Unfreeze" : "Freeze";
        elements.freeze.classList.toggle("freeze-active", payload.enabled);
      }
      setQuickStatus(payload.enabled ? "Value frozen." : "Value unfrozen.", "ready");
    } else if (payload.kind === "error") {
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
      renderStrategy();
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
    const [tab] = await extensionApi.tabs.query({ active: true, currentWindow: true });
    activeTab = tab || null;
    elements.hostname.textContent = activeTab ? hostnameFor(activeTab) : "No active browser tab";
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
  }

  elements.condition.addEventListener("change", updateConditionControls);

  elements.scan.addEventListener("click", () => {
    const refine = Boolean(quickSession?.canRefine);
    const record = refine ? sessionInstance() : selectedInstance();
    if (!record) {
      setQuickStatus(
        refine ? "The memory used by this scan is no longer available. Reset and scan again." : "No WebAssembly memory is available.",
        "error",
      );
      return;
    }
    const condition = elements.condition.value;
    const needsValue = ["exact", "range", "increasedBy", "decreasedBy"].includes(condition);
    if (needsValue && elements.value.value.trim() === "") {
      setQuickStatus("Enter a value to scan for.", "error");
      return;
    }
    if (condition === "range" && elements.maxValue.value.trim() === "") {
      setQuickStatus("Enter the maximum value.", "error");
      return;
    }
    if (condition === "range" && Number(elements.value.value) > Number(elements.maxValue.value)) {
      setQuickStatus("The minimum cannot be greater than the maximum.", "error");
      return;
    }
    const requestId = nextRequestId("scan");
    const scanType = refine ? quickSession?.request?.type || "smart" : "smart";
    const request = {
      condition,
      rawValue: elements.value.value,
      rawMaxValue: elements.maxValue.value,
      multiplier: 1,
      alignment: "aligned",
      type: scanType,
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
    }
  });

  elements.cancel.addEventListener("click", () => {
    if (!quickSession?.requestId) {
      return;
    }
    send({
      kind: "cancelScan",
      requestId: nextRequestId("cancel"),
      targetRequestId: quickSession.requestId,
    }, quickSession.frameId);
  });

  elements.reset.addEventListener("click", () => {
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
  });

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

  elements.write.addEventListener("click", () => {
    if (!selectedCandidate || elements.writeValue.value.trim() === "") {
      setQuickStatus("Select a candidate and enter its new value.", "error");
      return;
    }
    send({
      kind: "writeValue",
      requestId: nextRequestId("write"),
      instanceId: selectedCandidate.instanceId,
      type: selectedCandidate.type,
      address: selectedCandidate.address,
      rawValue: elements.writeValue.value,
      multiplier: selectedCandidate.multiplier,
    }, selectedCandidate.frameId);
    setQuickStatus("Writing and checking the value…");
  });

  elements.freeze.addEventListener("click", () => {
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
      rawValue: elements.writeValue.value || selectedCandidate.displayValue,
      multiplier: selectedCandidate.multiplier,
      enabled,
    }, selectedCandidate.frameId);
  });

  elements.openInspector.addEventListener("click", async () => {
    if (!activeTab?.id) {
      return;
    }
    const url = new URL(extensionApi.runtime.getURL("devtools/panel/panel.html"));
    url.searchParams.set("standalone", "1");
    url.searchParams.set("tabId", String(activeTab.id));
    await extensionApi.tabs.create({ url: url.href });
    window.close();
  });

  elements.refreshConnection.addEventListener("click", async () => {
    if (!activeTab?.id) {
      return;
    }
    elements.statusTitle.textContent = "Reloading this tab…";
    elements.statusDetail.textContent = "Hack Engine will reconnect when the page initializes.";
    await extensionApi.tabs.reload(activeTab.id);
  });

  elements.howItWorks.addEventListener("click", async () => {
    await extensionApi.tabs.create({
      url: "https://abduljawada.github.io/hack-engine/#capabilities",
    });
    window.close();
  });

  window.addEventListener("unload", () => {
    clearInterval(pollTimer);
    port?.disconnect?.();
  });

  updateConditionControls();
  updateScanControls();
  initialize().catch(() => {
    elements.hostname.textContent = "Unable to read the active tab";
    renderSummary({ connected: false, instanceCount: 0, ruffleCount: 0, totalMemoryBytes: 0 });
  });
})();
