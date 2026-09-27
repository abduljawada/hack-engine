import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../page-agent.js", import.meta.url), "utf8");
const imported = "__wbg_setMetadata_test";
const text = (value) => [value.length, ...Buffer.from(value)];
const section = (id, bytes) => [id, bytes.length, ...bytes];
const wasm = new WebAssembly.Module(new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0,
  ...section(1, [1, 0x60, 0, 0]),
  ...section(2, [1, ...text("wbg"), ...text(imported), 0, 0]),
  ...section(5, [1, 0, 1]),
  ...section(7, [2, ...text("memory"), 2, 0, ...text("ruffle_notify"), 0, 0]),
]));

function setup() {
  const listeners = new Map(), documentListeners = new Map();
  const messages = [], records = new Map(), tasks = [];
  const add = (map, name, fn) => map.set(name, [...(map.get(name) || []), fn]);
  const emit = (map, name, event) => (map.get(name) || []).forEach((fn) => fn(event));
  const context = vm.createContext({
    WebAssembly: Object.create(null, Object.getOwnPropertyDescriptors(WebAssembly)),
    console, URL, performance,
    navigator: {}, location: { href: "https://example.test/game" },
    document: { hidden: false, addEventListener: (name, fn) => add(documentListeners, name, fn) },
    addEventListener: (name, fn) => add(listeners, name, fn),
    setTimeout: () => 1, clearTimeout() {}, cancelAnimationFrame() {},
    MessageChannel: class {
      constructor() {
        this.port1 = {};
        this.port2 = { postMessage: () => tasks.push(() => this.port1.onmessage()) };
      }
    },
    postMessage({ payload }) {
      messages.push(payload);
      if (payload.instance) records.set(payload.instance.id, payload.instance);
    },
  });
  vm.runInContext("window = globalThis; self = globalThis", context);
  const window = vm.runInContext("window", context);
  vm.runInContext(source, context);
  const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  async function command(payload) {
    emit(listeners, "message", { source: window, data: {
      channel: "ruffle-memory-inspector:v1", direction: "to-page", payload,
    } });
    await settle();
  }
  function player({ legacy = false, paused = false, supported = true } = {}) {
    const calls = [];
    const api = legacy ? {
      isPlaying: !paused,
      pause() { calls.push("pause"); this.isPlaying = false; },
      play() { calls.push("play"); this.isPlaying = true; },
    } : {
      suspended: paused,
      suspend() { calls.push("suspend"); this.suspended = true; },
      resume() { calls.push("resume"); this.suspended = false; },
    };
    return { isConnected: true, metadata: { isActionScript3: true }, matches: () => true,
      calls, api, ruffle: () => supported ? api : {},
      paused: () => legacy ? !api.isPlaying : api.suspended };
  }
  const metadata = (player) => emit(documentListeners, "loadedmetadata", { target: player });
  function capture(...players) {
    const instance = new context.WebAssembly.Instance(wasm, { wbg: { [imported]: () => players.forEach(metadata) } });
    instance.exports.ruffle_notify();
    return [...records.keys()].at(-1);
  }
  return { messages, records, player, capture, metadata, command, settle,
    lifecycle: (name) => emit(listeners, name, { persisted: true }),
    async drain() {
      for (let i = 0; i < 100; i++) {
        await settle();
        if (!tasks.length) return;
        tasks.shift()();
      }
      throw new Error("Scan did not finish");
    },
  };
}

for (const legacy of [false, true]) {
  test(`manual pause and resume use ${legacy ? "legacy pause/play" : "current suspend/resume"} API on associated player only`, async () => {
    const h = setup(), player = h.player({ legacy }), unrelated = h.player();
    const instanceId = h.capture(player);
    h.metadata(unrelated);
    await h.command({ kind: "setGamePaused", instanceId, paused: true });
    assert.equal(player.paused(), true);
    assert.equal(h.records.get(instanceId).manuallyPaused, true);
    assert.equal(h.records.get(instanceId).pauseSupported, true);
    assert.deepEqual(unrelated.calls, []);
    await h.command({ kind: "setGamePaused", instanceId, paused: false });
    assert.equal(player.paused(), false);
    assert.equal(h.records.get(instanceId).manuallyPaused, false);
    assert.equal(h.records.get(instanceId).gamePaused, false);
    assert.deepEqual(unrelated.calls, []);
  });
}

test("unsupported players cannot pause and unrelated players cannot provide support", async () => {
  const h = setup(), player = h.player({ supported: false }), unrelated = h.player();
  const instanceId = h.capture(player);
  h.metadata(unrelated);
  assert.equal(h.records.get(instanceId).pauseSupported, false);
  await h.command({ kind: "setGamePaused", instanceId, paused: true, requestId: "unsupported" });
  assert.match(h.messages.find((p) => p.kind === "error").message, /supported Ruffle/);
  assert.deepEqual(unrelated.calls, []);
});

