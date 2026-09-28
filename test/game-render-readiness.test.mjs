import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { OBSERVER_SCRIPT, asteroidsEditWindow } from './games/observations.mjs';

function renderer() {
  class Canvas {
    clearRect() {} beginPath() {} moveTo() {} lineTo() {} stroke() {}
    fillText() {} strokeText() {} fillRect() {}
  }
  let install;
  const context = { CanvasRenderingContext2D: Canvas, Text: {renderText() {}},
    setInterval(fn) { install = fn; return 1; }, clearInterval() {}, setTimeout() {}, Date };
  vm.runInNewContext(OBSERVER_SCRIPT, context);
  install();
  const canvas = new Canvas(); canvas.lineWidth = 2;
  return {context, canvas, paint(score, projectile = false) {
    canvas.clearRect(0,0,640,480);
    if(projectile) {
      canvas.beginPath(); canvas.moveTo(10.3,20.1); canvas.lineTo(12.3,22.1);
      canvas.moveTo(12.3,20.1); canvas.lineTo(10.3,22.1); canvas.stroke();
    }
    context.Text.renderText(String(score),18,600,20);
  }};
}

test('render observation rejects unchanged score while a projectile can still score', () => {
  const r = renderer();
  r.paint(20, true); r.paint(20, true);
  assert.equal(asteroidsEditWindow(r.context.__gameRenderedText), null);
  r.paint(40); // Projectile disappeared by hitting an asteroid.
  assert.equal(asteroidsEditWindow(r.context.__gameRenderedText), null);
  r.paint(40);
  assert.equal(asteroidsEditWindow(r.context.__gameRenderedText).value, 40);
});

test('readiness requires advancing completed score frames, not stale or duplicate samples', () => {
  const score = (frame,text='20') => ({kind:'vectorText',y:20,text,frame});
  assert.equal(asteroidsEditWindow([]), null);
  assert.equal(asteroidsEditWindow([score(1)]), null);
  assert.equal(asteroidsEditWindow([score(1),score(1)]), null);
  assert.equal(asteroidsEditWindow([score(1),score(2,'40')]), null);
  assert.deepEqual(asteroidsEditWindow([score(1),score(2)]), {value:20,frames:[1,2]});
});

test('ordinary text and asteroid polygon strokes are not mistaken for player projectiles', () => {
  const r = renderer();
  r.paint(20);
  r.canvas.clearRect(0,0,640,480);
  r.canvas.beginPath(); r.canvas.moveTo(10,20); r.canvas.lineTo(12,22);
  r.canvas.lineTo(12,20); r.canvas.lineTo(10,22); r.canvas.stroke();
  r.context.Text.renderText('20',18,600,20);
  assert.equal(asteroidsEditWindow(r.context.__gameRenderedText).value,20);
});
