import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, barcodeGeometry, barcodeSvg } from '../public/lib/barcode.js';
import { ApiError, extractToken, parseUpstream, boundedText } from '../public/lib/response.js';
import { TokenVault, readSettings, saveSettings } from '../public/lib/state.js';
import { BarcodeApi } from '../public/lib/api.js';

const TOKEN = 'synthetic-token-for-pwa-tests';
const BARCODE = '&0000123456789&';
const raw = JSON.stringify([{ AppBarcodeIdNumber: BARCODE }]);
const storage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key), values };
};

test('Code 128 known checksums, leading zeros and delimiters', () => {
  assert.deepEqual(encode('123456'), [105, 12, 34, 56, 44, 106]);
  assert.deepEqual(encode('123456789'), [105, 12, 34, 56, 78, 100, 25, 79, 106]);
  assert.deepEqual(encode('ABC'), [104, 33, 34, 35, 1, 106]);
  assert.deepEqual(encode('001234'), [105, 0, 12, 34, 25, 106]);
  const codes = encode(BARCODE);
  assert.equal(codes[1], '&'.charCodeAt(0) - 32);
  assert.equal(codes.at(-3), '&'.charCodeAt(0) - 32);
  const shape = barcodeGeometry(BARCODE);
  assert.equal(shape.bars[0].x, 30);
  assert.equal(shape.width - shape.bars.at(-1).x - shape.bars.at(-1).width, 30);
  assert.match(barcodeSvg(BARCODE), /<svg/);
  assert.doesNotMatch(barcodeSvg('<script>alert(1)</script>'), /<script>/);
  for (const value of ['', 'é', '12\n34', '１２３', 'x'.repeat(257)]) assert.throws(() => encode(value));
});

test('completion URL import accepts only the correct trusted origin and institution', () => {
  const url = 'https://innosoftfusiongo.com/sso/login/login-finish.php?fusiontoken=' + TOKEN;
  assert.equal(extractToken(url, '107'), TOKEN);
  assert.equal(extractToken(TOKEN, '107'), TOKEN);
  for (const invalid of [url.replace('https:', 'http:'), url.replace('.com/', '.com.attacker.example/'),
    url.replace('/sso/login/', '/another/'), url + '&fusiontoken=duplicate', url + '&id=108', 'token\nheader']) {
    assert.throws(() => extractToken(invalid, '107'), ApiError);
  }
});

test('token storage is institution-specific and forget removes only the selected login', () => {
  const disk = storage();
  const vault = new TokenVault(disk);
  vault.put('107', TOKEN);
  vault.put('108', 'different-synthetic-token');
  assert.equal(new TokenVault(disk).get('107').token, TOKEN);
  assert.equal(vault.get('109'), null);
  assert.equal(vault.forget('107'), true);
  assert.equal(new TokenVault(disk).get('107'), null);
  assert.equal(new TokenVault(disk).get('108').token, 'different-synthetic-token');
  assert.doesNotMatch(JSON.stringify([...disk.values]), new RegExp(BARCODE));
});

test('corrupt storage falls back safely; blocked storage can remember the current session', () => {
  const disk = storage();
  disk.setItem('my-barcode.token.v1.107', 'not JSON');
  assert.equal(new TokenVault(disk).get('107'), null);
  const blocked = { getItem() { throw Error(); }, setItem() { throw Error(); }, removeItem() { throw Error(); } };
  const vault = new TokenVault(blocked);
  assert.equal(vault.put('107', TOKEN), false);
  assert.deepEqual(vault.get('107'), { token: TOKEN, persistent: false });
  assert.equal(vault.forget('107'), false);
  assert.equal(vault.get('107'), null);
  const preferences = { schoolId: '108', name: 'Another institution' };
  assert.equal(saveSettings(disk, preferences), true);
  assert.deepEqual(readSettings(disk), preferences);
  disk.setItem('my-barcode.settings.v1', JSON.stringify({ ...preferences, connection: 'direct' }));
  assert.deepEqual(readSettings(disk), preferences);
});

