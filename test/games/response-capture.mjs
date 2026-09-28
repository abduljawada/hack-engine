import { createHash } from 'node:crypto';
import { classifySwf } from './assets.mjs';

export const responseLimit = 64 * 1024 * 1024;
export const needsResponseBody = url => /\.(?:swf|wasm)(?:[?#]|$)|ruffle[^?#]*\.js(?:[?#]|$)/i.test(url);

// Firefox 143+ records the bytes of the actual request via these BiDi commands.
// https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/143
export async function createFirefoxResponseCollector(wire) {
  let collector;
  let unavailable;
  try {
    ({ collector } = await wire.call('network.addDataCollector', {
      dataTypes: ['response'], maxEncodedDataSize: 4 * Math.ceil(responseLimit / 3),
    }));
    if (typeof collector !== 'string' || !collector) throw new Error('Missing collector ID');
  } catch (error) {
    unavailable = `Firefox response collection unavailable: ${error.message}`;
  }
  return async function capture({ request, response }, resource) {
    const relevant = needsResponseBody(response.url);
    if (unavailable) {
      if (relevant) resource.hashUnavailable = unavailable;
      return;
    }
    // Redirects can share their request ID with the final response. Do not
    // discard a collector's data while that redirected request is still active.
    if (response.status >= 300 && response.status < 400) return;
    let consumed = false;
    try {
      if (!relevant) return;
      const { bytes } = await wire.call('network.getData', {
        request: request.request, dataType: 'response', collector, disown: true,
      });
      consumed = true;
      if (!bytes || !['base64', 'string'].includes(bytes.type) || typeof bytes.value !== 'string') {
        throw new Error('Unrecognized BiDi response byte encoding');
      }
      if (bytes.value.length > 4 * Math.ceil(responseLimit / 3)) throw new Error('Response exceeds the 64 MiB observation limit');
      const padding = bytes.value.indexOf('=');
      if (bytes.type === 'base64' && (bytes.value.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(bytes.value) ||
          (padding !== -1 && !['=', '=='].includes(bytes.value.slice(padding))))) {
        throw new Error('Invalid base64 response bytes');
      }
      const body = Buffer.from(bytes.value, bytes.type === 'base64' ? 'base64' : 'utf8');
      if (body.length > responseLimit) throw new Error('Response exceeds the 64 MiB observation limit');
      resource.sha256 = createHash('sha256').update(body).digest('hex');
      resource.bytes = body.length;
      if (/\.swf(?:[?#]|$)/i.test(response.url)) {
        try { resource.independentlyParsedAvm = classifySwf(body); }
        catch (error) { resource.classificationError = error.message; }
      }
    } catch (error) {
      resource.hashUnavailable = error.message;
    } finally {
      // Free irrelevant bodies too; otherwise unrelated images/video can evict
      // the actual SWF or Wasm before its responseCompleted handler reads it.
      if (!consumed) {
        try { await wire.call('network.disownData', { request: request.request, dataType: 'response', collector }); }
        catch { /* Missing/evicted data is already represented by hashUnavailable. */ }
      }
    }
  };
}

// A responseReceived event precedes loadingFinished. Draining only body-read
// promises can return before the actual loaded response is ready to read. Keep
// both stages outstanding, including work added while this flush is running.
export async function flushResponseCaptures(responses, pending, { timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (responses.size || pending.size) {
    if (Date.now() >= deadline) {
      const message = 'Actual loaded response capture did not complete before the observation timeout';
      for (const resource of responses.values()) resource.hashUnavailable = message;
      throw Object.assign(new Error(message), { status: 'BLOCKED', category: 'automation' });
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(10, Math.max(1, deadline - Date.now()))));
  }
}
