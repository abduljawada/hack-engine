# Hack Engine

Hack Engine helps you find, watch, and change accessible numeric values in WebAssembly and JavaScript browser games. It brings a familiar memory-scanning workflow into the browser, without a native debugger or changes to your operating system's security settings.

Everything happens locally in the inspected tab. Hack Engine has no accounts, telemetry, advertising, or remote service.

> Current release: **v1.3.5**, available from [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/hack-engine/) and the [Chrome Web Store](https://chromewebstore.google.com/detail/hack-engine/jlnajpkijkcedkgbjmmdeajdpolgpmdp). The current release checks cover the controlled eight-game matrix and packaged browser regressions described in [test/GAME_TESTING.md](test/GAME_TESTING.md). Historical 1.0 qualification notes remain in [IMPLEMENTATION_1_0.md](IMPLEMENTATION_1_0.md).

## What you can do

- **Find visible values:** Search for an exact number, a range, or an unknown starting value.
- **Narrow the results:** Change the value in the game, then filter by changed, unchanged, increased, or decreased.
- **Recover mistakes:** Undo one refinement, restore the last write when the game has not changed it, and stop all freezes.
- **Edit and freeze:** Replace a discovered value or keep it fixed while the game runs.
- **Watch values live:** Keep useful candidates visible as they change and give each watch a descriptive label.
- **Start simple, go deeper:** Scan with Automatic defaults, then expand **Scan options** when you need more control.
- **Keep one shared workspace:** Candidates, watches, selections, and freezes stay synchronized between the toolbar, sidebar, and pop-out.

## How to use Hack Engine

1. Open a browser game and reload it after installing Hack Engine.
2. Open Hack Engine from the browser toolbar. Use the pin button if you want the controls to remain beside the game.
3. Enter the value currently shown in the game and choose **First scan**.
4. Change that value in the game, enter the new value, and choose **Next scan**.
5. Repeat until only a small number of candidates remain, then select one to watch, edit, or freeze it.

If the exact value is not known, start with **Unknown initial value** and refine after the game changes. **Value range** helps with rounded or approximate values. Expand **Scan options** to choose a number format, alignment, or JavaScript object. Non-default settings remain visible in the collapsed summary. The toolbar, sidebar, and pop-out all provide **Candidates** and **Watches**, filtering, sorting, and one selected-value editor. Select individual candidates to watch, edit each watch's label, and sort addresses or values in either direction. Write feedback follows verification through 250 ms; expandable details distinguish verification from game restoration or failed reads.

## JavaScript games

Choose **JavaScript objects** as the source and scan normally. Expand **Scan options** to use the object picker and narrow discovery. Results show property paths instead of memory addresses. If discovery reaches a limit, the panel reports partial coverage; choose a narrower object and scan again. A replaced object makes its old watches unavailable rather than redirecting writes.

## Browser support

Hack Engine provides packages for Firefox and Chromium-based browsers. The persistent controls use each browser's native sidebar or side-panel experience, so the placement can differ slightly while the scanning workflow remains the same.

## Install

- **Firefox:** [Hack Engine on Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/hack-engine/)
- **Chrome and other Chromium browsers:** [Hack Engine on the Chrome Web Store](https://chromewebstore.google.com/detail/hack-engine/jlnajpkijkcedkgbjmmdeajdpolgpmdp)

Reload any open game page after installing so Hack Engine can detect the player's WebAssembly memory from the beginning.

## Install a development build

To test unreleased changes, build the browser packages:

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
- A displayed number may be rounded, scaled, copied, or recalculated by the game. Range scans, comparison scans, and additional scan options can help identify the useful value.
- Editing the wrong address can reset or crash the embedded player. Use Hack Engine only with games and software you own or are authorized to inspect.

## Planned features

- Complete the remaining compatibility matrix and keep the signed Firefox and Chrome releases current.
- Reusable scan profiles, value history, address notes, and pointer research.
- Worker inspection and broader runtime compatibility.

## Documentation and support

- [User guide](USER_GUIDE.md)
- [Privacy policy](PRIVACY.md)
- [Security policy](SECURITY.md)
- [Reviewer build instructions](SOURCE_BUILD.md)
- [Issue tracker](https://github.com/abduljawada/hack-engine/issues)

Hack Engine is released under the [MIT License](LICENSE).

## Development checks

`npm run test:games` builds and installs the extension in silent disposable Firefox and Chrome-family profiles and exercises original pinned game copies on loopback. It writes an HTML report with screenshots and per-step results. Use `-- --game J1,W1` for focused Asteroids/Breakout diagnosis, or `-- --headed` to watch. `npm run release:verify` requires Asteroids (JavaScript), Breakout (WebAssembly), Interactive Buddy v1.01 (AVM1), and Bloons Tower Defense 3 (AVM2) in both browsers: eight controlled configurations. Incomplete gameplay coverage remains blocked. `npm run test:compatibility` separately visits their actual websites and retains external access failures as compatibility failures. See [real-game testing](test/GAME_TESTING.md) for assets, CI, and evidence boundaries.

`npm run test:regression` starts its own local server and runs the existing page and installed-extension fixture suites after a build.

`npm run test:unit` checks background recovery and document invalidation. Serve this directory at `http://127.0.0.1:8765`, then run `npm run test:browser` for page-level regressions. After `npm run build`, `npm run test:firefox` and `npm run test:chrome` install the actual packages in disposable profiles and exercise a local test fixture and persistent controls. Browser discovery supports Linux, macOS, and Windows; set `FIREFOX_PATH` or `CHROME_PATH` to override it. Current qualification evidence is Linux-only.

The Firefox UI test uses its documented `--remote-allow-system-access` automation flag only in the temporary test profile. Do not point these runners at a personal browser profile.

The Firefox runner accepts a fixture URL as its first argument. For the 225.5 MiB fixture (`test/large-unknown-harness.html`), use a disposable profile on a disk with sufficient storage: a small RAM-backed `/tmp` can impose a lower IndexedDB quota. On Linux, setting `TMPDIR` to an existing empty test directory selects that location. The scanner intentionally rejects a snapshot when estimated remaining quota is insufficient.
