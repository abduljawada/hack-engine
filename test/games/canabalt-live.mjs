import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GameUI } from './ui.mjs';
import { createOcrClient } from './ocr-client.mjs';
import { GameTestError, delay, poll } from './observations.mjs';

// Only pixels from a browser screenshot are enlarged. No game object, memory or
// hidden state is read. Nearest-neighbor scaling preserves this game's bitmap font.
async function distanceImage(session, page, path) {
  await session.screenshot(page, path);
  const png = (await readFile(path)).toString('base64');
  const scaled = await session.evaluate(page, `(async () => {
    const bytes=Uint8Array.from(atob(${JSON.stringify(png)}), c=>c.charCodeAt(0));
    const image=await createImageBitmap(new Blob([bytes], {type:'image/png'}));
    const width=Math.min(180,image.width),height=Math.min(25,image.height);
    const canvas=new OffscreenCanvas(width*4+24,height*4+24),ctx=canvas.getContext('2d');
    ctx.fillStyle='black';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(image,image.width-width,0,width,height,12,12,width*4,height*4);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    for(let i=0;i<pixels.data.length;i+=4){
      const white=pixels.data[i]>230&&pixels.data[i+1]>230&&pixels.data[i+2]>230;
      pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=white?0:255;pixels.data[i+3]=255;
    }
    ctx.putImageData(pixels,0,0);
    image.close();
    const blob=await canvas.convertToBlob({type:'image/png'});
    return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(blob);});
  })()`);
  const enlarged = path.replace(/\.png$/, '-distance.png');
  await writeFile(enlarged, Buffer.from(scaled, 'base64'));
  return enlarged;
}

