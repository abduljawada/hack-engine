// Runs inside the packaged persistent popup, bound to the practice tab.
export const extensionUiScenario = `(${async function () {
  const wait = async (predicate, description) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 50)); }
    throw new Error(`${description}: ${document.body.innerText.slice(-1800)}`);
  };
  const api = globalThis.browser ?? globalThis.chrome;
  const ui = (selector) => document.querySelector(selector);
  await wait(() => !ui('#quick-scan').disabled, 'Game connection');
  ui('[data-view="advanced"]').click();
  ui('#advanced-type').value = 'i32';
  ui('#advanced-value').value = '100';
  ui('#advanced-scan').click();
  await wait(() => ui('#advanced-result-count').textContent === '1' && !ui('#advanced-scan').disabled, 'First scan');
  ui('#advanced-value').value = '1234567'; ui('#advanced-scan').click();
  await wait(() => ui('#advanced-result-count').textContent === '0' && !ui('[data-action="undo"]').disabled, 'Wrong refinement');
  ui('[data-action="undo"]').click();
  await wait(() => ui('#advanced-result-count').textContent === '1' && ui('.advanced-candidate'), 'Undo scan');
  ui('.advanced-candidate').click();
  ui('#advanced-write-value').value = '500'; ui('#advanced-write').click();
  await wait(() => !ui('[data-action="restore"]').disabled, 'Write bookkeeping');
  ui('[data-action="restore"]').click();
  await wait(() => ui('[data-action="restore"]').disabled, 'Restore write');
  ui('#advanced-write-value').value = '200'; ui('#advanced-freeze').click();
  await wait(() => ui('[data-count]').textContent === '1', 'Freeze status');
  ui('[data-action="stop"]').click();
  await wait(() => ui('[data-count]').textContent === '0', 'Stop all freezes');
  const label = ui('[aria-label^="Watch label"]');
  label.value = 'Practice score'; label.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(() => ui('[aria-label^="Watch label"]').value === 'Practice score', 'Shared watch label');
  ui('.advanced-candidate').click();
  ui('[data-name]').value = 'Test workspace'; ui('[data-action="save"]').click();
  await wait(async () => Object.keys((await api.storage.local.get('savedWorkspaces')).savedWorkspaces || {}).length === 1, 'Save workspace');
  await wait(() => ui('[data-saved]').options.length === 2, 'Saved menu');
  const saved = Object.values((await api.storage.local.get('savedWorkspaces')).savedWorkspaces)[0];
  if (saved.watches[0].label !== 'Practice score') throw new Error('Watch label lost when reselecting a candidate');
  ui('[data-saved]').selectedIndex = 1; ui('[data-action="load"]').click();
  await wait(() => !ui('[data-preview]').hidden, 'Workspace preview');
  if (ui('[data-verified]').checked) throw new Error('Imported watches were trusted automatically');
  ui('[data-action="apply"]').click();
  await wait(() => ui('.session-feedback').textContent.includes('verify'), 'Unverified import guard');
  ui('[data-verified]').checked = true; ui('[data-action="apply"]').click();
  await wait(() => ui('[data-preview]').hidden, 'Verified workspace application');
  return 'PASS: packaged controls connect to practice memory, scan, undo, write/restore, freeze/stop, and save/load verified workspaces.';
}})()`;
