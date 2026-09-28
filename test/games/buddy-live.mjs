import {join} from 'node:path';
import {createOcrClient} from './ocr-client.mjs';
import {GameUI} from './ui.mjs';
import {runPauseCases} from './scenarios.mjs';
import {GameTestError,delay,poll} from './observations.mjs';

export function parseBuddyCash(reading) {
  const words=reading.words;
  const word=words?.[0];
  const box=word?.bbox;
  const validBox=box&&['x0','y0','x1','y1'].every(k=>Number.isFinite(box[k]))&&box.x0<box.x1&&box.y0<box.y1;
  // Tesseract's standard word confidence isolates the complete cash counter
  // from unrelated tool-label text or a moving buddy limb in the footer crop.
  // Require one unambiguous leading currency word, wholly inside that crop.
  if(words&&(!word||!validBox||words.filter(w=>typeof w.text==='string'&&w.text.includes('$')).length!==1||
    box.x0<24||box.x1>=384||box.y0<742||box.y1>=778))
    throw new GameTestError('Buddy cash OCR lacks one complete leading currency word.');
  const text=word?.text??reading.text.trim();
  const confidence=words?word.confidence:reading.confidence;
  const match=text.match(words?/^\$([\d,]+)\.(\d{2})$/:/^\$\s*([\d,]+)\.(\d{2})(?:\s|$)/);
  if(!Number.isFinite(confidence)||confidence<85||!match)throw new GameTestError(`Unreliable Buddy cash OCR (${confidence}%): ${JSON.stringify(text)}`);
  return Number(match[1].replaceAll(',',''))*100+Number(match[2]);
}
// The real game's footer truncates cents: a public UI candidate of
// 2.625000000000001 rendered as $2.62 during qualification on 2026-09-28.
// Scan the displayed cent interval, not a guessed exact binary float.
export function buddyCashInterval(cents) {
  if(!Number.isSafeInteger(cents)||cents<0)throw new Error('Cash observation must be nonnegative integer cents');
  return [cents/100-1e-9,(cents+1)/100+1e-9];
}

