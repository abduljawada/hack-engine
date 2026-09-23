(async () => {
  const result = document.querySelector("#harness-result");
  try {
    const response = await fetch("../popup/popup.html");
    if (!response.ok) throw new Error(`Popup markup returned ${response.status}`);
    const parsed = new DOMParser().parseFromString(await response.text(), "text/html");
    document.body.prepend(parsed.querySelector("main"));
    const load = (src) => new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.body.append(script);
    });
    await load("popup-harness-setup.js");
    if (location.pathname.includes("advanced-migration")) await load("advanced-migration-setup.js");
    await load("../popup/popup.js");
    const preview = new URLSearchParams(location.search);
    if (preview.get("preview") === "1") {
      const style = document.createElement("link"); style.rel = "stylesheet"; style.href = "../workspace-controls.css"; document.head.append(style);
      await load("../workspace-controls.js");
      document.body.style.zoom = preview.get("zoom") === "2" ? "2" : "1";
      result.hidden = true;
      return;
    }
    await load(location.pathname.includes("advanced-migration") ? "advanced-migration-run.js" : "popup-harness-run.js");
  } catch (error) {
    result.textContent = `FAIL: ${error.stack || error}`;
  }
})();
