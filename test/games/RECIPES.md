# Local Flash gameplay recipes

This document describes the optional generic `scenario.json` driver for `--mode local`. Maintained game-specific scenarios for Xeno, Bloons, and Interactive Buddy are shared by controlled local and live-site runs and do not require a JSON recipe.

A Flash recipe is executable test input, not a compatibility claim. The suite needs the original authorized SWF, matching Ruffle files, and a version-specific `scenario.json` beside `game.swf`. Add `scenario.json` and its SHA-256 to that game's `metadata.json` hash map. Asset verification rejects missing, modified, and unpinned files before browser execution.

No generic `scenario.json` recipe is currently qualified. Missing recipes remain `BLOCKED`; Flash load/runtime checks alone cannot complete gameplay coverage. The maintained Bloons scenario has independently passed its full controlled workflow in both browsers, including cached-HUD checks based on actual purchase and loss events. Interactive Buddy also completed its maintained scenario in both browsers; Xeno remains unqualified; see [current testing evidence](../GAME_TESTING.md).

## Structure

The root object contains `start` (optional input sequence) and `targets` (required array). Each required game target must have an entry with the exact name below:

| Game | Required target names |
| --- | --- |
| F1 Chibi Knight | `health`, `experience` |
| F2 Xeno Tactic 2 | `money`, `lives` |
| F3 Cube Colossus | `heat`, `currency` |
| F4 Bloons Tower Defense 3 | `cash`, `lives` |
| F5 Diggy | `energy`, `money` |
| F6 Canabalt | `distance` |
| F7 Interactive Buddy v1.01 | `money` |

Each target has these fields:

| Field | Meaning |
| --- | --- |
| `name` | Exact name from the table above. |
| `start` | Optional input sequence preparing this target. |
| `region` | Screenshot pixel rectangle: integer `left`, `top`, `width`, `height`; positive size and nonnegative origin. |
| `pattern` | JavaScript regular-expression string whose first capture group contains the numeric counter. Commas are removed before numeric conversion. |
| `minConfidence` | Minimum OCR confidence, default 85. Unreliable or nonnumeric readings block the test with the screenshot evidence. |
| `scan.type` | The numeric format selected in the packaged UI, e.g. `i32`, `u32`, or `f64`; establish this from actual discovery. |
| `scan.condition` | Initial `exact` (default), `range`, or `unknown`. |
| `scan.rangeTolerance` | Distance below/above the observed value for an initial range scan, default 1. |
| `editValue` | Finite numeric value to write/freeze through the packaged UI. Choose one valid for this target and discover its location on every run. |
| `change` | Required, nonempty input sequence causing a genuine game-owned counter change. The sequence is reused after refinement, a write, freeze, stop, and pause; it must remain meaningful at each point. |
| `timeout` | Natural-change timeout in milliseconds; default 45000, allowed 1000–120000. |
| `freezeWitness` | Independent numeric rendered event counter, with its own `name`, `region`, `pattern`, and optional `minConfidence`. It must change during the target's freeze attempt, proving a real gameplay event occurred. A cached or unchanged target counter is not a witness. |

Coordinates refer to the browser adapter's 1280×900 viewport at device scale 1. Current recipes do not change viewport size. Inspect screenshots in both browsers and record crop validation; browser chrome, scaling, and stage letterboxing can affect coordinates. `GAME_OCR_LANG_PATH` may point to locally provisioned English OCR language data.

## Input sequences

An input sequence is an array of at most 100 actions. The only accepted actions are:

- `{ "click": [x, y] }`: browser pointer click at finite viewport coordinates.
- `{ "key": "Enter" }`: browser key press. Named arrow keys, Space, Enter, Escape, Tab, Shift and Control are supported; ordinary character keys are also accepted.
- `{ "key": "ArrowRight", "hold": 2000 }`: hold a key for up to 30000 milliseconds, then release in cleanup.
- `{ "wait": 1000 }`: bounded wait, 0–30000 milliseconds.

Actions do not accept JavaScript, extension ports, game state readers, byte addresses, or direct memory writes. Extension actions use only the packaged controls. Screenshots and OCR observe rendered gameplay.

## Conditions for qualification

The current generic recipe assumes writes and restores appear in the rendered counter promptly. It discovers/refines candidates from natural changes, tries at most 20 preview candidates, verifies visible write and restore effects, checks guarded Undo after a natural update, demonstrates a witnessed freeze and a new change after Stop, and exercises Ruffle pause, active-scan suspension, cancellation and existing-pause preservation. Remaining common scenarios cover control reopening, tab binding, reload invalidation and Chromium worker recovery.

A recipe that cannot demonstrate one of those behaviors remains blocked or unsupported with evidence. Do not lower OCR confidence to hide misreads, invent a witness, hard-code a discovered address, count a menu load as gameplay, or register an unverified placeholder. Event-updated HUDs, meters without numeric displays, transitions that replace state, and actions that cease to be repeatable may require explicit additional scenario support before qualification.