const scan = (instanceId, extra = {}) => ({ kind: "memoryScan", requestId: "scan", instanceId,
  type: "i32", rawValue: "42", pauseWhileScanning: true, ...extra });

for (const outcome of ["success", "error", "cancel"]) {
  test(`scan restores a running player after ${outcome}`, async () => {
    const h = setup(), player = h.player(), instanceId = h.capture(player);
    await h.command(scan(instanceId, outcome === "error" ? { type: "invalid" } : {}));
    if (outcome !== "error") assert.equal(player.paused(), true);
    if (outcome === "cancel") await h.command({ kind: "cancelScan", targetRequestId: "scan" });
    await h.drain();
    assert.equal(player.paused(), false);
    assert.deepEqual(player.calls, ["suspend", "resume"]);
    const kind = outcome === "success" ? "scanResults" : outcome === "error" ? "error" : "scanCancelled";
    assert.ok(h.messages.some((p) => p.kind === kind), JSON.stringify(h.messages.map((p) => p.kind)));
  });
}

for (const manuallyPaused of [false, true]) {
  test(`scan preserves ${manuallyPaused ? "inspector manual" : "pre-existing game"} pause`, async () => {
    const h = setup(), player = h.player({ paused: !manuallyPaused }), instanceId = h.capture(player);
    if (manuallyPaused) await h.command({ kind: "setGamePaused", instanceId, paused: true });
    await h.command(scan(instanceId));
    await h.drain();
    assert.equal(player.paused(), true);
    assert.ok(!player.calls.includes("resume"));
    assert.equal(h.records.get(instanceId).manuallyPaused, manuallyPaused);
    await h.command({ kind: "setGamePaused", instanceId, paused: false });
    assert.equal(player.paused(), false);
  });
}

test("scans with the toggle off leave the game running", async () => {
  const h = setup(), player = h.player(), instanceId = h.capture(player);
  await h.command(scan(instanceId, { pauseWhileScanning: false }));
  await h.drain();
  assert.deepEqual(player.calls, []);
});

for (const lifecycle of ["bridgeDisconnected", "pagehide"]) {
  for (const duringScan of [false, true]) {
    test(`${lifecycle} restores ${duringScan ? "scan" : "manual"} pause`, async () => {
      const h = setup(), player = h.player(), instanceId = h.capture(player);
      await h.command(duringScan ? scan(instanceId) : { kind: "setGamePaused", instanceId, paused: true });
      assert.equal(player.paused(), true);
      if (lifecycle === "pagehide") h.lifecycle("pagehide");
      else await h.command({ kind: lifecycle });
      await h.drain();
      assert.equal(player.paused(), false);
      if (duringScan) assert.ok(h.messages.some((p) => p.kind === "scanCancelled"));
    });
  }
}

test("failure to pause one associated player restores players already paused", async () => {
  const h = setup(), first = h.player(), second = h.player();
  second.api.suspend = () => { throw new Error("Player failed"); };
  const instanceId = h.capture(first, second);
  await h.command({ kind: "setGamePaused", instanceId, paused: true });
  assert.equal(first.paused(), false);
  assert.equal(second.paused(), false);
  assert.equal(h.records.get(instanceId).manuallyPaused, false);
  assert.ok(h.messages.some((p) => p.kind === "error"));
});

test("manual pause changes during a scan are rejected without releasing its pause", async () => {
  const h = setup(), player = h.player(), instanceId = h.capture(player);
  await h.command(scan(instanceId));
  await h.command({ kind: "setGamePaused", instanceId, paused: false, requestId: "manual" });
  assert.equal(player.paused(), true);
  assert.match(h.messages.find((p) => p.kind === "error" && p.requestId === "manual").message, /scan to finish/);
  await h.drain();
  assert.equal(player.paused(), false);
});

test("explicit Resume retries a failed automatic resume and releases its orphaned scan lease", async () => {
  const h = setup(), player = h.player(), instanceId = h.capture(player);
  const resume = player.api.resume;
  let attempts = 0;
  player.api.resume = function () {
    if (++attempts === 1) throw new Error("Transient resume failure");
    return resume.call(this);
  };
  await h.command(scan(instanceId));
  await h.drain();
  assert.equal(attempts, 1);
  assert.equal(player.paused(), true);
  assert.match(h.messages.find((p) => p.kind === "error").message, /Unable to resume/);
  await h.command({ kind: "setGamePaused", instanceId, paused: false });
  assert.equal(attempts, 2);
  assert.equal(player.paused(), false);
  assert.equal(h.records.get(instanceId).gamePaused, false);
  // A fresh manual lease must remain fully usable after orphan recovery.
  await h.command({ kind: "setGamePaused", instanceId, paused: true });
  assert.equal(player.paused(), true);
  await h.command({ kind: "setGamePaused", instanceId, paused: false });
  assert.equal(player.paused(), false);
  assert.equal(attempts, 3);
});
