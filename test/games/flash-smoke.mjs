import { join } from 'node:path';
import { GameUI } from './ui.mjs';
import { GameTestError, delay, poll } from './observations.mjs';

// Public Ruffle API observations only. This deliberately does not read AVM memory,
// invoke the extension bridge, or claim that game counters have been qualified.
const publicState = `(() => {
  const player = document.querySelector('ruffle-player');
  if (!player) return null;
  const api = typeof player.ruffle === 'function' ? player.ruffle(1) : player;
  const metadata = api.metadata ?? player.metadata;
  return { metadata: metadata ? { width: metadata.width, height: metadata.height,
    frameRate: metadata.frameRate, numFrames: metadata.numFrames,
    isActionScript3: metadata.isActionScript3 } : null,
    suspended: typeof api.suspended === 'boolean' ? api.suspended : null,
    isPlaying: typeof api.isPlaying === 'boolean' ? api.isPlaying : null };
})()`;
const isPaused = state => state?.suspended !== null && state?.suspended !== undefined ? state.suspended : typeof state?.isPlaying === 'boolean' ? !state.isPlaying : null;

export async function runFlashSmoke({ session, game, asset, gamePage, controls, baseline, step, artifactDir }) {
  if (game.runtime !== 'ruffle') return;
  const state = await step('flash-load', async () => {
    const result = await poll(() => session.evaluate(gamePage, publicState),
      value => value?.metadata && typeof value.metadata.isActionScript3 === 'boolean' && value.metadata.width > 0 && value.metadata.height > 0,
      { timeout: 60000, description: 'Ruffle loaded metadata', category: 'baseline' });
    const reportedAvm = result.metadata.isActionScript3 ? 'AVM2' : 'AVM1';
    if (reportedAvm !== asset.avm) throw new GameTestError(`Ruffle metadata reports ${reportedAvm}; independent SWF parser reports ${asset.avm}.`, 'baseline');
    await delay(2500);
    const screenshot = join(artifactDir, `${baseline ? 'baseline' : 'extension'}-flash-loaded.png`);
    await session.screenshot(gamePage, screenshot);
    return { independentlyParsedAvm: asset.avm, reportedAvm, metadata: result.metadata,
      ruffleVersion: asset.ruffle.provenance.version, screenshot,
      coverage: 'Runtime loading and metadata only; no gameplay target qualification.' };
  });
  if (baseline) return state;
  const ui = new GameUI(session, controls);
  await step('flash-source-runtime', async () => {
    const source = await ui.ready({ javascript: false, type: 'smart' });
    await ui.wait(`document.querySelector('#advanced-avm-type').textContent===${JSON.stringify(asset.avm)}`, 'Selected Ruffle source AVM matches SWF');
    const displayedAvm = await ui.evaluate(`document.querySelector('#advanced-avm-type').textContent`);
    return { source, displayedAvm, independentlyParsedAvm: asset.avm };
  });
  await step('flash-manual-pause', async () => {
    await ui.wait(`!document.querySelector('#pause-game').disabled`, 'Ruffle manual pause control');
    const before = await session.evaluate(gamePage, publicState);
    if (isPaused(before) === null) throw new GameTestError('Ruffle public API exposes no observable playback/suspension state.');
    if (isPaused(before)) throw new GameTestError('Ruffle started paused; manual pause smoke requires active playback.');
    let paused = false;
    try {
      await ui.click('#pause-game');
      paused = true;
      await ui.wait(`document.querySelector('#pause-game').getAttribute('aria-pressed')==='true'`, 'Packaged UI reports manual pause');
      await poll(() => session.evaluate(gamePage, publicState), value => isPaused(value) === true,
        { description: 'Ruffle public API confirms suspension', category: 'extension', status: 'FAIL' });
      await delay(300);
      if (isPaused(await session.evaluate(gamePage, publicState)) !== true) throw new GameTestError('Ruffle did not remain suspended.', 'extension', 'FAIL');
      await ui.click('#pause-game');
      paused = false;
      await ui.wait(`document.querySelector('#pause-game').getAttribute('aria-pressed')==='false'`, 'Packaged UI reports resume');
      await poll(() => session.evaluate(gamePage, publicState), value => isPaused(value) === false,
        { description: 'Ruffle public API confirms resume', category: 'extension', status: 'FAIL' });
      await delay(5000);
      const screenshot = join(artifactDir, 'extension-flash-resumed.png');
      await session.screenshot(gamePage, screenshot);
      return { publicApiConfirmedPause: true, publicApiConfirmedResume: true, screenshot,
        coverage: 'Public runtime suspension only; gameplay counter stability is a separate scenario.' };
    } finally {
      if (paused) await ui.click('#pause-game').catch(() => {});
    }
  });
  return state;
}
