import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ADDON_ID = 'hack-engine@abduljawada.github.io';
export function validateVersions(tag, manifest, pkg, lock) {
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(tag || '')) throw new Error('A stable vX.Y.Z tag is required.');
  const version = tag.slice(1);
  if ([manifest.version, pkg.version, lock.version, lock.packages?.['']?.version].some(v => v !== version)) throw new Error('Tag, manifest, package and lockfile versions must match.');
  if (manifest.browser_specific_settings?.gecko?.id !== ADDON_ID) throw new Error('The permanent Firefox add-on ID changed.');
  return version;
}
export function releaseNotes(changelog, version) {
  const sections = changelog.split(/^## /m).slice(1);
  const section = sections.find(s => s.startsWith(`[${version}]`));
  if (!section) throw new Error('Missing version release notes in CHANGELOG.md.');
  const notes = section.slice(section.indexOf('\n') + 1).trim();
  if (!notes) throw new Error('Version release notes are empty.');
  return notes;
}
export function preflight(tag) {
  const json = p => JSON.parse(readFileSync(p, 'utf8'));
  const version = validateVersions(tag, json('manifest.json'), json('package.json'), json('package-lock.json'));
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = git('rev-parse', 'HEAD');
  if (git('rev-parse', `refs/tags/${tag}^{commit}`) !== commit) throw new Error('Checkout does not match the release tag.');
  try { git('merge-base', '--is-ancestor', commit, 'refs/remotes/origin/main'); }
  catch { throw new Error('Release commit is not on origin/main.'); }
  const notes = releaseNotes(readFileSync('CHANGELOG.md', 'utf8'), version);
  const record = { tag, version, commit, addonId: ADDON_ID };
  if (process.env.REQUIRE_RELEASE_RECORD === 'true') {
    const expected = json('artifacts/store-release/release.json');
    if (expected.tag !== tag || expected.commit !== commit || expected.version !== version) throw new Error('Release artifact identity differs from the checkout.');
  }
  mkdirSync('artifacts/store-release', { recursive: true });
  writeFileSync('artifacts/store-release/release.json', JSON.stringify(record, null, 2) + '\n');
  writeFileSync('artifacts/store-release/amo-metadata.json', JSON.stringify({ version: { release_notes: { 'en-US': notes } } }, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ncommit=${commit}\n`);
  return record;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(preflight(process.env.RELEASE_TAG))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
