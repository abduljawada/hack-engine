import { GameUI } from './ui.mjs';
import { GameTestError, poll, readRenderedValue, delay } from './observations.mjs';

async function selectScore(session, controls) {
  const ui = new GameUI(session, controls);
  await ui.wait(`document.querySelector('#quick-scan') && !document.querySelector('#quick-scan').disabled`, 'Frame connection');
  await ui.click('[data-view="advanced"]');
  const sources = await ui.evaluate(`Array.from(document.querySelector('#advanced-instance').options,o=>({value:o.value,text:o.textContent})).filter(o=>o.text.includes('JavaScript'))`);
  for (const source of sources) {
    await ui.set('#advanced-instance', source.value);
    await ui.set('#advanced-type', 'number');
    await ui.click('#javascript-load-roots');
    await ui.wait(`!document.querySelector('#javascript-load-roots').disabled`, 'Frame root discovery');
    // Discovery is asynchronous; wait for either a root list or its empty-state status.
    await delay(250);
    const hasGame = await ui.evaluate(`Array.from(document.querySelector('#javascript-root').options).some(o=>o.value==='["Game"]')`);
    if (!hasGame) continue;
    await ui.set('#javascript-root', '["Game"]');
    return ui;
  }
  throw new GameTestError('Game root not reachable in the embedded game sources.', 'target-accessibility', 'UNSUPPORTED TARGET');
}

async function writeScore(session, controls, gamePage, value) {
  const ui = await selectScore(session, controls);
  const before = await poll(() => readRenderedValue(session, gamePage, 'J1'), Number.isFinite, {description:'Embedded rendered score'});
  await ui.scan('exact', before);
  const candidates = await ui.candidates();
  const index = candidates.findIndex(c => c.location === 'Game.score');
  if (index < 0) throw new GameTestError('Embedded score not discovered.', 'target-accessibility', 'UNSUPPORTED TARGET');
  await ui.select(index);
  await ui.write(value);
  await poll(() => readRenderedValue(session, gamePage, 'J1'), x => x === value, {description:'Embedded write affects rendered game', category:'extension',status:'FAIL'});
  return {ui,before};
}

/** Additional real-game routing checks; no synthetic game-state fixtures. */
export async function runLayoutChecks({session,server,step}) {
  for (const mode of ['same','nested','cross']) await step(`frame-${mode}`, async () => {
    const top = await session.newPage(server.wrapperUrl({gameId:'J1',mode}));
    let controls;
    try {
      const frames = await poll(() => session.frames(top), rows=>rows.some(f=>f.url.includes('/games/J1/')), {description:`${mode} embedded game loaded`});
      const leaf = frames.find(f=>f.url.includes('/games/J1/'));
      if (!leaf.accessible) throw new GameTestError(leaf.blockerReason);
      // Keyboard focus enters the fullscreen iframe via genuine pointer input.
      await session.click(top, 30, 30);
      controls = await session.openControls(top);
      const {ui,before} = await writeScore(session,controls,leaf,71234);
      await ui.restore();
      await poll(()=>readRenderedValue(session,leaf,'J1'),x=>x===before,{description:'Embedded undo',category:'extension',status:'FAIL'});
      return {frame:leaf.url,discoveredAndEdited:true,restored:before};
    } finally { if(controls) await session.closePage(controls); await session.closePage(top); }
  });
  await step('same-origin-isolation',async()=>{
    const first = await session.newPage(server.urlFor('J1'));
    const second = await session.newPage(server.urlFor('J1'));
    let controls;
    try {
      const otherBefore = await poll(()=>readRenderedValue(session,second,'J1'),Number.isFinite,{description:'Second game rendered score'});
      controls = await session.openControls(first);
      const {ui} = await writeScore(session,controls,first,71234);
      await session.activate(second);
      const otherAfter = await poll(()=>readRenderedValue(session,second,'J1'),Number.isFinite,{description:'Other game remains readable'});
      if(otherAfter!==otherBefore) throw new GameTestError('Write affected another game on the same origin.','extension','FAIL');
      await session.activate(first);
      await ui.freeze(71234);
      await session.activate(second);
      await ui.wait(`Array.from(document.querySelectorAll('[data-count]')).every(e=>Number(e.textContent)===0)`,'Hidden game stops freezes');
      await session.closePage(first);
      await session.activate(second);
      const secondControls=await session.openControls(second);
      try {
        const {ui:secondUI}=await writeScore(session,secondControls,second,82345);
        await secondUI.restore();
      } finally {await session.closePage(secondControls);}
      return {firstEdited:71234,secondUnchanged:otherAfter,hiddenFreezeStopped:true,secondWorksAfterFirstClosed:true};
    } finally {
      if(controls) await session.closePage(controls).catch(()=>{});
      await session.closePage(first).catch(()=>{}); await session.closePage(second);
    }
  });
}
