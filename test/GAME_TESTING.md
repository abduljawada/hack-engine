# Real-game automation

`npm run test:games` visits the actual websites for all eight games in disposable Firefox and Chromium profiles. It builds the extension packages, establishes a baseline without the extension, then repeats with the installed package and its controls. The website supplies the game and player. **No local SWF, game directory, or locally installed Ruffle is needed for website tests.**

The runner follows the website's real frames and reports the runtime it finds. A title historically released in Flash may now serve a different runtime: Canabalt's Newgrounds page, for example, serves an HTML5 port. This remains a Canabalt website test; it is not evidence about the original Flash edition. Loading a player or opening the controls alone never qualifies a gameplay scenario.

## Commands

```sh
npm ci --ignore-scripts
npm run test:games

# Focus on a browser or game IDs; watch the actual game page.
npm run test:games -- --browser firefox --game F4 --headed

# Pinned local regressions are a separate, optional mode.
npm run test:games -- --mode local --game J1,W1
npm run test:games -- --mode local --prepare-only
npm run test:games -- --mode local --assets /absolute/game-assets --no-download

# Separate report location or reuse an already built extension.
npm run test:games -- --output /absolute/test-results --no-build

# Existing page and installed-package fixture regressions.
npm run build
npm run test:regression

# Existing checks, local J1/W1 regressions, and strict website qualification.
npm run release:verify
```

Website mode is the default; `--mode website` selects it explicitly. `--prepare-only`, `--assets`, and `--no-download` relate to local assets; preparation requires `--mode local`. `FIREFOX_PATH` and `CHROME_PATH` select browser executables. Linux is the initial automated platform. `--no-sandbox` is an explicit Chromium option for isolated CI environments that cannot create a browser sandbox. Profiles belong to the run, never the user's personal browser.

## What a pass proves

Each game requires website loading and runtime detection in both fresh browser phases, plus visible natural counter changes without the extension. With the extension installed, required targets must be discovered anew, refined after genuine gameplay, watched, edited, undone, frozen during a natural update, and released with Stop. Guarded undo must preserve a game-owned change. A stable number alone cannot prove freeze: an independent visible event must show an attempted update. All proposed targets count: Bloons cash qualification alone cannot qualify lives.

Asteroids adds range and unknown-value workflows. Chromium adds representative background-worker recovery. Ruffle instances require pause/resume, scan-owned pause release, preservation of a pre-existing pause, and cancellation. The runtime actually observed controls these requirements; a current HTML5 website does not inherit historical Flash pause requirements.

Observation uses text passed to game rendering or screenshot OCR. Unreliable readings are explicit automation blockers. Keyboard and pointer events drive gameplay. Extension actions use the packaged controls; no recorded memory address, private game state, or test-only scan/write API may substitute for discovery. Site load and browser automation problems are reported separately from extension assertions and inaccessible targets.

Controls open as packaged extension pages bound to the game tab. This verifies installed scripts, permissions, messaging, controls and lifecycle behavior. Native toolbar/sidebar opening, signed-store installation, minimum browser versions, and Windows/macOS qualification remain separate checks.

## Optional local regressions

`--mode local` serves verified copies on loopback origins for repeatable regression testing. Asteroids and Breakout revisions and hashes remain pinned. Local Asteroids adds controlled same-origin, nested-frame, cross-origin, and multiple-tab isolation cases; these complement the actual website's frame arrangement. A local pass does not replace website qualification.

Local Flash mode needs game assets, pinned Ruffle, and verified gameplay recipes described in [asset setup](games/ASSETS.md). Missing local SWFs block only those local cases. They never prevent a website run. Downloaded assets remain outside extension packages and source control.

## Reports and gates

Every invocation preserves its own HTML, JSON and JUnit report under `artifacts/game-tests/`. Reports include mode, website and final URLs, detected runtimes, observed resource metadata, browser/package versions and hashes, baseline/extension step results, screenshots and logs. Locally hosted assets additionally carry pinned file hashes. Live resource metadata is evidence about the resources observed in that run, not a claim that the remote site is pinned. Original failures remain in the report even if a diagnostic retry succeeds.

- **PASS:** every mandatory scenario and target completed with observed results.
- **FAIL:** a tested assertion or extension operation failed.
- **BLOCKED:** loading, interaction, reliable observation, or a full gameplay recipe was unavailable.
- **UNSUPPORTED TARGET:** a required target could not be discovered or demonstrated to affect gameplay.

Ordinary checks fail on actual failures, unsupported targets, or unavailable required open-source games. Blocked F1–F6 cases remain prominently incomplete coverage. `--strict` disallows filtering and requires all 16 combinations and mandatory scenarios. Neither blocked/unrun cases nor runtime smoke checks can satisfy it. HTML displays ordinary check status and full qualification independently; JUnit includes every case.

Strict website qualification also requires independent Flash evidence from **each browser and each phase**: the primary game's observed SWF SHA-256 and independently parsed AVM classification must match public Ruffle metadata, and the loaded Ruffle Wasm resources need SHA-256 hashes. Auxiliary advertising SWFs cannot provide that proof. Missing Firefox response bodies remain an explicit strict-gate gap; a Chromium hash cannot qualify Firefox. Ordinary gameplay results remain separate from this provenance gate.

Complete hashing of ordinary live JavaScript assets is not implemented. Recorded resource URLs, captured binary hashes, and optional local pins must not be described as proof that every website asset is pinned or hashed.

GitHub Actions runs unit checks, packaging/lint, existing browser regressions, local J1/W1 regressions, and website tests in both browsers on pull requests and main pushes. Node, browser versions, and test dependencies are pinned. Reports upload even after failures. Its manual strict option enforces full website qualification. External site outages can fail required website checks; local fallback results never silently turn those failures green.

There is no release publishing or tag creation in this workflow. Tests do not deliberately submit modified scores to remote leaderboards.

## Current qualification limits

The live Asteroids and Breakout workflows have passed in Firefox and Chromium. Bloons has a full cash/lives recipe. Firefox demonstrated both targets through edit, guarded undo, undo, freeze and stop, then failed the pause-under-input check: a player click dismissed Ruffle's Play overlay and gameplay resumed while the controls still displayed paused. The screenshots show 296 → 292 lives. This does not establish that idle pause fails, and later pause/lifecycle assertions remain unrun. Chromium's installed cash workflow passed, but its lives refinement stopped at two candidates, and its fresh baseline hit the startup deadline. Do not treat these partial runs as qualification.

Chibi Knight, Xeno Tactic 2, Cube Colossus and Canabalt have genuine website launch/gameplay input routes and retained visual evidence. Their requested numeric targets are not fully qualified: counter visibility, small-font OCR, graphical meters and exposed JavaScript roots can block later steps. These cases must remain blocked until reliable observation and the complete target workflows are demonstrated. Diggy's configured portal currently fails to expose a playable canvas/runtime after its Play input in the observed runs.

Firefox currently supplies response metadata without response-body hashes; this also prevents strict live Ruffle qualification even if gameplay assertions pass. Chromium records browser-loaded SWF/Ruffle response hashes and independently parses loaded SWFs. No result silently borrows a local copy or another browser's hash.
