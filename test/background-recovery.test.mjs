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

test("AVM metadata updates reach controls without replacing the existing scan", async () => {
  const bg = background({}); await tick();
  const ui = port("hack-popup:77"); bg.connect(ui);
  const bridge = port("ruffle-frame-bridge", { tab: { id: 77 }, frameId: 0 }); bg.connect(bridge);
  bridge.onMessage.emit(state());
  const before = ui.sent.filter((message) => message.kind === "quickSession").at(-1).session;
  const instance = { id: "doc-A.1", memoryBytes: 65536, looksLikeRuffle: true, avmKind: "avm2" };
  bridge.onMessage.emit({ kind: "pageMessage", payload: { kind: "instanceUpdated", instance } });
  assert.deepEqual(ui.sent.at(-1).payload.instance, instance);
  let summary;
  bg.runtime.onMessage.emit({ kind: "getTabSummary", tabId: 77 }, {}, (value) => { summary = value; });
  assert.equal(summary.ruffleCount, 1);
  assert.deepEqual(ui.sent.filter((message) => message.kind === "quickSession").at(-1).session, before);
});

const workspaceState = (ui) => ui.sent.filter((message) => message.kind === "workspaceState").at(-1).workspace;
const diagnosticKey = "0:doc-A.1:i32:4096";
async function diagnosticSetup() {
  const store = {};
  const bg = background(store); await tick();
  const ui = port("hack-popup:77"); const peer = port("hack-popup:77"); bg.connect(ui); bg.connect(peer);
  const bridge = port("ruffle-frame-bridge", { tab: { id: 77 }, frameId: 0 }); bg.connect(bridge);
  bridge.onMessage.emit(state());
  const write = (requestId) => ui.onMessage.emit({ kind: "routeCommand", frameId: 0,
    payload: { kind: "writeValue", ...watch, requestId, rawValue: "99" } });
  const emit = (kind, requestId, fields = {}) => bridge.onMessage.emit({ kind: "pageMessage", payload: { kind, ...watch, requestId, ...fields } });
  return { bg, store, ui, peer, bridge, write, emit };
}
test("final diagnostics replace provisional verification on every surface and ignore superseded writes", async () => {
  const { ui, peer, write, emit } = await diagnosticSetup();
  write("write:1");
  assert.equal(workspaceState(peer).diagnostics[diagnosticKey].state, "checking");
  emit("writeVerified", "write:1", { persisted: true, actualValue: 99 });
  assert.equal(workspaceState(ui).diagnostics[diagnosticKey].state, "checking");
  emit("writeDiagnostic", "write:1", { classification: "restored", samples: [
    { stage: "75ms", elapsedMs: 75, value: 99, matches: true },
    { stage: "250ms", elapsedMs: 250, value: 8, matches: false },
  ] });
  assert.equal(workspaceState(peer).diagnostics[diagnosticKey].state, "restored");
  assert.match(workspaceState(peer).diagnostics[diagnosticKey].detail, /250ms \(250 ms\): changed/);
  emit("writeVerified", "write:1", { persisted: true, actualValue: 99 });
  assert.equal(workspaceState(ui).diagnostics[diagnosticKey].value, 8);
  write("write:2");
  emit("writeDiagnostic", "write:1", { classification: "persistent", samples: [] });
  assert.equal(workspaceState(peer).diagnostics[diagnosticKey].requestId, "write:2");
  assert.equal(workspaceState(peer).diagnostics[diagnosticKey].state, "checking");
  emit("writeDiagnostic", "write:2", { classification: "unavailable", samples: [{ stage: "250ms", error: "Memory unavailable" }] });
  assert.equal(workspaceState(peer).diagnostics[diagnosticKey].state, "unavailable");
  assert.equal(workspaceState(peer).diagnostics[diagnosticKey].value, undefined);
});
test("diagnostics are transient and invalidated by document reload, disconnect and restore", async () => {
  const { bg, store, ui, bridge, write, emit } = await diagnosticSetup();
  write("write:1"); await tick();
  assert.equal(store.liveWorkspaces[77].diagnostics, undefined);
  const restarted = background(store); await tick(); const fresh = port("hack-popup:77"); restarted.connect(fresh);
  assert.deepEqual(workspaceState(fresh).diagnostics, {});
  ui.onMessage.emit({ kind: "routeCommand", frameId: 0, payload: { kind: "restoreWrite", ...watch, requestId: "restore:1" } });
  assert.equal(workspaceState(ui).diagnostics[diagnosticKey].requestId, "write:1");
  emit("writeRestored", "restore:1");
  assert.deepEqual(workspaceState(ui).diagnostics, {});
  emit("writeDiagnostic", "write:1", { classification: "persistent", samples: [] });
  assert.deepEqual(workspaceState(ui).diagnostics, {});
  write("write:2"); bridge.onMessage.emit(state("doc-B.1"));
  assert.deepEqual(workspaceState(ui).diagnostics, {});
  write("write:3"); bridge.onDisconnect.emit();
  assert.deepEqual(workspaceState(ui).diagnostics, {});
  const legacy = port("ruffle-panel:77"); bg.connect(legacy); assert.equal(legacy.sent.length, 0);
});
test("write failures become rejected and unrelated frame errors do not change diagnostics", async () => {
  const { bg, ui, write, emit } = await diagnosticSetup();
  write("write:1");
  const other = port("ruffle-frame-bridge", { tab: { id: 77 }, frameId: 1 }); bg.connect(other);
  other.onMessage.emit({ kind: "pageMessage", payload: { kind: "error", requestId: "write:1", message: "Other frame" } });
  assert.equal(workspaceState(ui).diagnostics[diagnosticKey].state, "checking");
  emit("error", "write:1", { message: "Address out of bounds" });
  assert.equal(workspaceState(ui).diagnostics[diagnosticKey].state, "rejected");
});
test("batch watch acknowledgements report accepted and skipped counts at capacity", async () => {
  const bg = background({}); await tick(); const ui = port("hack-popup:77"); bg.connect(ui);
  const watches = Array.from({ length: 258 }, (_, address) => ({ ...watch, address: address * 4 }));
  ui.onMessage.emit({ kind: "workspaceCommand", action: "mergeWatches", requestId: "batch:1", watches });
  assert.equal(workspaceState(ui).watches.length, 256);
  assert.deepEqual(ui.sent.at(-1), { kind: "workspaceCommandResult", requestId: "batch:1", accepted: 256, skipped: 2 });
  ui.onMessage.emit({ kind: "workspaceCommand", action: "upsertWatch", requestId: "single:1", watch });
  assert.equal(ui.sent.at(-1).skipped, 1);
  ui.onMessage.emit({ kind: "workspaceCommand", action: "upsertWatch", requestId: "single:2", watch: { ...watches[0], label: "Updated" }, select: true });
  assert.equal(ui.sent.at(-1).accepted, 1);
  assert.equal(workspaceState(ui).watches[0].label, "Updated");
});
test("refinement failures retain completed candidates and concurrent scan requests cannot replace the active scan", async () => {
  const { ui, peer, bridge } = await diagnosticSetup();
  const command = { kind: "routeCommand", frameId: 0, payload: { kind: "memoryScan", requestId: "refine:1", instanceId: watch.instanceId, type: "i32", refine: true } };
  ui.onMessage.emit(command);
  peer.onMessage.emit({ ...command, payload: { ...command.payload, requestId: "refine:2" } });
  assert.equal(peer.sent.at(-1).payload.kind, "error");
  assert.equal(bridge.sent.filter((message) => message.payload.requestId === "refine:2").length, 0);
  bridge.onMessage.emit({ kind: "pageMessage", payload: { kind: "scanCancelled", requestId: "refine:1" } });
  let session = ui.sent.filter((message) => message.kind === "quickSession").at(-1).session;
  assert.equal(session.status, "complete"); assert.equal(session.results.total, 1); assert.equal(session.canRefine, true);
  ui.onMessage.emit({ ...command, payload: { ...command.payload, requestId: "refine:3" } });
  bridge.onMessage.emit({ kind: "pageMessage", payload: { kind: "error", requestId: "refine:3", message: "Storage unavailable" } });
  session = ui.sent.filter((message) => message.kind === "quickSession").at(-1).session;
  assert.equal(session.status, "complete"); assert.equal(session.results.total, 1);
});
test("transient diagnostics are bounded and keep watched entries", async () => {
  const { ui } = await diagnosticSetup();
  ui.onMessage.emit({ kind: "workspaceCommand", action: "upsertWatch", watch });
  for (let address = 0; address < 270; address++) ui.onMessage.emit({ kind: "routeCommand", frameId: 0,
    payload: { kind: "writeValue", ...watch, address: address ? address * 4 : watch.address, requestId: `write:${address}`, rawValue: "2" } });
  const entries = workspaceState(ui).diagnostics;
  assert.equal(Object.keys(entries).length, 257);
  assert.equal(entries[diagnosticKey].requestId, "write:0");
});

