# Hack Engine store-publishing checklist

Last reviewed: 2026-08-10

Target: publish Hack Engine as a Firefox-first, cross-browser Manifest V3 extension on Firefox Add-ons (AMO) and the Chrome Web Store (CWS).

## Release blockers found in the current repository

- [ ] Update the local Git remote from the old `ruffle-memory-inspector` URL to the renamed `hack-engine` repository and verify fetch/push.
- [ ] Add a Chrome-compatible background declaration. Chrome MV3 requires `background.service_worker`; Firefox currently uses `background.scripts`. A shared manifest can declare both against `background.js` after Chromium testing.
- [ ] Add and validate a Chrome `side_panel` declaration corresponding to Firefox's current `sidebar_action`, or provide a clearly documented Chrome fallback.
- [ ] Add Firefox's required data declaration under `browser_specific_settings.gecko.data_collection_permissions`. If the release still sends nothing outside the local browser, declare `required: ["none"]`.
- [ ] Replace the development Firefox ID `ruffle-memory-inspector@example.local` with a deliberate, permanent Hack Engine add-on ID before the first AMO submission. Do not change it after release.
- [ ] Publish a privacy page that accurately explains local access to tab URLs, page content, and WebAssembly memory; whether anything is stored; and that nothing is transmitted externally in the current build.
- [ ] Add a project license and select the matching license in AMO.
- [ ] Add a reproducible production packaging command that excludes `.git`, tests, harnesses, design sources, screenshots, and other non-runtime files.
- [ ] Complete real Chromium extension testing. The current repository has broad page-level browser coverage and Firefox bridge coverage, but not yet a formal Chrome store-build compatibility guarantee.

## 1. Freeze the release scope

- [ ] Choose the first public store version and update `manifest.json`, the status page, release notes, and package names together.
- [ ] Define the single purpose consistently: **Inspect and edit numeric WebAssembly memory in embedded Ruffle players for authorized local debugging.**
- [ ] Keep the popup, DevTools panel, store description, privacy disclosures, and reviewer notes consistent with that purpose.
- [ ] State clearly that raw writes are experimental and can reset or crash the embedded player.
- [ ] Avoid marketing the extension as a way to cheat online services, evade security, bypass paid features, or interfere with other users.
- [ ] Decide whether a pre-1.0 AMO listing should carry Mozilla's **Experimental** label.
- [ ] Confirm that the release has no analytics, advertising, accounts, telemetry, native messaging, or network transmission. If this changes, redo both stores' privacy and consent work before submission.

## 2. Permissions and policy review

