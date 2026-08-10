# Store permission justifications

## `tabs`

Hack Engine uses `tabs` to identify and reload the tab the user is inspecting, keep persistent windows bound to that tab, and open the full inspector for the same tab. It does not read unrelated browsing history.

## `<all_urls>` host access

Ruffle games can be embedded on arbitrary sites and in child frames. Hack Engine must install its capture hook at `document_start`, before Ruffle instantiates WebAssembly; requesting access only after the toolbar is opened would miss the memory instance and make the advertised feature unreliable. Host access is used only to install the local capture bridge and inspect WebAssembly memory in the current page and permitted frames.

## Chrome `sidePanel`

The `sidePanel` permission lets a user keep Hack Engine visible while interacting with the inspected page. It is invoked only from the user's pin action. Firefox provides the equivalent through `sidebar_action` without an API permission.

## Remote code and external services

All executable JavaScript is readable and included in the package. Hack Engine does not use `eval`, `new Function`, remote script imports, downloaded executable logic, analytics, advertising, accounts, payment, native messaging, or remote configuration.
