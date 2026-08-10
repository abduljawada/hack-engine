import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distRoot = join(projectRoot, "dist");
const version = JSON.parse(readFileSync(join(projectRoot, "manifest.json"), "utf8")).version;
const archivePath = join(distRoot, `hack-engine-source-v${version}.zip`);
const sourceEntries = [
  "CHANGELOG.md",
  "LICENSE",
  "PRIVACY.md",
  "README.md",
  "SECURITY.md",
  "SOURCE_BUILD.md",
  "STORE_PUBLISHING_CHECKLIST.md",
  "USER_GUIDE.md",
  "assets",
  "background.js",
  "content-bridge.js",
  "devtools",
  "docs",
  "manifest.json",
  "package-lock.json",
  "package.json",
  "page-agent.js",
  "popup",
  "scripts",
  "store",
  "test",
];

function filesBelow(path) {
  const entries = readdirSync(path, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  return entries.flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? filesBelow(child) : [child];
  });
}

const files = sourceEntries.flatMap((entry) => {
  const path = join(projectRoot, entry);
  return statSync(path).isDirectory() ? filesBelow(path) : [path];
});

mkdirSync(distRoot, { recursive: true });
rmSync(archivePath, { force: true });
execFileSync(
  "/usr/bin/zip",
  ["-X", "-q", archivePath, ...files.map((path) => relative(projectRoot, path))],
  { cwd: projectRoot },
);
const listing = execFileSync("/usr/bin/unzip", ["-Z1", archivePath], { encoding: "utf8" });
for (const required of ["SOURCE_BUILD.md", "package.json", "package-lock.json", "scripts/build-release.mjs"]) {
  if (!listing.split("\n").includes(required)) {
    throw new Error(`Source archive lacks ${required}.`);
  }
}
if (/(^|\/)(dist|node_modules|\.git)(\/|$)/m.test(listing)) {
  throw new Error("Source archive contains generated or repository-internal files.");
}
const hash = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
writeFileSync(join(distRoot, "SOURCE_SHA256.txt"), `${hash}  ${relative(distRoot, archivePath)}\n`);
console.log(archivePath.slice(projectRoot.length + 1));
console.log("dist/SOURCE_SHA256.txt");
