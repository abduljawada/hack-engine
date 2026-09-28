import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions, classifyCaseFailure } from './run-games.mjs';

test('game CLI defaults to the eight release combinations and validates filters', () => {
  const options = parseOptions([]);
  assert.equal(options.gameIds.length * options.browsers.length, 8);
  assert.equal(options.mode, 'local');
  assert.deepEqual(options.gameIds, ['J1','W1','F2','F4']);
  assert.equal(parseOptions(['--mode', 'local', '--prepare-only']).mode, 'local');
  assert.throws(()=>parseOptions(['--mode', 'remote']), /Mode must/);
  assert.throws(()=>parseOptions(['--mode','website','--prepare-only']), /requires --mode local/);
  assert.deepEqual(parseOptions(['--browser=firefox', '--game', 'j1,W1,J1']).gameIds, ['J1','W1']);
  assert.throws(()=>parseOptions(['--game','missing']), /Unknown game/);
  assert.throws(()=>parseOptions(['--browser','safari']), /Browser must/);
  assert.throws(()=>parseOptions(['--assets']), /Missing value/);
  assert.throws(()=>parseOptions(['--silent-pass']), /Unknown option/);
});
test('strict release qualification cannot be bypassed through filtered or preparation-only runs', () => {
  assert.throws(()=>parseOptions(['--strict','--game','J1']), /J1,W1,F2,F4/);
  assert.throws(()=>parseOptions(['--strict','--browser','chrome']), /J1,W1,F2,F4/);
  assert.throws(()=>parseOptions(['--strict','--prepare-only']), /J1,W1,F2,F4/);
  assert.equal(parseOptions(['--strict','--no-download']).strict, true);
  assert.deepEqual(parseOptions(['--strict','--game','F4,F2,W1,J1']).gameIds, ['F4','F2','W1','J1']);
  assert.throws(()=>parseOptions(['--strict','--game','J1,W1,F1,F4']), /J1,W1,F2,F4/);
});

test('interrupted browser closure remains an automation blocker, not an extension assertion failure', () => {
  const error = new Error('Debugger transport closed');
  assert.deepEqual(classifyCaseFailure(error, {phase:'extension',interrupted:true}), {
    status:'BLOCKED',category:'automation',reason:'Run interrupted: Debugger transport closed',
  });
  const assertion=Object.assign(new Error('Edited value did not affect gameplay'),{status:'FAIL',category:'extension'});
  assert.equal(classifyCaseFailure(assertion,{phase:'extension'}).status,'FAIL');
});

test('controlled runtime evidence validates actual loaded bodies against catalog pins', async () => {
  const { localRuntimeEvidence } = await import('./run-games.mjs');
  const { GAME_CATALOG, RUFFLE_BUILD } = await import('./games/catalog.mjs');
  const game = GAME_CATALOG.find(game => game.id === 'F4');
  const assetPath = Object.keys(RUFFLE_BUILD.expectedHashes).find(name => name.endsWith('.wasm'));
  const gameUrl = 'http://127.0.0.1:123/games/F4/__flash__.html';
  const asset = {game,hashes:{'game.swf':game.downloadArtifact.sha256},ruffle:{hashes:RUFFLE_BUILD.expectedHashes,provenance:{version:RUFFLE_BUILD.version}}};
  const resources = [{url:'http://127.0.0.1:123/games/F4/game.swf',sha256:game.downloadArtifact.sha256,status:200,independentlyParsedAvm:'AVM2'},
    {url:`http://127.0.0.1:123/ruffle/${assetPath}`,sha256:RUFFLE_BUILD.expectedHashes[assetPath],status:200}];
  let flushed = false;
  const session = {resources,flushResources:async()=>{flushed=true;}};
  const input = {session,asset,gameUrl,runtime:{reportedAvm:'AVM2'}};
  assert.equal((await localRuntimeEvidence(input)).runtimeWasm[0].assetPath,assetPath);
  assert.equal(flushed,true);
  resources[1].sha256='a'.repeat(64);
  await assert.rejects(localRuntimeEvidence(input),/pinned runtime/);
  resources[1].sha256=RUFFLE_BUILD.expectedHashes[assetPath];
  resources[0].independentlyParsedAvm='AVM1';
  await assert.rejects(localRuntimeEvidence(input),/pinned game/);
});
