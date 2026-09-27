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
