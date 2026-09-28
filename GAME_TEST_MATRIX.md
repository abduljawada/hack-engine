# Release game test list

Prepared 2026-09-27; automated qualification now targets Hack Engine v1.3.0. This is a qualification list, not a claim that all games pass. The primary runner installs Firefox and Chrome packages and visits the actual game websites. Pinned local builds remain a separate regression mode.

## Automated execution

Run `npm run test:games` for the four release games, or `npm run test:games -- --strict` for their complete release gate. Both default and strict selections are J1, W1, F2 and F4 in Firefox and Chromium: **eight required combinations**. GitHub pull requests and main pushes enforce strict qualification. The original eight-game catalog is preserved below and remains explicitly selectable with `--game`. Each invocation preserves its own HTML/JSON/JUnit report and screenshots under `artifacts/game-tests/`; the top-level index links the latest run. See [testing instructions](test/GAME_TESTING.md) and [asset provenance/setup](test/games/ASSETS.md).

Website runs need no local game files: each site supplies its game and player. The runner observes the runtime loaded in each run, rather than assuming every historically Flash title is still Flash. The four release games cover JavaScript, non-Ruffle WebAssembly, AVM1 and AVM2. The other four catalog games are optional exploratory coverage. Player loading, runtime detection, and manual pause smoke checks alone never qualify full gameplay. Missing interactions, counter observations, or target workflows remain BLOCKED with evidence.

Use `npm run test:games -- --mode local --game J1,W1` for pinned Asteroids/Breakout regression and controlled frame scenarios. Local Flash fixtures can be supplied separately; missing originals block only that optional mode. Website results and local fixture results must remain distinguishable.

## Release selection

| ID | Game | Runtime | Browsers |
| --- | --- | --- | --- |
| J1 | HTML5-Asteroids | JavaScript | Firefox and Chromium |
| W1 | Breakout.Rust.Web | Non-Ruffle WebAssembly | Firefox and Chromium |
| F2 | Xeno Tactic 2 | AVM1 / Ruffle | Firefox and Chromium |
| F4 | Bloons Tower Defense 3 | AVM2 / Ruffle | Firefox and Chromium |

Every selected game must pass its existing mandatory target, gameplay, lifecycle and provenance checks. Manual verification does not count as an automated pass. Blocked, failed, unsupported or unrun required cases prevent release qualification. No release or tag is created by these checks.

## Preserved original eight-game catalog

