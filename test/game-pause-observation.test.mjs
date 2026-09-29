import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {armPlaybackObservation,armControlObservation,stopPlaybackObservation,stopControlObservation,observedScanPause,withScanPauseObservation,scanCancellationAcknowledged,armProgressCancellation,stopProgressCancellation,withProgressCancellation} from './games/pause-observation.mjs';

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

function cancellationFixture() {
  let mutation,clicks=0,disconnected=false,time=0;
  const scan={disabled:false},cancel={hidden:true,disabled:false,click(){clicks++;}},status={textContent:'Ready to scan this source.'};
  const context=vm.createContext({document:{querySelector:s=>({'#quick-scan':scan,'#cancel-quick-scan':cancel,'#quick-status':status}[s])},Date:{now:()=>time},MutationObserver:class{constructor(fn){mutation=fn;}observe(){}disconnect(){disconnected=true;}}});
  vm.runInContext(armProgressCancellation,context);
  return{context,scan,cancel,status,mutate(){time++;mutation();},get clicks(){return clicks;},get disconnected(){return disconnected;}};
}
test('prearmed public cancellation dispatches during partial progress before a delayed driver can react',()=>{
  const f=cancellationFixture();
  f.scan.disabled=true;f.cancel.hidden=false;f.status.textContent='Scanning values…';f.mutate();
  assert.equal(f.clicks,0,'initial busy controls do not prove actual scanning');
  f.status.textContent='Scanning… 262,144 / 15,000,000';f.mutate();
  assert.equal(f.clicks,1);
  const dispatch=f.context.__hackProgressCancellation.clicked;
  assert.equal(dispatch.busy,true);assert.equal(dispatch.inspected,262144);assert.equal(dispatch.total,15000000);
  // A full browser round trip would see only this completed state.
  f.scan.disabled=false;f.cancel.hidden=true;f.status.textContent='No matching values.';f.mutate();
  assert.equal(f.clicks,1,'click once only, never retry a completed scan');
  assert.equal(f.disconnected,true);
  vm.runInContext(stopProgressCancellation,f.context);assert.equal(f.context.__hackProgressCancellation,undefined);
});
test('cancellation never dispatches on zero/final/malformed progress or unavailable controls',()=>{
  for(const text of ['Scanning values…','Scanning… 0 / 100','Scanning… 100 / 100','Scanning… 101 / 100','No matching values.','Scanning… NaN / 100']){
    const f=cancellationFixture();f.scan.disabled=true;f.cancel.hidden=false;f.status.textContent=text;f.mutate();assert.equal(f.clicks,0,text);
  }
  for(const state of [{busy:false,hidden:false,disabled:false},{busy:true,hidden:true,disabled:false},{busy:true,hidden:false,disabled:true}]){
    const f=cancellationFixture();f.scan.disabled=state.busy;f.cancel.hidden=state.hidden;f.cancel.disabled=state.disabled;f.status.textContent='Scanning… 1 / 100';f.mutate();assert.equal(f.clicks,0);
  }
});
test('prearmed cancellation observer is cleaned and evidence retained when the UI action fails',async()=>{
  const scripts=[];const ui={evaluate:async script=>{scripts.push(script);return {clicked:null,status:'Ready',busy:false};}};
  await assert.rejects(withProgressCancellation(ui,async()=>{throw Error('Click failed');}),error=>/Click failed; cancellation dispatch evidence/.test(error.message));
  assert.ok(scripts.includes(stopProgressCancellation));
});

test('cancellation cleanup cannot hide a primary failure or silently pass',async()=>{
  const ui={evaluate:async script=>{if(script===stopProgressCancellation)throw Error('Closed controls');return {clicked:{time:1}};}};
  await assert.rejects(withProgressCancellation(ui,async()=>{throw Error('Primary failure');}),/Primary failure/);
  await assert.rejects(withProgressCancellation(ui,async()=>{}),/Cancellation observer cleanup failed: Closed controls/);
});

test('repeated busy mutations do not create false boundaries at genuine suspended samples',()=>{
  const controls=[{time:9724,busy:false},...[9727,9728,9810,9813,9815,9817,9817,9819,9820,9820].map(time=>({time,busy:true})),{time:9821,busy:false}];
  assert.deepEqual(observedScanPause([{time:9810,playing:false},{time:9813,playing:false}],controls),{suspendedAt:9810,busyFrom:9727,busyUntil:9821});
  assert.equal(observedScanPause([{time:9727,playing:false},{time:9821,playing:false}],controls),null,'real boundaries still require strict overlap');
  assert.equal(observedScanPause([{time:9830,playing:false}],controls),null);
  assert.equal(observedScanPause([{time:20,playing:false}],[{time:10,busy:true},{time:15,busy:false},{time:25,busy:true}]),null,'separate scans cannot merge across idle time');
});
test('partially armed cancellation observers are cleaned when setup rejects',async()=>{
  const scripts=[];const ui={evaluate:async script=>{scripts.push(script);if(script===armProgressCancellation)throw Error('Setup interrupted');return null;}};
  await assert.rejects(withProgressCancellation(ui,async()=>{}),/Setup interrupted/);
  assert.ok(scripts.includes(stopProgressCancellation));
});
