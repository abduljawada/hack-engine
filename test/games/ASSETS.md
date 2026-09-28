# Pinned real-game assets

**This document describes the controlled core release suite (`--mode local`, the default).** J1, W1, F7 and F4 run in both browsers. The separate `--mode website` compatibility suite needs no local game copies and never counts a cached replay as a live-site pass.

Local game files and Ruffle live in `.cache/game-assets/`, or the directory selected by
`--assets`. They never enter the extension packages or source archive. Tests
serve them only on loopback, with disposable browser profiles.

The local-mode downloader obtains the exact two MIT upstream revisions established
in `COMPATIBILITY.md`. It verifies their previously recorded primary hashes and
pins every extracted file. The restrictive archive extractor refuses traversal,
links, and device entries, and never executes downloaded code.

It also obtains the original publicly served Flash editions of Chibi Knight,
Xeno Tactic 2, Cube Colossus, Bloons Tower Defense 3, and Interactive Buddy v1.01 from their official
Newgrounds embed references. Their SHA-256 values and independent SWF
classifications were recorded on 2026-09-27–28 in `catalog.mjs`. These are local test
copies; no redistribution license is asserted. Their official pages remain the
source of provenance, and changed upstream bytes are rejected. `--no-download`
uses local assets only. Diggy and original Flash Canabalt require supplied local
copies: the inspected Kongregate page did not expose the SWF and Canabalt's current
Newgrounds embed is the HTML5 port, which website mode tests as HTML5 rather than claiming original Flash coverage.

Ruffle is pinned to the official npm release **0.6.0** with an exact SHA-512
archive integrity value. Its MIT/Apache-2.0 licenses accompany the local runtime; every extracted file is checked against catalog hashes derived from that verified archive.
When a Flash game is available and the runtime is absent, the downloader installs
this build locally. A failed download or integrity check is recorded as BLOCKED.

## User-supplied copies

Each game directory is named by its matrix ID: `F1`–`F7`, `J1`, or `W1`. Flash
folders contain `game.swf` and `metadata.json`. Selected F4/F7 and optional F2 use the maintained
public-input gameplay scenarios in the repository; other exploratory titles need
a separately hashed `scenario.json`. Obtain original
editions that you are authorized to test locally. Metadata describes provenance
and pins every file except `metadata.json` itself:

```json
{
  "source": "https://official-game-page.example/game",
  "permission": "Describe the authorization for this local test copy",
  "hashes": {
    "game.swf": "<actual SHA-256 of game.swf>",
    "scenario.json": "<actual SHA-256 of scenario.json>"
  }
}
```

`hashes` uses relative paths and lowercase hex SHA-256 values. Missing files,
unlisted extra files, mismatched hashes, symlinks, and absent provenance fail
validation. MIT folders additionally declare `revision` equal to the catalog
revision and retain the upstream layout. Do not copy previous memory addresses
into scenario recipes; every run discovers targets again.

A custom shared `ruffle/` directory requires `ruffle.js`, its JavaScript and Wasm
assets, and the same metadata shape plus `version`. Every loaded runtime file
must be included in `hashes`. FWS and CWS Flash containers are parsed independently
to verify the FileAttributes ActionScript 3 flag; malformed files, ZWS compression,
and a different AVM classification remain BLOCKED.

`scenario.json` supplies bounded keyboard/pointer actions and visible-counter
regions for the Flash scenario driver. See [RECIPES.md](RECIPES.md) for the
exact shape and [FLASH_QUALIFICATION.md](FLASH_QUALIFICATION.md) for observed
qualification evidence and remaining blockers. Downloading a SWF is not enough to qualify it: missing recipes,
unreadable counters, inaccessible targets, or failed baseline gameplay remain
explicit blockers. The suite never guesses memory locations or silently counts
those cases as passing.

## Provenance records and qualification

Reports retain game hashes, source metadata, Ruffle version/hashes, and independently
observed AVM type. Flash readiness means the assets passed validation, not that
all required gameplay checks passed. The release verification command requires all four controlled games in both browsers with the full mandatory scenarios, runtime classification, and loaded-byte provenance. Pull requests and main pushes enforce that same strict core gate. Missing assets, blocked required coverage, or manual-only verification cannot pass it. The separate live-site workflow retains website failures without claiming they are core failures or core successes. Original SWFs and runtime binaries remain cache files, excluded from source/release artifacts.

Interactive Buddy (F7) is the qualified AVM1 representative. Its original [author listing](https://www.newgrounds.com/portal/view/218014), canonical SWF URL, and SHA-256 are pinned in the catalog. Its native stage is 550×400; screenshot observation uses device scale 2 without resizing gameplay. It replaced the Xeno release slot only after complete controlled gameplay qualification in both browsers. Every subsequent release still requires a fresh full-matrix pass.
