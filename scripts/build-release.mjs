import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const distRoot = join(projectRoot, "dist");
const baseManifest = JSON.parse(readFileSync(join(projectRoot, "manifest.json"), "utf8"));
const version = baseManifest.version;
const runtimeEntries = [
  "assets",
  "background.js",
  "content-bridge.js",
  "devtools",
  "page-agent.js",
  "popup",
];

function copyRuntime(target) {
  mkdirSync(target, { recursive: true });
  for (const entry of runtimeEntries) {
    cpSync(join(projectRoot, entry), join(target, entry), { recursive: true });
  }
  for (const document of ["PRIVACY.md", "SECURITY.md", "USER_GUIDE.md", "LICENSE"]) {
    if (existsSync(join(projectRoot, document))) {
      copyFileSync(join(projectRoot, document), join(target, document));
    }
  }
}

function writeManifest(target, manifest) {
  writeFileSync(join(target, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function archive(target, browser) {
  const filename = `hack-engine-${browser}-v${version}.zip`;
  const archivePath = join(distRoot, filename);
  rmSync(archivePath, { force: true });
  execFileSync("/usr/bin/zip", ["-X", "-q", "-r", archivePath, "."], { cwd: target });
  return archivePath;
}

rmSync(distRoot, { recursive: true, force: true });
mkdirSync(distRoot, { recursive: true });

const firefoxTarget = join(distRoot, "firefox");
copyRuntime(firefoxTarget);
writeManifest(firefoxTarget, baseManifest);

const chromeTarget = join(distRoot, "chrome");
copyRuntime(chromeTarget);
copyFileSync(join(chromeTarget, "popup", "popup.html"), join(chromeTarget, "popup", "sidebar.html"));
const chromeManifest = structuredClone(baseManifest);
delete chromeManifest.browser_specific_settings;
delete chromeManifest.sidebar_action;
chromeManifest.minimum_chrome_version = "116";
chromeManifest.permissions = [...new Set([...(chromeManifest.permissions || []), "sidePanel"])];
chromeManifest.background = { service_worker: "background.js" };
chromeManifest.side_panel = { default_path: "popup/sidebar.html" };
writeManifest(chromeTarget, chromeManifest);

const archives = [archive(firefoxTarget, "firefox"), archive(chromeTarget, "chrome")];
const checksums = archives.map((archivePath) => {
  const hash = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
  return `${hash}  ${archivePath.slice(distRoot.length + 1)}`;
});
writeFileSync(join(distRoot, "SHA256SUMS.txt"), `${checksums.join("\n")}\n`);
for (const archivePath of archives) {
  console.log(archivePath.slice(projectRoot.length + 1));
}
console.log("dist/SHA256SUMS.txt");
