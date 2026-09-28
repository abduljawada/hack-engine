import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync, gzipSync } from "node:zlib";
import { classifySwf, extractArchive, hashDirectory, prepareGames, sha256, verifyAssetDirectory } from "./games/assets.mjs";
import { ADDITIONAL_TARGETS, BROWSERS, GAME_CATALOG, REQUIRED_SCENARIOS, RUFFLE_BUILD, TARGET_SCENARIOS } from "./games/catalog.mjs";
import { createReport, evaluateGate, writeReports } from "./games/report.mjs";
import { resolveStaticPath, startGameServer } from "./games/server.mjs";
async function temporary(context) { const root = await fs.mkdtemp(path.join(os.tmpdir(), "hack-game-test-")); context.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
function swf(avm, compressed = false) {
  const body = Buffer.from([8, 0, 0, 24, 1, 0, 0x44, 0x11, avm === "AVM2" ? 8 : 0, 0, 0, 0, 0, 0]);
  const header = Buffer.alloc(8); header.write(compressed ? "CWS" : "FWS"); header[3] = 10; header.writeUInt32LE(body.length + 8, 4);
  return Buffer.concat([header, compressed ? deflateSync(body) : body]);
}
async function pin(directory, extra = {}) { const hashes = await hashDirectory(directory); await fs.writeFile(path.join(directory, "metadata.json"), JSON.stringify({ source: "https://example.test/game", permission: "Authorized local test copy", hashes, ...extra })); }
function completeReport() {
  const report = createReport();
  for (const item of report.cases) {
    Object.assign(item, { status: "PASS", complete: true, steps: [...REQUIRED_SCENARIOS, "undo-scan", "guarded-undo", ...(item.gameId === "J1" ? ["frame-same", "frame-nested", "frame-cross", "same-origin-isolation", "range-scan", "unknown-scan"] : []), ...(item.browser === "chrome" && ["J1", "W1"].includes(item.gameId) ? ["worker-recovery"] : []), ...(item.gameId.startsWith("F") ? ["pause-resume", "pause-scanning", "pause-cancel", "flash-load", "flash-source-runtime", "flash-manual-pause"] : []), ...(ADDITIONAL_TARGETS[item.gameId] || []).flatMap(target => ["baseline", ...TARGET_SCENARIOS].map(name => `${target}:${name}`))].map((name) => ({ name, phase: name.endsWith("baseline") ? "baseline" : "extension", status: "PASS" })) });
    const game = GAME_CATALOG.find(game => game.id === item.gameId);
    if (game.runtime === "ruffle") {
      const wasmPath = Object.keys(RUFFLE_BUILD.expectedHashes).find(name => name.endsWith(".wasm"));
      const wasmHash = RUFFLE_BUILD.expectedHashes[wasmPath];
      item.hashes = {"game.swf":game.downloadArtifact.sha256};
      item.ruffle = {hashes:{[wasmPath]:wasmHash},provenance:{version:RUFFLE_BUILD.version}};
      item.steps = item.steps.filter(step => step.name !== "flash-load");
      for (const phase of ["baseline","extension"]) {
        item.steps.push({name:"flash-load",phase,status:"PASS",details:{reportedAvm:game.expectedAvm,independentlyParsedAvm:game.expectedAvm}});
        item.steps.push({name:"local-runtime-provenance",phase,status:"PASS",details:{runtime:"ruffle",publicAvm:game.expectedAvm,ruffleVersion:RUFFLE_BUILD.version,
          primarySwf:{url:`http://127.0.0.1:123/games/${game.id}/game.swf`,sha256:game.downloadArtifact.sha256,status:200,independentlyParsedAvm:game.expectedAvm},
          runtimeWasm:[{url:`http://127.0.0.1:123/ruffle/${wasmPath}`,assetPath:wasmPath,sha256:wasmHash,status:200}]}});
      }
    }
  }
  return report;
}
test("game catalog preserves original titles plus the optional AVM1 candidate", () => {
  assert.equal(GAME_CATALOG.length, 9); assert.equal(new Set(GAME_CATALOG.map((item) => item.id)).size, 9); assert.equal(BROWSERS.length, 2);
  assert.equal(createReport().cases.length, 8);
  assert.equal(createReport({gameIds: GAME_CATALOG.map(game => game.id)}).cases.length, 18);
});
test("SWF classification independently checks uncompressed and compressed AVM flags", () => {
  for (const avm of ["AVM1", "AVM2"]) for (const compressed of [false, true]) assert.equal(classifySwf(swf(avm, compressed)), avm);
  assert.throws(() => classifySwf(Buffer.from("not a flash file")), /Expected/);
  const invalid = swf("AVM1"); invalid.writeUInt32LE(999, 4); assert.throws(() => classifySwf(invalid), /length mismatch/);
  assert.throws(() => classifySwf(swf("AVM2").subarray(0, 15)), /length mismatch/);
});
test("asset integrity rejects missing provenance, hash drift, unpinned extras, and symlinks", async (context) => {
  const root = await temporary(context); await fs.writeFile(path.join(root, "game.swf"), swf("AVM1"));
  await assert.rejects(verifyAssetDirectory(root), /ENOENT/);
  await pin(root); assert.equal((await verifyAssetDirectory(root)).hashes["game.swf"], sha256(swf("AVM1")));
  await fs.writeFile(path.join(root, "game.swf"), swf("AVM2")); await assert.rejects(verifyAssetDirectory(root), /hash mismatch/);
  await pin(root); await fs.writeFile(path.join(root, "extra.js"), "changed"); await assert.rejects(verifyAssetDirectory(root), /Unpinned asset/);
  await fs.symlink("game.swf", path.join(root, "linked.swf")); await assert.rejects(hashDirectory(root), /symlink/);
});
test("missing assets are explicit blockers and do not omit any game", async (context) => {
  const root = await temporary(context); const records = await prepareGames({ assetDir: root, download: false });
  assert.equal(records.length, 9); assert.ok(records.every((item) => !item.ready && item.reason.includes("Missing")));
  await assert.rejects(prepareGames({ assetDir: root, gameIds: ["unknown"] }), /Unknown game/);
});
test("catalog Flash assets reject a substituted SWF even when local metadata agrees", async (context) => {
  const root = await temporary(context);
  for (const id of ["F1", "F2", "F4", "F7"]) {
    const game = path.join(root,id); await fs.mkdir(game);
    await fs.writeFile(path.join(game,"game.swf"),swf(id === "F4" ? "AVM2" : "AVM1")); await pin(game);
    const result = (await prepareGames({assetDir:root,gameIds:[id],download:false}))[0];
    assert.equal(result.ready,false);
    assert.match(result.reason,/Pinned upstream hash mismatch/);
  }
});
test("required Flash downloads use their pinned public artifact rather than the MIT repository route", async (context) => {
  const root = await temporary(context), urls = [], original = globalThis.fetch;
  globalThis.fetch = async url => { urls.push(url); return {ok:false,status:503}; };
  try {
    const records = await prepareGames({assetDir:root,gameIds:["F4","F7"]});
    assert.ok(records.every(item=>!item.ready && /HTTP 503/.test(item.reason)));
    assert.deepEqual(urls,GAME_CATALOG.filter(game=>["F4","F7"].includes(game.id)).map(game=>game.downloadArtifact.url));
  } finally {globalThis.fetch=original;}
});
test("archive extraction rejects traversal and symlink members", async (context) => {
  const root = await temporary(context);
  function archive(name, type = "0") { const header = Buffer.alloc(512); header.write(name, 0); header.write("00000000000\0", 124); header.write(type, 156); header.fill(32, 148, 156); const checksum = header.reduce((sum, byte) => sum + byte, 0); header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148); return gzipSync(Buffer.concat([header, Buffer.alloc(1024)])); }
  await assert.rejects(extractArchive(archive("root/../../escape"), root), /Unsafe/);
  await assert.rejects(extractArchive(archive("root/link", "2"), root), /Forbidden/);
});
test("strict gate requires full matrix, successful required steps, and explicit completion", () => {
  const report = completeReport(); assert.equal(evaluateGate(report, { strict: true }).passed, true);
  report.cases.pop(); assert.equal(evaluateGate(report, { strict: true }).passed, false);
  const duplicate = completeReport(); duplicate.cases.push(duplicate.cases[0]); assert.equal(evaluateGate(duplicate, { strict: true }).passed, false);
  const incomplete = completeReport(); delete incomplete.cases[0].complete; assert.equal(evaluateGate(incomplete, { strict: true }).passed, false);
  const missingStep = completeReport(); missingStep.cases[0].steps.pop(); assert.equal(evaluateGate(missingStep, { strict: true }).passed, false);
});
test("selected gate rejects unavailable required Flash games and any actual failure", () => {
  const report = completeReport(); for (const item of report.cases.filter((item) => item.gameId.startsWith("F"))) item.status = "BLOCKED";
  assert.equal(evaluateGate(report).passed, false); assert.equal(evaluateGate(report, { strict: true }).passed, false);
  report.cases[0].status = "BLOCKED"; assert.equal(evaluateGate(report).passed, false); report.cases[0].status = "PASS";
  report.cases.at(-1).status = "FAIL"; assert.equal(evaluateGate(report).passed, false);
});
test("reports preserve failures, blockers, evidence and escape HTML/XML", async (context) => {
  const root = await temporary(context); const report = createReport(); report.cases[0].reason = '<script>alert("x")</script>'; report.cases[0].status = "FAIL";
  const files = await writeReports(report, root); const html = await fs.readFile(files.html, "utf8"); const xml = await fs.readFile(files.junit, "utf8");
  assert.ok(html.includes("&lt;script&gt;")); assert.ok(!html.includes('<script>alert')); assert.ok(xml.includes('failures="2"')); assert.ok(xml.includes('skipped="7"')); assert.deepEqual(JSON.parse(await fs.readFile(files.json, "utf8")), report);
});
test("static file resolution rejects traversal and symlink escapes", async (context) => {
  const root = await temporary(context); const served = path.join(root, "served"); await fs.mkdir(served); await fs.writeFile(path.join(root, "secret"), "secret"); await fs.symlink(path.join(root, "secret"), path.join(served, "leak"));
  await assert.rejects(resolveStaticPath(served, "../secret"), /Forbidden/); await assert.rejects(resolveStaticPath(served, "leak"), /Forbidden/);
});
test("loopback servers serve game assets and nested/cross-origin wrappers then clean up", async (context) => {
  const root = await temporary(context); await fs.writeFile(path.join(root, "index.html"), "original game");
  const server = await startGameServer({ games: [{ ready: true, game: GAME_CATALOG[0], directory: root, entry: "index.html" }], repoRoot: root }); context.after(() => server.close());
  assert.equal(await (await fetch(server.urlFor("J1"))).text(), "original game");
  assert.ok((await (await fetch(server.wrapperUrl({ gameId: "J1", mode: "cross" }))).text()).includes(server.crossOrigin));
  assert.ok((await (await fetch(server.wrapperUrl({ gameId: "J1", mode: "nested" }))).text()).includes("mode=same"));
  assert.equal((await fetch(`${server.origin}/games/J1/%2e%2e%2fsecret`)).status, 403);
  await server.close(); await assert.rejects(fetch(server.origin));
});
test("failed downloads preserve blockers, reject upstream hash changes, and leave no temporary assets", async (context) => {
  const root = await temporary(context); const originalFetch = globalThis.fetch; context.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => swf("AVM1") });
  const wrongHash = (await prepareGames({ assetDir: root, gameIds: ["F1"] }))[0];
  assert.equal(wrongHash.ready, false); assert.match(wrongHash.reason, /Pinned upstream hash mismatch/); assert.deepEqual(await fs.readdir(root), []);
  globalThis.fetch = async () => { throw new DOMException("Download timed out", "TimeoutError"); };
  const timeout = (await prepareGames({ assetDir: root, gameIds: ["J1"] }))[0];
  assert.equal(timeout.ready, false); assert.match(timeout.reason, /timed out/); assert.deepEqual(await fs.readdir(root), []);
});

