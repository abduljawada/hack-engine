import { GameTestError, poll } from './observations.mjs';

// Arm before the UI action: a fast scan can finish before its click's browser
// round trip returns. Observe public playback and the actual disabled control.
export const armPlaybackObservation = `(() => {
  const samples = [];
  const sample = () => {
    const player = document.querySelector('ruffle-player');
    const api = typeof player?.ruffle === 'function' ? player.ruffle(1) : player;
    const playing = typeof api?.suspended === 'boolean' ? !api.suspended : typeof api?.isPlaying === 'boolean' ? api.isPlaying : null;
    samples.push({time:Date.now(),playing});
    if (samples.length > 4096) samples.shift();
  };
  sample();
  globalThis.__hackPauseObservation = {samples,timer:setInterval(sample,8)};
})()`;
export const armControlObservation = `(() => {
  const button = document.querySelector('#advanced-scan');
  const samples = [{time:Date.now(),busy:button.disabled}];
  const observer = new MutationObserver(() => samples.push({time:Date.now(),busy:button.disabled}));
  observer.observe(button,{attributes:true,attributeFilter:['disabled']});
  globalThis.__hackPauseObservation = {samples,observer};
})()`;
export const stopPlaybackObservation = `(() => { const state=globalThis.__hackPauseObservation; if(state) clearInterval(state.timer); delete globalThis.__hackPauseObservation; })()`;
export const stopControlObservation = `(() => { globalThis.__hackPauseObservation?.observer.disconnect(); delete globalThis.__hackPauseObservation; })()`;

export function scanCancellationAcknowledged(status) {
  return /^Scan cancelled(?:\.|;)/.test(status);
}

export function observedScanPause(playback, controls) {
  for (const sample of playback) {
    if (sample.playing !== false) continue;
    for (let i=0;i<controls.length;i++) {
      const state=controls[i],end=controls[i+1]?.time??Infinity;
      if (state.busy && sample.time>state.time && sample.time<end) return {suspendedAt:sample.time,busyFrom:state.time,busyUntil:Number.isFinite(end)?end:null};
    }
  }
  return null;
}

export async function withScanPauseObservation({session,gamePage,ui}, action) {
  let primaryError;
  try {
    await session.evaluate(gamePage,armPlaybackObservation);
    await ui.evaluate(armControlObservation);
    let evidence, lastObservation;
    const observe=async()=>{
      try { evidence=await poll(async()=>{
        const [playback,control]=await Promise.all([
          session.evaluate(gamePage,'globalThis.__hackPauseObservation.samples'),
          ui.evaluate(`({samples:globalThis.__hackPauseObservation.samples,busy:document.querySelector('#advanced-scan').disabled,error:document.querySelector('#advanced-status').classList.contains('error'),status:document.querySelector('#advanced-status').textContent})`),
        ]);
        lastObservation={playback,control};
        if (!control.busy && control.error && !control.status.startsWith('No matching values.')) throw new GameTestError(`Packaged scan failed before pause could be observed: ${control.status}`,'extension','FAIL');
        return observedScanPause(playback,control.samples);
      },Boolean,{timeout:5000,description:'Public Ruffle playback suspended during an active scan'});
      } catch (error) {
        if (lastObservation) error.message += `; pause observation evidence: ${JSON.stringify(lastObservation)}`;
        throw error;
      }
      return evidence;
    };
    const result=await action(observe);
    return {result,evidence};
  } catch (error) {
    primaryError=error;
    throw error;
  } finally {
    const cleanup=await Promise.allSettled([
      session.evaluate(gamePage,stopPlaybackObservation),
      ui.evaluate(stopControlObservation),
    ]);
    const failed=cleanup.find(result=>result.status==='rejected');
    if (failed && !primaryError) throw new GameTestError(`Pause observation cleanup failed: ${failed.reason?.message || failed.reason}`,'automation','FAIL');
  }
}
