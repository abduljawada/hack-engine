(() => {
  "use strict";

  const CHANNEL = "ruffle-memory-inspector:v1";
  const RESULT_PREVIEW_LIMIT = 200;
  const SCAN_CHUNK_SIZE = 100_000;
  const SNAPSHOT_CHUNK_SIZE = 1024 * 1024;

  if (window.__ruffleMemoryInspectorV1) {
    return;
  }

  const instances = new Map();
  const scans = new Map();
  const freezes = new Map();
  let nextInstanceId = 1;
  let freezeFrameHandle = null;

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

  function clearInstanceScans(instanceId) {
    const prefix = `${instanceId}:`;
    for (const key of scans.keys()) {
      if (key.startsWith(prefix)) {
        scans.delete(key);
      }
    }
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
    const previewLength = Math.min(slotCount, RESULT_PREVIEW_LIMIT);
    return {
      bits: null,
      allCandidates: true,
      count: slotCount,
      preview: Array.from({ length: previewLength }, (_, index) => index * stride),
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

  async function captureSnapshot(record, requestId, byteLength) {
    const snapshot = new Uint8Array(byteLength);
    for (let offset = 0; offset < byteLength; offset += SNAPSHOT_CHUNK_SIZE) {
      const length = Math.min(SNAPSHOT_CHUNK_SIZE, byteLength - offset);
      snapshot.set(new Uint8Array(record.memory.buffer, offset, length), offset);
      const inspected = offset + length;
      send({ kind: "scanProgress", requestId, inspected, total: byteLength });
      if (inspected < byteLength) {
        await yieldToPage();
      }
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

  async function firstExactScan({ requestId, record, type, spec, rawValue, stride }) {
    const value = parseValue(type, rawValue);
    let view = new DataView(record.memory.buffer);
    const slotCount = slotCountFor(view.byteLength, spec, stride);
    const candidates = createCandidateSet(slotCount, type, stride);

    for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
      const offset = slotIndex * stride;
      if (spec.read(view, offset) === value) {
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
    const snapshot = await captureSnapshot(record, requestId, byteLength);
    const slotCount = slotCountFor(byteLength, spec, stride);
    return createAllCandidateSet(slotCount, type, stride, snapshot);
  }

  async function refineScan({
    requestId,
    record,
    type,
    spec,
    rawValue,
    condition,
    stride,
    previous,
  }) {
    if (previous.stride !== stride) {
      throw new Error("Scan alignment changed. Reset before starting a new scan.");
    }
    if (condition !== "exact" && !previous.snapshot) {
      throw new Error("Start with an unknown-value scan before using comparison filters.");
    }

    const currentByteLength = Math.min(
      record.memory.buffer.byteLength,
      previous.snapshot?.byteLength ?? record.memory.buffer.byteLength,
    );
    const currentSlotCount = slotCountFor(currentByteLength, spec, stride);
    const slotCount = Math.min(previous.slotCount, currentSlotCount);
    const candidates = createCandidateSet(slotCount, type, stride);
    const currentSnapshot = previous.snapshot
      ? await captureSnapshot(record, requestId, currentByteLength)
      : null;
    const value = condition === "exact" ? parseValue(type, rawValue) : null;
    let currentView = new DataView(
      currentSnapshot?.buffer ?? record.memory.buffer,
      currentSnapshot?.byteOffset ?? 0,
      currentSnapshot?.byteLength,
    );
    const previousView = previous.snapshot
      ? new DataView(
        previous.snapshot.buffer,
        previous.snapshot.byteOffset,
        previous.snapshot.byteLength,
      )
      : null;

    const inspectCandidate = (slotIndex) => {
      const offset = slotIndex * stride;
      const currentValue = spec.read(currentView, offset);
      const matches = condition === "exact"
        ? currentValue === value
        : comparisonMatches(condition, currentValue, spec.read(previousView, offset));
      if (matches) {
        retainCandidate(candidates, slotIndex, offset);
      }
    };

    if (previous.allCandidates) {
      for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
        inspectCandidate(slotIndex);
        const inspected = slotIndex + 1;
        if (inspected % SCAN_CHUNK_SIZE === 0) {
          send({ kind: "scanProgress", requestId, inspected, total: slotCount });
          await yieldToPage();
        }
      }
    } else {
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
            inspectCandidate(slotIndex);
          }
        }

        if ((byteIndex + 1) % bytesPerChunk === 0) {
          const inspected = Math.min((byteIndex + 1) * 8, slotCount);
          send({ kind: "scanProgress", requestId, inspected, total: slotCount });
          await yieldToPage();
          if (!currentSnapshot) {
            currentView = new DataView(record.memory.buffer);
          }
        }
      }
    }

    candidates.snapshot = currentSnapshot;
    return candidates;
  }

  async function memoryScan({
    requestId,
    instanceId,
    type,
    rawValue,
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
    if (!refine && condition !== "exact" && condition !== "unknown") {
      throw new Error("First scans support exact or unknown initial values.");
    }
    if (refine && condition === "unknown") {
      throw new Error("Unknown initial value is only available for a first scan.");
    }

    if (!refine) {
      // A memory snapshot can be hundreds of MiB. Drop every older session for
      // this WASM memory before allocating a replacement so stale snapshots do
      // not double the peak memory usage or trigger a long final GC pause.
      clearInstanceScans(record.id);
      await yieldToPage();
    }

    const candidates = refine
      ? await refineScan({
        requestId,
        record,
        type,
        spec,
        rawValue,
        condition,
        stride,
        previous,
      })
      : condition === "unknown"
        ? await firstUnknownScan({ requestId, record, type, spec, stride })
        : await firstExactScan({ requestId, record, type, spec, rawValue, stride });

    scans.set(key, candidates);
    sendScanResults(requestId, record, type, candidates);
  }

  function sendScanResults(requestId, record, type, candidates) {
    const spec = typeSpecs[type];
    const view = new DataView(record.memory.buffer);
    const preview = candidates.preview.map((address) => ({
      address,
      value: address + spec.size <= view.byteLength ? spec.read(view, address) : null,
    }));
    send({
      kind: "scanResults",
      requestId,
      instanceId: record.id,
      type,
      total: candidates.count,
      preview,
      memoryBytes: record.memory.buffer.byteLength,
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
      value: spec.read(view, numericAddress),
    });

    setTimeout(() => {
      try {
        const verificationView = new DataView(record.memory.buffer);
        if (numericAddress + spec.size > verificationView.byteLength) {
          throw new Error("Address is outside the current WASM memory.");
        }
        const actualValue = spec.read(verificationView, numericAddress);
        send({
          kind: "writeVerified",
          requestId,
          instanceId: record.id,
          type,
          address: numericAddress,
          requestedValue: value,
          actualValue,
          persisted: Object.is(actualValue, value),
        });
      } catch (error) {
        send({
          kind: "error",
          requestId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }, 75);
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

  function resetScan({ requestId, instanceId, type }) {
    scans.delete(scanKey(String(instanceId), type));
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
