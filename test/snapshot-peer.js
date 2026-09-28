window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.direction !== "from-page") return;
  const payload = event.data.payload;
  if (payload.kind === "instanceCaptured") window.postMessage({ channel: "ruffle-memory-inspector:v1", direction: "to-page", payload: { kind: "memoryScan", requestId: "peer", instanceId: payload.instance.id, type: "i32", condition: "unknown" } }, "*");
  if (payload.kind === "scanResults") parent.postMessage({ snapshotPeer: true }, location.origin);
  if (payload.kind === "error") parent.postMessage({ snapshotPeer: true, error: payload.message }, location.origin);
});
WebAssembly.instantiate(new Uint8Array([0,97,115,109,1,0,0,0,5,3,1,0,1,7,10,1,6,109,101,109,111,114,121,2,0]));
