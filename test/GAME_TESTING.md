# Real-game automation

The default `npm run test:games` runs original pinned copies of Asteroids (J1, JavaScript), Breakout (W1, WebAssembly), Xeno Tactic 2 (F2, AVM1), and Bloons Tower Defense 3 (F4, AVM2) in disposable Firefox and Chrome-family profiles: eight required configurations. Games are served on loopback. The test starts with a clean baseline without the extension, then repeats with the packaged extension and its public controls.

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

Both clean baseline and installed-extension phases must load the real game. Required targets are discovered anew, refined after genuine gameplay, watched, edited, undone, frozen during a real update, and released with Stop. Guarded undo preserves a game-owned change. A stable number alone does not prove freeze; independent visible gameplay must establish an attempted update. Bloons cash alone cannot qualify its lives target, and Xeno gold alone cannot qualify its Shield/lives target.

Asteroids adds range/unknown scans and controlled same-origin, nested, cross-origin, and tab-isolation regressions. The Chrome adapter additionally exercises background-worker recovery. Ruffle cases require manual pause/resume, active scan-owned pause, preservation of an existing pause, and cancellation with playback recovery. All eight configurations must finish; a retry does not erase an original failure.

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

A real Ruffle interaction also resumed a paused Bloons game when its Play overlay received a click, while the extension controls still reported paused. The owned-pause input guard now prevents activation while allowing held-key/button releases; real Firefox and Chrome probes verify explicit Resume remains functional. Full Bloons runs exposed a separate reset/scan race under investigation. Xeno's stylized gold font and Shield observation remain qualification work, not waived assertions.

Historical failed/partial runs remain failed evidence. This setup does not itself certify or publish the current candidate. Local network certificate errors and public-site Security Verification challenges are reported without bypassing them.
