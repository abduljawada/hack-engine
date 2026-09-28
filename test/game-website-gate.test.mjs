import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADDITIONAL_TARGETS, GAME_CATALOG, REQUIRED_SCENARIOS, TARGET_SCENARIOS } from './games/catalog.mjs';
import { createReport, evaluateGate, writeReports } from './games/report.mjs';

function websiteReport() {
  const report = createReport({ gameIds: GAME_CATALOG.map(game => game.id), metadata: { mode: 'website' } });
  for (const entry of report.cases) {
    const game = GAME_CATALOG.find(game => game.id === entry.gameId);
    Object.assign(entry, { status: 'PASS', complete: true, observedRuntime: entry.gameId === 'F6' ? 'javascript' : game.runtime });
    const add = (name, phase = 'extension') => entry.steps.push({ name, phase, status: 'PASS', ...(name === 'runtime-detection' ? { details: { runtime: entry.observedRuntime, runtimeDetails: { avm: game.expectedAvm } } } : {}) });
    for (const phase of ['baseline', 'extension']) for (const name of ['website-load', 'runtime-detection']) add(name, phase);
    for (const name of [...REQUIRED_SCENARIOS, 'undo-scan', 'guarded-undo']) add(name, name === 'baseline' ? 'baseline' : 'extension');
    for (const target of ADDITIONAL_TARGETS[entry.gameId] || []) {
      add(`${target}:baseline`, 'baseline');
      for (const name of TARGET_SCENARIOS) add(`${target}:${name}`);
    }
    if (entry.gameId === 'J1') for (const name of ['range-scan', 'unknown-scan']) add(name);
    if (entry.browser === 'chrome' && ['J1', 'W1'].includes(entry.gameId)) add('worker-recovery');
    if (entry.observedRuntime === 'ruffle') {
      for (const name of ['pause-resume', 'pause-scanning', 'pause-cancel', 'flash-source-runtime', 'flash-manual-pause']) add(name);
      for (const phase of ['baseline', 'extension']) {
        add('flash-load', phase);
        entry.steps.at(-1).details = { runtime: { avm: game.expectedAvm },
          primarySwf: { url: `https://games.test/${game.id}.swf`, sha256: 'a'.repeat(64), status: 200, independentlyParsedAvm: game.expectedAvm },
          runtimeWasm: [{ url: 'https://games.test/ruffle.wasm', sha256: 'b'.repeat(64), status: 200 }] };
      }
    }
  }
  return report;
}
test('every preserved title has a public website independent of optional local assets', () => {
  for (const game of GAME_CATALOG) assert.match(game.siteUrl, /^https?:\/\//);
});
test('website qualification uses observed runtime and does not require local synthetic frame wrappers', () => {
  const report = websiteReport();
  assert.equal(evaluateGate(report, { strict: true }).passed, true);
  const canabalt = report.cases.find(item => item.gameId === 'F6');
  assert.equal(canabalt.steps.some(step => step.name === 'pause-resume'), false);
  canabalt.observedRuntime = 'ruffle';
  assert.match(evaluateGate(report, { strict: true }).reasons.join('\n'), /pause-resume/);
});
test('baseline-only observations cannot satisfy installed-extension qualification', () => {
  const report = websiteReport();
  report.cases[0].steps.find(step => step.name === 'write').phase = 'baseline';
  assert.match(evaluateGate(report, { strict: true }).reasons.join('\n'), /mandatory extension step write/);
});
test('website and runtime observations are mandatory in both fresh browser phases', () => {
  for (const phase of ['baseline', 'extension']) for (const name of ['website-load', 'runtime-detection']) {
    const report = websiteReport();
    report.cases[0].steps = report.cases[0].steps.filter(step => !(step.name === name && step.phase === phase));
    assert.equal(evaluateGate(report, { strict: true }).passed, false);
  }
  const report = websiteReport(); delete report.cases[0].observedRuntime;
  assert.match(evaluateGate(report, { strict: true }).reasons.join('\n'), /observed runtime/);
});
test('qualifying cash alone cannot claim Bloons lives or complete coverage', () => {
  const report = websiteReport();
  const bloons = report.cases.find(item => item.gameId === 'F4');
  bloons.steps = bloons.steps.filter(step => step.name !== 'lives:freeze');
  assert.match(evaluateGate(report, { strict: true }).reasons.join('\n'), /lives:freeze/);
});
test('website smoke checks and diagnostic rerun passes never erase original failures', () => {
  const report = websiteReport();
  report.cases[0].steps.push({ name: 'write', phase: 'extension', status: 'FAIL', error: 'Original failure' });
  report.cases[0].steps.push({ name: 'write', phase: 'extension', status: 'PASS', diagnostic: true });
  assert.equal(evaluateGate(report, { strict: true }).passed, false);
  const incomplete = websiteReport();
  incomplete.cases.at(-1).status = 'BLOCKED';
  assert.equal(evaluateGate(incomplete, { strict: true }).passed, false);
});

test('different runtime editions cannot share one baseline qualification', () => {
  const report = websiteReport();
  report.cases[0].steps.find(step => step.name === 'runtime-detection' && step.phase === 'baseline').details.runtime = 'ruffle';
  assert.match(evaluateGate(report, { strict: true }).reasons.join('\n'), /baseline runtime evidence/);
});


test('strict live Flash evidence requires independent same-run hashes in each browser phase',()=>{
  for(const phase of ['baseline','extension']) for(const field of ['primaryHash','runtimeHash','classification']){
    const report=websiteReport(),entry=report.cases.find(item=>item.gameId==='F1'&&item.browser==='firefox');
    const details=entry.steps.find(step=>step.name==='flash-load'&&step.phase===phase).details;
    if(field==='primaryHash')delete details.primarySwf.sha256;
    if(field==='runtimeHash')delete details.runtimeWasm[0].sha256;
    if(field==='classification')details.primarySwf.independentlyParsedAvm='AVM2';
    assert.equal(evaluateGate(report).passed,true,'ordinary gameplay check remains separate from strict provenance');
    assert.equal(evaluateGate(report,{strict:true}).passed,false,`${phase} ${field} must block strict qualification`);
    assert.equal(report.cases.find(item=>item.gameId==='F1'&&item.browser==='chrome').steps.find(step=>step.name==='flash-load'&&step.phase===phase).details.primarySwf.sha256,'a'.repeat(64),'Chromium evidence cannot qualify Firefox');
  }
});
test('strict live Flash provenance rejects empty runtime resources and mismatched public AVM',()=>{
  const report=websiteReport(),entry=report.cases.find(item=>item.gameId==='F4');
  entry.steps.find(step=>step.name==='flash-load'&&step.phase==='baseline').details.runtimeWasm=[];
  entry.steps.find(step=>step.name==='runtime-detection'&&step.phase==='extension').details.runtimeDetails.avm='AVM1';
  const gate=evaluateGate(report,{strict:true});
  assert.equal(gate.passed,false);assert.match(gate.reasons.join('\n'),/runtime Wasm hash unavailable/);assert.match(gate.reasons.join('\n'),/independent primary SWF classification/);
});


async function junitFor(context,report) {
  const directory=await mkdtemp(join(tmpdir(),'game-gate-report-'));
  context.after(()=>rm(directory,{recursive:true,force:true}));
  const files=await writeReports(report,directory);
  return readFile(files.junit,'utf8');
}
test('an optional Flash blocker never hides failed cleanup or overwrites its original evidence',async context=>{
  const report=websiteReport();
  const entry=report.cases.find(item=>item.gameId==='F1');
  Object.assign(entry,{status:'BLOCKED',reason:'Unreliable OCR reading',evidence:['original-counter.png']});
  entry.steps.push({name:'cleanup',phase:'extension',status:'FAIL',error:'Browser survived SIGKILL'});
  const original=structuredClone(entry);
  assert.equal(evaluateGate(report).passed,false);
  assert.match(evaluateGate(report).reasons.join('\n'),/cleanup failed.*survived SIGKILL/);
  const xml=await junitFor(context,report);
  assert.match(xml,/<testsuite[^>]*failures="2"/);
  assert.match(xml,/Browser survived SIGKILL/);
  assert.deepEqual(entry,original);
});
test('strict JUnit records missing combinations as a failed qualification test',async context=>{
  const report=websiteReport();report.metadata.strict=true;report.cases=report.cases.filter(item=>!(item.gameId==='F4'&&item.browser==='chrome'));
  const xml=await junitFor(context,report);
  assert.equal(report.gates.strict.passed,false);
  assert.match(xml,/<testsuite[^>]*failures="1"/);
  assert.match(xml,/<testcase classname="qualification" name="Strict website compatibility"[^>]*><failure/);
  assert.match(xml,/F4\/chrome: NOT RUN/);
});
test('strict JUnit rejects missing same-run Flash hashes while ordinary gameplay stays separate',async context=>{
  const report=websiteReport();report.metadata.strict=true;
  const entry=report.cases.find(item=>item.gameId==='F1'&&item.browser==='firefox');
  delete entry.steps.find(step=>step.name==='flash-load'&&step.phase==='baseline').details.primarySwf.sha256;
  const xml=await junitFor(context,report);
  assert.match(xml,/<testcase classname="firefox" name="F1 Chibi Knight"[^>]*><failure/);
  assert.match(xml,/baseline primary game SWF hash unavailable/);
  assert.match(xml,/<testsuite[^>]*failures="2"/);
  report.metadata.strict=false;
  const ordinary=await junitFor(context,report);
  assert.match(ordinary,/<testsuite[^>]*failures="0"/);
});
test('ordinary JUnit fails required missing assets and skips optional asset blockers',async context=>{
  const report=websiteReport();
  const required=report.cases.find(item=>item.gameId==='J1'),optional=report.cases.find(item=>item.gameId==='F1');
  Object.assign(required,{status:'BLOCKED',reason:'Missing required game asset'});
  Object.assign(optional,{status:'BLOCKED',reason:'Missing optional local Flash file'});
  const xml=await junitFor(context,report);
  assert.match(xml,/<testcase classname="firefox" name="J1 HTML5-Asteroids"[^>]*><failure/);
  assert.match(xml,/<testcase classname="firefox" name="F1 Chibi Knight"[^>]*><skipped/);
  assert.match(xml,/<testsuite[^>]*failures="2" skipped="1"/);
});

 test('release qualification needs exactly the four runtime representatives, without retired titles', () => {
  const report = websiteReport();
  report.cases = report.cases.filter(item => ['J1','W1','F7','F4'].includes(item.gameId));
  assert.equal(report.cases.length, 8);
  assert.equal(evaluateGate(report, {strict:true}).passed, true);
  for (const entry of report.cases) {
    const missing = structuredClone(report);
    missing.cases = missing.cases.filter(item => !(item.gameId === entry.gameId && item.browser === entry.browser));
    assert.equal(evaluateGate(missing, {strict:true}).passed, false);
    for (const status of ['BLOCKED','FAIL','NOT RUN','UNSUPPORTED']) {
      const failed = structuredClone(report);
      failed.cases.find(item=>item.gameId===entry.gameId && item.browser===entry.browser).status=status;
      assert.equal(evaluateGate(failed, {strict:true}).passed, false);
    }
  }
});
test('release representatives cannot silently switch runtime families or AVM versions', () => {
  for (const id of ['J1','W1','F7','F4']) {
    const report=websiteReport(), entry=report.cases.find(item=>item.gameId===id);
    entry.observedRuntime='javascript';
    if(id==='J1') entry.observedRuntime='wasm';
    assert.equal(evaluateGate(report,{strict:true}).passed,false);
  }
  const report=websiteReport(), entry=report.cases.find(item=>item.gameId==='F7');
  for(const step of entry.steps) {
    if(step.name==='runtime-detection') step.details.runtimeDetails.avm='AVM2';
    if(step.name==='flash-load') {step.details.runtime.avm='AVM2';step.details.primarySwf.independentlyParsedAvm='AVM2';}
  }
  assert.match(evaluateGate(report,{strict:true}).reasons.join('\n'), /runtime must be AVM1/);
});

test('passing live compatibility is explicitly not a controlled core release result', async context => {
  const report = websiteReport(); report.metadata.strict = true;
  const directory = await mkdtemp(join(tmpdir(),'compatibility-not-core-'));
  context.after(() => rm(directory,{recursive:true,force:true}));
  const files = await writeReports(report,directory);
  assert.equal(report.gates.strict.passed,true);
  assert.equal(report.gates.coreRelease.passed,false);
  const html = await readFile(files.html,'utf8');
  assert.match(html,/Live website compatibility/);
  assert.doesNotMatch(html,/Full core release qualification: PASS/);
  assert.match(await readFile(files.junit,'utf8'),/Strict website compatibility/);
});
