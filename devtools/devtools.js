const extensionApi = globalThis.browser ?? globalThis.chrome;

extensionApi.devtools.panels.create(
  "Ruffle Memory",
  "",
  "panel/panel.html",
);
