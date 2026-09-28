import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {createOcrClient} from './ocr-client.mjs';
import {GameUI} from './ui.mjs';
import {GameTestError,delay,poll} from './observations.mjs';

// The site's original 640×480 stage exposes Gold numerically, but Shield is a
// segmented meter. Coordinates are visible controls, never stored addresses.
export async function runXenoLive({session,gamePage,site,controls,baseline,artifactDir,step}) {
  const page=site.playPage;
  const size=await session.evaluate(page,'({width:innerWidth,height:innerHeight})');
  if(size.width!==640||size.height!==480)throw new GameTestError(`Xeno's ${size.width}×${size.height} stage does not match its qualified 640×480 input/counter regions.`);
  const ocr=await createOcrClient({cachePath:artifactDir,langPath:process.env.GAME_OCR_LANG_PATH});
  let sequence=0;
  const click=async(x,y)=>{await session.click(page,x,y);await delay(600);};
  const gold=async()=>{
    const screenshot=join(artifactDir,`xeno-gold-${++sequence}.png`);
    await session.screenshot(page,screenshot);
    const reading=await ocr.recognize(screenshot,{left:265,top:426,width:65,height:18});
    const match=reading.text.trim().match(/^GOLD\s*([\d,]+)$/i);
    return {...reading,screenshot,value:match&&reading.confidence>=85?Number(match[1].replaceAll(',','')):null};
  };
  let economy;
  try {
    await step('game-start',async()=>{
      await click(600,22); // Visible close control for the optional Ruffle notice.
      await poll(async()=>{
        const reading=await gold();
        // This checks only that the mission HUD exists; numeric acceptance
        // remains separately gated on confidence below.
        if(/^GOLD\s*[\d,]+$/i.test(reading.text.trim()))return reading;
        await click(320,248); // New Game.
        await click(274,152); // Confirm in this disposable profile.
        await click(113,145); // Mission 1.
        return null;
      },Boolean,{timeout:90000,interval:1500,description:'Rendered Xeno mission Gold HUD after menu input',category:'baseline'});
      return {mission:1,inputs:'New Game, Yes, Mission 1',shieldDisplay:'Segmented Shield meter; no numeric lives HUD'};
    });
    await step('baseline',async()=>{
      const before=await gold();
      await click(30,420); // First ground turret, displayed price 30.
      await click(177,142); // Buildable mission-1 tile.
      const after=await gold();
      economy={before,after,input:'Select first ground turret and place on mission 1'};
      await writeFile(join(artifactDir,'xeno-economy-observations.json'),JSON.stringify(economy,null,2));
      if(before.value===null||after.value===null)throw new GameTestError(
        `Xeno mission 1 is playable and turret purchase input was exercised, but its tiny Gold HUD is not reliably readable: ${JSON.stringify(before.text.trim())} (${before.confidence}%) to ${JSON.stringify(after.text.trim())} (${after.confidence}%). Numeric readings require 85%; screenshots and input observations are retained.`,
        'automation');
      if(after.value!==before.value-30)throw new GameTestError(`Xeno purchase arithmetic was not isolated: ${before.value} to ${after.value}; expected the displayed turret price of 30. Automatic waves may change income.`, 'automation');
      return economy;
    });
    if(!baseline){
      const ui=new GameUI(session,controls);
      await step('discovery',async()=>{
        await ui.ready({type:'i32'});
        const current=await gold();
        if(current.value===null)throw new GameTestError(`Xeno Gold OCR became unreliable before scanning (${current.confidence}%); no guessed number was scanned.`);
        const count=await ui.scan('exact',current.value);
        if(!count)throw new GameTestError('No exact Gold matches in the discovered website Ruffle source.','target-accessibility','UNSUPPORTED TARGET');
        return {value:current.value,count};
      });
    }
    // A segmented Shield bar cannot be silently substituted for an exact lives
    // value, and initial money matches alone do not demonstrate editable state.
    throw new GameTestError('Xeno reached mission 1 and verified a Gold purchase. Shield/lives has no numeric HUD, and a reliable meter observation plus full money refinement/edit/freeze workflow is not yet qualified.');
  } finally {await ocr.close();}
}
