# Hack Engine store-publishing checklist

Last reviewed: 2026-08-10

Target: publish Hack Engine as a Firefox-first, cross-browser Manifest V3 extension on Firefox Add-ons (AMO) and the Chrome Web Store (CWS).

## Current release status

Automated store-build work completed on 2026-08-10:

- Firefox and Chrome packages are generated from one reviewed manifest by `npm run build`.
- `npm run check` validates browser-specific manifests, local-only code, archive roots, exclusions, and SHA-256 checksums.
- Firefox's official `web-ext` validator reports zero errors and zero warnings.
- The complete page-level regression suite passes, including the 225.5 MiB unknown-value scan.
- The exact generated Firefox package passes its live WebExtension bridge test in Firefox 153.0.3.
- The exact generated Chrome package loads as an MV3 extension and passes the same live bridge test in Chrome 152.

Release decisions confirmed on 2026-08-10:

- Permanent Firefox add-on ID: `hack-engine@abduljawada.github.io`.
- Project license: MIT.
- Public support email: `a.abduljawad@outlook.com`.
- First store version: `0.7.0`; the AMO listing should be marked Experimental.

## Release blockers found in the current repository

- [x] Update the local Git remote from the old `ruffle-memory-inspector` URL to the renamed `hack-engine` repository and verify fetch/push.
- [x] Add a Chrome-compatible `background.service_worker` declaration through the browser-specific production build.
- [x] Add and validate a Chrome `side_panel` declaration corresponding to Firefox's `sidebar_action`.
- [x] Add Firefox's required `browser_specific_settings.gecko.data_collection_permissions.required: ["none"]` declaration.
- [x] Set the permanent Firefox ID to `hack-engine@abduljawada.github.io`. Do not change it after release.
- [ ] Publish the prepared `docs/privacy.html` page and verify its public URL after pushing the site.
- [x] Add the MIT project license and prepare MIT as the AMO license selection.
- [x] Add a reproducible production packaging command that excludes `.git`, tests, harnesses, design sources, screenshots, and other non-runtime files.
- [ ] Complete the remaining manual Chromium UI and service-worker restart matrix; the generated MV3 package already passes its automated live bridge test.

## 1. Freeze the release scope

- [x] Choose `0.7.0` as the first public store version and align the manifest, status page, release notes, and package names.
- [x] Define the single purpose consistently: **Inspect and edit numeric WebAssembly memory in embedded Ruffle players for authorized local debugging.**
- [x] Keep the popup, DevTools panel, store description, privacy disclosures, and reviewer notes consistent with that purpose.
- [x] State clearly that raw writes are experimental and can reset or crash the embedded player.
- [x] Avoid marketing the extension as a way to cheat online services, evade security, bypass paid features, or interfere with other users.
- [x] Mark the pre-1.0 AMO listing as **Experimental**.
- [x] Confirm from the release package that it contains no analytics, advertising, accounts, telemetry, native messaging, or external network transmission.

## 2. Permissions and policy review

