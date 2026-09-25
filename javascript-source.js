(() => {
  "use strict";
  // References never leave this page. Paths are labels and rediscovery hints only.
  const root = globalThis;
  const excluded = new Set([
    "window", "self", "top", "parent", "frames", "globalThis", "document", "location", "navigator",
    "history", "screen", "performance", "console", "crypto", "localStorage", "sessionStorage",
    "indexedDB", "caches", "clientInformation", "external", "chrome", "browser", "JSON", "Math",
    "Intl", "Reflect", "Atomics", "Temporal", "WebAssembly", "CSS", "Infinity", "NaN", "undefined",
  ]);
  const browserNumbers = new Set(["innerWidth", "innerHeight", "outerWidth", "outerHeight", "screenX", "screenY", "screenLeft", "screenTop", "scrollX", "scrollY", "pageXOffset", "pageYOffset", "devicePixelRatio", "length"]);
  const unsafe = (key) => key === "__proto__" || key === "prototype" || key === "constructor" ||
    key.startsWith("__hackEngine") || key.startsWith("__ruffleMemoryInspector");
  const descriptor = (object, key) => {
    try { const d = Object.getOwnPropertyDescriptor(object, key); return d && "value" in d ? d : null; }
    catch { return null; }
  };
  const traversable = (object) => {
    if (!object || typeof object !== "object" || object === root) return false;
    try {
      if (ArrayBuffer.isView(object)) return Boolean(numericArrays[typedArrayTag.call(object)]) && typeof typedArrayLength.call(object) === "number";
      const p = Object.getPrototypeOf(object);
      return Array.isArray(object) || p === null || p === Object.prototype;
    } catch { return false; }
  };
  const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
  const typedArrayTag = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag).get;
  const typedArrayLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "length").get;
  const numericArrays = { Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array };
  const storageTypes = { Int8Array: "i8", Uint8Array: "u8", Uint8ClampedArray: "u8", Int16Array: "i16", Uint16Array: "u16", Int32Array: "i32", Uint32Array: "u32", Float32Array: "f32", Float64Array: "f64" };
  const supportedTypes = ["number", ...new Set(Object.values(storageTypes))];
  const storageTypeFor = (owner, key) => {
    if (ArrayBuffer.isView(owner) && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < typedArrayLength.call(owner)) {
      return storageTypes[typedArrayTag.call(owner)] || "number";
    }
    return "number";
  };
  const initial = new Map();
  for (const key of Object.getOwnPropertyNames(root)) {
    const d = descriptor(root, key);
    if (d && excluded.has(key)) initial.set(key, d.value);
  }
  globalThis.__hackEngineJavaScript = ({ documentId, yieldToPage = () => new Promise((resolve) => setTimeout(resolve, 0)) }) => {
    const id = `${documentId}.js`;
    const handles = new Map();
    const owners = new WeakMap();
    let nextAddress = 1;
    const MAX_HANDLES = 200000;
    const displayPath = (path) => path.map((key, index) => /^[A-Za-z_$][\w$]*$/.test(key)
      ? `${index ? "." : ""}${key}` : `[${JSON.stringify(key)}]`).join("");
    const eligibleRoot = (key, d) => !unsafe(key) && !browserNumbers.has(key) && d &&
      (!excluded.has(key) || initial.has(key) && initial.get(key) !== d.value) &&
      (traversable(d.value) || typeof d.value === "number" && Number.isFinite(d.value));
    const roots = () => Object.getOwnPropertyNames(root).flatMap((key) => {
      const d = descriptor(root, key);
      return eligibleRoot(key, d) ? [{ path: [key], displayPath: displayPath([key]), kind: typeof d.value === "number" ? "number" : "object" }] : [];
    });
    const fail = (record) => { if (record) record.invalid = true; throw new Error("JavaScript target is stale; scan again to find the current object."); };
    const validate = (record) => {
      if (!record || record.invalid) return fail(record);
      let current = root;
      for (const step of record.chain) {
        const d = descriptor(current, step.key);
        if (!d || d.value !== step.object) return fail(record);
        current = d.value;
      }
      if (current !== record.owner) return fail(record);
      const d = descriptor(current, record.key);
      if (!d || typeof d.value !== "number" || !Number.isFinite(d.value)) return fail(record);
      return d;
    };
    const metadata = (address) => {
      const record = handles.get(address);
      const d = validate(record);
      return { address, type: "number", storageType: storageTypeFor(record.owner, record.key), kind: "javascript", path: [...record.path], displayPath: displayPath(record.path), value: d.value, writable: Boolean(d.writable) };
    };
    const register = (owner, key, chain, path) => {
      let byKey = owners.get(owner);
      if (!byKey) owners.set(owner, byKey = new Map());
      let record = byKey.get(key);
      if (record) { try { validate(record); } catch { record = null; } }
      if (!record) {
        if (handles.size >= MAX_HANDLES) { const error = new Error("JavaScript handle limit reached; reload the game to release retained targets."); error.code = "HANDLE_LIMIT"; throw error; }
        record = { address: nextAddress++, owner, key, chain, path: [...path], invalid: false };
        byKey.set(key, record); handles.set(record.address, record);
      }
      return metadata(record.address);
    };
    const resolve = (path) => {
      if (!Array.isArray(path) || !path.length || path.length > 9 || path.some((key) => typeof key !== "string" || unsafe(key))) throw new Error("Invalid JavaScript property path.");
      let owner = root;
      const chain = [];
      for (let i = 0; i < path.length; i++) {
        const key = path[i]; const d = descriptor(owner, key);
        if (!d || i === 0 && !eligibleRoot(key, d)) throw new Error("JavaScript property path is unavailable.");
        if (i === path.length - 1) {
          if (typeof d.value !== "number" || !Number.isFinite(d.value)) throw new Error("JavaScript property is not a finite number.");
          return register(owner, key, chain, path);
        }
        if (!traversable(d.value)) throw new Error("JavaScript property path is not inspectable.");
        chain.push({ key, object: d.value }); owner = d.value;
      }
    };
    const discover = async ({ requestId, rootPath, type = "smart" } = {}) => {
      if (!["smart", "auto", ...supportedTypes].includes(type)) throw new Error("Unsupported JavaScript scan type.");
      const matchesType = (owner, key) => type === "smart" || type === "auto" || storageTypeFor(owner, key) === type;
      const coverage = { complete: true, objects: 0, properties: 0, numbers: 0, limits: { depth: 8, objects: 20000, properties: 100000, handles: MAX_HANDLES }, reasons: [] };
      const incomplete = (reason) => { coverage.complete = false; if (!coverage.reasons.includes(reason)) coverage.reasons.push(reason); };
      // Retire stale owners between scans; live handles (including watches) are never evicted.
      let checked = 0;
      for (const [address, record] of handles) {
        try { validate(record); } catch { handles.delete(address); const byKey = owners.get(record.owner); if (byKey?.get(record.key) === record) byKey.delete(record.key); }
        if (++checked % 500 === 0) await yieldToPage(requestId);
      }
      const entries = [];
      const visited = new WeakSet();
      const queue = [];
      const selected = rootPath == null ? roots().map((r) => r.path) : [rootPath];
      for (const path of selected) {
        if (coverage.properties >= coverage.limits.properties) { incomplete("property limit"); break; }
        coverage.properties++;
        if (coverage.properties % 500 === 0) await yieldToPage(requestId);
        if (!Array.isArray(path) || !path.length || path.length > 9 || path.some((key) => typeof key !== "string" || unsafe(key))) throw new Error("Invalid JavaScript root path.");
        let owner = root; const chain = [];
        for (let i = 0; i < path.length; i++) {
          const key = path[i]; const d = descriptor(owner, key);
          if (!d || i === 0 && !eligibleRoot(key, d)) throw new Error("JavaScript root is unavailable.");
          if (i === path.length - 1 && typeof d.value === "number" && Number.isFinite(d.value)) {
            try { if (matchesType(owner, key)) entries.push(register(owner, key, chain, path)); }
            catch (error) { incomplete(error.code === "HANDLE_LIMIT" ? "handle limit" : "object changed during scan"); }
            break;
          }
          if (!traversable(d.value)) throw new Error("JavaScript root is not inspectable.");
          chain.push({ key, object: d.value }); owner = d.value;
          if (i === path.length - 1) {
            if (path.length >= 9) incomplete("depth limit");
            else if (queue.length >= coverage.limits.objects) incomplete("object limit");
            else queue.push({ object: owner, chain, path, depth: path.length - 1 });
          }
        }
      }
      await yieldToPage(requestId);
      let work = 0;
      for (let index = 0; index < queue.length; index++) {
        const item = queue[index];
        if (visited.has(item.object)) continue;
        if (coverage.objects >= coverage.limits.objects) { incomplete("object limit"); break; }
        visited.add(item.object); coverage.objects++;
        let keys;
        try {
          // Avoid allocating a key list proportional to a very large typed array.
          if (ArrayBuffer.isView(item.object)) {
            const length = typedArrayLength.call(item.object);
            keys = (function* () { for (let i = 0; i < length; i++) yield String(i); })();
          } else keys = Object.getOwnPropertyNames(item.object);
        } catch { incomplete("unreadable object"); continue; }
        for (const key of keys) {
          if (coverage.properties >= coverage.limits.properties) { incomplete("property limit"); break; }
          coverage.properties++; work++;
          if (work % 500 === 0) await yieldToPage(requestId);
          if (unsafe(key)) continue;
          const d = descriptor(item.object, key);
          if (!d) continue;
          const path = [...item.path, key];
          if (typeof d.value === "number" && Number.isFinite(d.value)) {
            try { if (matchesType(item.object, key)) entries.push(register(item.object, key, item.chain, path)); } catch (error) { incomplete(error.code === "HANDLE_LIMIT" ? "handle limit" : "object changed during scan"); }
          } else if (traversable(d.value) && !visited.has(d.value)) {
            if (item.depth >= coverage.limits.depth - 1) incomplete("depth limit");
            else if (queue.length >= coverage.limits.objects) incomplete("object limit");
            else queue.push({ object: d.value, chain: [...item.chain, { key, object: d.value }], path, depth: item.depth + 1 });
          }
        }
        if (coverage.properties >= coverage.limits.properties) {
          if (index + 1 < queue.length) incomplete("property limit");
          break;
        }
      }
      coverage.numbers = entries.length;
      return { entries, coverage };
    };
    return {
      describe: () => ({ id, kind: "javascript", displayName: "JavaScript objects", memoryBytes: 0, documentId, operations: ["scan", "refine", "watch", "write", "freeze"], capabilities: ["scan", "watch", "write", "freeze", "undo", "restore"], supportedTypes: [...supportedTypes] }),
      roots, discover, resolve, metadata,
      read: (address) => validate(handles.get(address)).value,
      write(address, value) {
        if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Enter a finite JavaScript number.");
        const record = handles.get(address); const d = validate(record);
        if (!d.writable) throw new Error("JavaScript property is read-only.");
        if (ArrayBuffer.isView(record.owner) && /^(0|[1-9][0-9]*)$/.test(record.key)) {
          const Type = numericArrays[typedArrayTag.call(record.owner)];
          if (!Type || !Object.is(new Type([value])[0], value)) throw new Error("JavaScript write verification failed: value cannot be represented by this typed array.");
        }
        if (!Reflect.defineProperty(record.owner, record.key, { ...d, value })) throw new Error("JavaScript property could not be written.");
        const actual = validate(record).value;
        if (!Object.is(actual, value)) throw new Error("JavaScript write verification failed.");
        return actual;
      },
    };
  };
})();
