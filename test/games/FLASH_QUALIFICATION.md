# Bloons Tower Defense 3: recipe qualification notes

These are the original **local development observations**, retained for provenance. The current live website recipe is [bloons-live.mjs](bloons-live.mjs); it operates the unmodified Newgrounds game without a local SWF. Its cash workflow was observed through genuine purchases and sales, and the full cash/lives sequence is implemented. Only a complete passing browser report establishes qualification; implementation or these notes alone do not.

Original SWF SHA-256: `e2153bc68d0742fe83f7757fe67ab51a80cb3f69ab7d2a8cb28a97cd72b257cb`. Independently parsed runtime: AVM2. Ruffle: 0.6.0. Inspected 2026-09-27 using the packaged Chromium extension in a disposable profile, with a 1280×900 viewport and device scale 1. The SWF's original stage is 640×480; this test host scales it.

Observed pointer sequence (intro timing has **not** been made deterministic):

- Ninja Kiwi intro: Play Now around (869, 677). The title screen's Start button is also near that location.
- First track: (220, 320); Easy difficulty: (270, 424).
- Game begins with cash 650 and lives 100.
- Dart Monkey button: (983, 165); legal placement: (100, 100). Cash changes 650 → 435.
- Sell button: (1080, 800). Selling that monkey adds 200, resulting in 635.
- Repeat purchase gives 420. No game state or memory was read directly; these numbers came from rendered screenshots.

Screenshot OCR with Tesseract.js 7.0.0, English, page segmentation 7 read both original counters with 96% confidence:

- Three-digit cash crop: `{ "left": 1138, "top": 15, "width": 78, "height": 32 }`.
- Lives crop: `{ "left": 1138, "top": 54, "width": 78, "height": 36 }`.

The cash crop must be widened and revalidated for longer edited values. A wider first attempt included the rounded panel border and produced `650)` at only 73% confidence; do not silently accept that reading.

## Discovered target and blocker

Through the packaged Advanced controls, an exact Int32 scan of 635 returned 124 candidates. A genuine purchase changed the displayed cash to 420; refinement left one candidate. Its address was discovered in that disposable session and is intentionally not recorded as a reusable locator.

Writing 9999 through the packaged controls produced a verified write diagnostic, but the game's rendered HUD remained 420. A subsequent genuine sale of the 200-value monkey changed the HUD to **10199**, proving the modified money affects game arithmetic. Guarded Undo write then correctly refused to overwrite the naturally changed value.

The original game refreshes its cash label on economy events. Therefore the generic scenario's immediate-HUD-write assertion does not establish support for this target. The live recipe therefore uses an explicit, verified event-after-write expectation (for example, sale proceeds added to the edited balance), and an Undo test that restores before the event and then verifies its arithmetic. Freeze also needs an independent purchase/sale receipt or other visible game event; unchanged cached HUD text is insufficient evidence.

At the time of these original local observations, lives, complete freeze/stop, repeatable intro synchronization, both-browser OCR, and the full mandatory scenario sequence were unqualified. Consult the current run report for later results; these historical observations do not establish a pass or weaken the release gate.

Local development screenshots are saved under `artifacts/game-tests/F4-exploration/` (generated and excluded from release packages).


## Live Newgrounds website qualification

`bloons-live.mjs` visits the actual Newgrounds embedding through `sites.mjs`; it does not require a local SWF. The test verifies a 640×480 stage, starts the game using browser pointer input, and reads the visible cash/lives HUD with Tesseract. The recipe discovers current targets through the installed extension's packaged controls.

On 2026-09-27, a disposable Chromium session on the live website established:

- Cash 650 → 435 on buying a Dart Monkey and → 635 on selling it.
- Exact Int32 635 scan: 137 candidates; another genuine purchase to 420 refined to one candidate.
- Write 1000 followed by a sale rendered 1200; guarded Undo refused after that sale.
- Write 2000 followed by Undo and a purchase rendered 985, proving restored arithmetic.
- Freeze 1000 produced successive sale/purchase receipts 1200 and 785; after Stop, a purchase/sale sequence resumed normal arithmetic, 785 → 985.
- An undefended wave reduced lives from 100 to 86. Exact refinement reduced 15,665 initial candidates to one. This discovery alone is not full lives qualification.

The live recipe additionally implements lives writes, exact Undo verification through the packaged watch, rendered loss receipts paired with restored frozen watch values, a complete undefended wave, Stop, Ruffle pause scenarios, reopening, tab binding with a real edit while another tab is active, and reload invalidation. These steps must pass in a report before the case can count as qualified; implementing them does not establish acceptance.

Original automated failures are retained in reports:

- `2026-09-27T10-42-43.693Z-371238`: Chromium baseline cash/lives passed, but extension startup remained in the title animation beyond the original 90-second bound. The startup bound is now 180 seconds while the overall case remains bounded.
- `2026-09-27T10-44-31.822Z-375661`: Firefox showed the placement preview but did not complete the purchase.
- `2026-09-27T10-49-01.322Z-380679`: Firefox completed the purchase but still showed the selected tower and Sell button after the sale input.

The browser adapter now lets a rendered frame update after moving the pointer before pressing, and monetary outcomes are polled for up to five seconds after an input. Transactions are not replayed to hide failures. Both browser adapter integration tests pass with a fixture that rejects a click before its hovered target has been updated on an animation frame. Subsequent real-game reports determine whether these timing changes resolve the observed game failures.

The focused Firefox input-settling baseline subsequently passed: starting cash/lives 650/100, one purchase to 435, one sale to 635, and an undefended wave reduced lives to 99. Evidence is under `artifacts/game-tests/F4-input-settling-firefox/`. This establishes the input fix for that baseline, not full extension acceptance.

The first full headed Chromium run found two cash candidates after its first refinement. The recipe now allows up to three additional genuine sale/purchase cycles, scans each rendered receipt, and records every count. It still refuses to edit unless exactly one candidate remains.
