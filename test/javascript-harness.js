(async () => {
  const channel = 'ruffle-memory-inspector:v1', pending = new Map();
  let sequence = 0, source, state;
  window.addEventListener('message', ({ source: sender, data }) => {
    if (sender !== window || data?.channel !== channel || data.direction !== 'from-page') return;
    const p = data.payload;
    if (p.kind === 'agentState') state = p;
    const task = pending.get(p.requestId);
    if (task && (task.kind === p.kind || p.kind === 'error' || p.kind === 'scanCancelled')) {
      clearTimeout(task.timer); pending.delete(p.requestId);
      p.kind === 'error' ? task.reject(new Error(p.message)) : task.resolve(p);
    }
  });
  function command(payload, kind = 'scanResults') {
    const requestId = 'js:' + ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout ' + payload.kind)), 15000);
      pending.set(requestId, { kind, resolve, reject, timer });
      window.postMessage({ channel, direction: 'to-page', payload: { instanceId: source, type: 'smart', ...payload, requestId } }, '*');
    });
  }
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const rejects = async (payload, kind) => { try { await command(payload, kind); } catch { return; } throw new Error('Expected rejection: '+payload.kind); };
  window.gameFixture = { player: { score: 100 }, copy: 100, typed: new Float64Array([100]), immutable: {} };
  Object.defineProperty(window.gameFixture.immutable, 'score', { value: 100, writable: false });
  let getterCalls = 0;
  Object.defineProperty(window.gameFixture, 'danger', { get() { getterCalls++; throw new Error('getter executed'); } });
  const list = await command({ kind: 'listInstances' }, 'instanceList');
  source = list.instances.find((item) => item.kind === 'javascript').id;
  const roots = await command({ kind: 'listJavaScriptRoots' }, 'javaScriptRoots');
  assert(roots.roots.some((r) => r.path[0] === 'gameFixture'), 'root picker omitted game');
  let result = await command({ kind: 'memoryScan', condition: 'exact', rawValue: 100, rootPath: ['gameFixture'] });
  assert(result.total === 4 && getterCalls === 0, 'discovery/getter boundary failed');
  const score = result.preview.find((entry) => entry.displayPath === 'gameFixture.player.score');
  assert(score.kind === 'javascript' && score.type === 'number', 'candidate identity missing');
  window.gameFixture.player.score = 93;
  result = await command({ kind: 'memoryScan', condition: 'decreased', refine: true });
  assert(result.total === 1 && result.canUndo, 'refinement failed');
  result = await command({ kind: 'undoScan' });
  assert(result.total === 4 && !result.canUndo, 'undo failed');
  result = await command({ kind: 'memoryScan', condition: 'changed', refine: true });
  assert(result.total === 1, 'undo baseline failed');
  const target = { address: score.address, type: 'number' };
  await command({ kind: 'writeValue', ...target, rawValue: 500 }, 'writeComplete');
  assert(window.gameFixture.player.score === 500, 'write failed');
  await command({ kind: 'restoreWrite', ...target }, 'writeRestored');
  assert(window.gameFixture.player.score === 93, 'restore failed');
  await command({ kind: 'writeValue', ...target, rawValue: 500 }, 'writeComplete');
  window.gameFixture.player.score = 499;
  await rejects({ kind: 'restoreWrite', ...target }, 'writeRestored');
  await command({ kind: 'setFreeze', ...target, rawValue: 200, enabled: true }, 'freezeChanged');
  await command({ kind: 'stopAllFreezes' }, 'freezeChanged');
  window.gameFixture.player.score = 51;
  await new Promise((r) => setTimeout(r, 300));
  assert(window.gameFixture.player.score === 51 && state.freezes.length === 0, 'stop all failed');
  await command({ kind: 'setFreeze', ...target, rawValue: 200, enabled: true }, 'freezeChanged');
  window.gameFixture.player = { score: 7 };
  await new Promise((r) => setTimeout(r, 100));
  assert(window.gameFixture.player.score === 7 && state.freezes.length === 0, 'stale freeze wrote to replacement or remained active');
  await rejects({ kind: 'writeValue', ...target, rawValue: 900 }, 'writeComplete');
  const watched = await command({ kind: 'readValues', entries: [{ ...target, id: 'score' }] }, 'watchValues');
  assert(watched.values[0].error, 'stale watch not unavailable');
  const resolved = await command({ kind: 'resolveJavaScriptPaths', paths: [score.path] }, 'javaScriptPathsResolved');
  assert(!resolved.errors.length && resolved.entries[0].address !== score.address, 'rediscovery reused stale handle');
  const immutable = await command({ kind: 'resolveJavaScriptPaths', paths: [['gameFixture','immutable','score']] }, 'javaScriptPathsResolved');
  await rejects({ kind: 'writeValue', address: immutable.entries[0].address, type: 'number', rawValue: 55 }, 'writeComplete');
  await command({ kind: 'memoryScan', condition: 'range', rawValue: 0, rawMaxValue: 300, rootPath: ['gameFixture'] });
  window.gameFixture.player.score = 8;
  const cancelId = 'js:' + (sequence + 1);
  const cancel = ({ data }) => {
    if (data?.payload?.kind !== 'scanProgress' || data.payload.requestId !== cancelId) return;
    window.removeEventListener('message', cancel);
    window.postMessage({ channel, direction: 'to-page', payload: { kind: 'cancelScan', targetRequestId: cancelId } }, '*');
  };
  window.addEventListener('message', cancel);
  result = await command({ kind: 'memoryScan', condition: 'changed', refine: true });
  assert(result.kind === 'scanCancelled', 'cancellation failed');
  result = await command({ kind: 'memoryScan', condition: 'changed', refine: true });
  assert(result.total === 1, 'cancel damaged baseline');
  await command({ kind: 'memoryScan', condition: 'unknown', rootPath: ['gameFixture'] });
  result = await command({ kind: 'memoryScan', condition: 'unchanged', refine: true });
  assert(result.total > 0, 'unknown baseline failed');
  document.querySelector('#result').textContent = 'PASS: JavaScript discovery, comparison/undo, writes/restore, freeze/stop, stale objects, read-only values, cancellation and path rediscovery.';
})().catch((error) => { document.querySelector('#result').textContent = 'FAIL: '+error.stack; });