- [ ] Inventory every manifest permission and host permission.
- [ ] Document why `tabs` is necessary: the popup identifies/reloads the inspected tab and opens the full inspector for that tab.
- [ ] Document why `<all_urls>` is necessary: the extension must install its hook at `document_start`, including permitted child frames, before an arbitrary embedded Ruffle player instantiates WebAssembly.
- [ ] Evaluate whether any host access can safely become optional without missing early Ruffle initialization. Do not narrow it if that would make the advertised feature unreliable; instead provide a precise reviewer justification.
- [ ] Confirm that packaged JavaScript is readable, self-contained, and does not execute remotely hosted code.
- [ ] Confirm that no `eval`, downloaded executable logic, obfuscation, or undeclared remote configuration exists.
- [ ] Confirm that all functionality shown in the listing works without unrelated actions, external software, payment, or login.
- [ ] Add an authorized-use statement to the listing and support documentation.
- [ ] Review the current [Chrome Web Store Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies) and [Mozilla Add-on Policies](https://extensionworkshop.com/documentation/publish/add-on-policies/) immediately before submission.

## 3. Cross-browser manifest and runtime work

- [ ] Add `background.service_worker: "background.js"` while retaining the Firefox `background.scripts` fallback.
- [ ] Verify `background.js` uses no DOM or persistent background-page assumptions that fail in a Chrome service worker.
- [ ] Test popup reconnection and scan-session behavior after Chrome suspends and restarts the service worker.
- [ ] Verify `world: "MAIN"`, `all_frames`, `match_about_blank`, and `match_origin_as_fallback` on current stable Chrome and Firefox.
- [ ] Verify that `browser_specific_settings` is accepted/ignored appropriately by the Chrome package, or produce browser-specific manifests from one reviewed source.
- [ ] Verify Firefox sidebar docking and Chrome side-panel docking against their store packages; confirm the separate pop-out fallback remains tab-bound in both browsers.
- [ ] Test the toolbar popup, DevTools panel, capture, exact/range/unknown scans, comparison refinement, write, freeze, watches, cancellation, memory growth, and popup reopening in both browsers.
- [ ] Test a Ruffle AVM1 game, a Ruffle AVM2 game, and a non-Ruffle WebAssembly control page in both browsers.
- [ ] Test nested and cross-origin player frames where host permissions allow access.
- [ ] Test install, browser restart, extension update, disable/re-enable, and uninstall flows.
- [ ] Confirm that private-window behavior matches the listing and does not retain private-browsing data.
- [ ] Record the minimum supported Chrome version after compatibility testing.
- [ ] Reconsider Firefox's current `strict_min_version: 128.0` against the APIs and data-declaration behavior used by the final build.

## 4. Privacy, support, and public documentation

- [ ] Add a public privacy policy URL, preferably on the `hack-engine` GitHub Pages site.
- [ ] Describe local processing plainly: the extension reads the active tab URL and captured WebAssembly memory locally to provide user-requested inspection.
- [ ] State exactly what persists and for how long, including scan history, watches, imported workspaces, IndexedDB snapshots, and what is cleared on reset/reload/uninstall.
- [ ] State whether any information leaves the browser. For the current architecture, the intended answer is **no**; verify this against the release package.
- [ ] Provide a support email and public support/issues URL.
- [ ] Add installation instructions for both Chrome and Firefox.
- [ ] Add an end-user guide covering the simple popup, full inspector, value types, false matches, restored/cached values, freeze behavior, and recovery after a player crash.
- [ ] Add a security/contact process for vulnerability reports.
- [ ] Add a changelog and release notes for the submitted version.
- [ ] Make the GitHub Pages status, repository name, privacy URL, support URL, and store-facing product name consistently say **Hack Engine**.

## 5. Store assets and listing copy

- [ ] Prepare a concise summary and a detailed description using the same claims as the tested release.
- [ ] Prepare screenshots that show the toolbar quick scan, candidate refinement, write/freeze controls, and full inspector without exposing personal tabs or browsing data.
- [ ] Use only games/content that can be shown legally in promotional images, or use the local test harness.
- [ ] Prepare a clean 128×128 store icon.
- [ ] For Chrome, prepare at least one 1280×800 screenshot (up to five) and a 440×280 small promo tile.
- [ ] Optionally prepare Chrome's 1400×560 marquee tile and a short YouTube demonstration.
- [ ] Prepare Firefox listing screenshots, captions, summary, long description, categories, support details, and license selection.
- [ ] Avoid claims that the extension can always find a displayed value; explain that values may be encoded, duplicated, recalculated, or held outside linear memory.
- [ ] Include this safety boundary in both listings: use only with software and content the user is authorized to inspect.

Suggested single-purpose text:

> Hack Engine is a local developer tool for finding, watching, and editing numeric values in WebAssembly memory used by embedded Ruffle players.

Suggested reviewer context:

> Hack Engine installs a document-start hook because Ruffle may instantiate WebAssembly before a user can open the toolbar popup. Host access is used only to capture WebAssembly memory in the current page and permitted frames. Scans, writes, freezes, and watches run locally. The submitted version does not transmit browsing activity, page content, or memory values to the developer or any third party. Reviewers can use the included local harness instructions without an account.

## 6. Build and release validation

- [ ] Start from a clean, committed tree on the intended release tag.
- [ ] Run JSON, JavaScript syntax, and diff checks.
- [ ] Run `web-ext lint --warnings-as-errors` against the Firefox package.
- [ ] Run all page-level browser harnesses.
- [ ] Run the live Firefox extension bridge and popup/session harnesses.
- [ ] Add and run equivalent live Chromium extension harnesses against the exact Chrome package.
- [ ] Perform manual QA on current stable Firefox and Chrome using at least two real Ruffle games.
- [ ] Build production ZIP files with `manifest.json` at the archive root—not inside a parent directory.
- [ ] Inspect each archive with `unzip -l` and confirm it contains only runtime/review files and no secrets, profiles, logs, test data, `.git`, or generated artifacts.
- [ ] Load each final archive, not the working directory, into its target browser and repeat the release smoke test.
- [ ] Record archive SHA-256 hashes.
- [ ] Create an annotated git tag and GitHub release containing checksums and release notes. Do not publish unsigned Firefox builds as installable release artifacts.

## 7. Chrome Web Store submission

- [ ] Register the publisher in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/) and pay the one-time registration fee.
- [ ] Enable and verify 2-Step Verification on the publisher account; it is required to publish or update extensions.
- [ ] Complete the publisher contact, identity, and any trader-verification prompts shown by the dashboard.
- [ ] Upload the Chrome production ZIP.
- [ ] Complete the store listing, category, language, screenshots, icon, tile, support URL, and homepage URL.
- [ ] In **Privacy practices**, enter the narrow single purpose and justify `tabs` and `<all_urls>` individually.
- [ ] Declare **No remote code** after verifying the final archive.
- [ ] Complete the data-use disclosures accurately. Chrome considers locally processed browsing activity and website content part of data handling, even when they are not transmitted.
- [ ] Link the public privacy policy and ensure its statements exactly match the dashboard disclosures and extension behavior.
- [ ] Choose initial visibility: Private trusted testers, Unlisted, or Public. All visibility levels still undergo policy review.
- [ ] Prefer deferred/staged publishing so approval does not automatically launch before final checks.
- [ ] Submit for review and monitor the publisher email and dashboard. Chrome currently warns that submission volume may extend review times.
- [ ] After approval, install the store-signed build in a fresh Chrome profile and run the smoke checklist before public launch.

