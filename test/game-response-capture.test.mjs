import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFirefoxResponseCollector } from './games/response-capture.mjs';
const event = (url = 'https://fixture.invalid/game.wasm', status = 200) => ({ request: { request: 'actual-loaded-request' }, response: { url, status } });
const wasm = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);

test('BiDi hashes exact collected binary bytes and releases the actual request', async () => {
  const calls = [];
  const capture = await createFirefoxResponseCollector({ call: async (method, params) => {
    calls.push({ method, params });
    if (method === 'network.addDataCollector') return { collector: 'collector' };
    return { bytes: { type: 'base64', value: wasm.toString('base64') } };
  } });
  const resource = {};
  await capture(event(), resource);
  assert.equal(resource.sha256, createHash('sha256').update(wasm).digest('hex'));
  assert.equal(resource.bytes, wasm.length);
  assert.deepEqual(calls[1], { method: 'network.getData', params: {
    request: 'actual-loaded-request', dataType: 'response', collector: 'collector', disown: true,
  } });
});

test('BiDi frees irrelevant data without fetching it and leaves redirects for final response', async () => {
  const calls = [];
  const capture = await createFirefoxResponseCollector({ call: async (method, params) => {
    calls.push({ method, params }); return { collector: 'collector' };
  } });
  await capture(event('https://fixture.invalid/image.png'), {});
  assert.equal(calls[1].method, 'network.disownData');
  await capture(event('https://fixture.invalid/game.wasm', 302), {});
  assert.equal(calls.length, 2);
});

for (const issue of ['unsupported', 'evicted', 'encoding', 'base64']) {
  test(`BiDi ${issue} leaves a provenance failure, never a substituted hash`, async () => {
    const capture = await createFirefoxResponseCollector({ call: async method => {
      if (method === 'network.addDataCollector') {
        if (issue === 'unsupported') throw new Error('unknown command');
        return { collector: 'collector' };
      }
      if (method === 'network.getData') {
        if (issue === 'evicted') throw new Error('no such network data');
        return { bytes: { type: issue === 'encoding' ? 'other' : 'base64', value: 'invalid!' } };
      }
      return {};
    } });
    const resource = {};
    await capture(event(), resource);
    assert.equal(resource.sha256, undefined);
    assert.ok(resource.hashUnavailable);
  });
}

test('BiDi parses AVM from the captured SWF itself', async () => {
  const bytes = Buffer.from([70,87,83,10,23,0,0,0,8,0,0,24,1,0,0x44,0x11,8,0,0,0,0,0,0]);
  const capture = await createFirefoxResponseCollector({ call: async method => method === 'network.addDataCollector'
    ? {collector:'collector'} : { bytes:{type:'base64',value:bytes.toString('base64')} } });
  const resource = {};
  await capture(event('https://fixture.invalid/game.swf'), resource);
  assert.equal(resource.independentlyParsedAvm, 'AVM2');
  assert.equal(resource.sha256, createHash('sha256').update(bytes).digest('hex'));
});