export async function runCanabaltLive({session,gamePage,site,controls,baseline,artifactDir,step=async(_name,run)=>run()}) {
  const page=site.playPage;
  if(site.runtime!=='javascript')throw new GameTestError('This Canabalt website recipe requires the observed Haxe/HTML5 version.');
  await step('canabalt-start',async()=>{
    await poll(()=>session.evaluate(page,`(globalThis.__gameRenderedText||[]).some(s=>s.text==='Play Canabalt')`),Boolean,
      {timeout:60000,description:'Rendered Play Canabalt startup control',category:'baseline'});
    const canvas=await session.evaluate(page,`document.querySelector('canvas').getBoundingClientRect().toJSON()`);
    await session.click(page,canvas.x+canvas.width/2,canvas.y+canvas.height/2);
    await delay(1800);
    await session.key(page,'Space');
    await delay(1800);
    await session.screenshot(page,join(artifactDir,'canabalt-started.png'));
    return {input:'Pointer click on Play Canabalt followed by Space',runtime:site.runtime};
  });
  let inspected=[];
  if(!baseline)await step('canabalt-source-inspection',async()=>{
    const ui=new GameUI(session,controls);
    await ui.ready({javascript:true,type:'number'});
    const sources=await ui.evaluate(`Array.from(document.querySelector('#advanced-instance').options,o=>({text:o.textContent,value:o.value})).filter(o=>o.text.includes('JavaScript'))`);
    inspected=[];
    for(const source of sources){
      await ui.set('#advanced-instance',source.value);
      await ui.set('#advanced-type','number');
      await ui.click('#javascript-load-roots');
      await ui.wait(`!document.querySelector('#javascript-load-roots').disabled`,'JavaScript roots loaded');
      const roots=await ui.evaluate(`Array.from(document.querySelector('#javascript-root').options,o=>({text:o.textContent,value:o.value}))`);
      inspected.push({source,roots});
    }
    await writeFile(join(artifactDir,'canabalt-javascript-roots.json'),JSON.stringify(inspected,null,2));
    await session.screenshot(controls,join(artifactDir,'canabalt-javascript-roots.png')).catch(error => writeFile(join(artifactDir,'canabalt-controls-screenshot-unavailable.json'),JSON.stringify({browser:session.browser,reason:error.message,evidence:'Packaged source and root DOM observations remain in canabalt-javascript-roots.json.'},null,2)));
    return inspected;
  });
  let ocr;
  try { ocr=await createOcrClient({cachePath:artifactDir,langPath:process.env.GAME_OCR_LANG_PATH}); }
  catch(error){throw new GameTestError(`Canabalt screenshot OCR unavailable: ${error.message}`);}
  let sequence=0;
  const readDistance=async({start=false}={})=>{
    const result=await poll(async()=>{
      const path=await distanceImage(session,page,join(artifactDir,`canabalt-${++sequence}.png`));
      const reading=await ocr.recognize(path,{left:0,top:0,width:744,height:124});
      const match=reading.text.trim().match(/^(\d+)\s*m$/i);
      if(start&&(!match||reading.confidence<80))await session.key(page,'x');
      return {value:match&&reading.confidence>=80?Number(match[1]):null,...reading,path};
    },reading=>reading.value!==null,{timeout:30000,interval:500,description:'Reliable rendered Canabalt distance (80% OCR confidence)'});
    return result.value;
  };
  try {
    const distance=await step('baseline',async()=>{
      const before=await readDistance({start:true});
      let after=before;
      for(let attempt=0;attempt<5&&after<=before;attempt++){
        await session.key(page,'Space');await delay(1000);after=await readDistance();
      }
      if(after<=before)throw new GameTestError(`Canabalt distance did not increase after gameplay jump input (${before}m to ${after}m).`,'baseline');
      await session.screenshot(page,join(artifactDir,'canabalt-playing.png'));
      return {before,after,observed:'Distance counter in rendered game screenshot',input:'Space jumps'};
    });
    if(baseline)return;
    await step('discovery',async()=>{
      const ui=new GameUI(session,controls);
      // Identify the game source by its Haxe/Lime runtime root, not option order
      // (which changes when the publisher's advertising frames load).
      const gameSources=inspected.filter(item=>item.roots.some(root=>root.text==='lime'));
      const findings=[];
      for(const {source,roots} of gameSources){
        await ui.set('#advanced-instance',source.value);
        await ui.set('#advanced-type','number');
        await ui.click('#javascript-load-roots');
        await ui.wait(`!document.querySelector('#javascript-load-roots').disabled`,'Game source roots loaded');
        const candidates=roots.filter(root=>root.value&&/lime|flixel|openfl|canabalt|game/i.test(root.text)&&!root.text.includes('__gameRenderedText'));
        for(const root of candidates){
          await ui.set('#javascript-root',root.value);
          let count;let inaccessibleReason;
          try { count=await ui.scan('unknown'); }
          catch(error){if(!error.message.includes('No accessible numeric state found'))throw error;count=0;inaccessibleReason=error.message;}
          const finding={source:source.text,root:root.text,count,inaccessibleReason,candidates:await ui.candidates()};
          if(count){
            await session.key(page,'Space');await delay(1200);
            finding.changed=await ui.scan('changed');
            finding.changedCandidates=await ui.candidates();
          }
          findings.push(finding);if(await ui.evaluate(`!document.querySelector('#reset-advanced-scan').disabled`))await ui.reset();
        }
      }
      await session.screenshot(controls,join(artifactDir,'canabalt-javascript-roots.png')).catch(error => writeFile(join(artifactDir,'canabalt-controls-screenshot-unavailable.json'),JSON.stringify({browser:session.browser,reason:error.message,evidence:'Packaged source and root DOM observations remain in canabalt-javascript-roots.json.'},null,2)));
      await writeFile(join(artifactDir,'canabalt-target-discovery.json'),JSON.stringify({inspected,findings,distance},null,2));
      // Never count the observer's recorded numbers as editable game state.
      throw new GameTestError(`Canabalt played on its actual website (${distance.before}m to ${distance.after}m). Its Haxe game state is not yet qualified through the packaged JavaScript roots. Inspected roots: ${gameSources.flatMap(item=>item.roots.map(root=>root.text)).join(', ')||'No exposed Haxe/Lime game root'}. Scan evidence saved in canabalt-target-discovery.json; no memory writes were attempted.`,
        findings.some(item=>item.changed>0)?'automation':'target-accessibility','BLOCKED');
    });
  }finally{await ocr.close();}
}
