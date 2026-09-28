import { readFile } from 'node:fs/promises';

const API = 'https://chromewebstore.googleapis.com';
const required = ['CHROME_PUBLISHER_ID', 'CHROME_EXTENSION_ID', 'CHROME_CLIENT_ID', 'CHROME_CLIENT_SECRET', 'CHROME_REFRESH_TOKEN'];
const versions = revision => revision?.distributionChannels?.map(channel => channel.crxVersion) ?? [];
const inProgress = state => ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(state);

// Only return selected, non-sensitive fields. Never echo OAuth/API response bodies.
export function classifyChromeStatus(status, version) {
  if (!status || typeof status !== 'object' || Array.isArray(status)) {
    return { state: 'needs_attention', reason: 'Invalid store status response.' };
  }
  if (status.takenDown || status.warned) return { state: 'needs_attention', reason: 'Resolve the store policy notice in the developer dashboard.' };
  const published = status.publishedItemRevisionStatus;
  const submitted = status.submittedItemRevisionStatus;
  if (status.stagedItemRevisionStatus) return { state: 'needs_attention', reason: 'Unexpected staged revision; inspect the developer dashboard.' };
  if (published?.state === 'PUBLISHED' && versions(published).includes(version)) return { state: 'published' };
  if (submitted) {
    if (versions(submitted).includes(version) && submitted.state === 'PENDING_REVIEW') return { state: 'awaiting_review' };
    return { state: 'needs_attention', reason: 'An existing submission requires dashboard review; no upload or publication attempted.' };
  }
  // A successful async upload may still be an unpublished draft. Its version is
  // not exposed by fetchStatus, so do not replace it or publish it blindly.
  if (inProgress(status.lastAsyncUploadState)) return { state: 'upload_processing', reason: 'Check status later; do not upload again.' };
  if (status.lastAsyncUploadState && status.lastAsyncUploadState !== 'NOT_FOUND') {
    return { state: 'needs_attention', reason: 'A prior async upload requires dashboard reconciliation.' };
  }
  if (!published || published.state !== 'PUBLISHED' || versions(published).length === 0) {
    return { state: 'needs_attention', reason: 'Complete the initial Chrome publication in the developer dashboard first.' };
  }
  if (versions(published).some(value => !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(value))) {
    return { state: 'needs_attention', reason: 'Unrecognized published version.' };
  }
  const compare = (left, right) => {
    const a = left.split('.').map(Number), b = right.split('.').map(Number);
    for (let index = 0; index < 4; index += 1) {
      if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
    }
    return 0;
  };
  if (versions(published).some(value => compare(value, version) >= 0)) return { state: 'needs_attention', reason: 'The store already contains this or a newer version.' };
  return { state: 'not_submitted' };
}

export async function runChrome({ version, archivePath, mode = 'status', env = process.env, fetchImpl = fetch, beforeUpload = async () => {} }) {
  if (!['status', 'submit'].includes(mode)) throw new Error('Chrome mode must be status or submit.');
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('Chrome requires a stable release version.');
  const missing = required.filter(key => !env[key]?.trim());
  if (missing.length) throw new Error(`Missing Chrome configuration: ${missing.join(', ')}`);
  const result = details => ({ store: 'chrome', version, ...details });
  async function request(label, url, init) {
    let response;
    try { response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(60_000) }); }
    catch { throw new Error(`Chrome ${label} request failed or timed out. Check store status before retrying.`); }
    if (!response.ok) throw new Error(`Chrome ${label} failed (HTTP ${response.status}). Check the developer dashboard.`);
    try { return await response.json(); }
    catch { throw new Error(`Chrome ${label} returned an unreadable response. Check store status before retrying.`); }
  }
  const token = await request('authentication', 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: env.CHROME_CLIENT_ID,
      client_secret: env.CHROME_CLIENT_SECRET, refresh_token: env.CHROME_REFRESH_TOKEN }).toString(),
  });
  if (typeof token?.access_token !== 'string' || !token.access_token) throw new Error('Chrome authentication did not return an access token.');
  const headers = { Authorization: `Bearer ${token.access_token}` };
  const name = `publishers/${encodeURIComponent(env.CHROME_PUBLISHER_ID)}/items/${encodeURIComponent(env.CHROME_EXTENSION_ID)}`;
  const status = await request('status', `${API}/v2/${name}:fetchStatus`, { method: 'GET', headers });
  const existing = classifyChromeStatus(status, version);
  if (mode === 'status' || existing.state !== 'not_submitted') return result(existing);
  let archive;
  try { archive = await readFile(archivePath); }
  catch { throw new Error('Chrome release archive could not be read.'); }
  // The caller persists an attempt record before mutation, guarding retries across runs.
  // Keep this outside the upload catch: failure to record the attempt must block upload.
  await beforeUpload();
  // Mutating requests are deliberately never retried, including on network errors.
  let uploaded;
  try {
    uploaded = await request('upload', `${API}/upload/v2/${name}:upload`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip' }, body: archive,
    });
  } catch {
    return result({ state: 'needs_attention', reason: 'Upload outcome is uncertain. Reconcile the draft in the Chrome dashboard before any retry.' });
  }
  if (inProgress(uploaded?.uploadState)) return result({ state: 'upload_processing', reason: 'Upload processing continues. Check status and reconcile the draft in the dashboard before publishing.' });
  if (uploaded?.uploadState !== 'SUCCEEDED' || uploaded.crxVersion !== version) {
    return result({ state: 'needs_attention', reason: 'Upload did not confirm the expected version. Inspect the Chrome dashboard before retrying.' });
  }
  let publication;
  try {
    publication = await request('publication', `${API}/v2/${name}:publish`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH', skipReview: false, blockOnWarnings: true }),
    });
  } catch {
    return result({ state: 'needs_attention', reason: 'Publication outcome is uncertain. Check status and reconcile the uploaded draft in the dashboard before any retry.' });
  }
  if (publication?.state === 'PUBLISHED') return result({ state: 'published' });
  if (publication?.state === 'PENDING_REVIEW') return result({ state: 'awaiting_review' });
  if (publication?.state === 'STAGED') return result({ state: 'needs_attention', reason: 'The store staged this submission; reconcile publication in the dashboard.' });
  return result({ state: 'needs_attention', reason: 'Publication returned an unexpected state. Inspect the developer dashboard before retrying.' });
}
