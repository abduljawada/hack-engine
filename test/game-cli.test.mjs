import test from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions, classifyCaseFailure } from './run-games.mjs';

test('game CLI defaults to the eight release combinations and validates filters', () => {
  const options = parseOptions([]);
  assert.equal(options.gameIds.length * options.browsers.length, 8);
  assert.equal(options.mode, 'website');
  assert.deepEqual(options.gameIds, ['J1','W1','F2','F4']);
  assert.equal(parseOptions(['--mode', 'local', '--prepare-only']).mode, 'local');
  assert.throws(()=>parseOptions(['--mode', 'remote']), /Mode must/);
  assert.throws(()=>parseOptions(['--prepare-only']), /requires --mode local/);
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
