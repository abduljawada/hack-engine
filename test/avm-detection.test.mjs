import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../page-agent.js", import.meta.url), "utf8");
const importName = "__wbg_setMetadata_test";
const text = (value) => [value.length, ...Buffer.from(value)];
const section = (id, bytes) => [id, bytes.length, ...bytes];
// Real Wasm, with the imported metadata callback re-exported for deterministic
// triggering. Each module owns one independent linear memory.
function moduleBytes({ start = false, returnsValue = false } = {}) {
  return new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, [1, 0x60, 0, ...(returnsValue ? [1, 0x7f] : [0])]),
    ...section(2, [1, ...text("wbg"), ...text(importName), 0, 0]),
    ...section(5, [1, 0, 1]),
    ...section(7, [2, ...text("memory"), 2, 0, ...text("ruffle_notify"), 0, 0]),
    ...(start ? section(8, [0]) : []),
  ]);
}

function setup() {
  const listeners = new Map(), documentListeners = new Map(), timers = new Map();
  const messages = [], records = new Map();
  let timerId = 0, now = 0;
  const add = (map, name, handler) => map.set(name, [...(map.get(name) || []), handler]);
  const emit = (map, name, event) => {
    for (const handler of map.get(name) || []) handler(event);
  };
  const context = vm.createContext({
    WebAssembly: Object.create(null, Object.getOwnPropertyDescriptors(WebAssembly)),
    Response, URL, console,
    location: { href: "https://example.test/game" }, navigator: {},
    document: {
      hidden: false,
      addEventListener: (name, handler) => add(documentListeners, name, handler),
      querySelectorAll: () => { throw new Error("Detection must not borrow frame-wide metadata"); },
    },
    setTimeout(callback, delay) {
      assert.equal(delay, 1000);
      const id = ++timerId;
      timers.set(id, { callback, due: now + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    addEventListener: (name, handler) => add(listeners, name, handler),
    postMessage(message) {
      const payload = message.payload;
      messages.push(payload);
      if (payload.instance) records.set(payload.instance.id, payload.instance);
    },
  });
  vm.runInContext("window = globalThis; self = globalThis", context);
  vm.runInContext(source, context);
  const metadataEvent = (player) => emit(documentListeners, "loadedmetadata", { target: player });
  const player = (isActionScript3) => ({
    isConnected: true,
    metadata: typeof isActionScript3 === "boolean" ? { isActionScript3 } : null,
    matches: () => true,
    ruffle() { return this; },
  });
  const instantiate = (callback, options) => new context.WebAssembly.Instance(
    new WebAssembly.Module(moduleBytes(options)), { wbg: { [importName]: callback } },
  );
  function tick(count = 1) {
    for (let i = 0; i < count; i++) {
      now += 1000;
      for (const [id, timer] of [...timers]) {
        if (timer.due <= now && timers.delete(id)) timer.callback();
      }
    }
  }
  return {
    context, messages, records, timers, player, metadataEvent, instantiate, tick,
    lifecycle: (name) => emit(listeners, name, { persisted: true }),
    kinds: () => [...records.values()].map((record) => record.avmKind),
  };
}

test("separate memories use only their associated players in the same frame", () => {
  const h = setup(), first = h.player(false), second = h.player(true);
  const a = h.instantiate(() => h.metadataEvent(first));
  const b = h.instantiate(() => h.metadataEvent(second));
  a.exports.ruffle_notify(); b.exports.ruffle_notify();
  assert.deepEqual(h.kinds(), ["avm1", "avm2"]);
  assert.equal(h.timers.size, 0);
  assert.equal(h.messages.filter((p) => p.kind === "instanceUpdated").length, 2);
});

test("a shared runtime with mixed associated players remains unknown", () => {
  const h = setup(), first = h.player(false), second = h.player(true);
  let current = first;
  const instance = h.instantiate(() => h.metadataEvent(current));
  instance.exports.ruffle_notify();
  assert.deepEqual(h.kinds(), ["avm1"]);
  current = second; instance.exports.ruffle_notify();
  assert.deepEqual(h.kinds(), ["unknown"]);
  h.tick(15);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.kinds(), ["unknown"]);
});

test("unrelated player events never supply a selected memory's AVM type", () => {
  const h = setup();
  h.instantiate(() => {});
  h.metadataEvent(h.player(true));
  h.tick(15);
  assert.deepEqual(h.kinds(), ["unknown"]);
  assert.equal(h.timers.size, 0);
});

test("a replacement player reusing memory does not inherit disconnected player metadata", () => {
  const h = setup(), first = h.player(false), second = h.player(true);
  let current = first;
  const instance = h.instantiate(() => h.metadataEvent(current));
  instance.exports.ruffle_notify();
  first.isConnected = false;
  current = second; instance.exports.ruffle_notify();
  assert.deepEqual(h.kinds(), ["avm2"]);
  assert.equal(h.timers.size, 0);
});

test("unknown metadata is retried after one second and stops on success", () => {
  const h = setup(), player = h.player();
  const instance = h.instantiate(() => h.metadataEvent(player));
  instance.exports.ruffle_notify();
  h.tick(2);
  assert.deepEqual(h.kinds(), ["unknown"]);
  player.metadata = { isActionScript3: true };
  h.tick();
  assert.deepEqual(h.kinds(), ["avm2"]);
  assert.equal(h.timers.size, 0);
  const updates = h.messages.length;
  h.tick(20);
  assert.equal(h.messages.length, updates);
});

test("fifteen retries exhaust the budget; a new movie event resets it", () => {
  const h = setup(), player = h.player();
  const instance = h.instantiate(() => h.metadataEvent(player));
  instance.exports.ruffle_notify();
  h.tick(14); assert.equal(h.timers.size, 1);
  h.tick(); assert.equal(h.timers.size, 0);
  player.metadata = { isActionScript3: false };
  h.tick(10); assert.deepEqual(h.kinds(), ["unknown"]);
  player.metadata = null;
  h.metadataEvent(player);
  assert.equal(h.timers.size, 1);
  h.tick(14); assert.equal(h.timers.size, 1);
  player.metadata = { isActionScript3: false };
  h.tick(); assert.deepEqual(h.kinds(), ["avm1"]);
  assert.equal(h.timers.size, 0);
});

test("pagehide cancels timers and pageshow resumes without renewing the budget", () => {
  const h = setup();
  h.instantiate(() => {});
  h.tick(10);
  h.lifecycle("pagehide"); assert.equal(h.timers.size, 0);
  h.tick(20);
  h.lifecycle("pageshow"); assert.equal(h.timers.size, 1);
  h.tick(4); assert.equal(h.timers.size, 1);
  h.tick(); assert.equal(h.timers.size, 0);
  h.lifecycle("pagehide"); h.lifecycle("pageshow");
  assert.equal(h.timers.size, 0);
});

test("metadata delivered by a Wasm start function is linked after capture", () => {
  const h = setup(), player = h.player(true);
  h.instantiate(() => h.metadataEvent(player), { start: true });
  assert.deepEqual(h.kinds(), ["avm2"]);
  assert.equal(h.timers.size, 0);
});

test("import wrapping preserves return values, receiver, exceptions and context cleanup", () => {
  const h = setup();
  let receiver = "unset";
  const instance = h.instantiate(function () { receiver = this; return 42; }, { returnsValue: true });
  assert.equal(instance.exports.ruffle_notify(), 42);
  assert.equal(receiver, undefined);
  const failure = new Error("metadata callback failed");
  const broken = h.instantiate(() => { throw failure; });
  assert.throws(() => broken.exports.ruffle_notify(), (error) => error === failure);
  h.metadataEvent(h.player(true));
  h.tick();
  assert.deepEqual(h.kinds(), ["unknown", "unknown"]);
});

test("asynchronous and streaming instantiation retain player association", async () => {
  const h = setup(), first = h.player(false), second = h.player(true);
  const a = await h.context.WebAssembly.instantiate(moduleBytes(), {
    wbg: { [importName]: () => h.metadataEvent(first) },
  });
  const b = await h.context.WebAssembly.instantiateStreaming(new Response(moduleBytes(), {
    headers: { "Content-Type": "application/wasm" },
  }), { wbg: { [importName]: () => h.metadataEvent(second) } });
  a.instance.exports.ruffle_notify(); b.instance.exports.ruffle_notify();
  assert.deepEqual(h.kinds(), ["avm1", "avm2"]);
});

test("uninspectable imports fall back to native instantiation without breaking the game", () => {
  const h = setup();
  const imports = new Proxy({ wbg: { [importName]: () => 42 } }, {
    ownKeys() { throw new Error("No reflection allowed"); },
  });
  const instance = new h.context.WebAssembly.Instance(
    new WebAssembly.Module(moduleBytes({ returnsValue: true })), imports,
  );
  assert.equal(instance.exports.ruffle_notify(), 42);
});
