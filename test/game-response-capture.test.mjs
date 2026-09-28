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

// Model CDP's two separate events: responseReceived registers the request,
// loadingFinished starts its asynchronous getResponseBody read later.
test('flush waits for delayed loadingFinished and the subsequently started body read', async () => {
  const { flushResponseCaptures } = await import('./games/response-capture.mjs');
  const resource = {};
  const responses = new Map([['request', resource]]);
  const pending = new Set();
  let finishBody;
  const body = new Promise(resolve => { finishBody = resolve; });
  let returned = false;
  const flush = flushResponseCaptures(responses, pending, {timeoutMs:1000}).then(() => { returned = true; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(returned, false, 'responseReceived alone cannot complete provenance');
  const capture = body.then(() => { resource.sha256 = 'actual-response-hash'; })
    .finally(() => { responses.delete('request'); pending.delete(capture); });
  pending.add(capture);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(returned, false, 'loadingFinished alone cannot complete provenance');
  finishBody();
  await flush;
  assert.equal(resource.sha256, 'actual-response-hash');
});

test('a response which never finishes times out with explicit unavailable evidence', async () => {
  const { flushResponseCaptures } = await import('./games/response-capture.mjs');
  const resource = {};
  await assert.rejects(flushResponseCaptures(new Map([['request',resource]]), new Set(), {timeoutMs:20}),
    error => error.status === 'BLOCKED' && error.category === 'automation' && /timeout/.test(error.message));
  assert.match(resource.hashUnavailable, /timeout/);
  assert.equal(resource.sha256, undefined);
});

test('flush cannot return successfully while the actual body read remains pending', async () => {
  const { flushResponseCaptures } = await import('./games/response-capture.mjs');
  await assert.rejects(flushResponseCaptures(new Map(), new Set([new Promise(() => {})]), {timeoutMs:20}), /timeout/);
});

test('failed completed captures retain their failure and never acquire a substitute hash', async () => {
  const { flushResponseCaptures } = await import('./games/response-capture.mjs');
  const resource = {};
  const responses = new Map([['request',resource]]);
  const flush = flushResponseCaptures(responses, new Set(), {timeoutMs:1000});
  resource.hashUnavailable = 'Response loading failed: net::ERR_CONNECTION_RESET';
  responses.delete('request');
  await flush;
  assert.equal(resource.sha256, undefined);
  assert.match(resource.hashUnavailable, /ERR_CONNECTION_RESET/);
});

test('Chrome captures an actual delayed loaded response and reports an aborted response', {
  skip: process.env.GAME_BROWSER_INTEGRATION !== '1', timeout:30000,
}, async context => {
  const {createServer} = await import('node:http');
  const {launchBrowser} = await import('./games/browser.mjs');
  const responses = new Map();
  const server = createServer((request,response) => {
    if (request.url.endsWith('.wasm')) {
      responses.set(request.url,response);
      response.writeHead(200, {'Content-Type':'application/wasm','Content-Length':wasm.length+1});
      response.write(wasm);
    } else response.end('<!doctype html><title>Capture fixture</title>');
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  context.after(() => { server.closeAllConnections(); server.close(); });
  const session = await launchBrowser({browser:'chrome',noSandbox:true});
  context.after(() => session.close());
  const page = await session.newPage(`http://127.0.0.1:${server.address().port}/`);
  const waitForResponse = async path => {
    await session.evaluate(page, `void fetch(${JSON.stringify(path)}).then(r=>r.arrayBuffer()).catch(()=>{})`);
    const deadline = Date.now()+5000;
    while (!session.resources.some(resource=>resource.url.endsWith(path))) {
      if(Date.now()>deadline) throw new Error('Fixture response was not observed');
      await new Promise(resolve=>setTimeout(resolve,10));
    }
  };
  await waitForResponse('/delayed.wasm');
  let flushed=false;
  const capture=session.flushResources().then(()=>{flushed=true;});
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(flushed,false);
  responses.get('/delayed.wasm').end(Buffer.from([42]));
  await capture;
  const delayed=session.resources.find(resource=>resource.url.endsWith('/delayed.wasm'));
  assert.equal(delayed.sha256,createHash('sha256').update(Buffer.concat([wasm,Buffer.from([42])])).digest('hex'));
  await waitForResponse('/aborted.wasm');
  responses.get('/aborted.wasm').destroy();
  await session.flushResources();
  const aborted=session.resources.find(resource=>resource.url.endsWith('/aborted.wasm'));
  assert.equal(aborted.sha256,undefined);
  assert.match(aborted.hashUnavailable,/Response loading failed/);
});
