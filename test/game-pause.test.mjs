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
      calls, api, inputState: { keyHeld: false, pointerHeld: false }, ruffle: () => supported ? api : {},
      paused: () => legacy ? !api.isPlaying : api.suspended };
  }
  const metadata = (player) => emit(documentListeners, "loadedmetadata", { target: player });
  function capture(...players) {
    const instance = new context.WebAssembly.Instance(wasm, { wbg: { [imported]: () => players.forEach(metadata) } });
    instance.exports.ruffle_notify();
    return [...records.keys()].at(-1);
  }
  function input(player, type = "click") {
    const event = { target: player, defaultPrevented: false, propagationStopped: false,
      composedPath: () => [{ nodeName: "BUTTON" }, player, window],
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.propagationStopped = true; },
    };
    emit(listeners, type, event);
    if (!event.propagationStopped) {
      if (type === "keydown") player.inputState.keyHeld = true;
      if (type === "keyup") player.inputState.keyHeld = false;
      if (["pointerdown", "mousedown", "touchstart"].includes(type)) player.inputState.pointerHeld = true;
      if (["pointerup", "mouseup", "touchend"].includes(type)) player.inputState.pointerHeld = false;
      // Ruffle resumes on the Play overlay's click, not on release events.
      if (type === "click") {
        if ("suspended" in player.api) player.api.suspended = false;
        else player.api.isPlaying = true;
      }
    }
    return event;
  }
  return { messages, records, player, capture, metadata, command, settle, input,
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

for (const legacy of [false, true]) {
  test(`owned ${legacy ? "legacy" : "current"} pause blocks player input until Resume`, async () => {
    const h = setup(), player = h.player({ legacy }), unrelated = h.player({ legacy });
    const instanceId = h.capture(player);
    await h.command({ kind: "setGamePaused", instanceId, paused: true });
    for (const type of ["pointerdown", "mousedown", "click", "dblclick", "touchstart", "keydown", "keypress"]) {
      const event = h.input(player, type);
      assert.equal(event.defaultPrevented, true, type);
      assert.equal(event.propagationStopped, true, type);
      assert.equal(player.paused(), true, type);
      assert.equal(h.input(unrelated, type).propagationStopped, false, `unrelated ${type}`);
    }
    await h.command({ kind: "setGamePaused", instanceId, paused: false });
    assert.equal(h.input(player).propagationStopped, false);
  });
}
test("scan ownership guards input and releases it after cancellation", async () => {
  const h = setup(), player = h.player(), instanceId = h.capture(player);
  await h.command(scan(instanceId));
  assert.equal(h.input(player).propagationStopped, true);
  assert.equal(player.paused(), true);
  await h.command({ kind: "cancelScan", targetRequestId: "scan" });
  await h.drain();
  assert.equal(h.input(player).propagationStopped, false);
});
test("input guard survives a scan nested in manual pause, then clears on disconnect", async () => {
  const h = setup(), player = h.player(), instanceId = h.capture(player);
  await h.command({ kind: "setGamePaused", instanceId, paused: true });
  await h.command(scan(instanceId)); await h.drain();
  assert.equal(h.input(player).propagationStopped, true);
  await h.command({ kind: "bridgeDisconnected" });
  assert.equal(h.input(player).propagationStopped, false);
});
test("a game-owned pause is not protected after the scan lease ends", async () => {
  const h = setup(), player = h.player({ paused: true }), instanceId = h.capture(player);
  assert.equal(h.input(player).propagationStopped, false);
  player.api.suspended = true;
  await h.command(scan(instanceId));
  assert.equal(h.input(player).propagationStopped, true);
  await h.drain();
  assert.equal(player.paused(), true);
  assert.equal(h.input(player).propagationStopped, false);
});

test("keys and buttons held before Pause can release without resuming or sticking", async () => {
  const h = setup(), player = h.player(), instanceId = h.capture(player);
  h.input(player, "keydown"); h.input(player, "pointerdown");
  assert.deepEqual(player.inputState, { keyHeld: true, pointerHeld: true });
  await h.command({ kind: "setGamePaused", instanceId, paused: true });
  for (const type of ["keyup", "pointerup", "mouseup", "touchend"]) {
    const event = h.input(player, type);
    assert.equal(event.defaultPrevented, false, type);
    assert.equal(event.propagationStopped, false, type);
    assert.equal(player.paused(), true, type);
  }
  assert.deepEqual(player.inputState, { keyHeld: false, pointerHeld: false });
  assert.equal(h.input(player, "click").propagationStopped, true, "release-generated activation stays blocked");
  await h.command({ kind: "setGamePaused", instanceId, paused: false });
  assert.deepEqual(player.inputState, { keyHeld: false, pointerHeld: false });
});

test("an older asynchronous reset cannot erase a newly started scan session", async () => {
  const h = setup(), player = h.player(), instanceId = h.capture(player);
  await h.command(scan(instanceId, { requestId: "first" })); await h.drain();
  // Reset enters asynchronous cleanup; a user may immediately start again.
  const resetting = h.command({ kind: "resetScan", instanceId, type: "i32", requestId: "reset-old" });
  const starting = h.command(scan(instanceId, { requestId: "second" }));
  await Promise.all([resetting, starting]); await h.drain();
  await h.command({ kind: "getSessionState" });
  const state = h.messages.filter(message => message.kind === "agentState").at(-1);
  assert.equal(state.session?.requestId, "second");
  assert.equal(state.session?.status, "complete");
  assert.ok(h.messages.some(message => message.kind === "scanResults" && message.requestId === "second"));
});
