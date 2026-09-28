import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { classifySwf } from "./assets.mjs";
import { createFirefoxResponseCollector, flushResponseCaptures } from "./response-capture.mjs";
import { browserPath } from "../browser-path.mjs";
import { connectTransport, stopBrowserProcess, waitForDebugger } from "./transport.mjs";

const firefoxUuid = "6aed3a66-90e3-4c30-b580-2154d88ce676";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const keys = {
  ArrowLeft: ["\uE012", "ArrowLeft", 37], ArrowUp: ["\uE013", "ArrowUp", 38],
  ArrowRight: ["\uE014", "ArrowRight", 39], ArrowDown: ["\uE015", "ArrowDown", 40],
  Enter: ["\uE007", "Enter", 13], Escape: ["\uE00C", "Escape", 27],
  Space: [" ", " ", 32], " ": [" ", " ", 32], Tab: ["\uE004", "Tab", 9],
  Shift: ["\uE008", "Shift", 16], Control: ["\uE009", "Control", 17],
};

/** Disposable real browser; extensionDirectory omitted means a clean baseline. */
export async function launchBrowser({ browser, extensionDirectory, headed = false, noSandbox = false, artifactDir, viewport = { width: 1280, height: 900 } } = {}) {
  if (!["firefox", "chrome", "chromium"].includes(browser)) throw new Error(`Unknown browser: ${browser}`);
  const firefox = browser === "firefox";
  const executable = browserPath(firefox ? "firefox" : "chrome");
  const profile = await mkdtemp(join(tmpdir(), `hack-engine-games-${browser}-`));
  const logs = [];
  const pages = new Set();
  const contexts = new Map();
  const preloadScripts = [];
  const resources = [];
  const responseBodies = new Map();
  const pendingResources = new Set();
  const childTargets = new Map();
  const pendingTargets = new Set();
  const sessionPages = new Map();
  let initializeTarget;
  let captureFirefoxResponse;
  const recordResource = (item) => {
    resources.push({ time: new Date().toISOString(), ...item });
    if (resources.length > 20000) resources.splice(0, 1000);
    return resources.at(-1);
  };
  let child;
  let wire;
  let extensionOrigin;
  let version;
  let closing;
  const processGroup = process.platform !== "win32";
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      wire?.close();
      try {
        if (child) await stopBrowserProcess(child, { processGroup });
        await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } finally {
        if (artifactDir) {
          await mkdir(artifactDir, { recursive: true });
          await writeFile(join(artifactDir, "browser-log.json"), JSON.stringify(logs, null, 2));
        }
      }
    })();
    return closing;
  }
  try {
    if (firefox) {
      let extensionId = "hack-engine@abduljawada.github.io";
      if (extensionDirectory) {
        const manifest = JSON.parse(await readFile(join(extensionDirectory, "manifest.json"), "utf8"));
        extensionId = manifest.browser_specific_settings?.gecko?.id || manifest.applications?.gecko?.id || extensionId;
      }
      await writeFile(join(profile, "user.js"), [
        `user_pref("extensions.webextensions.uuids", ${JSON.stringify(JSON.stringify({ [extensionId]: firefoxUuid }))});`,
        'user_pref("browser.shell.checkDefaultBrowser", false);',
        'user_pref("browser.tabs.warnOnClose", false);',
        'user_pref("media.volume_scale", "0.0");',
      ].join("\n"));
    }
    const args = firefox ? [
      ...(!headed ? ["--headless"] : []), "--remote-allow-system-access", "--no-remote",
      "--profile", profile, "--remote-debugging-port=0", "about:blank",
    ] : [
      ...(!headed ? ["--headless=new"] : []), "--disable-background-networking", "--disable-component-update",
      "--disable-default-apps", "--mute-audio", "--enable-unsafe-extension-debugging", "--no-first-run",
      "--disable-background-timer-throttling", "--disable-renderer-backgrounding",
      ...(noSandbox ? ["--no-sandbox"] : []), "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
    ];
    child = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"], detached: processGroup });
    const socketUrl = await waitForDebugger(child, {
      pattern: firefox ? /WebDriver BiDi listening on (ws:\/\/[^\s]+)/ : /DevTools listening on (ws:\/\/[^\s]+)/,
      logs,
    });
    const endpoint = new URL(socketUrl);
    if (firefox && endpoint.pathname === "/") endpoint.pathname = "/session";
    wire = connectTransport(endpoint.href, {
      onEvent: (event) => {
        if (event.method === "Target.attachedToTarget" && event.params.targetInfo.type === "iframe") {
          const task = initializeTarget(event.params, event.sessionId)
            .catch((error) => logs.push({ type: "frame-attachment", error: error.message }))
            .finally(() => pendingTargets.delete(task));
          pendingTargets.add(task);
        } else if (event.method === "Target.detachedFromTarget") {
          childTargets.delete(event.params.sessionId);
          sessionPages.delete(event.params.sessionId);
        } else if (event.method === "Network.responseReceived") {
          const { response, frameId, type, requestId } = event.params;
          const resource = recordResource({ context: frameId, sessionId: event.sessionId, requestId, type,
            url: response.url, status: response.status, mimeType: response.mimeType });
          if (/\.(?:swf|wasm)(?:[?#]|$)|ruffle[^?#]*\.js(?:[?#]|$)/i.test(response.url)) {
            responseBodies.set(`${event.sessionId}:${requestId}`, resource);
          }
        } else if (event.method === "Network.loadingFinished") {
          const key = `${event.sessionId}:${event.params.requestId}`;
          const resource = responseBodies.get(key);
          if (resource) {
            if (event.params.encodedDataLength > 64 * 1024 * 1024) {
              resource.hashUnavailable = "Response exceeds the 64 MiB observation limit";
              responseBodies.delete(key);
            } else {
              const task = wire.call("Network.getResponseBody", { requestId: event.params.requestId }, event.sessionId)
                .then(({ body, base64Encoded }) => {
                  const bytes = Buffer.from(body, base64Encoded ? "base64" : "utf8");
                  resource.sha256 = createHash("sha256").update(bytes).digest("hex");
                  resource.bytes = bytes.length;
                  if (/\.swf(?:[?#]|$)/i.test(resource.url)) {
                    try { resource.independentlyParsedAvm = classifySwf(bytes); }
                    catch(error) { resource.classificationError = error.message; }
                  }
                }).catch((error) => { resource.hashUnavailable = error.message; })
                .finally(() => { responseBodies.delete(key); pendingResources.delete(task); });
              pendingResources.add(task);
            }
          }
        } else if (event.method === "Network.loadingFailed") {
          const key = `${event.sessionId}:${event.params.requestId}`;
          const resource = responseBodies.get(key);
          if (resource) {
            resource.hashUnavailable = `Response loading failed: ${event.params.errorText || "unknown network error"}`;
            responseBodies.delete(key);
          }
        } else if (event.method === "network.responseCompleted") {
          const { response, context, request } = event.params;
          const resource = recordResource({ context, requestId: request.request, url: response.url,
            status: response.status, mimeType: response.mimeType });
          if (captureFirefoxResponse) {
            const task = captureFirefoxResponse({ request, response }, resource)
              .finally(() => pendingResources.delete(task));
            pendingResources.add(task);
          }
        } else if (event.method === "network.fetchError") {
          recordResource({ context: event.params.context, url: event.params.request.url, error: event.params.errorText });
        }
        if (event.method === "Runtime.executionContextCreated" && event.params.context.auxData?.isDefault) {
          contexts.set(`${event.sessionId}:${event.params.context.auxData.frameId}`, event.params.context.id);
        } else if (event.method === "Runtime.executionContextDestroyed") {
          for (const [key, value] of contexts) if (key.startsWith(`${event.sessionId}:`) && value === event.params.executionContextId) contexts.delete(key);
        } else if (event.method === "Runtime.executionContextsCleared") {
          for (const key of contexts.keys()) if (key.startsWith(`${event.sessionId}:`)) contexts.delete(key);
        }
        if (/^(log\.|Runtime\.(consoleAPICalled|exceptionThrown)|Log\.)/.test(event.method || "")) {
          logs.push({ time: new Date().toISOString(), type: "page", ...event });
        }
      },
    });
    if (firefox) {
      const session = await wire.call("session.new", { capabilities: { alwaysMatch: { browserName: "firefox" } } });
      version = `Firefox ${session.capabilities.browserVersion}`;
      captureFirefoxResponse = await createFirefoxResponseCollector(wire);
      await wire.call("session.subscribe", { events: ["log.entryAdded", "network.responseCompleted", "network.fetchError"] });
      if (extensionDirectory) {
        await wire.call("webExtension.install", { extensionData: { type: "path", path: resolve(extensionDirectory) } });
        extensionOrigin = `moz-extension://${firefoxUuid}`;
      }
    } else {
      version = (await wire.call("Browser.getVersion")).product;
      if (extensionDirectory) {
        const installed = await wire.call("Extensions.loadUnpacked", { path: resolve(extensionDirectory) });
        extensionOrigin = `chrome-extension://${installed.id}`;
      }
    }

    const call = (page, method, params, options) => wire.call(method, params, page.sessionId, options);
    initializeTarget = async ({ sessionId, targetInfo }, parentSessionId) => {
      const parentPage = sessionPages.get(parentSessionId);
      const page = { targetId: targetInfo.targetId, sessionId, frameId: targetInfo.targetId,
        url: targetInfo.url, topPage: parentPage?.topPage || parentPage, parentPage };
      childTargets.set(sessionId, page);
      sessionPages.set(sessionId, page);
      try {
        await call(page, "Page.enable");
        await call(page, "Runtime.enable");
        await call(page, "Network.enable");
        await call(page, "Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
        for (const source of preloadScripts) await call(page, "Page.addScriptToEvaluateOnNewDocument", { source });
      } finally {
        await call(page, "Runtime.runIfWaitingForDebugger");
      }
    };
    async function evaluate(page, expression, options) {
      if (page.accessible === false) throw new Error(page.blockerReason);
      if (firefox) {
        // BiDi remote values encode maps/objects differently from CDP; normalize through JSON.
        const result = await wire.call("script.evaluate", {
          expression: `Promise.resolve((0,eval)(${JSON.stringify(expression)})).then(value => JSON.stringify(value === undefined ? null : value))`,
          target: { context: page.context }, awaitPromise: true,
        }, undefined, options);
        if (result.type === "exception") throw new Error(result.exceptionDetails?.text || "Browser JavaScript exception");
        return result.result?.value === undefined ? null : JSON.parse(result.result.value);
      }
      const contextId = page.frameId ? contexts.get(`${page.sessionId}:${page.frameId}`) : undefined;
      if (page.frameId && contextId === undefined) throw new Error("Frame execution context is no longer available; refresh the frame list");
      const result = await call(page, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true,
        ...(page.frameId ? { contextId } : {}),
      }, options);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result?.value ?? null;
    }
    async function navigate(page, url, { waitUntil = "domcontentloaded", timeoutMs = 30000 } = {}) {
      if (!["domcontentloaded", "load"].includes(waitUntil)) throw new Error(`Invalid navigation wait: ${waitUntil}`);
      page.requestedUrl = url;
      if (firefox) {
        await wire.call("browsingContext.navigate", { context: page.context, url,
          wait: waitUntil === "load" ? "complete" : "interactive" }, undefined, { timeoutMs });
        page.url = await evaluate(page, "location.href");
      }
      else {
        const result = await call(page, "Page.navigate", { url });
        if (result.errorText) throw new Error(`Navigation failed: ${result.errorText}`);
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          try {
            const { frameTree } = await call(page, "Page.getFrameTree");
            if ((!result.loaderId || frameTree.frame.loaderId === result.loaderId) &&
                await evaluate(page, waitUntil === "load" ? "document.readyState === 'complete'" : "document.readyState !== 'loading'")) {
              page.url = await evaluate(page, "location.href");
              return;
            }
          } catch (error) {
            if (!/context|navigat/i.test(error.message)) throw error;
          }
          await delay(50);
        }
        throw new Error(`Page navigation timed out: ${url}`);
      }
    }
    async function newPage(url = "about:blank", { background = false } = {}) {
      let page;
      if (firefox) {
        const created = await wire.call("browsingContext.create", { type: "tab", background });
        page = { context: created.context, url: "about:blank" };
        pages.add(page);
        if (viewport) await wire.call("browsingContext.setViewport", { context: page.context, viewport, devicePixelRatio: 1 });
      } else {
        const created = await wire.call("Target.createTarget", { url: "about:blank", background });
        const attached = await wire.call("Target.attachToTarget", { targetId: created.targetId, flatten: true });
        page = { targetId: created.targetId, sessionId: attached.sessionId, url: "about:blank" };
        pages.add(page);
        sessionPages.set(page.sessionId, page);
        await call(page, "Page.enable");
        await call(page, "Runtime.enable");
        await call(page, "Log.enable");
        await call(page, "Network.enable");
        await call(page, "Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
        if (viewport) await call(page, "Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false });
        for (const source of preloadScripts) await call(page, "Page.addScriptToEvaluateOnNewDocument", { source });
      }
      await navigate(page, url);
      return page;
    }
    async function activate(page) {
      page = page.topPage || page;
      // Firefox BiDi cannot activate privileged extension contexts. This only
      // selects the packaged controls tab; extension operations still use its UI.
      if (firefox && page.url?.startsWith('moz-extension://')) await evaluate(page, `(async () => {
        const tab = await browser.tabs.getCurrent();
        if (!Number.isInteger(tab?.id)) throw new Error('Extension controls tab is unavailable');
        await browser.tabs.update(tab.id, {active: true});
      })()`);
      else if (firefox) await wire.call("browsingContext.activate", { context: page.context });
      else await wire.call("Target.activateTarget", { targetId: page.targetId });
    }
    // CDP input is local to a renderer target. Same-process child frames need
    // an offset, while OOPIF targets already accept their own local coordinates.
    async function frameOffset(page, toTop = false) {
      if (!page.frameId) return { x: 0, y: 0 };
      const ownTarget = childTargets.get(page.sessionId);
      const isTargetRoot = ownTarget?.frameId === page.frameId;
      if (isTargetRoot && !toTop) return { x: 0, y: 0 };
      const owner = isTargetRoot ? ownTarget.parentPage : page;
      const { backendNodeId } = await call(owner, "DOM.getFrameOwner", { frameId: page.frameId });
      await call(owner, "DOM.scrollIntoViewIfNeeded", { backendNodeId });
      const { model } = await call(owner, "DOM.getBoxModel", { backendNodeId });
      const ancestor = toTop && owner.topPage && owner.sessionId !== owner.topPage.sessionId
        ? await frameOffset(childTargets.get(owner.sessionId), true) : { x: 0, y: 0 };
      return { x: model.content[0] + ancestor.x, y: model.content[1] + ancestor.y };
    }
    return {
      browser: firefox ? "firefox" : "chromium", version, logs, resources, newPage, navigate, evaluate, activate, close,
      async flushResources() { await flushResponseCaptures(responseBodies, pendingResources); return resources; },
      async frames(page) {
        const result = [];
        if (firefox) {
          const tree = await wire.call("browsingContext.getTree", { root: page.context });
          const walk = (node, parent) => {
            if (parent) result.push({ context: node.context, id: node.context, parent, topPage: page.topPage || page, url: node.url, accessible: true });
            for (const child of node.children || []) walk(child, node.context);
          };
          for (const root of tree.contexts) walk(root);
        } else {
          await Promise.all([...pendingTargets]);
          const root = page.topPage || page;
          const seen = new Set();
          for (const owner of [page, ...[...childTargets.values()].filter((child) => child.topPage === root)]) {
            let tree;
            try { tree = await call(owner, "Page.getFrameTree"); }
            catch { continue; } // Frame can disappear during an ad refresh.
            const walk = (node, parent) => {
              const id = node.frame.id;
              if (parent || owner !== page) {
                const actual = [...childTargets.values()].find((child) => contexts.has(`${child.sessionId}:${id}`)) || owner;
                const accessible = contexts.has(`${actual.sessionId}:${id}`);
                if (!seen.has(id)) {
                  seen.add(id);
                  result.push({ targetId: actual.targetId, sessionId: actual.sessionId, frameId: id,
                    id, parent: parent || node.frame.parentId, topPage: root, url: node.frame.url, accessible,
                    ...(!accessible ? { blockerReason: "Iframe has no available default execution context" } : {}),
                  });
                }
              }
              for (const child of node.childFrames || []) walk(child, id);
            };
            walk(tree.frameTree);
          }
        }
        return result;
      },
      async preload(source) {
        preloadScripts.push(source);
        if (firefox) await wire.call("script.addPreloadScript", { functionDeclaration: `() => {\n${source}\n}` });
        else for (const page of [...pages, ...childTargets.values()]) await call(page, "Page.addScriptToEvaluateOnNewDocument", { source });
      },
      async key(page, key, { type = "press" } = {}) {
        if (!["press", "down", "up"].includes(type)) throw new Error(`Invalid key action: ${type}`);
        const [bidiKey, cdpKey, code] = keys[key] || [key, key, key.toUpperCase().charCodeAt(0)];
        await activate(page);
        if (firefox) {
          const actions = [];
          if (type !== "up") actions.push({ type: "keyDown", value: bidiKey });
          if (type === "press") actions.push({ type: "pause", duration: 80 });
          if (type !== "down") actions.push({ type: "keyUp", value: bidiKey });
          await wire.call("input.performActions", { context: page.context, actions: [{ type: "key", id: "game-keyboard", actions }] });
        } else {
          const params = { key: cdpKey, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
          if (type !== "up") await call(page, "Input.dispatchKeyEvent", { ...params, type: "keyDown", ...(cdpKey.length === 1 ? { text: cdpKey } : {}) });
          if (type === "press") await delay(80);
          if (type !== "down") await call(page, "Input.dispatchKeyEvent", { ...params, type: "keyUp" });
        }
      },
      async click(page, x, y) {
        await activate(page);
        if (firefox) await wire.call("input.performActions", {
          context: page.context,
          actions: [{ type: "pointer", id: "game-mouse", parameters: { pointerType: "mouse" }, actions: [
            { type: "pointerMove", x: Math.round(x), y: Math.round(y), duration: 0, origin: "viewport" },
            { type: "pause", duration: 150 },
            { type: "pointerDown", button: 0 }, { type: "pause", duration: 100 }, { type: "pointerUp", button: 0 },
          ] }],
        });
        else {
          const offset = await frameOffset(page);
          x += offset.x; y += offset.y;
          await call(page, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
          // Let canvas games update their hovered target before pressing.
          await delay(150);
          await call(page, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
          await delay(100);
          await call(page, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
        }
      },
      async setPixelRatio(page, ratio) {
        if (!Number.isFinite(ratio) || ratio < 1 || ratio > 4) throw new Error('Screenshot pixel ratio must be between 1 and 4');
        const dimensions = await evaluate(page.topPage || page, '({width:innerWidth,height:innerHeight})');
        if (firefox) await wire.call('browsingContext.setViewport', {context: page.topPage?.context || page.context, devicePixelRatio: ratio});
        else await call(page.topPage || page, 'Emulation.setDeviceMetricsOverride', {...dimensions, deviceScaleFactor: ratio, mobile: false});
      },
      async screenshot(page, path) {
        let result;
        if (firefox) result = await wire.call("browsingContext.captureScreenshot", {
          context: page.context, origin: "viewport", format: { type: "image/png" },
        });
        else if (page.frameId) {
          const { x, y } = await frameOffset(page, true);
          const dimensions = await evaluate(page, "({width:innerWidth,height:innerHeight})");
          const root = page.topPage || page;
          const scroll = await evaluate(root, "({x:scrollX,y:scrollY})");
          logs.push({ type: "frame-screenshot", frame: page.frameId, path, x, y, ...dimensions, scroll });
          result = await call(root, "Page.captureScreenshot", { format: "png", captureBeyondViewport: false,
            clip: { x: x + scroll.x, y: y + scroll.y, ...dimensions, scale: 1 },
          });
        } else result = await call(page, "Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, Buffer.from(result.data, "base64"));
        return path;
      },
      async closePage(page) {
        if (firefox) await wire.call("browsingContext.close", { context: page.context });
        else await wire.call("Target.closeTarget", { targetId: page.targetId });
        pages.delete(page);
      },
      async openControls(gamePage) {
        if (!extensionOrigin) throw new Error("Cannot open controls in a baseline browser without the extension");
        gamePage = gamePage.topPage || gamePage;
        gamePage.url = await evaluate(gamePage, "location.href");
        await activate(gamePage);
        const popupUrl = `${extensionOrigin}/popup/popup.html?sidebar=1`;
        const controls = await newPage(popupUrl, { background: true });
        const gameTabId = await evaluate(controls, `(async () => {
          const api = globalThis.browser ?? globalThis.chrome;
          const tabs = await api.tabs.query({ active: true });
          const matches = tabs.filter(tab => tab.url === ${JSON.stringify(gamePage.url)});
          if (matches.length !== 1) throw new Error('Cannot uniquely identify the active game tab');
          return matches[0].id;
        })()`);
        if (!Number.isInteger(gameTabId)) throw new Error("Game tab was not found by the extension");
        controls.gameTabId = gameTabId;
        await navigate(controls, `${popupUrl}&tabId=${gameTabId}`);
        await activate(gamePage);
        return controls;
      },
      async stopWorker() {
        if (firefox) throw new Error("Background service-worker recovery is Chromium-only");
        const page = [...pages].find((item) => item.url.startsWith(extensionOrigin || "chrome-extension://"));
        if (!page) throw new Error("Open extension controls before stopping its worker");
        await call(page, "ServiceWorker.enable");
        await call(page, "ServiceWorker.stopAllWorkers");
      },
    };
  } catch (error) {
    await close().catch((cleanupError) => { error.message += `; cleanup: ${cleanupError.message}`; });
    throw error;
  }
}