test('strict controlled core rejects absent or mismatched same-run Flash evidence in either phase', () => {
  for (const phase of ['baseline','extension']) for (const defect of ['primary','wasm','avm','version','missing']) {
    const report = completeReport();
    const entry = report.cases.find(item => item.gameId === 'F7' && item.browser === 'firefox');
    const step = entry.steps.find(step => step.name === 'local-runtime-provenance' && step.phase === phase);
    if (defect === 'primary') step.details.primarySwf.sha256 = 'f'.repeat(64);
    if (defect === 'wasm') step.details.runtimeWasm[0].sha256 = 'f'.repeat(64);
    if (defect === 'avm') step.details.publicAvm = 'AVM2';
    if (defect === 'version') step.details.ruffleVersion = 'unpinned';
    if (defect === 'missing') entry.steps = entry.steps.filter(item => item !== step);
    assert.equal(evaluateGate(report, {strict:true}).passed, false, `${phase}/${defect}`);
  }
});

test('controlled Flash host preserves original 640x480 geometry and does not serve remote game code', async context => {
  const root = await temporary(context);
  const game = GAME_CATALOG.find(game => game.id === 'F4');
  const server = await startGameServer({games:[{ready:true,game,directory:root,entry:'__flash__.html',ruffle:{directory:root}}],repoRoot:root});
  context.after(() => server.close());
  const page = await (await fetch(server.urlFor('F4'))).text();
  assert.match(page, /width:640px;height:480px/);
  assert.match(page, /overflow:hidden/);
  assert.match(page, /url:"game.swf"/);
  assert.match(page, /allowNetworking:"none"/);
  assert.doesNotMatch(page, /<script src="https?:/);
});


test('controlled assets declare the exact served byte length for GET and HEAD', async context => {
  const root = await temporary(context);
  const body = Buffer.from([0, 97, 115, 109, 255, 128, 10]);
  await fs.writeFile(path.join(root, 'runtime.wasm'), body);
  const server = await startGameServer({games:[{ready:true,game:GAME_CATALOG[0],directory:root,entry:'runtime.wasm'}],repoRoot:root});
  context.after(()=>server.close());
  const response = await fetch(server.urlFor('J1'));
  assert.equal(response.headers.get('content-length'), String(body.length));
  assert.equal(response.headers.get('content-encoding'), null);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), body);
  const head = await fetch(server.urlFor('J1'), {method:'HEAD'});
  assert.equal(head.headers.get('content-length'), String(body.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});
