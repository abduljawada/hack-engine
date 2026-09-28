import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
const workflow = yaml.load(readFileSync('.github/workflows/release.yml', 'utf8'));
test('both submission jobs depend on successful strict qualification', () => {
  for (const store of ['firefox', 'chrome']) {
    assert.equal(workflow.jobs[store].needs, 'prepare');
    assert.doesNotMatch(workflow.jobs[store].if, /always/);
  }
  const steps = workflow.jobs.prepare.steps;
  assert.ok(steps.some(s => s.run?.includes('--strict')));
  assert.ok(steps.some(s => s.run?.includes('npm run lint:firefox')));
  assert.ok(steps.filter(s => s.run).every(s => !s['continue-on-error']));
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
});
test('Chrome switch does not gate Firefox; status bypasses build', () => {
  assert.match(workflow.jobs.chrome.if, /CHROME_PUBLISH_ENABLED == 'true'/);
  assert.doesNotMatch(workflow.jobs.firefox.if, /CHROME/);
  const build = workflow.jobs.prepare.steps.find(s => s.run?.includes('npm run build:source'));
  assert.equal(build.if, "inputs.operation != 'status'");
  assert.equal(workflow.on.workflow_dispatch.inputs.operation.default, 'status');
});
test('disabled Chrome CLI needs neither store credentials nor network access', () => {
  const dir = mkdtempSync(join(tmpdir(), 'store-disabled-'));
  try {
    mkdirSync(join(dir, 'artifacts/store-release'), { recursive: true });
    writeFileSync(join(dir, 'artifacts/store-release/release.json'), JSON.stringify({ version: '1.3.0' }));
    const result = spawnSync(process.execPath, [resolve('scripts/store-release.mjs'), 'chrome', 'submit'], { cwd: dir, encoding: 'utf8', env: { ...process.env, CHROME_PUBLISH_ENABLED: 'false', GITHUB_STEP_SUMMARY: '' } });
    assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).state, 'disabled');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('runner, CI, package release command and store gate share the eight controlled configurations', async () => {
  const { parseOptions } = await import('./run-games.mjs');
  const { RELEASE_GAME_IDS, BROWSERS } = await import('./games/catalog.mjs');
  const { createReport } = await import('./games/report.mjs');
  assert.deepEqual([...RELEASE_GAME_IDS], ['J1', 'W1', 'F2', 'F4']);
  assert.deepEqual(BROWSERS, ['firefox', 'chrome']);
  const ci = yaml.load(readFileSync('.github/workflows/tests.yml', 'utf8'));
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const commands = [pkg.scripts['release:verify'], ...ci.jobs.test.steps.map(s => s.run || ''), ...workflow.jobs.prepare.steps.map(s => s.run || '')];
  const coreCommands = commands.flatMap(command => command.split('&&')).filter(command => command.includes('--mode local'));
  assert.equal(coreCommands.length, 3);
  for (const command of coreCommands) {
    const args = command.trim().split(/\s+/).slice(command.trim().split(/\s+/).indexOf('--') + 1);
    const options = parseOptions(args);
    assert.equal(options.strict, true);
    assert.equal(options.mode, "local");
    assert.deepEqual(options.gameIds, [...RELEASE_GAME_IDS]);
    assert.deepEqual(options.browsers, BROWSERS);
    assert.equal(createReport(options).cases.length, 8);
  }
  assert.equal(ci.on.workflow_dispatch, null);
  assert.ok(ci.jobs.test.steps.some(s => s.run?.includes('GAME_BROWSER_NO_SANDBOX=1')));
});

test('live compatibility is separate, explicit, and cannot silently pass a blocked run', () => {
  const compatibility = yaml.load(readFileSync('.github/workflows/compatibility.yml', 'utf8'));
  assert.match(compatibility.name,/advisory/);
  assert.ok(compatibility.jobs.compatibility.steps.some(step => step.run?.includes('--mode website') && step.run.includes('--strict')));
  assert.ok(compatibility.jobs.compatibility.steps.every(step=>!step['continue-on-error']));
  assert.ok(!Object.values(workflow.jobs).some(job=>String(job.needs).includes('compatibility')));
});
