import test from 'node:test';
import assert from 'node:assert/strict';
import { runFirefox, amoToken, firefoxVersions } from '../scripts/store-firefox.mjs';
const env = { AMO_JWT_ISSUER: 'test', AMO_JWT_SECRET: 'test-secret' };
const entry = (status = 'unreviewed', extra = {}) => ({ id: 123, version: '1.3.0', channel: 'listed', source: 'https://example.invalid/source', file: { status }, ...extra });
const response = results => ({ ok: true, json: async () => ({ results, next: null }) });
test('Firefox requires credentials before any request', async () => {
  await assert.rejects(runFirefox({ version: '1.3.0', mode: 'submit', env: {}, fetchImpl: () => assert.fail() }), /Missing AMO/);
});
test('Firefox JWT uses short-lived signed claims and unique nonce', () => {
  const a = amoToken(env), b = amoToken(env);
  const claims = JSON.parse(Buffer.from(a.split('.')[1], 'base64url'));
  assert.equal(claims.exp - claims.iat, 60); assert.notEqual(a, b);
});
for (const [status, expected] of [['public', 'published'], ['unreviewed', 'awaiting_review'], ['disabled', 'needs_attention'], ['unexpected', 'needs_attention']]) {
  test(`Firefox ${status} is never uploaded again`, async () => {
    const result = await runFirefox({ version: '1.3.0', mode: 'submit', env, fetchImpl: async () => response([entry(status)]), sign: () => assert.fail('duplicate submission') });
    assert.equal(result.state, expected);
  });
}
test('Firefox existing version without source requires repair instead of reupload', async () => {
  const result = await runFirefox({ version: '1.3.0', mode: 'submit', env, fetchImpl: async () => response([entry('public', { source: null })]), sign: () => assert.fail() });
  assert.equal(result.state, 'needs_attention');
});
test('Firefox status never writes for missing version', async () => {
  const result = await runFirefox({ version: '1.3.0', mode: 'status', env, fetchImpl: async () => response([]), sign: () => assert.fail() });
  assert.equal(result.state, 'not_submitted');
});
test('Firefox reads author-only pending versions across pages', async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    assert.match(options.headers.Authorization, /^JWT /);
    calls++;
    if (calls === 1) { assert.match(url, /filter=all_with_unlisted/); return { ok: true, json: async () => ({ results: [], next: url + '&page=2' }) }; }
    return response([entry()]);
  };
  const result = await runFirefox({ version: '1.3.0', mode: 'submit', env, fetchImpl, sign: () => assert.fail() });
  assert.equal(result.state, 'awaiting_review'); assert.equal(calls, 2);
});
test('Firefox refuses pagination to another origin', async () => {
  await assert.rejects(firefoxVersions(env, async () => ({ ok: true, json: async () => ({ results: [], next: 'https://evil.invalid/' }) })), /pagination/);
});
for (const prior of [entry('public', { version: '1.4.0' }), entry('unreviewed', { version: '1.2.0' })]) {
  test(`Firefox blocks conflicting existing version ${prior.version}`, async () => {
    await assert.rejects(runFirefox({ version: '1.3.0', mode: 'submit', env, fetchImpl: async () => response([prior]), sign: () => assert.fail() }), /version/);
  });
}
test('Firefox successful submission records pending review without waiting', async () => {
  let signs = 0;
  const result = await runFirefox({ version: '1.3.0', mode: 'submit', env, fetchImpl: async () => response(signs ? [entry()] : []), sign: () => { signs++; } });
  assert.equal(signs, 1); assert.equal(result.state, 'awaiting_review'); assert.equal(result.submittedThisRun, true);
});
test('Firefox post-submit status outage stays submitted and does not retry', async () => {
  let signs = 0;
  const result = await runFirefox({ version: '1.3.0', mode: 'submit', env, fetchImpl: async () => { if (signs) throw new Error('offline'); return response([]); }, sign: () => { signs++; } });
  assert.equal(signs, 1); assert.equal(result.state, 'submitted');
});
test('Firefox timeout/partial source upload is not silently treated as success', async () => {
  let signs = 0;
  await assert.rejects(runFirefox({ version: '1.3.0', mode: 'submit', env, fetchImpl: async () => response([]), sign: () => { signs++; throw new Error('interrupted'); } }), /interrupted/);
  assert.equal(signs, 1);
});
test('Firefox preflight HTTP failure blocks submission', async () => {
  await assert.rejects(runFirefox({ version: '1.3.0', mode: 'submit', env, fetchImpl: async () => ({ ok: false, status: 503 }), sign: () => assert.fail() }), /503/);
});
