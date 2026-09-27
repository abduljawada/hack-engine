import { createHmac, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { ADDON_ID } from './release-preflight.mjs';

const base = `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(ADDON_ID)}/`;
export function amoToken(env) {
  for (const key of ['AMO_JWT_ISSUER', 'AMO_JWT_SECRET']) if (!env[key]) throw new Error(`Missing ${key}.`);
  const iat = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: env.AMO_JWT_ISSUER, jti: randomUUID(), iat, exp: iat + 60 })}`;
  return `${body}.${createHmac('sha256', env.AMO_JWT_SECRET).update(body).digest('base64url')}`;
}
export function classifyFirefox(entry, version) {
  if (!entry) return { state: 'not_submitted', version };
  const common = { version, storeVersionId: entry.id, storeStatus: entry.file?.status };
  if (entry.channel !== 'listed' || entry.is_disabled || !entry.source) return { ...common, state: 'needs_attention', reason: 'Existing version is disabled, not listed, or lacks its source archive; inspect AMO before any retry.' };
  if (entry.file?.status === 'public') return { ...common, state: 'published' };
  if (entry.file?.status === 'unreviewed') return { ...common, state: 'awaiting_review' };
  return { ...common, state: 'needs_attention', reason: 'Existing version requires dashboard review; it will not be uploaded again.' };
}
export async function firefoxVersions(env, fetchImpl = fetch) {
  // The author-only filter is essential: the default list hides pending/rejected versions.
  let url = `${base}versions/?filter=all_with_unlisted&page_size=50`;
  const versions = [], seen = new Set();
  while (url) {
    if (!url.startsWith(`${base}versions/`) || seen.has(url) || seen.size >= 100) throw new Error('Unexpected AMO pagination.');
    seen.add(url);
    let response;
    try { response = await fetchImpl(url, { headers: { Authorization: `JWT ${amoToken(env)}` }, signal: AbortSignal.timeout(30000), redirect: 'error' }); }
    catch { throw new Error('AMO status request failed; no submission is safe until status can be checked.'); }
    if (!response.ok) throw new Error(`AMO status request failed (HTTP ${response.status}).`);
    const page = await response.json();
    if (!Array.isArray(page.results)) throw new Error('Unexpected AMO version response.');
    versions.push(...page.results);
    url = page.next;
  }
  return versions;
}
export function signFirefox({ version, env }) {
  const result = spawnSync(process.execPath, [
    'node_modules/web-ext/bin/web-ext.js', 'sign', '--channel=listed',
    '--source-dir=dist/firefox', '--artifacts-dir=artifacts/store-release/firefox',
    '--amo-metadata=artifacts/store-release/amo-metadata.json',
    `--upload-source-code=dist/hack-engine-source-v${version}.zip`,
    '--no-config-discovery', '--approval-timeout=0', '--timeout=300000', '--no-input',
  ], {
    env: { ...process.env, ...env, WEB_EXT_API_KEY: env.AMO_JWT_ISSUER, WEB_EXT_API_SECRET: env.AMO_JWT_SECRET },
    encoding: 'utf8', timeout: 600000, maxBuffer: 4 * 1024 * 1024,
  });
  // Never echo web-ext's raw API responses or credentials into logs/artifacts.
  if (result.error || result.status !== 0) throw new Error('Firefox submission did not finish cleanly. Inspect AMO and run status before retrying; the upload or source patch may have succeeded.');
}
export async function runFirefox({ version, mode, env = process.env, fetchImpl = fetch, sign = signFirefox }) {
  if (!['status', 'submit'].includes(mode)) throw new Error('Invalid Firefox operation.');
  amoToken(env);
  const versions = await firefoxVersions(env, fetchImpl);
  const existing = versions.find(v => v.version === version);
  if (existing || mode === 'status') return classifyFirefox(existing, version);
  if (versions.some(v => v.channel === 'listed' && v.file?.status === 'unreviewed')) throw new Error('Another Firefox version is awaiting review; resolve it before submitting.');
  const compare = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
  if (versions.some(v => /^\d+(\.\d+)*$/.test(v.version) && compare(v.version, version) >= 0)) throw new Error('A newer or equivalent Firefox version already exists.');
  await sign({ version, env });
  try {
    const after = (await firefoxVersions(env, fetchImpl)).find(v => v.version === version);
    if (after) return { ...classifyFirefox(after, version), submittedThisRun: true };
  } catch { /* Submission succeeded; read failure is not permission to upload again. */ }
  return { state: 'submitted', version, submittedThisRun: true, reason: 'Submission completed; check status later to confirm review/publication.' };
}
