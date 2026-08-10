import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const extensionDirectory = join(projectRoot, "dist", "chrome");
const harnessUrl = process.argv[2] ??
  "http://127.0.0.1:8765/test/firefox-extension-bridge-harness.html";
const profileDirectory = mkdtempSync(join(tmpdir(), "hack-engine-chrome-harness-"));
let chromeOutput = "";

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-gpu",
  "--enable-unsafe-extension-debugging",
  "--no-first-run",
  "--no-sandbox",
  "--remote-debugging-port=0",
  `--user-data-dir=${profileDirectory}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
chrome.stderr.setEncoding("utf8");
chrome.stderr.on("data", (chunk) => {
  chromeOutput += chunk;
});

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function waitForDebuggerUrl() {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () => reject(new Error(`Chrome did not expose a debugger URL. ${output.trim()}`)),
      20_000,
    );
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
      reject(new Error(`Chrome exited before startup with code ${code}. ${output.trim()}`));
    });
  });
}

function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 1;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
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

async function findPageSocket(browserSocketUrl) {
  const { port } = new URL(browserSocketUrl);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    const page = targets.find((target) => target.type === "page");
    if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    await delay(100);
  }
  throw new Error("Chrome did not expose a page target.");
}

async function readResult(cdp) {
  const result = await cdp.call("Runtime.evaluate", {
    expression: "document.querySelector('#result, #harness-result')?.textContent ?? null",
    returnByValue: true,
  });
  return result.result?.value ?? null;
}

let browserCdp;
let pageCdp;
try {
  const browserSocketUrl = await waitForDebuggerUrl();
  browserCdp = connectCdp(browserSocketUrl);
  const installedExtension = await browserCdp.call("Extensions.loadUnpacked", {
    path: extensionDirectory,
  });
  console.log(`Chrome loaded extension ${installedExtension.id}`);
  pageCdp = connectCdp(await findPageSocket(browserSocketUrl));
  await pageCdp.call("Page.enable");
  await pageCdp.call("Runtime.enable");
  await pageCdp.call("Page.navigate", { url: harnessUrl });

  const deadline = Date.now() + 30_000;
  let completed = false;
  while (Date.now() < deadline) {
    const result = await readResult(pageCdp);
    if (typeof result === "string" && /^(PASS|FAIL):/.test(result)) {
      if (result.startsWith("FAIL:")) throw new Error(result);
      console.log(result);
      completed = true;
      break;
    }
    await delay(200);
  }
  if (!completed) {
    const targets = await browserCdp.call("Target.getTargets");
    const targetSummary = targets.targetInfos
      .filter((target) => target.type !== "other")
      .map((target) => `${target.type}: ${target.title || "(untitled)"} — ${target.url || "(no URL)"}`)
      .join("\n");
    throw new Error(
      `Chrome extension bridge harness did not complete within 30 seconds.\nTargets:\n${targetSummary}\nChrome output:\n${chromeOutput.trim()}`,
    );
  }
} finally {
  pageCdp?.close();
  browserCdp?.close();
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
