# Real-game automation

The default `npm run test:games` runs original pinned copies of Asteroids (J1, JavaScript), Breakout (W1, WebAssembly), Interactive Buddy v1.01 (F7, AVM1), and Bloons Tower Defense 3 (F4, AVM2) in disposable Firefox and Chrome-family profiles: eight required configurations. Games are served on loopback. The test starts with a clean baseline without the extension, then repeats with the packaged extension and its public controls.

`npm run test:compatibility` separately exercises the actual public websites. A blocked website remains BLOCKED and fails that compatibility run. It cannot be relabeled as a local pass. Conversely, external website access challenges do not replace the controlled release gate. The two reports describe different evidence.

## Commands

```sh
npm ci --ignore-scripts
npm run test:games
npm run release:verify

# Focused controlled diagnosis; does not qualify the full matrix.
npm run test:games -- --game F4 --browser firefox
npm run test:games -- --mode local --assets /absolute/game-assets --no-download
npm run test:games -- --mode local --prepare-only

# Public websites, retaining external access and compatibility failures.
npm run test:compatibility
npm run test:games -- --mode website --game F2 --browser firefox --headed

# Existing page and installed-package regression checks.
npm run test:regression
```

`--strict` requires all four selected games in both browsers and every mandatory target/scenario. Filters that omit a selected game or browser are rejected. `--no-build` reuses a fixed packaged build, and `--output` chooses a separate report directory. Do not rebuild shared `dist/` during a run: reported package hashes must describe the exact files loaded throughout it.

`FIREFOX_PATH` and `CHROME_PATH` override executables. CI pins Firefox 155.0.1, Google Chrome for Testing 152.0.7977.82, and Node 24.14.0. Local discovery can use Chromium. `--no-sandbox` is explicit for isolated CI environments. Profiles never reuse the user's personal browser. All automated test-browser launches are muted; rendering, timing, and gameplay remain active.

## What core qualification proves

Both clean baseline and installed-extension phases must load the real game. Required targets are discovered anew, refined after genuine gameplay, watched, edited, undone, frozen during a real update, and released with Stop. Guarded undo preserves a game-owned change. A stable number alone does not prove freeze; independent visible gameplay must establish an attempted update. Bloons cash alone cannot qualify its lives target, and optional Xeno gold alone cannot qualify its Shield/lives target.

Asteroids adds range/unknown scans and controlled same-origin, nested, cross-origin, and tab-isolation regressions. The Chrome adapter additionally exercises background-worker recovery. Ruffle cases require manual pause/resume, active scan-owned pause, preservation of an existing pause, and cancellation with playback recovery. Pause observation is armed before the UI action and must see public suspension strictly inside an observed active-scan interval. Ownership and cancellation checks use a genuine exhaustive search; cancellation additionally requires the packaged UI's explicit acknowledgement, so ordinary scan completion cannot pass. All eight configurations must finish; a retry does not erase an original failure.

Observers inspect rendered text, canvas drawing arguments, screenshot pixels, or documented public player metadata. They never obtain counters from private game state or substitute recorded memory addresses. Inputs drive gameplay, and extension actions use the packaged controls. Asteroids waits for completed rendered frames without outstanding player shots before exact edit/undo checks, so an earlier bullet cannot race the intended assertion. Exact values and deadlines remain enforced.

## Original assets and provenance

See [ASSETS.md](games/ASSETS.md). Existing MIT games use pinned upstream revisions and hashes. The original publicly served Flash downloads have fixed SWF hashes and independent AVM classification; local testing authorization is recorded, with no redistribution rights asserted. Ruffle uses the verified official 0.6.0 archive, exact archive integrity, and extracted-file hashes. Assets stay outside extension packages/source archives and are not uploaded as test artifacts.

Each Ruffle phase must identify the expected AVM through public metadata and independently parse the actual loaded SWF bytes. Loaded SWF and Wasm hashes must match the local catalog pins. Firefox 143+ BiDi response collection and Chrome response capture read the actual browser requests; neither refetches a URL or borrows another browser's hash. Missing capture, drift, wrong AVM, or mismatched bytes fails qualification.

## Reports and CI

Each run preserves HTML, JSON, JUnit, screenshots, browser logs, package versions/hashes, asset provenance, and step results. PASS means all required scenarios completed; FAIL means an assertion failed; BLOCKED means loading/observation or a complete recipe was unavailable; UNSUPPORTED TARGET means editing a required target could not be demonstrated.

Local reports expose the core release gate. Website reports label their strict matrix as compatibility and cannot assert a core release pass. Unit/package checks and browser integration remain independent prerequisites. The core CI workflow runs the full eight-case controlled suite. The separate advisory compatibility workflow runs the same eight live-site cases, keeps failures visible, and retains evidence even when sites deny access. Neither workflow tags or publishes a store version.

Native sidebar entry points, signed-store installation, minimum browser versions, and other operating systems remain separate release checks.

## Repair evidence and remaining limits

The September 28 investigation reproduced an Asteroids race: an already-fired bullet changed the score between a successful write and the next rendered frame. Three repaired Chrome cases and one Firefox case passed, followed by all four local Asteroids/Breakout cases. The full gate still requires fresh evidence for all selected games.

A real Ruffle interaction also resumed a paused Bloons game when its Play overlay received a click, while the extension controls still reported paused. The owned-pause input guard now prevents activation while allowing held-key/button releases; real Firefox and Chrome probes verify explicit Resume remains functional. Full Bloons runs exposed a separate reset/scan race: delayed deletion of old snapshots cleared a newer session. Reset now detaches old snapshots immediately and clears only the session it captured, with regression coverage for a newer scan started during cleanup. A separate background regression reproduced an older agent snapshot replacing a newer optimistic scan request; reconciliation now preserves the active request while its source still exists, but accepts matching completion and document invalidation. Xeno's stylized gold font and Shield observation remain qualification work, not waived assertions.