test("mixed JavaScript and Wasm watches survive recovery and lose stale document identities", async () => {
  const store = {};
  let bg = background(store); await tick();
  const ui = port("hack-popup:77"); bg.connect(ui);
  const jsWatch = { kind: "javascript", frameId: 0, instanceId: "doc-A.js", type: "number", address: 1, path: ["game", "score"], displayPath: "game.score", label: "JS score" };
  ui.onMessage.emit({ kind: "workspaceCommand", action: "mergeWatches", watches: [watch, jsWatch] });
  assert.equal(workspaceState(ui).watches.length, 2);
  assert.equal(workspaceState(ui).watches[1].kind, "javascript");
  assert.equal(workspaceState(ui).watches[1].multiplier, 1);
  await tick();
  bg = background(store); await tick();
  const reopened = port("hack-popup:77"); bg.connect(reopened);
  const bridge = port("ruffle-frame-bridge", { tab: { id: 77 }, frameId: 0 }); bg.connect(bridge);
  const sameDocument = state(); sameDocument.payload.instances.push({ id: "doc-A.js", kind: "javascript" });
  bridge.onMessage.emit(sameDocument);
  assert.equal(workspaceState(reopened).watches.length, 2);
  reopened.onMessage.emit({ kind: "routeCommand", frameId: 0, payload: { kind: "resolveJavaScriptPaths", requestId: "resolve:1", instanceId: "doc-A.js", paths: [["game", "score"]] } });
  assert.equal(bridge.sent.at(-1).payload.kind, "resolveJavaScriptPaths");
  bridge.onMessage.emit({ kind: "pageMessage", payload: { kind: "javaScriptPathsResolved", requestId: "resolve:1", instanceId: "doc-A.js", entries: [jsWatch], errors: [] } });
  assert.equal(reopened.sent.at(-1).payload.entries[0].displayPath, "game.score");
  bridge.onMessage.emit(state("doc-B.1"));
  assert.equal(workspaceState(reopened).watches.length, 0);
});
