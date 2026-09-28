import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the production reset against deliberately delayed storage cleanup.
// The full page-agent interleaving is also covered by game-pause.test.mjs.
const source=readFileSync(new URL('../page-agent.js',import.meta.url),'utf8');
const start=source.indexOf('  async function resetScan(');
const end=source.indexOf('\n  window.addEventListener("message"',start);
assert.ok(start>=0 && end>start);
const resetSource=source.slice(start,end);

test('delayed reset deletes only detached old snapshots and preserves the new scan',async()=>{
  const old={id:'document:1'},checkpoint={id:'document:2'},fresh={id:'document:3'};
  const rows=new Map([[old.id,old],[checkpoint.id,checkpoint],[fresh.id,fresh]]);
  const pending=new Map(),messages=[];
  const key='instance:i32';
  const context=vm.createContext({
    activeScans:new Map(),scans:new Map([[key,{snapshot:old}]]),undoScans:new Map([[key,{snapshot:checkpoint}]]),
    currentSession:{requestId:'old'},scanKey:(id,type)=>`${id}:${type}`,
    deleteSnapshot: snapshot=>new Promise(resolve=>pending.set(snapshot.id,()=>{rows.delete(snapshot.id);resolve();})),
    emitSession:()=>messages.push({kind:'agentState',session:context.currentSession}),send:message=>messages.push(message),
  });
  vm.runInContext(resetSource,context);
  const resetting=context.resetScan({instanceId:'instance',type:'i32',requestId:'old-reset'});
  assert.equal(context.scans.has(key),false);
  assert.equal(context.undoScans.has(key),false);
  const newSession={requestId:'new',status:'complete'};
  const newCandidates={snapshot:fresh,count:42};
  context.currentSession=newSession;context.scans.set(key,newCandidates);
  pending.get(old.id)();
  for(let i=0;i<10 && !pending.has(checkpoint.id);i++)await Promise.resolve();
  assert.ok(pending.has(checkpoint.id));
  pending.get(checkpoint.id)();await resetting;
  assert.equal(context.currentSession,newSession);
  assert.equal(context.scans.get(key),newCandidates);
  assert.deepEqual([...rows.keys()],[fresh.id]);
  assert.equal(messages.some(message=>message.kind==='agentState'),false,'old cleanup must not emit a clearing session');
  assert.equal(messages.at(-1).kind,'scanReset');
});
