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

The toolbar popup closes when focus returns to the page. Use the pin to open the persistent sidebar. The sidebar's **Advanced** view adds explicit number format, alignment, multiplier, and captured-memory controls plus filtering, sorting, and watches.

Both views show candidates with recommended variable types first: Float64 for AVM1, or Int32, Uint32, then Float64 for AVM2. Candidates within each priority are ordered by address; when AVM is unknown, candidates are ordered by address. Advanced defaults to **Recommended types**, with ascending/descending Address and Value sorting and Type sorting available. Counts distinguish displayed preview rows from all scan matches. Simple always uses the recommended order.

The toolbar, sidebar, and pop-out share the inspected tab's scan, candidates, watches, primary selection, and freeze state. Advanced controls and saved workspaces provide the complete supported workflow; there is no separate inspector or DevTools entry.

### Known addresses and batch management

Expand **Add address** in Advanced Watches to enter a decimal or hexadecimal address, explicit numeric type, captured memory, and positive multiplier. Hack Engine validates the address and reads it before adding a watch. Adding never writes or freezes; an existing watch is selected without losing its labels or group.

Enter selection mode to choose displayed candidates, then use **Watch selected**. Selection alone does not add watches. In Watches, select rows to apply a shared label or group; a blank field leaves existing metadata unchanged. Use individual editing to clear metadata. **Select visible** covers only displayed preview rows, not all scan matches. Hidden selections are removed by filtering; result-set, memory, or inspected-tab changes clear selections. Each open interface keeps its own batch selection.

A workspace supports up to 256 watches. Batch feedback reports accepted and skipped entries. Bulk writes/freezes and scan history are deferred; individual writes/freezes and **Stop all freezes** remain available.

## Numeric formats

If the Simple scan does not find the value, try **All numeric types** in Advanced. Common Ruffle representations include `Float64` for AVM1 numbers and `Int32`, `Uint32`, or `Float64` for AVM2 values. **Any byte** alignment is slower but can find unaligned values. A stored-value multiplier handles games that save a displayed value in scaled form.

## Why a displayed value may not appear

A value can be rounded for display, duplicated, recalculated every frame, encoded, split across fields, held in private JavaScript variables, or stored in an unsupported object representation. Use a small range for rounded values and comparison scans when the initial representation is unknown.

## Writes, restored values, and freezes

A matching address may be a display copy rather than authoritative game state. Hack Engine samples writes across animation frames and up to 250 ms. Compact watch feedback distinguishes checking, verified through 250 ms, game restored, rejected, unavailable, and frozen states; expand details to inspect timing. Verification describes the observed interval, not a guarantee the game will retain the value. Failed reads mark a watch unavailable instead of presenting its old value as live. Diagnostic evidence is transient and is cleared on a background restart or game reload. If the game restores the old value, continue narrowing candidates or freeze the address temporarily. Freezing rewrites memory every animation frame and can destabilize the player.

**Set to min** and **Set to max** prepare the lowest or highest finite value supported by the selected numeric type; they do not write until **Write value** is confirmed.

## Recovery

If a write corrupts or crashes the player, reload the tab. If Hack Engine reports a disconnected frame after an extension update, reload the game page and reopen the controls. Reset a scan before changing its number format, alignment, or multiplier.

If a scan has no progress for 15 seconds, the controls show **No recent progress** and request session state once. A slow scan may still be running: Cancel remains available, and another scan stays blocked until completion, acknowledged cancellation, or document invalidation. Cancelling or failing a refinement retains the last completed candidates and baseline.

## Data handling

Scans and writes run locally. Hack Engine does not transmit browsing activity or memory values. See [PRIVACY.md](PRIVACY.md) for storage and retention details.

## Recovery and saved workspaces in the 1.0 candidate

**Undo scan** restores the candidates and comparison baseline from one completed refinement. Cancelling a refinement preserves the previous completed scan. Undo does not reverse gameplay. A new First scan replaces the previous session.

**Restore last write** restores the previous value only while the same live target exists and still contains the value Hack Engine wrote. If the game has changed it, restoration is refused. This is not a game-state rollback.

**Stop all freezes** stops every freeze in the inspected tab. Freezes also stop when the game becomes hidden, the page leaves, or the extension connection is lost. Re-enable them explicitly after returning to the game. Background continuous freezing is not supported.

**Saved workspaces** stores up to 30 named watch lists and scan settings locally. Import/export accepts up to 256 watches in a file smaller than 1 MiB. Loading opens an unverified preview. Select the correct live sources, verify that addresses/property paths still describe the intended values, and choose **Use verified values**. JavaScript paths must resolve successfully before watches are applied. No write or freeze is replayed. Exports use `hack-engine-workspace` version 3. Imports accept version 3 and migrate version 2 WebAssembly workspaces. JavaScript object identities are never exported; paths are rediscovery hints. Earlier inspector exports are unsupported; recreate those watches in Advanced and export a current workspace. Saved scan settings apply immediately to a fresh scan or after resetting the current one. Deleting a saved copy leaves live watches intact.

The game/tab label remains bound to the inspected tab. Open Hack Engine from another game's toolbar to inspect that game separately. Popup closure and background restarts recover live sessions, but reloading a game creates a new memory identity and invalidates old live addresses.

Scans are limited to captured memories of at most 256 MiB. Snapshot scans check available site storage before starting; if storage is unavailable, the error explains the limit and a failed refinement retains its previous results. Reset releases the current scan and its undo checkpoint. Private/incognito windows are excluded from this candidate.

Choose **Open practice game** to learn the complete workflow using bundled local WebAssembly memory and a JavaScript score, without an external website or account.

## JavaScript discovery

Select **JavaScript objects** for reachable numeric own properties in plain objects, arrays, and numeric typed arrays. First scan discovers available values; subsequent scans filter those same live properties. Advanced offers an object picker; it accepts selections, never executable expressions. Number format, alignment, scaling, and manual byte addresses apply only to WebAssembly.

Discovery skips ordinary getters and browser/DOM internals. JavaScript Proxy inspection traps can still execute; this is not an isolated debugger. Closures, module-private state, class instances, Map/Set contents, BigInt, workers, and server state are not searched.

Limits are eight object levels, 20,000 objects, and 100,000 inspected properties/elements per scan. Partial results are labelled; narrowing the root helps. The page retains at most 200,000 property handles across scans and reclaims stale ones; reload if that ceiling is reached. WebAssembly scans retain their 256 MiB limit.

Read-only values can be watched but cannot be edited. Typed-array writes must fit their storage exactly. Deleting a property, replacing its object, or changing it to an accessor invalidates the old handle when observed. Reloading invalidates every old handle. The extension cannot detect a property being deleted and recreated between observations.
