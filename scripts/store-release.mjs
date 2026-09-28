import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { recordAttempt } from './store-attempt.mjs';
import { runFirefox, signFirefox } from './store-firefox.mjs';
import { runChrome } from './store-chrome.mjs';

const [store, mode] = process.argv.slice(2);
const outputDir = 'artifacts/store-release';
mkdirSync(outputDir, { recursive: true });
let result;
try {
  if (!['firefox', 'chrome'].includes(store) || !['status', 'submit'].includes(mode)) throw new Error('Usage: store-release.mjs firefox|chrome status|submit');
  const record = JSON.parse(readFileSync(`${outputDir}/release.json`, 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(record.version)) throw new Error('Invalid release record.');
  if (store === 'chrome' && process.env.CHROME_PUBLISH_ENABLED !== 'true') {
    result = { state: 'disabled', version: record.version };
  } else {
    const run = store === 'firefox' ? runFirefox : runChrome;
    const beforeUpload = () => recordAttempt({ store, version: record.version, commit: record.commit });
    result = await run({ version: record.version, archivePath: `dist/hack-engine-${store}-v${record.version}.zip`, mode, env: process.env, beforeUpload, sign: async args => { await beforeUpload(); return signFirefox(args); } });
  }
  result = { store, mode, ...record, ...result };
  if (['needs_attention', 'failed'].includes(result.state)) process.exitCode = 1;
} catch (error) {
  result = { store, mode, state: 'failed', reason: error.message };
  process.exitCode = 1;
}
writeFileSync(`${outputDir}/${store === 'chrome' ? 'chrome' : 'firefox'}-result.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  `### ${result.store}: ${result.state}\n\nVersion: ${result.version || 'unknown'}\n\n${result.reason || ''}\n\nStore review and public availability are separate from workflow success.\n`);
