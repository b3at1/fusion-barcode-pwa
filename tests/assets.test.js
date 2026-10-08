import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHandler } from '../server.js';

const publicRoot = new URL('../public/', import.meta.url);

test('install assets and module imports exist and are served with the expected icon dimensions', async () => {
  const html = await readFile(new URL('index.html', publicRoot), 'utf8');
  const sw = await readFile(new URL('sw.js', publicRoot), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', publicRoot), 'utf8'));
  const paths = new Set(['./', './sw.js', ...[...html.matchAll(/(?:href|src)="(\.\/[^"\s]*)"/g)].map(match => match[1]),
    ...[...sw.matchAll(/'(\.\/[^']*)'/g)].map(match => match[1]), ...manifest.icons.map(icon => icon.src)]);
  for (const module of ['app.js', 'lib/api.js', 'lib/barcode.js', 'lib/response.js', 'lib/state.js']) {
    const moduleUrl = new URL(module, publicRoot);
    const source = await readFile(moduleUrl, 'utf8');
    for (const match of source.matchAll(/from\s+'(\.\/?[^']*)'/g)) {
      const resolved = new URL(match[1], moduleUrl);
      paths.add('./' + resolved.href.slice(publicRoot.href.length));
    }
  }
  const handler = createHandler({ fetchImpl: () => assert.fail('Assets must not call the upstream') });
  for (const relative of paths) {
    let status;
    let body;
    const url = new URL(relative, 'https://own.example/');
    await handler({ url: url.pathname, method: 'GET', headers: {} }, {
      writeHead(value) { status = value; }, end(value) { body = value; },
    });
    assert.equal(status, 200, relative + ' must be served');
    assert.ok(body.length, relative + ' must not be empty');
  }
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'standalone');
  for (const icon of [...manifest.icons, { src: './icons/apple-touch-icon.png', sizes: '180x180' }]) {
    const png = await readFile(new URL(icon.src, publicRoot));
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
});
