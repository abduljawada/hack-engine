# 1.0 implementation progress

Updated September 21, 2026. Approved scope: [essential-feature roadmap](ROADMAP_1_0_PROPOSAL.md). Status: **implemented development candidate; public release qualification remains open**. The original design file is preserved.

## Implemented

- **M1 — reliable sessions:** document-scoped memory IDs, ownership-aware snapshot cleanup, reconnecting controls, session metadata persistence, authoritative page-state reconciliation after background restart, and stale-document/bridge rejection.
- **M2 — scan recovery:** one-step undo for both candidates and comparison baselines; failed/cancelled refinements retain the completed scan; a bundled practice game; actionable empty-result states. Narrow-panel layout inspected. Full accessibility and first-time-user acceptance remain open.
- **M3 — controlled changes and saved work:** stop all freezes with count, freezes stop when the game is hidden or control disconnects, guarded restoration of the last write, labelled/grouped watches, named local workspaces, validated import/export, and explicit address revalidation. Saved data never replays writes or freezes.
- **M4 — local engineering checks:** portable browser discovery, browser-specific 1.0.0 packages, source archive, metadata exclusion, actual installed-extension workflow tests, and updated privacy/reviewer/user documentation.

## Verified locally

Environment: Linux x86_64, Node 26.8.1, npm 11.19.0, Firefox 155.0.1, Chromium 152.0.7977.82. Tests use disposable browser profiles.

| Check | Result and boundary |
| --- | --- |
| Unit recovery tests | 2 passed: background recovery/document invalidation; isolation from another frame's newer session. |
| Chromium page regression suite | 17 fixtures passed, including scanning, cancellation, freeze, diagnostics, representation discovery, candidate retention, growth, bridge payloads, UI adapters, and large snapshots. These use controlled fixtures, not a real-game compatibility corpus. |
| Packaged Firefox and Chromium UI | Passed connection to practice memory, exact scan/refine/undo, write/restore, freeze/stop, immediate label edit/save, and staged workspace loading with required verification. |
| Actual Chromium worker shutdown | Completed scan and usable controls recovered after forced service-worker termination. |
| Firefox recovery fixture | Passed numeric/snapshot undo, restoration conflict refusal, freeze stop, same-origin snapshot isolation, and cancellation retaining its baseline. |
| Large unknown snapshot | Both engines stored/refined a 236,532,807-byte high-entropy fixture (about 225.5 MiB). Firefox required a disposable profile on the regular disk: a small RAM-backed temporary filesystem triggered the quota guard. This is a storage-dependent limit, not universal capacity. |
| Release validation | Both packages passed the allowlist/manifest validator. Mozilla lint: zero errors, warnings, or notices. Source rebuild reproducibility checked against both release archives. |
| Layout | Default and 360-pixel-wide controls inspected using a mock preview; this does not certify native panel behavior or accessibility. |

## Candidate limits

- Scans above 256 MiB are rejected. Snapshot scans also require sufficient estimated site-storage quota; one undo checkpoint consumes additional storage.
- Active scan state depends on the live game document. Browser/game restart requires rediscovery and revalidation; saved watch metadata survives through local storage.
- Freezes stop when the game becomes hidden or the extension bridge disconnects. They are not continuous background automation.
- Snapshot storage is owned by the game origin. Where Web Locks are available, abandoned owners can be cleaned without deleting another active document's records. Without them, conservative cleanup can leave abandoned records until site data is cleared.
- Private browsing is explicitly disabled for this candidate.

## Remaining release gates, in order

1. Qualify at least three AVM1 and three AVM2 real Ruffle games; record game/Ruffle versions, values, and results. Verify permitted cross-origin/nested-frame cases and ordinary-page compatibility with actual packages.
2. Exercise native Firefox sidebar and Chromium side-panel opening, closing, tab/window binding, keyboard navigation, 200% zoom, and first-time-user practice completion. Packaged UI automation opens the shared panel document in a tab; adapter fixtures do not replace native-window acceptance.
3. Measure the proposed foreground cancel latency and ten-cycle snapshot cleanup/resource gates, including explicit quota failure/recovery. The cancellation recovery test is not a latency benchmark.
4. Qualify current/minimum browser versions on Windows and macOS; test Edge/Brave separately before naming them supported. Complete browser restart, update, and multi-window acceptance.
5. Review final store assets/disclosures, obtain signed store builds, and verify ordinary install/update. No store submission, publication, or signing was performed here.

No calendar release date is established by these local checks. Complete the gates above before promoting this development candidate to a public 1.0 release.
