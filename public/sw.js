// Bump this name when publishing changed shell assets.
const CACHE = 'my-barcode-shell-v5';
const ASSETS = ['./', './index.html', './style.css', './app.js', './lib/barcode.js',
  './lib/response.js', './lib/state.js', './lib/api.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
const shellUrls = new Set(ASSETS.map(asset => new URL(asset, self.location.href).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('my-barcode-shell-') && key !== CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  // Only immutable shell destinations: never cache credentials, API requests,
  // barcodes, external SSO pages, arbitrary URLs, or query-bearing navigations.
  if (request.method !== 'GET' || url.search || request.headers.has('Authorization') || !shellUrls.has(url.href)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  }));
});
