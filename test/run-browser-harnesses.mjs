import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const baseUrl = process.argv[2] ?? "http://127.0.0.1:8765";
const allHarnesses = [
  ["exact scan", "/test/harness.html", 30_000],
  ["scan cancellation", "/test/scan-cancellation-harness.html", 90_000],
  ["freeze", "/test/freeze-harness.html", 30_000],
  ["watch diagnostics", "/test/watch-diagnostics-harness.html", 30_000],
  ["representation discovery", "/test/representation-discovery-harness.html", 90_000],
  ["candidate retention", "/test/candidate-retention-harness.html", 30_000],
  ["memory growth", "/test/memory-growth-harness.html", 30_000],
  ["advanced scan", "/test/advanced-scan-harness.html", 90_000],
  ["bridge payload", "/test/bridge-payload-harness.html", 30_000],
  ["panel watchdog", "/test/panel-watchdog-harness.html", 30_000],
  ["toolbar popup", "/test/popup-harness.html", 30_000],
  ["large unknown scan", "/test/large-unknown-harness.html", 240_000],
];
const requestedHarness = process.argv[3];
const requestedHarnesses = new Set(requestedHarness?.split(",").map((name) => name.trim()));
const harnesses = requestedHarness
  ? allHarnesses.filter(([name]) => requestedHarnesses.has(name))
  : allHarnesses;
if (harnesses.length === 0) {
  throw new Error(`Unknown harness: ${requestedHarness}`);
}

if (!requestedHarness) {
  for (const [name] of allHarnesses) {
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [process.argv[1], baseUrl, name], {
        stdio: "inherit",
      });
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  }
  process.exit(0);
}

const profileDirectory = mkdtempSync(join(tmpdir(), "ruffle-memory-harness-"));
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-gpu",
  "--no-first-run",
  "--no-sandbox",
  "--remote-debugging-port=0",
  `--user-data-dir=${profileDirectory}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

function waitForDebuggerUrl() {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Chrome did not expose a debugger URL.")), 15_000);
    chrome.stderr.setEncoding("utf8");
    chrome.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    chrome.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited before startup with code ${code}.`));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function pageSocketUrl(browserSocketUrl) {
  const { port } = new URL(browserSocketUrl);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    const page = targets.find((target) => target.type === "page");
    if (page?.webSocketDebuggerUrl) {
      return page.webSocketDebuggerUrl;
    }
    await delay(100);
  }
  throw new Error("Chrome did not create a page target.");
}

function connectCdp(url) {
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
    if (message.error) {
      reject(new Error(message.error.message));
    } else {
      resolve(message.result);
    }
  });

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Unable to connect to Chrome.")), {
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

async function readHarnessResult(cdp, url) {
  const result = await cdp.call("Runtime.evaluate", {
    expression: `(() => {
      if (location.href !== ${JSON.stringify(url)}) return null;
      return document.querySelector("#result, #harness-result")?.textContent ?? null;
    })()`,
    returnByValue: true,
  });
  return result.result?.value ?? null;
}

async function runHarness(cdp, name, path, timeoutMilliseconds) {
  const url = new URL(path, baseUrl).href;
  await cdp.call("Page.navigate", { url });
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const result = await readHarnessResult(cdp, url);
    if (typeof result === "string" && /^(PASS|FAIL):/.test(result)) {
      if (result.startsWith("FAIL:")) {
        throw new Error(`${name}: ${result}`);
      }
      console.log(`${name}: ${result}`);
      return;
    }
    await delay(200);
  }
  throw new Error(`${name}: did not complete within ${timeoutMilliseconds / 1000} seconds.`);
}

let cdp;
try {
  const browserSocketUrl = await waitForDebuggerUrl();
  cdp = connectCdp(await pageSocketUrl(browserSocketUrl));
  await cdp.call("Page.enable");
  for (const harness of harnesses) {
    await runHarness(cdp, ...harness);
  }
} finally {
  cdp?.close();
  chrome.kill("SIGTERM");
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3_000);
    chrome.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
  rmSync(profileDirectory, { recursive: true, force: true });
}
