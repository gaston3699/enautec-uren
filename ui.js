// Kleine hulpfuncties voor de schermen.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

let toastTimer;
export function toast(msg, kind = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.className = `show ${kind}`;
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3500);
}

/** Actieve (niet-verwijderde) records */
export const alive = (list = []) => list.filter((x) => !x.deleted);

export const byName = (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'nl');

/** Id van een samengevoegd project/klant doorverwijzen naar het bestaande (merged_into) */
export function resolveId(list = [], id) {
  let cur = id;
  for (let i = 0; i < 5 && cur; i++) {
    const r = list.find((x) => x.id === cur);
    if (!r?.merged_into) break;
    cur = r.merged_into;
  }
  return cur;
}

export function projectLabel(p, master) {
  if (!p) return '';
  if (p.merged_into) p = master.projects.find((x) => x.id === resolveId(master.projects, p.id)) ?? p;
  const c = master.customers.find((x) => x.id === resolveId(master.customers, p.customer_id));
  return [c?.name, p.code, p.name].filter(Boolean).join(' · ') + (p.pending || c?.pending ? ' (nieuw)' : '');
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Gekopieerd'); } catch { prompt('Kopieer deze tekst:', text); }
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
