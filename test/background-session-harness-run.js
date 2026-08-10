const backgroundResult = document.querySelector("#result");
const bridge = backgroundPort("ruffle-frame-bridge", {
  tab: { id: 77 },
  frameId: 3,
  url: "https://example.com/game",
});
backgroundHarness.onConnect.emit(bridge);
bridge.onMessage.emit({ kind: "bridgeReady", url: bridge.sender.url });

const panel = backgroundPort("ruffle-panel:77");
const popup = backgroundPort("hack-popup:77");
backgroundHarness.onConnect.emit(panel);
backgroundHarness.onConnect.emit(popup);

const request = {
  kind: "memoryScan",
  requestId: "quick:scan:1",
  instanceId: "memory-1",
  type: "smart",
  rawValue: "8",
  condition: "exact",
  alignment: "aligned",
  multiplier: 1,
  refine: false,
};
popup.onMessage.emit({ kind: "routeCommand", frameId: 3, payload: request });
const routed = bridge.sent.some((message) => message.kind === "pageCommand" && message.payload === request);

popup.onDisconnect.emit();
bridge.onMessage.emit({
  kind: "pageMessage",
  payload: {
    kind: "scanResults",
    requestId: request.requestId,
    instanceId: "memory-1",
    type: "smart",
    searchedTypes: ["i32", "u32", "f64"],
    multiplier: 1,
    total: 1,
    preview: [{ address: 4096, type: "i32", value: 8 }],
    allCandidates: false,
  },
});
const panelStayedConnected = panel.sent.some((message) => (
  message.kind === "pageMessage" && message.payload?.kind === "scanResults"
));
const panelReceivedPopupSession = panel.sent.some((message) => (
  message.kind === "quickSession" &&
  message.session?.status === "complete" &&
  message.session?.results?.preview?.[0]?.address === 4096
));

const sharedWatch = {
  frameId: 3,
  instanceId: "memory-1",
  type: "i32",
  multiplier: 1,
  address: 4096,
  label: "Money",
  group: "Player",
};
panel.onMessage.emit({
  kind: "workspaceCommand",
  action: "upsertWatch",
  watch: sharedWatch,
  select: true,
});

const reopenedPopup = backgroundPort("hack-popup:77");
backgroundHarness.onConnect.emit(reopenedPopup);
const popupReceivedWorkspace = reopenedPopup.sent.some((message) => (
  message.kind === "workspaceState" &&
  message.workspace?.selectedKey === "3:memory-1:i32:4096" &&
  message.workspace?.watches?.[0]?.label === "Money"
));
bridge.onMessage.emit({
  kind: "pageMessage",
  payload: {
    kind: "freezeChanged",
    requestId: "panel:freeze:1",
    instanceId: "memory-1",
    type: "i32",
    address: 4096,
    enabled: true,
  },
});
const popupReceivedFreeze = reopenedPopup.sent.some((message) => (
  message.kind === "workspaceState" &&
  message.workspace?.frozenKeys?.includes("3:memory-1:i32:4096")
));
const restored = reopenedPopup.sent.find((message) => message.kind === "quickSession")?.session;
const sessionRestored =
  restored?.status === "complete" &&
  restored?.canRefine === true &&
  restored?.results?.preview?.[0]?.address === 4096;

const panelRequest = {
  ...request,
  requestId: "panel:scan:2",
  type: "f64",
  rawValue: "12",
};
panel.onMessage.emit({ kind: "routeCommand", frameId: 3, payload: panelRequest });
bridge.onMessage.emit({
  kind: "pageMessage",
  payload: {
    kind: "scanResults",
    requestId: panelRequest.requestId,
    instanceId: "memory-1",
    type: "f64",
    searchedTypes: ["f64"],
    multiplier: 1,
    total: 1,
    preview: [{ address: 8192, type: "f64", value: 12 }],
    allCandidates: false,
  },
});
const popupReceivedPanelSession = reopenedPopup.sent.some((message) => (
  message.kind === "quickSession" &&
  message.session?.requestId === panelRequest.requestId &&
  message.session?.results?.preview?.[0]?.address === 8192
));

backgroundResult.textContent = routed && panelStayedConnected && panelReceivedPopupSession && popupReceivedWorkspace && popupReceivedFreeze && sessionRestored && popupReceivedPanelSession
  ? "PASS: popup and inspector share scans, candidates, watches, selection, and reconnection state."
  : "FAIL: background tab session did not synchronize popup and inspector state.";
