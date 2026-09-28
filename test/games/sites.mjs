import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GameTestError, delay, poll, readRenderedValue } from './observations.mjs';

const visibleHelpers = `
  const visible = e => {
    if (!e) return false;
    const r=e.getBoundingClientRect(), s=getComputedStyle(e);
    return r.width>1 && r.height>1 && s.display!=='none' && s.visibility!=='hidden' && s.visibility!=='collapse' && s.opacity!=='0';
  };
  const launcher = kind => {
    if (kind==='flash') return [...document.querySelectorAll('#startFlashBtn')].find(visible);
    if (kind==='html5') return [...document.querySelectorAll('#barrier_close_btn')].find(visible);
    if (kind==='portal') return [...document.querySelectorAll('button,a,[role="button"]')].find(e => visible(e) && /^play now$/i.test((e.innerText || e.getAttribute('aria-label') || '').trim()));
    return [...document.querySelectorAll('ruffle-player,ruffle-embed,ruffle-object')].find(visible);
  };`;

// Inspect public player metadata and rendered DOM, never game state or memory.
export const SITE_STATE = `(() => {
  ${visibleHelpers}
  const player = launcher('player');
  const api = player && (typeof player.ruffle === 'function' ? player.ruffle(1) : player);
  const metadata = api?.metadata ?? player?.metadata;
  const rect = player?.getBoundingClientRect();
  const canvases = Array.from(document.querySelectorAll('canvas')).filter(visible).map(e => ({width:e.width,height:e.height,rect:e.getBoundingClientRect().toJSON()}));
  const box = kind => launcher(kind)?.getBoundingClientRect().toJSON() ?? null;
  return {url:location.href,title:document.title,text:document.body?.innerText?.slice(0,5000),
    player:player ? {tag:player.tagName,rect:rect.toJSON(),metadata:metadata ? {width:metadata.width,height:metadata.height,frameRate:metadata.frameRate,isActionScript3:metadata.isActionScript3}:null,
      suspended:typeof api.suspended==='boolean'?api.suspended:null,isPlaying:typeof api.isPlaying==='boolean'?api.isPlaying:null}:null,
    html5Start:box('html5'),startButton:box('flash'),portalStart:box('portal'),canvases,scripts:Array.from(document.scripts,e=>e.src).filter(Boolean)};
})()`;

// Scrolling the actual DOM element also scrolls its containing iframe into view.
// The click itself is always browser pointer input, never a DOM click or player API.
export const siteInputTarget = kind => `(() => { ${visibleHelpers}
  const e=launcher(${JSON.stringify(kind)}); if(!e) return null;
  e.scrollIntoView({block:'center',inline:'center'});
  return e.getBoundingClientRect().toJSON();
})()`;

