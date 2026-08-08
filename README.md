# Ruffle Memory Inspector

Firefox-first WebExtension prototype for inspecting WebAssembly memory used by embedded Ruffle players.

## Current MVP

- Hooks `WebAssembly.instantiate` and `WebAssembly.instantiateStreaming` at `document_start` in the page's `MAIN` world.
- Captures exported or imported `WebAssembly.Memory` objects in every permitted frame.
- Adds a **Ruffle Memory** Firefox DevTools panel.
- Supports exact and unknown-value scans for `i32`, `u32`, `f32`, and `f64`.
- Narrows unknown-value candidates by changed, unchanged, increased, or decreased comparisons.
- Scans naturally aligned values by default, with an optional byte-by-byte mode for unaligned values.
- Displays candidate WASM byte offsets and permits direct writes.
- Verifies writes after 75 ms so values restored by the game are reported instead of appearing successful.
- Can freeze a selected address by rewriting it once per animation frame.
- Retains every aligned candidate in a compact bitset and displays the first 200 in the panel.
- Safely continues across `WebAssembly.Memory` growth by refreshing detached scan views between chunks.

Raw writes are experimental. A wrong address can corrupt or crash the embedded player.

For values that do not appear in an exact naturally aligned scan, try **Any byte** alignment. If the representation is unknown, run an **Unknown initial value** first scan, change the value in the game, select **Changed**, **Increased**, or **Decreased**, and use **Next scan**. Keep the type and alignment unchanged until resetting the scan. Starting any new first scan replaces the previous session for that captured memory so large snapshots are released promptly.

## Load in Firefox

1. Open `about:debugging`.
2. Select **This Firefox**.
3. Choose **Load Temporary Add-on**.
4. Select this folder's `manifest.json`.
5. Open or reload the page containing the embedded Ruffle player.
6. Open Firefox Developer Tools and select **Ruffle Memory**.

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

`/test/candidate-retention-harness.html` starts with more than 250,000 identical values, changes only the final one, and verifies that a next scan still finds that late-memory address.

`/test/memory-growth-harness.html` grows the captured WASM memory during a scan and verifies that scanning continues without using the detached original buffer.

`/test/advanced-scan-harness.html` verifies byte-by-byte discovery of an unaligned value and unknown-value filtering by change direction.

`/test/large-unknown-harness.html` reproduces Ruffle's 225.5 MiB memory scale and verifies that an unknown scan completes with a chunk-compressed snapshot instead of duplicating the entire heap.

## Intentional limitations

- Byte-by-byte and unknown-value scans can be significantly slower. Unknown scans retain independently compressed memory chunks and decompress only the chunks needed by each comparison pass.
- A scan covers the memory range that existed when it started; pages added during that scan are considered by the next first scan.
- It captures instantiation through the two standard asynchronous WebAssembly APIs, not direct `new WebAssembly.Instance(...)` construction.
- The Ruffle label is heuristic; the panel also exposes other captured WASM memories so detection failures do not hide the target.
