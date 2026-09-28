import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createOcrClient } from './ocr-client.mjs';
import { GameTestError, delay, poll } from './observations.mjs';

// This route is observed in the site's original 550x550 AVM1 game. Actions are
// pointer/keyboard input only; no Flash display-list or private state is read.
export async function runCubeLive({session,site,artifactDir,step=async(_name,run)=>run()}) {
  const page=site.playPage;
  if(site.runtime!=='ruffle'||site.runtimeDetails.metadata?.width!==550||site.runtimeDetails.metadata?.height!==550){
    throw new GameTestError('Cube Colossus website no longer presents the observed 550x550 Ruffle game.');
  }
  const evidence=[];
  const shot=async(name)=>{
    const path=join(artifactDir,`${name}.png`);await session.screenshot(page,path);evidence.push(path);return path;
  };
  const waitCue=async(name,rectangle,pattern,onMiss)=>{
    let observer;
    try{
      observer=await createOcrClient({cachePath:artifactDir,langPath:process.env.GAME_OCR_LANG_PATH});
      let sequence=0;
      return await poll(async()=>{
        const path=await shot(`${name}-${++sequence}`);
        const reading={...await observer.recognize(path,rectangle),path};
        if(!(reading.confidence>=60&&pattern.test(reading.text)))await onMiss?.();
        return reading;
      },reading=>reading.confidence>=60&&pattern.test(reading.text),
      {timeout:30000,interval:500,description:`Cube Colossus visible ${name}`,category:'automation'});
    }catch(error){
      if(error instanceof GameTestError)throw error;
      throw new GameTestError(`Cube Colossus ${name} screenshot observation unavailable: ${error.message}`);
    }finally{await observer?.close();}
  };
  await step('cube-start-inputs',async()=>{
    const close=await session.evaluate(page,`(()=>{
      const root=document.querySelector('ruffle-player,ruffle-embed,ruffle-object')?.shadowRoot;
      const e=root?.querySelector('#hardware-acceleration-modal:not(.hidden) .close-modal');
      const r=e?.getBoundingClientRect();return r&&r.width>0&&r.height>0?r.toJSON():null;
    })()`);
    if(close)await session.click(page,close.x+close.width/2,close.y+close.height/2);
    await delay(2000);
    await session.click(page,275,512); // Loading screen's PLAY.
    await delay(1500);await shot('cube-publisher-intro');
    await waitCue('cube-main-menu',{left:210,top:262,width:135,height:42},/\bPLAY\b/i);
    await session.click(page,275,284); // Main menu PLAY.
    await delay(2500);await shot('cube-story');
    await session.click(page,497,536); // Visible "click to skip" cutscene control.
    await delay(1500);await shot('cube-chapter');
    await session.click(page,510,532); // Chapter's continue arrow.
    await delay(2500);await session.key(page,'Space'); // "SPACE to skip event".
    await delay(2000);await shot('cube-controls');
    await waitCue('cube-control-instructions',{left:212,top:479,width:139,height:39},/UNDERSTOOD/i,async()=>{
      await session.key(page,'Space');await session.click(page,510,532);
    });
    await session.click(page,280,499); // Control instruction: UNDERSTOOD.
    await delay(2000);
    return {inputs:'Play, story skip, chapter continue, Space event skip, Understood',evidence:[...evidence],coverage:'Input sequence only; numeric targets still require validation'};
  });
  await step('cube-battle-visible',async()=>{
    let observer;
    try{
      observer=await createOcrClient({cachePath:artifactDir,langPath:process.env.GAME_OCR_LANG_PATH});
      let sequence=0;
      return await poll(async()=>{
        const path=await shot(`cube-battle-confirm-${++sequence}`);
        const reading=await observer.recognize(path,{left:412,top:2,width:133,height:22});
        return {...reading,path};
      },reading=>reading.confidence>=60&&/\bdamag[ew]\s+chain\b/i.test(reading.text),
        {timeout:15000,interval:500,description:'Cube Colossus battle HUD label Damage Chain',category:'automation'});
    }catch(error){throw new GameTestError(`Could not confirm Cube Colossus reached its battle screen in this run: ${error.message}`);}
    finally{await observer?.close();}
  });
  const before=await shot('cube-before-battle-input');
  await step('cube-battle-inputs',async()=>{
    for(let index=0;index<14;index++){
      await session.click(page,200+(index%3)*70,340+(index%2)*60);
      await session.key(page,'w');await delay(120);
    }
    return {input:'14 pointer movement/shooting clicks and W target changes',screenshot:await shot('cube-after-battle-input')};
  });
  await step('baseline',async()=>{
    let ocr;
    const readings=[];
    let observationError;
    try{
      ocr=await createOcrClient({cachePath:artifactDir,langPath:process.env.GAME_OCR_LANG_PATH});
      // Diagnostic numeric field only. Damage Chain is not relabelled as heat
      // or upgrade currency, and cannot satisfy either requested target.
      for(const path of [before,evidence.at(-1)]){
        readings.push({path,target:'Damage Chain (diagnostic only)',...await ocr.recognize(path,{left:480,top:24,width:65,height:20})});
      }
    }catch(error){observationError=error.message;}
    finally{await ocr?.close();}
    await writeFile(join(artifactDir,'cube-observations.json'),JSON.stringify({evidence,readings,observationError,
      requestedTargets:['Heat','Upgrade currency'],qualified:false},null,2));
    throw new GameTestError(`Cube Colossus's live battle HUD was confirmed by its rendered Damage Chain label, then movement, shooting and targeting inputs were exercised. Requested heat and upgrade currency could not be verified as numeric counters on this combat route. Diagnostic Damage Chain OCR: ${readings.map(r=>`${JSON.stringify(r.text.trim())} at ${r.confidence}%`).join('; ')||observationError}. Screenshots and cube-observations.json preserve the result.`, 'automation','BLOCKED');
  });
}
