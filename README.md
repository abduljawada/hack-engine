# Hack Engine

Hack Engine helps you find, watch, and change accessible numeric values in WebAssembly and JavaScript browser games. It brings a familiar memory-scanning workflow into the browser, without a native debugger or changes to your operating system's security settings.

Everything happens locally in the inspected tab. Hack Engine has no accounts, telemetry, advertising, or remote service.

> Current release: **v1.2.0 release candidate — not published**. Core workflows are tested locally on Linux Firefox and Chromium; the remaining release gates are recorded in [IMPLEMENTATION_1_0.md](IMPLEMENTATION_1_0.md).

## What you can do

- **Find visible values:** Search for an exact number, a range, or an unknown starting value.
- **Narrow the results:** Change the value in the game, then filter by changed, unchanged, increased, or decreased.
- **Recover mistakes:** Undo one refinement, restore the last write when the game has not changed it, and stop all freezes.
- **Save your work:** Keep named local workspaces, preview imports, and verify addresses against the current game before use.
- **Practice first:** Open the included local practice game from the controls.
- **Edit and freeze:** Replace a discovered value or keep it fixed while the game runs.
- **Watch values live:** Keep useful candidates visible as they change and organize them with labels and groups.
- **Start simple, go deeper:** Use Quick scan for the common workflow, then open Advanced controls when you need more options.
- **Keep one shared workspace:** Candidates, watches, selections, and freezes stay synchronized between the toolbar, sidebar, and pop-out.

## How to use Hack Engine

1. Open a browser game and reload it after installing Hack Engine.
2. Open Hack Engine from the browser toolbar. Use the pin button if you want the controls to remain beside the game.
3. Enter the value currently shown in the game and choose **First scan**.
4. Change that value in the game, enter the new value, and choose **Next scan**.
5. Repeat until only a small number of candidates remain, then select one to watch, edit, or freeze it.

If the exact value is not known, start with **Unknown initial value** and refine after the game changes. **Value range** helps with rounded or approximate values. Advanced mode also provides explicit number-format, alignment, multiplier, and inspection-source controls. Add known addresses, select displayed candidates to watch in a batch, apply watch labels/groups together, and sort addresses or values in either direction. Write feedback follows verification through 250 ms; expandable details distinguish verification from game restoration or failed reads.

## JavaScript games

Choose **JavaScript objects** as the source and scan normally. Advanced controls offer an object picker to narrow discovery. Results show property paths instead of memory addresses. If discovery reaches a limit, the panel reports partial coverage; choose a narrower object and scan again. A replaced object makes its old watches unavailable rather than redirecting writes.

## Browser support

Hack Engine provides packages for Firefox and Chromium-based browsers. The persistent controls use each browser's native sidebar or side-panel experience, so the placement can differ slightly while the scanning workflow remains the same.

## Install a development build

Build the browser packages:

```sh
npm ci --ignore-scripts
npm run build
```

### Firefox

1. Open `about:debugging`.
2. Select **This Firefox**.
3. Choose **Load Temporary Add-on**.
4. Select `dist/firefox/manifest.json`.

### Chrome and other Chromium browsers

1. Open the browser's extensions page, such as `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select `dist/chrome`.

Reload the game page after loading the extension so Hack Engine can detect the player's WebAssembly memory from the beginning.

## Good to know

- Hack Engine searches captured WebAssembly memory and reachable JavaScript object properties. Private variables, worker state, encoded values, and server-controlled state are outside this release. See [compatibility](COMPATIBILITY.md) for tested coverage and limits.
- A displayed number may be rounded, scaled, copied, or recalculated by the game. Range scans, comparison scans, and Advanced mode can help identify the useful value.
- Editing the wrong address can reset or crash the embedded player. Use Hack Engine only with games and software you own or are authorized to inspect.

## Planned features

- Complete the remaining compatibility matrix and signed-store qualification for v1.0.
- Reusable scan profiles, value history, address notes, and pointer research.
- Worker inspection and broader runtime compatibility.

## Documentation and support

- [User guide](USER_GUIDE.md)
- [Privacy policy](PRIVACY.md)
- [Security policy](SECURITY.md)
- [Store publishing checklist](STORE_PUBLISHING_CHECKLIST.md)
- [Reviewer build instructions](SOURCE_BUILD.md)
- [Issue tracker](https://github.com/abduljawada/hack-engine/issues)

Hack Engine is released under the [MIT License](LICENSE). Questions can also be sent to [a.abduljawad@outlook.com](mailto:a.abduljawad@outlook.com).

## Development checks

`npm run test:unit` checks background recovery and document invalidation. Serve this directory at `http://127.0.0.1:8765`, then run `npm run test:browser` for page-level regressions. After `npm run build`, `npm run test:firefox` and `npm run test:chrome` install the actual packages in disposable profiles and exercise the practice game and persistent controls. Browser discovery supports Linux, macOS, and Windows; set `FIREFOX_PATH` or `CHROME_PATH` to override it. Current qualification evidence is Linux-only.

The Firefox UI test uses its documented `--remote-allow-system-access` automation flag only in the temporary test profile. Do not point these runners at a personal browser profile.

The Firefox runner accepts a fixture URL as its first argument. For the 225.5 MiB fixture (`test/large-unknown-harness.html`), use a disposable profile on a disk with sufficient storage: a small RAM-backed `/tmp` can impose a lower IndexedDB quota. On Linux, setting `TMPDIR` to an existing empty test directory selects that location. The scanner intentionally rejects a snapshot when estimated remaining quota is insufficient.
