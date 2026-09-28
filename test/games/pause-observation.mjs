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

// React in the controls document, not after multiple automation round trips.
// This is only a public DOM click after the real scan reports partial progress.
export const armProgressCancellation = String.raw`(() => {
  const scan=document.querySelector('#advanced-scan');
  const cancel=document.querySelector('#cancel-advanced-scan');
  const status=document.querySelector('#advanced-status');
  const state={clicked:null};
  const observer=new MutationObserver(() => {
    if(state.clicked || !scan.disabled || cancel.hidden || cancel.disabled)return;
    const text=status.textContent;
    const match=text.match(/^Scanning… ([\d,]+) \/ ([\d,]+)$/);
    if(!match)return;
    const inspected=Number(match[1].replaceAll(',',''));
    const total=Number(match[2].replaceAll(',',''));
    if(!(inspected>0 && inspected<total))return;
    state.clicked={time:Date.now(),status:text,busy:scan.disabled,cancelHidden:cancel.hidden,cancelDisabled:cancel.disabled,inspected,total};
    observer.disconnect();
    cancel.click();
  });
  observer.observe(status,{childList:true,subtree:true,characterData:true});
  observer.observe(scan,{attributes:true,attributeFilter:['disabled']});
  observer.observe(cancel,{attributes:true,attributeFilter:['hidden','disabled']});
  state.observer=observer;
  globalThis.__hackProgressCancellation=state;
})()`;
export const stopProgressCancellation = `(() => { globalThis.__hackProgressCancellation?.observer.disconnect(); delete globalThis.__hackProgressCancellation; })()`;

export async function withProgressCancellation(ui, action) {
  let primaryError;
  try {
    await ui.evaluate(armProgressCancellation);
    await action();
    return await poll(()=>ui.evaluate('globalThis.__hackProgressCancellation.clicked'),Boolean,
      {timeout:5000,description:'Public Cancel clicked during real partial scan progress',category:'extension',status:'FAIL'});
  } catch(error) {
    primaryError=error;
    const state=await ui.evaluate(`({clicked:globalThis.__hackProgressCancellation?.clicked,status:document.querySelector('#advanced-status').textContent,busy:document.querySelector('#advanced-scan').disabled})`).catch(()=>null);
    error.message += `; cancellation dispatch evidence: ${JSON.stringify(state)}`;
    throw error;
  } finally {
    try {await ui.evaluate(stopProgressCancellation);}
    catch(error) {if(!primaryError)throw new GameTestError(`Cancellation observer cleanup failed: ${error.message}`,'automation','FAIL');}
  }
}

export function scanCancellationAcknowledged(status) {
  return /^Scan cancelled(?:\.|;)/.test(status);
}

export function observedScanPause(playback, controls) {
  // Reassigning disabled=true emits another attribute mutation, not a new
  // scan boundary. Keep the original samples for diagnostics but compare
  // playback only against actual busy-state transitions.
  const transitions=controls.filter((state,index)=>index===0||state.busy!==controls[index-1].busy);
  for (const sample of playback) {
    if (sample.playing !== false) continue;
    for (let i=0;i<transitions.length;i++) {
      const state=transitions[i],end=transitions[i+1]?.time??Infinity;
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
