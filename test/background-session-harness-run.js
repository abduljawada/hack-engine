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

const reopenedPopup = backgroundPort("hack-popup:77");
backgroundHarness.onConnect.emit(reopenedPopup);
const restored = reopenedPopup.sent.find((message) => message.kind === "quickSession")?.session;
const sessionRestored =
  restored?.status === "complete" &&
  restored?.canRefine === true &&
  restored?.results?.preview?.[0]?.address === 4096;

backgroundResult.textContent = routed && panelStayedConnected && sessionRestored
  ? "PASS: popup and inspector share the bridge and quick scans survive popup reconnection."
  : "FAIL: background quick-session multiplexing did not preserve state.";
