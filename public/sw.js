// Caches the app shell so Pin City opens without signal. Pins themselves are kept in
// localStorage by app.js after each download.
const CACHE = 'pincity-shell-v1';
const SHELL = ['/', '/index.html', '/app.css', '/app.js', '/map.js', '/manifest.json', '/icon.svg',
  '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/leaflet.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return;
  if (!SHELL.includes(url.pathname) && !SHELL.includes(e.request.url)) return;
  // Network first so updates land straight away; cache when offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request))
  );
});
