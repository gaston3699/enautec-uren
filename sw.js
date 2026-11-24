/* Offline-module van Enautec Uren.
   - De app draait altijd uit de bewaarde versie (ook na lange tijd niet gebruikt).
   - Een nieuwe versie wordt op de achtergrond klaargezet en pas gebruikt als
     de gebruiker in de app op "Bijwerken" drukt en bevestigt.
   - Lettertypes en de Excel-module: bewaarde kopie gebruiken.
   - Google, de verzamelserver (/api/) en Microsoft: nooit bewaren, altijd rechtstreeks.
   VERSION wordt automatisch aangepast door scripts/stamp-version.js bij elke publicatie. */
const VERSION = 'e73fce0602be';
const CACHE = `enautec-uren-${VERSION}`;
const SHELL = ['./', './index.html', './app.js', './auth.js', './drive.js', './gdrive.js', './store.js', './day.js', './admin.js',
  './export.js', './engine.js', './geo.js', './time.js', './ui.js', './config.js', './demo.js', './update.js', './geocode.js', './xlsx.js', './report.js', './periods.js', './questions.js', './projects.js', './combo.js', './todo.js', './calendar.js', './manifest.webmanifest',
  './privacy.html', './logo.svg', './logo-mark.svg', './logo-mark-kerst.svg', './icon-kerst.svg', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];
const STATIC_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net'];

self.addEventListener('install', (e) => {
  // Altijd verse kopieën ophalen voor deze versie; NIET meteen activeren (wacht op de gebruiker)
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data?.type === 'VERSION') e.source?.postMessage({ type: 'VERSION', version: VERSION });
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('enautec-uren-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Pushmelding van de server tonen ("Aan het werk?", "Bij wie ben je?", "Dag bevestigen?")
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Enautec Uren', body: e.data?.text() ?? '' }; }
  const question = ['start', 'waar', 'pauze', 'pauze_einde'].includes(d.kind);
  e.waitUntil(self.registration.showNotification(d.title || 'Enautec Uren', {
    body: d.body || '', tag: d.tag || 'enautec', renotify: true, requireInteraction: question,
    icon: './icon-192.png', badge: './icon-192.png', data: { url: d.url || './' },
  }));
});

// Tik op de melding: de app openen (of een open venster gebruiken) op de juiste plek
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) {
        await w.focus();
        if ('navigate' in w) { try { await w.navigate(target); } catch { w.postMessage({ type: 'OPEN', url: target }); } }
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
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

  if (url.origin !== self.location.origin) return; // Google, Microsoft, server: altijd rechtstreeks
  if (url.pathname.includes('/api/')) return;

  // De app zelf: eerst de bewaarde versie (zo verandert er niets zonder bevestiging)
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(req, { ignoreSearch: true })
      || (req.mode === 'navigate' ? await c.match('./index.html') : undefined);
    if (hit) return hit;
    return fetch(req);
  }));
});
