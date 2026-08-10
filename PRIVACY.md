# Hack Engine privacy policy

Effective date: August 10, 2026

Hack Engine is a local browser developer tool for inspecting WebAssembly memory used by embedded Ruffle players. This policy describes the current `0.7.x` release line.

## Information the extension handles

To provide its requested functionality, Hack Engine processes the following information inside the user's browser:

- the URL and frame URL of tabs being inspected;
- public Ruffle movie metadata when a player exposes it;
- numeric values and byte addresses in captured WebAssembly linear memory;
- scan settings, candidate addresses, watch labels and groups, and values entered for writes or freezes;
- workspace JSON files that the user explicitly imports or exports.

Hack Engine does not read passwords, cookies, form submissions, browser history outside the inspected tab, or the contents of unrelated tabs.

## How the information is used

This information is used only to capture WebAssembly memory, run user-requested scans, display and refresh candidates and watches, and perform user-requested writes or freezes. Processing occurs locally in the browser.

## Storage and retention

- Active scan state, shared candidates, watches, selection, and freeze state are held in extension memory for the inspected tab and are cleared when that tab closes or the extension background context restarts.
- The full inspector stores up to 20 scan-history entries and its watch metadata in that extension page's `sessionStorage`. The persistent sidebar stores its Simple/Advanced view choice in `sessionStorage`. This data is scoped to the browser session/page context.
- Unknown-value scans may store compressed memory snapshot chunks in IndexedDB belonging to the inspected page's origin. The extension deletes the active snapshot when the scan is reset, replaced, cancelled, or successfully refined. Data left by an abnormal page or browser shutdown is cleared the next time Hack Engine initializes snapshot storage on that origin. Clearing that site's stored data also removes it.
- Exported workspace files are saved only when the user requests an export and remain wherever the user chooses to save them. Imported files are read locally.
- Disabling or uninstalling Hack Engine removes extension-owned data according to the browser's normal extension-data removal behavior. Site-origin IndexedDB can also be removed through the browser's site-data controls.

## External transmission and sharing

Hack Engine does not transmit browsing activity, page content, WebAssembly memory, scan results, watch data, or usage analytics to the developer or any third party. It has no accounts, advertising, telemetry, analytics, or remote configuration. The extension does not sell or share user information.

Links opened from Hack Engine, such as its documentation or issue tracker, are normal browser navigations and are then governed by the destination site's privacy practices.

## Permissions

- `tabs` lets the user interface identify and reload the inspected tab and open a full inspector bound to that tab.
- `<all_urls>` lets the document-start capture hook run before an embedded Ruffle player instantiates WebAssembly, including in permitted child frames. The extension cannot reliably request this access after the player has already started.
- Chrome's `sidePanel` permission lets the user keep Hack Engine visible beside the inspected page. Firefox provides the equivalent through its sidebar manifest declaration.

## Authorized use and safety

Use Hack Engine only with software and content you own or are authorized to inspect. Raw memory writes are experimental and can corrupt state, reset, or crash the embedded player.

## Contact and changes

Questions may be filed through the [Hack Engine issue tracker](https://github.com/abduljawada/hack-engine/issues). Security reports should use the process in [SECURITY.md](SECURITY.md). Material changes to collection, transmission, permissions, or external services will be documented here before release.
