import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { platform, release } from 'node:os';
import { GAME_CATALOG, RELEASE_GAME_IDS, RUFFLE_BUILD } from './games/catalog.mjs';
import { prepareGames, hashDirectory } from './games/assets.mjs';
import { startGameServer } from './games/server.mjs';
import { createReport, evaluateGate, writeReports } from './games/report.mjs';
import { launchBrowser } from './games/browser.mjs';
import { OBSERVER_SCRIPT } from './games/observations.mjs';
import { runGame } from './games/scenarios.mjs';
import { runLayoutChecks } from './games/layouts.mjs';
import { runFlashSmoke } from './games/flash-smoke.mjs';
import { runXenoLive } from './games/xeno-live.mjs';
import { runBloonsLive } from './games/bloons-live.mjs';
import { runBuddyLive } from './games/buddy-live.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
export function parseOptions(args) {
  const options = { browsers: ['firefox', 'chrome'], gameIds: [...RELEASE_GAME_IDS],
    assetDir: resolve(root, '.cache/game-assets'), outputDir: resolve(root, 'artifacts/game-tests'),
    mode: 'local', download: true, build: true, headed: false, strict: false, noSandbox: false, prepareOnly: false };
  for (let i = 0; i < args.length; i++) {
    const [flag, inline] = args[i].split(/=(.*)/s);
    const value = () => { const result = inline ?? args[++i]; if (!result || result.startsWith('--')) throw Error(`Missing value for ${flag}`); return result; };
    if (flag === '--mode') options.mode = value();
    else if (flag === '--browser') options.browsers = value().split(',');
    else if (flag === '--game') options.gameIds = value().split(',').map(id => id.toUpperCase());
    else if (flag === '--assets') options.assetDir = resolve(value());
    else if (flag === '--output') options.outputDir = resolve(value());
    else if (flag === '--no-download') options.download = false;
    else if (flag === '--no-build') options.build = false;
    else if (flag === '--headed') options.headed = true;
    else if (flag === '--strict') options.strict = true;
    else if (flag === '--no-sandbox') options.noSandbox = true;
    else if (flag === '--prepare-only') options.prepareOnly = true;
    else if (flag === '--help') options.help = true;
    else throw Error(`Unknown option: ${flag}`);
  }
  if (!['website', 'local'].includes(options.mode)) throw Error('Mode must be website or local.');
  if (options.prepareOnly && !options.strict && options.mode !== 'local') throw Error('--prepare-only requires --mode local; websites need no local assets.');
  options.browsers = [...new Set(options.browsers)]; options.gameIds = [...new Set(options.gameIds)];
  if (options.browsers.some(b => !['firefox', 'chrome'].includes(b))) throw Error('Browser must be firefox or chrome.');
  if (options.gameIds.some(id => !GAME_CATALOG.some(g => g.id === id))) throw Error('Unknown game ID. Use J1,W1,F1,F2,F3,F4,F5,F6,F7.');
  if (options.strict && (options.browsers.length !== 2 || RELEASE_GAME_IDS.some(id => !options.gameIds.includes(id)) || options.prepareOnly)) throw Error('Strict qualification requires J1,W1,F7,F4 in both browsers; preparation-only runs cannot qualify.');
  return options;
}

export function classifyCaseFailure(error, {phase, interrupted = false}) {
  if(interrupted) return {status:'BLOCKED',category:'automation',reason:`Run interrupted: ${error.message}`};
  return {status:error.status || (phase === 'baseline' ? 'BLOCKED' : 'FAIL'),
    category:error.category || (phase === 'baseline' ? 'baseline' : 'extension'),reason:error.message};
}