| ID | Game and source | Runtime | Proposed targets | Main purpose |
| --- | --- | --- | --- | --- |
| F1 | [Chibi Knight](https://www.newgrounds.com/portal/view/526470) — original Flash edition | AVM1 / Ruffle | Health and experience; confirm available displays during baseline | Unknown/decreased health scans, increased experience, watch and freeze/stop through scene changes |
| F2 | [Xeno Tactic 2](https://www.newgrounds.com/portal/view/438241) | AVM1 / Ruffle | Money and remaining lives | Exact scans; spend/earn refinements; distinguish actionable values from display copies |
| F3 | [Cube Colossus](https://www.newgrounds.com/portal/view/507205) | AVM1 / Ruffle | Weapon heat, upgrade currency; confirm accessible counters during baseline | Unknown/range scans on changing meters, continuous changes, pause/resume, guarded Undo write |
| F4 | [Bloons Tower Defense 3](https://www.newgrounds.com/portal/view/463445) — original Flash edition | AVM2 / Ruffle | Cash and lives | Exact/increased/decreased refinement; write followed by purchase; freeze and stop |
| F5 | [Diggy](https://www.kongregate.com/en/games/vogd/diggy) — original Flash edition | AVM2 / Ruffle | Energy and money | Unknown/decreased energy, increased currency, upgrades and next-day state changes |
| F6 | [Canabalt](https://www.newgrounds.com/portal/view/510303) — inspect the current website edition | Current website: HTML5; original: AVM2 / Ruffle | Distance counter | Rounded values/range scans, rapid updates, repeated deaths and new runs |
| J1 | [HTML5-Asteroids](http://www.dougmcinnes.com/html-5-asteroids/) | JavaScript | `Game.score` | Reachable object discovery, exact/refine/write/freeze/stop, reload invalidation |
| W1 | [Breakout.Rust.Web](https://lostsidedead.biz/breakout/) | Non-Ruffle WebAssembly | Lives, beginning at 5 in the previously tested build | Numeric format selection, memory growth, visible gameplay effect after write, freeze/stop |

The six Flash classifications come from [Ruffle's March 2023 progress report](https://ruffle.rs/blog/2023/03/12/progress-report.html), which explicitly separates ActionScript 2 and ActionScript 3 games. That historical report does not establish compatibility with today's exact builds. Verify the runtime actually loaded. A historical AVM classification cannot qualify a modern HTML5 website as Flash coverage.

Website mode tests the editions currently served at these URLs. In particular, Canabalt also has a [modern HaxeFlixel port](https://github.com/ninjamuffin99/canabalt-hf). Record this runtime change explicitly. Original Flash editions remain useful optional local fixtures, but are not prerequisites for website testing. A portal page that only offers a desktop player is a browser baseline blocker, not an extension test.

Targets above are test proposals, not confirmed memory locations. J1 and W1 have prior page-agent results in [COMPATIBILITY.md](COMPATIBILITY.md); installed-package testing on those exact games remains necessary.

## Execution order and acceptance

1. Visit each configured game website in a disposable browser. Record requested/final URLs, frame arrangement, rendered loading state, resource metadata and runtime. Keep pinned MIT builds from COMPATIBILITY.md for the separate local regression layer.
2. Establish baseline gameplay with Hack Engine absent. Record loading failures separately from extension failures. Confirm public Ruffle metadata when present; a website serving HTML5 is tested as HTML5. Local mode additionally verifies SWF and Ruffle hashes. Do not deliberately submit modified scores.
3. Enable the exact release package and repeat baseline gameplay. Discover a target through the UI, change it naturally, refine, and watch it. Verify an edit affects gameplay rather than only a cached display.
4. Exercise Undo scan, guarded Undo write, freeze, and Stop all freezes where applicable. If a counter is only a display copy or not discoverable, record that limitation; do not report successful editing.
5. Close/reopen the controls, change tabs, and reload the game. Confirm writes stay bound to the selected game and stale targets become unusable. Confirm hidden-game freezes stop.
6. Repeat in Firefox and Chrome. All new game/browser combinations start as NOT RUN. Record PASS, FAIL, BLOCKED (baseline/environment), or UNSUPPORTED TARGET with evidence.

## Additional configurations using the same games

These are separate scenarios, not additional game-count credit:

- Two copies of one game on the same origin: scans and snapshot cleanup remain isolated.
- One AVM1 and one AVM2 game in separate frames: runtime detection and writes remain source-specific.
- Authorized nested and cross-origin embeds: target discovery, frame permissions and tab binding.
- Background-worker termination during an established session: correct state recovery.
- Repeated scan/reset cycles and storage/quota pressure: use the existing deterministic fixtures for measurements, alongside this game list.

## Result record

For each game/browser run, record:

- Game ID, test mode, requested/final website and frame URLs, observed resources/runtime, and public AVM metadata when available. For local fixtures, pinned revision and asset/Ruffle hashes.
- OS, browser version, extension version and package hash, top-level/frame arrangement.
- Baseline result; displayed target; scan mode/type; initial and refined candidate counts.
- Observed gameplay effect of edit; Undo scan/write; freeze/stop; reload and panel recovery results.
- Evidence path and failure category: baseline game/Ruffle issue, extension defect, inaccessible target, or environment blocker.

Strict live Ruffle qualification additionally needs each browser phase's primary SWF hash, independent AVM classification matching public runtime metadata, and Ruffle Wasm hashes. Missing response-body evidence cannot be borrowed from another browser or a local copy. Full hashing of ordinary live JavaScript assets remains a reporting limitation.

Completion of this list provides game coverage only. Native-panel acceptance, platform/minimum-browser coverage, performance measurements and signed-store install/update remain separate release gates.

## Historical observed qualification, 2026-09-27

The full headed website run is preserved at `artifacts/game-tests/2026-09-27T10-49-01.322Z-380679/`: **4 PASS, 10 BLOCKED, 2 FAIL**. Later diagnostic runs retain separate reports; they do not rewrite these original outcomes.

| Game | Current evidence and remaining work |
| --- | --- |
| HTML5-Asteroids | Full website gameplay and extension workflows passed in both browsers. Pinned local Chromium gameplay and frame/isolation checks also passed. |
| Breakout.Rust.Web | Full website gameplay and extension workflows passed in both browsers. |
| Chibi Knight | Actual start, movement and attack input exercised; reliable health/experience observation and target workflows remain unqualified. |
| Xeno Tactic 2 | The user subsequently verified the game manually in Firefox. Automated mission and turret purchase changed gold 200 → 170 and Float64 refinement found one candidate; the controls accepted a write to 1000, but gameplay spending that edited balance remains unproven automatically. Small-font OCR and lives/shield qualification remain gaps. Manual verification is not an automated pass. |
| Cube Colossus | Actual battle reached and shooting exercised. Heat and upgrade currency are not yet qualified; damage-chain text cannot replace either target. |
| Bloons Tower Defense 3 | Firefox demonstrated discovery, refinement, edit, guarded undo, undo, freeze and stop for both cash and lives. Its pause-under-input check failed: clicking the paused player dismissed its Play overlay and gameplay resumed. Chromium's installed cash workflow passed, but lives refinement remained ambiguous (two candidates); its fresh baseline also hit the startup deadline. Remaining pause/lifecycle assertions are unrun; neither full case qualifies. |
| Diggy | The observed portal did not expose a playable game after genuine Play inputs; baseline blocked in both browsers. |
| Canabalt | Current HTML5 edition played and increasing distance observed in both browsers (including Firefox 106 m → 128 m). A reliably editable distance target remains unqualified. |

Firefox now captures actual loaded response bytes through BiDi; strict qualification still requires matching per-phase hashes and independent AVM evidence. The historical 16-combination acceptance was not achieved. The release gate now requires eight combinations across J1, W1, F2 and F4; changing that selection does not qualify the outstanding Xeno/Bloons scenarios or waive provenance checks. **The new eight-combination gate has not yet passed.**


## Controlled core and live compatibility

The approved release gate now uses original pinned J1/W1/F2/F4 copies, each in Firefox and Chrome (eight configurations), with identical target and pause assertions. Live-site compatibility is a separate advisory workflow and reports blocked public sites as blocked, never as passes. See [test/GAME_TESTING.md](test/GAME_TESTING.md) for the precise evidence boundary and current repair status. No AVM1 replacement has been qualified yet.
