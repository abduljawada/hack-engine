# Hack Engine toolbar popup — design QA

## Evidence

- Selected source: `/Users/ahmed/.codex/generated_images/019fc6f5-7b69-7a51-b2e2-cef2d880323c/exec-0fda6964-a151-43c1-8c00-ee857a39774d.png`
- Normalized source: `/tmp/hack-engine-source-normalized.png`
- Firefox implementation capture: `/tmp/hack-engine-popup-firefox-2.png`
- Comparison viewport: 380 × 560 px
- Source dimensions: 1033 × 1523 px, normalized to 380 × 560 px
- Implementation dimensions: 380 × 560 px at device scale 1
- Tested state: connected to a page with one captured Ruffle WebAssembly memory

## Visual comparison

- Typography: hierarchy, weight, and muted supporting copy match the selected direction.
- Spacing: header, active-tab section, status block, memory summary, and actions retain the reference rhythm at the popup viewport.
- Color and tokens: near-black surface, cool dividers, mint status/accent, and subtle outlined secondary actions are consistent.
- Iconography: generated Hack Engine brand mark is used for the product; standard actions use official Heroicons.
- Image quality: extension icon source is clean at the toolbar sizes and the popup mark remains legible.
- Copy: visible product naming is consistently “Hack Engine”; runtime-specific wording remains concise.
- Intentional differences: the browser owns the popup's outer frame; live test data replaces mock domain and memory values; a compact subtitle clarifies the extension purpose.

## Interaction QA — Firefox

- Live connection summary renders from the active tab.
- Open inspector launches the existing inspector in a persistent extension tab and preserves the inspected tab ID.
- Refresh connection reloads the original active tab.
- How it works opens the capabilities section of the project page.
- Popup harness completed without an uncaught runtime error.

## Iteration history

- First pass: P2 — standard action iconography was missing from the implementation.
- Resolution: added official Heroicons for tab, inspect, refresh, help, and navigation actions.
- Post-fix review: no remaining P0, P1, or P2 visual or interaction findings.

final result: passed
