import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GameUI } from './ui.mjs';
import { withScanPauseObservation, scanCancellationAcknowledged } from './pause-observation.mjs';
import { GameTestError, delay, poll, readRenderedValue, renderedSamples, sampleValue, asteroidsEditWindow, createOcrObserver } from './observations.mjs';
export { OBSERVER_SCRIPT, GameTestError } from './observations.mjs';

export async function performActions(session, page, actions = []) {
  if (!Array.isArray(actions) || actions.length > 100) throw new GameTestError('Scenario actions must be an array of at most 100 inputs.');
  for (const action of actions) {
    session.checkActive?.();
    if (action.wait !== undefined) {
      if (!Number.isFinite(action.wait) || action.wait < 0 || action.wait > 30000) throw new GameTestError('Scenario wait must be 0–30000 milliseconds.');
      await delay(action.wait);
    } else if (typeof action.key === 'string') {
      if (action.hold !== undefined && (!Number.isFinite(action.hold) || action.hold < 0 || action.hold > 30000)) throw new GameTestError('Scenario key hold must be 0–30000 milliseconds.');
      if (action.hold) {
        await session.key(page, action.key, { type: 'down' });
        try { await delay(action.hold); } finally { await session.key(page, action.key, { type: 'up' }); }
      } else await session.key(page, action.key);
    } else if (Array.isArray(action.click) && action.click.length === 2 && action.click.every(Number.isFinite)) {
      await session.click(page, ...action.click);
    } else throw new GameTestError(`Unsupported scenario input ${JSON.stringify(action)}. Only keyboard, pointer and bounded waits are accepted.`);
  }
}

async function withGameplay(session, page, gameId, operation, target) {
  await session.activate(page);
  if (gameId.startsWith('F')) {
    await performActions(session, page, target.change);
    return operation();
  }
  const keys = gameId === 'J1' ? ['Space', 'ArrowUp', 'ArrowRight'] : ['ArrowLeft'];
  const pressed = [];
  let stopInputs = false;
  let inputLoop;
  let failed = false;
  try {
    for (const key of keys) { await session.key(page, key, { type: 'down' }); pressed.push(key); }
    if (gameId === 'J1') {
      // The original game's waiting screen consumes Space and clears its held
      // state when starting a run. Re-press using genuine browser input so a
      // death/restart cannot leave the test holding an already-consumed key.
      inputLoop = (async () => {
        while (!stopInputs) {
          await delay(500);
          if (stopInputs) break;
          session.checkActive?.();
          await session.key(page, 'Space', { type: 'up' });
          if (stopInputs) break;
          await session.key(page, 'Space', { type: 'down' });
        }
      })();
    }
    return await (inputLoop ? Promise.race([operation(), inputLoop]) : operation());
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    stopInputs = true;
    // Join the serialized input loop before key-up cleanup: no late keyDown may
    // survive this gameplay operation or a cancelled browser session.
    await inputLoop?.catch(() => {});
    let releaseError;
    for (const key of pressed.reverse()) {
      try { await session.key(page, key, { type: 'up' }); }
      catch (error) { releaseError ??= error; }
    }
    if (releaseError && !failed) throw releaseError;
  }
}


async function withPausedAsteroidsScore(session, gamePage, operation, screenshot) {
  const since = Date.now();
  await session.key(gamePage, 'p');
  try {
    const samples = await poll(() => renderedSamples(session, gamePage, since),
      rows => rows.some(row => row.kind === 'vectorText' && row.text === 'PAUSED'),
      { description: 'Asteroids native pause rendered' });
    const value = samples.slice().reverse().map(row => sampleValue(row, 'J1')).find(Number.isFinite);
    if (!Number.isFinite(value)) throw new GameTestError('Paused score was not rendered.');
    if (screenshot) await session.screenshot(gamePage, screenshot);
    return await operation(value);
  } finally {
    await session.key(gamePage, 'p');
  }
}

