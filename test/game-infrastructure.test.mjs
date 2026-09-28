import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateSync, gzipSync } from "node:zlib";
import { classifySwf, extractArchive, hashDirectory, prepareGames, sha256, verifyAssetDirectory } from "./games/assets.mjs";
import { ADDITIONAL_TARGETS, BROWSERS, GAME_CATALOG, REQUIRED_SCENARIOS, TARGET_SCENARIOS } from "./games/catalog.mjs";
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
  }
  return report;
}
test("game catalog preserves all eight titles and 16 browser combinations", () => {
  assert.equal(GAME_CATALOG.length, 8); assert.equal(new Set(GAME_CATALOG.map((item) => item.id)).size, 8); assert.equal(BROWSERS.length, 2);
  assert.equal(createReport().cases.length, 8);
  assert.equal(createReport({gameIds: GAME_CATALOG.map(game => game.id)}).cases.length, 16);
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
  assert.equal(records.length, 8); assert.ok(records.every((item) => !item.ready && item.reason.includes("Missing")));
  await assert.rejects(prepareGames({ assetDir: root, gameIds: ["unknown"] }), /Unknown game/);
});
test("Flash assets require matching AVM, hashed recipes, and pinned Ruffle", async (context) => {
  const root = await temporary(context); const game = path.join(root, "F1"); const ruffle = path.join(root, "ruffle");
  await fs.mkdir(game); await fs.mkdir(ruffle); await fs.writeFile(path.join(game, "game.swf"), swf("AVM2")); await pin(game);
  assert.match((await prepareGames({ assetDir: root, gameIds: ["F1"] }))[0].reason, /runtime mismatch/);
  await fs.writeFile(path.join(game, "game.swf"), swf("AVM1")); await fs.writeFile(path.join(game, "scenario.json"), "{}"); await pin(game);
  assert.equal((await prepareGames({ assetDir: root, gameIds: ["F1"] }))[0].ready, false);
  await fs.writeFile(path.join(ruffle, "ruffle.js"), "// runtime"); await fs.writeFile(path.join(ruffle, "runtime.wasm"), "wasm"); await pin(ruffle, { version: "test-pinned" });
  const ready = (await prepareGames({ assetDir: root, gameIds: ["F1"] }))[0]; assert.equal(ready.ready, true); assert.equal(ready.avm, "AVM1"); assert.equal(ready.recipePath, path.join(game, "scenario.json"));
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
