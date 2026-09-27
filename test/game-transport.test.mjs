import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { connectTransport, stopBrowserProcess, waitForDebugger } from "./games/transport.mjs";

class FakeSocket extends EventTarget {
  static instances = [];
  sent = [];
  constructor() { super(); FakeSocket.instances.push(this); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.dispatchEvent(new Event("close")); }
  open() { this.dispatchEvent(new Event("open")); }
  receive(message) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) })); }
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
function connection(timeoutMs = 1000) {
  const transport = connectTransport("ws://test", { WebSocketImpl: FakeSocket, timeoutMs });
  const socket = FakeSocket.instances.at(-1);
  socket.open();
  return { transport, socket };
}

test("transport correlates concurrent replies and carries flattened CDP session IDs", async () => {
  const { transport, socket } = connection();
  try {
    const first = transport.call("Runtime.evaluate", { expression: "1" }, "page-session");
    const second = transport.call("Browser.getVersion");
    await flush();
    assert.equal(socket.sent[0].sessionId, "page-session");
    socket.receive({ id: socket.sent[1].id, result: { product: "browser" } });
    socket.receive({ id: socket.sent[0].id, result: { value: 1 } });
    assert.deepEqual(await first, { value: 1 });
    assert.deepEqual(await second, { product: "browser" });
  } finally { transport.close(); }
});

test("lost responses time out independently and late responses do not affect later calls", async () => {
  const { transport, socket } = connection(20);
  try {
    await assert.rejects(transport.call("Lost.command"), /Lost.command timed out/);
    const later = transport.call("Healthy.command");
    await flush();
    socket.receive({ id: socket.sent[0].id, result: "too late" });
    socket.receive({ id: socket.sent[1].id, result: "healthy" });
    assert.equal(await later, "healthy");
  } finally { transport.close(); }
});

test("disconnect rejects every in-flight command immediately and forbids future sends", async () => {
  const { transport, socket } = connection();
  const requests = [transport.call("A"), transport.call("B")];
  const rejected = requests.map((request) => assert.rejects(request, /disconnected/));
  await flush();
  socket.close();
  await Promise.all(rejected);
  await assert.rejects(transport.call("C"), /disconnected/);
  assert.equal(socket.sent.length, 2);
});

test("explicit compound-scenario timeout does not change the default for other requests", async () => {
  const { transport, socket } = connection(20);
  try {
    const extended = transport.call("Compound.scenario", {}, undefined, { timeoutMs: 200 });
    await assert.rejects(transport.call("Default.command"), /timed out after 20 ms/);
    socket.receive({ id: socket.sent[0].id, result: "finished" });
    assert.equal(await extended, "finished");
  } finally { transport.close(); }
});

test("startup handshake has its own timeout", async () => {
  const transport = connectTransport("ws://test", { WebSocketImpl: FakeSocket, timeoutMs: 20 });
  await assert.rejects(transport.call("session.new"), /connection timed out/);
  transport.close();
});

test("CDP and BiDi errors preserve method and error details", async () => {
  const { transport, socket } = connection();
  try {
    const cdp = assert.rejects(transport.call("CDP.command"), /CDP.command: denied/);
    await flush();
    socket.receive({ id: socket.sent.at(-1).id, error: { message: "denied" } });
    await cdp;
    const bidi = assert.rejects(transport.call("BiDi.command"), /BiDi.command: invalid argument: missing context/);
    await flush();
    socket.receive({ id: socket.sent.at(-1).id, type: "error", error: "invalid argument", message: "missing context" });
    await bidi;
  } finally { transport.close(); }
});

test("debugger discovery handles split output, spawn failures, and startup timeouts", async () => {
  function processStub() {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stderr.setEncoding = () => {};
    return child;
  }
  const logs = [];
  const child = processStub();
  const url = waitForDebugger(child, { pattern: /listening on (ws:\/\/[^\s]+)/, logs, timeoutMs: 1000 });
  child.stderr.emit("data", "noise\nlistening on ws://localhost:");
  child.stderr.emit("data", "42/session\n");
  assert.equal(await url, "ws://localhost:42/session");
  assert.equal(logs.length, 2);
  assert.equal(child.listenerCount("exit"), 0);
  const failure = processStub();
  const failed = assert.rejects(waitForDebugger(failure, { pattern: /never/, logs, timeoutMs: 1000 }), /ENOENT/);
  failure.emit("error", new Error("ENOENT"));
  await failed;
  const hung = processStub();
  await assert.rejects(waitForDebugger(hung, { pattern: /never/, logs, timeoutMs: 20 }), /startup timed out/);
  assert.equal(hung.listenerCount("exit"), 0);
});

test("cleanup escalates to SIGKILL for a process ignoring SIGTERM", async () => {
  const child = new EventEmitter();
  child.pid = 123;
  const signals = [];
  child.kill = (signal) => {
    signals.push(signal);
    if (signal === "SIGKILL") setImmediate(() => { child.signalCode = signal; child.emit("exit"); });
  };
  await stopBrowserProcess(child, { graceMs: 20, killMs: 1000 });
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
  await stopBrowserProcess(child); // Repeated cleanup is harmless.
  assert.equal(signals.length, 2);
});

test("cleanup accepts a graceful exit without escalation and skips an exited process", async () => {
  const child = new EventEmitter();
  child.pid = 123;
  const signals = [];
  child.kill = (signal) => {
    signals.push(signal);
    setImmediate(() => { child.exitCode = 0; child.emit("exit"); });
  };
  await stopBrowserProcess(child, { graceMs: 1000 });
  assert.deepEqual(signals, ["SIGTERM"]);
  assert.equal(child.listenerCount("exit"), 0);
  await stopBrowserProcess(child);
  assert.deepEqual(signals, ["SIGTERM"]);
});

test("cleanup rejects if even SIGKILL cannot terminate the process", async () => {
  const child = new EventEmitter();
  child.pid = 123;
  child.kill = () => {};
  await assert.rejects(stopBrowserProcess(child, { graceMs: 10, killMs: 10 }), /survived SIGKILL; profile retained/);
  assert.equal(child.listenerCount("exit"), 0);
});