- [x] Inventory every manifest permission and host permission in `store/PERMISSION_JUSTIFICATIONS.md`.
- [x] Document why `tabs` is necessary: the popup identifies/reloads the inspected tab and opens the full inspector for that tab.
- [x] Document why `<all_urls>` is necessary: the extension must install its hook at `document_start`, including permitted child frames, before an arbitrary embedded Ruffle player instantiates WebAssembly.
- [x] Evaluate optional host access and document why it would miss early Ruffle initialization.
- [x] Confirm that packaged JavaScript is readable, self-contained, and does not execute remotely hosted code.
- [x] Confirm that no `eval`, downloaded executable logic, obfuscation, or undeclared remote configuration exists.
- [x] Confirm that all functionality shown in the prepared listing works without external software, payment, or login.
- [x] Add an authorized-use statement to the listing and support documentation.
- [ ] Review the current [Chrome Web Store Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies) and [Mozilla Add-on Policies](https://extensionworkshop.com/documentation/publish/add-on-policies/) immediately before submission.

## 3. Cross-browser manifest and runtime work

- [x] Generate `background.service_worker: "background.js"` for Chrome while retaining Firefox's `background.scripts` package.
- [x] Verify `background.js` uses no DOM or background-page-only APIs and starts as a Chrome service worker.
- [ ] Test popup reconnection and scan-session behavior after Chrome suspends and restarts the service worker.
- [x] Verify the document-start page/content/background bridge on current Chrome and Firefox packages; manual nested/cross-origin Ruffle QA remains below.
- [x] Produce browser-specific manifests from one reviewed source; the Chrome package omits Firefox-only settings.
- [ ] Verify Firefox sidebar docking and Chrome side-panel docking against their store packages; confirm the separate pop-out fallback remains tab-bound in both browsers.
- [ ] Test the toolbar popup, DevTools panel, capture, exact/range/unknown scans, comparison refinement, write, freeze, watches, cancellation, memory growth, and popup reopening in both browsers.
- [ ] Test a Ruffle AVM1 game, a Ruffle AVM2 game, and a non-Ruffle WebAssembly control page in both browsers.
- [ ] Test nested and cross-origin player frames where host permissions allow access.
- [ ] Test install, browser restart, extension update, disable/re-enable, and uninstall flows.
- [ ] Confirm that private-window behavior matches the listing and does not retain private-browsing data.
- [x] Record Chrome 116 as the minimum because the persistent side-panel action depends on `sidePanel.open()`.
- [x] Set Firefox's minimum to 142 so both desktop and Android compatibility lint accept the built-in data declaration; the AMO listing remains desktop-only because `gecko_android` is omitted.

## 4. Privacy, support, and public documentation

- [ ] Add a public privacy policy URL, preferably on the `hack-engine` GitHub Pages site.
- [x] Describe local processing plainly in `PRIVACY.md` and `docs/privacy.html`.
- [x] State what persists and for how long, including session state and IndexedDB snapshots.
- [x] Verify and state that the submitted code does not send information outside the browser.
- [x] Provide `a.abduljawad@outlook.com` and the public GitHub issue tracker as support contacts.
- [x] Add installation instructions for both Chrome and Firefox.
- [x] Add an end-user guide covering the simple popup, full inspector, value types, false matches, restored/cached values, freeze behavior, and recovery after a player crash.
- [x] Add a private vulnerability-reporting path and public issue tracker in `SECURITY.md`.
- [x] Add a changelog and draft release notes.
- [x] Make repository-facing names and prepared URLs consistently say **Hack Engine**; public deployment verification remains open.

## 5. Store assets and listing copy

- [x] Prepare a concise summary and detailed description in `store/LISTING_COPY.md`.
- [ ] Prepare screenshots that show the toolbar quick scan, candidate refinement, write/freeze controls, and full inspector without exposing personal tabs or browsing data.
- [ ] Use only games/content that can be shown legally in promotional images, or use the local test harness.
- [x] Verify the existing store icon is exactly 128×128.
- [ ] For Chrome, prepare at least one 1280×800 screenshot (up to five) and a 440×280 small promo tile.
- [ ] Optionally prepare Chrome's 1400×560 marquee tile and a short YouTube demonstration.
- [ ] Prepare Firefox listing screenshots, captions, summary, long description, categories, support details, and license selection.
- [x] Avoid claims that the extension can always find a displayed value; document false matches and representations.
- [x] Include the authorized-use boundary in the prepared listing.

Suggested single-purpose text:

> Hack Engine is a local developer tool for finding, watching, and editing numeric values in WebAssembly memory used by embedded Ruffle players.

Suggested reviewer context:

> Hack Engine installs a document-start hook because Ruffle may instantiate WebAssembly before a user can open the toolbar popup. Host access is used only to capture WebAssembly memory in the current page and permitted frames. Scans, writes, freezes, and watches run locally. The submitted version does not transmit browsing activity, page content, or memory values to the developer or any third party. Reviewers can use the included local harness instructions without an account.

## 6. Build and release validation

- [ ] Start from a clean, committed tree on the intended release tag.
- [x] Run JSON, JavaScript syntax, release validation, and diff checks.
- [x] Run `web-ext lint --warnings-as-errors` against the Firefox package: zero errors and zero warnings.
- [x] Run all page-level browser harnesses successfully.
- [x] Run the live bridge against the exact generated Firefox package.
- [x] Add and pass the equivalent live bridge harness against the exact generated Chrome package.
- [ ] Perform manual QA on current stable Firefox and Chrome using at least two real Ruffle games.
- [x] Build production ZIP files with `manifest.json` at the archive root—not inside a parent directory.
- [x] Inspect and automatically validate each archive for runtime/review files and prohibited development content.
- [ ] Load each final archive, not the working directory, into its target browser and repeat the release smoke test.
- [x] Generate and validate `dist/SHA256SUMS.txt` for both archives on every build.
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
- [x] Confirm permanent Gecko add-on ID `hack-engine@abduljawada.github.io` and keep it unchanged across all future releases.
- [x] Add `browser_specific_settings.gecko.data_collection_permissions.required: ["none"]` for the local-only release.
- [x] Build with an equivalent reviewed, reproducible packaging process.
- [x] Keep the package below AMO's 200 MB limit (the current Firefox ZIP is under 100 KiB).
- [ ] Upload as **On this site** for a public AMO listing.
- [ ] Resolve validator errors and security/privacy warnings before continuing.
- [ ] Select compatible platforms and answer the source-code question accurately.
- [ ] If the submitted files are minified, bundled, generated, or otherwise difficult to review, upload corresponding source plus exact reproducible build instructions. Prefer the current readable, unminified source package.
- [ ] Complete name, unique AMO URL, summary, description, Experimental status, categories, support email/site, license, privacy information, and reviewer notes.
- [x] Prepare deterministic reviewer instructions and document-start `<all_urls>` justification in `store/REVIEWER_NOTES.md`.
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
