import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { validateVersions, releaseNotes, ADDON_ID } from '../scripts/release-preflight.mjs';
const manifest = { version: '1.3.0', browser_specific_settings: { gecko: { id: ADDON_ID } } };
const pkg = { version: '1.3.0' };
const lock = { ...pkg, packages: { '': pkg } };
test('release versions must agree with stable tag and permanent identity', () => {
  assert.equal(validateVersions('v1.3.0', manifest, pkg, lock), '1.3.0');
  for (const tag of ['v1.3.0-rc1', 'main', 'v01.3.0', 'v1.2.0', 'v1.3.0+build']) assert.throws(() => validateVersions(tag, manifest, pkg, lock));
  assert.throws(() => validateVersions('v1.3.0', manifest, { version: '1.2.0' }, lock), /match/);
  assert.throws(() => validateVersions('v1.3.0', manifest, pkg, { version: '1.2.0' }), /match/);
  assert.throws(() => validateVersions('v1.3.0', { ...manifest, browser_specific_settings: {} }, pkg, lock), /ID/);
});
test('notes use exactly the selected version and require content', () => {
  assert.equal(releaseNotes('# Log\n\n## [1.3.0] - today\n\nFix scan.\n\n## [1.2.0]\nOld.\n', '1.3.0'), 'Fix scan.');
  assert.throws(() => releaseNotes('## [1.2.0]\nOld', '1.3.0'), /Missing/);
  assert.throws(() => releaseNotes('## [1.3.0]\n', '1.3.0'), /empty/);
});
test('actual git ancestry, tag identity and artifact identity are required', () => {
  const dir = mkdtempSync(join(tmpdir(), 'release-preflight-'));
  const script = resolve('scripts/release-preflight.mjs');
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' }).toString().trim();
  const run = (extra = {}) => spawnSync(process.execPath, [script], { cwd: dir, encoding: 'utf8', env: { ...process.env, RELEASE_TAG: 'v1.3.0', REQUIRE_RELEASE_RECORD: 'false', GITHUB_OUTPUT: '', ...extra } });
  try {
    git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    for (const [file, data] of [['manifest.json', manifest], ['package.json', pkg], ['package-lock.json', lock]]) writeFileSync(join(dir, file), JSON.stringify(data));
    writeFileSync(join(dir, 'CHANGELOG.md'), '## [1.3.0]\nRelease notes.\n');
    git('add', '.'); git('commit', '-m', 'fixture'); git('tag', 'v1.3.0');
    git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    assert.equal(run().status, 0);
    assert.equal(run({ REQUIRE_RELEASE_RECORD: 'true' }).status, 0);
    writeFileSync(join(dir, 'artifacts/store-release/release.json'), JSON.stringify({ tag: 'v1.3.0', version: '1.3.0', commit: 'b'.repeat(40) }));
    assert.match(run({ REQUIRE_RELEASE_RECORD: 'true' }).stderr, /artifact identity/);
    git('commit', '--allow-empty', '-m', 'not on remote main'); git('tag', 'v1.3.1');
    assert.match(run().stderr, /Checkout/);
    for (const file of ['manifest.json', 'package.json', 'package-lock.json']) {
      const value = file === 'manifest.json' ? { ...manifest, version: '1.3.1' } : file === 'package.json' ? { version: '1.3.1' } : { version: '1.3.1', packages: { '': { version: '1.3.1' } } };
      writeFileSync(join(dir, file), JSON.stringify(value));
    }
    assert.match(run({ RELEASE_TAG: 'v1.3.1' }).stderr, /not on origin\/main/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
