# Changelog

All notable changes to Hack Engine are documented here.

## [1.2.4] - 2026-09-24

Not published to browser stores. Sidebar usability and a simpler live-session workflow.

- Put scanning ahead of secondary tools, increase form readability, and compact sidebar spacing.
- Arrange Condition and Value in a 70/30 row, with separate range bounds and a narrow-width fallback.
- Order scan actions as Scan, Undo scan, Reset; hide Undo when unavailable.
- Collapse Advanced runtime guidance and label the reload action explicitly.
- Remove Saved workspaces and all save/load/import/export controls. Preserve live watches and recovery tools; leave older stored records unused.
- Update documentation and regression checks for the simplified workflow.

## [1.2.0] - 2026-09-24

Local release; not published to browser stores. Broader browser-game inspection.

- Add bounded, on-demand JavaScript numeric property discovery, object selection, and stable live targets alongside WebAssembly memory.
- Extend scan/refine/undo, watches, verified writes/restore, and freeze/stop to JavaScript values; reject stale objects and unrepresentable typed-array writes.
- Capture synchronous Wasm instances, deduplicate shared memory, and scope Ruffle hints to identified modules.
- Export workspace v3 with JavaScript path hints; import v2 Wasm workspaces and require current-session resolution/revalidation.
- Add JavaScript practice, page/browser regressions, and installed Firefox/Chromium mixed-source workflow tests.
- Workers, private variables, and server state remain outside this expansion.

## [1.1.0] - 2026-09-23

Local release; not published to browser stores. External compatibility and signed-store qualification remain open.

- Consolidate controls into the toolbar, sidebar, and pop-out; remove the separate legacy inspector and DevTools registration.
- Migrate manual address entry, explicit batch watch/metadata selection, final write diagnostics, descending address/value sorting, and stalled-scan feedback into Advanced controls. Accept only current `hack-engine-workspace` version 2 imports; retire pre-release legacy import compatibility and defer scan history and bulk writes/freezes.

## [1.0.1] - 2026-09-21

Unpublished; external compatibility and signed-store qualification remain open.

- Show detected AVM and recommended variable types in Advanced, and prioritize those types in both Simple and Advanced candidate lists by default.
- Accelerated scan scheduling and sparse snapshot traversal, with a final cancellation checkpoint that preserves completed results and Undo before a new scan commits.

## [1.0.0 candidate] - 2026-09-21

Unpublished; external compatibility and signed-store qualification remain open.

- Added document-scoped memory identities, isolated snapshots, recovered background sessions, and reconnecting controls.
- Added one-step scan undo, guarded last-write restoration, stop-all freeze controls, and visible freeze state.
- Added locally saved workspaces with unverified import previews, labels/groups in the sidebar, and a bundled practice game.
- Added resource limits, portable browser discovery, recovery regressions, and packaged Firefox/Chromium UI tests.
- Excluded transfer metadata from packages and disabled private browsing pending qualification.

## [Earlier unreleased work]

- Changed candidate and watch values to normal font weight for a calmer, more consistent list hierarchy.
- Reworked the public website and README around the product, its core features, and the everyday scanning workflow.
- Replaced browser-priority positioning with clear Firefox and Chromium support language.
- Moved address-intelligence and compatibility-expansion work to post-release roadmap milestones so 1.0 can focus on a stable store launch.
- Added deterministic Firefox and Chrome release packaging and validation.
- Added store-facing privacy, security, reviewer, permission, and user documentation.
- Added browser-specific Firefox sidebar and Chrome side-panel manifests.
- Finalized the permanent Firefox add-on ID, MIT license, and public support contact for the 0.7.0 store release.

## [0.7.0] - 2026-08-10

- Added Ruffle-guided Simple scanning and a persistent Advanced sidebar view.
- Added exact, range, unknown, comparison, unaligned, and multi-type scans.
- Added live candidates, shared watches, writes, write diagnostics, and freezing.
- Shared scan and workspace state between the popup/sidebar and full inspector.
- Added sparse direct-address refinement, compressed large-memory snapshots, cancellation, and memory-growth recovery.
- Added type-aware minimum and maximum write presets.
