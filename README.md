# Hack Engine

Hack Engine helps you find, watch, and change numeric values in browser games running through Ruffle. It brings a familiar memory-scanning workflow into the browser, without a native debugger or changes to your operating system's security settings.

Everything happens locally in the inspected tab. Hack Engine has no accounts, telemetry, advertising, or remote service.

> Current release: **v0.7.0 development build**. The first store release is planned for v1.0.

## What you can do

- **Find visible values:** Search for an exact number, a range, or an unknown starting value.
- **Narrow the results:** Change the value in the game, then filter by changed, unchanged, increased, or decreased.
- **Edit and freeze:** Replace a discovered value or keep it fixed while the game runs.
- **Watch values live:** Keep useful candidates visible as they change and organize them with labels and groups.
- **Start simple, go deeper:** Use Quick scan for the common workflow, then open Advanced controls when you need more options.
- **Keep one shared workspace:** Candidates, watches, selections, and freezes stay synchronized between the toolbar, persistent panel, and full inspector.

## How to use Hack Engine

1. Open a page containing an embedded Ruffle game and reload it after installing Hack Engine.
2. Open Hack Engine from the browser toolbar. Use the pin button if you want the controls to remain beside the game.
3. Enter the value currently shown in the game and choose **First scan**.
4. Change that value in the game, enter the new value, and choose **Next scan**.
5. Repeat until only a small number of candidates remain, then select one to watch, edit, or freeze it.

If the exact value is not known, start with **Unknown initial value** and refine after the game changes. **Value range** helps with rounded or approximate values. Advanced mode also provides explicit number-format, alignment, multiplier, and captured-memory controls.

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

- Hack Engine works when a game's numeric state reaches captured WebAssembly memory. Some values may instead live in JavaScript, encoded objects, or other storage that is not currently searchable.
- A displayed number may be rounded, scaled, copied, or recalculated by the game. Range scans, comparison scans, and Advanced mode can help identify the useful value.
- Editing the wrong address can reset or crash the embedded player. Use Hack Engine only with games and software you own or are authorized to inspect.

## Planned features

- A signed and documented v1.0 store release.
- Reusable scan profiles, value history, address notes, and pointer research.
- Broader game compatibility, recovery tools, and browser hardening.

## Documentation and support

- [User guide](USER_GUIDE.md)
- [Privacy policy](PRIVACY.md)
- [Security policy](SECURITY.md)
- [Store publishing checklist](STORE_PUBLISHING_CHECKLIST.md)
- [Reviewer build instructions](SOURCE_BUILD.md)
- [Issue tracker](https://github.com/abduljawada/hack-engine/issues)

Hack Engine is released under the [MIT License](LICENSE). Questions can also be sent to [a.abduljawad@outlook.com](mailto:a.abduljawad@outlook.com).
