const popupHarnessState = {
  createdTabs: [],
  reloadedTabs: [],
  closed: false,
};

window.close = () => {
  popupHarnessState.closed = true;
};

globalThis.browser = {
  runtime: {
    getURL(path) {
      return new URL(`../${path}`, location.href).href;
    },
    async sendMessage(message) {
      if (message.kind !== "getTabSummary" || message.tabId !== 77) {
        throw new Error("Unexpected popup summary request.");
      }
      return {
        connected: true,
        frameCount: 1,
        instanceCount: 1,
        ruffleCount: 1,
        totalMemoryBytes: 4.5 * 1024 * 1024,
      };
    },
  },
  tabs: {
    async query() {
      return [{ id: 77, url: "https://bubblebox.com/civilizations-wars" }];
    },
    async create(options) {
      popupHarnessState.createdTabs.push(options);
      return { id: 78, ...options };
    },
    async reload(tabId) {
      popupHarnessState.reloadedTabs.push(tabId);
    },
  },
};
