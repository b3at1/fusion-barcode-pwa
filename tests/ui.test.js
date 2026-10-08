import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

class Element extends EventTarget {
  constructor(id) {
    super(); this.id = id; this.hidden = false; this.disabled = false; this.value = '';
    this.textContent = ''; this.innerHTML = ''; this.open = false; this.dataset = {};
    this.classList = { toggle() {} };
  }
  click() { this.dispatchEvent(new Event('click')); }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
  replaceChildren() { this.innerHTML = ''; }
}

async function until(predicate) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('UI did not reach the expected state');
}

test('real app event handlers: import, refresh, institution changes, failure and cancellation', async t => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element(match[1])]));
  const get = id => elements.get(id);
  const values = new Map();
  const localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  const saved = ['window', 'document', 'navigator', 'location', 'matchMedia', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  const calls = [];
  let responseMode = 'good';
  let deferred = null;
  const TOKEN = 'synthetic-pwa-ui-token';
  const BARCODE = '&0000123456789&';
  const fakeFetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/api/health')) return Response.json({ service: 'my-barcode', relay: true });
    if (responseMode === 'deferred') return new Promise(resolve => { deferred = resolve; });
    if (responseMode === 'auth') return Response.json({ error: 'authentication_required' }, { status: 401 });
    if (responseMode === 'outage') return Response.json({ error: 'service_unavailable' }, { status: 503 });
    return Response.json({ schoolId: JSON.parse(options.body).schoolId, barcode: BARCODE });
  };
  const documentEvents = new EventTarget();
  const document = { visibilityState: 'visible', getElementById: get,
    querySelectorAll: () => [], addEventListener: documentEvents.addEventListener.bind(documentEvents) };
  const windowEvents = new EventTarget();
  const window = { localStorage, isSecureContext: true, addEventListener: windowEvents.addEventListener.bind(windowEvents) };
  const replacements = { window, document, location: { href: 'https://own.example/' }, navigator: {},
    matchMedia: () => ({ matches: false }), fetch: fakeFetch };
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const submit = id => get(id).dispatchEvent(new Event('submit', { cancelable: true }));
  const tokenKey = id => 'my-barcode.token.v1.' + id;
  try {
    await import('../public/app.js');
    await t.test('initial screen imports a token only after a valid barcode response', async () => {
      assert.equal(calls.length, 0);
      get('connect-button').click();
      assert.equal(get('login-dialog').open, true);
      get('token-input').value = TOKEN;
      submit('login-form');
      await until(() => get('status-label').textContent === 'Ready to scan');
      assert.equal(get('login-dialog').open, false);
      assert.equal(get('token-input').value, '');
      assert.equal(JSON.parse(values.get(tokenKey('107'))).token, TOKEN);
      assert.match(get('barcode-slot').innerHTML, /<svg/);
      assert.equal(get('scan-button').hidden, false);
      assert.ok(calls.every(call => !call.url.includes(TOKEN)));
    });
    await t.test('expired token opens renewal; backend outage retains token without opening login', async () => {
      responseMode = 'auth'; get('refresh-button').click();
      await until(() => get('login-dialog').open);
      assert.equal(get('barcode-slot').hidden, true);
      assert.equal(JSON.parse(values.get(tokenKey('107'))).token, TOKEN);
      get('login-dialog').close();
      responseMode = 'outage'; get('refresh-button').click();
      await until(() => get('status-label').textContent === 'Unavailable');
      assert.equal(get('login-dialog').open, false);
      assert.equal(get('barcode-slot').hidden, true);
      assert.equal(JSON.parse(values.get(tokenKey('107'))).token, TOKEN);
    });
    await t.test('switching institutions cancels a pending import without saving or showing its result', async () => {
      responseMode = 'deferred';
      get('connect-button').click(); get('token-input').value = 'synthetic-replacement-token'; submit('login-form');
      await until(() => deferred !== null);
      assert.equal(JSON.parse(values.get(tokenKey('107'))).token, TOKEN);
      get('login-dialog').close();
      get('settings-button').click(); get('school-input').value = '108'; get('name-input').value = 'Another institution';
      submit('settings-form');
      deferred(Response.json({ schoolId: '107', barcode: BARCODE }));
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(get('institution-name').textContent, 'Another institution');
      assert.equal(get('barcode-slot').hidden, true);
      assert.equal(values.get(tokenKey('108')), undefined);
      assert.equal(JSON.parse(values.get(tokenKey('107'))).token, TOKEN);
    });
    await t.test('Python token file is read locally and checked against the selected institution', async () => {
      responseMode = 'good'; get('connect-button').click();
      const before = calls.length;
      get('token-file').files = [{ size: 100, text: async () => JSON.stringify({ school_id: '107', token: TOKEN }) }];
      get('token-file').dispatchEvent(new Event('change'));
      await until(() => !get('login-error').hidden);
      assert.equal(calls.length, before);
      get('token-file').files = [{ size: 100, text: async () => JSON.stringify({ school_id: '108', token: 'synthetic-token-108' }) }];
      get('token-file').dispatchEvent(new Event('change'));
      await until(() => get('status-label').textContent === 'Ready to scan');
      assert.equal(JSON.parse(values.get(tokenKey('108'))).token, 'synthetic-token-108');
      assert.equal(get('login-dialog').open, false);
    });
    await t.test('forget removes only the active institution login and hides the barcode', async () => {
      get('settings-button').click(); get('forget-button').click();
      assert.equal(values.get(tokenKey('108')), undefined);
      assert.equal(JSON.parse(values.get(tokenKey('107'))).token, TOKEN);
      assert.equal(get('barcode-slot').hidden, true);
      assert.equal(get('scan-button').hidden, true);
      assert.equal(get('download-button').hidden, true);
    });
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  }
});
