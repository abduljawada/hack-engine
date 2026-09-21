# Hack Engine 1.0 — essential feature roadmap

Prepared September 21, 2026. Proposal based on the current implementation and primary-source research, independently of the existing roadmap.

**Recommendation:** define 1.0 around a complete, dependable workflow: connect to a supported Ruffle game, find a numeric value, narrow the results, watch it, change or freeze it, recover from mistakes, and keep control when browser contexts change. Every essential workflow must work in Firefox and Chromium.

**Confidence:** high in the proposed scope; moderate in the effort estimate. Source inspection establishes what exists, but current real-game compatibility and restart behavior still need live testing. The existing packages passed their validator and the principal runtime files passed syntax checks during this review; these are not evidence of full browser compatibility.

**Working assumptions:** desktop release; embedded Ruffle games with numeric state in accessible WebAssembly memory; local processing; one developer using the existing codebase. Firefox and Chrome are the primary qualification targets. Edge and Brave receive separate smoke tests before being named as supported. Browser/version and OS support must reflect actual test results.

| Order | Essential capability | What 1.0 must deliver | Current foundation |
| --- | --- | --- | --- |
| 1 | Reliable game connection | Identify the inspected tab and player; distinguish ready, reload needed, access blocked, unsupported, and disconnected; offer the relevant recovery action. | Early memory capture and connection summaries exist; clearer states and lifecycle handling need work. |
| 2 | A complete scan workflow | Exact, range, unknown, changed/unchanged, increased/decreased; sensible automatic numeric types; advanced type/alignment/scaling controls; progress, cancel, reset, and one-step Undo scan. | Most scanning exists. Undo is a new essential addition. |
| 3 | Results users can understand | Accurate total versus displayed count; current value, type, and address; select, filter, sort, watch, and clear stale/unavailable indicators. | Live results and watches exist; consistent behavior across views needs qualification. |
| 4 | Controlled edits and freezes | Validate writes, verify readback, report when the game changes the value back; show active freezes; Stop all freezes; offer a guarded restore of the last written value. | Writes, diagnostics, and individual freezes exist. Global control and bounded recovery need additions. |
| 5 | Persistent controls in both browsers | Firefox sidebar and Chromium side panel provide the same core workflow, preserve the selected game, and stay synchronized with the popup and inspector. | Both adapters and shared state exist; lifecycle and multi-window tests remain essential. |
| 6 | Recoverable local workspaces | Preserve active work through popup closure and background restart; save named watch lists and scan settings locally; validate import/export; require revalidation after game reload. | Shared in-memory state and inspector import/export exist. Durable metadata and reconnection need work. |
| 7 | Responsive, isolated sessions | Keep large scans cancellable, bound memory/storage use, isolate simultaneous games, and clean up only the relevant session's snapshots. | Chunking, compression, cancellation, and large-memory tests exist; ownership and resource limits need hardening. |
| 8 | A usable first run and release | A small practice game/tutorial, useful error messages, keyboard access, readable narrow panels, and tested install/update packages for both browsers. | Guides, UI, tests, and packaging exist; onboarding and release qualification need completion. |

**Milestone 1 — establish reliable targets and sessions (approximately 4–6 working days).**

Make each active session identify the tab, document generation, frame, and captured memory. Reloading a game must invalidate its old addresses even if the new player reuses the same numeric instance ID. Keep a visible game/tab label and explicit target switching in persistent views.

Make popup, sidebar, and inspector connections recover automatically. Preserve small session metadata through extension background shutdown, and ask the still-running page agent for authoritative scan and freeze state when reconnecting. Do not serialize live WebAssembly objects or large memory snapshots into extension session storage. Browser restart restores saved workspace metadata; it cannot resume the previous game's live memory.

Scope snapshot ownership and cleanup per live session, including simultaneous tabs or frames on the same origin. Add tests for stale messages, two concurrent scans, game reload, and forced background termination.

**Exit gate:** two games can be inspected concurrently without sharing results or deleting each other's snapshots; switching tabs never redirects an existing write; closing/reopening views and restarting the extension background recover the correct live session or clearly invalidate it.