Official references: [prepare the extension](https://developer.chrome.com/docs/webstore/prepare), [listing requirements](https://developer.chrome.com/docs/webstore/cws-dashboard-listing/), [privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy), and [distribution settings](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution).

## 8. Firefox Add-ons submission

- [ ] Create or connect a Mozilla Account to the [AMO Developer Hub](https://addons.mozilla.org/developers/).
- [ ] Confirm the permanent Gecko add-on ID and keep it unchanged across all future releases.
- [ ] Add `browser_specific_settings.gecko.data_collection_permissions.required: ["none"]` if the final build collects or transmits nothing outside the local browser; otherwise implement and declare the correct consent model.
- [ ] Build with `web-ext build` or an equivalent reviewed packaging process.
- [ ] Keep the package below AMO's 200 MB limit.
- [ ] Upload as **On this site** for a public AMO listing.
- [ ] Resolve validator errors and security/privacy warnings before continuing.
- [ ] Select compatible platforms and answer the source-code question accurately.
- [ ] If the submitted files are minified, bundled, generated, or otherwise difficult to review, upload corresponding source plus exact reproducible build instructions. Prefer the current readable, unminified source package.
- [ ] Complete name, unique AMO URL, summary, description, Experimental status, categories, support email/site, license, privacy information, and reviewer notes.
- [ ] Give reviewers a deterministic test procedure and explain why document-start `<all_urls>` access is essential.
- [ ] Submit the version and monitor AMO/email for post-submission review questions.
- [ ] Install the Mozilla-signed XPI in a fresh stable Firefox profile and run the smoke checklist.

Official references: [submitting an add-on](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/), [packaging](https://extensionworkshop.com/documentation/publish/package-your-extension/), [source-code submission](https://extensionworkshop.com/documentation/publish/source-code-submission/), and [Firefox data-collection declarations](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

## 9. Launch and ongoing releases

- [ ] Publish only after both signed store builds pass the same release smoke tests.
- [ ] Add the final Chrome and Firefox listing links to the README and GitHub Pages site.
- [ ] Archive the submitted ZIPs, signed Firefox XPI, checksums, listing copy, screenshots, privacy answers, permission justifications, and reviewer notes for each version.
- [ ] Keep a store-release matrix recording version, commit, tag, package hash, store item ID, submission date, approval date, and listing status.
- [ ] Monitor support channels, crash reports supplied voluntarily by users, store reviews, and policy emails.
- [ ] For every update, bump the manifest version, regenerate both packages from the same tagged source, rerun the full matrix, and upload through the existing item pages so users receive updates.
- [ ] Treat any new permission, telemetry, external request, account feature, or remote service as a fresh privacy and consent review for both stores.
