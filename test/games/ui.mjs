import { GameTestError, poll } from './observations.mjs';

// All inspection operations run through the packaged controls' public DOM.
// There is deliberately no runtime port, page message, or direct memory access.
export class GameUI {
  constructor(session, page) { this.session = session; this.page = page; }
  evaluate(expression) { return this.session.evaluate(this.page, expression); }
  wait(expression, description, timeout = 30000) {
    return poll(() => this.evaluate(expression), Boolean, { description, timeout, category: 'extension', status: 'FAIL' });
  }
  async click(selector, index = 0) {
    await this.evaluate(`(() => { const e = document.querySelectorAll(${JSON.stringify(selector)})[${index}]; if (!e || e.disabled) throw Error('Unavailable UI control: '+${JSON.stringify(selector)}); e.click(); })()`);
  }
  async set(selector, value) {
    await this.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e || e.disabled) throw Error('Unavailable input: '+${JSON.stringify(selector)}); e.value = ${JSON.stringify(String(value))}; e.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  }
  async ready({ javascript = false, type = 'u32', root = null, sourceIndex = 0 } = {}) {
    await this.wait(`document.querySelector('#quick-scan') && !document.querySelector('#quick-scan').disabled`, 'Packaged controls connected');
    await this.click('[data-view="advanced"]');
    // A parent JavaScript source can connect before an embedded Wasm player's
    // frame bridge. Wait for the requested source, not merely any enabled scan.
    const options = await poll(
      () => this.evaluate(`Array.from(document.querySelector('#advanced-instance').options, o => ({value:o.value,text:o.textContent}))`),
      values => Boolean(values.filter(o => /JavaScript/.test(o.text) === javascript)[sourceIndex]),
      { timeout: 15000, interval: 100, description: `Required ${javascript ? 'JavaScript' : 'WebAssembly'} source in packaged UI`, category: 'target-accessibility', status: 'UNSUPPORTED TARGET' },
    );
    const source = options.filter(o => /JavaScript/.test(o.text) === javascript)[sourceIndex];
    await this.set('#advanced-instance', source.value);
    await this.set('#advanced-type', type);
    if (root) {
      await this.click('#javascript-load-roots');
      await this.wait(`Array.from(document.querySelector('#javascript-root').options).some(o=>o.value===${JSON.stringify(JSON.stringify([root]))})`, `Accessible root ${root}`);
      await this.set('#javascript-root', JSON.stringify([root]));
    }
    return source;
  }
  async scan(condition, value, maximum, { during } = {}) {
    await this.set('#advanced-condition', condition);
    if (value !== undefined) await this.set('#advanced-value', value);
    if (maximum !== undefined) await this.set('#advanced-max-value', maximum);
    await this.click('#advanced-scan');
    if (during) await during();
    await poll(async () => {
      const state = await this.evaluate(`({busy:document.querySelector('#advanced-scan').disabled, next:document.querySelector('#advanced-scan').textContent.includes('Next'), error:document.querySelector('#advanced-status').classList.contains('error'), status:document.querySelector('#advanced-status').textContent})`);
      if (!state.busy && state.error && !state.status.startsWith('No matching values.')) {
        throw new GameTestError(`Packaged scan failed: ${state.status}`, 'extension', 'FAIL');
      }
      return state;
    }, state => !state.busy && state.next, { timeout: 120000, description: 'Packaged scan completed', category: 'extension', status: 'FAIL' });
    return this.count();
  }
  count() { return this.evaluate(`Number(document.querySelector('#advanced-result-count').textContent.replaceAll(',',''))`); }
  async reset() { await this.click('#reset-advanced-scan'); await this.wait(`!document.querySelector('#advanced-type').disabled`, 'Scan reset'); }
  candidates() { return this.evaluate(`Array.from(document.querySelectorAll('.advanced-candidate'),e=>({text:e.textContent,location:e.querySelector('.candidate-address')?.textContent,key:e.dataset.candidateKey}))`); }
  async select(index) { await this.click('.advanced-candidate', index); await this.wait(`Number(document.querySelector('#advanced-watch-count').textContent)>0 && !document.querySelector('#advanced-write').disabled`, 'Selected candidate watched'); }
  async write(value) { await this.set('#advanced-write-value', value); await this.click('#advanced-write'); await this.wait(`Array.from(document.querySelectorAll('[data-action="restore"]')).some(e=>!e.disabled)`, 'Undo write available'); }
  async restore({ guarded = false } = {}) {
    await this.click('[data-action="restore"]');
    if (guarded) await this.wait(`document.body.innerText.includes('Restore was cancelled')`, 'Guarded undo refusal');
    else await this.wait(`Array.from(document.querySelectorAll('[data-action="restore"]')).every(e=>e.disabled)`, 'Undo write completed');
  }
  async freeze(value) { await this.set('#advanced-write-value', value); await this.click('#advanced-freeze'); await this.wait(`Array.from(document.querySelectorAll('[data-count]')).some(e=>Number(e.textContent)>0)`, 'Freeze enabled'); }
  async stop() { await this.click('[data-action="stop"]'); await this.wait(`Array.from(document.querySelectorAll('[data-count]')).every(e=>Number(e.textContent)===0)`, 'All freezes stopped'); }
  async undoScan(count) { await this.click('[data-action="undo"]'); await this.wait(`Number(document.querySelector('#advanced-result-count').textContent.replaceAll(',',''))===${count}`, 'Undo scan restored candidates'); }
  async state() { return this.evaluate(`({watches:Number(document.querySelector('#advanced-watch-count').textContent), count:document.querySelector('#advanced-result-count').textContent, source:document.querySelector('#advanced-instance').value, text:document.body.innerText.slice(-6000)})`); }
}
