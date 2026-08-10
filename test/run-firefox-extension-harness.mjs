import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const firefoxPath = "/Applications/Firefox.app/Contents/MacOS/firefox";
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const extensionDirectory = join(projectRoot, "dist", "firefox");
const harnessUrl = process.argv[2] ??
  "http://127.0.0.1:8765/test/firefox-extension-bridge-harness.html";
const profileDirectory = mkdtempSync(join(tmpdir(), "hack-engine-firefox-harness-"));

const firefox = spawn(firefoxPath, [
  "--headless",
  "--no-remote",
  "--profile",
  profileDirectory,
  "--remote-debugging-port=0",
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForDebuggerUrl() {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () => reject(new Error(`Firefox did not expose WebDriver BiDi. ${output.trim()}`)),
      20_000,
    );
    firefox.stderr.setEncoding("utf8");
    firefox.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/WebDriver BiDi listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        const url = new URL(match[1]);
        if (url.pathname === "/") {
          url.pathname = "/session";
        }
        resolve(url.href);
      }
    });
    firefox.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Firefox exited before startup with code ${code}. ${output.trim()}`));
    });
  });
}

function connectBidi(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 1;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) {
      return;
    }
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.type === "error") {
      reject(new Error(`${message.error}: ${message.message}`));
    } else {
      resolve(message.result);
    }
  });

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Unable to connect to Firefox.")), {
      once: true,
    });
  });

  return {
    async call(method, params = {}) {
      await ready;
      const id = sequence++;
      const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return response;
    },
    close() {
      socket.close();
    },
  };
}

async function readResult(bidi, context) {
  const result = await bidi.call("script.evaluate", {
    expression: "document.querySelector('#result, #harness-result')?.textContent ?? null",
    target: { context },
    awaitPromise: false,
  });
  return result.result?.type === "string" ? result.result.value : null;
}

let bidi;
let installedExtension;
try {
  bidi = connectBidi(await waitForDebuggerUrl());
  const session = await bidi.call("session.new", {
    capabilities: { alwaysMatch: { browserName: "firefox" } },
  });
  console.log(`Firefox ${session.capabilities.browserVersion}`);

  installedExtension = await bidi.call("webExtension.install", {
    extensionData: { type: "path", path: extensionDirectory },
  });

  const tree = await bidi.call("browsingContext.getTree", { maxDepth: 0 });
  const context = tree.contexts[0]?.context;
  if (!context) {
    throw new Error("Firefox did not expose a browsing context.");
  }
  await bidi.call("browsingContext.navigate", {
    context,
    url: harnessUrl,
    wait: "complete",
  });

  const deadline = Date.now() + 30_000;
  let completed = false;
  while (Date.now() < deadline) {
    const result = await readResult(bidi, context);
    if (typeof result === "string" && /^(PASS|FAIL):/.test(result)) {
      if (result.startsWith("FAIL:")) {
        throw new Error(result);
      }
      console.log(result);
      completed = true;
      break;
    }
    await delay(200);
  }
  if (!completed) {
    throw new Error("Firefox extension bridge harness did not complete within 30 seconds.");
  }
} finally {
  if (bidi && installedExtension?.extension) {
    await bidi.call("webExtension.uninstall", {
      extension: installedExtension.extension,
    }).catch(() => {});
  }
  await bidi?.call("session.end").catch(() => {});
  bidi?.close();
  firefox.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3_000);
    firefox.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  rmSync(profileDirectory, { recursive: true, force: true });
}
