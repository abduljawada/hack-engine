// Existing extension regression, running through the same browser adapter as real games.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extensionUiScenario } from "../extension-ui-scenario.mjs";
import { launchBrowser } from "./browser.mjs";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, description, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await delay(100);
  }
  throw new Error(`${description} did not complete within ${timeout / 1000} seconds`);
}

export async function runFixtureHarness({ browser, url, noSandbox = true, headed = false, artifactDir } = {}) {
  const session = await launchBrowser({
    browser, noSandbox, headed, artifactDir,
    extensionDirectory: join(repoRoot, "dist", browser === "firefox" ? "firefox" : "chrome"),
  });
  try {
    console.log(session.version);
    const page = await session.newPage(url);
    const readResult = () => session.evaluate(page, "document.querySelector('#result, #harness-result')?.textContent ?? null");
    const result = await waitFor(async () => {
      const text = await readResult();
      return typeof text === "string" && /^(PASS|FAIL):/.test(text) ? text : null;
    }, `${browser} extension bridge harness`);
    if (result.startsWith("FAIL:")) {
      const storage = await session.evaluate(page, "navigator.storage.estimate()").catch(() => "unavailable");
      throw new Error(`${result}\nStorage estimate: ${JSON.stringify(storage)}`);
    }
    console.log(result);
    await session.navigate(page, new URL("/test/fixtures/game/index.html", url).href);
    await waitFor(async () => (await readResult())?.startsWith("Ready"), "Game test fixture", 10_000);
    const controls = await session.openControls(page);
    // This existing compound scenario contains several separately bounded UI waits.
    console.log(await session.evaluate(controls, extensionUiScenario, { timeoutMs: 90_000 }));
    if (browser !== "firefox") {
      await session.stopWorker();
      await delay(1200);
      const recovered = await session.evaluate(controls, `(async () => {
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          const session = await chrome.runtime.sendMessage({ kind: 'getQuickSession', tabId: ${controls.gameTabId} });
          if (session?.status === 'complete' && session.results?.total === 1 && !document.querySelector('#advanced-scan').disabled) return true;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('Scan session failed to recover after worker termination');
      })()`);
      if (recovered !== true) throw new Error("Worker recovery failed");
      console.log("PASS: live Chromium service-worker termination preserves the completed scan and reconnects its controls.");
    }
  } catch (error) {
    error.message += `\nRecent browser output:\n${JSON.stringify(session.logs.slice(-10), null, 2)}`;
    throw error;
  } finally {
    await session.close();
  }
}

export function harnessOptions(browser, argv = process.argv.slice(2)) {
  return {
    browser,
    url: argv.find((arg) => !arg.startsWith("--")) || "http://127.0.0.1:8765/test/firefox-extension-bridge-harness.html",
    noSandbox: !argv.includes("--sandbox"),
    headed: argv.includes("--headed"),
  };
}
