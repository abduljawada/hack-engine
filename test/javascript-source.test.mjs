import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const source = readFileSync(new URL("../javascript-source.js", import.meta.url), "utf8");
function setup(code = "", yieldToPage = async () => {}) {
  const context = vm.createContext({});
  vm.runInContext(code, context);
  vm.runInContext(source, context);
  const backend = context.__hackEngineJavaScript({ documentId: "doc-1", yieldToPage });
  return { context, backend, run: (text) => vm.runInContext(text, context) };
}
test("finds nested numbers, arrays, typed arrays and read-only values without invoking getters", async () => {
  const { backend, run } = setup(`globalThis.game = { score: 10, nested: { health: 5 }, list: [3], bytes: new Uint8Array([7]) }; game.loop = game; Object.defineProperty(game, 'getter', { get() { throw Error('must not execute'); } }); Object.defineProperty(game, 'fixed', { value: 2 }); game.bad = Infinity;`);
  const scan = await backend.discover({ requestId: "a" });
  const paths = scan.entries.map((e) => e.displayPath);
  for (const path of ["game.score", "game.nested.health", 'game.list["0"]', 'game.bytes["0"]', "game.fixed"]) assert.ok(paths.includes(path), path);
  assert.equal(scan.coverage.complete, true);
  assert.ok(!paths.includes("game.bad"));
  const score = scan.entries.find((e) => e.displayPath === "game.score");
  assert.equal(backend.write(score.address, 20), 20); assert.equal(run("game.score"), 20);
  const fixed = scan.entries.find((e) => e.displayPath === "game.fixed");
  assert.equal(fixed.writable, false); assert.throws(() => backend.write(fixed.address, 3), /read-only/);
  const bytes = scan.entries.find((e) => e.displayPath === 'game.bytes["0"]');
  assert.throws(() => backend.write(bytes.address, 999), /verification/);
  assert.equal(backend.read(bytes.address), 7);
  assert.throws(() => backend.write(score.address, Infinity), /finite/);
});
test("rescans retain opaque identities, while replacement, deletion and accessor conversion permanently invalidate handles", async () => {
  const { backend, run } = setup("globalThis.game = { nested: { score: 10 } }");
  const first = backend.resolve(["game", "nested", "score"]);
  assert.equal((await backend.discover()).entries.find((e) => e.displayPath === first.displayPath).address, first.address);
  run("globalThis.old = game.nested; game.nested = { score: 10 }");
  assert.throws(() => backend.read(first.address), /stale/);
  run("game.nested = old"); assert.throws(() => backend.write(first.address, 30), /stale/);
  const next = backend.resolve(["game", "nested", "score"]); assert.notEqual(next.address, first.address);
  run("delete game.nested.score"); assert.throws(() => backend.read(next.address), /stale/);
  run("game.nested.score = 2"); const last = backend.resolve(["game", "nested", "score"]);
  run("Object.defineProperty(game.nested, 'score', { get() { throw Error('getter executed'); } })");
  assert.throws(() => backend.read(last.address), /stale/);
});
test("root selection and restored paths reject unsafe, inherited, accessor and stale paths", async () => {
  const { backend } = setup("globalThis.game = { one: { score: 1 }, two: { score: 2 } }; globalThis.secret = new Map([['score', 3]]);");
  const results = await backend.discover({ rootPath: ["game", "one"] });
  assert.equal(results.entries.length, 1); assert.equal(results.entries[0].value, 1);
  for (const path of [["game", "__proto__"], ["game", "constructor"], ["game", "missing"], ["secret", "score"], "game.one.score"]) assert.throws(() => backend.resolve(path));
  assert.throws(() => backend.read(1_000_000), /stale/);
  assert.equal(backend.describe().id, "doc-1.js");
});
test("depth and property budgets visibly truncate discovery and yield cancellation", async () => {
  const deep = setup("globalThis.game = {}; let n = game; for(let i=0;i<12;i++){n.child={};n=n.child;} n.score=1;");
  const depth = await deep.backend.discover(); assert.equal(depth.coverage.complete, false); assert.ok(depth.coverage.reasons.includes("depth limit"));
  const large = setup("globalThis.game = new Float64Array(100005)");
  const result = await large.backend.discover(); assert.equal(result.coverage.properties, 100000); assert.equal(result.coverage.complete, false);
  let ticks = 0;
  const cancelled = setup("globalThis.game = new Float64Array(100005)", async (requestId) => { assert.equal(requestId, "cancel"); if (++ticks === 3) throw new DOMException("Cancelled", "AbortError"); });
  await assert.rejects(cancelled.backend.discover({ requestId: "cancel" }), { name: "AbortError" });
});
test("objects replaced during a yielded scan do not produce live candidates for old state", async () => {
  let env; let count = 0;
  env = setup("globalThis.game = { values: new Float64Array(2000) }", async () => { if (++count === 2) env.run("game = { values: new Float64Array(2000) }"); });
  const result = await env.backend.discover();
  assert.equal(result.coverage.complete, false);
  for (const entry of result.entries) assert.throws(() => env.backend.read(entry.address), /stale/);
});
test("browser numeric globals are excluded, custom root numbers stay discoverable", async () => {
  const { backend, run } = setup("globalThis.innerWidth=1000; globalThis.devicePixelRatio=2; globalThis.score=42;");
  run("innerWidth=2000");
  const result = await backend.discover();
  assert.deepEqual(Array.from(result.entries, (entry) => entry.displayPath), ["score"]);
  assert.equal(result.coverage.properties, 1);
});
test("narrowing discovery preserves the total path depth limit", async () => {
  const { backend } = setup("globalThis.game={}; let node=game; for(let i=0;i<9;i++){node.child={ score:i };node=node.child;}");
  const path = ["game", ...Array(7).fill("child")];
  const result = await backend.discover({ rootPath: path });
  assert.equal(result.entries.length, 1); assert.equal(result.entries[0].path.length, 9);
  assert.equal(result.coverage.complete, false);
  assert.equal(backend.resolve(result.entries[0].path).address, result.entries[0].address);
});
test("stale pruning retains the identity of a newly resolved replacement handle", async () => {
  const { backend, run } = setup("globalThis.game = { score: 1 }");
  const original = backend.resolve(["game", "score"]);
  run("delete game.score"); assert.throws(() => backend.read(original.address));
  run("game.score=2"); const replacement = backend.resolve(["game", "score"]);
  await backend.discover();
  assert.equal(backend.resolve(["game", "score"]).address, replacement.address);
});
test("handle capacity reports partial coverage and retains watched handles until they become stale", async () => {
  const context = vm.createContext({});
  // A reduced capacity exercises the same limit without retaining 200,000 objects in the test process.
  vm.runInContext(source.replace("const MAX_HANDLES = 200000", "const MAX_HANDLES = 3"), context);
  const backend = context.__hackEngineJavaScript({ documentId: "bounded", yieldToPage: async () => {} });
  vm.runInContext("globalThis.game={ a:1,b:2,c:3,d:4 }", context);
  const full = await backend.discover();
  assert.equal(full.entries.length, 3); assert.equal(full.coverage.complete, false);
  assert.ok(full.coverage.reasons.includes("handle limit"));
  assert.throws(() => backend.resolve(["game", "d"]), /handle limit/);
  assert.equal(backend.read(full.entries[0].address), 1);
  vm.runInContext("delete game.b", context);
  const reclaimed = await backend.discover();
  assert.equal(reclaimed.coverage.complete, true); assert.equal(reclaimed.entries.length, 3);
  assert.equal(reclaimed.entries.find((e) => e.displayPath === "game.a").address, full.entries[0].address);
  assert.ok(reclaimed.entries.find((e) => e.displayPath === "game.d").address > 3);
});
test("typed array length, constructor and tag overrides never invoke getters during discovery or writes", async () => {
  const { backend, run } = setup(`
    globalThis.game = new Uint8Array([7, 8]);
    for (const key of ['length', 'constructor', Symbol.toStringTag]) {
      Object.defineProperty(game, key, { get() { throw Error('typed array getter executed'); } });
    }
    globalThis.other = new DataView(new ArrayBuffer(8));
    globalThis.big = new BigInt64Array([1n]);
  `);
  const result = await backend.discover();
  assert.equal(result.entries.length, 2);
  const entry = backend.resolve(["game", "0"]);
  assert.equal(backend.write(entry.address, 42), 42);
  assert.equal(run("game[0]"), 42);
  assert.throws(() => backend.write(entry.address, 999), /verification/);
  assert.equal(run("game[0]"), 42);
  assert.equal(backend.roots().some((item) => item.path[0] === "other" || item.path[0] === "big"), false);
  assert.ok(backend.describe().capabilities.includes("restore"));
});
