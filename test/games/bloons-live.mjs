import {join} from 'node:path';
import {createOcrClient} from './ocr-client.mjs';
import {GameUI} from './ui.mjs';
import {runPauseCases} from './scenarios.mjs';
import {GameTestError,delay,poll} from './observations.mjs';

// Coordinates are visual stage positions, never memory addresses. Before using
// them, require the original stage geometry and read the rendered starting HUD.
export async function runBloonsLive({session,gamePage,site,controls,baseline,artifactDir,step}){
  const page=site.playPage;
  const dimensions=await session.evaluate(page,'({width:innerWidth,height:innerHeight})');
  if(dimensions.width!==640||dimensions.height!==480)throw new GameTestError(`Bloons website stage is ${dimensions.width}×${dimensions.height}; qualified pointer/OCR regions require 640×480.`);
  const worker=await createOcrClient({cachePath:artifactDir,langPath:process.env.GAME_OCR_LANG_PATH});
  let sequence=0;
  const click=async(x,y)=>{await session.click(page,x,y);await delay(350);};
  const raw=async region=>{const path=join(artifactDir,`bloons-${++sequence}.png`);await session.screenshot(page,path);return {...await worker.recognize(path,region),path};};
  const number=async(name)=>{
    const region=name==='cash'?{left:570,top:5,width:61,height:22}:{left:583,top:27,width:48,height:22};
    const data=await raw(region);const match=data.text.trim().match(/^([\d,]+)$/);
    if(data.confidence<85||!match)throw new GameTestError(`Unreliable live Bloons ${name} OCR (${data.confidence}%): ${JSON.stringify(data.text)}; ${data.path}`);
    return Number(match[1].replaceAll(',',''));
  };
  const expect=(name,value,category='extension')=>poll(()=>number(name),actual=>actual===value,{timeout:5000,interval:200,description:`Rendered ${name} becomes ${value} after completed input`,category,status:'FAIL'});
  const buy=async()=>{await click(503,88);await click(32,53);};
  const sell=async()=>{await click(32,53);await click(555,427);};
  try{
    await step('game-start',async()=>{
      // The live host may overlay Ruffle's software-rendering notice. Its
      // visible close control is in the top right of this qualified stage.
      await click(600,22);
      await poll(async()=>{
        const data=await raw({left:570,top:5,width:61,height:22});
        if(data.confidence>=85 && data.text.trim()==='650')return true;
        // Both intro Play Now and title Start occupy this stage position.
        // A rendered starting balance, not elapsed time, ends this loop.
        await click(445,361);return false;
      },Boolean,{timeout:180000,interval:1500,description:'Bloons rendered track-selection cash 650',category:'automation'});
      await delay(800);await click(96,170);await click(122,226);await delay(500);
      return {cash:await expect('cash',650,'baseline'),lives:await expect('lives',100,'baseline')};
    });
    let cash;
    await step('baseline',async()=>{const before=await number('cash');await buy();await expect('cash',before-215,'baseline');await sell();cash=await expect('cash',before-15,'baseline');return {target:'cash',before,purchase:before-215,sale:cash};});
    if(baseline){
      await step('lives:baseline',async()=>{await click(570,453);const after=await poll(()=>number('lives'),v=>v<100,{timeout:60000,interval:500,description:'Undefended Bloons reduce rendered lives',category:'baseline'});return{before:100,after};});
      return {targets:['cash','lives'],observations:'Screenshot OCR, genuine purchases/sales and undefended wave'};
    }
    const ui=new GameUI(session,controls);await ui.ready({type:'i32'});
    await step('discovery',async()=>{await ui.reset();await ui.set('#advanced-type','i32');const count=await ui.scan('exact',cash);if(!count)throw new GameTestError('No cash candidates in website Ruffle source.','target-accessibility','UNSUPPORTED TARGET');return {value:cash,count};});
    await step('refine',async()=>{
      const refinements=[];let count;
      for(let attempt=0;attempt<4;attempt++){
        if(attempt>0){await sell();cash=await expect('cash',cash+200);count=await ui.scan('exact',cash);refinements.push({event:'sale',value:cash,count});}
        await buy();cash=await expect('cash',cash-215);count=await ui.scan('exact',cash);refinements.push({event:'purchase',value:cash,count});
        if(count===1)break;
        if(count===0)throw new GameTestError(`Cash refinement lost all candidates: ${JSON.stringify(refinements)}`);
      }
      if(count!==1)throw new GameTestError(`Rendered cash refinement remained ambiguous after bounded economy events: ${JSON.stringify(refinements)}`);
      return {value:cash,count,refinements};
    });
    await step('undo-scan',async()=>{await ui.scan('exact',987654321);await ui.undoScan(1);return{restoredCandidates:1};});
    await step('watch',async()=>{await ui.select(0);return{watches:(await ui.state()).watches};});
    await step('write',async()=>{await ui.write(1000);await sell();cash=await expect('cash',1200);return{written:1000,saleProceeds:200,renderedAfterSale:cash,cachedHud:true};});
    await step('guarded-undo',async()=>{await ui.restore({guarded:true});return{refusedAfterNaturalSale:true};});
    await step('undo',async()=>{await ui.write(2000);await ui.restore({guarded:false});await buy();cash=await expect('cash',985);return{restoredBeforePurchase:1200,renderedAfterPurchase:cash};});
    await step('freeze',async()=>{
      await ui.freeze(1000);await delay(350);await sell();await expect('cash',1200);await delay(350);await buy();await expect('cash',785);await delay(350);await sell();await expect('cash',1200);await delay(350);
      return{frozen:1000,receipts:[1200,785,1200],proof:'Each sale and purchase computes from the frozen balance; cached HUD alone is not used as proof.'};
    });
    await step('stop',async()=>{await ui.stop();await buy();await expect('cash',785);await sell();cash=await expect('cash',985);return{normalPurchase:785,normalSale:cash};});
    // Begin again with no prior watches so generic Undo/Stop controls refer to
    // the lives candidate, rather than an unrelated retained cash watch.
    await ui.click('.watch-remove');await ui.reset();
    let life=await number('lives');
    const setPaused=async value=>{
      const current=await ui.evaluate(`document.querySelector('#pause-game').getAttribute('aria-pressed')==='true'`);
      if(current!==value)await ui.click('#pause-game');
      await ui.wait(`document.querySelector('#pause-game').getAttribute('aria-pressed')===${JSON.stringify(''+value)}`,'Bloons pause state updated');
      await poll(()=>session.evaluate(page,`(() => {const p=document.querySelector('ruffle-player');const api=typeof p.ruffle==='function'?p.ruffle(1):p;return typeof api.suspended==='boolean'?api.suspended:typeof api.isPlaying==='boolean'?!api.isPlaying:null;})()`),paused=>paused===value,{timeout:5000,description:'Public Bloons runtime confirms requested pause state',category:'extension',status:'FAIL'});
    };
    const watchExpression=`Number(document.querySelector('.watch-row .candidate-value').textContent.replaceAll(',',''))`;
    const showLiveWatch=async()=>{
      // The packaged UI deliberately stops live reads in hidden tabs. Bring it
      // forward so the assertion observes its normal refresh, not a stale cell
      // updated by the preceding writeComplete message.
      await session.activate(ui.page);
      await ui.wait(`document.visibilityState==='visible'`,'Packaged watch is visible');
      await delay(500);
      const value=await ui.evaluate(watchExpression);
      if(!Number.isFinite(value))throw new GameTestError('Visible packaged lives watch has no reliable numeric reading.');
      return value;
    };
    const naturalLives=async before=>{await click(570,453);return poll(()=>number('lives'),v=>v!==before,{timeout:75000,interval:500,description:'Undefended wave changes rendered lives',category:'automation'});};
    const roundEnded=()=>poll(async()=>{
      const d=await raw({left:484,top:442,width:149,height:34});
      return d.confidence>=75 && /start\s*round/i.test(d.text);
    },Boolean,{timeout:75000,interval:1000,description:'Rendered Start Round after undefended wave completes'});
    await step('lives:discovery',async()=>{const count=await ui.scan('exact',life);if(!count)throw new GameTestError('No lives candidates in live Ruffle source.','target-accessibility','UNSUPPORTED TARGET');return {value:life,count};});
    await step('lives:baseline',async()=>{const before=life;life=await naturalLives(life);await setPaused(true);life=await number('lives');return{before,after:life};});
    await step('lives:refine',async()=>{const count=await ui.scan('exact',life);if(count!==1)throw new GameTestError(`Lives refinement left ${count} candidates; no unique safely editable target.`);return{value:life,count};});
    await step('lives:undo-scan',async()=>{await ui.scan('exact',987654321);await ui.undoScan(1);return{restoredCandidates:1};});
    await step('lives:watch',async()=>{await ui.select(0);return{watches:(await ui.state()).watches};});
    await step('lives:write',async()=>{
      await ui.write(300);await setPaused(false);const after=await naturalLives(life);await setPaused(true);
      life=await number('lives');if(life<=100||life>=300)throw new GameTestError(`Lives edit did not affect subsequent losses: ${life}.`,'extension','FAIL');
      return{written:300,renderedAfterLoss:life,firstObserved:after,cachedHud:true};
    });
    await step('lives:guarded-undo',async()=>{await ui.restore({guarded:true});return{refusedAfterNaturalLoss:true};});
    await step('lives:undo',async()=>{
      const beforeRendered=life;
      let before;
      try{
        before=await showLiveWatch();
        await ui.write(400);
        await ui.wait(`${watchExpression}===400`,'Paused lives watch confirms edit');
        await ui.restore({guarded:false});
        await ui.wait(`${watchExpression}===${before}`,'Paused lives watch confirms exact restoration');
      }finally{await session.activate(gamePage);}
      await setPaused(false);await click(570,453);
      life=await poll(()=>number('lives'),value=>value!==beforeRendered && value<before && value>=before-20,{timeout:75000,interval:500,description:'Rendered lives show subsequent losses from the exactly restored balance'});
      await setPaused(true);
      return{beforeRendered,beforeWatch:before,restoredWatch:before,after:life,observedLoss:before-life};
    });
    await setPaused(false);await roundEnded();
    await step('lives:freeze',async()=>{
      await ui.freeze(300);await delay(350);await click(570,453);
      await poll(()=>number('lives'),v=>v===299,{timeout:75000,interval:500,description:'Frozen lives produce a visible loss receipt of 299'});
      // Switching to the controls tab intentionally stops production freezes
      // when the game becomes hidden. Keep the game visible and observe a
      // continuing undefended wave, its loss receipts, and its completion.
      const samples=[];const firstReceiptAt=Date.now();
      await poll(async()=>{
        const value=await number('lives');
        if(value!==299)throw new GameTestError(`Frozen lives changed during the undefended wave: ${value}.`,'extension','FAIL');
        const freezeActive=await ui.evaluate(`Array.from(document.querySelectorAll('[data-count]')).some(e=>Number(e.textContent)>0)`);
        if(!freezeActive)throw new GameTestError('Packaged controls report freeze stopped during the wave.','extension','FAIL');
        const visibility=await session.evaluate(page,'document.visibilityState');
        if(visibility!=='visible')throw new GameTestError('The live game became hidden during freeze verification.');
        const roundButton=await raw({left:484,top:442,width:149,height:34});
        const completed=roundButton.confidence>=75 && /start\s*round/i.test(roundButton.text);
        samples.push({elapsedMs:Date.now()-firstReceiptAt,value,freezeActive,completed,screenshot:roundButton.path});
        return completed;
      },Boolean,{timeout:75000,interval:500,description:'Visible undefended wave completes while freeze remains enabled'});
      const ongoing=samples.filter(sample=>!sample.completed);
      if(ongoing.length<3 || ongoing.at(-1).elapsedMs<1500)throw new GameTestError('The wave ended before multiple ongoing frozen-loss observations could be collected.');
      return{frozen:300,lossReceipt:299,completedUndefendedWave:true,freezeControlRemainedActive:true,samples};
    });
    await step('lives:stop',async()=>{await ui.stop();life=await naturalLives(299);if(life>=299)throw new GameTestError(`Lives did not resume decreasing after stop: ${life}.`,'extension','FAIL');return{after:life};});
    await runPauseCases({ui,read:()=>number('lives'),naturalChange:naturalLives,target:{scan:{type:'i32'},change:[{click:[570,453]}]},runStep:step,session,gamePage:page});
    await step('reopen',async()=>{const before=await ui.state();await session.closePage(ui.page);ui.page=await session.openControls(gamePage);await ui.wait(`document.querySelector('#quick-scan') && !document.querySelector('#quick-scan').disabled`,'Reopened controls connected');await ui.wait(`Number(document.querySelector('#advanced-watch-count').textContent)===${before.watches}`,'Live website watches survive reopening controls');return{watches:before.watches};});
    // Capture the rendered baseline while this paused game is visible: Chromium
    // cannot reliably screenshot a paused hidden surface. The actual write
    // still occurs with the unrelated tab active, as the binding test requires.
    await step('tab-binding',async()=>{const id=await ui.evaluate('new URLSearchParams(location.search).get("tabId")');await session.activate(gamePage);await setPaused(true);const before=await number('lives');const other=await session.newPage('about:blank');try{await session.activate(other);if(await ui.evaluate('new URLSearchParams(location.search).get("tabId")')!==id)throw new GameTestError('Controls lost original website tab binding.','extension','FAIL');await ui.wait(`Number(document.querySelector('#advanced-watch-count').textContent)>0`,'Original live game watch retained');await ui.write(500);await session.activate(gamePage);await setPaused(false);const after=await naturalLives(before);if(after<=400||after>=500)throw new GameTestError(`Write with another tab active did not affect original game: ${after}.`,'extension','FAIL');return{boundTab:id,writtenWithOtherTabActive:500,originalGameAfterLoss:after};}finally{await session.closePage(other);await session.activate(gamePage);}});
    await step('reload',async()=>{await session.navigate(gamePage,site.metadata.url);await ui.wait(`document.querySelector('#advanced-watch-count').textContent==='0' && document.querySelector('#quick-write').disabled`,'Website reload invalidates watches and writes');return{staleWatches:0,staleWritesDisabled:true};});
    await session.closePage(ui.page);
    return{targets:['cash','lives'],observations:'Rendered screenshot OCR and genuine economy/wave events'};
  }finally{await worker.close();}
}
