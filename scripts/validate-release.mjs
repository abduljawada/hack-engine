import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distRoot = join(projectRoot, "dist");
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const firefox = JSON.parse(readFileSync(join(distRoot, "firefox", "manifest.json"), "utf8"));
const chrome = JSON.parse(readFileSync(join(distRoot, "chrome", "manifest.json"), "utf8"));
assert(firefox.background?.scripts?.[0] === "background.js", "Firefox package must use background.scripts.");
assert(firefox.sidebar_action?.default_panel, "Firefox package must declare sidebar_action.");
assert(firefox.browser_specific_settings?.gecko?.data_collection_permissions?.required?.[0] === "none", "Firefox package must declare no external data collection.");
assert(chrome.background?.service_worker === "background.js", "Chrome package must use a service worker.");
assert(chrome.side_panel?.default_path === "popup/sidebar.html", "Chrome package must declare its side panel.");
assert(chrome.permissions?.includes("sidePanel"), "Chrome package must request sidePanel.");
assert(!chrome.browser_specific_settings, "Chrome package must omit Firefox-only settings.");
assert(!chrome.sidebar_action, "Chrome package must omit Firefox sidebar_action.");

for (const browser of ["firefox", "chrome"]) {
  const root = join(distRoot, browser);
  for (const path of walk(root)) {
    const relative = path.slice(root.length + 1);
    assert(!/(^|\/)(test|docs|scripts|dist|node_modules|\.git)(\/|$)/.test(relative), `${browser} package contains development path: ${relative}`);
    if (path.endsWith(".js")) {
      const source = readFileSync(path, "utf8");
      assert(!/\beval\s*\(/.test(source), `${browser} package contains eval in ${relative}`);
      assert(!/new\s+Function\s*\(/.test(source), `${browser} package contains new Function in ${relative}`);
      assert(!/\bimport\s*\(\s*["']https?:/.test(source), `${browser} package imports remote code in ${relative}`);
    }
  }
  const archive = join(distRoot, `hack-engine-${browser}-v${firefox.version}.zip`);
  const listing = execFileSync("/usr/bin/unzip", ["-Z1", archive], { encoding: "utf8" });
  assert(listing.split("\n").includes("manifest.json"), `${browser} archive lacks a root manifest.json.`);
  assert(listing.split("\n").includes("LICENSE"), `${browser} archive lacks the MIT license.`);
  assert(!listing.includes(".DS_Store"), `${browser} archive contains .DS_Store.`);
}

const checksumLines = readFileSync(join(distRoot, "SHA256SUMS.txt"), "utf8")
  .trim()
  .split("\n");
assert(checksumLines.length === 2, "Checksum file must list both browser archives.");
for (const line of checksumLines) {
  const match = line.match(/^([a-f0-9]{64})  (.+\.zip)$/);
  assert(match, `Malformed checksum line: ${line}`);
  if (!match) continue;
  const actual = createHash("sha256")
    .update(readFileSync(join(distRoot, match[2])))
    .digest("hex");
  assert(actual === match[1], `Checksum mismatch for ${match[2]}.`);
}

if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("PASS: Firefox and Chrome release packages contain only reviewed local code and valid browser-specific manifests.");
