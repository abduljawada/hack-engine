import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wasm": "application/wasm", ".swf": "application/x-shockwave-flash", ".png": "image/png", ".jpg": "image/jpeg", ".ogg": "audio/ogg", ".mp3": "audio/mpeg" };
const escape = (text) => String(text).replace(/[<>&"]/g, (value) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[value]);
export async function resolveStaticPath(root, relative) {
  if (relative.includes("\0") || relative.includes("\\") || relative.split("/").includes("..") || path.isAbsolute(relative)) throw new Error("Forbidden path");
  const realRoot = await fs.realpath(root);
  let resolved = await fs.realpath(path.join(root, relative));
  if (resolved !== realRoot && !resolved.startsWith(realRoot + path.sep)) throw new Error("Forbidden path");
  if ((await fs.stat(resolved)).isDirectory()) resolved = await fs.realpath(path.join(resolved, "index.html"));
  if (!resolved.startsWith(realRoot + path.sep)) throw new Error("Forbidden path");
  return resolved;
}
export async function startGameServer({ games, repoRoot = process.cwd() }) {
  const ready = new Map(games.filter((game) => game.ready).map((game) => [game.game.id, game]));
  let origin; let crossOrigin;
  const handler = async (request, response) => {
    const send = (status, body, contentType = "text/html; charset=utf-8") => { response.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); response.end(body); };
    try {
      if (!["GET", "HEAD"].includes(request.method)) return send(405, "Method not allowed");
      const url = new URL(request.url, origin || "http://127.0.0.1");
      const pathname = decodeURIComponent(request.url.split("?")[0]);
      if (pathname.includes("\\") || pathname.split("/").includes("..") || pathname.includes("\0")) return send(403, "Forbidden");
      if (url.pathname === "/health") return send(200, "ok", "text/plain");
      if (url.pathname === "/wrapper") {
        const id = url.searchParams.get("game"); const mode = url.searchParams.get("mode") || "same";
        if (!ready.has(id) || !["same", "cross", "nested"].includes(mode)) return send(404, "Unknown wrapper");
        const source = mode === "nested" ? `${origin}/wrapper?game=${id}&mode=same` : `${mode === "cross" ? crossOrigin : origin}/games/${id}/${ready.get(id).entry}`;
        return send(200, `<!doctype html><meta charset="utf-8"><title>${escape(id)} ${escape(mode)} frame</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}</style><iframe title="Game" src="${escape(source)}"></iframe>`);
      }
      const parts = pathname.slice(1).split("/");
      let root; let relative;
      if (parts[0] === "games" && ready.has(parts[1])) {
        const game = ready.get(parts[1]); root = game.directory; relative = parts.slice(2).join("/") || game.entry;
        if (relative === "__flash__.html" && game.ruffle) {
          const {width,height} = game.game.viewport || {width:640,height:480};
          if (![width,height].every(value=>Number.isInteger(value) && value>=200 && value<=2048)) throw new Error("Invalid game viewport");
          return send(200, `<!doctype html><meta charset="utf-8"><title>${escape(game.game.name)}</title><style>html,body{width:${width}px;height:${height}px;margin:0;overflow:hidden;background:#111}#game,ruffle-player{display:block;width:${width}px;height:${height}px;overflow:hidden}</style><div id="game"></div><script>window.RufflePlayer={config:{autoplay:"on",unmuteOverlay:"hidden",allowNetworking:"none",openUrlMode:"deny"}};</script><script src="/ruffle/ruffle.js"></script><script>const player=window.RufflePlayer.newest().createPlayer();document.getElementById("game").appendChild(player);player.ruffle().load({url:"game.swf",allowScriptAccess:false});</script>`);
        }
      } else if (parts[0] === "ruffle") { root = [...ready.values()].find((game) => game.ruffle)?.ruffle.directory; relative = parts.slice(1).join("/"); }
      else if (parts[0] === "test") { root = path.join(repoRoot, "test"); relative = parts.slice(1).join("/"); }
      else if (["practice", "popup", "assets"].includes(parts[0])) { root = path.join(repoRoot, parts[0]); relative = parts.slice(1).join("/"); }
      else if (parts.length === 1 && ["javascript-source.js", "page-agent.js", "content-bridge.js", "background.js", "workspace-controls.js", "workspace-controls.css", "manifest.json"].includes(parts[0])) { root = repoRoot; relative = parts[0]; }
      if (!root) return send(404, "Not found");
      const filename = await resolveStaticPath(root, relative);
      const body = request.method === "HEAD" ? "" : await fs.readFile(filename);
      send(200, body, types[path.extname(filename)] || "application/octet-stream");
    } catch (error) { send(error.message === "Forbidden path" ? 403 : 404, "Not found"); }
  };
  const server = createServer(handler); const second = createServer(handler);
  const listen = (instance) => new Promise((resolve, reject) => { instance.once("error", reject); instance.listen(0, "127.0.0.1", () => { instance.off("error", reject); resolve(`http://127.0.0.1:${instance.address().port}`); }); });
  const closeServer = (instance) => new Promise((resolve, reject) => { instance.close((error) => error ? reject(error) : resolve()); instance.closeAllConnections(); });
  try { origin = await listen(server); crossOrigin = await listen(second); } catch (error) { if (server.listening) await closeServer(server); throw error; }
  return { origin, crossOrigin, urlFor: (id) => { if (!ready.has(id)) throw new Error(`Unavailable game: ${id}`); return `${origin}/games/${id}/${ready.get(id).entry}`; }, wrapperUrl: ({ gameId, mode = "same" }) => `${origin}/wrapper?game=${encodeURIComponent(gameId)}&mode=${encodeURIComponent(mode)}`, close: async () => { await Promise.all([server, second].filter((item) => item.listening).map(closeServer)); } };
}
