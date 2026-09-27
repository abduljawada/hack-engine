import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGameServer } from './games/server.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const run = (file, args = []) => new Promise((accept, reject) => {
  const child = spawn(process.execPath, [file, ...args], { cwd: root, stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? accept() : reject(Error(`${file} failed (${code})`)));
});
const server = await startGameServer({ games: [], repoRoot: root });
try {
  await run(join(root, 'test/run-browser-harnesses.mjs'), [server.origin]);
  for (const browser of ['firefox', 'chrome']) await run(join(root, `test/run-${browser}-extension-harness.mjs`), [`${server.origin}/test/firefox-extension-bridge-harness.html`]);
} finally {
  await server.close();
}
