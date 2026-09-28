import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchBrowser } from './games/browser.mjs';

function firstPixel(png) {
  const parts = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') parts.push(png.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  // For the first pixel of the first row, every PNG filter predictor is zero.
  return [...inflateSync(Buffer.concat(parts)).subarray(1, 4)];
}

// Opt in because these exercise installed browser binaries rather than mock CDP.
// GAME_BROWSER_INTEGRATION=1 node --test test/game-live-browser.test.mjs
for (const browser of ['firefox', 'chrome']) {
  test(`${browser}: live navigation, nested cross-site input, screenshots and extension tab binding`, {
    skip: process.env.GAME_BROWSER_INTEGRATION !== '1', timeout: 90000,
  }, async (context) => {
    const directory = await mkdtemp(join(tmpdir(), 'hack-live-browser-test-'));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const server = createServer((request, response) => {
      const port = server.address().port;
      if (request.url === '/redirect') {
        response.writeHead(302, { location: '/game' }); response.end(); return;
      }
      if (request.url === '/game.swf') {
        const body=Buffer.from([8,0,0,24,1,0,0x44,0x11,8,0,0,0,0,0]);
        const header=Buffer.alloc(8);header.write('FWS');header[3]=10;header.writeUInt32LE(body.length+8,4);
        response.setHeader('content-type','application/x-shockwave-flash');
        response.end(Buffer.concat([header,body]));return;
      }
      if (request.url === '/runtime.wasm') {
        response.setHeader('content-type', 'application/wasm');
        response.end(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])); return;
      }
      response.setHeader('content-type', 'text/html');
      if (request.url === '/game') {
        response.end(`<iframe style="margin:25px" width="420" height="400" src="/same"></iframe>
          <iframe style="margin:25px" width="420" height="400" src="http://127.0.0.1:${port}/cross"></iframe>`);
      } else {
        response.end(`<style>body{margin:0;background:rgb(12,34,56)}button{margin-left:20px;display:block;width:120px;height:60px}</style>
          <button onclick="document.title=window.__pressedHoveredTarget?'clicked':'missed-game-frame'">Click game</button>
          <script>let renderedHover=false; addEventListener('pointermove',e=>{ renderedHover=false; requestAnimationFrame(()=>{renderedHover=e.target.tagName==='BUTTON';}); }); addEventListener('pointerdown',()=>{window.__pressedHoveredTarget=renderedHover;}); fetch('/runtime.wasm'); fetch('/game.swf'); addEventListener('keydown', e => { if(e.key === 'ArrowRight') document.title='keyed'; });</script>
          ${request.url === '/cross' ? `<iframe style="margin:20px" width="250" height="180" src="http://localhost:${port}/nested"></iframe>` : ''}`);
      }
    });
    await new Promise((resolve) => server.listen(0, '0.0.0.0', resolve));
    context.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
    const session = await launchBrowser({ browser, extensionDirectory: resolve(`dist/${browser}`), artifactDir: directory, noSandbox: process.env.GAME_BROWSER_NO_SANDBOX === '1' });
    context.after(() => session.close());
    await session.preload('globalThis.__liveBrowserPreload = true;');
    const page = await session.newPage(`http://localhost:${server.address().port}/redirect`);
    assert.equal(page.url, `http://localhost:${server.address().port}/game`);
    let frames;
    const deadline = Date.now() + 15000;
    do {
      frames = await session.frames(page);
      if (frames.length === 3 && frames.every(frame => frame.accessible && /^http:/.test(frame.url))) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    } while (Date.now() < deadline);
    assert.equal(frames.length, 3);
    assert.ok(frames.every(frame => frame.accessible));
    for (const frame of frames) {
      assert.equal(await session.evaluate(frame, 'globalThis.__liveBrowserPreload'), true, frame.url);
      await session.click(frame, 50, 30);
      assert.equal(await session.evaluate(frame, 'document.title'), 'clicked', frame.url);
      await session.key(frame, 'ArrowRight');
      assert.equal(await session.evaluate(frame, 'document.title'), 'keyed', frame.url);
      const path = join(directory, `${frame.url.split('/').pop()}.png`);
      await session.screenshot(frame, path);
      const png = await readFile(path);
      const size = await session.evaluate(frame, '({width:innerWidth,height:innerHeight})');
      assert.equal(png.readUInt32BE(16), size.width, frame.url);
      assert.equal(png.readUInt32BE(20), size.height, frame.url);
      assert.deepEqual(firstPixel(png), [12, 34, 56], `Frame screenshot contains its rendered pixels: ${frame.url}`);
      const rootSize = await session.evaluate(page, '({width:innerWidth,height:innerHeight})');
      await session.setPixelRatio(frame, 2);
      assert.deepEqual(await session.evaluate(page, '({width:innerWidth,height:innerHeight})'), rootSize, 'High-DPI capture preserves root viewport');
      assert.deepEqual(await session.evaluate(frame, '({width:innerWidth,height:innerHeight})'), size, 'High-DPI capture preserves frame geometry');
      await session.screenshot(frame, path);
      const highDpi = await readFile(path);
      assert.equal(highDpi.readUInt32BE(16), size.width * 2, frame.url);
      assert.equal(highDpi.readUInt32BE(20), size.height * 2, frame.url);
      assert.deepEqual(firstPixel(highDpi), [12, 34, 56], 'High-DPI screenshot contains the same frame pixels');
      await session.setPixelRatio(frame, 1);

    }
    const controls = await session.openControls(frames.find(frame => frame.url.endsWith('/nested')));
    assert.ok(Number.isInteger(controls.gameTabId));
    await session.activate(controls);
    assert.equal(await session.evaluate(controls, 'document.visibilityState'), 'visible');
    await session.activate(page);
    assert.equal(await session.evaluate(controls, 'document.visibilityState'), 'hidden');
    assert.ok(session.resources.some(resource => resource.url.endsWith('/cross') && resource.status === 200));
    await session.flushResources();
    const wasm = session.resources.find(resource => resource.url.endsWith('/runtime.wasm'));
    assert.ok(wasm);
    assert.equal(session.resources.find(resource => resource.url.endsWith('/game.swf')).independentlyParsedAvm, 'AVM2');
    assert.equal(wasm.sha256, createHash('sha256').update(Buffer.from([0, 97, 115, 109, 1, 0, 0, 0])).digest('hex'));
    await session.closePage(controls);
    await session.closePage(page);
  });
}
