# Hack Engine toolbar popup — design QA

## Evidence

- Selected source: `/Users/ahmed/.codex/generated_images/019fc6f5-7b69-7a51-b2e2-cef2d880323c/exec-0fda6964-a151-43c1-8c00-ee857a39774d.png`
- Normalized source: `/tmp/hack-engine-source-normalized.png`
- Firefox implementation captures: `/tmp/hack-engine-popup-compact.png` and `/tmp/hack-engine-popup-pinned.png`
- Comparison viewport: 420 × 720 px
- Source dimensions: 1033 × 1523 px, normalized to 380 × 560 px
- Implementation dimensions: 420 × 720 px at device scale 1
- Tested state: connected to a page with one captured Ruffle WebAssembly memory

## Visual comparison

- Typography: hierarchy, weight, and muted supporting copy match the selected direction.
- Spacing: the header, quick-scan controls, and actions retain a compact, consistent rhythm at the popup viewport.
- Color and tokens: near-black surface, cool dividers, mint status/accent, and subtle outlined secondary actions are consistent.
- Iconography: generated Hack Engine brand mark is used for the product; standard actions use official Heroicons.
- Image quality: extension icon source is clean at the toolbar sizes and the popup mark remains legible.
- Copy: visible product naming is consistently “Hack Engine”; runtime-specific wording remains concise.
- Intentional differences: the browser owns the popup's outer frame, and the live connection state appears as a compact subtitle under the product name.
- Quick scan: the simple view exposes condition and value controls without numeric-type or ActionScript-detail rows; runtime guidance remains automatic internally.
- Progressive disclosure: range maximum, cancellation/reset controls, results, and the candidate editor remain hidden until relevant.
- Header efficiency: product name, live connection subtitle, and pin occupy one compact header; the decorative mark, active-tab block, separate status card, and captured-memory card are removed.
- Docked mode: the active mint pin communicates that the Firefox sidebar is open and remains visible while interacting with the inspected page.
- Floating mode: **Pop out window** is a separate secondary action because an ordinary extension window cannot be forced to stay above Firefox.
- Advanced mode: a persistent-only segmented switch reveals explicit scan configuration without adding complexity to the transient toolbar popup.
- Advanced workspace: candidates and watches use separate tabs, a compact narrow-column layout, and an editor shared with the selected value.

## Interaction QA — Firefox

- Live connection summary renders from the active tab.
- Open inspector launches the existing inspector in a persistent extension tab and preserves the inspected tab ID.
- Refresh connection reloads the original active tab.
- How it works opens the capabilities section of the project page.
- Popup harness completed without an uncaught runtime error.
- ActionScript-guided first scans send the internal smart mode, while candidate writes and freezes retain the detected numeric type.
- Quick scan state and completed results survive closing and reopening the toolbar popup.
- Visible simple-view candidates refresh in one batched read every 250 ms without changing the retained scan set.
- Simple and Advanced views share one scan session; switching views neither resets nor repeats the scan.
- The full inspector joins that same tab-scoped session, so opening it inherits the active scan, candidates, watches, primary selection, and freeze state.
- Filters, sorting, expanded sections, bulk checkbox selection, and unsubmitted write drafts remain local, preventing disruptive cross-window UI changes.
- Advanced mode exposes number format, alignment, stored-value multiplier, and captured-memory selection before the first scan, then locks representation controls during refinement.
- The Advanced candidate list displays up to 200 live values, supports filtering and sorting, and automatically watches a value when it is selected.
- Both candidate editors expose compact type-aware minimum and maximum presets without writing until the user confirms **Write value**.
- Sidebar watches continue polling after a scan reset and are capped so one batched read remains within the page agent's 256-entry limit.
- Pinning docks the controls in Firefox's sidebar, retains the original inspected-tab target, and the active pin closes the sidebar.
- Pop out creates or focuses one floating utility window per inspected tab and opens related tabs in the target's original browser window.

## Iteration history

- First pass: P2 — standard action iconography was missing from the implementation.
- Resolution: added official Heroicons for tab, inspect, refresh, help, and navigation actions.
- Quick-scan pass: P2 — author CSS overrode the native `hidden` attribute, exposing the range maximum and empty candidate editor during an exact first scan.
- Resolution: made hidden state authoritative and added computed-style regression assertions.
- Compact-header pass: reduced connection state to a subtitle and removed captured-memory and ActionScript-detail rows, bringing scan controls directly below the header.
- Pinning pass: replaced the focus-sensitive floating pin behavior with Firefox sidebar docking and kept floating mode as a separate pop-out action.
- Advanced-sidebar pass: added progressive scan controls, shared-session candidate rendering, live watches, and responsive candidate/editor layouts without expanding the native popup.
- Post-fix review: no remaining P0, P1, or P2 visual or interaction findings.

final result: passed
