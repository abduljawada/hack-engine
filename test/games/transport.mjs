// Shared CDP/BiDi transport. No command or startup operation may wait forever.
export function connectTransport(url, {
  timeoutMs = 20_000,
  WebSocketImpl = globalThis.WebSocket,
  onEvent = () => {},
} = {}) {
  const socket = new WebSocketImpl(url);
  const pending = new Map();
  let sequence = 1;
  let closedError;
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // A failed handshake can precede the first call.
  ready.catch(() => {});
  const startupTimer = setTimeout(() => terminate(new Error(`Debugger connection timed out after ${timeoutMs} ms`)), timeoutMs);
  function terminate(error) {
    if (closedError) return;
    closedError = error;
    clearTimeout(startupTimer);
    rejectReady(error);
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    pending.clear();
    try { socket.close(); } catch { /* Already disconnected. */ }
  }
  socket.addEventListener("open", () => { clearTimeout(startupTimer); resolveReady(); });
  socket.addEventListener("error", () => terminate(new Error("Debugger socket error")));
  socket.addEventListener("close", () => terminate(new Error("Debugger disconnected")));
  socket.addEventListener("message", (event) => {
    let message;
    try { message = JSON.parse(event.data); }
    catch { terminate(new Error("Debugger returned malformed JSON")); return; }
    if (message.id == null) { onEvent(message); return; }
    const entry = pending.get(message.id);
    if (!entry) return; // Late response to a timed-out request.
    clearTimeout(entry.timer);
    pending.delete(message.id);
    if (message.error) {
      const detail = typeof message.error === "string" ? `${message.error}: ${message.message}` : message.error.message;
      entry.reject(new Error(`${entry.method}: ${detail}`));
    } else entry.resolve(message.result);
  });
  return {
    async call(method, params = {}, sessionId, { timeoutMs: commandTimeoutMs = timeoutMs } = {}) {
      await ready;
      if (closedError) throw closedError;
      const id = sequence++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`${method} timed out after ${commandTimeoutMs} ms`));
        }, commandTimeoutMs);
        pending.set(id, { resolve, reject, timer, method });
        try { socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
        catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    },
    close() { terminate(new Error("Debugger transport closed")); },
  };
}

export function waitForDebugger(child, { pattern, logs, timeoutMs = 20_000 }) {
  return new Promise((resolve, reject) => {
    let output = "";
    const done = (error, url) => {
      clearTimeout(timer);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      child.stderr.removeListener("data", onData);
      error ? reject(error) : resolve(url);
    };
    const onError = (error) => done(error);
    const onExit = (code, signal) => done(new Error(`Browser exited before startup (${signal || code}). ${output.slice(-3000)}`));
    const onData = (chunk) => {
      output += chunk;
      // Pipe chunks may split the middle of the WebSocket URL; only parse complete log lines.
      const match = output.slice(0, output.lastIndexOf("\n") + 1).match(pattern);
      if (match) done(null, match[1]);
    };
    const timer = setTimeout(() => done(new Error(`Browser debugger startup timed out after ${timeoutMs} ms. ${output.slice(-3000)}`)), timeoutMs);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => logs.push({ time: new Date().toISOString(), type: "browser", text: String(chunk) }));
    child.stderr.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

export async function stopBrowserProcess(child, { graceMs = 3_000, killMs = 3_000, processGroup = false } = {}) {
  if (!child.pid) return;
  if (!processGroup && (child.exitCode != null || child.signalCode != null)) return;
  const kill = (signal) => {
    try { processGroup ? process.kill(-child.pid, signal) : child.kill(signal); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
  };
  const exited = (timeout) => new Promise((resolve) => {
    if (child.exitCode != null || child.signalCode != null) { resolve(true); return; }
    const onExit = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => { child.removeListener("exit", onExit); resolve(false); }, timeout);
    child.once("exit", onExit);
  });
  kill("SIGTERM");
  if (await exited(graceMs)) {
    // The leader can exit before renderer children; remove the remainder of this disposable group.
    if (processGroup) kill("SIGKILL");
    return;
  }
  kill("SIGKILL");
  if (!await exited(killMs)) throw new Error(`Browser process ${child.pid} survived SIGKILL; profile retained`);
}