export async function runBuddyLive({session,gamePage,site,controls,baseline,artifactDir,step}) {
  const page=site.playPage;
  const dimensions=await session.evaluate(page,'({width:innerWidth,height:innerHeight})');
  if(dimensions.width!==550||dimensions.height!==400)throw new GameTestError('Buddy requires its original 550×400 stage for qualified visible inputs.');
  await session.setPixelRatio(page,2);
  const ocr=await createOcrClient({cachePath:artifactDir,langPath:process.env.GAME_OCR_LANG_PATH});
  let sequence=0;
  const raw=async(name,region)=>{
    const path=join(artifactDir,`buddy-${++sequence}-${name}.png`);await session.screenshot(page,path);
    const rectangle=Object.fromEntries(Object.entries(region).map(([k,v])=>[k,v*2]));
    return {...await ocr.recognize(path,rectangle,{words:name==='cash'}),path};
  };
  const cash=async()=>parseBuddyCash(await raw('cash',{left:12,top:371,width:180,height:18}));
  const click=async(x,y)=>{await session.click(page,x,y);await delay(100);};
  const expectCash=(value)=>poll(cash,v=>v===value,{timeout:5000,interval:150,description:`Buddy rendered cash is ${value} cents`,category:'extension',status:'FAIL'});
  let hit=0;
  const earn=async before=>poll(async()=>{
    // Genuine mouse interaction with the visible buddy; a changed rendered
    // cash receipt, never an input count, is the proof of earning.
    await click(135+(hit++%8)*35,350);
    return cash();
  },v=>v>before,{timeout:30000,interval:100,description:'Buddy interaction increases rendered cash',category:'baseline'});
  const name=async()=>{
    const r=await raw('shop-item',{left:185,top:91,width:163,height:19});
    if(r.confidence<85||!/[A-Za-z]/.test(r.text))throw new GameTestError(`Unreliable Buddy item name: ${JSON.stringify(r)}`);
    return r.text.trim();
  };
  const price=async()=>{
    const r=await raw('shop-price',{left:294,top:298,width:68,height:19});
    const m=r.text.trim().match(/^\$\s*(\d+)(?:\.(\d{2}))?$/);
    if(r.confidence<85||!m)throw new GameTestError(`Unreliable Buddy item price: ${JSON.stringify(r)}`);
    return Number(m[1])*100+Number(m[2]||0);
  };
  const buy=async({frozen=false}={})=>{
    const before=await cash();const item=await name();await click(245,100);const cost=await price();
    if(cost>before)throw new GameTestError(`Cannot verify purchase: ${item} costs ${cost} cents, balance ${before}.`);
    await click(275,344);
    const next=await poll(name,value=>value!==item,{timeout:5000,description:'Purchased item is removed from the locked-items shop',category:'extension',status:'FAIL'});
    const after=await expectCash(frozen?before:before-cost);
    return {item,cost,before,after,nextLockedItem:next,unlocked:true};
  };
  try {
    let original;
    await step('game-start',async()=>{original=await poll(cash,v=>v===0,{timeout:45000,interval:500,description:'Original Buddy cash footer starts at $0.00',category:'baseline'});return{cash:original,stage:dimensions,pixelRatio:2};});
    await step('baseline',async()=>{const after=await earn(original);return{before:original,after,proof:'Real hand interaction creates visible cash income'};});
    if(baseline)return{targets:['money'],observations:'Rendered cash OCR and genuine hand interaction'};
    const ui=new GameUI(session,controls);await ui.ready({type:'f64'});
    const freshWatch=async(expected)=>{
      await session.activate(ui.page);
      await ui.wait(`document.visibilityState==='visible'`,'Visible Buddy watch refreshes');
      await ui.evaluate(`(() => {
        const samples=[];
        const observer=new MutationObserver(records=>{
          if(!records.some(r=>(r.target.nodeType===1?r.target:r.target.parentElement)?.closest('.candidate-value')))return;
          const value=Number(document.querySelector('.watch-row .candidate-value')?.textContent.replaceAll(',',''));
          samples.push({time:Date.now(),value});
        });
        observer.observe(document.querySelector('#advanced-watches'),{childList:true,subtree:true,characterData:true});
        globalThis.__buddyWatchObservation={samples,observer};
      })()`);
      try {
        const samples=await poll(()=>ui.evaluate('globalThis.__buddyWatchObservation.samples'),values=>{
          const last=values.at(-1);
          if(!last||!Number.isFinite(last.value)||(expected!==undefined&&last.value!==expected))return false;
          const lastDifferent=values.findLastIndex(v=>v.value!==last.value);
          return last.time-values[lastDifferent+1].time>=200;
        },{timeout:5000,interval:50,description:`Fresh visible Buddy watch reads ${expected??'a stable value'}`,category:'extension',status:'FAIL'});
        return {value:samples.at(-1).value,samples};
      } finally {await ui.evaluate(`globalThis.__buddyWatchObservation.observer.disconnect();delete globalThis.__buddyWatchObservation;`);}
    };

    const paused=async(value)=>{
      const current=await ui.evaluate(`document.querySelector('#pause-game').getAttribute('aria-pressed')==='true'`);
      if(current!==value)await ui.click('#pause-game');
      await ui.wait(`document.querySelector('#pause-game').getAttribute('aria-pressed')===${JSON.stringify(String(value))}`,'Buddy packaged pause state');
      await poll(()=>session.evaluate(page,`document.querySelector('ruffle-player').ruffle(1).suspended`),v=>v===value,{timeout:5000,description:'Public Buddy runtime confirms pause',category:'extension',status:'FAIL'});
    };
    await paused(true);
    let count;
    await step('discovery',async()=>{const value=await cash();count=await ui.scan('range',...buddyCashInterval(value));if(!count)throw new GameTestError('No money candidates match the independently rendered cent interval.','target-accessibility','UNSUPPORTED TARGET');return{cents:value,count,type:'f64',interval:buddyCashInterval(value)};});
    const refinements=[];
    await step('refine',async()=>{
      for(let n=0;n<4;n++){
        const before=await cash();await paused(false);await earn(before);await delay(500);await paused(true);
        const value=await cash();count=await ui.scan('range',...buddyCashInterval(value));refinements.push({cents:value,count});
        if(count===0)throw new GameTestError('Natural Buddy money refinement lost all candidates.');
        if(count===1)break;
      }
      if(count>8)throw new GameTestError(`Buddy money remains too ambiguous for a bounded reversible challenge (${count}).`);
      return{count,refinements};
    });
    // AVM1 retains rendered/cached copies. Distinguish them by a reversible
    // public-UI challenge, with a real earning event as the independent oracle.
    // Every candidate is tested and restored; none is picked by address/order.
    let winner=0;
    if(count>1)await step('candidate-challenge',async()=>{
      const outcomes=[];
      for(let index=0;index<count;index++){
        await paused(true);await ui.select(index);
        const originalWatch=await freshWatch();const old=originalWatch.value;
        if(!Number.isFinite(old))throw new GameTestError('Candidate restoration value is unavailable in the visible watch.');
        await session.activate(gamePage);
        let observed,after,valid=false;
        try {
          await ui.write(1000);await freshWatch(1000);await session.activate(gamePage);await paused(false);await delay(400);observed=await cash();
          if(observed>=100000&&observed<100500){after=await earn(observed);valid=after>observed&&after<100500;}
        } finally {
          await paused(true);await ui.write(old);await freshWatch(old);
          await session.activate(gamePage);await ui.click('.watch-remove');
        }
        outcomes.push({index,old,observed,after,valid,restored:true});
      }
      const valid=outcomes.filter(o=>o.valid);
      if(valid.length!==1)throw new GameTestError(`Buddy candidate challenge did not isolate exactly one effective money value: ${JSON.stringify(outcomes)}`);
      winner=valid[0].index;return{outcomes,verifiedCandidates:1};
    });
    await step('undo-scan',async()=>{await ui.scan('exact',987654321);await ui.undoScan(count);return{restoredCandidates:count};});
    await step('watch',async()=>{await ui.select(winner);return{verifiedCandidateIndex:winner,watches:(await ui.state()).watches};});
    let purchase;
    await step('write',async()=>{
      const unedited=await cash();await ui.write(1000);await paused(false);await delay(500);
      await click(146,20);await click(180,120);await click(245,100);
      const cost=await price();if(unedited>=cost)throw new GameTestError('The edited-funds purchase was already affordable before editing.');
      purchase=await buy();return{written:1000,uneditedCents:unedited,...purchase};
    });
    await step('guarded-undo',async()=>{await ui.restore({guarded:true});return{refusedAfterRealPurchase:true};});
    await step('undo',async()=>{
      const before=await cash();await paused(true);const originalWatch=await freshWatch();
      await ui.write(2000);const changedWatch=await freshWatch(2000);
      await ui.restore({guarded:false});const restoredWatch=await freshWatch(originalWatch.value);
      await session.activate(gamePage);await paused(false);
      await expectCash(before);const receipt=await buy();return{originalWatch,changedWatch,restoredWatch,restoredCents:before,subsequentPurchase:receipt};
    });
    await step('freeze',async()=>{
      await ui.freeze(1000);await expectCash(100000);const receipts=[];
      for(let i=0;i<3;i++){
        receipts.push(await buy({frozen:true}));
        if(!await ui.evaluate(`Array.from(document.querySelectorAll('[data-count]')).some(e=>Number(e.textContent)>0)`))throw new GameTestError('Money freeze stopped during shop purchases.','extension','FAIL');
      }
      return{frozenCents:100000,receipts,proof:'Three distinct formerly locked items are bought and removed from the shop while rendered funds stay fixed.'};
    });
    await step('stop',async()=>{await ui.stop();return buy();});
    await click(385,55); // Close the visible shop.
    await runPauseCases({ui,read:cash,naturalChange:earn,target:{scan:{type:'f64'},change:[{click:[205,350]},{click:[275,350]},{click:[345,350]}]},runStep:step,session,gamePage:page});
    await step('reopen',async()=>{const before=await ui.state();await session.closePage(ui.page);ui.page=await session.openControls(gamePage);await ui.wait(`document.querySelector('#quick-scan')&&!document.querySelector('#quick-scan').disabled`,'Reopened Buddy controls');await ui.wait(`Number(document.querySelector('#advanced-watch-count').textContent)===${before.watches}`,'Buddy watch survives reopen');await ui.click('[data-view="advanced"]');await ui.click('.watch-select');await ui.wait(`!document.querySelector('#advanced-write').disabled`,'Retained Buddy watch selected for editing');return{watches:before.watches};});
    await step('tab-binding',async()=>{
      const id=await ui.evaluate('new URLSearchParams(location.search).get("tabId")');const other=await session.newPage('about:blank');
      try{await paused(true);await session.activate(other);await ui.write(700);if(await ui.evaluate('new URLSearchParams(location.search).get("tabId")')!==id)throw new GameTestError('Buddy controls lost original tab binding.');await session.activate(gamePage);await paused(false);const after=await poll(cash,v=>v>=70000&&v<70500,{timeout:5000,description:'Original Buddy game receives write while another tab was active'});return{boundTab:id,written:700,originalGameCents:after};}finally{await session.closePage(other);await session.activate(gamePage);}
    });
    await step('reload',async()=>{await session.navigate(gamePage,site.metadata.url);await ui.wait(`document.querySelector('#advanced-watch-count').textContent==='0'&&document.querySelector('#advanced-write').disabled`,'Reload invalidates Buddy watch and writes');return{staleWatches:0,staleWritesDisabled:true};});
    await session.closePage(ui.page);
    return{targets:['money'],observations:'High-DPI rendered cash and shop OCR, genuine hand earnings and previously unaffordable purchases'};
  } finally {await ocr.close();}
}