Core CI [36417955861](https://github.com/abduljawada/hack-engine/actions/runs/36417955861), at commit `75e88eee063f66f95e2e7f14f3258c39bce024dc`, passed Asteroids, Breakout, and complete Bloons workflows in both browsers: six of eight configurations. Xeno Firefox remained blocked on OCR, and Xeno Chrome remained blocked on loaded runtime provenance. The full gate failed and cannot authorize merging. That run predates the qualified AVM1 replacement described below.

The core run's missing Chrome runtime hash was diagnosed as capture checked before response completion; the adapter now waits for actual response completion/body capture within 15 seconds, retaining a blocker for failed or stalled captures and preserving all pins.

The separate live-site run [36417955897](https://github.com/abduljawada/hack-engine/actions/runs/36417955897) finished with one PASS, five BLOCKED, and two FAIL. Asteroids Chrome navigation was blocked; Breakout presented Security Verification in both browsers; Xeno counter OCR was unreliable; Bloons Firefox failed reload invalidation and Chrome timed out during pointer input. These compatibility failures remain unresolved and are not converted to controlled-suite passes.

Historical failed/partial runs remain failed evidence. This setup does not itself certify or publish the current candidate. Local network certificate errors and public-site Security Verification challenges are reported without bypassing them.

## Qualified AVM1 representative

After bounded Xeno investigation left its tiny counter and Shield/lives workflow unreliable, the user-approved replacement was qualified on September 28. Interactive Buddy v1.01 (F7) completed the same full gameplay, pause, cancellation, lifecycle, and loaded-byte provenance requirements in both Firefox and Chrome in run `2026-09-28T12-34-45.485Z-447790`. Only the AVM1 slot changed; Asteroids, Breakout, and Bloons remain required. Xeno remains explicitly selectable with its unresolved outcomes preserved.

Buddy uses its original 550×400 stage and device-scale-2 screenshots. Standard Tesseract confidence applies to the complete numeric currency word at ≥85%; unrelated tool-label text or a moving limb cannot lower or substitute that confidence. All 110 retained cash screenshots passed this observer. Natural earnings refine candidates, and bounded reversible challenges test and restore every remaining candidate, requiring exactly one that changes rendered funds and subsequent real earnings. An initially unaffordable purchase must unlock an item. Undo confirms fresh public watch reads at 2000 and the restored 985, then requires a genuine purchase from that balance. Freeze requires three distinct shop unlocks while funds stay fixed; Stop must restore ordinary deductions. Purchases wait for rendered item and price readiness and are never blindly retried.

These focused results do not replace fresh full-matrix CI. All eight required configurations, existing browser regressions, package checks, and lint must pass on the reviewed release commit. Historical failures, including the later local Firefox screenshot transport timeout, remain retained evidence rather than silently successful runs.

## Subsequent CI evidence

Core run [36423899765](https://github.com/abduljawada/hack-engine/actions/runs/36423899765) on `60b9ac3a0810b947f327550a2c9321b00019c176` passed five of eight configurations. Buddy in both browsers completed its scan instead of acknowledging cancellation; Bloons Chrome was blocked by loaded Wasm provenance. All preceding unit, package, lint, adapter, and browser regression steps passed, but this failed matrix cannot authorize a merge.

The corresponding advisory run [36423899822](https://github.com/abduljawada/hack-engine/actions/runs/36423899822) finished with one PASS, three BLOCKED, and four FAIL. Asteroids Firefox passed; Asteroids Chrome navigation was blocked; Breakout showed Security Verification in both browsers. Bloons Firefox encountered an unavailable Pause control and Chrome timed out during pointer input. Buddy Firefox did not acknowledge cancellation, and Chrome could not read the selected shop item with sufficient confidence. These live-site failures remain visible and separate from controlled qualification.

The follow-up cancellation repair arms a public controls observer before scanning and clicks Cancel once at visible positive partial progress. It still requires explicit cancellation acknowledgement and public suspension strictly within the active scan. A retained Chrome trace from local run `2026-09-28T13-03-05.851Z-470937` exposed repeated `disabled=true` mutations splitting one busy interval into artificial boundaries; interval detection now uses actual state transitions, with the original trace and strict boundary/idle-gap regression cases. That local run remains Firefox PASS / Chrome BLOCKED, rather than being relabeled after the fix.

The later Bloons Chrome provenance failure was an HTTP 200 Wasm request followed by `net::ERR_ABORTED` without captured bytes, not an observed differing hash. Chrome now observes the same request's streamed response bytes. An aborted stream can expose a hash only when its unencoded byte count exactly matches its declared Content-Length; the unchanged release gate must then match the immutable runtime pin. Truncated, unknown-length, encoded aborted, or mismatched responses remain blockers. Controlled responses declare their exact served byte length. No request is refetched and no local or other-browser hash substitutes for loaded bytes.

Final cancellation run `2026-09-28T13-07-50.776Z-478472` completed all Buddy scenarios in both Firefox and Chrome. Both reported `Scan cancelled.` after one visible partial-progress click, retained a public suspended sample inside the actual busy interval, and resumed playback. The full current-head CI matrix remains required before merge.

Focused Bloons Chrome run `2026-09-28T13-09-50.406Z-481427` passed all 38 steps, including cash, lives, pause/cancellation, lifecycle, and both phases of same-request streamed Wasm provenance. Each phase captured the exact pinned 14,244,515-byte runtime. The intermittent cause of the original Chrome transport abort remains unproven; complete captured bytes are now retained without substituting another request.
