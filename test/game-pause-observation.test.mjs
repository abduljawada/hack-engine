import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {armPlaybackObservation,armControlObservation,stopPlaybackObservation,stopControlObservation,observedScanPause,withScanPauseObservation,scanCancellationAcknowledged} from './games/pause-observation.mjs';

function fixture() {
  let time=0,tick,mutation,cleared=false,disconnected=false;
  const api={suspended:false},button={disabled:false};
  const game=vm.createContext({document:{querySelector:()=>({ruffle:()=>api})},Date:{now:()=>time},setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{cleared=true;}});
  const controls=vm.createContext({document:{querySelector:()=>button},Date:{now:()=>time},MutationObserver:class{constructor(fn){mutation=fn;}observe(){}disconnect(){disconnected=true;}}});
  vm.runInContext(armPlaybackObservation,game);vm.runInContext(armControlObservation,controls);
  return {game,controls,api,button,setTime:t=>{time=t;},tick:()=>tick(),mutation:()=>mutation(),get cleaned(){return cleared&&disconnected;}};
}
test('prearmed observations retain actual fast-scan overlap after the click has returned',()=>{
  const f=fixture();
  f.setTime(10);f.button.disabled=true;f.mutation();
  f.setTime(11);f.api.suspended=true;f.tick();
  f.setTime(15);f.api.suspended=false;f.tick();f.button.disabled=false;f.mutation();
  assert.equal(f.api.suspended,false,'after-click playback sample alone misses the pause');
  assert.equal(f.button.disabled,false,'after-click UI sample alone misses the scan');
  assert.ok(observedScanPause(f.game.__hackPauseObservation.samples,f.controls.__hackPauseObservation.samples));
  vm.runInContext(stopPlaybackObservation,f.game);vm.runInContext(stopControlObservation,f.controls);
  assert.equal(f.cleaned,true);assert.equal(f.game.__hackPauseObservation,undefined);assert.equal(f.controls.__hackPauseObservation,undefined);
});
test('a completed scan without public suspension cannot pass, nor can a pause outside its busy interval',()=>{
  assert.equal(observedScanPause([{time:11,playing:true}],[{time:10,busy:true},{time:15,busy:false}]),null);
  assert.equal(observedScanPause([{time:9,playing:false},{time:10,playing:false},{time:15,playing:false}],[{time:10,busy:true},{time:15,busy:false}]),null);
});
test('both observers are cleaned when a scan action throws',async()=>{
  const scripts=[];
  const session={evaluate:async(_page,script)=>{scripts.push(script);}};
  const ui={evaluate:async script=>{scripts.push(script);}};
  await assert.rejects(withScanPauseObservation({session,gamePage:{},ui},async()=>{throw Error('Scan rejected');}),/Scan rejected/);
  assert.ok(scripts.includes(stopPlaybackObservation));assert.ok(scripts.includes(stopControlObservation));
});

test('observer cleanup failures cannot silently pass or replace the original scan error',async()=>{
  const session={evaluate:async(_page,script)=>{if(script===stopPlaybackObservation)throw Error('Page unavailable');}};
  const ui={evaluate:async()=>{}};
  await assert.rejects(withScanPauseObservation({session,gamePage:{},ui},async()=>{}),/cleanup failed.*Page unavailable/);
  await assert.rejects(withScanPauseObservation({session,gamePage:{},ui},async()=>{throw Error('Original scan failure');}),/Original scan failure/);
});


test('scan failure retains public playback and control observations before cleanup',async()=>{
  const playback=[{time:12,playing:true}],control={samples:[{time:10,busy:true},{time:15,busy:false}],busy:false,error:true,status:'Scan rejected'};
  const session={evaluate:async(_page,script)=>script==='globalThis.__hackPauseObservation.samples'?playback:undefined};
  const ui={evaluate:async script=>script.startsWith('({samples:')?control:undefined};
  await assert.rejects(withScanPauseObservation({session,gamePage:{},ui},observe=>observe()),error=>{
    assert.match(error.message,/Scan rejected/);
    assert.deepEqual(JSON.parse(error.message.split('; pause observation evidence: ')[1]),{playback,control});
    return true;
  });
});


test('completed scans and cancellation requests cannot pass cancellation acknowledgement',()=>{
  for(const status of ['Baseline captured. Change the game value.','No matching values.','Cancelling scan...','Ready to scan this source.']) assert.equal(scanCancellationAcknowledged(status),false,status);
  assert.equal(scanCancellationAcknowledged('Scan cancelled.'),true);
  assert.equal(scanCancellationAcknowledged('Scan cancelled; the previous completed results are available.'),true);
});

test('a genuine zero-result scan can prove pause without being mistaken for a scan error',async()=>{
  const playback=[{time:12,playing:false}],control={samples:[{time:10,busy:true},{time:15,busy:false}],busy:false,error:true,status:'No matching values.'};
  const session={evaluate:async(_page,script)=>script==='globalThis.__hackPauseObservation.samples'?playback:undefined};
  const ui={evaluate:async script=>script.startsWith('({samples:')?control:undefined};
  const result=await withScanPauseObservation({session,gamePage:{},ui},observe=>observe());
  assert.deepEqual(result.evidence,{suspendedAt:12,busyFrom:10,busyUntil:15});
});
