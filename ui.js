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

/** Initialen: eerste letter van de voornaam en van de achternaam ("Wouter Vanthuyne" → "WV", "Jan Van den Berg" → "JV") */
export const initials = (n) => {
  const w = String(n ?? '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '';
  // achternaam = alles na de voornaam (bv. "Van den Berg"): eerste letter daarvan
  return (w[0][0] + (w[1]?.[0] ?? '')).toUpperCase();
};

/**
 * Keuzelijst met personen (zoals iOS): dicht toont ze de initialen van wie gekozen is,
 * open een lijst met per naam een schakelaar. Gekozen namen worden geel geaccentueerd.
 * people: [{ value, label, short? }]; selected: Set of array van values.
 * De schakelaars zijn gewone checkboxes (name, value), dus bestaande code die
 * `input:checked` leest blijft werken.
 */
export function personPickHtml({ id = '', name = '', people = [], selected = [], label = 'Personen', empty = 'Niemand gekozen' }) {
  const sel = new Set(selected);
  return `<details class="person-pick" ${id ? `id="${esc(id)}"` : ''} data-empty="${esc(empty)}">
    <summary aria-label="${esc(label)}"><span class="pp-label">${esc(label)}</span><span class="pp-sum">${pickSummary(people.filter((p) => sel.has(p.value)), empty)}</span><span class="chev" aria-hidden="true">›</span></summary>
    <div class="pp-list" role="group" aria-label="${esc(label)}">
      ${people.map((p) => `<label class="pp-row ${sel.has(p.value) ? 'on' : ''}" data-short="${esc(p.short ?? initials(p.label))}"><span>${esc(p.label)}</span>
        <input type="checkbox" class="ios-switch" ${name ? `name="${esc(name)}"` : ''} value="${esc(p.value)}" ${sel.has(p.value) ? 'checked' : ''}></label>`).join('')}
    </div></details>`;
}
// hoogstens 3 initialen, daarna "+N" (zo blijft de knop even breed en springt hij niet weg)
const pickSummary = (on, empty) => (on.length
  ? on.slice(0, on.length > 3 ? 2 : 3).map((p) => `<b class="pp-ini">${esc(p.short ?? initials(p.label))}</b>`).join('')
    + (on.length > 3 ? `<b class="pp-ini more">+${on.length - 2}</b>` : '')
  : `<span class="muted">${esc(empty)}</span>`);

// samenvatting (initialen) en accent bijwerken bij elke schakelaar; dicht bij tikken ernaast
if (typeof document !== 'undefined') {
  document.addEventListener('change', (e) => {
    const box = e.target.closest?.('.person-pick');
    if (!box) return;
    box.querySelectorAll('.pp-row').forEach((r) => r.classList.toggle('on', r.querySelector('input').checked));
    const on = [...box.querySelectorAll('.pp-row.on')].map((r) => ({ short: r.dataset.short }));
    box.querySelector('.pp-sum').innerHTML = pickSummary(on, box.dataset.empty);
  }, true);
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.person-pick[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; });
  });
}

// ---------- Instellingen zoals iOS ----------
/** Groep afgeronde rijen, met grijze titel erboven en kleine uitleg eronder (beide mogen leeg) */
export const iosGroup = (rows, { header = '', footer = '' } = {}) => (rows.filter(Boolean).length
  ? `<div class="ios-group-wrap">${header ? `<h3 class="ios-head">${header}</h3>` : ''}<ul class="ios-group">${rows.filter(Boolean).join('')}</ul>${footer ? `<p class="ios-foot">${footer}</p>` : ''}</div>` : '');
/**
 * Eén rij: gekleurd vierkant icoon, label, waarde rechts (grijs) en › (link), of een schakelaar.
 * toggle: HTML-attributen voor de checkbox (bv. 'data-pref="counters" checked').
 */
