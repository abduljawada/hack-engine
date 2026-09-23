# Store permission justifications

## `tabs`

Hack Engine uses `tabs` to identify and reload the tab the user is inspecting, and keep the sidebar and pop-out bound to that tab. It does not read unrelated browsing history.

## `<all_urls>` host access

Ruffle games can be embedded on arbitrary sites and in child frames. Hack Engine must install its capture hook at `document_start`, before Ruffle instantiates WebAssembly; requesting access only after the toolbar is opened would miss the memory instance and make the advertised feature unreliable. Host access is used only to install the local capture bridge and inspect WebAssembly memory in the current page and permitted frames.

## Chrome `sidePanel`

The `sidePanel` permission lets a user keep Hack Engine visible while interacting with the inspected page. It is invoked only from the user's pin action. Firefox provides the equivalent through `sidebar_action` without an API permission.

## Remote code and external services

All executable JavaScript is readable and included in the package. Hack Engine does not use `eval`, `new Function`, remote script imports, downloaded executable logic, analytics, advertising, accounts, payment, native messaging, or remote configuration.

## `storage`

Session storage preserves small watch metadata through background restarts. Local storage holds only user-saved workspace names, watch metadata, and scan settings. It is not used for remote sync or bulk memory dumps.

## Bundled practice memory

The extension page CSP permits local WebAssembly compilation (`wasm-unsafe-eval`) so the packaged practice page can instantiate its fixed in-package memory fixture. JavaScript string evaluation and remote code remain prohibited. The practice bridge accepts only the extension's own practice page.
