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