export function iosRow({ icon = '', color = '#8e8e93', label, value = '', href = '', act = '', toggle = null, danger = false, sub = '' }) {
  const ico = icon ? `<span class="ios-ico" style="background:${color}" aria-hidden="true">${icon}</span>` : '';
  const text = `<span class="ios-label ${danger ? 'danger' : ''}">${label}${sub ? `<small>${sub}</small>` : ''}</span>`;
  if (toggle != null) return `<li><label class="ios-row">${ico}${text}<input type="checkbox" class="ios-switch" ${toggle}></label></li>`;
  const tail = `${value ? `<span class="ios-value">${value}</span>` : ''}${href || act ? '<span class="ios-chev" aria-hidden="true">›</span>' : ''}`;
  if (href) return `<li><a class="ios-row" href="${esc(href)}">${ico}${text}${tail}</a></li>`;
  if (act) return `<li><button type="button" class="ios-row" data-act="${esc(act)}">${ico}${text}${tail}</button></li>`;
  return `<li><div class="ios-row">${ico}${text}${tail}</div></li>`;
}
/** Kop van een subpagina: terugknop (‹ Vorige) en grote titel */
export const iosPageHead = (title, back, backLabel) => `<a class="ios-back" href="${esc(back)}"><span aria-hidden="true">‹</span> ${esc(backLabel)}</a>
  <h1 class="page-title">${title}</h1>`;

/**
 * Uitklapblok (standaard dicht). De open/dicht-stand wordt onthouden per sleutel, ook als het scherm
 * opnieuw getekend wordt. group: blokken met dezelfde groep gedragen zich als accordeon (één tegelijk open).
 */
const foldState = new Map();
export function fold(key, title, body, { open = false, force = false, group = '', extra = '', cls = '' } = {}) {
  if (force) foldState.set(key, true);
  const isOpen = foldState.has(key) ? foldState.get(key) : open;
  return `<details class="fold ${cls}" data-fold="${esc(key)}" ${group ? `data-group="${esc(group)}"` : ''} ${isOpen ? 'open' : ''}>
    <summary><span class="fold-title">${title}</span>${extra ? `<span class="fold-extra">${extra}</span>` : ''}<span class="chev" aria-hidden="true">›</span></summary>
    <div class="fold-body">${body}</div></details>`;
}
if (typeof document !== 'undefined') {
  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d.matches?.('details.fold')) return;
    foldState.set(d.dataset.fold, d.open);
    if (d.open && d.dataset.group) {
      document.querySelectorAll(`details.fold[data-group="${CSS.escape(d.dataset.group)}"][open]`).forEach((o) => { if (o !== d) o.open = false; });
    }
  }, true);
}

/**
 * i-icoontje (zoals iOS) met extra uitleg: tikken toont de tekst in een ballonnetje.
 * Alle uitleg hoort hierachter, niet als losse tekst op het scherm.
 */
export const info = (text, label = 'Meer uitleg') => (text
  ? `<button type="button" class="info-i" data-info="${esc(text)}" aria-label="${esc(label)}">i</button>` : '');

if (typeof document !== 'undefined') {
  let pop = null;
  const closePop = () => { pop?.remove(); pop = null; };
  document.addEventListener('click', (e) => {
    const b = e.target.closest?.('.info-i');
    if (!b) { if (pop && !pop.contains(e.target)) closePop(); return; }
    e.preventDefault(); e.stopPropagation();
    const same = pop?.dataset.for === b.dataset.info;
    closePop();
    if (same) return;
    pop = document.createElement('div');
    pop.className = 'info-pop';
    pop.setAttribute('role', 'tooltip');
    pop.dataset.for = b.dataset.info;
    pop.textContent = b.dataset.info;
    document.body.append(pop);
    const r = b.getBoundingClientRect();
    const w = pop.offsetWidth; const h = pop.offsetHeight;
    const left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - 24));
    const below = r.bottom + 10 + h < window.innerHeight || r.top < h + 20;
    pop.classList.toggle('up', !below);
    pop.style.left = `${left + window.scrollX}px`;
    pop.style.top = `${(below ? r.bottom + 10 : r.top - h - 10) + window.scrollY}px`;
    pop.style.setProperty('--ax', `${Math.max(10, r.left + r.width / 2 - left - 6)}px`);
  }, true);
  window.addEventListener('hashchange', closePop);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Gekopieerd'); } catch { prompt('Kopieer deze tekst:', text); }
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
