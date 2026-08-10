# Hack Engine

Firefox-first WebExtension prototype for inspecting WebAssembly memory used by embedded Ruffle players.

## Version 0.7

- Hooks `WebAssembly.instantiate` and `WebAssembly.instantiateStreaming` at `document_start` in the page's `MAIN` world.
- Captures exported or imported `WebAssembly.Memory` objects in every permitted frame.
- Adds a **Hack Engine** Firefox DevTools panel.
- Adds a compact toolbar popup with a type-free quick scan, candidate writing, and freezing; the full inspector retains explicit numeric controls.
- Provides a pin control that docks the popup in Firefox's sidebar, bound to the original game tab, so the controls remain visible while interacting with the page.
- Provides a separate pop-out utility window for users who prefer a floating layout.
- Reads Ruffle's public movie metadata when available to distinguish ActionScript 1/2 from ActionScript 3 and prioritize the relevant numeric representations automatically.
- Supports exact, inclusive range, and unknown-value scans for signed/unsigned 8-, 16-, and 32-bit integers plus `f32` and `f64`.
- Provides an **All numeric types** discovery mode whose candidates retain their detected representation.
- Decodes configurable stored-value multipliers (for example, displayed value × 8) across scanning, watching, writing, and freezing.
- Narrows candidates from exact, range, or unknown first scans by changed, unchanged, increased, or decreased comparisons.
- Narrows unknown candidates by an exact displayed increase or decrease amount.
- Scans naturally aligned values by default, with an optional byte-by-byte mode for unaligned values.
- Displays candidate WASM byte offsets and permits direct writes.
- Keeps the candidate preview capped at 200 rows, with filtering, sorting, multi-selection, and batch watch/write/freeze actions.
- Automatically adds a candidate or manual address to the watch list when it is selected, written, or frozen.
- Keeps a live watch list across scans for up to 256 typed addresses in the current DevTools session.
- Supports watch labels and groups, a 20-entry scan history, and JSON workspace export/import.
- Samples writes immediately, across two animation frames, after 75 ms, and after 250 ms so cached or game-restored values are distinguishable from persistent writes.
- Can freeze a selected address by rewriting it once per animation frame.
- Retains every aligned candidate in a compact bitset and displays the first 200 in the panel.
- Converts sparse candidate sets to sorted typed address lists below 1/32 density, so later next scans read only the surviving addresses instead of traversing a memory-sized bitset.
- Safely continues across `WebAssembly.Memory` growth by refreshing detached scan views between chunks.
- Copies page results into the content-script realm before WebExtension messaging so Firefox Xray wrappers do not corrupt nested candidate rows.
- Treats the 15-second scan watchdog as a request timeout; result rendering errors are reported separately.
- Cancels active scans cooperatively between chunks and releases partially stored snapshots.

Raw writes are experimental. A wrong address can corrupt or crash the embedded player.

See [STORE_PUBLISHING_CHECKLIST.md](STORE_PUBLISHING_CHECKLIST.md) for the current Chrome Web Store and Firefox Add-ons release gates.

For approximate or rounded values, select **Value range** and enter inclusive minimum and maximum values. Range scanning works for both first and next scans. For values that do not appear in a naturally aligned scan, try **Any byte** alignment. If the representation is unknown, run an **Unknown initial value** first scan, change the value in the game, select **Changed**, **Increased**, **Decreased**, or **Value range**, and use **Next scan**. Keep the type and alignment unchanged until resetting the scan. Starting any new first scan replaces the previous session for that captured memory so large snapshots are released promptly.

Use **All numeric types** when the game representation is unknown. Results show the detected type per address. If the stored value is a scaled form of the displayed value, set **Stored-value multiplier** before scanning; candidate values, writes, freezes, and watches will continue to use the displayed value. Comparison conditions can follow exact, range, or unknown first scans. **Increased by** and **Decreased by** compare against the preceding scan after applying the same multiplier.

For the shortest workflow, open **Hack Engine** from the Firefox toolbar and use **Quick scan**. It does not ask for a numeric type. For an ActionScript 1/2 movie it starts with `f64`; for ActionScript 3 it starts with `i32`, `u32`, and `f64` as appropriate. If Ruffle does not expose usable metadata, it safely falls back to all eight supported representations. Results retain their detected type internally, so selecting, writing, and freezing a candidate remains type-correct. **Search all number formats** is available after a guided exact or range scan when the first pass does not find the desired value.

Browser action popups close when focus returns to the page. In Firefox, use the pin in the popup header to dock the same controls in the browser sidebar. The sidebar remains visible beside the inspected page and stays bound to the original game tab; use the active pin again to close it. **Pop out window** opens or focuses one floating utility window for that tab. A pop-out is an ordinary browser window, so the operating system may place it behind the main Firefox window when the page is clicked.

