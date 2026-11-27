// Kleine hulpfuncties voor de schermen.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

let toastTimer;
export function toast(msg, kind = '', action = null) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.className = `show ${kind}`;
  el.textContent = msg;
  // optioneel een knop in de melding, bv. "Ongedaan maken"
  if (action) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'toast-act'; b.textContent = action.label;
    b.onclick = () => { el.className = ''; action.fn(); };
    el.append(' ', b);
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, action ? 5000 : 3500);
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

/**
 * Materiaalregel: naam | aantal | eenheid op één regel (lange namen lopen door op een tweede regel).
 * Overal dezelfde: Dag (gebruikt materiaal) en Materiaal nodig (planning). Wissen = opzij vegen.
 * opts: { desc, qty, unit, list, idx, cls, del, readonly, extra }
 */
export function matRowHtml({ desc = '', qty = '', unit = '', list = '', idx = '', cls = '', del = 'del-mat', readonly = false, extra = '', mf = true } = {}) {
  const dis = readonly ? 'disabled' : '';
  const f = (k) => (mf ? ` data-mf="${k}"` : '');
  return `<div class="mat-swipe${readonly ? '' : ' can-swipe'}${cls ? ` ${cls}` : ''}" data-m="${idx}"><span class="mat-del-bg" aria-hidden="true"><span>Wissen</span><span>Wissen</span></span>
    <div class="mat" data-m="${idx}">
    <label class="mat-name-cell"><span class="mat-name" aria-hidden="true">${esc(desc ?? '')}</span><input class="mat-desc${cls === 'need-row' ? ' nd-desc' : ''}"${list ? ` list="${list}"` : ''}${f('description')} placeholder="Artikel of omschrijving" value="${esc(desc ?? '')}" aria-label="Artikel" autocomplete="off" ${dis}></label>
    <input class="mat-qty${cls === 'need-row' ? ' nd-qty' : ''}" type="number" inputmode="decimal" step="any" min="0"${f('qty')} placeholder="1" value="${qty ?? ''}" aria-label="Aantal" ${dis}>
    <input class="mat-unit${cls === 'need-row' ? ' nd-unit' : ''}"${f('unit')} placeholder="st" value="${esc(unit ?? '')}" aria-label="Eenheid" ${dis}>
    ${readonly ? '' : `<button type="button" class="mat-del-a11y" data-act="${del}" aria-label="Verwijderen" tabindex="-1">✕</button>`}
    ${extra}
  </div></div>`;
}

/** ⊕ Materiaal toevoegen (zelfde stijl als bij Mee te nemen) */
export const matAddHtml = (act = 'add-mat', attrs = '') => `<button type="button" class="mat-add" data-act="${act}" ${attrs}><span class="need-plus" aria-hidden="true">+</span>Materiaal toevoegen</button>`;

/**
 * Een materiaalregel naar links of rechts vegen om hem te wissen (zoals in Mail op de iPhone).
 * Verder dan een derde van de breedte (of snel genoeg) = wissen, anders terug op zijn plaats.
 * onDelete(box) krijgt het .mat-swipe-element van de geveegde regel.
 */
export function wireSwipe(el, onDelete) {
  if (el._swipe) for (const [t, f] of el._swipe) el.removeEventListener(t, f, true);
  let s = null;
  const reset = (row) => { row.style.transition = 'transform .2s'; row.style.transform = ''; };
  const down = (e) => {
    const box = e.target.closest('.mat-swipe.can-swipe');
    if (!box || e.target.closest('select') || (e.pointerType === 'mouse' && e.button !== 0)) return;
    s = { box, row: box.querySelector('.mat'), x0: e.clientX, y0: e.clientY, t0: Date.now(), dx: 0, mode: null, id: e.pointerId };
  };
  const move = (e) => {
    if (!s || e.pointerId !== s.id) return;
    const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
    if (!s.mode) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.3) {
        s.mode = 'h';
        s.box.classList.add('swiping');
        // de regel krijgt de kleur van zijn blok, zodat het rode vlak er netjes onder schuift
        for (let p = s.box.parentElement; p; p = p.parentElement) {
          const bg = getComputedStyle(p).backgroundColor;
          if (bg && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg)) { s.row.style.background = bg; break; }
        }
        try { s.box.setPointerCapture(e.pointerId); } catch { /* oude browser */ }
        if (s.box.contains(document.activeElement)) document.activeElement.blur();
      } else if (Math.abs(dy) > 10) { s = null; return; }
      else return;
    }
    e.preventDefault();
    s.dx = dx;
    s.row.style.transition = 'none';
    s.row.style.transform = `translateX(${dx}px)`;
    s.box.classList.toggle('from-left', dx > 0);
    s.box.classList.toggle('armed', Math.abs(dx) > s.box.offsetWidth / 3);
  };
  const up = (e) => {
    if (!s || e.pointerId !== s.id) return;
    const { box, row, dx, mode, t0 } = s;
    s = null;
    if (mode !== 'h') return;
    // de klik die na het vegen volgt niet laten doorgaan (geen veld openen)
    const eat = (c) => { c.preventDefault(); c.stopPropagation(); };
    el.addEventListener('click', eat, { capture: true, once: true });
    setTimeout(() => el.removeEventListener('click', eat, true), 400);
    const w = box.offsetWidth;
    const fast = Math.abs(dx) > 60 && Math.abs(dx) / Math.max(1, Date.now() - t0) > 0.6;
    if (e.type === 'pointercancel' || (Math.abs(dx) < w / 3 && !fast)) {
      box.classList.remove('armed'); reset(row);
      setTimeout(() => { row.style.background = ''; box.classList.remove('swiping'); }, 220);
      return;
    }
    row.style.transition = 'transform .18s ease-in';
    row.style.transform = `translateX(${dx > 0 ? w : -w}px)`;
    box.style.height = `${box.offsetHeight}px`;
    setTimeout(() => { box.style.transition = 'height .15s'; box.style.height = '0px'; }, 170);
    setTimeout(() => onDelete(box), 330);
  };
  // de naam die over het veld staat meeschrijven tijdens het typen
  const typed = (e) => {
    if (!e.target.classList?.contains('mat-desc')) return;
    const nm = e.target.previousElementSibling;
    if (nm?.classList.contains('mat-name')) nm.textContent = e.target.value;
  };
  el._swipe = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up], ['input', typed]];
  for (const [t, f] of el._swipe) el.addEventListener(t, f, true);
}