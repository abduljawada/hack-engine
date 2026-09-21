import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const source = readFileSync(new URL("../background.js", import.meta.url), "utf8");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function event() { const listeners = new Set(); return { addListener(fn) { listeners.add(fn); }, removeListener(fn) { listeners.delete(fn); }, emit(...args) { for (const fn of [...listeners]) fn(...args); } }; }
function port(name, sender) { return { name, sender, onMessage: event(), onDisconnect: event(), sent: [], postMessage(message) { this.sent.push(structuredClone(message)); } }; }
function background(store) {
  const runtime = { onMessage: event(), onConnect: event(), getURL: (path) => `moz-extension://test/${path}` };
  const tabs = { onRemoved: event() };
  const storage = { session: { async get() { return structuredClone(store); }, async set(value) { Object.assign(store, structuredClone(value)); } } };
  vm.runInNewContext(source, { browser: { runtime, tabs, storage }, structuredClone, console });
  return { runtime, tabs, connect(peer) { runtime.onConnect.emit(peer); } };
}
const watch = { frameId: 0, instanceId: "doc-A.1", type: "i32", address: 4096, multiplier: 1, label: "Score" };
const state = (id = "doc-A.1") => ({ kind: "pageMessage", payload: { kind: "agentState", instances: [{ id, memoryBytes: 65536 }], session: { updatedAt: 12, requestId: "scan:1", instanceId: id, status: "complete", canRefine: true, request: { type: "i32" }, results: { kind: "scanResults", instanceId: id, total: 1, preview: [{ address: 4096 }] } }, freezes: [{ instanceId: id, type: "i32", address: 4096 }], lastWrite: { instanceId: id, type: "i32", address: 4096 } } });
test("background restart recovers metadata and authoritative agent state, then invalidates a reloaded document", async () => {
  const store = {};
  let bg = background(store); await tick();
  const ui = port("hack-popup:77"); bg.connect(ui);
  ui.onMessage.emit({ kind: "workspaceCommand", action: "upsertWatch", watch, select: true });
  await tick(); assert.equal(store.liveWorkspaces[77].watches[0].label, "Score");
  bg = background(store); await tick();
  const reopened = port("hack-popup:77"); bg.connect(reopened);
  const bridge = port("ruffle-frame-bridge", { tab: { id: 77 }, frameId: 0, url: "https://example.test/game" }); bg.connect(bridge);
  bridge.onMessage.emit(state());
  const restored = reopened.sent.filter((message) => message.kind === "workspaceState").at(-1).workspace;
  assert.equal(restored.watches.length, 1); assert.equal(restored.frozenKeys.length, 1); assert.equal(restored.lastWrite.instanceId, "doc-A.1");
  assert.equal(reopened.sent.filter((message) => message.kind === "quickSession").at(-1).session.results.total, 1);
  const replacement = port("ruffle-frame-bridge", bridge.sender); bg.connect(replacement); replacement.onMessage.emit(state("doc-B.1"));
  bridge.onMessage.emit(state()); // Late messages from a dead document must not win.
  const current = reopened.sent.filter((message) => message.kind === "workspaceState").at(-1).workspace;
  assert.equal(current.watches.length, 0); assert.equal(current.lastWrite.instanceId, "doc-B.1");
  assert.ok(current.frozenKeys.every((key) => key.includes("doc-B.1")));
  bg.tabs.onRemoved.emit(77); await tick(); assert.equal(store.liveWorkspaces[77], undefined);
});
test("another game frame cannot replace the selected newer scan session", async () => {
  const bg = background({}); await tick(); const ui = port("hack-popup:77"); bg.connect(ui);
  const a = port("ruffle-frame-bridge", { tab: { id: 77 }, frameId: 1 }); bg.connect(a);
  const b = port("ruffle-frame-bridge", { tab: { id: 77 }, frameId: 2 }); bg.connect(b);
  const newer = state("A.1"); newer.payload.session.updatedAt = 20; a.onMessage.emit(newer);
  b.onMessage.emit(state("B.1"));
  assert.equal(ui.sent.filter((message) => message.kind === "quickSession").at(-1).session.instanceId, "A.1");
});
