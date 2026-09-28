import test from 'node:test';
import assert from 'node:assert/strict';
import { recordAttempt } from '../scripts/store-attempt.mjs';
const env = { GITHUB_REPOSITORY: 'owner/repo', GITHUB_TOKEN: 'secret' };
const args = { store: 'chrome', version: '1.3.0', commit: 'a'.repeat(40), env };
const ok = value => ({ ok: true, json: async () => value });
test('attempt record must exist before mutation may start', async () => {
  const calls = [];
  const id = await recordAttempt({ ...args, fetchImpl: async (url, options) => { calls.push(options); return ok(options.method === 'POST' ? { id: 42 } : []); } });
  assert.equal(id, 42); assert.equal(calls.length, 2);
  const body = JSON.parse(calls[1].body);
  assert.equal(body.auto_merge, false); assert.deepEqual(body.required_contexts, []); assert.equal(body.ref, args.commit);
});
test('prior attempt blocks uncertain retry without another journal write', async () => {
  let calls = 0;
  await assert.rejects(recordAttempt({ ...args, fetchImpl: async () => { calls++; return ok([{ id: 42 }]); } }), /earlier store attempt/);
  assert.equal(calls, 1);
});
test('explicit dashboard reconciliation allows a new attempt record', async () => {
  let calls = 0;
  await recordAttempt({ ...args, env: { ...env, STORE_RETRY_RECONCILED: 'true' }, fetchImpl: async (_, options) => { calls++; return ok(options.method === 'POST' ? { id: 43 } : [{ id: 42 }]); } });
  assert.equal(calls, 2);
});
test('journal failure and missing identity block store writes', async () => {
  await assert.rejects(recordAttempt({ ...args, env: {}, fetchImpl: () => assert.fail() }), /journal/);
  await assert.rejects(recordAttempt({ ...args, fetchImpl: async () => ({ ok: false, status: 403 }) }), /403/);
});
