/* Offline-module van Enautec Uren (zelfde aanpak als Leervoortgang).
   - De app zelf: eerst online proberen (nieuwe versie komt meteen binnen), anders de bewaarde kopie.
   - Lettertypes en de Excel-module: bewaarde kopie gebruiken.
   - Microsoft (aanmelden, OneDrive) en de verzamelserver: nooit bewaren, altijd rechtstreeks. */
const CACHE = 'enautec-uren-v2';
const SHELL = ['./', './index.html', './app.js', './auth.js', './drive.js', './store.js', './day.js', './admin.js', './export.js', './gdrive.js',
  './engine.js', './geo.js', './time.js', './ui.js', './config.js', './demo.js', './manifest.webmanifest',
  './logo.svg', './logo-mark.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];
const STATIC_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('enautec-uren-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (STATIC_ORIGINS.includes(url.origin)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    })));
    return;
  }

  if (url.origin !== self.location.origin) return; // Microsoft, OneDrive, server: altijd rechtstreeks
  if (url.pathname.includes('/api/')) return;

  const net = req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req, { cache: 'no-cache' });
  e.respondWith(net.then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true })
    .then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))
    .then((hit) => hit || Response.error())));
});
