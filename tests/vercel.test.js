import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { SECURITY_HEADERS, UPSTREAM } from '../server.js';

async function request(handler, url, { token = '', body = '', method = 'GET' } = {}) {
  const req = Readable.from([Buffer.from(body)]);
  Object.assign(req, { url, method, headers: {
    host: 'rec-code.vercel.app', origin: 'https://rec-code.vercel.app',
    'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
    ...(token ? { authorization: 'Bearer ' + token } : {}),
  } });
  // Vercel may provide lazy body helpers; our handler should use the raw stream.
  Object.defineProperty(req, 'body', { get() { assert.fail('Request body helper must not be accessed'); } });
  const result = {};
  const res = { headersSent: false,
    writeHead(status, headers) { this.headersSent = true; Object.assign(result, { status, headers }); },
    end(body) { result.body = JSON.parse(body); },
  };
  await handler(req, res);
  return result;
}

test('Vercel function entry points handle real relay paths and HTTPS origin headers', async t => {
  const calls = [];
  const token = 'synthetic-vercel-test-token';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push([url, options]);
    return Response.json([{ AppBarcodeIdNumber: '&0000123456789&' }]);
  });
  const { default: health } = await import('../api/health.js');
  const { default: barcode } = await import('../api/barcode.js');
  const status = await request(health, '/api/health');
  assert.equal(status.status, 200);
  assert.deepEqual(status.body, { service: 'my-barcode', relay: true });
  assert.equal(calls.length, 0);
  assert.equal((await request(barcode, '/api/barcode', { method: 'POST', body: '{"schoolId":"107"}' })).status, 401);
  const result = await request(barcode, '/api/barcode', { method: 'POST', token, body: '{"schoolId":"107"}' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { schoolId: '107', barcode: '&0000123456789&' });
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], UPSTREAM + '?id=107');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer ' + token);
});

test('Vercel publishes only public assets with matching security headers and sufficient function time', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, 'public');
  assert.equal(config.buildCommand, 'npm test');
  assert.equal(pkg.engines.node, '22.x');
  assert.ok(config.functions['api/*.js'].maxDuration > 18);
  const globalHeaders = Object.fromEntries(config.headers.find(rule => rule.source === '/(.*)').headers.map(item => [item.key, item.value]));
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) assert.equal(globalHeaders[key], value);
  assert.equal(globalHeaders['Cache-Control'], 'no-cache');
  const apiHeaders = config.headers.find(rule => rule.source === '/api/(.*)').headers;
  assert.ok(apiHeaders.some(header => header.key === 'Cache-Control' && header.value === 'no-store'));
});
