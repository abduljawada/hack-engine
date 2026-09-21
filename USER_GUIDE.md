# Hack Engine user guide

Hack Engine finds, watches, and edits numeric values in WebAssembly memory used by embedded Ruffle players. Use it only with software and content you are authorized to inspect.

## Getting started

1. Open or reload the page containing the Ruffle player after installing Hack Engine. Capture must happen before Ruffle creates its WebAssembly instance.
2. Open Hack Engine from the browser toolbar.
3. Enter the displayed value and choose **First scan**. The Simple view selects likely numeric representations from public Ruffle metadata.
4. Change the value in the game, choose the new exact value or a comparison such as **Changed**, then choose **Next scan**.
5. Select a candidate. Selection adds it to the shared watch list automatically.
6. Enter a replacement and choose **Write value**. Use **Freeze** only when the game repeatedly restores the address.

## Persistent and advanced views

The toolbar popup closes when focus returns to the page. Use the pin to open the persistent sidebar. The sidebar's **Advanced** view adds explicit number format, alignment, multiplier, and captured-memory controls plus filtering, sorting, and watches.

Both views show candidates with recommended variable types first: Float64 for AVM1, or Int32, Uint32, then Float64 for AVM2. Candidates within each priority are ordered by address; when AVM is unknown, candidates are ordered by address. Advanced defaults to **Recommended types**, with manual Address, Value, and Type sorting available. Simple always uses the recommended order.

**Open full inspector** provides batch selection, labels and groups, scan history, diagnostics, and workspace import/export. The popup/sidebar and full inspector share the active tab's scan, candidates, watches, primary selection, and freeze state.

## Numeric formats

If the Simple scan does not find the value, try **All numeric types** in Advanced or the full inspector. Common Ruffle representations include `Float64` for AVM1 numbers and `Int32`, `Uint32`, or `Float64` for AVM2 values. **Any byte** alignment is slower but can find unaligned values. A stored-value multiplier handles games that save a displayed value in scaled form.

## Why a displayed value may not appear

A value can be rounded for display, duplicated, recalculated every frame, encoded, split across fields, held in JavaScript rather than WebAssembly memory, or stored in an unsupported object representation. Use a small range for rounded values and comparison scans when the initial representation is unknown.

## Writes, restored values, and freezes

A matching address may be a display copy rather than authoritative game state. Hack Engine samples writes across animation frames and up to 250 ms. If the game restores the old value, continue narrowing candidates or freeze the address temporarily. Freezing rewrites memory every animation frame and can destabilize the player.

**Set to min** and **Set to max** prepare the lowest or highest finite value supported by the selected numeric type; they do not write until **Write value** is confirmed.

## Recovery

If a write corrupts or crashes the player, reload the tab. If Hack Engine reports a disconnected frame after an extension update, reload the game page and reopen the inspector. Reset a scan before changing its number format, alignment, or multiplier.

## Data handling

Scans and writes run locally. Hack Engine does not transmit browsing activity or memory values. See [PRIVACY.md](PRIVACY.md) for storage and retention details.

## Recovery and saved workspaces in the 1.0 candidate

**Undo scan** restores the candidates and comparison baseline from one completed refinement. Cancelling a refinement preserves the previous completed scan. Undo does not reverse gameplay. A new First scan replaces the previous session.

**Restore last write** restores the previous bytes only while the same game document and memory are alive and the address still contains the value Hack Engine wrote. If the game has changed it, restoration is refused. This is not a game-state rollback.

**Stop all freezes** stops every freeze in the inspected tab. Freezes also stop when the game becomes hidden, the page leaves, or the extension connection is lost. Re-enable them explicitly after returning to the game. Background continuous freezing is not supported.

**Saved workspaces** stores up to 30 named watch lists and scan settings locally. Import/export accepts up to 256 watches in a file smaller than 1 MiB. Loading opens an unverified preview. Select the correct live memory, verify that the addresses still describe the intended values, and choose **Use verified addresses**. No write or freeze is replayed. Saved scan settings apply immediately to a fresh scan or after resetting the current one. Deleting a saved copy leaves live watches intact.

The game/tab label remains bound to the inspected tab. Open Hack Engine from another game's toolbar to inspect that game separately. Popup closure and background restarts recover live sessions, but reloading a game creates a new memory identity and invalidates old live addresses.

Scans are limited to captured memories of at most 256 MiB. Snapshot scans check available site storage before starting; if storage is unavailable, the error explains the limit and a failed refinement retains its previous results. Reset releases the current scan and its undo checkpoint. Private/incognito windows are excluded from this candidate.

Choose **Open practice game** to learn the complete workflow using bundled local WebAssembly memory, without an external website or account.
