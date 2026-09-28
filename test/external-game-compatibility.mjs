import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserPath } from "./browser-path.mjs";
const [asteroidsUrl, breakoutUrl] = process.argv.slice(2);
if (!asteroidsUrl || !breakoutUrl) {
  throw new Error("Usage: node test/external-game-compatibility.mjs <local HTML5-Asteroids URL> <local Breakout.Rust.Web URL>. See COMPATIBILITY.md for exact upstream revisions.");
}
for (const value of [asteroidsUrl, breakoutUrl]) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("Only locally served test fixtures are accepted.");
}
const chromePath = browserPath("chrome");
const profileDirectory = mkdtempSync(join(tmpdir(), "ruffle-memory-harness-"));
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-gpu",
  "--no-first-run",
  "--no-sandbox",
  "--remote-debugging-port=0",
  `--user-data-dir=${profileDirectory}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

function waitForDebuggerUrl() {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Chrome did not expose a debugger URL.")), 15_000);
    chrome.stderr.setEncoding("utf8");
    chrome.stderr.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    chrome.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Chrome exited before startup with code ${code}.`));
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function pageSocketUrl(browserSocketUrl) {
  const { port } = new URL(browserSocketUrl);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    const page = targets.find((target) => target.type === "page");
    if (page?.webSocketDebuggerUrl) {
      return page.webSocketDebuggerUrl;
    }
    await delay(100);
  }
  throw new Error("Chrome did not create a page target.");
}

function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let sequence = 1;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) {
      return;
    }
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(message.error.message));
    } else {
      resolve(message.result);
    }
  });

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("Unable to connect to Chrome.")), {
      once: true,
    });
  });

  return {
    async call(method, params = {}) {
      await ready;
      const id = sequence++;
      const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return response;
    },
    close() {
      socket.close();
    },
  };
}


