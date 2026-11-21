// Updates van de app: een nieuwe versie wordt klaargezet, de balk bovenaan kleurt geel
// met een knop "Bijwerken", en pas na bevestiging wordt de nieuwe versie geladen.
import { esc } from './ui.js';

let registration = null;
let reloading = false;

function showUpdateBar(on) {
  document.body.classList.toggle('update-ready', on);
  const btn = document.getElementById('updateBtn');
  if (btn) btn.hidden = !on;
}

/** Bevestigingsvenster in de stijl van de app; geeft true/false terug */
export function confirmDialog({ title, text, ok = 'OK', cancel = 'Annuleren' }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mTitle">
      <h2 id="mTitle">${esc(title)}</h2>
      <p>${esc(text)}</p>
      <div class="row modal-actions">
        <button class="secondary" data-a="cancel">${esc(cancel)}</button>
        <button class="primary" data-a="ok">${esc(ok)}</button>
      </div></div>`;
    const done = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) done(false);
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a) done(a === 'ok');
    });
    document.addEventListener('keydown', onKey);
    document.body.append(wrap);
    wrap.querySelector('[data-a=ok]').focus();
  });
}

function watchInstalling(worker) {
  if (!worker) return;
  worker.addEventListener('statechange', () => {
    // "installed" terwijl er al een versie actief is = er staat een update klaar
    if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBar(true);
  });
}

async function applyUpdate() {
  const ok = await confirmDialog({
    title: 'Nieuwe versie beschikbaar',
    text: 'Wil je de app nu bijwerken? Je gegevens blijven bewaard. De app herstart even.',
    ok: 'Bijwerken',
    cancel: 'Later',
  });
  if (!ok) return;
  const waiting = registration?.waiting;
  if (!waiting) { location.reload(); return; }
  waiting.postMessage({ type: 'SKIP_WAITING' });
}

/** Offline-module registreren en op updates letten */
export async function initUpdates() {
  if (!('serviceWorker' in navigator)) return;
  document.getElementById('updateBtn')?.addEventListener('click', applyUpdate);
  try {
    registration = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
  } catch { return; }

  if (registration.waiting && navigator.serviceWorker.controller) showUpdateBar(true);
  watchInstalling(registration.installing);
  registration.addEventListener('updatefound', () => watchInstalling(registration.installing));

  // Pas herladen nadat de gebruiker bevestigd heeft (dan neemt de nieuwe versie over)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  // Regelmatig nagaan of er een nieuwe versie is
  const check = () => registration.update().catch(() => {});
  setInterval(check, 30 * 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
}