## Load in Firefox

1. Open `about:debugging`.
2. Select **This Firefox**.
3. Choose **Load Temporary Add-on**.
4. Select this folder's `manifest.json`.
5. Open or reload the page containing the embedded Ruffle player.
6. Open Firefox Developer Tools and select **Hack Engine**.

The extension needs permission on the player frame's URL. Reloading is required because the WASM hook must run before Ruffle initializes.

When reloading the temporary add-on during development, also reload the game page and close/reopen Developer Tools. Firefox invalidates the ports belonging to an already-open extension panel. The panel detects this condition and reports it instead of leaving a scan running indefinitely.

## Local smoke target

Serve this directory over HTTP, then visit `/test/mock.html`:

```sh
python3 -m http.server 8000
```

With the extension loaded, scan the captured memory as `Float64` for `12345.5`. The expected candidate is byte offset `0x00001000`. Change it with **Write value**, then run **Next scan** using the new value.

`/test/harness.html` runs the page agent directly and reports whether capture, exact scan, address discovery, and writing all succeed end-to-end.

`/test/freeze-harness.html` simulates a game that restores a value every animation frame. It verifies that delayed write checking detects the reversion and that freezing holds the requested replacement.

`/test/watch-diagnostics-harness.html` verifies live multi-address reads and five-sample write classification for both game-restored and persistent values.

`/test/representation-discovery-harness.html` verifies automatic numeric-type discovery, scaled-value decoding and writes, comparisons after known initial values, and exact-delta refinement from a shared multi-type snapshot.

`/test/avm-guided-scan-harness.html` verifies ActionScript 1/2 and ActionScript 3 detection through public Ruffle metadata, their guided numeric plans, and the all-format fallback when metadata is unavailable.

`/test/candidate-retention-harness.html` starts with more than 250,000 identical values, changes only the final one, and verifies that the result converts to sparse address storage and is refined directly by a subsequent next scan.

`/test/memory-growth-harness.html` grows the captured WASM memory during a scan and verifies that scanning continues without using the detached original buffer.

`/test/advanced-scan-harness.html` verifies byte-by-byte discovery of an unaligned value, inclusive range scans and refinements, and unknown-value filtering by range and change direction.

`/test/large-unknown-harness.html` reproduces Ruffle's 225.5 MiB memory scale and verifies that an unknown scan completes with a chunk-compressed snapshot instead of duplicating the entire heap.

`/test/bridge-payload-harness.html` verifies that the content bridge makes an independent structured clone while retaining nested addresses and special numeric values. The final cross-realm check must still be run with the temporary extension loaded in Firefox.

`/test/panel-watchdog-harness.html` verifies that a matching result ends the 15-second request watchdog before candidate rendering and that malformed rows produce an immediate rendering error instead of a false timeout.

`/test/popup-harness.html` verifies the toolbar's type-free scan, type-correct candidate write/freeze actions, Firefox sidebar docking, and pop-out reuse. `/test/background-session-harness.html` verifies that the popup and full inspector can share one captured page and that a quick scan survives closing and reopening the popup.

`/test/scan-cancellation-harness.html` verifies that cancellation interrupts an active scan and that a replacement scan succeeds immediately afterward.

`node test/run-browser-harnesses.mjs` runs all page-level harnesses in a real headless browser. With the local server running, `node test/run-firefox-extension-harness.mjs` starts an isolated headless Firefox profile, temporarily installs the extension through WebDriver BiDi, and verifies nested candidate data across the actual page/content/background bridge.

## Intentional limitations

- Byte-by-byte and unknown-value scans can be significantly slower. Unknown scans keep independently compressed chunks in browser storage and load only the chunk needed by each comparison pass, avoiding a second Ruffle-sized JavaScript heap allocation.
- **All numeric types** performs up to eight interpretations and can be substantially slower than a typed scan. Its unknown mode shares one compressed snapshot across every interpretation instead of duplicating the Ruffle heap.
- The initial unknown-value scan intentionally displays no rows because every address is a candidate until the first comparison pass. Change the game value and use **Next scan** to obtain actionable candidates.
- A scan covers the memory range that existed when it started; pages added during that scan are considered by the next first scan.
- It captures instantiation through the two standard asynchronous WebAssembly APIs, not direct `new WebAssembly.Instance(...)` construction.
- The Ruffle label is heuristic; the panel also exposes other captured WASM memories so detection failures do not hide the target.
- ActionScript detection is a scan-planning hint, not semantic ActionScript inspection. Hack Engine does not yet decode Ruffle's internal tagged values, objects, property names, or paths such as `game.cash`.
