const popupHarnessResult = document.querySelector("#harness-result");

setTimeout(async () => {
  const rendered =
    document.querySelector("#hostname").textContent === "bubblebox.com" &&
    document.querySelector("#status-title").textContent === "Ruffle memory detected" &&
    document.querySelector("#memory-count").textContent === "1 captured memory" &&
    document.querySelector("#memory-size").textContent === "4.5 MiB available" &&
    !document.querySelector("#memory-summary").hidden &&
    !document.querySelector("#open-inspector").disabled;

  document.querySelector("#open-inspector").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const inspectorUrl = new URL(popupHarnessState.createdTabs[0]?.url || location.href);
  const inspectorOpened =
    inspectorUrl.pathname.endsWith("/devtools/panel/panel.html") &&
    inspectorUrl.searchParams.get("standalone") === "1" &&
    inspectorUrl.searchParams.get("tabId") === "77" &&
    popupHarnessState.closed;

  popupHarnessState.closed = false;
  document.querySelector("#refresh-connection").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const refreshed = popupHarnessState.reloadedTabs.at(-1) === 77;

  document.querySelector("#how-it-works").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const helpOpened = popupHarnessState.createdTabs.at(-1)?.url.includes("#capabilities");

  popupHarnessResult.textContent = rendered && inspectorOpened && refreshed && helpOpened
    ? "PASS: toolbar popup renders live state and its primary actions work."
    : "FAIL: toolbar popup behavior did not match the active-tab state.";
}, 50);