async function recipeFor(game, asset) {
  if (game.id === 'J1') return { start: [{ key: 'Space' }, { wait: 300 }], targets: [{ name: 'score', scan: { type: 'number', condition: 'exact' }, editValue: 12345, timeout: 45000 }] };
  if (game.id === 'W1') return { targets: [{ name: 'lives', scan: { type: 'u32', condition: 'exact' }, editValue: 99, timeout: 30000 }] };
  if (!asset?.recipePath) throw Object.assign(new GameTestError(`${game.id}: authorized SWF exists but its version-specific scenario.json (start inputs, HUD regions and genuine change inputs) is missing.`), { code: 'MISSING_RECIPE' });
  const recipe = JSON.parse(await readFile(asset.recipePath, 'utf8'));
  const expected = { F1: ['health', 'experience'], F2: ['money', 'lives'], F3: ['heat', 'currency'], F4: ['cash', 'lives'], F5: ['energy', 'money'], F6: ['distance'] }[game.id];
  for (const name of expected) {
    if (!recipe.targets?.some(t => t.name === name)) throw new GameTestError(`${game.id} scenario requires target ${name}.`);
  }
  for (const target of recipe.targets) {
    if (!Number.isFinite(target.editValue) || !target.scan?.type || !Array.isArray(target.change) || !target.change.length) throw new GameTestError(`Invalid ${target.name} recipe: numeric editValue, scan.type and genuine change inputs are required.`);
    if (target.scan.condition && !['exact', 'unknown', 'range'].includes(target.scan.condition)) throw new GameTestError('Initial scan must be exact, unknown or range.');
    if (target.timeout !== undefined && (!Number.isFinite(target.timeout) || target.timeout < 1000 || target.timeout > 120000)) throw new GameTestError('Target timeout must be 1000–120000 milliseconds.');
  }
  return recipe;
}

