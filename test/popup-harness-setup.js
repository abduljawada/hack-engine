const popupHarnessState = {
  createdTabs: [],
  createdWindows: [],
  updatedWindows: [],
  popupWindows: [],
  queriedTabs: 0,
  retrievedTabs: [],
  sidebarPanels: [],
  sidebarOpenCount: 0,
  sidebarCloseCount: 0,
  sidebarSetPanelSettled: false,
  sidebarOpenedDuringUserAction: false,
  reloadedTabs: [],
  commands: [],
  closed: false,
};

window.close = () => {
  popupHarnessState.closed = true;
};

function createEvent() {
  const listeners = new Set();
  return {
    addListener(listener) { listeners.add(listener); },
    emit(value) { for (const listener of listeners) listener(value); },
  };
}

function createPopupPort() {
  const onMessage = createEvent();
  const onDisconnect = createEvent();
  const instance = {
    id: "memory-1",
    memoryBytes: 4.5 * 1024 * 1024,
    looksLikeRuffle: true,
    avmKind: "avm2",
    hint: "ruffle_web.wasm",
  };
  const emitPayload = (payload) => onMessage.emit({
    kind: "pageMessage",
    frameId: 0,
    url: "https://bubblebox.com/civilizations-wars",
    payload,
  });
  queueMicrotask(() => {
    onMessage.emit({ kind: "quickSession", session: null });
    onMessage.emit({ kind: "frameConnected", frameId: 0, url: instance.url });
  });
  return {
    onMessage,
    onDisconnect,
    disconnect() {},
    postMessage(message) {
      const payload = message.payload;
      popupHarnessState.commands.push({ ...message, payload: { ...payload } });
      if (payload.kind === "listInstances") {
        queueMicrotask(() => emitPayload({
          kind: "instanceList",
          requestId: payload.requestId,
          instances: [instance],
        }));
      } else if (payload.kind === "memoryScan") {
        queueMicrotask(() => {
          emitPayload({
            kind: "scanProgress",
            requestId: payload.requestId,
            inspected: 2048,
            total: 4096,
          });
          emitPayload({
            kind: "scanResults",
            requestId: payload.requestId,
            instanceId: instance.id,
            type: payload.type,
            multiplier: 1,
            avmKind: "avm2",
            searchedTypes: ["i32", "u32", "f64"],
            total: 1,
            preview: [{ address: 4096, type: "i32", value: 8, displayValue: 8 }],
            allCandidates: false,
          });
        });
      } else if (payload.kind === "writeValue") {
        queueMicrotask(() => emitPayload({
          kind: "writeComplete",
          requestId: payload.requestId,
          instanceId: instance.id,
          type: payload.type,
          address: payload.address,
          value: Number(payload.rawValue),
          displayValue: Number(payload.rawValue),
        }));
      } else if (payload.kind === "setFreeze") {
        queueMicrotask(() => emitPayload({
          kind: "freezeChanged",
          requestId: payload.requestId,
          instanceId: instance.id,
          type: payload.type,
          address: payload.address,
          enabled: payload.enabled,
        }));
      }
    },
  };
}

globalThis.browser = {
  runtime: {
    getURL(path) {
      return new URL(`../${path}`, location.href).href;
    },
    connect() {
      return createPopupPort();
    },
    async sendMessage(message) {
      if (message.kind === "getQuickSession" && message.tabId === 77) {
        return null;
      }
      if (message.kind !== "getTabSummary" || message.tabId !== 77) {
        throw new Error("Unexpected popup request.");
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
      popupHarnessState.queriedTabs += 1;
      return [{ id: 77, windowId: 10, url: "https://bubblebox.com/civilizations-wars" }];
    },
    async get(tabId) {
      popupHarnessState.retrievedTabs.push(tabId);
      return { id: tabId, windowId: 10, url: "https://bubblebox.com/civilizations-wars" };
    },
    async create(options) {
      popupHarnessState.createdTabs.push(options);
      return { id: 78, ...options };
    },
    async reload(tabId) {
      popupHarnessState.reloadedTabs.push(tabId);
    },
  },
  windows: {
    async getAll() {
      return popupHarnessState.popupWindows;
    },
    async create(options) {
      const browserWindow = {
        id: 91,
        type: options.type,
        tabs: [{ id: 92, url: options.url }],
      };
      popupHarnessState.createdWindows.push(options);
      popupHarnessState.popupWindows.push(browserWindow);
      return browserWindow;
    },
    async update(windowId, options) {
      popupHarnessState.updatedWindows.push({ windowId, options });
      return popupHarnessState.popupWindows.find(({ id }) => id === windowId);
    },
  },
  sidebarAction: {
    setPanel(options) {
      popupHarnessState.sidebarPanels.push(options);
      return new Promise((resolve) => {
        queueMicrotask(() => {
          popupHarnessState.sidebarSetPanelSettled = true;
          resolve();
        });
      });
    },
    async open() {
      popupHarnessState.sidebarOpenedDuringUserAction = !popupHarnessState.sidebarSetPanelSettled;
      popupHarnessState.sidebarOpenCount += 1;
    },
    async close() {
      popupHarnessState.sidebarCloseCount += 1;
    },
  },
};
