# Reviewer notes

Hack Engine installs a document-start hook because Ruffle may instantiate WebAssembly before a user can open the toolbar popup. Host access is used only to capture WebAssembly memory in the current page and permitted frames. Scans, writes, freezes, and watches run locally. The submitted version does not transmit browsing activity, page content, memory values, or analytics to the developer or any third party.

## Deterministic review procedure

1. Serve the unpacked source directory locally with `python3 -m http.server 8765`.
2. Load the browser-specific unpacked directory from `dist/firefox` or `dist/chrome`.
3. Visit `http://127.0.0.1:8765/test/mock.html` and reload once after installation.
4. Open Hack Engine and scan the captured memory for the `Float64` value `12345.5`.
5. The candidate should be byte offset `0x00001000`.
6. Select it, write a replacement, and verify that the mock page changes.
7. Use the pin to open the persistent sidebar/side panel and **Open full inspector** to confirm that the scan and watch are shared.

No account, payment, network service, or proprietary test content is required. Automated harness instructions are in `README.md` and the package is produced by `npm run build` from an explicit runtime-file allowlist.

## Source build

Upload `hack-engine-source-v0.7.0.zip` as the matching source archive. Its root `SOURCE_BUILD.md` gives the operating-system and tool-version requirements, installation steps, exact build command, validation commands, and unpacked-tree comparison procedure. The source includes `package-lock.json` and every build script. It excludes `node_modules`, `dist`, and repository internals.

The release JavaScript is not minified, bundled, transpiled, or obfuscated. A clean extraction followed by `npm ci --ignore-scripts` and `npm run build` was verified to produce a byte-for-byte identical `hack-engine-firefox-v0.7.0.zip` in the reference environment.