export async function runGame({ session, game, asset, gamePage, controls, baseline = false, artifactDir, step = async (_name, fn) => fn() }) {
  await mkdir(artifactDir, { recursive: true });
  const recipe = await recipeFor(game, asset);
  const evidence = { game: game.id, baseline, targets: [], observations: 'rendered text or screenshot OCR only' };
  await session.activate(gamePage);
  await poll(() => session.evaluate(gamePage, 'document.readyState'), x => x === 'complete', { description: 'Game document load', category: 'baseline' });
  if (game.id === 'J1' || game.id === 'W1') {
    await poll(() => readRenderedValue(session, gamePage, game.id), Number.isFinite, { description: 'Game-rendered HUD', category: 'baseline' });
  }
  await performActions(session, gamePage, recipe.start);
  let ui = controls ? new GameUI(session, controls) : null;
  const gameUrl = await session.evaluate(gamePage, 'location.href');
  for (const [targetIndex, target] of recipe.targets.entries()) {
    const runStep = (name, fn) => step(targetIndex === 0 ? name : `${target.name}:${name}`, fn);
    let ocr;
    try {
      if (game.id.startsWith('F')) ocr = await createOcrObserver({ session, page: gamePage, target, artifactDir: join(artifactDir, target.name) });
      const read = ocr ? () => ocr.read() : () => readRenderedValue(session, gamePage, game.id);
      const timeout = target.timeout ?? 45000;
      const naturalChange = (initial) => withGameplay(session, gamePage, game.id, () => poll(read, value => Number.isFinite(value) && value !== initial, { timeout, interval: ocr ? 500 : 100, description: `${target.name} natural gameplay change`, category: baseline ? 'baseline' : 'automation' }), target);
      await performActions(session, gamePage, target.start);
      const initial = await poll(read, Number.isFinite, { description: `${target.name} readable HUD`, category: 'baseline' });
      const targetEvidence = { target: target.name, initial };
      evidence.targets.push(targetEvidence);
      if (baseline) {
        await runStep('baseline', async () => {
          targetEvidence.changed = await naturalChange(initial);
          await session.screenshot(gamePage, join(artifactDir, `${target.name}-baseline.png`));
          return targetEvidence;
        });
        continue;
      }
      if (!ui) ui = new GameUI(session, await session.openControls(gamePage));
      if (targetIndex) await ui.reset();
      await runStep('discovery', async () => {
        targetEvidence.source = await ui.ready({ javascript: game.id === 'J1', type: target.scan.type, root: game.id === 'J1' ? 'Game' : null });
        const scanInitial = async value => {
          targetEvidence.scannedValue = value;
          const tolerance = target.scan.rangeTolerance ?? 1;
          targetEvidence.initialCandidates = await ui.scan(target.scan.condition ?? 'exact', target.scan.condition === 'range' ? value - tolerance : value, target.scan.condition === 'range' ? value + tolerance : undefined);
        };
        if (game.id === 'J1') await withPausedAsteroidsScore(session, gamePage, scanInitial);
        else await scanInitial(await read());
        if (!(targetEvidence.initialCandidates > 0)) throw new GameTestError('No matching game values discovered through controls.', 'target-accessibility', 'UNSUPPORTED TARGET');
        return targetEvidence;
      });
      await runStep('refine', async () => {
        targetEvidence.changed = await naturalChange(targetEvidence.scannedValue);
        const refine = async value => {
          targetEvidence.changed = value;
          targetEvidence.refinedCandidates = await ui.scan('exact', value);
        };
        // A website's frame timing and the controls tab can differ. Read the
        // score after the game's own pause has rendered, then scan that value.
        if (game.id === 'J1') await withPausedAsteroidsScore(session, gamePage, refine);
        else await refine(targetEvidence.changed);
        if (!(targetEvidence.refinedCandidates > 0)) throw new GameTestError('No candidates survived a natural value change.', 'target-accessibility', 'UNSUPPORTED TARGET');
        return { before: targetEvidence.scannedValue, after: targetEvidence.changed, candidates: targetEvidence.refinedCandidates };
      });
      await runStep('undo-scan', async () => {
        const previous = await ui.count();
        const sentinel = { i8: 127, u8: 255, i16: 32767, u16: 65535 }[target.scan.type] ?? 987654321;
        const wrong = await ui.scan('exact', sentinel);
        if (wrong !== 0) throw new GameTestError('Wrong-value refinement did not eliminate candidates; Undo scan was not exercised.', 'automation');
        await ui.undoScan(previous);
        return { restoredCandidates: previous };
      });
      let selected = -1;
      await runStep('watch', async () => {
        const candidates = await ui.candidates();
        if (!candidates.length) throw new GameTestError('No preview candidates available to select.', 'target-accessibility', 'UNSUPPORTED TARGET');
        selected = game.id === 'J1' ? candidates.findIndex(c => c.location === 'Game.score') : 0;
        if (selected < 0) throw new GameTestError('Game.score absent from discovered UI candidates.', 'target-accessibility', 'UNSUPPORTED TARGET');
        await ui.select(selected);
        return { candidate: candidates[selected].text };
      });
      await runStep('write', async () => {
        const candidates = await ui.candidates();
        const limit = game.id === 'J1' ? selected + 1 : Math.min(candidates.length, 20);
        for (let index = selected; index < limit; index++) {
          if (index !== selected) await ui.select(index);
          if (game.id === 'J1') {
            const since = Date.now();
            targetEvidence.editWindow = await poll(async () => asteroidsEditWindow(await renderedSamples(session, gamePage, since)), Boolean,
              { timeout: 10000, description: 'Two rendered Asteroids frames without outstanding player shots' });
          }
          const before = await read();
          await ui.write(target.editValue);
          let edited = false;
          try {
            await poll(read, value => value === target.editValue, { timeout: 1600, description: 'Written value in game HUD' });
            edited = true;
          } catch (error) { if (!(error instanceof GameTestError)) throw error; }
          if (edited) {
            selected = index; targetEvidence.beforeWrite = before;
            targetEvidence.editValue = target.editValue;
            await session.screenshot(gamePage, join(artifactDir, `${target.name}-written.png`));
            return { before, written: target.editValue, candidate: candidates[index].text };
          }
          await ui.restore();
        }
        throw new GameTestError('None of the first 20 discovered UI candidates changed the rendered game target; no location is assumed.', 'target-accessibility', 'UNSUPPORTED TARGET');
      });
      await runStep('undo', async () => {
        await ui.restore();
        await poll(read, value => value === targetEvidence.beforeWrite, { timeout: 2500, description: 'Undo restored visible game counter', category: 'extension', status: 'FAIL' });
        return { restored: targetEvidence.beforeWrite };
      });
      await runStep('guarded-undo', async () => {
        if (game.id === 'J1') {
          const since = Date.now();
          await poll(async () => asteroidsEditWindow(await renderedSamples(session, gamePage, since)), Boolean,
            { timeout: 10000, description: 'Shot-free rendered frames before second Asteroids write' });
        }
        const writeStarted = Date.now();
        await ui.write(target.editValue);
        try {
          await poll(read, x => x === target.editValue, { timeout: 3000, description: 'Second write visible', category: 'extension', status: 'FAIL' });
        } finally {
          if (game.id === 'J1') await writeFile(join(artifactDir, 'second-write-rendered.json'), JSON.stringify({
            expected: target.editValue, writeStarted, samples: await renderedSamples(session, gamePage, writeStarted), controls: await ui.state(),
          }, null, 2));
        }
        const changed = await naturalChange(target.editValue);
        await ui.restore({ guarded: true });
        const after = await read();
        if (after === target.editValue) throw new GameTestError('Guarded undo overwrote the game-owned value.', 'extension', 'FAIL');
        return { before: targetEvidence.beforeWrite, written: target.editValue, naturallyChanged: changed, preserved: after };
      });
      await runStep('freeze', async () => {
        await ui.freeze(target.editValue);
        await poll(read, x => x === target.editValue, { timeout: 4000, description: 'Freeze value rendered', category: 'extension', status: 'FAIL' });
        const since = Date.now();
        if (ocr) {
          // Flash recipes must describe a separately observable consequence of a
          // genuine event (e.g. lives consumed or purchase made) while frozen.
          if (!target.freezeWitness) throw new GameTestError(`${target.name} needs freezeWitness OCR region/pattern: a stable counter alone cannot prove freeze resisted a game update.`);
          const witness = await createOcrObserver({ session, page: gamePage, target: target.freezeWitness, artifactDir: join(artifactDir, `${target.name}-witness`) });
          try {
            const before = await witness.read();
            await withGameplay(session, gamePage, game.id, () => poll(() => witness.read(), x => x !== before, { timeout, description: 'Independent gameplay event during freeze' }), target);
          } finally { await witness.close(); }
        } else if (game.id === 'W1') {
          await withGameplay(session, gamePage, game.id, () => poll(async () => {
            const samples = await renderedSamples(session, gamePage, since);
            const paddle = samples.find(s => s.kind === 'paddle');
            const balls = samples.filter(s => s.kind === 'ball');
            return balls.some((ball, index) => index > 0 && ball.x === 480 && ball.y === 460 &&
              paddle && balls[index - 1].y >= paddle.y - 5);
          }, Boolean, { timeout, description: 'Missed ball visibly respawned during lives freeze' }), target);
        } else {
          await withGameplay(session, gamePage, game.id, () => poll(
            () => renderedSamples(session, gamePage, since),
            samples => samples.some(s => { const value = sampleValue(s, game.id); return value !== null && (game.id === 'J1' ? value > target.editValue : value < target.editValue); }),
            { timeout, description: 'Rendered natural update attempted while frozen' },
          ), target);
        }
        await poll(read, value => value === target.editValue, { timeout: 4000, description: 'Freeze restored target after natural update', category: 'extension', status: 'FAIL' });
        await session.screenshot(gamePage, join(artifactDir, `${target.name}-frozen.png`));
        return { value: target.editValue, resistedNaturalUpdate: true };
      });
      await runStep('stop', async () => {
        await ui.stop();
        return { afterStop: await naturalChange(target.editValue) };
      });
      if (game.id === 'J1') {
        await runStep('range-scan', async () => {
          await ui.reset();
          await ui.ready({ javascript: true, type: 'number', root: 'Game' });
          // Existing bullets can still score after input release. Use the game's
          // native P key and rendered PAUSED label to snapshot a stable counter.
          return withPausedAsteroidsScore(session, gamePage, async value => {
            const count = await ui.scan('range', value - 1, value + 1);
            if (!count || !(await ui.candidates()).some(c => c.location === 'Game.score')) throw new GameTestError('Range scan missed the rendered score.', 'extension', 'FAIL');
            return { count, renderedScore: value, nativePauseConfirmed: true };
          }, join(artifactDir, 'score-native-paused.png'));
        });
        await runStep('unknown-scan', async () => { await ui.reset(); await ui.ready({ javascript: true, type: 'number', root: 'Game' }); await ui.scan('unknown'); const before = await read(); await naturalChange(before); const count = await ui.scan('changed'); if (!count || !(await ui.candidates()).some(c => c.location === 'Game.score')) throw new GameTestError('Unknown/changed workflow lost the score.', 'extension', 'FAIL'); return { count }; });
      }
      if (game.id.startsWith('F')) await runPauseCases({ ui, read, naturalChange, target, runStep, session, gamePage });
    } finally { await ocr?.close(); }
  }
  if (!baseline) {
    await step('reopen', async () => {
      const before = await ui.state();
      await session.closePage(ui.page);
      ui = new GameUI(session, await session.openControls(gamePage));
      await ui.wait(`document.querySelector('#quick-scan') && !document.querySelector('#quick-scan').disabled`, 'Reopened controls connection');
      await ui.wait(`Number(document.querySelector('#advanced-watch-count').textContent)===${before.watches} && document.querySelector('#advanced-result-count').textContent===${JSON.stringify(before.count)}`, 'Reopened shared state restored');
      const after = await ui.state();
      if (before.watches !== after.watches || before.count !== after.count) throw new GameTestError('Reopening controls lost shared scan/watch state.', 'extension', 'FAIL');
      return { watches: after.watches, candidates: after.count };
    });
    await step('tab-binding', async () => {
      const before = await ui.evaluate('new URLSearchParams(location.search).get("tabId")');
      const other = await session.newPage('about:blank');
      try {
        await session.activate(other);
        const after = await ui.evaluate('new URLSearchParams(location.search).get("tabId")');
        if (!before || before !== after) throw new GameTestError('Persistent controls changed game binding on tab switch.', 'extension', 'FAIL');
        await session.activate(gamePage);
        // Verify an existing watch is still live after switching, not merely the URL.
        await ui.wait(`Number(document.querySelector('#advanced-watch-count').textContent)>0`, 'Original game watches retained');
        return { boundTab: before };
      } finally { await session.closePage(other); }
    });
    if (session.browser === 'chromium') await step('worker-recovery', async () => {
      const before = await ui.state();
      await session.stopWorker();
      await ui.wait(`!document.querySelector('#quick-scan').disabled`, 'Controls reconnected after worker termination');
      await ui.wait(`Number(document.querySelector('#advanced-watch-count').textContent)===${before.watches} && document.querySelector('#advanced-result-count').textContent===${JSON.stringify(before.count)}`, 'Worker recovered shared scan/watch state');
      let freshCount;
      if (game.id === 'J1') {
        freshCount = await withPausedAsteroidsScore(session, gamePage, async value => {
          const count = await ui.scan('exact', value);
          if (!(await ui.candidates()).some(c => c.location === 'Game.score')) throw new GameTestError('Recovered scan missed the game-rendered score.', 'extension', 'FAIL');
          return count;
        });
      } else if (game.id === 'W1') {
        const value = await readRenderedValue(session, gamePage, game.id);
        if (!Number.isFinite(value)) throw new GameTestError('No rendered lives for recovery verification.');
        freshCount = await ui.scan('exact', value);
      } else {
        // A valid completed refinement proves the restarted worker routes fresh
        // commands; zero unchanged values is a legitimate gameplay outcome.
        freshCount = await ui.scan('unchanged');
      }
      if (['J1', 'W1'].includes(game.id) && !(freshCount > 0)) throw new GameTestError('No live candidates after worker recovery refinement.', 'extension', 'FAIL');
      const after = await ui.state();
      return { watches: after.watches, candidates: after.count, freshRefinement: true };
    });
    await step('reload', async () => {
      const oldSource = (await ui.state()).source;
      await session.navigate(gamePage, gameUrl);
      await ui.wait(`document.querySelector('#advanced-watch-count').textContent==='0' && document.querySelector('#advanced-write').disabled`, 'Reload invalidated watches and edits');
      await ui.wait(`Array.from(document.querySelector('#advanced-instance').options).some(o=>o.value!==${JSON.stringify(oldSource)})`, 'New document source');
      await session.screenshot(gamePage, join(artifactDir, 'reloaded.png'));
      return { staleWatches: 0, staleWritesDisabled: true };
    });
    // Parent may add browser/frame recovery cases, but these controls are no longer needed.
    await session.closePage(ui.page);
  }
  return evidence;
}

