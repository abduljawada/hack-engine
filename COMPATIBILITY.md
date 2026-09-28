# Compatibility and verification

Hack Engine inspects accessible numeric state. It does not support every web game, and a listed source does not mean that a game's score, health, or other desired value is reachable.

## Coverage

| State or runtime | Current coverage | Boundaries |
| --- | --- | --- |
| WebAssembly | Captured exported or imported memory; synchronous `WebAssembly.Instance`, asynchronous instantiation and streaming; numeric scans, refinements, watches, writes, freeze, undo and guarded restore | 256 MiB maximum scan size per memory; memory must be captured by the page agent. Reload a game that initialized before injection. |
| Ruffle | Existing WebAssembly scanner plus runtime-specific number-format hints | AVM metadata is linked through the captured runtime's `setMetadata` callback and player `loadedmetadata` event. Unlinked players, unsupported bindings, or mixed AVM types sharing a memory remain Unknown; other sources in the frame do not supply a guessed type. Unknown types receive up to 15 one-second retries. |
| JavaScript | Finite numbers in reachable page globals, plain objects, arrays and numeric typed arrays; scans, refinements, watches, writes, freeze, undo and guarded restore | Traversal skips getters, DOM/browser internals, functions and unsupported containers, including class instances. Read-only numbers may be found but cannot be edited. |
| Embedded games | Separate sources and sessions in accessible frames | The extension needs access to the frame's site. Restricted browser pages cannot be inspected. |
| Private or remote state | Not supported | Closure/module-private state, lexical globals unavailable as window properties, inaccessible Wasm memory, workers, server-controlled values and anti-cheat enforcement are outside this release. |

JavaScript discovery is user-initiated. Each scan is bounded by eight object levels, 20,000 objects and 100,000 properties/elements; retained live handles are limited to 200,000. The UI reports incomplete discovery. Selecting a specific accessible root can reduce irrelevant work. Source availability, incomplete coverage, no reachable numeric state and no matching values are different outcomes.

Object/property references stay in the page. Watches use a document-specific source and opaque live handle. Replacing an owner object invalidates its previous targets. Freeze is stopped on hidden/disconnected games.

## External game checks — 24 September 2026

These results concern the exact upstream builds below, not an entire engine or framework. Both repositories were served locally without editing their files or exposing private state. The browser was **Chromium 152.0.7977.82, Arch Linux**.

| Game | Exact revision and artifact | Verified result |
| --- | --- | --- |
| [HTML5-Asteroids](https://github.com/dmcinnes/HTML5-Asteroids/tree/930301cbda83ed3b120f64b801d937d077ee2da0) | Commit `930301cbda83ed3b120f64b801d937d077ee2da0`; original `index.html` and `game.js`, no build step. [MIT license](https://github.com/dmcinnes/HTML5-Asteroids/blob/930301cbda83ed3b120f64b801d937d077ee2da0/LICENSE). | Selected existing root `Game`; exact zero scan found `Game.score`. Wrote `12345` and read the live property back. Increased refinement left one candidate. Froze `54321`, read it back, and stopped the freeze. Discovery completed: 3 objects, 44 properties, 6 numbers, 2 initial matching values. |
| [Breakout.Rust.Web](https://github.com/lostjared/Breakout.Rust.Web/tree/1ed2d5317eb868060af0886275c076f1465ca933) | Commit `1ed2d5317eb868060af0886275c076f1465ca933`; checked-in `web/breakout_bg.wasm` and original loader, no rebuild. [MIT license](https://github.com/lostjared/Breakout.Rust.Web/blob/1ed2d5317eb868060af0886275c076f1465ca933/LICENSE). | Correctly captured as non-Ruffle Wasm. Scanned Uint32 lives `5`, waited for natural gameplay to change lives to `4`, then refined. Wrote candidate byte address `1116884` to `99`; the game's canvas text became `Score: 10 Lives: 99`. Enabled freeze at `99` and stopped it. |

Artifact SHA-256 hashes:

- HTML5-Asteroids `game.js`: `e43597fb5325f1b043429b978bc2828b15ae2427d4e1176f24d54fc4395a370f`
- Breakout `web/breakout_bg.wasm`: `ca232eeb089117428539905a17f47b8235c6414373ec24d922181f07b1b81680`

Breakout allocates memory while playing, so candidate counts and captured memory size depend on timing. A repeat run captured 16 MiB initially and approximately 64 MiB at refinement, reducing 293,693 initial candidates to 30,179. The first preview candidate affected the rendered lives counter. The large remaining candidate count is not evidence that all candidates are useful.

### Test boundary

The external checks inject the production `javascript-source.js` and `page-agent.js` at document start using browser test automation. Commands then use the normal page message protocol. A canvas observer records text the game already draws; it does not expose module-private game objects. These checks establish real-game page-agent behavior. They **do not** independently qualify extension installation, permissions, sidebar routing, session recovery, or Firefox behavior on these external games.

For this implementation, 22 unit checks and 20 page/browser fixture checks passed, and installed Firefox and Chromium extension scenarios passed. Those installed scenarios exercise a local test-only game fixture, including mixed-source scan/refine/undo, watches, edits, and freeze. These results do not extend the external-game qualification to Firefox.

Installed Firefox and Chromium qualification uses the repository's extension/practice scenario, including mixed JavaScript/WebAssembly sources. Popup harnesses separately test toolbar, sidebar and pop-out controls. Consult `STORE_PUBLISHING_CHECKLIST.md` and the actual release verification output for installation status; external game results are not a substitute for those checks.

## Reproduce the external checks

The optional runner downloads nothing and is not part of the default test suite. Obtain the two exact revisions above in a temporary directory and serve their unmodified files from a local HTTP server. Verify the hashes before testing. Then run, substituting the actual local fixture URLs:

```sh
node test/external-game-compatibility.mjs \
  http://127.0.0.1:8767/hack-external-asteroids/index.html \
  http://127.0.0.1:8767/hack-external-breakout/index.html
```

Use `CHROME_PATH` to select a Chromium executable if needed. The runner accepts localhost fixture URLs only, launches an isolated temporary browser profile, and prints the observed operations and results. It intentionally edits values in these local game sessions. It does not change upstream files, package the games, or claim compatibility with other versions.
