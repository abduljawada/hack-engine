import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { SITE_STATE, siteInputTarget, observeWebsiteRuntime } from './games/sites.mjs';
function element({width=100,height=40,display='block',visibility='visible',opacity='1',text=''}={}) {
  const e={style:{display,visibility,opacity},innerText:text,tagName:'BUTTON',getAttribute:()=>null};
  e.getBoundingClientRect=()=>({x:0,y:e.scrolled?100:1200,width,height,toJSON(){return {x:this.x,y:this.y,width,height};}});
  e.scrollIntoView=()=>{e.scrolled=true;};return e;
}
function context(selectors) {
  return {location:{href:'https://portal.test/game'},getComputedStyle:e=>e.style,document:{title:'game',body:{innerText:''},scripts:[],querySelectorAll:selector=>selectors[selector]||[]}};
}
test('website launch detection excludes hidden and zero-size Flash and HTML5 controls',()=>{
  const hidden=element({display:'none'}),zero=element({width:0,height:0}),visible=element();
  const state=vm.runInNewContext(SITE_STATE,context({'#startFlashBtn':[hidden,zero,visible],'#barrier_close_btn':[hidden,zero]}));
  assert.equal(state.startButton.width,100);assert.equal(state.html5Start,null);
  assert.equal(vm.runInNewContext(SITE_STATE,context({'#startFlashBtn':[hidden,zero]})).startButton,null);
});
test('portal Play Now discovery only chooses a visible exact-label control',()=>{
  const ctx=context({'button,a,[role="button"]':[element({text:'Play Now',display:'none'}),element({text:'Play Now ads'}),element({text:'Play Now'})]});
  assert.equal(vm.runInNewContext(SITE_STATE,ctx).portalStart.width,100);
});
test('website pointer target is measured after scrolling the actual launcher into view',()=>{
  const button=element();const result=vm.runInNewContext(siteInputTarget('flash'),context({'#startFlashBtn':[button]}));
  assert.equal(button.scrolled,true);assert.equal(result.y,100);
});

test('website preparation reacquires a replaced game iframe after Play',async t=>{
  const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {prepareLiveSite}=await import('./games/sites.mjs');
  const dir=await mkdtemp(join(tmpdir(),'game-site-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const top={context:'top'},oldFrame={context:'old'},newFrame={context:'new'};let clicked=false;const inputs=[];
  const empty={url:'https://portal.test',canvases:[],scripts:[]};
  const session={resources:[],frames:async()=>[clicked?newFrame:oldFrame],screenshot:async()=>{},
    async click(page,x,y){inputs.push({context:page.context,x,y});clicked=true;},
    async evaluate(page,expression){
      if(expression==='location.href')return empty.url;
      if(expression!==SITE_STATE)return {x:10,y:100,width:80,height:40};
      if(page===top)return empty;
      if(page===oldFrame)return {...empty,url:'https://frame.test/launch',startButton:{x:10,y:1500,width:80,height:40}};
      return {...empty,url:'https://frame.test/loaded',player:{tag:'RUFFLE-PLAYER',metadata:{width:640,height:480,isActionScript3:false}}};
    }};
  const site=await prepareLiveSite({session,game:{id:'F1'},gamePage:top,artifactDir:dir});
  assert.equal(site.playPage,newFrame);assert.equal(site.runtime,'ruffle');assert.deepEqual(inputs,[{context:'old',x:50,y:120}]);
});


test('Breakout runtime waits for its delayed Wasm response after a rendered HUD',async()=>{
  let resourceReads=0,hudReads=0;
  const wasm={context:'game-frame',url:'https://game.test/game.wasm',status:200,mimeType:'application/wasm'};
  const session={evaluate:async()=>{hudReads++;return [{text:'Score: 0 Lives: 5'}];},
    get resources(){resourceReads++;return resourceReads<3?[]:[wasm];}};
  const observed=await observeWebsiteRuntime({session,page:{context:'game-frame'},game:{id:'W1'},state:{}});
  assert.equal(observed.runtime,'wasm');assert.equal(hudReads,1);assert.equal(resourceReads,3);
});
test('an advertising frame Wasm response cannot classify a JavaScript game',async()=>{
  const session={resources:[{context:'advertisement',url:'https://ads.test/ad.wasm',status:200,mimeType:'application/wasm'}]};
  const observed=await observeWebsiteRuntime({session,page:{frameId:'actual-game'},game:{id:'F6'},state:{}});
  assert.equal(observed.runtime,'javascript');assert.equal(observed.loadedWasm.length,0);
});
