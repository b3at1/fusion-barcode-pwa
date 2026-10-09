import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHandler, UPSTREAM } from '../server.js';

const TOKEN = 'synthetic-token-for-server-tests';
const BARCODE = '&0000123456789&';

async function request(handler, { url = '/api/barcode', method = 'POST', body = '{"schoolId":"107"}', headers = {} } = {}) {
  const req = Readable.from([Buffer.from(body)]);
  Object.assign(req, { url, method, headers: { host: 'own.example', origin: 'https://own.example',
    'content-type': 'application/json', authorization: 'Bearer ' + TOKEN, ...headers } });
  const result = {};
  const res = { headersSent: false, writeHead(status, headers) {
    result.status = status; result.headers = headers; this.headersSent = true;
  }, end(body) { result.body = body === undefined ? '' : Buffer.isBuffer(body) ? body.toString() : body; } };
  await handler(req, res);
  return result;
}

test('relay uses only the fixed upstream with bounded institution ID and bearer header', async () => {
  const calls = [];
  const handler = createHandler({ fetchImpl: async (url, options) => {
    calls.push([url, options]);
    return new Response(JSON.stringify([{ AppBarcodeIdNumber: BARCODE, TypeName: 'private ignored metadata' }]));
  } });
  const result = await request(handler);
  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { schoolId: '107', barcode: BARCODE });
  assert.equal(calls[0][0], UPSTREAM + '?id=107');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(calls[0][1].headers.Cookie, undefined);
  assert.equal(calls[0][1].redirect, 'error');
  assert.equal(calls[0][1].cache, 'no-store');
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(result.headers['Referrer-Policy'], 'no-referrer');
  assert.match(result.headers['Content-Security-Policy'], /script-src 'self'/);
  assert.ok(!result.body.includes(TOKEN));
  assert.ok(!result.body.includes('private ignored metadata'));
});

test('cross-origin, missing auth, bad IDs, arbitrary targets and oversized input never reach upstream', async () => {
  let calls = 0;
  const handler = createHandler({ fetchImpl: async () => { calls++; throw Error('Must not call upstream'); } });
  const cases = [
    { headers: { origin: 'https://other.example' } },
    { headers: { 'sec-fetch-site': 'cross-site' } },
    { headers: { 'sec-fetch-site': 'same-site' } },
    { headers: { origin: undefined } },
    { headers: { origin: 'null' } },
    { headers: { origin: 'http://own.example' } },
    { headers: { origin: 'https://own.example:444' } },
    { headers: { origin: 'https://own.example.attacker.example' } },
    { headers: { origin: undefined, 'sec-fetch-site': 'none' } },
    { headers: { 'sec-fetch-mode': 'navigate' } },
    { headers: { 'sec-fetch-dest': 'iframe' } },
    { headers: { authorization: '' } },
    { body: '{"schoolId":"107&url=https://other.example"}' },
    { body: '{"schoolId":"107","url":"https://other.example"}' },
    { body: '{"schoolId":107}' }, { body: '[]' }, { body: 'not JSON' },
    { body: 'x'.repeat(4097) }, { url: '/api/barcode?token=secret' },
    { method: 'OPTIONS' }, { method: 'GET' },
  ];
  for (const item of cases) {
    const result = await request(handler, item);
    assert.ok(result.status >= 400);
    assert.ok(!result.body.includes(TOKEN));
  }
  assert.equal(calls, 0);
});

