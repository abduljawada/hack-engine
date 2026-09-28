// GitHub deployment records outlive expiring Actions artifacts. They are an attempt
// journal, not a declaration that a store version has been published.
export async function recordAttempt({ store, version, commit, env = process.env, fetchImpl = fetch }) {
  const repository = env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !env.GITHUB_TOKEN || !/^[a-f0-9]{40}$/.test(commit || '')) {
    throw new Error('Store writes require the GitHub Actions attempt journal.');
  }
  const base = `https://api.github.com/repos/${repository}/deployments`;
  const environment = `store-${store}`;
  async function request(url, options = {}) {
    let response;
    try {
      response = await fetchImpl(url, { ...options, headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(30000) });
    } catch { throw new Error('Attempt journal request failed; store write blocked.'); }
    if (!response.ok) throw new Error(`Attempt journal HTTP ${response.status}; store write blocked.`);
    return response.json();
  }
  const prior = await request(`${base}?sha=${commit}&environment=${environment}&per_page=1`);
  if (!Array.isArray(prior)) throw new Error('Unexpected attempt journal response; store write blocked.');
  if (prior.length && env.STORE_RETRY_RECONCILED !== 'true') {
    throw new Error('An earlier store attempt exists. Inspect the store dashboard, then retry only with dashboard reconciliation confirmed; never blindly repeat an uncertain upload.');
  }
  const entry = await request(base, { method: 'POST', body: JSON.stringify({
    ref: commit, environment, auto_merge: false, required_contexts: [],
    transient_environment: false, production_environment: false,
    description: `Submission attempt for ${store} ${version}; not publication confirmation`,
    payload: { store, version, runId: env.GITHUB_RUN_ID || null },
  }) });
  if (!Number.isInteger(entry.id)) throw new Error('Attempt journal creation was not confirmed; store write blocked.');
  return entry.id;
}
