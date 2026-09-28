import { promises as fs } from "node:fs";
import path from "node:path";
import { ADDITIONAL_TARGETS, BROWSERS, GAME_CATALOG, RELEASE_GAME_IDS, REQUIRED_SCENARIOS, RUFFLE_BUILD, TARGET_SCENARIOS } from "./catalog.mjs";
const escape = (value) => String(value ?? "").replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[character]);
export function createReport({ gameIds = RELEASE_GAME_IDS, browsers = BROWSERS, metadata = {} } = {}) {
  return { createdAt: new Date().toISOString(), metadata: { mode: "local", ...metadata, gameIds, browsers }, cases: gameIds.flatMap((gameId) => browsers.map((browser) => ({ gameId, gameName: GAME_CATALOG.find((game) => game.id === gameId)?.name, browser, status: "NOT RUN", steps: [], evidence: [] }))) };
}
export function evaluateGate(report, { strict = false } = {}) {
  const reasons = [];
  const counts = {};
  const seen = new Set();
  const expectedGames = strict ? RELEASE_GAME_IDS : (report.metadata?.gameIds || GAME_CATALOG.map((game) => game.id));
  const expectedBrowsers = strict ? BROWSERS : (report.metadata?.browsers || BROWSERS);
  for (const testCase of report.cases || []) {
    counts[testCase.status] = (counts[testCase.status] || 0) + 1;
    const key = `${testCase.gameId}/${testCase.browser}`;
    const game = GAME_CATALOG.find((item) => item.id === testCase.gameId);
    if (!game || !BROWSERS.includes(testCase.browser)) reasons.push(`Unknown combination: ${key}`);
    if (seen.has(key)) reasons.push(`Duplicate combination: ${key}`);
    seen.add(key);
    // An optional game blocker cannot excuse leaking a browser or profile.
    // Keep the original case reason intact and report cleanup independently.
    for (const step of testCase.steps || []) if (step.name === "cleanup" && step.status === "FAIL") {
      reasons.push(`${key}: cleanup failed${step.error ? ` (${step.error})` : ""}`);
    }
    if (testCase.status === "PASS") {
      if (testCase.complete !== true) reasons.push(`${key}: mandatory scenario coverage incomplete`);
      if (!testCase.steps?.length || testCase.steps.some((step) => step.status !== "PASS")) reasons.push(`${key}: missing or unsuccessful steps`);
      const website = report.metadata?.mode === "website";
      const required = [...REQUIRED_SCENARIOS, "undo-scan", "guarded-undo"];
      if (game?.id === "J1") {
        required.push("range-scan", "unknown-scan");
        if (!website) required.push("frame-same", "frame-nested", "frame-cross", "same-origin-isolation");
      }
      if (testCase.browser === "chrome" && ["J1", "W1"].includes(game?.id)) required.push("worker-recovery");
      const runtime = website ? testCase.observedRuntime : game?.runtime;
      if (website && !["javascript", "wasm", "ruffle"].includes(runtime)) reasons.push(`${key}: missing or unsupported observed runtime`);
      if (website && strict && RELEASE_GAME_IDS.includes(game?.id) && runtime !== game.runtime) reasons.push(`${key}: observed runtime does not match required ${game.runtime}`);
      if (runtime === "ruffle") required.push("pause-resume", "pause-scanning", "pause-cancel", "flash-load", "flash-source-runtime", "flash-manual-pause");
      const requireStep = (name, phase) => {
        if (!testCase.steps?.some((step) => step.name === name && step.phase === phase && step.status === "PASS")) reasons.push(`${key}: missing mandatory ${phase} step ${name}`);
      };
      for (const name of required) requireStep(name, name === "baseline" ? "baseline" : "extension");
      for (const target of ADDITIONAL_TARGETS[game?.id] || []) {
        requireStep(`${target}:baseline`, "baseline");
        for (const name of TARGET_SCENARIOS) requireStep(`${target}:${name}`, "extension");
      }
      if (!website && strict && runtime === "ruffle") for (const phase of ["baseline", "extension"]) {
        requireStep("flash-load", phase);
        requireStep("local-runtime-provenance", phase);
        const details = testCase.steps?.find(step => step.name === "local-runtime-provenance" && step.phase === phase && step.status === "PASS")?.details;
        const loaded = testCase.steps?.find(step => step.name === "flash-load" && step.phase === phase && step.status === "PASS")?.details;
        const validHash = value => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
        const primary = details?.primarySwf;
        const loopback = value => { try { const url = new URL(value); return url.protocol === "http:" && url.hostname === "127.0.0.1"; } catch { return false; } };
        if (details?.runtime !== "ruffle" || details?.publicAvm !== game.expectedAvm || loaded?.reportedAvm !== game.expectedAvm ||
            loaded?.independentlyParsedAvm !== game.expectedAvm || primary?.independentlyParsedAvm !== game.expectedAvm) {
          reasons.push(`${key}: ${phase} pinned SWF classification must match public ${game.expectedAvm} runtime`);
        }
        if (!loopback(primary?.url) || !validHash(primary?.sha256) || primary?.sha256 !== testCase.hashes?.["game.swf"] ||
            primary?.sha256 !== game.downloadArtifact?.sha256 || !(primary?.status >= 200 && primary.status < 300)) {
          reasons.push(`${key}: ${phase} loaded local SWF hash does not match pinned game`);
        }
        if (details?.ruffleVersion !== RUFFLE_BUILD.version || testCase.ruffle?.provenance?.version !== RUFFLE_BUILD.version) reasons.push(`${key}: ${phase} Ruffle version does not match release pin`);
        const wasm = details?.runtimeWasm;
        if (!Array.isArray(wasm) || !wasm.length || wasm.some(resource => !loopback(resource.url) || !validHash(resource.sha256) ||
            resource.sha256 !== testCase.ruffle?.hashes?.[resource.assetPath] || resource.sha256 !== RUFFLE_BUILD.expectedHashes[resource.assetPath] || !(resource.status >= 200 && resource.status < 300))) {
          reasons.push(`${key}: ${phase} loaded local Ruffle Wasm hash does not match pinned runtime`);
        }
      }
      if (website) for (const phase of ["baseline", "extension"]) {
        requireStep("website-load", phase);
        requireStep("runtime-detection", phase);
        const observed = testCase.steps?.find(step => step.name === "runtime-detection" && step.phase === phase && step.status === "PASS")?.details?.runtime;
        if (observed !== runtime) reasons.push(`${key}: ${phase} runtime evidence does not match ${runtime}`);
        if (strict && runtime === "ruffle") {
          const details = testCase.steps?.find(step => step.name === "flash-load" && step.phase === phase && step.status === "PASS")?.details;
          const publicAvm = testCase.steps?.find(step => step.name === "runtime-detection" && step.phase === phase && step.status === "PASS")?.details?.runtimeDetails?.avm;
          const primary = details?.primarySwf;
          if (game.expectedAvm && publicAvm !== game.expectedAvm) reasons.push(`${key}: ${phase} runtime must be ${game.expectedAvm}`);
          const validHash = value => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
          if (!primary || !/^https?:\/\//.test(primary.url || "") || !validHash(primary.sha256) || !(primary.status >= 200 && primary.status < 400)) reasons.push(`${key}: ${phase} primary game SWF hash unavailable`);
          if (!["AVM1", "AVM2"].includes(publicAvm) || primary?.independentlyParsedAvm !== publicAvm || details?.runtime?.avm !== publicAvm) reasons.push(`${key}: ${phase} independent primary SWF classification does not match public runtime metadata`);
          const wasm = details?.runtimeWasm;
          if (!Array.isArray(wasm) || !wasm.length || wasm.some(resource => !/^https?:\/\//.test(resource.url || "") || !validHash(resource.sha256) || !(resource.status >= 200 && resource.status < 400))) reasons.push(`${key}: ${phase} Ruffle runtime Wasm hash unavailable`);
        }
      }

    } else if (!(testCase.status === "BLOCKED" && !strict && game && !game.required)) reasons.push(`${key}: ${testCase.status}${testCase.reason ? ` (${testCase.reason})` : ""}`);
  }
  for (const gameId of expectedGames) for (const browser of expectedBrowsers) if (!seen.has(`${gameId}/${browser}`)) reasons.push(`${gameId}/${browser}: NOT RUN`);
  return { passed: reasons.length === 0, reasons, counts };
}
export async function writeReports(report, outputDir) {
  await fs.mkdir(outputDir, { recursive: true });
  const cases = report.cases || [];
  report.gates = { ordinary: evaluateGate(report), strict: evaluateGate(report, {strict:true}) };
  const controlled = report.metadata?.mode === "local";
  report.gates.coreRelease = controlled ? report.gates.strict : {passed:false,reasons:["Website compatibility cannot qualify the controlled core release suite."],counts:report.gates.strict.counts};
  const suiteLabel = controlled ? "Controlled core real-game qualification" : "Live website compatibility";
  const fullLabel = controlled ? "Full core release qualification" : "Full website compatibility";
  const statusCounts = cases.reduce((counts, item) => ({ ...counts, [item.status]: (counts[item.status] || 0) + 1 }), {});
  const display = (value) => escape(typeof value === "object" ? JSON.stringify(value, null, 2) : value);
  const evidenceHtml = (items) => items.map((item) => {
    const filename = typeof item === "string" ? item : item.path;
    if (!filename) return `<pre>${display(item)}</pre>`;
    const relative = path.isAbsolute(filename) ? path.relative(outputDir, filename) : filename;
    // Render only links inside this report tree, never arbitrary injected URLs.
    if (relative.startsWith("..") || relative.includes(":") || relative.startsWith("/")) return `<code>${escape(filename)}</code>`;
    return `<a href="${escape(relative.split(path.sep).map(encodeURIComponent).join("/"))}">${escape(typeof item === "object" ? item.label || filename : filename)}</a>`;
  }).join(" ");
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Hack Engine ${suiteLabel}</title><style>body{font:16px system-ui;max-width:1100px;margin:40px auto;padding:0 20px;background:#fafafa;color:#222}table{border-collapse:collapse;width:100%}td,th{padding:9px;text-align:left;border-bottom:1px solid #ddd}pre{white-space:pre-wrap;overflow-wrap:anywhere}.PASS{color:#146b29}.FAIL{color:#a90000}.BLOCKED,.NOT{color:#835000}section{margin:30px 0}code{overflow-wrap:anywhere}</style><h1>Hack Engine ${suiteLabel}</h1><p><strong>Selected-suite check: ${report.gates.ordinary.passed ? "PASS" : "FAIL"} · ${fullLabel}: ${report.gates.strict.passed ? "PASS" : "INCOMPLETE / FAILED"}</strong></p><p>${escape(report.createdAt)} · ${display(statusCounts)}</p><p>Qualification requires all 8 release game/browser combinations (Asteroids, Breakout, Xeno Tactic 2, and Bloons Tower Defense 3 in Firefox and Chromium) and mandatory scenarios. ${controlled ? "This suite uses pinned original game files and the pinned Ruffle runtime in a controlled local host. It does not qualify changing public websites." : "This report checks changing public websites and cannot qualify the controlled core release suite."} Unqualified gameplay and unreliable observations remain visible as blocked coverage. Native sidebar opening, store installation, and other operating systems are separate checks.</p><details><summary>Qualification gaps</summary><pre>${display(report.gates.strict.reasons)}</pre></details><details><summary>Run versions and metadata</summary><pre>${display(report.metadata)}</pre></details><table><tr><th>Game</th><th>Browser</th><th>Status</th><th>Category</th><th>Reason</th></tr>${cases.map((item) => `<tr><td>${escape(item.gameId)} ${escape(item.gameName)}</td><td>${escape(item.browser)}</td><td class="${escape(item.status)}">${escape(item.status)}</td><td>${escape(item.category)}</td><td>${escape(item.reason)}</td></tr>`).join("")}</table>${cases.map((item) => `<section><h2>${escape(item.gameId)} · ${escape(item.browser)} · ${escape(item.status)}</h2><p>${escape(item.reason)}</p>${evidenceHtml(item.evidence || [])}<details><summary>Steps, versions, hashes, provenance and logs</summary><pre>${display(item)}</pre></details></section>`).join("")}</html>`;
  let failures = 0; let skipped = 0;
  const strict = report.metadata?.strict === true;
  const selectedGate = strict ? report.gates.strict : report.gates.ordinary;
  const xmlCases = cases.map((item) => {
    const key = `${item.gameId}/${item.browser}`;
    const caseReasons = selectedGate.reasons.filter(reason => reason.startsWith(`${key}:`));
    const cleanupFailed = item.steps?.some(step => step.name === "cleanup" && step.status === "FAIL");
    const required = GAME_CATALOG.find(game => game.id === item.gameId)?.required === true;
    let body;
    if (item.status === "PASS" && item.complete === true && caseReasons.length === 0) body = "";
    else if (!cleanupFailed && (item.status === "NOT RUN" || (item.status === "BLOCKED" && !strict && !required))) {
      skipped++;
      body = `<skipped message="${escape(item.reason || item.status)}"/>`;
    } else {
      failures++;
      body = `<failure type="${escape(item.category || "automation")}" message="${escape(item.reason || caseReasons.join("; ") || item.status)}">${display({ ...item, qualificationFailures: caseReasons })}</failure>`;
    }
    return `<testcase classname="${escape(item.browser)}" name="${escape(item.gameId + " " + item.gameName)}" time="${(item.durationMs || 0) / 1000}">${body}<system-out>${display(item)}</system-out></testcase>`;
  });
  // Per-game records cannot represent an omitted combination, duplicate entry,
  // or strict provenance failure by themselves. Publish the selected gate as
  // its own test so JUnit consumers see the same outcome as the command exit.
  const gateName = strict ? (controlled ? "Strict core release qualification" : "Strict website compatibility") : "Selected-suite qualification";
  let gateBody = "";
  if (!selectedGate.passed) {
    failures++;
    gateBody = `<failure type="qualification" message="${escape(selectedGate.reasons.join("; "))}">${display(selectedGate)}</failure>`;
  }
  xmlCases.push(`<testcase classname="qualification" name="${gateName}" time="0">${gateBody}<system-out>${display(selectedGate)}</system-out></testcase>`);
  const junit = `<?xml version="1.0" encoding="UTF-8"?><testsuite name="Hack Engine real games" tests="${xmlCases.length}" failures="${failures}" skipped="${skipped}">${xmlCases.join("\n")}</testsuite>`;

  const files = { json: path.join(outputDir, "results.json"), html: path.join(outputDir, "index.html"), junit: path.join(outputDir, "junit.xml") };
  await Promise.all([fs.writeFile(files.json, JSON.stringify(report, null, 2) + "\n"), fs.writeFile(files.html, html), fs.writeFile(files.junit, junit)]);
  return files;
}