export async function localRuntimeEvidence({session, asset, gameUrl, runtime}) {
  await session.flushResources();
  const swfUrl = new URL('game.swf', gameUrl).href;
  const primarySwf = session.resources.find(resource => resource.url === swfUrl && resource.sha256);
  const runtimeWasm = session.resources.filter(resource => {
    const url = new URL(resource.url);
    return url.origin === new URL(gameUrl).origin && url.pathname.startsWith('/ruffle/') && url.pathname.endsWith('.wasm');
  }).map(resource => ({...resource, assetPath:decodeURIComponent(new URL(resource.url).pathname.slice('/ruffle/'.length))}));
  if (!primarySwf || primarySwf.sha256 !== asset.hashes['game.swf'] || primarySwf.sha256 !== asset.game.downloadArtifact?.sha256 ||
      primarySwf.independentlyParsedAvm !== asset.game.expectedAvm || runtime.reportedAvm !== asset.game.expectedAvm ||
      !(primarySwf.status >= 200 && primarySwf.status < 300)) {
    throw Object.assign(Error('Loaded local SWF hash/public runtime does not match the pinned game.'),{status:'BLOCKED',category:'automation'});
  }
  if (!runtimeWasm.length || runtimeWasm.some(resource => !resource.sha256 || resource.sha256 !== asset.ruffle.hashes[resource.assetPath] || resource.sha256 !== RUFFLE_BUILD.expectedHashes[resource.assetPath] || !(resource.status >= 200 && resource.status < 300))) {
    const reasons = !runtimeWasm.length ? ['No local Ruffle Wasm response was observed.'] : runtimeWasm.flatMap(resource => {
      if (!(resource.status >= 200 && resource.status < 300)) return [`${resource.assetPath}: HTTP ${resource.status}.`];
      if (!resource.sha256) return [`${resource.assetPath}: response hash unavailable (${resource.hashUnavailable || 'capture did not yield complete bytes'}).`];
      if (resource.sha256 !== asset.ruffle.hashes[resource.assetPath] || resource.sha256 !== RUFFLE_BUILD.expectedHashes[resource.assetPath]) return [`${resource.assetPath}: captured bytes do not match the pinned runtime.`];
      return [];
    });
    throw Object.assign(Error(`Loaded local Ruffle Wasm provenance failed: ${reasons.join(' ')}`),{status:'BLOCKED',category:'automation'});
  }
  return {runtime:'ruffle', publicAvm:runtime.reportedAvm, primarySwf, runtimeWasm, ruffleVersion:asset.ruffle.provenance.version};
}

function build() {
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, ['scripts/build-release.mjs'], { cwd: root, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', code => code === 0 ? accept() : reject(Error(`Build failed (${code})`)));
  });
}
const hash = data => createHash('sha256').update(data).digest('hex');

