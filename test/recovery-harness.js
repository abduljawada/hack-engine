(async () => {
  const channel = "ruffle-memory-inspector:v1";
  const pending = new Map();
  let sequence = 0, memoryId, lastState;
  const captured = new Promise((resolve) => {
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.data?.direction !== "from-page" || event.data.channel !== channel) return;
      const payload = event.data.payload;
      if (payload.kind === "instanceCaptured") { memoryId = payload.instance.id; resolve(); }
      if (payload.kind === "agentState") lastState = payload;
      const request = pending.get(payload.requestId);
      if (request && (request.kind === payload.kind || payload.kind === "error" || payload.kind === "scanCancelled")) {
        pending.delete(payload.requestId); clearTimeout(request.timeout);
        payload.kind === "error" ? request.reject(new Error(payload.message)) : request.resolve(payload);
      }
    });
  });
  function command(payload, kind = "scanResults") {
    const requestId = `recovery:${++sequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out: ${payload.kind}`)), 15000);
      pending.set(requestId, { kind, resolve, reject, timeout });
      window.postMessage({ channel, direction: "to-page", payload: { instanceId: memoryId, type: "i32", multiplier: 1, alignment: "aligned", ...payload, requestId } }, "*");
    });
  }
  const assert = (test, message) => { if (!test) throw new Error(message); };
  const bytes = new Uint8Array([0,97,115,109,1,0,0,0,5,3,1,0,1,7,10,1,6,109,101,109,111,114,121,2,0]);
  const { instance } = await WebAssembly.instantiate(bytes); await captured;
  const view = new DataView(instance.exports.memory.buffer);
  view.setInt32(4096, 100, true); view.setInt32(8192, 100, true);
  let result = await command({ kind: "memoryScan", condition: "exact", rawValue: 100, refine: false });
  assert(result.total === 2 && !result.canUndo, "First scan baseline incorrect");
  view.setInt32(4096, 93, true);
  result = await command({ kind: "memoryScan", condition: "exact", rawValue: 93, refine: true });
  assert(result.total === 1 && result.canUndo, "Refinement did not create undo");
  result = await command({ kind: "undoScan" });
  assert(result.total === 2 && !result.canUndo, "Undo did not restore original candidates");
  result = await command({ kind: "memoryScan", condition: "decreased", refine: true });
  assert(result.total === 1 && result.preview[0].address === 4096, "Undo lost comparison baseline");
  await command({ kind: "writeValue", address: 4096, rawValue: 500 }, "writeComplete");
  await command({ kind: "restoreWrite", address: 4096 }, "writeRestored");
  assert(view.getInt32(4096, true) === 93, "Restore did not restore bytes");
  await command({ kind: "writeValue", address: 4096, rawValue: 500 }, "writeComplete");
  view.setInt32(4096, 499, true);
  let conflict = false;
  try { await command({ kind: "restoreWrite", address: 4096 }, "writeRestored"); } catch { conflict = true; }
  assert(conflict && view.getInt32(4096, true) === 499, "Restore overwrote a game change");
  await command({ kind: "setFreeze", address: 4096, rawValue: 200, enabled: true }, "freezeChanged");
  await command({ kind: "stopAllFreezes" }, "freezeChanged");
  view.setInt32(4096, 50, true);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert(view.getInt32(4096, true) === 50 && lastState.freezes.length === 0, "Stop all did not stop writes");
  await command({ kind: "memoryScan", condition: "unknown", refine: false });
  const iframe = document.createElement("iframe");
  iframe.src = "snapshot-peer.html";
  document.body.append(iframe);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Peer scan did not complete")), 10000);
    window.addEventListener("message", function listener(event) {
      if (event.source !== iframe.contentWindow || !event.data?.snapshotPeer) return;
      clearTimeout(timeout); window.removeEventListener("message", listener);
      event.data.error ? reject(new Error(event.data.error)) : resolve();
    });
  });
  view.setInt32(4096, 51, true);
  result = await command({ kind: "memoryScan", condition: "changed", refine: true });
  assert(result.total === 1, "Another same-origin frame damaged the snapshot");
  await command({ kind: "undoScan" });
  result = await command({ kind: "memoryScan", condition: "changed", refine: true });
  assert(result.total === 1, "Snapshot undo lost its baseline");
  instance.exports.memory.grow(127);
  await command({ kind: "memoryScan", condition: "unknown", refine: false });
  const grown = new DataView(instance.exports.memory.buffer);
  grown.setInt32(4096, 52, true);
  const cancellingId = `recovery:${sequence + 1}`;
  const cancelOnProgress = (event) => {
    const payload = event.data?.payload;
    if (event.source === window && event.data?.direction === "from-page" && payload?.kind === "scanProgress" && payload.requestId === cancellingId) {
      window.removeEventListener("message", cancelOnProgress);
      window.postMessage({ channel, direction: "to-page", payload: { kind: "cancelScan", requestId: "cancel-refinement", targetRequestId: cancellingId } }, "*");
    }
  };
  window.addEventListener("message", cancelOnProgress);
  const cancelled = await command({ kind: "memoryScan", condition: "changed", refine: true });
  assert(cancelled.kind === "scanCancelled", "Refinement was not cancelled");
  result = await command({ kind: "memoryScan", condition: "changed", refine: true });
  assert(result.total === 1 && result.preview[0].address === 4096, "Cancellation lost the completed baseline");
  document.querySelector("#result").textContent = "PASS: undo restores numeric and snapshot baselines; write restoration detects conflicts; stop-all halts writes; same-origin snapshots remain isolated; cancelled refinements retain their baseline.";
})().catch((error) => { document.querySelector("#result").textContent = `FAIL: ${error.message}`; });