export async function observeWebsiteRuntime({session,page,game,state}) {
  if (['J1','W1'].includes(game.id)) await poll(
    () => readRenderedValue(session,page,game.id), Number.isFinite,
    {timeout:30000,interval:100,description:'Rendered game HUD before runtime classification',category:'baseline'},
  );
  const frameId=page.context||page.frameId||page.targetId;
  const observedWasm=()=> (session.resources||[]).filter(r=>r.context===frameId && r.status>=200 && r.status<400 &&
    (/\.wasm(?:[?#]|$)/i.test(r.url)||r.mimeType==='application/wasm'));
  // A canvas can exist before its module response or the first rendered frame.
  // Require the observed response, rather than inferring JavaScript from a race.
  const loadedWasm=game.id==='W1' ? await poll(observedWasm,items=>items.length>0,
    {timeout:20000,interval:100,description:'Game frame WebAssembly response observed',category:'baseline'}) : observedWasm();
  return {runtime:state.player?'ruffle':loadedWasm.length?'wasm':'javascript',loadedWasm};
}

export async function prepareLiveSite({session,game,gamePage,artifactDir,step=async(_n,fn)=>fn()}) {
  await mkdir(artifactDir,{recursive:true});
  return step('website-load',async()=>{
    let found;
    const seen = new Map();
    const inputs = new Map();
    const launchInputs = [];
    const observe = async (awaitPlayer = false) => {
      // Launch controls can replace the iframe; resolve fresh handles every time.
      const handles=[gamePage,...await session.frames(gamePage)];
      for(const page of handles){
        if(page.accessible===false)continue;
        try{
          const state=await session.evaluate(page,SITE_STATE);
          seen.set(`${page.context||page.frameId||page.targetId}:${state.url}`,state);
          if(state.player?.metadata){found={page,state};return true;}
          const kind=state.html5Start?'html5':state.startButton?'flash':state.portalStart?'portal':state.player&&!state.player.metadata?'player':null;
          if(kind){
            const key=`${page.context||page.frameId||page.targetId}:${state.url}:${kind}`;
            const previous=inputs.get(key);
            // Portals can render Play before their event handlers finish loading.
            // Retry only that still-visible launcher, at most three real clicks.
            if(!previous || (kind!=='player' && previous.count<3 && Date.now()-previous.at>4000)){
              const r=await session.evaluate(page,siteInputTarget(kind));
              if(r?.width>1 && r?.height>1){
                await session.click(page,r.x+r.width/2,r.y+r.height/2);
                inputs.set(key,{count:(previous?.count||0)+1,at:Date.now()});
                launchInputs.push({kind,url:state.url,x:r.x+r.width/2,y:r.y+r.height/2,time:new Date().toISOString()});
              }
            }
            if(!awaitPlayer && (kind==='flash'||kind==='player')){found={page,state};return true;}
            continue;
          }
          if(!awaitPlayer && state.canvases.some(c=>c.rect.width>=250&&c.rect.height>=150)){
            found={page,state}; return true;
          }
        }catch(error){seen.set(`${page.context||page.frameId||page.targetId}:${page.url}`,{url:page.url,error:error.message});}
      }
      return false;
    };
    try{
      await poll(()=>observe(),Boolean,{timeout:30000,interval:500,description:'Playable website frame or canvas',category:'baseline'});
      if(found.state.startButton || (found.state.player && !found.state.player.metadata)){
        await poll(()=>observe(true),Boolean,{timeout:45000,interval:500,description:'Website Ruffle game loads after Play input',category:'baseline'});
      }
    }catch(error){
      const screenshot=join(artifactDir,'website-unavailable.png');
      await session.screenshot(gamePage,screenshot).catch(()=>{});
      const observations=join(artifactDir,'website-observations.json');
      await writeFile(observations,JSON.stringify({documents:[...seen.values()],launchInputs},null,2));
      const summary=[...seen.values()].map(state=>{
        let url=state.url;try{const parsed=new URL(url);url=parsed.origin+parsed.pathname;}catch{}
        return {url,title:state.title,player:Boolean(state.player),startControl:Boolean(state.startButton||state.html5Start||state.portalStart),error:state.error};
      });
      throw new GameTestError(`${error.message}. Website documents: ${JSON.stringify(summary).slice(0,1200)}. Evidence: ${observations}`,'baseline');
    }
    const {page:playPage,state}=found;
    await delay(1000);
    const {runtime,loadedWasm}=await observeWebsiteRuntime({session,page:playPage,game,state});
    const screenshot=join(artifactDir,'website-loaded.png');
    await session.screenshot(gamePage,screenshot);
    const metadata={launchInputs,url:await session.evaluate(gamePage,'location.href'),playUrl:state.url,runtime,
      runtimeDetails:{metadata:state.player?.metadata??null,avm:state.player?.metadata ? (state.player.metadata.isActionScript3?'AVM2':'AVM1'):null,
        publicPlayer:state.player?.tag??null,scripts:state.scripts,wasmResources:loadedWasm.map(r=>({url:r.url,status:r.status,mimeType:r.mimeType}))},
      frameCount:(await session.frames(gamePage)).length,screenshot};
    return {topPage:gamePage,playPage,runtime,runtimeDetails:metadata.runtimeDetails,metadata};
  });
}
