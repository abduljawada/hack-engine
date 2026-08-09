const extensionApi = globalThis.browser ?? globalThis.chrome;

extensionApi.devtools.panels.create(
  "Hack Engine",
  "assets/icons/icon-32.png",
  "panel/panel.html",
);
