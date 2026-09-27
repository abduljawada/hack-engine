import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { gunzipSync, inflateSync } from "node:zlib";
import { GAME_CATALOG, RUFFLE_BUILD } from "./catalog.mjs";

export const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const validHash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function safeRelative(name) {
  if (typeof name !== "string" || !name || name.includes("\\") || name.includes("\0") || path.posix.isAbsolute(name) || name.split("/").includes("..")) throw new Error(`Unsafe asset path: ${name}`);
  return name;
}
export async function hashDirectory(directory) {
  const hashes = {};
  async function visit(relative = "") {
    for (const item of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${item.name}` : item.name;
      if (item.isSymbolicLink()) throw new Error(`Asset symlink is forbidden: ${name}`);
      if (item.isDirectory()) await visit(name);
      else if (item.isFile() && name !== "metadata.json") hashes[name] = sha256(await fs.readFile(path.join(directory, name)));
      else if (!item.isFile()) throw new Error(`Non-file asset is forbidden: ${name}`);
    }
  }
  await visit();
  return Object.fromEntries(Object.entries(hashes).sort(([a], [b]) => a.localeCompare(b)));
}
export async function verifyAssetDirectory(directory, expected = {}) {
  const metadata = JSON.parse(await fs.readFile(path.join(directory, "metadata.json"), "utf8"));
  if (!metadata.source || !metadata.permission || !metadata.hashes || typeof metadata.hashes !== "object") throw new Error("metadata.json must declare source, permission, and hashes");
  const hashes = await hashDirectory(directory);
  for (const [name, hash] of Object.entries(metadata.hashes)) {
    safeRelative(name);
    if (!validHash(hash) || hashes[name] !== hash) throw new Error(`Asset hash mismatch or missing file: ${name}`);
  }
  for (const name of Object.keys(hashes)) if (!metadata.hashes[name]) throw new Error(`Unpinned asset: ${name}`);
  for (const [name, hash] of Object.entries(expected)) if (hashes[name] !== hash) throw new Error(`Pinned upstream hash mismatch: ${name}`);
  return { hashes, provenance: metadata };
}

// Parse the SWF container and FileAttributes tag independently of Ruffle's API.
export function classifySwf(input) {
  const signature = input.subarray(0, 3).toString("ascii");
  if (!["FWS", "CWS"].includes(signature) || input.length < 12) throw new Error("Expected FWS or CWS Flash SWF (ZWS is not supported)");
  const expectedLength = input.readUInt32LE(4);
  if (expectedLength > 256 * 1024 * 1024 || expectedLength < 12) throw new Error("Invalid SWF declared length");
  const body = signature === "CWS" ? inflateSync(input.subarray(8), { maxOutputLength: expectedLength - 8 }) : input.subarray(8);
  if (body.length !== expectedLength - 8) throw new Error("SWF length mismatch");
  const rectangleBytes = Math.ceil((5 + 4 * (body[0] >> 3)) / 8);
  let offset = rectangleBytes + 4;
  let avm = "AVM1";
  let ended = false;
  while (offset + 2 <= body.length) {
    const header = body.readUInt16LE(offset); offset += 2;
    const tag = header >> 6;
    let length = header & 63;
    if (length === 63) {
      if (offset + 4 > body.length) throw new Error("Truncated SWF tag length");
      length = body.readUInt32LE(offset); offset += 4;
    }
    if (offset + length > body.length) throw new Error("Truncated SWF tag");
    if (tag === 69) {
      if (length !== 4) throw new Error("Invalid SWF FileAttributes");
      avm = (body.readUInt32LE(offset) & 8) ? "AVM2" : "AVM1";
    }
    if (tag === 82 && avm !== "AVM2") throw new Error("SWF contains ABC code without AVM2 attributes");
    offset += length;
    if (tag === 0) { ended = true; break; }
  }
  if (!ended) throw new Error("SWF has no complete End tag");
  return avm;
}

// A minimal, restrictive tar reader: no links, devices, or paths outside one root.
export async function extractArchive(archive, destination) {
  const bytes = gunzipSync(archive, { maxOutputLength: 512 * 1024 * 1024 });
  let offset = 0; let root;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512); offset += 512;
    if (header.every((byte) => byte === 0)) break;
    const field = (start, length) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
    const name = [field(345, 155), field(0, 100)].filter(Boolean).join("/");
    const size = parseInt(field(124, 12).trim(), 8) || 0;
    const checksum = parseInt(field(148, 8).trim(), 8);
    const actual = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (checksum !== actual || offset + size > bytes.length) throw new Error("Invalid archive header or truncated payload");
    const type = field(156, 1);
    if (type === "g" || type === "x") { offset += Math.ceil(size / 512) * 512; continue; }
    safeRelative(name);
    const parts = name.split("/");
    if (!root) root = parts[0];
    if (parts[0] !== root) throw new Error("Archive has multiple roots");
    const relative = parts.slice(1).join("/");
    if (!["", "0", "5"].includes(type)) throw new Error(`Forbidden archive member type: ${type}`);
    if (relative) {
      const output = path.join(destination, relative);
      if (type === "5") await fs.mkdir(output, { recursive: true });
      else { await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, bytes.subarray(offset, offset + size), { flag: "wx" }); }
    }
    offset += Math.ceil(size / 512) * 512;
  }
  if (!root) throw new Error("Empty archive");
}
async function downloadGame(game, directory) {
  const source = `https://codeload.github.com/${game.repository}/tar.gz/${game.revision}`;
  const response = await fetch(source, { signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`Download HTTP ${response.status}: ${source}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const temporary = `${directory}.download-${process.pid}-${Date.now()}`;
  try {
    await fs.mkdir(temporary, { recursive: true });
    await extractArchive(archive, temporary);
    const hashes = await hashDirectory(temporary);
    for (const [name, hash] of Object.entries(game.expectedHashes)) if (hashes[name] !== hash) throw new Error(`Pinned upstream hash mismatch: ${name}`);
    await fs.writeFile(path.join(temporary, "metadata.json"), JSON.stringify({ source, revision: game.revision, license: "MIT", permission: "MIT license permits local testing and redistribution", archiveSha256: sha256(archive), hashes }, null, 2));
    await fs.rename(temporary, directory);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
async function downloadFlash(game, directory) {
  const response = await fetch(game.downloadArtifact.url, { signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`Download HTTP ${response.status}: ${game.downloadArtifact.url}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (sha256(data) !== game.downloadArtifact.sha256) throw new Error(`Pinned upstream hash mismatch: ${game.id}/game.swf`);
  if (classifySwf(data) !== game.expectedAvm) throw new Error(`SWF runtime mismatch for ${game.id}`);
  const temporary = `${directory}.download-${process.pid}-${Date.now()}`;
  try {
    await fs.mkdir(temporary, { recursive: true });
    await fs.writeFile(path.join(temporary, "game.swf"), data);
    await fs.writeFile(path.join(temporary, "metadata.json"), JSON.stringify({ source: game.source, artifact: game.downloadArtifact.url, permission: "User-authorized local browser gameplay and extension testing of the original publicly served game; no redistribution rights asserted.", hashes: { "game.swf": sha256(data) } }, null, 2));
    await fs.rename(temporary, directory);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
async function downloadRuffle(directory) {
  const response = await fetch(RUFFLE_BUILD.source, { signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`Ruffle download HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const integrity = "sha512-" + createHash("sha512").update(archive).digest("base64");
  if (integrity !== RUFFLE_BUILD.integrity) throw new Error("Pinned Ruffle archive integrity mismatch");
  const temporary = `${directory}.download-${process.pid}-${Date.now()}`;
  try {
    await fs.mkdir(temporary, { recursive: true });
    await extractArchive(archive, temporary);
    const hashes = await hashDirectory(temporary);
    await fs.writeFile(path.join(temporary, "metadata.json"), JSON.stringify({ ...RUFFLE_BUILD, license: "MIT OR Apache-2.0", permission: "Ruffle open-source license permits local test use", hashes }, null, 2));
    await fs.rename(temporary, directory);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
export async function prepareGames({ assetDir, download = true, gameIds = GAME_CATALOG.map((game) => game.id) }) {
  const catalog = gameIds.map((id) => { const game = GAME_CATALOG.find((item) => item.id === id); if (!game) throw new Error(`Unknown game: ${id}`); return game; });
  const results = [];
  for (const game of catalog) {
    const directory = path.resolve(assetDir, game.id);
    const record = { game, ready: false, directory, entry: game.entry || "__flash__.html", hashes: {}, provenance: null };
    try {
      const exists = await fs.access(directory).then(() => true, () => false);
      if (!exists && download && (game.required || game.downloadArtifact)) {
        await fs.mkdir(path.dirname(directory), { recursive: true });
        if (game.required) await downloadGame(game, directory); else await downloadFlash(game, directory);
      }
      else if (!exists) throw new Error(`Missing ${game.id} assets at ${directory}`);
      Object.assign(record, await verifyAssetDirectory(directory, game.expectedHashes));
      if (game.required) {
        if (record.provenance.revision !== game.revision) throw new Error(`Revision mismatch for ${game.id}`);
        if (!record.hashes[game.entry]) throw new Error(`Missing entry: ${game.entry}`);
      } else {
        record.avm = classifySwf(await fs.readFile(path.join(directory, "game.swf")));
        if (record.avm !== game.expectedAvm) throw new Error(`SWF runtime mismatch: expected ${game.expectedAvm}, found ${record.avm}`);
        const ruffleDirectory = path.resolve(assetDir, "ruffle");
        if (download && !await fs.access(ruffleDirectory).then(() => true, () => false)) await downloadRuffle(ruffleDirectory);
        record.ruffle = { directory: ruffleDirectory, ...await verifyAssetDirectory(ruffleDirectory) };
        if (!record.ruffle.provenance.version || !record.ruffle.hashes["ruffle.js"] || !Object.keys(record.ruffle.hashes).some((name) => name.endsWith(".wasm"))) throw new Error("Ruffle metadata must pin version, ruffle.js, and Wasm assets");
        record.recipePath = record.hashes["scenario.json"] ? path.join(directory, "scenario.json") : null;
      }
      record.ready = true;
    } catch (error) { record.reason = error.message; record.category = "automation"; }
    results.push(record);
  }
  return results;
}
