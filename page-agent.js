(() => {
  "use strict";

  const CHANNEL = "ruffle-memory-inspector:v1";
  const RESULT_PREVIEW_LIMIT = 200;
  const SCAN_CHUNK_SIZE = 100_000;
  const SPARSE_CANDIDATE_DENSITY_DIVISOR = 32;
  const SNAPSHOT_CHUNK_SIZE = 1024 * 1024;
  const MAX_WATCH_VALUES = 256;
  const SNAPSHOT_DB_NAME = "ruffle-memory-inspector-snapshots-v1";
  const SNAPSHOT_STORE_NAME = "chunks";
  const AUTO_TYPES = ["i8", "u8", "i16", "u16", "i32", "u32", "f32", "f64"];
  const RUFFLE_PLAYER_SELECTOR = "ruffle-player, ruffle-embed, ruffle-object";

  if (window.__ruffleMemoryInspectorV1) {
    return;
  }

  const instances = new Map();
  const scans = new Map();
  const freezes = new Map();
  const cancelledScans = new Set();
  const activeWriteDiagnostics = new Map();
  let nextInstanceId = 1;
  let nextSnapshotId = 1;
  let freezeFrameHandle = null;
  let snapshotDatabasePromise = null;

  const typeSpecs = {
    i8: {
      size: 1,
      integer: true,
      minimum: -128,
      maximum: 127,
      read: (view, offset) => view.getInt8(offset),
      write: (view, offset, value) => view.setInt8(offset, value),
    },
    u8: {
      size: 1,
      integer: true,
      minimum: 0,
      maximum: 255,
      read: (view, offset) => view.getUint8(offset),
      write: (view, offset, value) => view.setUint8(offset, value),
    },
    i16: {
      size: 2,
      integer: true,
      minimum: -32768,
      maximum: 32767,
      read: (view, offset) => view.getInt16(offset, true),
      write: (view, offset, value) => view.setInt16(offset, value, true),
    },
    u16: {
      size: 2,
      integer: true,
      minimum: 0,
      maximum: 65535,
      read: (view, offset) => view.getUint16(offset, true),
      write: (view, offset, value) => view.setUint16(offset, value, true),
    },
    i32: {
      size: 4,
      integer: true,
      minimum: -2147483648,
      maximum: 2147483647,
      read: (view, offset) => view.getInt32(offset, true),
      write: (view, offset, value) => view.setInt32(offset, value, true),
    },
    u32: {
      size: 4,
      integer: true,
      minimum: 0,
      maximum: 4294967295,
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
    const avmKind = record.looksLikeRuffle ? detectRuffleAvmKind() : "unknown";
    return {
      id: record.id,
      url: location.href,
      hint: record.hint,
      memoryBytes: record.memory.buffer.byteLength,
      exportNames: record.exportNames,
      looksLikeRuffle: record.looksLikeRuffle,
      avmKind,
    };
  }

  function detectRuffle(hint, exportNames) {
    const text = `${hint || ""} ${exportNames.join(" ")}`;
    return /ruffle/i.test(text) || Boolean(document.querySelector(RUFFLE_PLAYER_SELECTOR));
  }

  function detectRuffleAvmKind() {
    const kinds = new Set();
    for (const player of document.querySelectorAll(RUFFLE_PLAYER_SELECTOR)) {
      try {
        const api = typeof player.ruffle === "function" ? player.ruffle(1) : player;
        const metadata = api?.metadata ?? player.metadata;
        if (typeof metadata?.isActionScript3 === "boolean") {
          kinds.add(metadata.isActionScript3 ? "avm2" : "avm1");
        }
      } catch {
        // Older or partially initialized Ruffle players may not expose metadata.
      }
    }
    return kinds.size === 1 ? [...kinds][0] : "unknown";
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
    const spec = typeSpecs[type];
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      throw new Error("Value must be a finite number.");
    }
    if (spec?.integer && !Number.isInteger(value)) {
      throw new Error(`${type} values must be integers.`);
    }
    if (spec?.integer && (value < spec.minimum || value > spec.maximum)) {
      throw new Error(`${type} value is outside its numeric range.`);
    }
    return type === "f32" ? Math.fround(value) : value;
  }

  function parseMultiplier(rawMultiplier) {
    const multiplier = rawMultiplier === undefined ? 1 : Number(rawMultiplier);
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      throw new Error("Stored-value multiplier must be a positive finite number.");
    }
    return multiplier;
  }

  function parseDisplayValue(type, rawValue, multiplier) {
    const displayed = Number(rawValue);
    if (!Number.isFinite(displayed)) {
      throw new Error("Value must be a finite number.");
    }
    return parseValue(type, displayed * multiplier);
  }

  function scanKey(instanceId, type) {
    return `${instanceId}:${type}`;
  }

  async function clearInstanceScans(instanceId) {
    const prefix = `${instanceId}:`;
    const snapshots = new Set();
    for (const key of scans.keys()) {
      if (key.startsWith(prefix)) {
        const scan = scans.get(key);
        if (scan?.snapshot) {
          snapshots.add(scan.snapshot);
        }
        scans.delete(key);
      }
    }
    await Promise.allSettled([...snapshots].map(deleteSnapshot));
  }

  function freezeKey(instanceId, type, address) {
    return `${instanceId}:${type}:${address}`;
  }

  function throwIfScanCancelled(requestId) {
    if (requestId != null && cancelledScans.has(String(requestId))) {
      const error = new Error("Scan cancelled.");
      error.name = "AbortError";
      throw error;
    }
  }

  async function yieldToPage(requestId) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    throwIfScanCancelled(requestId);
  }

  function createCandidateSet(
    slotCount,
    type,
    stride,
    { sparse = false, sparseCapacity = 0 } = {},
  ) {
    return {
      bits: sparse ? null : new Uint8Array(Math.ceil(slotCount / 8)),
      sparseSlots: sparse ? new Uint32Array(sparseCapacity) : null,
      sparseLength: sparse ? 0 : null,
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
      sparseSlots: null,
      sparseLength: null,
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
    if (candidateSet.sparseSlots !== null) {
      candidateSet.sparseSlots[candidateSet.sparseLength++] = slotIndex;
    } else {
      candidateSet.bits[slotIndex >>> 3] |= 1 << (slotIndex & 7);
    }
    candidateSet.count += 1;
    if (candidateSet.preview.length < RESULT_PREVIEW_LIMIT) {
      candidateSet.preview.push(address);
    }
  }

  function finalizeCandidateSet(candidateSet) {
    if (candidateSet.sparseSlots !== null) {
      if (candidateSet.sparseLength !== candidateSet.sparseSlots.length) {
        candidateSet.sparseSlots = candidateSet.sparseSlots.slice(
          0,
          candidateSet.sparseLength,
        );
      }
      candidateSet.sparseLength = candidateSet.sparseSlots.length;
      return candidateSet;
    }
    if (
      candidateSet.bits &&
      candidateSet.count * SPARSE_CANDIDATE_DENSITY_DIVISOR <= candidateSet.slotCount
    ) {
      const sparseSlots = new Uint32Array(candidateSet.count);
      let sparseIndex = 0;
      for (let byteIndex = 0; byteIndex < candidateSet.bits.length; byteIndex += 1) {
        const candidateByte = candidateSet.bits[byteIndex];
        if (!candidateByte) {
          continue;
        }
        for (let bitIndex = 0; bitIndex < 8; bitIndex += 1) {
          if (candidateByte & (1 << bitIndex)) {
            sparseSlots[sparseIndex++] = byteIndex * 8 + bitIndex;
          }
        }
      }
      candidateSet.bits = null;
      candidateSet.sparseSlots = sparseSlots;
      candidateSet.sparseLength = sparseSlots.length;
    }
    return candidateSet;
  }

  function sparseLowerBound(slots, target) {
    let low = 0;
    let high = slots.length;
    while (low < high) {
      const middle = low + ((high - low) >>> 1);
      if (slots[middle] < target) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
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
        await yieldToPage(requestId);
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

  function scanComparisonMatcher(type, condition, rawValue, multiplier) {
    const delta = ["increasedBy", "decreasedBy"].includes(condition)
      ? parseDisplayValue(type, rawValue, multiplier)
      : null;
    switch (condition) {
      case "changed": return (current, previous) => !Object.is(current, previous);
      case "unchanged": return (current, previous) => Object.is(current, previous);
      case "increased": return (current, previous) => current > previous;
      case "decreased": return (current, previous) => current < previous;
      case "increasedBy": return (current, previous) => current - previous === delta;
      case "decreasedBy": return (current, previous) => previous - current === delta;
      default: throw new Error(`Unsupported comparison condition: ${condition}`);
    }
  }

  function scanValueMatcher(type, condition, rawValue, rawMaxValue, multiplier) {
    const minimum = parseDisplayValue(type, rawValue, multiplier);
    if (condition === "exact") {
      return (value) => value === minimum;
    }
    if (condition !== "range") {
      throw new Error(`Unsupported value condition: ${condition}`);
    }
    const maximum = parseDisplayValue(type, rawMaxValue, multiplier);
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
    multiplier,
    condition,
    stride,
  }) {
    const matches = scanValueMatcher(type, condition, rawValue, rawMaxValue, multiplier);
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
        await yieldToPage(requestId);
        view = new DataView(record.memory.buffer);
      }
    }

    if (condition === "exact") {
      candidates.baselineValue = parseDisplayValue(type, rawValue, multiplier);
    }

    return finalizeCandidateSet(candidates);
  }

  async function firstUnknownScan({ requestId, record, type, spec, stride }) {
    const byteLength = record.memory.buffer.byteLength;
    const snapshot = await captureSnapshot(record, requestId, byteLength, spec);
    const slotCount = slotCountFor(byteLength, spec, stride);
    return createAllCandidateSet(slotCount, type, stride, snapshot);
  }

  function candidateIsRetained(candidateSet, slotIndex) {
    if (candidateSet.allCandidates) {
      return true;
    }
    if (candidateSet.sparseSlots !== null) {
      const sparseIndex = sparseLowerBound(candidateSet.sparseSlots, slotIndex);
      return candidateSet.sparseSlots[sparseIndex] === slotIndex;
    }
    return Boolean(candidateSet.bits?.[slotIndex >>> 3] & (1 << (slotIndex & 7)));
  }

  function candidateRangeHasMatches(candidateSet, startSlot, endSlot) {
    if (candidateSet.allCandidates) {
      return startSlot < endSlot;
    }
    if (candidateSet.sparseSlots !== null) {
      const sparseIndex = sparseLowerBound(candidateSet.sparseSlots, startSlot);
      return sparseIndex < candidateSet.sparseSlots.length &&
        candidateSet.sparseSlots[sparseIndex] < endSlot;
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

  async function captureCandidateSnapshot({
    requestId,
    record,
    candidates,
    spec,
  }) {
    const byteLength = record.memory.buffer.byteLength;
    const snapshot = createSnapshot(byteLength);
    const chunkCount = Math.ceil(byteLength / snapshot.chunkSize);
    snapshot.chunks = new Array(chunkCount).fill(null);
    try {
      for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
        await yieldToPage(requestId);
        const chunkOffset = chunkIndex * snapshot.chunkSize;
        const uniqueLength = Math.min(snapshot.chunkSize, byteLength - chunkOffset);
        const startSlot = Math.ceil(chunkOffset / candidates.stride);
        const endSlot = Math.min(
          candidates.slotCount,
          Math.ceil((chunkOffset + uniqueLength) / candidates.stride),
        );
        if (!candidateRangeHasMatches(candidates, startSlot, endSlot)) {
          continue;
        }
        const readLength = Math.min(
          uniqueLength + spec.size - 1,
          byteLength - chunkOffset,
        );
        const bytes = new Uint8Array(record.memory.buffer, chunkOffset, readLength).slice();
        const data = await compressSnapshotBytes(bytes);
        await storeSnapshotChunk(snapshot, chunkIndex, data, {
          byteLength: readLength,
          uniqueLength,
        });
        send({
          kind: "scanProgress",
          requestId,
          inspected: chunkOffset + uniqueLength,
          total: byteLength,
          snapshotBytes: snapshot.compressedBytes,
        });
      }
    } catch (error) {
      await deleteSnapshot(snapshot).catch(() => {});
      throw error;
    }
    candidates.snapshot = snapshot;
    return snapshot;
  }

  async function captureAutoCandidateSnapshot({ requestId, record, sets }) {
    const byteLength = record.memory.buffer.byteLength;
    const snapshot = createSnapshot(byteLength);
    const chunkCount = Math.ceil(byteLength / snapshot.chunkSize);
    snapshot.chunks = new Array(chunkCount).fill(null);
    try {
      for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
        await yieldToPage(requestId);
        const chunkOffset = chunkIndex * snapshot.chunkSize;
        const uniqueLength = Math.min(snapshot.chunkSize, byteLength - chunkOffset);
        const hasCandidates = [...sets.values()].some((candidates) => {
          const startSlot = Math.ceil(chunkOffset / candidates.stride);
          const endSlot = Math.min(
            candidates.slotCount,
            Math.ceil((chunkOffset + uniqueLength) / candidates.stride),
          );
          return candidateRangeHasMatches(candidates, startSlot, endSlot);
        });
        if (!hasCandidates) {
          continue;
        }
        const readLength = Math.min(
          uniqueLength + typeSpecs.f64.size - 1,
          byteLength - chunkOffset,
        );
        const bytes = new Uint8Array(record.memory.buffer, chunkOffset, readLength).slice();
        const data = await compressSnapshotBytes(bytes);
        await storeSnapshotChunk(snapshot, chunkIndex, data, {
          byteLength: readLength,
          uniqueLength,
        });
        send({
          kind: "scanProgress",
          requestId,
          inspected: chunkOffset + uniqueLength,
          total: byteLength,
          snapshotBytes: snapshot.compressedBytes,
        });
      }
    } catch (error) {
      await deleteSnapshot(snapshot).catch(() => {});
      throw error;
    }
    for (const candidates of sets.values()) {
      candidates.snapshot = snapshot;
    }
    return snapshot;
  }

  async function refineKnownBaselineCandidates({
    requestId,
    record,
    type,
    spec,
    rawValue,
    multiplier,
    condition,
    stride,
    previous,
    slotCount,
  }) {
    const sparsePrevious = previous.sparseSlots !== null;
    const candidates = createCandidateSet(slotCount, type, stride, {
      sparse: sparsePrevious,
      sparseCapacity: sparsePrevious ? previous.count : 0,
    });
    if (previous.baselineValue === undefined) {
      return finalizeCandidateSet(candidates);
    }
    const matches = scanComparisonMatcher(type, condition, rawValue, multiplier);
    let view = new DataView(record.memory.buffer);
    if (sparsePrevious) {
      const sparseLimit = sparseLowerBound(previous.sparseSlots, slotCount);
      for (let sparseIndex = 0; sparseIndex < sparseLimit; sparseIndex += 1) {
        const slotIndex = previous.sparseSlots[sparseIndex];
        const address = slotIndex * stride;
        if (matches(spec.read(view, address), previous.baselineValue)) {
          retainCandidate(candidates, slotIndex, address);
        }
        const inspected = sparseIndex + 1;
        if (inspected % SCAN_CHUNK_SIZE === 0) {
          send({ kind: "scanProgress", requestId, inspected, total: sparseLimit });
          await yieldToPage(requestId);
          view = new DataView(record.memory.buffer);
        }
      }
      return finalizeCandidateSet(candidates);
    }
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
          const address = slotIndex * stride;
          if (matches(spec.read(view, address), previous.baselineValue)) {
            retainCandidate(candidates, slotIndex, address);
          }
        }
      }
      if ((byteIndex + 1) % bytesPerChunk === 0) {
        send({
          kind: "scanProgress",
          requestId,
          inspected: Math.min((byteIndex + 1) * 8, slotCount),
          total: slotCount,
        });
        await yieldToPage(requestId);
        view = new DataView(record.memory.buffer);
      }
    }
    return finalizeCandidateSet(candidates);
  }

  async function refineLiveValue({
    requestId,
    record,
    type,
    spec,
    rawValue,
    rawMaxValue,
    multiplier,
    condition,
    stride,
    previous,
    slotCount,
  }) {
    const sparsePrevious = previous.sparseSlots !== null;
    const candidates = createCandidateSet(slotCount, type, stride, {
      sparse: sparsePrevious,
      sparseCapacity: sparsePrevious ? previous.count : 0,
    });
    const matches = scanValueMatcher(type, condition, rawValue, rawMaxValue, multiplier);
    let view = new DataView(record.memory.buffer);
    if (sparsePrevious) {
      const sparseLimit = sparseLowerBound(previous.sparseSlots, slotCount);
      for (let sparseIndex = 0; sparseIndex < sparseLimit; sparseIndex += 1) {
        const slotIndex = previous.sparseSlots[sparseIndex];
        const offset = slotIndex * stride;
        if (matches(spec.read(view, offset))) {
          retainCandidate(candidates, slotIndex, offset);
        }
        const inspected = sparseIndex + 1;
        if (inspected % SCAN_CHUNK_SIZE === 0) {
          send({ kind: "scanProgress", requestId, inspected, total: sparseLimit });
          await yieldToPage(requestId);
          view = new DataView(record.memory.buffer);
        }
      }
      return finalizeCandidateSet(candidates);
    }
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
        await yieldToPage(requestId);
        view = new DataView(record.memory.buffer);
      }
    }
    return finalizeCandidateSet(candidates);
  }

  async function refineSnapshotScan({
    requestId,
    record,
    type,
    spec,
    rawValue,
    rawMaxValue,
    multiplier,
    condition,
    stride,
    previous,
    slotCount,
    currentByteLength,
  }) {
    const sparsePrevious = previous.sparseSlots !== null;
    const candidates = createCandidateSet(slotCount, type, stride, {
      sparse: sparsePrevious,
      sparseCapacity: sparsePrevious ? previous.count : 0,
    });
    const currentSnapshot = createSnapshot(currentByteLength);
    currentSnapshot.chunks = new Array(previous.snapshot.chunks.length).fill(null);
    const valueCondition = condition === "exact" || condition === "range";
    const matchesValue = valueCondition
      ? scanValueMatcher(type, condition, rawValue, rawMaxValue, multiplier)
      : null;
    const matchesComparison = valueCondition
      ? null
      : scanComparisonMatcher(type, condition, rawValue, multiplier);

    try {
      for (
        let chunkIndex = 0;
        chunkIndex < previous.snapshot.chunks.length;
        chunkIndex += 1
      ) {
        await yieldToPage(requestId);
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

        const retainMatchingSlot = (slotIndex) => {
          const address = slotIndex * stride;
          const localOffset = address - chunkOffset;
          const currentValue = spec.read(currentView, localOffset);
          const matches = valueCondition
            ? matchesValue(currentValue)
            : matchesComparison(currentValue, spec.read(previousView, localOffset));
          if (matches) {
            retainCandidate(candidates, slotIndex, address);
            chunkRetained = true;
          }
        };
        if (sparsePrevious) {
          const sparseStart = sparseLowerBound(previous.sparseSlots, startSlot);
          const sparseEnd = sparseLowerBound(previous.sparseSlots, endSlot);
          for (let sparseIndex = sparseStart; sparseIndex < sparseEnd; sparseIndex += 1) {
            retainMatchingSlot(previous.sparseSlots[sparseIndex]);
          }
        } else {
          for (let slotIndex = startSlot; slotIndex < endSlot; slotIndex += 1) {
            if (candidateIsRetained(previous, slotIndex)) {
              retainMatchingSlot(slotIndex);
            }
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
    return finalizeCandidateSet(candidates);
  }

  async function refineScan({
    requestId,
    record,
    type,
    spec,
    rawValue,
    rawMaxValue,
    multiplier,
    condition,
    stride,
    previous,
  }) {
    if (previous.stride !== stride) {
      throw new Error("Scan alignment changed. Reset before starting a new scan.");
    }
    const currentByteLength = Math.min(
      record.memory.buffer.byteLength,
      previous.snapshot?.byteLength ?? record.memory.buffer.byteLength,
    );
    const currentSlotCount = slotCountFor(currentByteLength, spec, stride);
    const slotCount = Math.min(previous.slotCount, currentSlotCount);
    if (!previous.snapshot) {
      if (!["exact", "range"].includes(condition)) {
        const candidates = await refineKnownBaselineCandidates({
          requestId,
          record,
          type,
          spec,
          rawValue,
          multiplier,
          condition,
          stride,
          previous,
          slotCount,
        });
        await captureCandidateSnapshot({ requestId, record, candidates, spec });
        return candidates;
      }
      const candidates = await refineLiveValue({
        requestId,
        record,
        type,
        spec,
        rawValue,
        rawMaxValue,
        multiplier,
        condition,
        stride,
        previous,
        slotCount,
      });
      if (condition === "exact") {
        candidates.baselineValue = parseDisplayValue(type, rawValue, multiplier);
      } else {
        await captureCandidateSnapshot({ requestId, record, candidates, spec });
      }
      return candidates;
    }
    return refineSnapshotScan({
      requestId,
      record,
      type,
      spec,
      rawValue,
      rawMaxValue,
      multiplier,
      condition,
      stride,
      previous,
      slotCount,
      currentByteLength,
    });
  }

  function autoScanTypes(types = AUTO_TYPES) {
    return types.map((type) => ({ type, spec: typeSpecs[type] }));
  }

  function smartScanTypes(record, rawValue, rawMaxValue, multiplier, condition) {
    const avmKind = record.looksLikeRuffle ? detectRuffleAvmKind() : "unknown";
    if (avmKind === "avm1") {
      return ["f64"];
    }
    if (avmKind !== "avm2") {
      return AUTO_TYPES.slice();
    }

    if (!["exact", "range", "increasedBy", "decreasedBy"].includes(condition)) {
      return ["i32", "u32", "f64"];
    }
    const values = [rawValue, condition === "range" ? rawMaxValue : rawValue]
      .map((value) => Number(value) * multiplier)
      .filter(Number.isFinite);
    return values.some((value) => !Number.isInteger(value))
      ? ["f64"]
      : ["i32", "u32", "f64"];
  }

  function emptyCandidatesFor(record, type, spec, alignment, byteLength) {
    const stride = scanStride(spec, alignment);
    return finalizeCandidateSet(
      createCandidateSet(slotCountFor(byteLength, spec, stride), type, stride),
    );
  }

  async function firstAutoScan({
    requestId,
    record,
    rawValue,
    rawMaxValue,
    multiplier,
    condition,
    alignment,
    types,
  }) {
    const byteLength = record.memory.buffer.byteLength;
    const sets = new Map();
    if (condition === "unknown") {
      const snapshot = await captureSnapshot(record, requestId, byteLength, typeSpecs.f64);
      for (const { type, spec } of autoScanTypes(types)) {
        const stride = scanStride(spec, alignment);
        sets.set(
          type,
          createAllCandidateSet(slotCountFor(byteLength, spec, stride), type, stride, snapshot),
        );
      }
      return { multi: true, sets, snapshot, multiplier, types };
    }

    for (const { type, spec } of autoScanTypes(types)) {
      const stride = scanStride(spec, alignment);
      try {
        sets.set(type, await firstValueScan({
          requestId,
          record,
          type,
          spec,
          rawValue,
          rawMaxValue,
          multiplier,
          condition,
          stride,
        }));
      } catch (error) {
        if (!(error instanceof Error) || !/integer|numeric range/.test(error.message)) {
          throw error;
        }
        sets.set(type, emptyCandidatesFor(record, type, spec, alignment, byteLength));
      }
    }
    const snapshot = condition === "range"
      ? await captureAutoCandidateSnapshot({ requestId, record, sets })
      : null;
    return { multi: true, sets, snapshot, multiplier, types };
  }

  async function refineAutoLiveScan({
    requestId,
    record,
    previous,
    rawValue,
    rawMaxValue,
    multiplier,
    condition,
    alignment,
  }) {
    const sets = new Map();
    const byteLength = record.memory.buffer.byteLength;
    const valueCondition = condition === "exact" || condition === "range";
    for (const { type, spec } of autoScanTypes(previous.types)) {
      const prior = previous.sets.get(type);
      const stride = scanStride(spec, alignment);
      if (!prior || prior.stride !== stride) {
        throw new Error("Scan alignment changed. Reset before starting a new scan.");
      }
      const slotCount = Math.min(prior.slotCount, slotCountFor(byteLength, spec, stride));
      try {
        const candidates = valueCondition
          ? await refineLiveValue({
            requestId,
            record,
            type,
            spec,
            rawValue,
            rawMaxValue,
            multiplier,
            condition,
            stride,
            previous: prior,
            slotCount,
          })
          : await refineKnownBaselineCandidates({
            requestId,
            record,
            type,
            spec,
            rawValue,
            multiplier,
            condition,
            stride,
            previous: prior,
            slotCount,
          });
        if (condition === "exact") {
          candidates.baselineValue = parseDisplayValue(type, rawValue, multiplier);
        }
        sets.set(type, candidates);
      } catch (error) {
        if (!(error instanceof Error) || !/integer|numeric range/.test(error.message)) {
          throw error;
        }
        sets.set(type, finalizeCandidateSet(createCandidateSet(slotCount, type, stride)));
      }
    }
    const snapshot = condition === "exact"
      ? null
      : await captureAutoCandidateSnapshot({ requestId, record, sets });
    return { multi: true, sets, snapshot, multiplier, types: previous.types };
  }

  async function refineAutoSnapshotScan({
    requestId,
    record,
    previous,
    rawValue,
    rawMaxValue,
    multiplier,
    condition,
    alignment,
  }) {
    const previousSnapshot = previous.snapshot;
    const currentByteLength = Math.min(
      record.memory.buffer.byteLength,
      previousSnapshot.byteLength,
    );
    const currentSnapshot = createSnapshot(currentByteLength);
    currentSnapshot.chunks = new Array(previousSnapshot.chunks.length).fill(null);
    const sets = new Map();
    const configurations = [];
    const valueCondition = condition === "exact" || condition === "range";

    for (const { type, spec } of autoScanTypes(previous.types)) {
      const prior = previous.sets.get(type);
      const stride = scanStride(spec, alignment);
      if (!prior || prior.stride !== stride) {
        throw new Error("Scan alignment changed. Reset before starting a new scan.");
      }
      const slotCount = Math.min(
        prior.slotCount,
        slotCountFor(currentByteLength, spec, stride),
      );
      const candidates = createCandidateSet(slotCount, type, stride, {
        sparse: prior.sparseSlots !== null,
        sparseCapacity: prior.sparseSlots !== null ? prior.count : 0,
      });
      sets.set(type, candidates);
      try {
        configurations.push({
          type,
          spec,
          stride,
          slotCount,
          prior,
          candidates,
          matchesValue: valueCondition
            ? scanValueMatcher(type, condition, rawValue, rawMaxValue, multiplier)
            : null,
          matchesComparison: valueCondition
            ? null
            : scanComparisonMatcher(type, condition, rawValue, multiplier),
        });
      } catch (error) {
        if (!(error instanceof Error) || !/integer|numeric range/.test(error.message)) {
          throw error;
        }
      }
    }

    try {
      for (let chunkIndex = 0; chunkIndex < previousSnapshot.chunks.length; chunkIndex += 1) {
        await yieldToPage(requestId);
        const previousChunk = previousSnapshot.chunks[chunkIndex];
        const chunkOffset = chunkIndex * previousSnapshot.chunkSize;
        const uniqueLength = Math.min(
          previousSnapshot.chunkSize,
          currentByteLength - chunkOffset,
        );
        if (!previousChunk || uniqueLength <= 0) {
          continue;
        }
        const active = configurations.filter((config) => {
          const startSlot = Math.ceil(chunkOffset / config.stride);
          const endSlot = Math.min(
            config.slotCount,
            Math.ceil((chunkOffset + uniqueLength) / config.stride),
          );
          return candidateRangeHasMatches(config.prior, startSlot, endSlot);
        });
        if (active.length === 0) {
          send({
            kind: "scanProgress",
            requestId,
            inspected: chunkOffset + uniqueLength,
            total: currentByteLength,
          });
          continue;
        }
        const currentReadLength = Math.min(
          uniqueLength + typeSpecs.f64.size - 1,
          currentByteLength - chunkOffset,
        );
        const currentBytes = new Uint8Array(
          record.memory.buffer,
          chunkOffset,
          currentReadLength,
        ).slice();
        const previousBytes = await loadSnapshotChunk(previousSnapshot, chunkIndex);
        const currentView = new DataView(currentBytes.buffer);
        const previousView = new DataView(
          previousBytes.buffer,
          previousBytes.byteOffset,
          previousBytes.byteLength,
        );
        let chunkRetained = false;

        for (const config of active) {
          const startSlot = Math.ceil(chunkOffset / config.stride);
          const endSlot = Math.min(
            config.slotCount,
            Math.ceil((chunkOffset + uniqueLength) / config.stride),
          );
          const retainMatchingSlot = (slotIndex) => {
            const address = slotIndex * config.stride;
            const localOffset = address - chunkOffset;
            const currentValue = config.spec.read(currentView, localOffset);
            const matches = valueCondition
              ? config.matchesValue(currentValue)
              : config.matchesComparison(
                currentValue,
                config.spec.read(previousView, localOffset),
              );
            if (matches) {
              retainCandidate(config.candidates, slotIndex, address);
              chunkRetained = true;
            }
          };
          if (config.prior.sparseSlots !== null) {
            const sparseStart = sparseLowerBound(config.prior.sparseSlots, startSlot);
            const sparseEnd = sparseLowerBound(config.prior.sparseSlots, endSlot);
            for (let sparseIndex = sparseStart; sparseIndex < sparseEnd; sparseIndex += 1) {
              retainMatchingSlot(config.prior.sparseSlots[sparseIndex]);
            }
          } else {
            for (let slotIndex = startSlot; slotIndex < endSlot; slotIndex += 1) {
              if (candidateIsRetained(config.prior, slotIndex)) {
                retainMatchingSlot(slotIndex);
              }
            }
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
          inspected: chunkOffset + uniqueLength,
          total: currentByteLength,
          snapshotBytes: currentSnapshot.compressedBytes,
        });
      }
    } catch (error) {
      await deleteSnapshot(currentSnapshot).catch(() => {});
      throw error;
    }

    for (const candidates of sets.values()) {
      candidates.snapshot = currentSnapshot;
      finalizeCandidateSet(candidates);
    }
    return {
      multi: true,
      sets,
      snapshot: currentSnapshot,
      multiplier,
      types: previous.types,
    };
  }

  function sendAutoScanResults(requestId, record, group) {
    const view = new DataView(record.memory.buffer);
    const preview = [];
    let total = 0;
    let allCandidates = true;
    for (const [type, candidates] of group.sets) {
      total += candidates.count;
      allCandidates &&= candidates.allCandidates;
    }
    for (let previewIndex = 0; preview.length < RESULT_PREVIEW_LIMIT; previewIndex += 1) {
      let added = false;
      for (const [type, candidates] of group.sets) {
        const address = candidates.preview[previewIndex];
        if (address === undefined) {
          continue;
        }
        added = true;
        const spec = typeSpecs[type];
        const value = address + spec.size <= view.byteLength
          ? spec.read(view, address)
          : null;
        preview.push({
          address,
          type,
          multiplier: group.multiplier,
          value: value === null ? null : wireNumber(value),
          displayValue: value === null ? null : wireNumber(value / group.multiplier),
        });
        if (preview.length >= RESULT_PREVIEW_LIMIT) {
          break;
        }
      }
      if (!added) {
        break;
      }
    }
    send({
      kind: "scanResults",
      requestId,
      instanceId: record.id,
      type: group.mode || "auto",
      multiplier: group.multiplier,
      avmKind: record.looksLikeRuffle ? detectRuffleAvmKind() : "unknown",
      searchedTypes: group.types,
      total,
      preview,
      allCandidates,
      candidateStorage: Object.fromEntries(
        [...group.sets].map(([type, candidates]) => [
          type,
          candidates.allCandidates ? "all" : candidates.sparseSlots !== null ? "sparse" : "dense",
        ]),
      ),
      memoryBytes: record.memory.buffer.byteLength,
      snapshotBytes: group.snapshot?.compressedBytes ?? null,
    });
  }

  async function autoMemoryScan(options) {
    const {
      requestId,
      instanceId,
      type: mode = "auto",
      rawValue,
      rawMaxValue,
      multiplier: rawMultiplier = 1,
      condition = "exact",
      alignment = "aligned",
      refine,
    } = options;
    const record = instances.get(String(instanceId));
    if (!record) {
      throw new Error("The selected WASM instance no longer exists.");
    }
    const multiplier = parseMultiplier(rawMultiplier);
    const key = scanKey(record.id, mode);
    const previous = refine ? scans.get(key) : null;
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
      await clearInstanceScans(record.id);
      await yieldToPage(requestId);
    }
    const types = refine
      ? previous.types
      : mode === "smart"
        ? smartScanTypes(record, rawValue, rawMaxValue, multiplier, condition)
        : AUTO_TYPES.slice();
    const group = refine
      ? previous.snapshot
        ? await refineAutoSnapshotScan({
          requestId,
          record,
          previous,
          rawValue,
          rawMaxValue,
          multiplier,
          condition,
          alignment,
        })
        : await refineAutoLiveScan({
          requestId,
          record,
          previous,
          rawValue,
          rawMaxValue,
          multiplier,
          condition,
          alignment,
        })
      : await firstAutoScan({
        requestId,
        record,
        rawValue,
        rawMaxValue,
        multiplier,
        condition,
        alignment,
        types,
      });
    group.mode = mode;
    scans.set(key, group);
    if (previous?.snapshot && previous.snapshot !== group.snapshot) {
      deleteSnapshot(previous.snapshot).catch(() => {});
    }
    sendAutoScanResults(requestId, record, group);
    cancelledScans.delete(String(requestId));
  }

  async function memoryScan({
    requestId,
    instanceId,
    type,
    rawValue,
    rawMaxValue,
    multiplier: rawMultiplier = 1,
    condition = "exact",
    alignment = "aligned",
    refine,
  }) {
    if (type === "auto" || type === "smart") {
      return autoMemoryScan({
        requestId,
        instanceId,
        type,
        rawValue,
        rawMaxValue,
        multiplier: rawMultiplier,
        condition,
        alignment,
        refine,
      });
    }
    const record = instances.get(String(instanceId));
    const spec = typeSpecs[type];
    const multiplier = parseMultiplier(rawMultiplier);
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
      await yieldToPage(requestId);
    }

    const candidates = refine
      ? await refineScan({
        requestId,
        record,
        type,
        spec,
        rawValue,
        rawMaxValue,
        multiplier,
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
          multiplier,
          condition,
          stride,
        });

    if (!refine && condition === "range") {
      await captureCandidateSnapshot({ requestId, record, candidates, spec });
    }

    scans.set(key, candidates);
    if (previous?.snapshot && previous.snapshot !== candidates.snapshot) {
      deleteSnapshot(previous.snapshot).catch(() => {});
    }
    sendScanResults(requestId, record, type, candidates, multiplier);
    cancelledScans.delete(String(requestId));
  }

  function sendScanResults(requestId, record, type, candidates, multiplier = 1) {
    const spec = typeSpecs[type];
    const view = new DataView(record.memory.buffer);
    const preview = candidates.preview.map((address) => {
      const value = address + spec.size <= view.byteLength
        ? spec.read(view, address)
        : null;
      return {
        address,
        type,
        multiplier,
        value: value === null ? null : wireNumber(value),
        displayValue: value === null ? null : wireNumber(value / multiplier),
      };
    });
    send({
      kind: "scanResults",
      requestId,
      instanceId: record.id,
      type,
      multiplier,
      total: candidates.count,
      preview,
      allCandidates: candidates.allCandidates,
      candidateStorage: candidates.allCandidates
        ? "all"
        : candidates.sparseSlots !== null
          ? "sparse"
          : "dense",
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
    multiplier,
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
        displayValue: typeof sample.value === "number" ? sample.value / multiplier : sample.value,
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
      multiplier,
      classification,
      samples,
    });
  }

  function writeValue({ requestId, instanceId, type, address, rawValue, multiplier: rawMultiplier = 1 }) {
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
    const multiplier = parseMultiplier(rawMultiplier);
    const value = parseDisplayValue(type, rawValue, multiplier);
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
      displayValue: wireNumber(spec.read(view, numericAddress) / multiplier),
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
      multiplier,
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

  function setFreeze({
    requestId,
    instanceId,
    type,
    address,
    rawValue,
    multiplier: rawMultiplier = 1,
    enabled,
  }) {
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
      const multiplier = parseMultiplier(rawMultiplier);
      const value = parseDisplayValue(type, rawValue, multiplier);
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
        displayValue: value / multiplier,
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
          case "cancelScan":
            cancelledScans.add(String(command.targetRequestId));
            break;
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
        if (error instanceof Error && error.name === "AbortError") {
          cancelledScans.delete(String(command?.requestId));
          send({ kind: "scanCancelled", requestId: command?.requestId });
          return;
        }
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