test('upstream errors are classified without disclosing supplied messages or tokens', () => {
  assert.equal(parseUpstream(200, raw), BARCODE);
  assert.equal(new ApiError(TOKEN).code, 'service_unavailable');
  assert.equal(new ApiError('constructor').code, 'service_unavailable');
  for (const [status, body, code] of [
    [400, JSON.stringify({ message: 'Authorization has been denied ' + TOKEN }), 'authentication_required'],
    [400, JSON.stringify({ message: 'Could not reach /var/www/backend ' + TOKEN }), 'service_unavailable'],
    [503, 'unavailable ' + TOKEN, 'service_unavailable'],
    [429, 'rate limited', 'rate_limited'], [200, '[]', 'invalid_response'],
    [200, '[{"AppBarcodeIdNumber":true}]', 'invalid_response'], [200, 'not JSON', 'invalid_response'],
  ]) {
    assert.throws(() => parseUpstream(status, body), error => error.code === code && !String(error).includes(TOKEN));
  }
});

test('response reader stops at the byte limit', async () => {
  await assert.rejects(boundedText(new Response('x'.repeat(32)), 16), ApiError);
  assert.equal(await boundedText(new Response(raw)), raw);
});

test('barcode requests always use a single same-origin relay POST with the exact payload', async () => {
  const calls = [];
  const api = new BarcodeApi({ baseUrl: 'https://own.example/', fetchImpl: async (url, options) => {
    calls.push([String(url), options]);
    return Response.json({ schoolId: '107', barcode: BARCODE });
  } });
  assert.equal((await api.get('107', TOKEN)).barcode, BARCODE);
  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.equal(url, 'https://own.example/api/barcode');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN);
  assert.equal(options.credentials, 'omit');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.redirect, 'error');
  assert.equal(options.body, '{"schoolId":"107"}');
  assert.ok(!url.includes(TOKEN));
});

test('network errors retry only the same-origin relay and never expose transport errors', async () => {
  const urls = [];
  const api = new BarcodeApi({ baseUrl: 'https://own.example/', fetchImpl: async url => {
    urls.push(String(url));
    if (urls.length === 1) throw new TypeError(TOKEN);
    return Response.json({ schoolId: '107', barcode: BARCODE });
  } });
  await assert.rejects(api.get('107', TOKEN), error =>
    error.code === 'relay_connection_failed' && !error.needsLogin && !String(error).includes(TOKEN));
  assert.equal((await api.get('107', TOKEN)).barcode, BARCODE);
  assert.deepEqual(urls, ['https://own.example/api/barcode', 'https://own.example/api/barcode']);
});

test('static hosts pretending to serve the relay do not trigger unnecessary SSO renewal', async () => {
  for (const status of [200, 404, 405, 501]) {
    const api = new BarcodeApi({ fetchImpl: async () => new Response('<!doctype html><title>Static page</title>', { status }) });
    await assert.rejects(api.get('107', TOKEN), error => error.code === 'relay_unavailable' && !error.needsLogin);
  }
});

test('proxy HTML outages keep the login; relay errors never retain arbitrary supplied codes', async () => {
  for (const [status, body, code, needsLogin] of [
    [503, '<html>Proxy unavailable</html>', 'service_unavailable', false],
    [429, '<html>Too many requests</html>', 'rate_limited', false],
    [401, '<html>Unauthorized</html>', 'authentication_required', true],
    [502, JSON.stringify({ error: 'invalid_response' }), 'invalid_response', true],
    [400, JSON.stringify({ error: TOKEN }), 'service_unavailable', false],
    [200, 'null', 'invalid_response', true],
  ]) {
    const api = new BarcodeApi({ fetchImpl: async () => new Response(body, { status }) });
    await assert.rejects(api.get('107', TOKEN), error =>
      error.code === code && error.needsLogin === needsLogin && !String(error).includes(TOKEN));
  }
});

test('abort prevents token transmission and stale requests from continuing', async () => {
  const controller = new AbortController(); controller.abort();
  const api = new BarcodeApi({ fetchImpl: async (_url, options) => {
    options.signal.throwIfAborted();
    throw Error('Should not complete');
  } });
  await assert.rejects(api.get('107', TOKEN, controller.signal), error => error.name === 'AbortError');
});
