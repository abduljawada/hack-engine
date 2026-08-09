(() => {
  "use strict";

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const elements = {
    hostname: document.querySelector("#hostname"),
    statusDot: document.querySelector("#status-dot"),
    statusTitle: document.querySelector("#status-title"),
    statusDetail: document.querySelector("#status-detail"),
    connectionState: document.querySelector(".connection-state"),
    memorySummary: document.querySelector("#memory-summary"),
    memoryCount: document.querySelector("#memory-count"),
    memorySize: document.querySelector("#memory-size"),
    openInspector: document.querySelector("#open-inspector"),
    refreshConnection: document.querySelector("#refresh-connection"),
    howItWorks: document.querySelector("#how-it-works"),
  };
  let activeTab = null;
  let pollTimer = null;

  function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
    }
    return `${Math.max(0, Math.round(bytes / 1024))} KiB`;
  }

  function hostnameFor(tab) {
    try {
      return new URL(tab.url).hostname || "Browser page";
    } catch {
      return "Browser page";
    }
  }

  function renderSummary(summary) {
    const detected = summary.instanceCount > 0;
    elements.statusDot.className = `status-dot ${detected ? "" : summary.connected ? "searching" : "offline"}`;
    elements.connectionState.classList.toggle("offline", !summary.connected);
    elements.openInspector.disabled = !activeTab?.id;
    elements.memorySummary.hidden = !detected;

    if (detected) {
      elements.statusTitle.textContent = summary.ruffleCount > 0
        ? "Ruffle memory detected"
        : "WebAssembly memory detected";
      elements.statusDetail.textContent = "Memory is available for inspection on this tab.";
      elements.memoryCount.textContent = `${summary.instanceCount} captured memor${
        summary.instanceCount === 1 ? "y" : "ies"
      }`;
      elements.memorySize.textContent = `${formatBytes(summary.totalMemoryBytes)} available`;
    } else if (summary.connected) {
      elements.statusTitle.textContent = "Connected to this tab";
      elements.statusDetail.textContent = "Waiting for an embedded WebAssembly memory to initialize.";
    } else {
      elements.statusTitle.textContent = "No connection yet";
      elements.statusDetail.textContent = "Reload this tab after installing or updating Hack Engine.";
    }
  }

  async function refreshSummary() {
    if (!activeTab?.id) {
      return;
    }
    try {
      const summary = await extensionApi.runtime.sendMessage({
        kind: "getTabSummary",
        tabId: activeTab.id,
      });
      renderSummary(summary || {
        connected: false,
        instanceCount: 0,
        ruffleCount: 0,
        totalMemoryBytes: 0,
      });
    } catch {
      renderSummary({ connected: false, instanceCount: 0, ruffleCount: 0, totalMemoryBytes: 0 });
    }
  }

  async function initialize() {
    const [tab] = await extensionApi.tabs.query({ active: true, currentWindow: true });
    activeTab = tab || null;
    elements.hostname.textContent = activeTab ? hostnameFor(activeTab) : "No active browser tab";
    await refreshSummary();
    pollTimer = setInterval(refreshSummary, 1000);
  }

  elements.openInspector.addEventListener("click", async () => {
    if (!activeTab?.id) {
      return;
    }
    const url = new URL(extensionApi.runtime.getURL("devtools/panel/panel.html"));
    url.searchParams.set("standalone", "1");
    url.searchParams.set("tabId", String(activeTab.id));
    await extensionApi.tabs.create({ url: url.href });
    window.close();
  });

  elements.refreshConnection.addEventListener("click", async () => {
    if (!activeTab?.id) {
      return;
    }
    elements.statusTitle.textContent = "Reloading this tab…";
    elements.statusDetail.textContent = "Hack Engine will reconnect when the page initializes.";
    await extensionApi.tabs.reload(activeTab.id);
  });

  elements.howItWorks.addEventListener("click", async () => {
    await extensionApi.tabs.create({
      url: "https://abduljawada.github.io/ruffle-memory-inspector/#capabilities",
    });
    window.close();
  });

  window.addEventListener("unload", () => clearInterval(pollTimer));
  initialize().catch(() => {
    elements.hostname.textContent = "Unable to read the active tab";
    renderSummary({ connected: false, instanceCount: 0, ruffleCount: 0, totalMemoryBytes: 0 });
  });
})();
