import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runChrome, classifyChromeStatus } from '../scripts/store-chrome.mjs';

const env = { CHROME_PUBLISHER_ID: 'publisher', CHROME_EXTENSION_ID: 'extension', CHROME_CLIENT_ID: 'client', CHROME_CLIENT_SECRET: 'SECRET', CHROME_REFRESH_TOKEN: 'REFRESH' };
const revision = (version, state = 'PUBLISHED') => ({ state, distributionChannels: [{ crxVersion: version }] });
const old = { publishedItemRevisionStatus: revision('1.2.0') };
function mock(responses) {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => {
    calls.push({ url, ...init });
    assert.ok(responses.length, 'unexpected API request');
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return { ok: true, status: 200, json: async () => response };
  } };
}
const auth = { access_token: 'ACCESS_SECRET' };
const options = { version: '1.3.0', env };

test('Chrome missing configuration fails before network access', async () => {
  await assert.rejects(runChrome({ ...options, env: {}, fetchImpl: () => assert.fail('network') }), /Missing Chrome configuration/);
});

test('Chrome status is read only, including when upload would be possible', async () => {
  const api = mock([auth, old]);
  const result = await runChrome({ ...options, ...api, mode: 'status' });
  assert.equal(result.state, 'not_submitted');
  assert.equal(api.calls.length, 2);
  assert.equal(api.calls[1].method, 'GET');
});

for (const [state, status] of [
  ['published', { publishedItemRevisionStatus: revision('1.3.0') }],
  ['awaiting_review', { ...old, submittedItemRevisionStatus: revision('1.3.0', 'PENDING_REVIEW') }],
  ['needs_attention', { ...old, submittedItemRevisionStatus: revision('1.3.0', 'STAGED') }],
  ['needs_attention', { ...old, submittedItemRevisionStatus: revision('1.3.0', 'REJECTED') }],
  ['needs_attention', { ...old, submittedItemRevisionStatus: revision('1.4.0', 'PENDING_REVIEW') }],
  ['needs_attention', { publishedItemRevisionStatus: revision('1.4.0') }],
  ['needs_attention', {}],
  ['needs_attention', { ...old, lastAsyncUploadState: 'SUCCEEDED' }],
  ['upload_processing', { ...old, lastAsyncUploadState: 'IN_PROGRESS' }],
  ['needs_attention', { ...old, warned: true }],
]) {
  test(`Chrome duplicate/ambiguous guard: ${JSON.stringify(status)}`, async () => {
    const api = mock([auth, status]);
    const result = await runChrome({ ...options, ...api, mode: 'submit' });
    assert.equal(result.state, state);
    assert.equal(api.calls.length, 2);
  });
}

async function withArchive(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'chrome-release-test-'));
  const archivePath = join(directory, 'chrome.zip');
  await writeFile(archivePath, 'test zip');
  try { await fn(archivePath); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('Chrome submits verified upload for normal review and automatic publication', async () => {
  await withArchive(async archivePath => {
    const api = mock([auth, old, { uploadState: 'SUCCEEDED', crxVersion: '1.3.0' }, { state: 'PENDING_REVIEW' }]);
    const result = await runChrome({ ...options, ...api, archivePath, mode: 'submit' });
    assert.equal(result.state, 'awaiting_review');
    assert.equal(api.calls.length, 4);
    assert.match(api.calls[2].url, /\/upload\/v2\/publishers\/publisher\/items\/extension:upload$/);
    assert.equal(api.calls[2].body.toString(), 'test zip');
    assert.deepEqual(JSON.parse(api.calls[3].body), { publishType: 'DEFAULT_PUBLISH', skipReview: false, blockOnWarnings: true });
    assert.ok(!JSON.stringify(result).includes('SECRET'));
  });
});

for (const upload of [new Error('SECRET REFRESH'), { uploadState: 'IN_PROGRESS' }, { uploadState: 'FAILED' }, { uploadState: 'SUCCEEDED', crxVersion: '1.2.0' }]) {
  test(`Chrome does not retry uncertain/failed upload: ${JSON.stringify(upload)}`, async () => {
    await withArchive(async archivePath => {
      const api = mock([auth, old, upload]);
      const result = await runChrome({ ...options, ...api, archivePath, mode: 'submit' });
      assert.ok(['needs_attention', 'upload_processing'].includes(result.state));
      assert.equal(api.calls.length, 3);
      assert.ok(!JSON.stringify(result).includes('SECRET'));
    });
  });
}

test('Chrome never repeats publish after an uncertain response', async () => {
  await withArchive(async archivePath => {
    const api = mock([auth, old, { uploadState: 'SUCCEEDED', crxVersion: '1.3.0' }, new Error('ACCESS_SECRET')]);
    const result = await runChrome({ ...options, ...api, archivePath, mode: 'submit' });
    assert.equal(result.state, 'needs_attention');
    assert.equal(api.calls.length, 4);
    assert.ok(!JSON.stringify(result).includes('SECRET'));
  });
});

test('Chrome authentication API failure is sanitized and never uploads', async () => {
  let calls = 0;
  await assert.rejects(runChrome({ ...options, mode: 'submit', fetchImpl: async () => {
    calls += 1;
    return { ok: false, status: 401, json: async () => ({ error: 'SECRET' }) };
  } }), error => /HTTP 401/.test(error.message) && !error.message.includes('SECRET'));
  assert.equal(calls, 1);
});

test('Chrome malformed status fails closed', () => {
  for (const value of [null, [], 'bad', {}]) assert.equal(classifyChromeStatus(value, '1.3.0').state, 'needs_attention');
});

test('Chrome attempt record failure prevents upload', async () => {
  await withArchive(async archivePath => {
    const api = mock([auth, old]);
    let attempts = 0;
    await assert.rejects(runChrome({ ...options, ...api, archivePath, mode: 'submit', beforeUpload: async () => {
      attempts += 1;
      throw new Error('Attempt record unavailable');
    } }), /Attempt record unavailable/);
    assert.equal(attempts, 1);
    assert.equal(api.calls.length, 2);
  });
});

test('Chrome records an attempt exactly once immediately before uploading', async () => {
  await withArchive(async archivePath => {
    const api = mock([auth, old, { uploadState: 'SUCCEEDED', crxVersion: '1.3.0' }, { state: 'PENDING_REVIEW' }]);
    let attempts = 0;
    await runChrome({ ...options, ...api, archivePath, mode: 'submit', beforeUpload: async () => {
      attempts += 1;
      assert.equal(api.calls.length, 2);
    } });
    assert.equal(attempts, 1);
    assert.equal(api.calls.length, 4);
  });
});

test('Chrome status and existing submissions never create attempt records', async () => {
  for (const [mode, status] of [
    ['status', old],
    ['submit', { publishedItemRevisionStatus: revision('1.3.0') }],
    ['submit', { ...old, submittedItemRevisionStatus: revision('1.3.0', 'PENDING_REVIEW') }],
  ]) {
    const api = mock([auth, status]);
    await runChrome({ ...options, ...api, mode, beforeUpload: async () => assert.fail('unexpected attempt record') });
    assert.equal(api.calls.length, 2);
  }
});
