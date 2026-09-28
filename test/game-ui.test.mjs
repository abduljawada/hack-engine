import test from 'node:test';
import assert from 'node:assert/strict';
import { GameUI } from './games/ui.mjs';

test('packaged UI waits for embedded Wasm registration after parent JavaScript connects', async () => {
  let reads = 0;
  const selected = [];
  const session = { async evaluate(_page, expression) {
    if (expression.includes("Array.from(document.querySelector('#advanced-instance').options")) {
      reads++;
      return reads < 3 ? [{ value: 'top-js', text: 'JavaScript objects · frame 0' }]
        : [{ value: 'top-js', text: 'JavaScript objects · frame 0' }, { value: 'child-wasm', text: 'Ruffle memory · frame 6' }];
    }
    selected.push(expression);
    return true;
  } };
  const source = await new GameUI(session, {}).ready({ javascript: false });
  assert.equal(source.value, 'child-wasm');
  assert.equal(reads, 3);
  assert.ok(selected.some(expression => expression.includes('child-wasm')));
  assert.ok(!selected.some(expression => expression.includes('e.value = "top-js"')));
});