export async function main(args = process.argv.slice(2)) {
  const options = parseOptions(args);
  if (options.help) {
    console.log('npm run test:games -- [--mode website|local] [--browser firefox,chrome] [--game J1,W1,F1,F2,F3,F4,F5,F6,F7] [--assets DIRECTORY] [--output DIRECTORY] [--headed] [--no-download] [--no-build] [--prepare-only] [--strict] [--no-sandbox]');
    return 0;
  }
  if (options.build && !options.prepareOnly) await build();
  const outputRoot = options.outputDir;
  const runId = `${new Date().toISOString().replaceAll(':','-')}-${process.pid}`;
  options.outputDir = join(outputRoot, runId);
  await mkdir(options.outputDir, { recursive: true });
  const extensionVersion = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')).version;
  const testDependencies = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).devDependencies;
  const report = createReport({gameIds:options.gameIds,browsers:options.browsers,metadata:{extensionVersion,os:`${platform()} ${release()}`,node:process.version,
    mode:options.mode,suite:options.mode==='local'?'controlled-core':'website-compatibility',headed:options.headed,strict:options.strict,testDependencies,packageHashes:{},loadedFileHashes:{}}});
  if (!options.prepareOnly) for (const browser of options.browsers) {
    report.metadata.packageHashes[browser] = hash(await readFile(join(root, 'dist', `hack-engine-${browser}-v${extensionVersion}.zip`)));
    report.metadata.loadedFileHashes[browser] = await hashDirectory(join(root,'dist',browser));
  }
  // Website mode never prepares, downloads, or validates a local game copy.
  const assets = options.mode === 'local'
    ? await prepareGames({ assetDir: options.assetDir, download: options.download, gameIds: options.gameIds })
    : GAME_CATALOG.filter(game => options.gameIds.includes(game.id)).map(game => ({ game, ready: Boolean(game.siteUrl), reason: game.siteUrl ? '' : 'No verified playable website URL is configured.', provenance: { mode: 'website', url: game.siteUrl } }));
  const live = options.mode === 'website' ? await import('./games/live-scenarios.mjs') : null;
  const sites = options.mode === 'website' ? await import('./games/sites.mjs') : null;
  if (options.prepareOnly) {
    for (const asset of assets) console.log(`${asset.ready ? 'READY' : 'BLOCKED'} ${asset.game.id}: ${asset.reason || asset.directory}`);
    await writeFile(join(options.outputDir, 'assets.json'), JSON.stringify(assets, null, 2));
    return assets.some(a => !a.ready && a.game.required) ? 1 : 0;
  }
  await writeReports(report,options.outputDir);
  const server = options.mode === 'local' ? await startGameServer({ games: assets, repoRoot: root }) : null;
  let activeSession; let interrupted = false;
  const interrupt = () => { interrupted = true; activeSession?.close().catch(() => {}); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    for (const asset of assets) for (const browser of options.browsers) {
      const entry = { gameId: asset.game.id, gameName: asset.game.name, browser, status: 'BLOCKED', category: 'automation',
        reason: asset.reason || '', steps: [], evidence: [], hashes: asset.hashes, provenance: asset.provenance,
        mode: options.mode, siteUrl: asset.game.siteUrl, avm: asset.avm, ruffle: asset.ruffle ? {hashes:asset.ruffle.hashes,provenance:asset.ruffle.provenance} : undefined, complete: false };
      report.cases[report.cases.findIndex(item=>item.gameId===entry.gameId && item.browser===browser)]=entry;
      if (!asset.ready || interrupted) { entry.reason ||= 'Run interrupted'; continue; }
      const started = Date.now();
      const artifactDir = join(options.outputDir, `${asset.game.id}-${browser}`);
      await mkdir(artifactDir, { recursive: true });
      let phase = 'baseline'; let currentPage; let controls;
      let caseSession; let task; let cancelled = false; let qualificationBlocker;
      const ensureActive = () => { if (cancelled || interrupted) throw Object.assign(Error('Game/browser case interrupted'), {status:'BLOCKED',category:'automation'}); };
      const step = async (name, operation) => {
        ensureActive();
        const item = { name, phase, status: 'RUNNING', durationMs: 0 }; entry.steps.push(item);
        const start = Date.now(); console.log(`[${asset.game.id}/${browser}] ${phase}: ${name}`);
        try { const result = await operation(); ensureActive(); item.status = 'PASS'; if (result !== undefined) item.details = structuredClone(result); return result; }
        catch (error) { item.status = error.status || 'FAIL'; item.error = error.message; throw error; }
        finally { item.durationMs = Date.now() - start; }
      };
      const caseTimeoutMs = asset.game.id === 'F4' ? 600_000 : 360_000;
      let deadline;
      try {
        task = (async () => {
            for (phase of ['baseline', 'extension']) {
              ensureActive();
              try {
                caseSession = await launchBrowser({ browser, extensionDirectory: phase === 'extension' ? join(root, 'dist', browser) : undefined,
                  viewport: options.mode === 'local' && asset.game.runtime === 'ruffle' ? (asset.game.viewport || {width:640,height:480}) : undefined,
                  headed: options.headed, noSandbox: options.noSandbox, artifactDir:join(artifactDir,phase) });
              } catch (error) { error.category = 'automation'; error.status = 'BLOCKED'; throw error; }
              // A timed-out case cannot resume into a later case's browser.
              activeSession = caseSession;
              ensureActive();
              const session = new Proxy(caseSession, { get(target,key) {
                if(key==='checkActive') return ensureActive;
                const value=target[key];
                return typeof value==='function' ? (...args)=>{ ensureActive(); return value.apply(target,args); } : value;
              }});
              entry.version = activeSession.version;
              await session.preload(OBSERVER_SCRIPT);
              currentPage = await step('navigation', async () => {
                try { return await session.newPage(options.mode === 'website' ? asset.game.siteUrl : server.urlFor(asset.game.id)); }
                catch(error) { error.category = 'baseline'; error.status = 'BLOCKED'; throw error; }
              });
              controls = undefined;
              let site;
              if (sites) {
                site = await sites.prepareLiveSite({session, game:asset.game, gamePage:currentPage, artifactDir:join(artifactDir,phase), step});
                entry.observedRuntime = site.runtime;
                entry.finalUrl = await session.evaluate(currentPage, 'location.href');
              }
              controls = phase === 'extension' ? await session.openControls(currentPage) : undefined;
              if(options.mode === 'local' && asset.game.runtime==='ruffle') {
                const runtime = await runFlashSmoke({session,game:asset.game,asset,gamePage:currentPage,controls,
                  baseline:phase==='baseline',artifactDir:join(artifactDir,phase),step});
                entry.observedRuntime = 'ruffle';
                await step('local-runtime-provenance', () => localRuntimeEvidence({session, asset, gameUrl:server.urlFor(asset.game.id), runtime}));
                site = {playPage:currentPage, runtime:'ruffle', runtimeDetails:{avm:runtime.reportedAvm},
                  metadata:{url:server.urlFor(asset.game.id),playUrl:server.urlFor(asset.game.id),runtime:'ruffle'}};
              }
              try {
                if (live) await live.runLiveGame({ session, game:asset.game, gamePage:currentPage, site, controls, baseline:phase==='baseline', artifactDir:join(artifactDir,phase), step });
                else if (asset.game.id === 'F2') await runXenoLive({session,gamePage:currentPage,site,controls,baseline:phase==='baseline',artifactDir:join(artifactDir,phase),step});
                else if (asset.game.id === 'F7') await runBuddyLive({session,gamePage:currentPage,site,controls,baseline:phase==='baseline',artifactDir:join(artifactDir,phase),step});
                else if (asset.game.id === 'F4') await runBloonsLive({session,gamePage:currentPage,site,controls,baseline:phase==='baseline',artifactDir:join(artifactDir,phase),step});
                else await runGame({ session, game: asset.game, asset, gamePage: currentPage, controls,
                  baseline: phase === 'baseline', artifactDir:join(artifactDir,phase), step });
              } catch(error) {
                if(error.code==='MISSING_RECIPE' || (live && error.status==='BLOCKED')) {
                  qualificationBlocker ??= error;
                  (entry.qualificationBlockers ??= []).push({phase,category:error.category,message:error.message});
                  entry.steps.push({name:'full-gameplay',phase,status:'BLOCKED',durationMs:0,error:error.message});
                } else throw error;
              }
              if (options.mode === 'local' && phase === 'extension' && asset.game.id === 'J1') await runLayoutChecks({session,server,step});
              const screenshot = join(artifactDir, `${phase}-game.png`);
              await activeSession.screenshot(currentPage, screenshot);
              entry.evidence.push(relative(options.outputDir, screenshot));
              await writeFile(join(artifactDir, `${phase}-browser.log`), activeSession.logs.map(log => typeof log === 'string' ? log : JSON.stringify(log)).join('\n'));
              entry.evidence.push(relative(options.outputDir, join(artifactDir, `${phase}-browser.log`)));
              await activeSession.flushResources?.().catch(error => { entry.resourceCaptureError = error.message; });
              await writeFile(join(artifactDir, `${phase}-resources.json`), JSON.stringify(activeSession.resources || [], null, 2));
              entry.evidence.push(relative(options.outputDir, join(artifactDir, `${phase}-resources.json`)));
              await caseSession.close(); caseSession = undefined; activeSession = undefined;
            }
            ensureActive();
            if(qualificationBlocker) throw qualificationBlocker;
            entry.status = 'PASS'; entry.category = null; entry.reason = ''; entry.complete = true;
            const coverage = evaluateGate({metadata:{...report.metadata,gameIds:[entry.gameId],browsers:[browser]},cases:[entry]});
            if(!coverage.passed) {
              entry.complete = false;
              throw Object.assign(Error(`Mandatory coverage incomplete: ${coverage.reasons.join('; ')}`),{category:'automation',status:'BLOCKED'});
            }
          })();
        await Promise.race([
          task,
          new Promise((_, reject) => { deadline = setTimeout(() => { cancelled = true; reject(Object.assign(Error(`Game/browser case exceeded ${caseTimeoutMs / 60000} minutes`), {category:'automation',status:'BLOCKED'})); }, caseTimeoutMs); }),
        ]);
      } catch (error) {
        Object.assign(entry, classifyCaseFailure(error, {phase, interrupted}));
        if (activeSession) {
          if(controls) {
            const path=join(artifactDir,'failure-controls.json');
            try {
              const state=await activeSession.evaluate(controls,`({url:location.href,text:document.body.innerText})`);
              await writeFile(path,JSON.stringify(state,null,2));
              entry.evidence.push(relative(options.outputDir,path));
            } catch {}
          }
          for (const [name, page] of [['failure-game', currentPage], ['failure-controls', controls]]) if (page) {
            const path = join(artifactDir, `${name}.png`);
            try { await activeSession.screenshot(page, path); entry.evidence.push(relative(options.outputDir, path)); } catch {}
          }
          await activeSession.flushResources?.().catch(error => { entry.resourceCaptureError = error.message; });
          await writeFile(join(artifactDir, 'failure-resources.json'), JSON.stringify(activeSession.resources || [], null, 2));
          entry.evidence.push(relative(options.outputDir, join(artifactDir, 'failure-resources.json')));
          await writeFile(join(artifactDir, 'failure-browser.log'), activeSession.logs.map(log => typeof log === 'string' ? log : JSON.stringify(log)).join('\n'));
          entry.evidence.push(relative(options.outputDir, join(artifactDir, 'failure-browser.log')));
        }
      } finally {
        clearTimeout(deadline);
        cancelled = true;
        let cleanupError;
        try { await caseSession?.close(); } catch(error) { cleanupError = error; }
        await task?.catch(()=>{});
        try { await caseSession?.close(); } catch(error) { cleanupError ??= error; }
        activeSession = undefined;
        if(cleanupError) {
          entry.steps.push({name:'cleanup',phase,status:'FAIL',durationMs:0,error:cleanupError.message});
          if(entry.status === 'PASS') { entry.status='FAIL'; entry.category='automation'; entry.reason=cleanupError.message; entry.complete=false; }
        }
        entry.durationMs = Date.now() - started;
        for(const file of await readdir(artifactDir,{recursive:true})) {
          if(/\.(png|log|json)$/.test(file)) entry.evidence.push(relative(options.outputDir,join(artifactDir,file)));
        }
        entry.evidence=[...new Set(entry.evidence)];
        console.log(`${entry.status} ${entry.gameId}/${browser}${entry.reason ? `: ${entry.reason}` : ''}`);
        await writeReports(report, options.outputDir);
      }
    }
  } finally {
    await activeSession?.close(); await server?.close();
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    await writeReports(report, options.outputDir);
    await writeFile(join(outputRoot, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Hack Engine test runs</title><h1>Latest real-game test run</h1><p><a href="${runId}/index.html">Open report: ${runId}</a></p><p>Earlier run directories retain their original reports and failure evidence.</p>`);
  }
  const gate = evaluateGate(report, { strict: options.strict });
  console.log(options.mode === 'local' ? 'Controlled core qualification' : 'Live website compatibility (not core release qualification)');
  console.log(`Reports: ${options.outputDir}`);
  console.log(JSON.stringify(gate, null, 2));
  return gate.passed && !interrupted ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
