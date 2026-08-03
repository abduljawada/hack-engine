(() => {
  "use strict";

  const CHANNEL = "ruffle-memory-inspector:v1";
  const RESULT_PREVIEW_LIMIT = 200;
  const SCAN_CHUNK_SIZE = 100_000;

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

  function freezeKey(instanceId, type, address) {
    return `${instanceId}:${type}:${address}`;
  }

  function yieldToPage() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function createCandidateSet(slotCount, type) {
    return {
      bits: new Uint8Array(Math.ceil(slotCount / 8)),
      count: 0,
      preview: [],
      slotCount,
      type,
    };
  }

  function retainCandidate(candidateSet, slotIndex, address) {
    candidateSet.bits[slotIndex >>> 3] |= 1 << (slotIndex & 7);
    candidateSet.count += 1;
    if (candidateSet.preview.length < RESULT_PREVIEW_LIMIT) {
      candidateSet.preview.push(address);
    }
  }

  async function exactScan({ requestId, instanceId, type, rawValue, refine }) {
    const record = instances.get(String(instanceId));
    const spec = typeSpecs[type];
    if (!record) {
      throw new Error("The selected WASM instance no longer exists.");
    }
    if (!spec) {
      throw new Error(`Unsupported value type: ${type}`);
    }

    const value = parseValue(type, rawValue);
    let view = new DataView(record.memory.buffer);
    const key = scanKey(record.id, type);
    const previous = refine ? scans.get(key) : null;
    const currentSlotCount = Math.floor(view.byteLength / spec.size);
    const slotCount = previous
      ? Math.min(previous.slotCount, currentSlotCount)
      : currentSlotCount;
    const candidates = createCandidateSet(slotCount, type);

    if (previous) {
      const bytesPerChunk = Math.max(1, Math.floor(SCAN_CHUNK_SIZE / 8));
      for (let byteIndex = 0; byteIndex < candidates.bits.length; byteIndex += 1) {
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
            const offset = slotIndex * spec.size;
            if (spec.read(view, offset) === value) {
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
    } else {
      for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
        const offset = slotIndex * spec.size;
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
    }

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
            return exactScan(command);
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
