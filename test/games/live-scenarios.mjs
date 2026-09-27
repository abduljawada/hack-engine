import { join } from 'node:path';
import { runGame } from './scenarios.mjs';
import { GameUI } from './ui.mjs';
import { GameTestError, poll } from './observations.mjs';
import { SITE_STATE } from './sites.mjs';
import { runBloonsLive } from './bloons-live.mjs';
import { runCanabaltLive } from './canabalt-live.mjs';
import { runXenoLive } from './xeno-live.mjs';
import { runCubeLive } from './cube-live.mjs';
import { runChibiLive } from './chibi-live.mjs';

const paused=s=>s?.player?.suspended ?? (typeof s?.player?.isPlaying==='boolean'?!s.player.isPlaying:null);
export async function runLiveGame({session,game,gamePage,site,controls,baseline,artifactDir,step=async(_n,fn)=>fn()}) {
  await step('runtime-detection',async()=>site.metadata);
  if(game.id==='J1'||game.id==='W1')return runGame({session,game,asset:{},gamePage:site.playPage,controls,baseline,artifactDir,step});
  if(site.runtime==='ruffle'){
    await step('flash-load',async()=>{
      await session.flushResources?.();
      const swfs=(session.resources||[]).filter(r=>/\.swf(?:[?#]|$)/i.test(r.url));
      const primary=swfs.find(r=>site.metadata.playUrl.includes(encodeURIComponent(r.url)) || site.metadata.playUrl.includes(r.url));
      const runtimeWasm=(session.resources||[]).filter(r=>/\.wasm(?:[?#]|$)/i.test(r.url) && new URL(r.url).origin===new URL(site.metadata.playUrl).origin);
      if(primary?.independentlyParsedAvm && primary.independentlyParsedAvm!==site.runtimeDetails.avm)throw new GameTestError(`Website Ruffle reports ${site.runtimeDetails.avm}; independently parsed loaded SWF reports ${primary.independentlyParsedAvm}.`,'baseline','FAIL');
      return {runtime:site.runtimeDetails,loadedSwfs:swfs,primarySwf:primary??null,runtimeWasm,independentlyParsedAvm:primary?.independentlyParsedAvm??null,coverage:'Website runtime loaded; gameplay qualification is separate.'};
    });
    if(!baseline){
      const ui=new GameUI(session,controls);
      await step('flash-source-runtime',async()=>{
        const source=await ui.ready({javascript:false,type:'smart'});
        const avm=site.runtimeDetails.avm;
        await ui.wait(`document.querySelector('#advanced-avm-type').textContent===${JSON.stringify(avm)}`,'Extension source matches website public Ruffle metadata');
        return {source,displayedAvm:avm};
      });
      await step('flash-manual-pause',async()=>{
        const before=await session.evaluate(site.playPage,SITE_STATE);
        if(paused(before)!==false)throw new GameTestError('Website runtime has no observable active playback state.');
        let didPause=false;
        try{
          await ui.click('#pause-game');didPause=true;
          await ui.wait(`document.querySelector('#pause-game').getAttribute('aria-pressed')==='true'`,'Website pause control updates');
          await poll(()=>session.evaluate(site.playPage,SITE_STATE),s=>paused(s)===true,{description:'Website runtime suspended by packaged controls',category:'extension',status:'FAIL'});
          await ui.click('#pause-game');didPause=false;
          await ui.wait(`document.querySelector('#pause-game').getAttribute('aria-pressed')==='false'`,'Website resume control updates');
          await poll(()=>session.evaluate(site.playPage,SITE_STATE),s=>paused(s)===false,{description:'Website runtime resumes through packaged controls',category:'extension',status:'FAIL'});
          await session.screenshot(gamePage,join(artifactDir,'website-extension-resumed.png'));
          return {publicApiConfirmedPause:true,publicApiConfirmedResume:true};
        }finally{if(didPause)await ui.click('#pause-game').catch(()=>{});}
      });
    }
  }
  if(game.id==='F1')return runChibiLive({session,site,artifactDir,step});
  if(game.id==='F3' && site.runtime==='ruffle')return runCubeLive({session,site,artifactDir,step});
  if(game.id==='F2')return runXenoLive({session,game,gamePage,site,controls,baseline,artifactDir,step});
  if(game.id==='F6')return runCanabaltLive({session,game,gamePage,site,controls,baseline,artifactDir,step});
  if(game.id==='F4' && site.runtime==='ruffle')return runBloonsLive({session,gamePage,site,controls,baseline,artifactDir,step});
  throw Object.assign(new GameTestError(`${game.name}: the live website loaded ${site.runtime}${site.runtimeDetails.avm?' '+site.runtimeDetails.avm:''}, but its full rendered-counter gameplay recipe is not qualified. No local game files are required.`),{code:'MISSING_RECIPE'});
}
