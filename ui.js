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

export function projectLabel(p, master) {
  if (!p) return '';
  const c = master.customers.find((x) => x.id === p.customer_id);
  return [c?.name, p.code, p.name].filter(Boolean).join(' · ');
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Gekopieerd'); } catch { prompt('Kopieer deze tekst:', text); }
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
