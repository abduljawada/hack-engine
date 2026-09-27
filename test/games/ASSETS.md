# Optional local real-game assets

**This document applies only to `--mode local`.** The default website suite loads games from their actual websites and needs none of these files.

Local game files and Ruffle live in `.cache/game-assets/`, or the directory selected by
`--assets`. They never enter the extension packages or source archive. Tests
serve them only on loopback, with disposable browser profiles.

The local-mode downloader obtains the exact two MIT upstream revisions established
in `COMPATIBILITY.md`. It verifies their previously recorded primary hashes and
pins every extracted file. The restrictive archive extractor refuses traversal,
links, and device entries, and never executes downloaded code.

It also obtains the original publicly served Flash editions of Chibi Knight,
Xeno Tactic 2, Cube Colossus, and Bloons Tower Defense 3 from their official
Newgrounds embed references. Their SHA-256 values and independent SWF
classifications were recorded on 2026-09-27 in `catalog.mjs`. These are local test
copies; no redistribution license is asserted. Their official pages remain the
source of provenance, and changed upstream bytes are rejected. `--no-download`
uses local assets only. Diggy and original Flash Canabalt require supplied local
copies: the inspected Kongregate page did not expose the SWF and Canabalt's current
Newgrounds embed is the HTML5 port, which website mode tests as HTML5 rather than claiming original Flash coverage.

Ruffle is pinned to the official npm release **0.6.0** with an exact SHA-512
archive integrity value. Its MIT/Apache-2.0 licenses accompany the local runtime.
When a Flash game is available and the runtime is absent, the downloader installs
this build locally. A failed download or integrity check is recorded as BLOCKED.

## User-supplied copies

Each game directory is named by its matrix ID: `F1`–`F6`, `J1`, or `W1`. Flash
folders contain `game.swf`, `scenario.json`, and `metadata.json`. Obtain original
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
all required gameplay checks passed. The release verification command separately requires local J1/W1 regressions and all eight actual websites in both browsers with successful mandatory scenarios. The pull-request gate
requires the two open-source games and fails any observed test failure, while
explicit Flash blockers remain visible as incomplete coverage.
