# Hack Engine user guide

Hack Engine finds, watches, and edits accessible numeric values in WebAssembly and JavaScript browser games. Use it only with software and content you are authorized to inspect.

## Getting started

1. Open or reload the game page after installing Hack Engine. Capture must happen before the game creates its WebAssembly instance.
2. Open Hack Engine from the browser toolbar.
3. Enter the displayed value and choose **First scan**. Choose the detected WebAssembly memory or JavaScript objects. Ruffle hints apply only to identified Ruffle modules.
4. Change the value in the game, choose the new exact value or a comparison such as **Changed**, then choose **Next scan**.
5. Select a candidate. Selection adds it to the shared watch list automatically.
6. Enter a replacement and choose **Write value**. Use **Freeze** only when the game repeatedly restores the address.

## Persistent and advanced views

The toolbar popup closes when focus returns to the page. Use the pin to open the persistent sidebar. The sidebar's **Advanced** view adds explicit number format, alignment, and inspection-source controls plus filtering, sorting, and watches.

Both views show candidates with recommended variable types first: Float64 for AVM1, or Int32, Uint32, then Float64 for AVM2. WebAssembly prioritizes Int32, Uint32, Float32, then Float64. Candidates within each priority are ordered by address; when Ruffle AVM is unknown, candidates are ordered by address. Advanced defaults to **Recommended types**, with ascending/descending Address and Value sorting and Type sorting available. Counts distinguish displayed preview rows from all scan matches. Simple always uses the recommended order.

AVM detection uses only players linked to the selected memory through Ruffle's metadata callback. Unknown types are checked once per second for up to 15 retries; detection stops early on success and updates the runtime hints automatically. A new movie's metadata event starts a fresh retry budget. Existing scan results are retained. Some Ruffle players share one memory: if that memory contains both AVM1 and AVM2, or ownership cannot be established, it stays **Unknown** and Automatic searches all numeric types.

The toolbar, sidebar, and pop-out share the inspected tab's scan, candidates, watches, primary selection, and freeze state. Advanced controls provide the complete supported workflow; there is no separate inspector or DevTools entry.

### Known addresses and watch labels


Select a candidate to add it to Watches and open its editor. Select an individual watch to edit or clear its label. Use descriptive names such as **Coins** or **Health** to identify useful values at a glance.

A live session supports up to 256 watches. Each watch can be edited or frozen individually; **Stop all freezes** stops every active freeze in the inspected tab.

## Numeric formats

If the Simple scan does not find the value, try **All numeric types** in Advanced. Common Ruffle representations include `Float64` for AVM1 numbers and `Int32`, `Uint32`, or `Float64` for AVM2 values. **Any byte** alignment is slower but can find unaligned values.

## Why a displayed value may not appear

A value can be rounded for display, duplicated, recalculated every frame, encoded, split across fields, held in private JavaScript variables, or stored in an unsupported object representation. Use a small range for rounded values and comparison scans when the initial representation is unknown.

## Writes, restored values, and freezes

A matching address may be a display copy rather than authoritative game state. Hack Engine samples writes across animation frames and up to 250 ms. Compact watch feedback distinguishes checking, verified through 250 ms, game restored, rejected, unavailable, and frozen states; expand details to inspect timing. Verification describes the observed interval, not a guarantee the game will retain the value. Failed reads mark a watch unavailable instead of presenting its old value as live. Diagnostic evidence is transient and is cleared on a background restart or game reload. If the game restores the old value, continue narrowing candidates or freeze the address temporarily. Freezing rewrites memory every animation frame and can destabilize the player.

**Set to min** and **Set to max** prepare the lowest or highest finite value supported by the selected numeric type; they do not write until **Write value** is confirmed.

## Recovery

If a write corrupts or crashes the player, reload the tab. If Hack Engine reports a disconnected frame after an extension update, reload the game page and reopen the controls. Reset a scan before changing its number format or alignment.

If a scan has no progress for 15 seconds, the controls show **No recent progress** and request session state once. A slow scan may still be running: Cancel remains available, and another scan stays blocked until completion, acknowledged cancellation, or document invalidation. Cancelling or failing a refinement retains the last completed candidates and baseline.

## Data handling

Scans and writes run locally. Hack Engine does not transmit browsing activity or memory values. See [PRIVACY.md](PRIVACY.md) for storage and retention details.

## Session recovery tools

**Undo scan** restores the candidates and comparison baseline from one completed refinement. Cancelling a refinement preserves the previous completed scan. Undo does not reverse gameplay. A new First scan replaces the previous session.

**Undo write** restores the previous value only while the same live target exists and still contains the value Hack Engine wrote. If the game has changed it, restoration is refused. This is not a game-state rollback.

**Stop all freezes** stops every freeze in the inspected tab. Freezes also stop when the game becomes hidden, the page leaves, or the extension connection is lost. Re-enable them explicitly after returning to the game. Background continuous freezing is not supported.


The game/tab label remains bound to the inspected tab. Open Hack Engine from another game's toolbar to inspect that game separately. Popup closure and background restarts recover live sessions, but reloading a game creates a new memory identity and invalidates old live addresses.

Scans are limited to captured memories of at most 256 MiB. Snapshot scans check available site storage before starting; if storage is unavailable, the error explains the limit and a failed refinement retains its previous results. Reset releases the current scan and its undo checkpoint. Private/incognito windows are excluded from this candidate.


## JavaScript discovery

Select **JavaScript objects** for reachable numeric own properties in plain objects, arrays, and numeric typed arrays. First scan discovers available values; subsequent scans filter those same live properties. Advanced offers an object picker; it accepts selections, never executable expressions. Number format, alignment, and scaling apply only to WebAssembly.

Discovery skips ordinary getters and browser/DOM internals. JavaScript Proxy inspection traps can still execute; this is not an isolated debugger. Closures, module-private state, class instances, Map/Set contents, BigInt, workers, and server state are not searched.

Limits are eight object levels, 20,000 objects, and 100,000 inspected properties/elements per scan. Partial results are labelled; narrowing the root helps. The page retains at most 200,000 property handles across scans and reclaims stale ones; reload if that ceiling is reached. WebAssembly scans retain their 256 MiB limit.

Read-only values can be watched but cannot be edited. Typed-array writes must fit their storage exactly. Deleting a property, replacing its object, or changing it to an accessor invalidates the old handle when observed. Reloading invalidates every old handle. The extension cannot detect a property being deleted and recreated between observations.

### Targeted number formats

In Advanced, **Number format** controls the first scan. WebAssembly Automatic starts with Int32, Uint32, Float32 and Float64; decimal searches use Float32 and Float64. These are heuristic starting formats, not detected source-language types. Choose **All numeric types** (or **Search all number formats** after an exact/range scan) to include 8-bit and 16-bit integers. Individual formats remain selectable. Unknown Ruffle runtimes still search all formats.

For JavaScript, Automatic and All numeric types search all reachable finite numbers. **Number properties** targets ordinary object and array properties. The typed-array choices target actual element storage, such as Float32Array or Int32Array; Uint8 also includes Uint8ClampedArray. A whole-valued ordinary JavaScript Number is still a Number property, not an Int32 element. Choose an object to narrow discovery further. Reset the scan to change formats.