**Milestone 2 — finish the everyday search experience (approximately 5–7 working days; follows Milestone 1).**

Qualify the existing scan modes on controlled fixtures and real Ruffle games. Keep automatic numeric representation selection in the simple workflow, with range scanning for rounded numbers and existing advanced controls available when needed. Show the full candidate count separately from the limited preview.

Add one-step Undo scan that restores both the previous candidates and the comparison baseline. Cancellation must preserve the last completed scan. Keep only the checkpoint needed for one undo and account for its storage before refining; if resources are insufficient, explain that before discarding recovery data. Undo changes scan results, not gameplay.

Give zero-result scans actionable choices: undo, widen the range, change numeric representation, or reset. Add a small locally served or bundled practice experience with known editable values and concise steps. Verify keyboard-only operation, focus visibility, labels, and usability at 200% zoom in a narrow panel.

**Exit gate:** a first-time tester completes find → refine → watch on the practice game without developer assistance in both browsers; a mistaken refinement is recoverable; exact/range/unknown paths and cancellation pass the same fixtures.

**Milestone 3 — make edits and saved work dependable (approximately 5–7 working days; follows Milestones 1–2).**

Finish the shared watch list: labels, groups, removal, live/unavailable status, and editing from the persistent panel. Preserve existing inspector features without requiring the full inspector for ordinary use.

Add an always-accessible Stop all freezes action for the inspected game and an active-freeze count. Reconcile that state after reconnecting. Closing a popup must not make an active freeze invisible or uncontrollable. Define and test behavior when the page is hidden, suspended, disconnected, or the extension is disabled. Stop active writes when control is lost as soon as the page can execute; do not promise continuous background freezing.

Retain pre-write bytes for a guarded “Restore previous value” action within the same live document and memory. Disable it after invalidation; if the game has since changed the value, explain the conflict before overwriting it. This restores an address's earlier contents, not the game's overall state.

Save named watch lists, labels, and scan settings locally. Import/export is available from the persistent workflow. Imported and restored addresses start as unverified: require the correct target and explicit user revalidation before writing or freezing. Never automatically replay writes or freeze commands after a reload or import.

**Exit gate:** all views agree on watches and active freezes; Stop all works after reconnection; a saved workspace survives browser restart without treating old addresses as live; malformed or oversized imports fail cleanly.

**Milestone 4 — qualify and ship both browsers (approximately 6–10 working days; follows Milestones 1–3).**

Make the existing browser test launchers discover or accept browser paths on Linux, Windows, and macOS. Retain the real-extension bridge tests and expand them to cover the lifecycle scenarios above. Use each browser's real extension runtime; page-only tests cannot establish extension parity.

Run the complete feature suite on current stable Firefox and Chrome. Test the declared minimum versions before claiming support for them. Perform the core install → connect → scan → edit → freeze → stop → save/reopen loop on Linux, Windows, and macOS. Qualify Edge and Brave separately if included in the release claim; record panel fallback behavior where required.

Use a documented small compatibility corpus: at least three AVM1 and three AVM2 games whose baseline behavior works in the chosen Ruffle build and for which inspection is authorized. Record versions, target values, expected outcomes, and failures. Cover top-level, nested, and permitted cross-origin frames with deterministic fixtures. Describe compatibility in terms of the tested games and memory representations, not a percentage of all Ruffle games.

Exercise the existing 225.5 MiB high-entropy unknown-scan fixture in both browsers, quota/storage failure, cancellation, memory growth, and two same-origin tabs. Proposed performance gates: Cancel acknowledges within 1 second on a foreground reference test machine; progress remains visible during long scans; ten scan/reset cycles leave no active orphan snapshots or continuing growth in owned session records. These are proposed targets, not measured performance claims. Establish the supported memory ceiling from measurements.

Check that ordinary pages and unrelated WebAssembly still work with the extension installed. Validate commands and imports at extension boundaries, reject stale or malformed messages, and keep page-origin data untrusted. Confirm private-window data isolation or explicitly exclude that mode. Keep diagnostic export user-initiated and exclude memory dumps and full browsing URLs by default.