// Games stay unmodified; document-start injection mirrors the production page agent.
// The canvas observer records only text the game already draws, never private state.
let cdp;
try {
 cdp = connectCdp(await pageSocketUrl(await waitForDebuggerUrl()));
 await cdp.call("Page.enable");
 const setup = `window.__hackEngineProbe={messages:[],lastText:""};window.addEventListener("message",e=>{if(e.data?.direction==="from-page") __hackEngineProbe.messages.push(e.data.payload)}); const originalFill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...args){if(String(text).startsWith("Score:")) __hackEngineProbe.lastText=text;return originalFill.call(this,text,...args)};`;
 await cdp.call("Page.addScriptToEvaluateOnNewDocument", {source: setup+readFileSync(new URL("../javascript-source.js", import.meta.url),"utf8")+readFileSync(new URL("../page-agent.js", import.meta.url),"utf8")});
 const evaluate = async(expression) => {const r=await cdp.call("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 const command=async(payload)=> {const id=`external:${Date.now()}:${Math.random()}`;await evaluate(`window.postMessage({channel:"ruffle-memory-inspector:v1",direction:"to-page",payload:${JSON.stringify({...payload,requestId:id})}},"*")`);for(let i=0;i<200;i++){const r=await evaluate(`__hackEngineProbe.messages.find(p=>p.requestId===${JSON.stringify(id)}&&p.kind!=="scanProgress")`);if(r){if(r.kind==="error")throw Error(r.message);return r;}await delay(100);}throw Error("timeout "+payload.kind);};
 await cdp.call("Page.navigate",{url:asteroidsUrl});await delay(1800);
 let sources=await command({kind:"listInstances"});const js=sources.instances.find(s=>s.kind==="javascript");
 const scan=await command({kind:"memoryScan",instanceId:js.id,type:"smart",condition:"exact",rawValue:"0",rootPath:["Game"],multiplier:1,refine:false});
 const score=scan.preview.find(p=>p.displayPath==="Game.score");if(!score) throw Error(JSON.stringify(scan));
 const write=await command({kind:"writeValue",instanceId:js.id,type:"number",address:score.address,rawValue:"12345",multiplier:1});
 const observed=await evaluate("Game.score");
 const refine=await command({kind:"memoryScan",instanceId:js.id,type:"smart",condition:"increased",multiplier:1,refine:true});
 const freeze=await command({kind:"setFreeze",instanceId:js.id,type:"number",address:score.address,rawValue:"54321",multiplier:1,enabled:true});await delay(150);
 const frozen=await evaluate("Game.score");const stop=await command({kind:"stopAllFreezes"});
 if(observed!==12345 || frozen!==54321 || refine.total!==1 || stop.enabled!==false) throw Error("JavaScript scan/edit/refine/freeze validation failed");
 console.log(JSON.stringify({game:"HTML5-Asteroids",scanTotal:scan.total,coverage:scan.coverage,score,write,observed,refineTotal:refine.total,freeze,frozen,stop}));
 await cdp.call("Page.navigate",{url:breakoutUrl});await delay(500);
 sources=await command({kind:"listInstances"});console.log(JSON.stringify({game:"Breakout",sources:sources.instances.map(({id,kind,memoryBytes,looksLikeRuffle})=>({id,kind,memoryBytes,looksLikeRuffle})),text:await evaluate("__hackEngineProbe.lastText")}));
 const wasm=sources.instances.find(s=>s.kind!=="javascript");if(!wasm) throw Error("no wasm");
 let text=await evaluate("__hackEngineProbe.lastText");const lives=Number(text.match(/Lives: (\d+)/)?.[1]);
 const result=await command({kind:"memoryScan",instanceId:wasm.id,type:"u32",condition:"exact",rawValue:String(lives),multiplier:1,refine:false});
 for(let i=0;i<400;i++){text=await evaluate("__hackEngineProbe.lastText");if(Number(text.match(/Lives: (\d+)/)?.[1])!==lives) break; await delay(100);}
 const current=Number(text.match(/Lives: (\d+)/)?.[1]);
 if(!Number.isFinite(lives) || !Number.isFinite(current) || lives===current) throw Error("Natural lives change was not observed before timeout");
 const filtered=await command({kind:"memoryScan",instanceId:wasm.id,type:"u32",condition:"exact",rawValue:String(current),multiplier:1,refine:true});
 console.log(JSON.stringify({game:"Breakout",initialLives:lives,currentLives:current,firstTotal:result.total,filtered:{total:filtered.total,preview:filtered.preview.slice(0,3),memoryBytes:filtered.memoryBytes}}));
 let verifiedLives = false;
 for(const p of filtered.preview||[]){const write=await command({kind:"writeValue",instanceId:wasm.id,type:"u32",address:p.address,rawValue:"99",multiplier:1});await delay(50);const text=await evaluate("__hackEngineProbe.lastText");console.log(JSON.stringify({address:p.address,write,text}));if(text.includes("Lives: 99")){verifiedLives = true;const freeze=await command({kind:"setFreeze",instanceId:wasm.id,type:"u32",address:p.address,rawValue:"99",multiplier:1,enabled:true});await delay(100);const stop=await command({kind:"stopAllFreezes"});if(freeze.enabled!==true || stop.enabled!==false)throw Error("WebAssembly freeze lifecycle failed");console.log(JSON.stringify({game:"Breakout",freeze,stop}));break;}const restored=await command({kind:"restoreWrite",instanceId:wasm.id,type:"u32",address:p.address});if(restored.kind!=="writeRestored")throw Error("Candidate restore failed");}
 if (!verifiedLives) throw Error("No scanned candidate changed the game-rendered lives to 99");
 console.log("PASS: exact upstream JavaScript and WebAssembly game builds support the tested operations.");
} finally {
 cdp?.close();
 chrome.kill("SIGTERM");
 await new Promise((resolve) => { const timer=setTimeout(resolve,3000); chrome.once("exit",()=>{clearTimeout(timer);resolve();}); });
 rmSync(profileDirectory,{recursive:true,force:true,maxRetries:10,retryDelay:100});
}
