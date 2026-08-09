function backgroundEvent() {
  const listeners = new Set();
  return {
    addListener(listener) { listeners.add(listener); },
    emit(...args) { for (const listener of listeners) listener(...args); },
  };
}

const backgroundHarness = {
  onConnect: backgroundEvent(),
  onMessage: backgroundEvent(),
  onRemoved: backgroundEvent(),
};

function backgroundPort(name, sender = undefined) {
  return {
    name,
    sender,
    sent: [],
    onMessage: backgroundEvent(),
    onDisconnect: backgroundEvent(),
    postMessage(message) { this.sent.push(message); },
  };
}

globalThis.browser = {
  runtime: {
    onConnect: backgroundHarness.onConnect,
    onMessage: backgroundHarness.onMessage,
  },
  tabs: { onRemoved: backgroundHarness.onRemoved },
};