Build packages from a clean release source set. Exclude macOS metadata and design files, align all version references to 1.0, inspect artifacts, and run Mozilla's official validator. Match permission and privacy disclosures to the final implementation, prepare store assets, and verify install/update through normal signed store distribution. Engineering readiness and store approval are separate release gates.

**Exit gate:** every essential scenario passes on the declared browser/OS matrix; no known wrong-target write, uncontrolled freeze, session collision, or silent stale-address restore remains; the signed builds complete the same smoke workflow. Store-review time is outside the engineering estimate.

**Browser-specific requirements belong in the same milestones.**

| Concern | Firefox | Chromium |
| --- | --- | --- |
| Persistent UI | Native sidebar, with explicit inspected-tab binding. | Native side panel, with explicit tab/window scope and tested opening/closing behavior. |
| Background lifecycle | Reconstruct state after event-page unload and reconnect ports. | Reconstruct state after service-worker termination; avoid depending on global variables or artificial keep-alives. |
| Data transport | Test page-to-content payloads through Firefox's wrapper boundary. | Test page/content/service-worker transport and restart recovery. |
| Release qualification | Real Firefox extension tests and Mozilla-signed installation. | Real Chrome extension tests and store installation; separately smoke-test named derivatives. |

The native panel APIs differ, so functional parity is the acceptance criterion. Use Firefox's [sidebar API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/sidebar_action) and Chromium's [side-panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) directly, with a small tested adapter and the existing pop-out fallback.

**Why these priorities follow from the inspected code.**

- `background.js` holds scans and workspaces in process-local maps. Popup reopening is already covered by a test, but that does not establish recovery after the background process itself restarts. Both [Chrome's lifecycle guidance](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) and [Mozilla's background guidance](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts) make persistence/reconstruction a necessary design consideration.
- `page-agent.js` assigns instance IDs from a per-page counter and initializes snapshot storage by clearing the shared origin's snapshot store. This creates a source-level collision/deletion risk for concurrent same-origin contexts; it has not been reproduced live in this review. Session ownership and reload invalidation therefore precede saved workspaces.
- Freeze writes use animation-frame callbacks. Browsers commonly pause those callbacks in hidden tabs and frames, so the product must communicate suspension accurately. [MDN documents this behavior](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).
- Workspace import currently associates saved addresses with the selected live instance and displays a warning. Explicit unverified state and write gating make that behavior clearer and less error-prone.
- The existing runners target macOS browser paths. Portable execution and tests on actual packaged extensions are prerequisites for a credible desktop support claim.

**Prior art and reuse.** The established first-scan/next-scan workflow already fits this product. Cheat Engine's [Undo scan](https://www.cheatengine.org/help/Standardscansettings.htm) provides a useful precedent for recovering from the common wrong-refinement mistake. [Cetus](https://github.com/Qwokka/Cetus) demonstrates browser-based WebAssembly searching and freezing; its binary instrumentation, disassembly, and patching expand into a different level of debugger complexity and are not prerequisites for this release. This review does not establish Cetus as a currently maintained drop-in dependency.

Keep the working scanner, native browser APIs, and existing tests. Prefer extension `storage.session` for small live-session metadata and `storage.local` for explicitly saved settings/workspaces; account for quotas and the storage permission. Use [Mozilla's WebExtension polyfill](https://github.com/mozilla/webextension-polyfill) only if testing finds an API compatibility gap it actually covers—it cannot provide missing browser-specific panel features. A framework rewrite is not required by this proposal.

**Scope boundary.** Defer pointer scanning, automatic address relocation, scriptable cheat tables, binary patching/disassembly, speed controls, cloud accounts/sync, public table sharing, and broad HTML5/JavaScript-game support. General worker-memory instrumentation is also deferred unless the agreed Ruffle compatibility corpus demonstrates that it is necessary for the core promise. Keep existing advanced controls, but do not make new specialist capabilities release blockers.

**Delivery expectation:** approximately 20–30 focused engineering days, or 4–6 weeks for one developer, plus store review. This is a planning range, not a deadline or commitment. Re-estimate after Milestone 1 and the first real-game compatibility run. If time becomes constrained, simplify polish and defer optional scope; retain target isolation, scan recovery, freeze control, and actual Firefox/Chromium qualification.
