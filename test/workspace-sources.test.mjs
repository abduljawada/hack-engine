import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const source = readFileSync(new URL("../workspace-controls.js", import.meta.url), "utf8");
const declaration = source.slice(source.indexOf("  function validate(payload)"), source.indexOf("  function snapshot()"));
const validate = vm.runInNewContext(`${declaration}; validate`, { types: new Set(["i8", "u8", "i16", "u16", "i32", "u32", "f32", "f64"]) });
const format = "hack-engine-workspace";
test("workspace v2 migrates to explicit Wasm targets and v3", () => {
  const result = validate({ format, version: 2, watches: [{ type: "i32", address: 16 }] });
  assert.equal(result.version, 3);
  assert.equal(result.watches[0].kind, "wasm");
  assert.equal(result.watches[0].address, 16);
});
test("v3 keeps mixed source hints and never exports JavaScript live handles", () => {
  const result = validate({ format, version: 3, watches: [
    { kind: "wasm", type: "f64", address: 24 },
    { kind: "javascript", type: "number", address: 97, instanceId: "old-document", frameId: 9, path: ["game", "score"], label: "Score" },
  ], settings: { type: "number" } });
  assert.equal(result.watches.length, 2);
  assert.equal(result.watches[1].address, undefined);
  assert.equal(result.watches[1].instanceId, undefined);
  assert.equal(result.watches[1].frameId, undefined);
  assert.equal(result.watches[1].displayPath, "game.score");
  assert.equal(result.settings.type, "number");
});
test("workspace validation rejects unresolvable paths and unsupported versions", () => {
  for (const path of [[], [2], Array(10).fill("child"), ["x".repeat(4097)]]) {
    assert.throws(() => validate({ format, version: 3, watches: [{ kind: "javascript", type: "number", path }] }));
  }
  assert.throws(() => validate({ format, version: 4, watches: [] }));
  assert.throws(() => validate({ format, version: 3, watches: [{ kind: "worker", type: "i32", address: 0 }] }));
});
