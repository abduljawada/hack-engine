function panelListenerSlot() {
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    emit(message) {
      for (const listener of listeners) {
        listener(message);
      }
    },
  };
}

const panelHarnessState = {
  commands: [],
  watchdogs: new Map(),
  nextWatchdogId: 1_000_000,
};

const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);

globalThis.setTimeout = (callback, delay, ...args) => {
  if (delay === 15_000) {
    const id = panelHarnessState.nextWatchdogId++;
    panelHarnessState.watchdogs.set(id, () => callback(...args));
    return id;
  }
  return nativeSetTimeout(callback, delay, ...args);
};

globalThis.clearTimeout = (id) => {
  if (panelHarnessState.watchdogs.delete(id)) {
    return;
  }
  nativeClearTimeout(id);
};

panelHarnessState.port = {
  onMessage: panelListenerSlot(),
  onDisconnect: panelListenerSlot(),
  postMessage(message) {
    panelHarnessState.commands.push(message);
  },
};

globalThis.browser = {
  devtools: {
    inspectedWindow: { tabId: 1 },
  },
  runtime: {
    connect() {
      return panelHarnessState.port;
    },
  },
};
