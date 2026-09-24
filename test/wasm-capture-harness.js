(async () => {
  const channel = 'ruffle-memory-inspector:v1', captures = [];
  const pending = new Map(); let sequence = 0;
  window.addEventListener('message', ({ data }) => {
    if (data?.channel !== channel || data.direction !== 'from-page') return;
    const p = data.payload;
    if (p.kind === 'instanceCaptured') captures.push(p.instance);
    if (pending.has(p.requestId)) { pending.get(p.requestId)(p); pending.delete(p.requestId); }
  });
  const command = (payload) => new Promise((resolve) => {
    const requestId = 'capture:' + ++sequence; pending.set(requestId, resolve);
    window.postMessage({ channel, direction: 'to-page', payload: { ...payload, requestId } }, '*');
  });
  const assert = (v, m) => { if (!v) throw new Error(m); };
  const bytes = new Uint8Array([0,97,115,109,1,0,0,0,5,3,1,0,1,7,10,1,6,109,101,109,111,114,121,2,0]);
  const module = new WebAssembly.Module(bytes);
  const instance = new WebAssembly.Instance(module);
  assert(instance instanceof WebAssembly.Instance, 'constructor identity broken');
  let threw = false; try { WebAssembly.Instance(module); } catch { threw = true; }
  assert(threw, 'constructor call must require new');
  await command({ kind: 'listInstances' });
  assert(captures.length === 1 && !captures[0].looksLikeRuffle, 'synchronous capture or Ruffle isolation failed');
  new DataView(instance.exports.memory.buffer).setInt32(16, 4321, true);
  let result = await command({ kind: 'memoryScan', instanceId: captures[0].id, type: 'i32', rawValue: 4321, condition: 'exact' });
  assert(result.total === 1, 'synchronous captured memory cannot scan');
  const imported = new WebAssembly.Memory({ initial: 1 });
  // (module (import "env" "memory" (memory 1)))
  const importModule = new Uint8Array([0,97,115,109,1,0,0,0,2,15,1,3,101,110,118,6,109,101,109,111,114,121,2,0,1]);
  await WebAssembly.instantiate(importModule, { env: { memory: imported } });
  await WebAssembly.instantiate(importModule, { env: { memory: imported } });
  let getterCalls = 0;
  const getterImports = { env: { get memory() { getterCalls++; return imported; } } };
  new WebAssembly.Instance(new WebAssembly.Module(importModule), getterImports);
  assert(getterCalls === 1, 'capture invoked an import getter again');
  await command({ kind: 'listInstances' });
  assert(captures.length === 2, 'imported memory not captured or duplicated');
  await WebAssembly.instantiateStreaming(Promise.resolve(new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } })));
  result = await command({ kind: 'listInstances' });
  assert(result.instances.length === 3 && result.instances.every((i) => i.kind === 'wasm' && !i.looksLikeRuffle), 'streaming capture or mixed-module classification failed');
  document.querySelector('#result').textContent = 'PASS: synchronous, imported, shared-by-instance and streaming Wasm capture preserve native behavior and isolate Ruffle hints.';
})().catch((error) => { document.querySelector('#result').textContent = 'FAIL: '+error.stack; });
