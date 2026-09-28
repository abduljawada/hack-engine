(async () => {
  const channel = "ruffle-memory-inspector:v1";
  const pending = new Map();
  const chunkSize = 1024 * 1024;
  let sequence = 0;
  let instanceId;
  let resolveCaptured;
  const captured = new Promise((resolve) => { resolveCaptured = resolve; });

  window.addEventListener("message", (event) => {
    if (
      event.source !== window || event.data?.channel !== channel ||
      event.data?.direction !== "from-page"
    ) return;
    const payload = event.data.payload;
    if (payload.kind === "instanceCaptured") {
      instanceId = payload.instance.id;
      resolveCaptured();
    }
    const request = pending.get(payload.requestId);
    if (!request || !["scanResults", "scanCancelled", "error"].includes(payload.kind)) return;
    pending.delete(payload.requestId);
    clearTimeout(request.timeout);
    if (payload.kind === "error") request.reject(new Error(payload.message));
    else request.resolve(payload);
  });

  function send(payload) {
    window.postMessage({ channel, direction: "to-page", payload }, "*");
  }

  function command(payload, requestId = `scheduling:${++sequence}`) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Timed out: ${payload.kind} ${payload.condition || ""}`));
      }, 30_000);
      pending.set(requestId, { resolve, reject, timeout });
      send({ instanceId, multiplier: 1, alignment: "aligned", ...payload, requestId });
    });
  }

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  function candidateSignature(result) {
    // Values are read live when previewing Undo, so compare candidate identities.
    return JSON.stringify({
      total: result.total,
      candidates: result.preview.map(({ type, address }) => `${type}:${address}`).sort(),
    });
  }

  async function cancelAtStoredChunk(type, chunkIndex, label) {
    const requestId = `scheduling:${++sequence}`;
    const originalPut = IDBObjectStore.prototype.put;
    let injected = false;
    IDBObjectStore.prototype.put = function (...args) {
      const request = originalPut.apply(this, args);
      const row = args[0];
      if (!injected && this.name === "chunks" && row?.chunkIndex === chunkIndex) {
        injected = true;
        // Queue a real page command while the final retained snapshot write is
        // pending. Cancellation must be delivered before results are committed,
        // even if every following chunk is empty or this is the physical end.
        send({ kind: "cancelScan", targetRequestId: requestId });
      }
      return request;
    };
    try {
      const result = await command({
        kind: "memoryScan", type, condition: "changed", refine: true,
      }, requestId);
      assert(injected, `${label}: snapshot write interception did not run`);
      assert(result.kind === "scanCancelled", `${label}: late cancellation committed results`);
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
  }

  const moduleBytes = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 5, 3, 1, 0, 1,
    7, 10, 1, 6, 109, 101, 109, 111, 114, 121, 2, 0,
  ]);
  const { instance } = await WebAssembly.instantiate(moduleBytes);
  await captured;
  const memory = instance.exports.memory;
  memory.grow(31); // Two 1 MiB chunks, enough to exercise both loop boundaries.
  const view = new DataView(memory.buffer);

  for (const type of ["f64", "auto"]) {
    for (const chunkIndex of [0, 1]) {
      const label = `${type}, ${chunkIndex === 0 ? "trailing empty chunk" : "final physical chunk"}`;
      const address = chunkIndex * chunkSize + 4096;
      new Uint8Array(memory.buffer).fill(0);
      const initial = await command({
        kind: "memoryScan", type, condition: "unknown", refine: false,
      });
      assert(initial.allCandidates && !initial.canUndo, `${label}: initial snapshot is incorrect`);

      view.setFloat64(address, 43, true);
      const narrowed = await command({
        kind: "memoryScan", type, condition: "changed", refine: true,
      });
      assert(narrowed.canUndo && narrowed.preview.some((candidate) => (
        candidate.type === "f64" && candidate.address === address
      )), `${label}: failed to establish a retained snapshot candidate`);
      assert(narrowed.total === narrowed.preview.length, `${label}: fixture unexpectedly exceeded preview size`);
      const originalCandidates = candidateSignature(narrowed);

      view.setFloat64(address, 86, true);
      await cancelAtStoredChunk(type, chunkIndex, label);

      // Undo immediately after cancellation must still point to the original
      // dense snapshot, rather than the narrowed or partially committed scan.
      const restored = await command({ kind: "undoScan", type });
      assert(restored.total === initial.total && restored.allCandidates && !restored.canUndo,
        `${label}: cancellation replaced the existing Undo checkpoint`);
      view.setFloat64(address, 43, true);
      const replayed = await command({
        kind: "memoryScan", type, condition: "changed", refine: true,
      });
      assert(candidateSignature(replayed) === originalCandidates,
        `${label}: Undo lost the original snapshot baseline`);

      // Repeat cancellation and retry the same comparison. A cancelled scan
      // must not advance the numeric baseline from 43 to 86.
      view.setFloat64(address, 86, true);
      await cancelAtStoredChunk(type, chunkIndex, label);
      const retried = await command({
        kind: "memoryScan", type, condition: "changed", refine: true,
      });
      assert(retried.preview.some((candidate) => (
        candidate.type === "f64" && candidate.address === address && candidate.value === 86
      )), `${label}: cancellation advanced or discarded the comparison baseline`);
      const prior = await command({ kind: "undoScan", type });
      assert(candidateSignature(prior) === originalCandidates,
        `${label}: retry did not preserve the narrowed candidates for Undo`);
    }
  }

  document.querySelector("#result").textContent =
    "PASS: late cancellation before trailing empty chunks and at the final physical chunk preserves snapshot baselines and Undo for Float64 and automatic scans.";
})().catch((error) => {
  document.querySelector("#result").textContent = `FAIL: ${error.message}`;
});
