import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {createOcrClient} from './ocr-client.mjs';
import {GameTestError,delay,poll} from './observations.mjs';

// Visual stage coordinates, with no private game values or persisted addresses.
export async function runChibiLive({session,site,artifactDir,step}) {
  const page=site.playPage;
  const size=await session.evaluate(page,'({width:innerWidth,height:innerHeight})');
  if(size.width!==640||size.height!==480)throw new GameTestError(`Chibi Knight stage changed to ${size.width}×${size.height}; input and reading regions need qualification.`);
  const ocr=await createOcrClient({cachePath:artifactDir,langPath:process.env.GAME_OCR_LANG_PATH});
  let sequence=0;
  const screenshot=async label=>{const path=join(artifactDir,`chibi-${++sequence}-${label}.png`);await session.screenshot(page,path);return path;};
  const hold=async(key,ms)=>{await session.key(page,key,{type:'down'});try{await delay(ms);}finally{await session.key(page,key,{type:'up'});}};
  try {
    await step('chibi-start',async()=>{
      const title=await poll(async()=>{
        const path=await screenshot('launcher');
        const title=await ocr.recognize(path,{left:175,top:192,width:300,height:52});
        if(title.confidence>=60&&/PRESSSTART/i.test(title.text.replace(/[^a-z]/gi,'')))return {path,title,ready:true};
        const preload=await ocr.recognize(path,{left:160,top:416,width:325,height:60});
        if(/CLICK/i.test(preload.text))await session.click(page,320,450);
        return {path,title,preload,ready:false};
      },value=>value?.ready,{timeout:90000,interval:1000,description:'Rendered Chibi Knight Press Start title',category:'automation'});
      await session.key(page,'a');await delay(2500);
      return {title,input:'A on rendered Press Start',screenshot:await screenshot('started')};
    });
    await step('chibi-movement',async()=>{
      const before=await screenshot('before-input');
      await hold('ArrowDown',6000);await delay(1500);
      await hold('ArrowLeft',1600);await delay(2500);
      await session.key(page,'a');await delay(500);
      return {before,after:await screenshot('after-input'),input:'Down, Left and A through browser keyboard input',coverage:'Gameplay input and screenshots; this does not establish health or experience changes.'};
    });
    await step('baseline',async()=>{
      const path=await screenshot('counter-inspection');
      const reading=await ocr.recognize(path,{left:0,top:0,width:640,height:85});
      await writeFile(join(artifactDir,'chibi-counter-observations.json'),JSON.stringify({path,reading,targets:['Health','Experience'],qualified:false},null,2));
      throw new GameTestError(`Chibi Knight received real start, movement and attack input, but this route does not yet provide qualified health and experience readings. HUD diagnostic OCR: ${JSON.stringify(reading.text.trim())} at ${reading.confidence}%. Counter screenshots are retained; no values are guessed or written.`, 'automation','BLOCKED');
    });
  } finally {await ocr.close();}
}
