import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { ApiError, validateSchoolId, validateToken, parseUpstream, boundedText } from './public/lib/response.js';

const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
export const UPSTREAM = 'https://innosoftfusiongo.com/sso/api/barcode.php';
const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/sw.js', ['sw.js', 'text/javascript; charset=utf-8']],
  ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json']],
  ...['barcode', 'response', 'state', 'api'].map(name => [`/lib/${name}.js`, [`lib/${name}.js`, 'text/javascript; charset=utf-8']]),
  ...['icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'].map(name => [`/icons/${name}`, [`icons/${name}`, name.endsWith('.svg') ? 'image/svg+xml' : 'image/png']]),
]);
export const SECURITY_HEADERS = {
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

function send(res, status, body, type = 'application/json; charset=utf-8', method = '') {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', 'Content-Type': type });
  res.end(method === 'HEAD' ? undefined : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (!req.headers.origin) return true;
  try {
    const origin = new URL(req.headers.origin);
    return ['http:', 'https:'].includes(origin.protocol) && origin.host === req.headers.host &&
      !origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash;
  } catch { return false; }
}

async function readInput(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 4096) throw new ApiError('invalid_input');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError('invalid_input'); }
}

export function createHandler({ fetchImpl = globalThis.fetch, assetReader = readFile } = {}) {
  return async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (!sameOrigin(req)) return send(res, 403, { error: 'invalid_input' });
        if (url.pathname === '/api/health' && req.method === 'GET') {
          return send(res, 200, { service: 'my-barcode', relay: true });
        }
        if (url.pathname !== '/api/barcode') return send(res, 404, { error: 'invalid_input' });
        if (req.method !== 'POST') return send(res, 405, { error: 'invalid_input' });
        if (url.search) return send(res, 400, { error: 'invalid_input' });
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
          return send(res, 415, { error: 'invalid_input' });
        }
        const authorization = req.headers.authorization || '';
        if (!authorization.startsWith('Bearer ')) return send(res, 401, { error: 'authentication_required' });
        const token = validateToken(authorization.slice(7));
        const input = await readInput(req);
        if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).some(key => key !== 'schoolId')) {
          throw new ApiError('invalid_input');
        }
        const schoolId = validateSchoolId(input.schoolId);
        const response = await fetchImpl(`${UPSTREAM}?id=${schoolId}`, {
          method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'FusionGo' },
          redirect: 'error', signal: AbortSignal.timeout(18000),
        });
        const barcode = parseUpstream(response.status, await boundedText(response));
        return send(res, 200, { schoolId, barcode });
      }
      const asset = ASSETS.get(url.pathname);
      if (!asset) return send(res, 404, 'Not found', 'text/plain; charset=utf-8', req.method);
      if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8');
      const content = await assetReader(path.join(PUBLIC, asset[0]));
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': asset[1], 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      // No request logging, credential persistence, upstream bodies or stack
      // traces. This handler can relay only to the fixed FusionGo endpoint.
      const code = error instanceof ApiError ? error.code : 'service_unavailable';
      const status = { invalid_input: 400, authentication_required: 401, invalid_response: 502, rate_limited: 429 }[code] || 503;
      if (!res.headersSent) send(res, status, { error: code });
      else res.end();
    }
  };
}

export function createServer(options) {
  return http.createServer({ maxHeaderSize: 16384, requestTimeout: 30000, headersTimeout: 15000 }, createHandler(options));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be an integer between 1 and 65535.'); process.exitCode = 1;
  } else {
    const server = createServer();
    server.on('error', () => { console.error('Could not start the server. Check HOST, PORT and port availability.'); process.exitCode = 1; });
    server.listen(port, host, () => console.log(`Rec Code: http://${host}:${port}`));
    process.on('SIGINT', () => server.close());
    process.on('SIGTERM', () => server.close());
  }
}
