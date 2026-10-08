import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('service worker caches only interface assets, never tokens or API responses', async () => {
  const events = new Map();
  const cachedUrls = [];
  const putUrls = [];
  const removed = [];
  const cache = { addAll: async urls => cachedUrls.push(...urls), match: async () => undefined,
    put: async request => putUrls.push(request.url) };
  const context = {
    URL, self: { location: { href: 'https://own.example/sw.js' },
      addEventListener: (type, fn) => events.set(type, fn), skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: { open: async () => cache, keys: async () => ['my-barcode-shell-old', 'unrelated-app'], delete: async key => removed.push(key) },
    fetch: async () => new Response('shell'),
  };
  vm.runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  let pending;
  events.get('install')({ waitUntil: promise => { pending = promise; } }); await pending;
  assert.ok(cachedUrls.includes('./index.html'));
  assert.ok(cachedUrls.every(url => !url.includes('api/') && !url.includes('fusiontoken')));
  events.get('activate')({ waitUntil: promise => { pending = promise; } }); await pending;
  assert.deepEqual(removed, ['my-barcode-shell-old']);
  for (const req of [new Request('https://own.example/api/barcode'),
    new Request('https://own.example/', { headers: { Authorization: 'Bearer synthetic-token' } }),
    new Request('https://own.example/?fusiontoken=synthetic-token'),
    new Request('https://innosoftfusiongo.com/sso/api/barcode.php?id=107'),
    new Request('https://own.example/', { method: 'POST', body: 'secret' })]) {
    let responded = false;
    events.get('fetch')({ request: req, respondWith: () => { responded = true; } });
    assert.equal(responded, false);
  }
  events.get('fetch')({ request: new Request('https://own.example/app.js'), respondWith: promise => { pending = promise; } });
  await pending;
  assert.deepEqual(putUrls, ['https://own.example/app.js']);
});
