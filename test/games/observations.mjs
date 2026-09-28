import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createOcrClient } from './ocr-client.mjs';

export class GameTestError extends Error {
  constructor(message, category = 'automation', status = 'BLOCKED') {
    super(message); this.name = 'GameTestError'; this.category = category; this.status = status;
  }
}
export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function poll(read, predicate, { timeout = 30000, interval = 100, description = 'condition', category = 'automation', status = 'BLOCKED' } = {}) {
  const deadline = Date.now() + timeout;
  let value;
  while (Date.now() < deadline) {
    value = await read();
    if (predicate(value)) return value;
    await delay(interval);
  }
  throw new GameTestError(`${description} not observed within ${timeout} ms; last observation: ${JSON.stringify(value)?.slice(-1500)}`, category, status);
}

// Test-only observation of arguments already passed to rendering functions. No game
// state, memory, extension bridge or production page-agent is accessed here.
export const OBSERVER_SCRIPT = `(${function () {
  if (globalThis.__gameRenderedText) return;
  const samples = [];
  let frame = 0;
  const record = (kind, text, x, y) => {
    samples.push({ kind, text: String(text), x: Number(x), y: Number(y), time: Date.now(), frame });
    if (samples.length > 6000) samples.splice(0, 1000);
  };
  Object.defineProperty(globalThis, '__gameRenderedText', { value: samples });
  for (const name of ['fillText', 'strokeText']) {
    const original = CanvasRenderingContext2D.prototype[name];
    CanvasRenderingContext2D.prototype[name] = function (text, x, y, ...rest) {
      record(name, text, x, y); return original.call(this, text, x, y, ...rest);
    };
  }
  // Asteroids draws each player projectile as a two-pixel X. Observe the
  // submitted canvas path, never sprite state, to wait for outstanding shots
  // before an exact write/undo assertion. A released fire key does not remove
  // bullets already in flight.
  const paths = new WeakMap();
  const clearRect = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function (...args) {
    frame++; return clearRect.apply(this, args);
  };
  for (const method of ['beginPath', 'moveTo', 'lineTo', 'stroke']) {
    const original = CanvasRenderingContext2D.prototype[method];
    CanvasRenderingContext2D.prototype[method] = function (...args) {
      if (method === 'beginPath') paths.set(this, []);
      else if (method === 'moveTo' || method === 'lineTo') {
        const path = paths.get(this);
        if (path && path.length < 5) path.push([method, ...args]);
      } else {
        const path = paths.get(this);
        if (this.lineWidth === 2 && path?.length === 4) {
          const [a,b,c,d] = path;
          if (a[0] === 'moveTo' && b[0] === 'lineTo' && c[0] === 'moveTo' && d[0] === 'lineTo' &&
              Math.abs(b[1]-a[1]-2) < 1e-7 && Math.abs(b[2]-a[2]-2) < 1e-7 && c[1] === b[1] && c[2] === a[2] && d[1] === a[1] && d[2] === b[2]) {
            record('projectile', '', a[1]+1, a[2]+1);
          }
        }
      }
      return original.apply(this, args);
    };
  }
  // Breakout draws the ball as a 16x16 rectangle. Observing its rendered
  // respawn proves a missed ball even if freeze restores lives before painting.
  const fillRect = CanvasRenderingContext2D.prototype.fillRect;
  CanvasRenderingContext2D.prototype.fillRect = function (x, y, width, height) {
    if (width === 16 && height === 16) record('ball', '', x, y);
    if (width === 200 && height === 20) record('paddle', '', x, y);
    return fillRect.call(this, x, y, width, height);
  };
  // This pinned Asteroids build renders vector glyphs instead of canvas text.
  // Observe its text renderer's arguments, not Game.score or any private state.
  const timer = setInterval(() => {
    const textRenderer = globalThis.Text;
    if (typeof textRenderer?.renderText !== 'function') return;
    const original = textRenderer.renderText;
    textRenderer.renderText = function (text, size, x, y) {
      record('vectorText', text, x, y); return original.call(this, text, size, x, y);
    };
    clearInterval(timer);
  }, 20);
  setTimeout(() => clearInterval(timer), 30000);
}})()`;

export async function renderedSamples(session, page, since = 0) {
  return session.evaluate(page, `Array.from(globalThis.__gameRenderedText || []).filter(s => s.time >= ${Number(since)})`);
}
export function sampleValue(sample, gameId) {
  if (gameId === 'J1' && sample.kind === 'vectorText' && sample.y === 20 && /^\d+$/.test(sample.text)) return Number(sample.text);
  if (gameId === 'W1') {
    const match = sample.text.match(/Score:\s*\d+\s+Lives:\s*(\d+)/);
    if (match) return Number(match[1]);
  }
  return null;
}
export async function readRenderedValue(session, page, gameId) {
  const samples = await renderedSamples(session, page, Date.now() - 2500);
  for (let index = samples.length - 1; index >= 0; index--) {
    const value = sampleValue(samples[index], gameId);
    if (value !== null) return value;
  }
  return null;
}

export async function createOcrObserver({ session, page, target, artifactDir }) {
  if (!target.region || !target.pattern) throw new GameTestError('Flash scenario needs a screenshot region and numeric capture pattern.');
  const { left, top, width, height } = target.region;
  if (![left, top, width, height].every(Number.isFinite) || left < 0 || top < 0 || width <= 0 || height <= 0) throw new GameTestError('Invalid OCR screenshot region.');
  const pattern = new RegExp(target.pattern);
  await mkdir(artifactDir, { recursive: true });
  let worker;
  try {
    worker = await createOcrClient({cachePath:artifactDir,langPath:process.env.GAME_OCR_LANG_PATH});
  } catch (error) {
    throw new GameTestError(`OCR initialization unavailable: ${error.message}`);
  }
  let sequence = 0;
  return {
    async read() {
      const path = join(artifactDir, `ocr-${++sequence}.png`);
      await session.screenshot(page, path);
      const data = await worker.recognize(path, target.region);
      const match = data.text.trim().match(pattern);
      const value = match?.[1] === undefined ? NaN : Number(match[1].replaceAll(',', ''));
      if (data.confidence < (target.minConfidence ?? 85) || !Number.isFinite(value)) {
        throw new GameTestError(`Unreliable ${target.name} screenshot reading (${data.confidence}%): ${JSON.stringify(data.text)}; evidence ${path}`);
      }
      return value;
    },
    close: () => worker.close(),
  };
}

// Require two completed, advancing rendered frames without a player shot. This
// establishes a quiet edit window from visible output, not elapsed time or an
// assumed score/memory address. Shots drawn in an unfinished frame are ignored
// until its score paint completes it.
export function asteroidsEditWindow(samples) {
  const scores = samples.filter(row => sampleValue(row, 'J1') !== null);
  const latest = scores.at(-1), previous = scores.at(-2);
  if (!latest || !previous || latest.frame <= previous.frame || latest.text !== previous.text) return null;
  if (samples.some(row => row.kind === 'projectile' && (row.frame === previous.frame || row.frame === latest.frame))) return null;
  return { value: sampleValue(latest, 'J1'), frames: [previous.frame, latest.frame] };
}
