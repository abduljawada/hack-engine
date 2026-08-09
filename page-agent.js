(() => {
  "use strict";

  const CHANNEL = "ruffle-memory-inspector:v1";
  const RESULT_PREVIEW_LIMIT = 200;
  const SCAN_CHUNK_SIZE = 100_000;
  const SNAPSHOT_CHUNK_SIZE = 1024 * 1024;
  const MAX_WATCH_VALUES = 256;
  const SNAPSHOT_DB_NAME = "ruffle-memory-inspector-snapshots-v1";
  const SNAPSHOT_STORE_NAME = "chunks";

  if (window.__ruffleMemoryInspectorV1) {
    return;
  }

  const instances = new Map();
  const scans = new Map();
  const freezes = new Map();
  const activeWriteDiagnostics = new Map();
  let nextInstanceId = 1;
  let nextSnapshotId = 1;
  let freezeFrameHandle = null;
  let snapshotDatabasePromise = null;

  const typeSpecs = {
    i32: {
      size: 4,
      read: (view, offset) => view.getInt32(offset, true),
      write: (view, offset, value) => view.setInt32(offset, value, true),
    },
    u32: {
      size: 4,
      read: (view, offset) => view.getUint32(offset, true),
      write: (view, offset, value) => view.setUint32(offset, value, true),
    },
    f32: {
      size: 4,
      read: (view, offset) => view.getFloat32(offset, true),
      write: (view, offset, value) => view.setFloat32(offset, value, true),
    },
    f64: {
      size: 8,
      read: (view, offset) => view.getFloat64(offset, true),
      write: (view, offset, value) => view.setFloat64(offset, value, true),
    },
  };

  function send(payload) {
    window.postMessage({ channel: CHANNEL, direction: "from-page", payload }, "*");
  }

  function describeInstance(record) {
    return {
      id: record.id,
      url: location.href,
      hint: record.hint,
      memoryBytes: record.memory.buffer.byteLength,
      exportNames: record.exportNames,
      looksLikeRuffle: record.looksLikeRuffle,
    };
  }

  function detectRuffle(hint, exportNames) {
    const text = `${hint || ""} ${exportNames.join(" ")}`;
    return /ruffle/i.test(text) || Boolean(document.querySelector("ruffle-player"));
  }

  function collectImportedMemories(imports) {
    const memories = [];
    if (!imports || typeof imports !== "object") {
      return memories;
    }

    for (const namespace of Object.values(imports)) {
      if (!namespace || typeof namespace !== "object") {
        continue;
      }
      for (const value of Object.values(namespace)) {
        if (value instanceof WebAssembly.Memory) {
          memories.push(value);
        }
      }
    }
    return memories;
  }

  function captureInstance(instance, imports, hint = "") {
    if (!(instance instanceof WebAssembly.Instance)) {
      return;
    }

    const exportEntries = Object.entries(instance.exports);
    const exportNames = exportEntries.map(([name]) => name);
    const exportedMemories = exportEntries
      .map(([, value]) => value)
      .filter((value) => value instanceof WebAssembly.Memory);
    const memories = [...new Set([...exportedMemories, ...collectImportedMemories(imports)])];

    for (const memory of memories) {
      const duplicate = [...instances.values()].find(
        (record) => record.instance === instance && record.memory === memory,
      );
      if (duplicate) {
        continue;
      }

      const id = String(nextInstanceId++);
      const record = {
        id,
        instance,
        memory,
        hint,
        exportNames: exportNames.slice(0, 40),
        looksLikeRuffle: detectRuffle(hint, exportNames),
      };
      instances.set(id, record);
      send({ kind: "instanceCaptured", instance: describeInstance(record) });
    }
  }

  function extractInstance(result) {
    if (result instanceof WebAssembly.Instance) {
      return result;
    }
    return result?.instance instanceof WebAssembly.Instance ? result.instance : null;
  }

  function responseHint(value) {
    if (value instanceof Response) {
      return value.url;
    }
    if (typeof value === "string" || value instanceof URL) {
      return String(value);
    }
    return "";
  }

  const originalInstantiate = WebAssembly.instantiate.bind(WebAssembly);
  WebAssembly.instantiate = async function instrumentedInstantiate(source, imports) {
    const result = await originalInstantiate(source, imports);
    captureInstance(extractInstance(result), imports, responseHint(source));
    return result;
  };

  if (typeof WebAssembly.instantiateStreaming === "function") {
    const originalInstantiateStreaming = WebAssembly.instantiateStreaming.bind(WebAssembly);
    WebAssembly.instantiateStreaming = async function instrumentedInstantiateStreaming(
      source,
      imports,
    ) {
      const result = await originalInstantiateStreaming(source, imports);
      let resolvedSource = source;
      try {
        resolvedSource = await Promise.resolve(source);
      } catch {
        // The successful instantiation is more important than a missing URL hint.
      }
      captureInstance(extractInstance(result), imports, responseHint(resolvedSource));
      return result;
    };
  }

  function parseValue(type, rawValue) {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      throw new Error("Value must be a finite number.");
    }
    if ((type === "i32" || type === "u32") && !Number.isInteger(value)) {
      throw new Error(`${type} values must be integers.`);
    }
    if (type === "i32" && (value < -2147483648 || value > 2147483647)) {
      throw new Error("i32 value is outside the signed 32-bit range.");
    }
    if (type === "u32" && (value < 0 || value > 4294967295)) {
      throw new Error("u32 value is outside the unsigned 32-bit range.");
    }
    return value;
  }

  function scanKey(instanceId, type) {
    return `${instanceId}:${type}`;
  }

  async function clearInstanceScans(instanceId) {
    const prefix = `${instanceId}:`;
    const cleanup = [];
    for (const key of scans.keys()) {
      if (key.startsWith(prefix)) {
        cleanup.push(deleteSnapshot(scans.get(key)?.snapshot));
        scans.delete(key);
      }
    }
    await Promise.allSettled(cleanup);
  }

  function freezeKey(instanceId, type, address) {
    return `${instanceId}:${type}:${address}`;
  }

  function yieldToPage() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function createCandidateSet(slotCount, type, stride) {
    return {
      bits: new Uint8Array(Math.ceil(slotCount / 8)),
      allCandidates: false,
      count: 0,
      preview: [],
      slotCount,
      stride,
      type,
      snapshot: null,
    };
  }

  function createAllCandidateSet(slotCount, type, stride, snapshot) {
    return {
      bits: null,
      allCandidates: true,
      count: slotCount,
      // Every address is a candidate until the first refinement. Rendering an
      // arbitrary prefix is not actionable and needlessly crosses realms.
      preview: [],
      slotCount,
      stride,
      type,
      snapshot,
    };
  }

  function retainCandidate(candidateSet, slotIndex, address) {
    candidateSet.bits[slotIndex >>> 3] |= 1 << (slotIndex & 7);
    candidateSet.count += 1;
    if (candidateSet.preview.length < RESULT_PREVIEW_LIMIT) {
      candidateSet.preview.push(address);
    }
  }

  function scanStride(spec, alignment) {
    if (alignment === "byte") {
      return 1;
    }
    if (alignment === "aligned" || alignment === undefined) {
      return spec.size;
    }
    throw new Error(`Unsupported scan alignment: ${alignment}`);
  }

  function slotCountFor(byteLength, spec, stride) {
    if (byteLength < spec.size) {
      return 0;
    }
    return Math.floor((byteLength - spec.size) / stride) + 1;
  }

  async function compressSnapshotBytes(bytes) {
    if (
      typeof CompressionStream !== "function" ||
      typeof DecompressionStream !== "function"
    ) {
      throw new Error("This browser does not support compressed unknown-value snapshots.");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function decompressSnapshotChunk(chunk) {
    const stream = new Blob([chunk.data])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function openSnapshotDatabase() {
    if (snapshotDatabasePromise) {
      return snapshotDatabasePromise;
    }
    if (typeof indexedDB === "undefined") {
      throw new Error("This page does not provide snapshot storage.");
    }
    snapshotDatabasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(SNAPSHOT_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(SNAPSHOT_STORE_NAME)) {
          database.createObjectStore(SNAPSHOT_STORE_NAME, {
            keyPath: ["snapshotId", "chunkIndex"],
          });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(SNAPSHOT_STORE_NAME, "readwrite");
        transaction.objectStore(SNAPSHOT_STORE_NAME).clear();
        transaction.oncomplete = () => resolve(database);
        transaction.onerror = () => reject(
          transaction.error || new Error("Unable to initialize snapshot storage."),
        );
        transaction.onabort = transaction.onerror;
      };
      request.onerror = () => reject(request.error || new Error("Unable to open snapshot storage."));
      request.onblocked = () => reject(new Error("Snapshot storage is blocked by another page."));
    });
    snapshotDatabasePromise.catch(() => {
      snapshotDatabasePromise = null;
    });
    return snapshotDatabasePromise;
  }

  function runSnapshotTransaction(mode, operation) {
    return openSnapshotDatabase().then((database) => new Promise((resolve, reject) => {
      const transaction = database.transaction(SNAPSHOT_STORE_NAME, mode);
      const store = transaction.objectStore(SNAPSHOT_STORE_NAME);
      let result;
      try {
        result = operation(store);
      } catch (error) {
        transaction.abort();
        reject(error);
        return;
      }
      transaction.oncomplete = () => resolve(result?.result);
      transaction.onerror = () => reject(
        transaction.error || new Error("Snapshot storage transaction failed."),
      );
      transaction.onabort = () => reject(
        transaction.error || new Error("Snapshot storage transaction was aborted."),
      );
    }));
  }

  async function storeSnapshotChunk(snapshot, chunkIndex, data, metadata) {
    try {
      await runSnapshotTransaction("readwrite", (store) => store.put({
        snapshotId: snapshot.id,
        chunkIndex,
        data,
      }));
    } catch (error) {
      throw new Error(
        `Unable to store the unknown-value snapshot: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    snapshot.chunks[chunkIndex] = metadata;
    snapshot.compressedBytes += data.byteLength;
  }

  async function loadSnapshotChunk(snapshot, chunkIndex) {
    const row = await runSnapshotTransaction(
      "readonly",
      (store) => store.get([snapshot.id, chunkIndex]),
    );
    if (!row?.data) {
      throw new Error(`Snapshot chunk ${chunkIndex} is missing.`);
    }
    const data = row.data instanceof Uint8Array ? row.data : new Uint8Array(row.data);
    return decompressSnapshotChunk({ data });
  }

  async function deleteSnapshot(snapshot) {
    if (!snapshot?.id) {
      return;
    }
    const range = IDBKeyRange.bound(
      [snapshot.id, 0],
      [snapshot.id, Number.MAX_SAFE_INTEGER],
    );
    await runSnapshotTransaction("readwrite", (store) => store.delete(range));
  }

  function createSnapshot(byteLength) {
    return {
      id: typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `${Date.now().toString(36)}-${nextSnapshotId++}-${Math.random().toString(36).slice(2)}`,
      byteLength,
      chunkSize: SNAPSHOT_CHUNK_SIZE,
      chunks: [],
      compressedBytes: 0,
    };
  }

  async function captureSnapshot(record, requestId, byteLength, spec) {
    const snapshot = createSnapshot(byteLength);
    try {
      for (let offset = 0; offset < byteLength; offset += SNAPSHOT_CHUNK_SIZE) {
        const chunkIndex = Math.floor(offset / SNAPSHOT_CHUNK_SIZE);
        const uniqueLength = Math.min(SNAPSHOT_CHUNK_SIZE, byteLength - offset);
        const byteLengthWithOverlap = Math.min(
          uniqueLength + spec.size - 1,
          byteLength - offset,
        );
        const bytes = new Uint8Array(
          record.memory.buffer,
          offset,
          byteLengthWithOverlap,
        ).slice();
        const data = await compressSnapshotBytes(bytes);
        await storeSnapshotChunk(snapshot, chunkIndex, data, {
          byteLength: byteLengthWithOverlap,
          uniqueLength,
        });
        send({
          kind: "scanProgress",
          requestId,
          inspected: offset + uniqueLength,
          total: byteLength,
          snapshotBytes: snapshot.compressedBytes,
        });
      }
    } catch (error) {
      await deleteSnapshot(snapshot).catch(() => {});
      throw error;
    }
    return snapshot;
  }

  function comparisonMatches(condition, currentValue, previousValue) {
    switch (condition) {
      case "changed":
        return !Object.is(currentValue, previousValue);
      case "unchanged":
        return Object.is(currentValue, previousValue);
      case "increased":
        return currentValue > previousValue;
      case "decreased":
        return currentValue < previousValue;
      default:
        throw new Error(`Unsupported comparison condition: ${condition}`);
    }
  }

  function scanValueMatcher(type, condition, rawValue, rawMaxValue) {
    const minimum = parseValue(type, rawValue);
    if (condition === "exact") {
      return (value) => value === minimum;
    }
    if (condition !== "range") {
      throw new Error(`Unsupported value condition: ${condition}`);
    }
    const maximum = parseValue(type, rawMaxValue);
    if (minimum > maximum) {
      throw new Error("Range minimum cannot be greater than maximum.");
    }
    return (value) => value >= minimum && value <= maximum;
  }

  async function firstValueScan({
    requestId,
    record,
    type,
    spec,
    rawValue,
    rawMaxValue,
    condition,
    stride,
  }) {
    const matches = scanValueMatcher(type, condition, rawValue, rawMaxValue);
    let view = new DataView(record.memory.buffer);
    const slotCount = slotCountFor(view.byteLength, spec, stride);
    const candidates = createCandidateSet(slotCount, type, stride);

    for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
      const offset = slotIndex * stride;
      if (matches(spec.read(view, offset))) {
        retainCandidate(candidates, slotIndex, offset);
      }

      const inspected = slotIndex + 1;
      if (inspected % SCAN_CHUNK_SIZE === 0) {
        send({ kind: "scanProgress", requestId, inspected, total: slotCount });
        await yieldToPage();
        view = new DataView(record.memory.buffer);
      }
    }

    return candidates;
  }

  async function firstUnknownScan({ requestId, record, type, spec, stride }) {
    const byteLength = record.memory.buffer.byteLength;
    const snapshot = await captureSnapshot(record, requestId, byteLength, spec);
    const slotCount = slotCountFor(byteLength, spec, stride);
    return createAllCandidateSet(slotCount, type, stride, snapshot);
  }

  function candidateIsRetained(candidateSet, slotIndex) {
    return candidateSet.allCandidates || Boolean(
      candidateSet.bits?.[slotIndex >>> 3] & (1 << (slotIndex & 7)),
    );
  }

  function candidateRangeHasMatches(candidateSet, startSlot, endSlot) {
    if (candidateSet.allCandidates) {
      return startSlot < endSlot;
    }
    const startByte = startSlot >>> 3;
    const endByte = Math.ceil(endSlot / 8);
    for (let byteIndex = startByte; byteIndex < endByte; byteIndex += 1) {
      if (candidateSet.bits[byteIndex]) {
        return true;
      }
    }
    return false;
  }

  async function refineLiveValue({
    requestId,
    record,
    type,
    spec,
    rawValue,
    rawMaxValue,
    condition,
    stride,
    previous,
    slotCount,
  }) {
    const candidates = createCandidateSet(slotCount, type, stride);
    const matches = scanValueMatcher(type, condition, rawValue, rawMaxValue);
    let view = new DataView(record.memory.buffer);
    const bytesPerChunk = Math.max(1, Math.floor(SCAN_CHUNK_SIZE / 8));

    for (let byteIndex = 0; byteIndex < previous.bits.length; byteIndex += 1) {
      const candidateByte = previous.bits[byteIndex];
      if (candidateByte) {
        for (let bitIndex = 0; bitIndex < 8; bitIndex += 1) {
          if (!(candidateByte & (1 << bitIndex))) {
            continue;
          }
          const slotIndex = byteIndex * 8 + bitIndex;
          if (slotIndex >= slotCount) {
            break;
          }
          const offset = slotIndex * stride;
          if (matches(spec.read(view, offset))) {
            retainCandidate(candidates, slotIndex, offset);
          }
        }
      }

      if ((byteIndex + 1) % bytesPerChunk === 0) {
        const inspected = Math.min((byteIndex + 1) * 8, slotCount);
        send({ kind: "scanProgress", requestId, inspected, total: slotCount });
        await yieldToPage();
        view = new DataView(record.memory.buffer);
      }
    }
    return candidates;
  }

  async function refineSnapshotScan({
    requestId,
    record,
    type,
    spec,
    rawValue,
    rawMaxValue,
    condition,
    stride,
    previous,
    slotCount,
    currentByteLength,
  }) {
    const candidates = createCandidateSet(slotCount, type, stride);
    const currentSnapshot = createSnapshot(currentByteLength);
    currentSnapshot.chunks = new Array(previous.snapshot.chunks.length).fill(null);
    const valueCondition = condition === "exact" || condition === "range";
    const matchesValue = valueCondition
      ? scanValueMatcher(type, condition, rawValue, rawMaxValue)
      : null;

    try {
      for (
        let chunkIndex = 0;
        chunkIndex < previous.snapshot.chunks.length;
        chunkIndex += 1
      ) {
        const previousChunk = previous.snapshot.chunks[chunkIndex];
        const chunkOffset = chunkIndex * previous.snapshot.chunkSize;
        const uniqueLength = Math.min(
          previous.snapshot.chunkSize,
          currentByteLength - chunkOffset,
        );
        if (!previousChunk || uniqueLength <= 0) {
          continue;
        }

        const startSlot = Math.ceil(chunkOffset / stride);
        const endSlot = Math.min(
          slotCount,
          Math.ceil((chunkOffset + uniqueLength) / stride),
        );
        if (!candidateRangeHasMatches(previous, startSlot, endSlot)) {
          send({ kind: "scanProgress", requestId, inspected: endSlot, total: slotCount });
          continue;
        }

        const currentReadLength = Math.min(
          uniqueLength + spec.size - 1,
          currentByteLength - chunkOffset,
        );
        const currentBytes = new Uint8Array(
          record.memory.buffer,
          chunkOffset,
          currentReadLength,
        ).slice();
        const previousBytes = await loadSnapshotChunk(previous.snapshot, chunkIndex);
        const currentView = new DataView(
          currentBytes.buffer,
          currentBytes.byteOffset,
          currentBytes.byteLength,
        );
        const previousView = new DataView(
          previousBytes.buffer,
          previousBytes.byteOffset,
          previousBytes.byteLength,
        );
        let chunkRetained = false;

        for (let slotIndex = startSlot; slotIndex < endSlot; slotIndex += 1) {
          if (!candidateIsRetained(previous, slotIndex)) {
            continue;
          }
          const address = slotIndex * stride;
          const localOffset = address - chunkOffset;
          const currentValue = spec.read(currentView, localOffset);
          const matches = valueCondition
            ? matchesValue(currentValue)
            : comparisonMatches(condition, currentValue, spec.read(previousView, localOffset));
          if (matches) {
            retainCandidate(candidates, slotIndex, address);
            chunkRetained = true;
          }
        }

        if (chunkRetained) {
          const data = await compressSnapshotBytes(currentBytes);
          await storeSnapshotChunk(currentSnapshot, chunkIndex, data, {
            byteLength: currentReadLength,
            uniqueLength,
          });
        }
        send({
          kind: "scanProgress",
          requestId,
          inspected: endSlot,
          total: slotCount,
          snapshotBytes: currentSnapshot.compressedBytes,
        });
      }
    } catch (error) {
      await deleteSnapshot(currentSnapshot).catch(() => {});
      throw error;
    }

    candidates.snapshot = currentSnapshot;
    return candidates;
  }

  async function refineScan({
    requestId,
    record,
    type,
    spec,
    rawValue,
    rawMaxValue,
    condition,
    stride,
    previous,
  }) {
    if (previous.stride !== stride) {
      throw new Error("Scan alignment changed. Reset before starting a new scan.");
    }
    if (!["exact", "range"].includes(condition) && !previous.snapshot) {
      throw new Error("Start with an unknown-value scan before using comparison filters.");
    }

    const currentByteLength = Math.min(
      record.memory.buffer.byteLength,
      previous.snapshot?.byteLength ?? record.memory.buffer.byteLength,
    );
    const currentSlotCount = slotCountFor(currentByteLength, spec, stride);
    const slotCount = Math.min(previous.slotCount, currentSlotCount);
    if (!previous.snapshot) {
      return refineLiveValue({
        requestId,
        record,
        type,
        spec,
        rawValue,
        rawMaxValue,
        condition,
        stride,
        previous,
        slotCount,
      });
    }
    return refineSnapshotScan({
      requestId,
      record,
      type,
      spec,
      rawValue,
      rawMaxValue,
      condition,
      stride,
      previous,
      slotCount,
      currentByteLength,
    });
  }

  async function memoryScan({
    requestId,
    instanceId,
    type,
    rawValue,
    rawMaxValue,
    condition = "exact",
    alignment = "aligned",
    refine,
  }) {
    const record = instances.get(String(instanceId));
    const spec = typeSpecs[type];
    if (!record) {
      throw new Error("The selected WASM instance no longer exists.");
    }
    if (!spec) {
      throw new Error(`Unsupported value type: ${type}`);
    }

    const key = scanKey(record.id, type);
    const previous = refine ? scans.get(key) : null;
    const stride = scanStride(spec, alignment);

    if (refine && !previous) {
      throw new Error("No previous scan exists. Run a first scan before filtering.");
    }
    if (!refine && !["exact", "range", "unknown"].includes(condition)) {
      throw new Error("First scans support exact, range, or unknown initial values.");
    }
    if (refine && condition === "unknown") {
      throw new Error("Unknown initial value is only available for a first scan.");
    }

    if (!refine) {
      // A memory snapshot can be hundreds of MiB. Drop every older session for
      // this WASM memory before allocating a replacement so stale snapshots do
      // not double the peak memory usage or trigger a long final GC pause.
      await clearInstanceScans(record.id);
      await yieldToPage();
    }

    const candidates = refine
      ? await refineScan({
        requestId,
        record,
        type,
        spec,
        rawValue,
        rawMaxValue,
        condition,
        stride,
        previous,
      })
      : condition === "unknown"
        ? await firstUnknownScan({ requestId, record, type, spec, stride })
        : await firstValueScan({
          requestId,
          record,
          type,
          spec,
          rawValue,
          rawMaxValue,
          condition,
          stride,
        });

    scans.set(key, candidates);
    if (previous?.snapshot && previous.snapshot !== candidates.snapshot) {
      deleteSnapshot(previous.snapshot).catch(() => {});
    }
    sendScanResults(requestId, record, type, candidates);
  }

  function sendScanResults(requestId, record, type, candidates) {
    const spec = typeSpecs[type];
    const view = new DataView(record.memory.buffer);
    const preview = candidates.preview.map((address) => ({
      address,
      value: address + spec.size <= view.byteLength
        ? wireNumber(spec.read(view, address))
        : null,
    }));
    send({
      kind: "scanResults",
      requestId,
      instanceId: record.id,
      type,
      total: candidates.count,
      preview,
      allCandidates: candidates.allCandidates,
      memoryBytes: record.memory.buffer.byteLength,
      snapshotBytes: candidates.snapshot?.compressedBytes ?? null,
    });
  }

  function wireNumber(value) {
    if (Number.isFinite(value)) {
      return value;
    }
    if (Number.isNaN(value)) {
      return "NaN";
    }
    return value > 0 ? "Infinity" : "-Infinity";
  }

  function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function waitForAnimationFrames(count) {
    return new Promise((resolve) => {
      let remaining = count;
      let fallbackTimer = null;
      const finish = () => {
        clearTimeout(fallbackTimer);
        resolve();
      };
      const next = () => {
        remaining -= 1;
        if (remaining <= 0) {
          finish();
          return;
        }
        requestAnimationFrame(next);
      };
      fallbackTimer = setTimeout(finish, Math.max(50, count * 50));
      requestAnimationFrame(next);
    });
  }

  function sampleAddress(record, spec, address, requestedValue, stage, startedAt) {
    try {
      const view = new DataView(record.memory.buffer);
      if (address + spec.size > view.byteLength) {
        throw new Error("Address is outside the current WASM memory.");
      }
      const value = spec.read(view, address);
      return {
        stage,
        elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
        value: wireNumber(value),
        matches: Object.is(value, requestedValue),
      };
    } catch (error) {
      return {
        stage,
        elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
        value: null,
        matches: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function runWriteDiagnostics({
    requestId,
    record,
    type,
    spec,
    address,
    requestedValue,
  }) {
    const diagnosticKey = freezeKey(record.id, type, address);
    const startedAt = performance.now();
    const immediate = sampleAddress(
      record,
      spec,
      address,
      requestedValue,
      "immediate",
      startedAt,
    );
    const nextFramePromise = waitForAnimationFrames(1).then(() => sampleAddress(
      record,
      spec,
      address,
      requestedValue,
      "next-frame",
      startedAt,
    ));
    const secondFramePromise = waitForAnimationFrames(2).then(() => sampleAddress(
      record,
      spec,
      address,
      requestedValue,
      "second-frame",
      startedAt,
    ));
    const delayedVerificationPromise = delay(75).then(() => sampleAddress(
      record,
      spec,
      address,
      requestedValue,
      "75ms",
      startedAt,
    ));
    const settledPromise = delay(250).then(() => sampleAddress(
      record,
      spec,
      address,
      requestedValue,
      "250ms",
      startedAt,
    ));

    delayedVerificationPromise.then((sample) => {
      if (activeWriteDiagnostics.get(diagnosticKey) !== requestId) {
        return;
      }
      send({
        kind: "writeVerified",
        requestId,
        instanceId: record.id,
        type,
        address,
        requestedValue,
        actualValue: sample.value,
        persisted: sample.matches,
      });
    });

    const samples = [
      immediate,
      ...await Promise.all([
        nextFramePromise,
        secondFramePromise,
        delayedVerificationPromise,
        settledPromise,
      ]),
    ];
    if (activeWriteDiagnostics.get(diagnosticKey) !== requestId) {
      return;
    }
    activeWriteDiagnostics.delete(diagnosticKey);
    const classification = samples.some((sample) => sample.error)
      ? "unavailable"
      : samples.every((sample) => sample.matches)
        ? "persistent"
        : immediate.matches
          ? "restored"
          : "rejected";
    send({
      kind: "writeDiagnostic",
      requestId,
      instanceId: record.id,
      type,
      address,
      requestedValue,
      classification,
      samples,
    });
  }

  function writeValue({ requestId, instanceId, type, address, rawValue }) {
    const record = instances.get(String(instanceId));
    const spec = typeSpecs[type];
    if (!record || !spec) {
      throw new Error("Invalid instance or value type.");
    }
    const numericAddress = Number(address);
    if (!Number.isSafeInteger(numericAddress) || numericAddress < 0) {
      throw new Error("Address must be a non-negative integer byte offset.");
    }
    const view = new DataView(record.memory.buffer);
    if (numericAddress + spec.size > view.byteLength) {
      throw new Error("Address is outside the current WASM memory.");
    }
    const value = parseValue(type, rawValue);
    spec.write(view, numericAddress, value);
    const activeFreeze = freezes.get(freezeKey(record.id, type, numericAddress));
    if (activeFreeze) {
      activeFreeze.value = value;
    }
    send({
      kind: "writeComplete",
      requestId,
      instanceId: record.id,
      type,
      address: numericAddress,
      value: wireNumber(spec.read(view, numericAddress)),
    });
    const diagnosticKey = freezeKey(record.id, type, numericAddress);
    activeWriteDiagnostics.set(diagnosticKey, requestId);
    runWriteDiagnostics({
      requestId,
      record,
      type,
      spec,
      address: numericAddress,
      requestedValue: value,
    }).catch((error) => {
      if (activeWriteDiagnostics.get(diagnosticKey) === requestId) {
        activeWriteDiagnostics.delete(diagnosticKey);
      }
      send({
        kind: "error",
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  function readValues({ requestId, instanceId, entries }) {
    const record = instances.get(String(instanceId));
    if (!record) {
      throw new Error("The selected WASM instance no longer exists.");
    }
    if (!Array.isArray(entries) || entries.length > MAX_WATCH_VALUES) {
      throw new Error(`A watch refresh supports at most ${MAX_WATCH_VALUES} addresses.`);
    }
    const view = new DataView(record.memory.buffer);
    const values = entries.map((entry) => {
      const spec = typeSpecs[entry?.type];
      const address = Number(entry?.address);
      const id = String(entry?.id ?? "");
      if (
        !id ||
        !spec ||
        !Number.isSafeInteger(address) ||
        address < 0 ||
        address + spec.size > view.byteLength
      ) {
        return { id, type: entry?.type, address, error: "Address is unavailable." };
      }
      return {
        id,
        type: entry.type,
        address,
        value: wireNumber(spec.read(view, address)),
      };
    });
    send({
      kind: "watchValues",
      requestId,
      instanceId: record.id,
      values,
    });
  }

  function applyFreezes() {
    freezeFrameHandle = null;
    for (const [key, entry] of freezes) {
      try {
        const view = new DataView(entry.record.memory.buffer);
        if (entry.address + entry.spec.size > view.byteLength) {
          freezes.delete(key);
          continue;
        }
        entry.spec.write(view, entry.address, entry.value);
      } catch {
        freezes.delete(key);
      }
    }
    if (freezes.size > 0) {
      freezeFrameHandle = requestAnimationFrame(applyFreezes);
    }
  }

  function ensureFreezeLoop() {
    if (freezeFrameHandle === null && freezes.size > 0) {
      freezeFrameHandle = requestAnimationFrame(applyFreezes);
    }
  }

  function setFreeze({ requestId, instanceId, type, address, rawValue, enabled }) {
    const record = instances.get(String(instanceId));
    const spec = typeSpecs[type];
    if (!record || !spec) {
      throw new Error("Invalid instance or value type.");
    }
    const numericAddress = Number(address);
    if (!Number.isSafeInteger(numericAddress) || numericAddress < 0) {
      throw new Error("Address must be a non-negative integer byte offset.");
    }
    const key = freezeKey(record.id, type, numericAddress);
    if (enabled) {
      const value = parseValue(type, rawValue);
      const view = new DataView(record.memory.buffer);
      if (numericAddress + spec.size > view.byteLength) {
        throw new Error("Address is outside the current WASM memory.");
      }
      spec.write(view, numericAddress, value);
      freezes.set(key, { record, spec, type, address: numericAddress, value });
      ensureFreezeLoop();
      send({
        kind: "freezeChanged",
        requestId,
        instanceId: record.id,
        type,
        address: numericAddress,
        value,
        enabled: true,
      });
    } else {
      freezes.delete(key);
      send({
        kind: "freezeChanged",
        requestId,
        instanceId: record.id,
        type,
        address: numericAddress,
        enabled: false,
      });
    }
  }

  async function resetScan({ requestId, instanceId, type }) {
    const key = scanKey(String(instanceId), type);
    const previous = scans.get(key);
    scans.delete(key);
    await deleteSnapshot(previous?.snapshot).catch(() => {});
    send({ kind: "scanReset", requestId, instanceId: String(instanceId), type });
  }

  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.data?.channel !== CHANNEL ||
      event.data?.direction !== "to-page"
    ) {
      return;
    }

    const command = event.data.payload;
    Promise.resolve()
      .then(() => {
        switch (command?.kind) {
          case "listInstances":
            send({
              kind: "instanceList",
              requestId: command.requestId,
              instances: [...instances.values()].map(describeInstance),
            });
            break;
          case "exactScan":
            return memoryScan({
              ...command,
              condition: "exact",
              alignment: "aligned",
            });
          case "memoryScan":
            return memoryScan(command);
          case "writeValue":
            writeValue(command);
            break;
          case "readValues":
            readValues(command);
            break;
          case "setFreeze":
            setFreeze(command);
            break;
          case "resetScan":
            resetScan(command);
            break;
          default:
            throw new Error(`Unknown command: ${command?.kind || "missing"}`);
        }
      })
      .catch((error) => {
        send({
          kind: "error",
          requestId: command?.requestId,
          message: error instanceof Error ? error.message : String(error),
        });
      });
  });

  Object.defineProperty(window, "__ruffleMemoryInspectorV1", {
    value: Object.freeze({ installed: true }),
    configurable: false,
    enumerable: false,
    writable: false,
  });

  send({ kind: "agentReady", url: location.href });
})();