export async function runPauseCases({ ui, read, naturalChange, target, runStep, session, gamePage }) {
  const isPlaying = () => session.evaluate(gamePage, `(() => { const player = document.querySelector('ruffle-player'); if (!player) return null; const api = typeof player.ruffle === 'function' ? player.ruffle(1) : player; return typeof api.suspended === 'boolean' ? !api.suspended : typeof api.isPlaying === 'boolean' ? api.isPlaying : null; })()`);
  const observeScan = async (phase, action) => {
    try { return await withScanPauseObservation({session,gamePage,ui},action); }
    catch (error) { error.message = `${phase}: ${error.message}`; throw error; }
  };

  await runStep('pause-resume', async () => {
    await ui.wait(`!document.querySelector('#pause-game').disabled`, 'Ruffle pause available');
    await ui.click('#pause-game');
    await ui.wait(`document.querySelector('#pause-game').getAttribute('aria-pressed')==='true'`, 'Ruffle paused');
    if (await isPlaying() !== false) throw new GameTestError('Ruffle public playback is still running after Pause.', 'extension', 'FAIL');
    const before = await read(); await performActions(session, gamePage, target.change); await delay(1000); const after = await read();
    if (before !== after) throw new GameTestError(`Ruffle target advanced while paused: rendered ${before} → ${after}.`, 'extension', 'FAIL');
    await ui.click('#pause-game');
    await ui.wait(`document.querySelector('#pause-game').getAttribute('aria-pressed')==='false'`, 'Ruffle resumed');
    return { before, after, resumedChange: await naturalChange(after) };
  });
  await runStep('pause-scanning', async () => {
    await ui.click('#pause-while-scanning');
    await ui.click('#pause-game');
    await ui.wait(`document.querySelector('#pause-game').getAttribute('aria-pressed')==='true'`, 'Existing pause');
    await ui.reset();
    await ui.set('#advanced-type', target.scan.type);
    const existingPause = await observeScan('Existing manual pause', observe => ui.scan('exact', 987654321, undefined, { during: observe }));
    if (await isPlaying() !== false) throw new GameTestError('Scan released the existing Ruffle pause.', 'extension', 'FAIL');
    if (!await ui.evaluate(`document.querySelector('#pause-game').getAttribute('aria-pressed')==='true'`)) throw new GameTestError('Scan released a pre-existing pause.', 'extension', 'FAIL');
    await ui.click('#pause-game');
    await ui.reset();
    const scanPause = await observeScan('Scan-owned pause', observe => ui.scan('exact', 987654321, undefined, { during: observe }));
    await poll(isPlaying, value => value === true, { description: 'Public Ruffle playback resumed after scan', category: 'extension', status: 'FAIL' });
    await ui.wait(`document.querySelector('#pause-game').getAttribute('aria-pressed')==='false'`, 'Scan-owned pause released');
    return { preservedExistingPause: true, releasedScanPause: true, observations: { existing: existingPause.evidence, scan: scanPause.evidence } };
  });
  await runStep('pause-cancel', async () => {
    await ui.reset();
    // Search real memory rather than copying a baseline: exhaustive comparison
    // yields naturally and gives the user an actual operation to cancel.
    await ui.set('#advanced-condition', 'exact');
    await ui.set('#advanced-value', 987654321);
    const cancelledScan = await observeScan('Scan cancellation', async observe => {
      await ui.click('#advanced-scan');
      try { await ui.wait(`!document.querySelector('#cancel-advanced-scan').hidden`, 'Cancellable scan', 3000); }
      catch { throw new GameTestError('Scan completed before cancellation could be exercised; cancellation coverage is incomplete.'); }
      await observe();
      await ui.click('#cancel-advanced-scan');
    });
    const cancellationStatus = await poll(() => ui.evaluate(`document.querySelector('#advanced-status').textContent`), scanCancellationAcknowledged, {timeout:5000,description:'Packaged scan cancellation acknowledged',category:'extension',status:'FAIL'});
    await ui.wait(`!document.querySelector('#advanced-scan').disabled && document.querySelector('#pause-game').getAttribute('aria-pressed')==='false'`, 'Cancellation released scan-owned pause');
    await poll(isPlaying, value => value === true, { description: 'Public Ruffle playback resumed after cancellation', category: 'extension', status: 'FAIL' });
    return { cancelled: true, cancellationStatus, resumed: true, observation: cancelledScan.evidence };
  });
}