test('same-origin metadata and loopback development work without widening CORS', async () => {
  const handler = createHandler({ fetchImpl: async () => Response.json([{ AppBarcodeIdNumber: BARCODE }]) });
  for (const headers of [
    { origin: undefined, 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' },
    { origin: 'http://127.0.0.1:4173', host: '127.0.0.1:4173' },
    { origin: 'http://localhost:4173', host: 'localhost:4173' },
    { origin: 'http://[::1]:4173', host: '[::1]:4173' },
  ]) {
    const result = await request(handler, { headers });
    assert.equal(result.status, 200);
    assert.equal(result.headers['Access-Control-Allow-Origin'], undefined);
  }
  const health = await request(handler, { url: '/api/health', method: 'GET', headers: { origin: undefined, authorization: '' } });
  assert.equal(health.status, 200);
});

test('relay limits repeated credentials, resets the window, and does not reveal them', async () => {
  let time = 0;
  let calls = 0;
  const handler = createHandler({ now: () => time, fetchImpl: async () => {
    calls++;
    return Response.json([{ AppBarcodeIdNumber: BARCODE }]);
  } });
  for (let i = 0; i < 12; i++) assert.equal((await request(handler)).status, 200);
  const limited = await request(handler);
  assert.equal(limited.status, 429);
  assert.deepEqual(JSON.parse(limited.body), { error: 'rate_limited' });
  assert.equal(limited.headers['Cache-Control'], 'no-store');
  assert.equal(limited.headers['Retry-After'], '60');
  assert.ok(!limited.body.includes(TOKEN));
  assert.equal(calls, 12);
  // A different credential still works; health checks do not consume capacity.
  assert.equal((await request(handler, { headers: { authorization: 'Bearer synthetic-other-token' } })).status, 200);
  assert.equal((await request(handler, { url: '/api/health', method: 'GET' })).status, 200);
  time = 60000;
  assert.equal((await request(handler)).status, 200);
});

test('aggregate limits bound rotating credentials and concurrency slots recover after errors', async () => {
  const handler = createHandler({ fetchImpl: async () => Response.json([{ AppBarcodeIdNumber: BARCODE }]) });
  for (let i = 0; i < 120; i++) {
    assert.equal((await request(handler, { headers: { authorization: `Bearer synthetic-rotating-${i}` } })).status, 200);
  }
  assert.equal((await request(handler)).status, 429);

  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const concurrent = createHandler({ fetchImpl: async () => { await blocked; throw Error('synthetic transport failure'); } });
  const pending = Array.from({ length: 8 }, () => request(concurrent));
  // These requests admit before fetch and keep their slots until its body/error completes.
  const ninth = await request(concurrent);
  assert.equal(ninth.status, 429);
  release();
  for (const result of await Promise.all(pending)) assert.equal(result.status, 503);
  assert.equal((await request(concurrent)).status, 503);
});

test('expired tokens, backend failures and stack traces become generic responses', async () => {
  for (const [status, message, expectedStatus, expectedCode] of [
    [400, 'Authorization has been denied ' + TOKEN, 401, 'authentication_required'],
    [400, 'Could not reach https://backend.example:8443 /var/www/Guard.php Stack trace ' + TOKEN, 503, 'service_unavailable'],
    [200, 'not JSON ' + TOKEN, 502, 'invalid_response'],
    [429, 'slow down ' + TOKEN, 429, 'rate_limited'],
  ]) {
    const handler = createHandler({ fetchImpl: async () => new Response(JSON.stringify({ message }), { status }) });
    const result = await request(handler);
    assert.equal(result.status, expectedStatus);
    assert.deepEqual(JSON.parse(result.body), { error: expectedCode });
    for (const secret of [TOKEN, 'backend.example', '/var/www', 'Stack trace']) assert.ok(!result.body.includes(secret));
  }
});

test('transport errors and excessive responses do not leak upstream details', async () => {
  for (const fetchImpl of [async () => { throw Error('Network error ' + TOKEN); },
    async () => new Response('x'.repeat(1024 * 1024 + 1))]) {
    const result = await request(createHandler({ fetchImpl }));
    assert.equal(result.status, 503);
    assert.deepEqual(JSON.parse(result.body), { error: 'service_unavailable' });
  }
});

test('only public assets are served; health is credential-free and no API CORS is advertised', async () => {
  const handler = createHandler({ assetReader: async () => Buffer.from('public asset') });
  const health = await request(handler, { url: '/api/health', method: 'GET', headers: { authorization: '' } });
  assert.deepEqual(JSON.parse(health.body), { service: 'my-barcode', relay: true });
  assert.equal(health.headers['Access-Control-Allow-Origin'], undefined);
  const index = await request(handler, { url: '/', method: 'GET' });
  assert.equal(index.status, 200);
  assert.equal(index.headers['Content-Type'], 'text/html; charset=utf-8');
  const head = await request(handler, { url: '/', method: 'HEAD' });
  assert.equal(head.body, '');
  for (const url of ['/.git/config', '/server.js', '/README.md', '/%2e%2e/server.js', '/secrets.json']) {
    assert.equal((await request(handler, { url, method: 'GET' })).status, 404);
  }
});
