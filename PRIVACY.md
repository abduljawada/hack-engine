# Hack Engine privacy policy

Candidate policy updated: September 24, 2026

Hack Engine is a local browser developer tool for inspecting accessible numeric state in WebAssembly and JavaScript browser games. This policy describes the `1.2.7` release candidate.

## Information the extension handles

To provide its requested functionality, Hack Engine processes the following information inside the user's browser:

- the URL and frame URL of tabs being inspected;
- public Ruffle movie metadata when a player exposes it;
- numeric values and byte addresses in captured WebAssembly linear memory;
- reachable JavaScript numeric properties, their property paths, and page-local object identities during user-requested discovery;
- scan settings, candidate addresses, watch labels and groups, and values entered for writes or freezes.

Hack Engine does not query cookies, form fields, browser history, or password stores. JavaScript discovery inspects reachable page-owned objects, which can include numeric application data unrelated to a game. Choose a narrower object in Advanced to limit the search.

## How the information is used

This information is used only to capture WebAssembly memory and discover JavaScript numeric properties, run user-requested scans, display and refresh candidates and watches, and perform user-requested writes or freezes. Processing occurs locally in the browser.

## Storage and retention

- Live scan state and one undo checkpoint are held in the game document. The extension keeps small watch metadata in extension session storage and reconstructs live scan state after a background restart. Tab closure or game navigation invalidates live memory identities. Freezes stop when the game is hidden or the extension connection is lost.
- Saved workspaces and file import/export are no longer supported. Records saved by older versions may remain unused in extension local storage until the extension is uninstalled. These records contain watch addresses or JavaScript property-path hints, labels, groups, and scan settings, but no live JavaScript references, memory snapshots, or freeze commands. Private/incognito windows are not supported.
- The persistent sidebar stores its Simple/Advanced view choice in `sessionStorage`, scoped to that extension-page session. Write diagnostic results are held transiently in background memory, shared with connected controls, and discarded on background restart or game navigation. Batch selections belong only to their open interface.
- Unknown-value scans may store compressed memory snapshot chunks in IndexedDB belonging to the inspected page's origin. The extension retains the current snapshot and one undo checkpoint, plus temporary data while a refinement runs. Reset, replacement, cancellation, and page exit clean up owned data; another live document's snapshots are not cleared. On origins with the Web Locks API, later initialization reclaims orphaned snapshots only after acquiring the owner's unused lock. Where that API is unavailable or shutdown interrupts cleanup, orphaned site data may remain. Clearing that site's stored data also removes it.
- Files exported by older versions remain wherever the user saved them.
- Disabling or uninstalling Hack Engine removes extension-owned data according to the browser's normal extension-data removal behavior. Site-origin IndexedDB can also be removed through the browser's site-data controls.

## External transmission and sharing

Hack Engine does not transmit browsing activity, page content, WebAssembly memory, scan results, watch data, or usage analytics to the developer or any third party. It has no accounts, advertising, telemetry, analytics, or remote configuration. The extension does not sell or share user information.

Links opened from Hack Engine, such as its documentation or issue tracker, are normal browser navigations and are then governed by the destination site's privacy practices.

## Permissions

- `storage` saves small session metadata for background recovery.
- `tabs` lets the user interface identify and reload the inspected tab and keep persistent controls bound to that tab.
- `<all_urls>` lets the document-start capture hook run before a game instantiates WebAssembly, including in permitted child frames. The extension cannot reliably request this access after the player has already started.
- Chrome's `sidePanel` permission lets the user keep Hack Engine visible beside the inspected page. Firefox provides the equivalent through its sidebar manifest declaration.

## Authorized use and safety

Use Hack Engine only with software and content you own or are authorized to inspect. Raw memory writes are experimental and can corrupt state, reset, or crash the embedded player.

## Contact and changes

Questions may be emailed to [a.abduljawad@outlook.com](mailto:a.abduljawad@outlook.com) or filed through the [Hack Engine issue tracker](https://github.com/abduljawada/hack-engine/issues). Security reports should use the process in [SECURITY.md](SECURITY.md). Material changes to collection, transmission, permissions, or external services will be documented here before release.
