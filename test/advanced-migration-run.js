(async () => {
  const result = document.querySelector("#harness-result");
  const wait = () => new Promise((resolve) => migrationNativeTimeout(resolve, 0));
  const settle = async () => { await wait(); await wait(); };
  const $ = (selector) => document.querySelector(selector);
  const assert = (condition, text) => { if (!condition) throw new Error(text); };
  const click = (selector) => { assert($(selector), `Missing ${selector}`); $(selector).click(); };
  const set = (selector, value, event = "input") => { $(selector).value = value; $(selector).dispatchEvent(new Event(event)); };
  const reads = () => popupHarnessState.commands.filter((command) => command.payload?.kind === "readValues");
  const showCandidates = () => popupHarnessState.emitPagePayload({ kind: "scanResults", requestId: "quick:migration", instanceId: "memory-1", type: "i32", multiplier: 1, total: 1000,
    preview: [{ address: 16, type: "i32", value: 5 }, { address: 32, type: "i32", value: 15 }, { address: 48, type: "i32", value: 10 }], allCandidates: false,
  });
  try {
    await settle();
    click('[data-view="advanced"]');
    click('[data-workspace="watches"]');
    assert(!$("#open-inspector"), "Legacy inspector launcher remains");
    assert(!$("#manual-address") && !$("#manual-add"), "Removed manual address controls remain");

    click('[data-workspace="candidates"]');
    showCandidates();
    await settle();
    assert($("#advanced-preview-count").textContent.includes("3"), "Preview size not shown separately");
    assert(!$("#candidate-select-mode") && !$("#batch-watch"), "Removed candidate batch controls remain");
    set("#advanced-filter", "missing");
    assert(document.querySelectorAll(".advanced-candidate").length === 0, "Candidate filter failed");
    set("#advanced-filter", "");
    for (const row of document.querySelectorAll(".advanced-candidate")) { row.click(); await settle(); }
    assert(migrationState.watches.length === 3, "Individual candidate selection did not add watches");
    for (const [view, prefix] of [["simple", "quick"], ["advanced", "advanced"]]) {
      click(`[data-view="${view}"]`);
      set(`#${prefix}-write-value`, "777");
      // Background diagnostics can arrive before the write acknowledgement.
      publishMigrationWorkspace();
      assert($(`#${prefix}-write-value`).value === "777", `${view}: workspace update replaced the edit draft`);
      click(`#${prefix}-write`);
      await settle();
      publishMigrationWorkspace();
      click(`#${prefix}-freeze`);
      const freeze = popupHarnessState.commands.filter((command) => command.payload?.kind === "setFreeze").at(-1);
      assert(freeze?.payload.enabled && freeze.payload.rawValue === "777", `${view}: Write then Freeze used an old value`);
      await settle();
      click(`#${prefix}-freeze`);
      await settle();
    }
    click('[data-workspace="watches"]');
    assert(!$("#watch-select-mode") && !$("[aria-label^='Group for']"), "Removed watch selection or groups remain");
    const labelInput = $("[aria-label^='Watch label']");
    labelInput.value = "Updated health"; labelInput.dispatchEvent(new Event("change"));
    await settle();
    assert(migrationState.watches[0].label === "Updated health", "Individual label edit was not saved");
    const key = migrationKey(migrationState.watches[0]);
    for (const [state, expected] of [["checking", "Checking"], ["verified", "250 ms"], ["restored", "Game restored"], ["rejected", "rejected"], ["unavailable", "Unavailable"]]) {
      migrationState.diagnostics = { [key]: { requestId: "quick:write-test", state, detail: `Timing detail ${state}` } };
      publishMigrationWorkspace();
      assert($(".watch-state")?.textContent.includes(expected), `Incorrect ${state} diagnostic status`);
      assert(document.body.textContent.includes(`Timing detail ${state}`), `Missing ${state} timing details`);
    }
    const detail = document.querySelector(`[data-watch-key="${key}"]`);
    detail.open = true;
    const draft = $("[aria-label^='Watch label']");
    draft.focus(); draft.value = "Unsaved draft";
    publishMigrationWorkspace();
    assert(document.querySelector(`[data-watch-key="${key}"]`).open, "Workspace refresh collapsed diagnostic details");
    assert(document.activeElement === $("[aria-label^='Watch label']") && document.activeElement.value === "Unsaved draft", "Workspace refresh lost focused metadata draft");
    document.activeElement.blur();
    migrationState.frozenKeys = [key];
    publishMigrationWorkspace();
    assert([...document.querySelectorAll(".watch-state")].some((node) => /frozen/i.test(node.textContent)), "Frozen watch status missing");
    migrationState.frozenKeys = [];
    migrationState.failReads = true;
    publishMigrationWorkspace();
    await settle();
    assert(!$(".watch-row .candidate-value") || /—|unavailable|\?/i.test($(".watch-row .candidate-value").textContent), "Failed read left stale live value");
    migrationState.failReads = false;
    migrationState.diagnostics = {};
    publishMigrationWorkspace();
    await settle();
    assert($(".watch-row .candidate-value").textContent !== "—", "Successful subsequent read did not recover value");
    assert($(".watch-state").textContent === "Live", "Read recovery retained unavailable status");
    migrationState.diagnostics = { [key]: { requestId: "quick:final", state: "verified", detail: "Complete 250 ms check" } };
    migrationState.selectedKey = key;
    publishMigrationWorkspace();
    click('[data-view="simple"]');
    assert($("#quick-editor .selected-feedback").textContent.includes("250 ms"), "Simple selected feedback missed final diagnostic");
    click('[data-view="advanced"]');
    const beforeDisconnectReads = reads().length;
    popupHarnessState.emitMessage({ kind: "frameDisconnected", frameId: 0 });
    assert($(".watch-row .candidate-value").textContent === "—" && $(".watch-state").textContent === "Unavailable", "Disconnected frame left a live watch value");
    publishMigrationWorkspace();
    await settle();
    assert(reads().length === beforeDisconnectReads, "Polling read from a disconnected frame");
    popupHarnessState.resetInstances();
    publishMigrationWorkspace();
    await settle();
    migrationState.watches = Array.from({ length: 256 }, (_, index) => ({ frameId: 0, instanceId: "memory-1", type: "i32", multiplier: 1, address: 1024 + index * 4, label: "" }));
    publishMigrationWorkspace();
    click('[data-workspace="candidates"]');
    showCandidates();
    await settle();
    click(".advanced-candidate");
    await settle();
    assert(migrationState.watches.length === 256, "Watch capacity exceeded");
    assert(/limit|256|skip|full/i.test($("#advanced-status").textContent), "Watch capacity failure lacks feedback");
    click('[data-workspace="watches"]');
    const scanning = { requestId: "quick:stalled", status: "scanning", frameId: 0, instanceId: "memory-1", canRefine: true, progress: null };
    popupHarnessState.emitMessage({ kind: "quickSession", session: scanning });
    assert(migrationState.stalledCallbacks.length > 0, "Missing 15-second stalled scan timer");
    const recoveryCount = () => popupHarnessState.commands.filter((command) => command.payload?.kind === "getSessionState").length;
    const beforeRecovery = recoveryCount();
    migrationState.stalledCallbacks.at(-1)();
    assert(/No recent progress/.test($("#advanced-status").textContent), "Stalled scan lacks progress feedback");
    assert(recoveryCount() === beforeRecovery + 1, "Stalled scan did not request authoritative state once");
    assert($("#advanced-scan").disabled && !$("#cancel-advanced-scan").hidden, "Watchdog unlocked scan or removed cancellation");
    const timerCount = migrationState.stalledCallbacks.length;
    popupHarnessState.emitMessage({ kind: "quickSession", session: { ...scanning } });
    popupHarnessState.emitPagePayload({ kind: "scanProgress", requestId: "quick:stalled", inspected: 10, total: 100 });
    assert(migrationState.stalledCallbacks.length === timerCount && recoveryCount() === beforeRecovery + 1, "Watchdog repeated recovery for same scan");
    popupHarnessState.emitPagePayload({ kind: "scanResults", requestId: "quick:stalled", instanceId: "memory-1", type: "i32", total: 1, preview: [{ address: 64, type: "i32", value: 8 }] });
    assert(!$("#advanced-scan").disabled && $("#cancel-advanced-scan").hidden, "Delayed legitimate scan completion did not recover");
    await new Promise((resolve, reject) => {
      const script = document.createElement("script"); script.src = "../workspace-controls.js";
      script.onload = resolve; script.onerror = reject; document.body.append(script);
    });
    await settle();
    assert(!$("[data-action='save']") && !$("[data-action='import']"), "Removed saved-workspace controls remain");
    assert($("[data-action='restore']") && $("[data-action='stop']"), "Session recovery controls missing");
    assert($("#quick-write").nextElementSibling.dataset.action === "restore" && $("#advanced-write").nextElementSibling.dataset.action === "restore", "Undo write is not beside Write");
    assert($(".workspace-heading [data-action='stop']"), "Stop freezes is not beside Watches");
    popupHarnessState.emitMessage({ kind: "workspaceState", workspace: { frozenKeys: [], lastWrite: null } });
    assert([...document.querySelectorAll("[data-action='restore'], [data-action='stop']")].every((button) => button.hidden), "Unavailable recovery actions remain visible");
    popupHarnessState.emitMessage({ kind: "quickSession", session: { ...scanning, status: "complete", request: { type: "i32" }, results: { canUndo: true } } });
    const undo = $("#advanced-tools [data-action='undo']");
    assert(!undo.hidden && !undo.disabled, "Undo unavailable after a recoverable scan");
    undo.click();
    assert(popupHarnessState.commands.at(-1).payload.kind === "undoScan", "Undo did not reach the game");
    popupHarnessState.emitMessage({ kind: "quickSession", session: null });
    assert(undo.hidden, "Undo remains visible after reset");
    popupHarnessState.emitMessage({ kind: "workspaceState", workspace: { frozenKeys: ["test"], lastWrite: { frameId: 0, instanceId: "memory-1", type: "i32", address: 64 } } });
    assert(!$("[data-action='restore']").hidden && !$("[data-action='stop']").hidden && !$("[data-action='restore']").disabled && $("[data-count]").textContent === "1", "Recovery state did not update");
    click('[data-action="restore"]');
    assert(popupHarnessState.commands.at(-1).payload.kind === "restoreWrite", "Restore did not reach the game");
    click('[data-action="stop"]');
    assert(popupHarnessState.commands.at(-1).payload.kind === "stopAllFreezes", "Stop freezes did not reach the game");
    result.textContent = "PASS: Advanced candidate selection, individual labels, diagnostics/read recovery, capacity, stalled recovery, and session controls work.";
  } catch (error) {
    result.textContent = `FAIL: ${error.stack || error}`;
  }
})();
