// ToDo per project: puntjes die nog moeten gebeuren.
// - Iedereen kan puntjes aanmaken (geen bevestiging nodig), met uitleg en foto's.
// - In de lijst staat altijd een korte samenvatting; tikken toont de uitleg en de foto's.
// - Werknemers vinken af; de beheerder bevestigt het afvinken (of zet het terug open).
// - Zoals een lijst in Apple Notities: afgevinkt schuift naar onder (tot de beheerder bevestigt).
// - Projecten staan dichtgeklapt; tik = dat project open, de rest dicht.
import { PATHS } from './store.js';
import { esc, uid, alive, projectLabel, toast, resolveId, initials, info } from './ui.js';
import { fmtDate, localDate } from './time.js';
import { newProjectDialog } from './projects.js';

const EMPTY = () => ({ items: [] });
const when = (ts) => (ts ? fmtDate(localDate(ts), { day: 'numeric', month: 'short' }) : '');
const MAX_TITLE = 60;
let todoQuery = '';
let todoKind = ''; // filter: '' = alles, 'prijs' (offerte), 'tekort', 'eigen'
let todoOpen = null; // project dat openstaat (accordeon: altijd hoogstens één)
/** Soorten puntjes: gewone taak, offerte (opmeting/prijs, nog zonder project) of tekort (te bestellen, stock) */
export const TODO_KINDS = { taak: 'Taak', prijs: '📄 Offerte', tekort: '🛒 Tekort / bestellen' };
/** "Project" voor tekorten zonder project (stock in het atelier) */
export const STOCK = '__stock';
/** "Project" voor offertes waar nog geen project voor is (wordt later toegewezen) */
export const OFFER = '__offerte';
/**
 * Volgorde zoals een lijst in Apple Notities: eerst de open puntjes (oudste bovenaan),
 * daaronder de afgevinkte, het laatst afgevinkte bovenaan.
 */
export const notesOrder = (list) => [...list].sort((a, b) => Number(!!a.done) - Number(!!b.done)
  || (a.done ? (b.done_at ?? 0) - (a.done_at ?? 0) : (a.at ?? 0) - (b.at ?? 0)));

function change(ctx, fn) {
  ctx.store.change(PATHS.todos, EMPTY(), (doc) => { doc.items ??= []; fn(doc); });
}

/** Korte samenvatting: eerste zin, hoogstens ±60 tekens (afgebroken op een woord) */
export function summarize(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const first = (t.match(/^.*?[.!?](\s|$)/)?.[0] ?? t).trim().replace(/[.]$/, '');
  if (first.length <= MAX_TITLE) return first;
  const cut = first.slice(0, MAX_TITLE - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : cut.length).replace(/[,;:\s]+$/, '')}…`;
}

/** Titel en uitleg van een puntje (ook voor oude puntjes met enkel "text") */
export const titleOf = (t) => t.title || summarize(t.text);
export const detailsOf = (t) => t.details ?? (t.text && summarize(t.text) !== t.text.trim() ? t.text : '');

/** Alle puntjes (samengevoegde projecten doorverwezen) */
export function todoItems(ctx) {
  const m = ctx.master();
  return alive(ctx.store.get(PATHS.todos, EMPTY()).items).map((t) => ({ ...t, projectId: resolveId(m.projects, t.projectId) }));
}

/** Aantal puntjes dat op bevestiging van de beheerder wacht */
export const todoToConfirm = (ctx) => todoItems(ctx).filter((t) => t.done && !t.confirmed).length;

// ---------- Foto's ----------
/** Foto verkleinen (max. 1600 px, JPEG) zodat ze snel uploadt */
async function shrink(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.82));
}

/** Foto's uploaden naar de opslag en aan het puntje koppelen */
async function addPhotos(ctx, itemId, files, by) {
  const drive = ctx.store.drive;
  if (!drive?.upload) throw new Error('Foto\'s bewaren kan enkel met verbinding met de opslag.');
  const names = [];
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const blob = await shrink(f);
    const name = `${itemId}-${uid()}.jpg`;
    await drive.upload(PATHS.todoPhoto(name), blob, 'image/jpeg');
    names.push({ name, by, at: Date.now() });
  }
  if (names.length) {
    change(ctx, (doc) => {
      const t = doc.items.find((x) => x.id === itemId);
      if (t) { t.photos = [...(t.photos ?? []), ...names]; t.updated = Date.now(); }
    });
  }
  return names.length;
}

const photoCache = new Map();
async function photoUrl(ctx, name) {
  if (photoCache.has(name)) return photoCache.get(name);
  const p = ctx.store.drive?.download?.(PATHS.todoPhoto(name)).then((b) => (b ? URL.createObjectURL(b) : null)) ?? Promise.resolve(null);
  photoCache.set(name, p);
  p.catch(() => photoCache.delete(name));
  return p;
}

/** Foto's in een container laden (miniaturen; tik = groot) */
function loadPhotos(ctx, box) {
  box.querySelectorAll('[data-photo]').forEach(async (el) => {
    try {
      const url = await photoUrl(ctx, el.dataset.photo);
      if (url) { el.style.backgroundImage = `url("${url}")`; el.classList.add('loaded'); el.dataset.url = url; } else el.classList.add('missing');
    } catch { el.classList.add('missing'); }
  });
}

/** Foto groot tonen; met meerdere foto's: vegen of pijltjes om door te bladeren */
function showPhoto(urls, start = 0) {
  if (typeof urls === 'string') urls = [urls];
  let i = Math.max(0, Math.min(urls.length - 1, start));
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop photo-view';
  const many = urls.length > 1;
  wrap.innerHTML = `<img src="${urls[i]}" alt="Foto">
    <button class="secondary pv-close" data-pv="close" aria-label="Sluiten">✕</button>
    ${many ? `<button class="secondary pv-prev" data-pv="prev" aria-label="Vorige foto">‹</button><button class="secondary pv-next" data-pv="next" aria-label="Volgende foto">›</button><span class="pv-count"></span>` : ''}`;
  const img = wrap.querySelector('img');
  const show = () => { img.src = urls[i]; const n = wrap.querySelector('.pv-count'); if (n) n.textContent = `${i + 1} / ${urls.length}`; };
  const go = (d) => { i = (i + d + urls.length) % urls.length; show(); };
  const close = () => { wrap.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); if (many && e.key === 'ArrowRight') go(1); if (many && e.key === 'ArrowLeft') go(-1); };
  wrap.onclick = (e) => {
    const a = e.target.closest('[data-pv]')?.dataset.pv;
    if (a === 'prev') return go(-1);
    if (a === 'next') return go(1);
    if (a === 'close' || e.target === wrap || !many) close();
  };
  // vegen op een gsm
  let x0 = null;
  wrap.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  wrap.addEventListener('touchend', (e) => {
    if (x0 == null || !many) return;
    const dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
  });
  document.addEventListener('keydown', key);
  document.body.append(wrap);
  show();
}

/** Detailvenster van een puntje: uitleg, foto's, foto's toevoegen, uitleg aanpassen */
function openDetail(ctx, id, { me, name, label, asAdmin, onSaved, projectOptions }) {
  const t = todoItems(ctx).find((x) => x.id === id);
  if (!t) return;
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  const canEdit = !t.done || asAdmin;
  wrap.innerHTML = `<div class="modal todo-detail" role="dialog" aria-modal="true" aria-labelledby="tdTitle">
    <p class="muted small">${esc(label(t.projectId))}${t.kind && t.kind !== 'taak' ? ` · ${esc(TODO_KINDS[t.kind] ?? t.kind)}` : ''}${t.private ? ' · 🔒 enkel voor jou' : ''}</p>
    <h2 id="tdTitle">${esc(titleOf(t))}</h2>
    <p class="muted small">Aangemaakt door ${esc(name(t.by))}${t.at ? ` · ${esc(when(t.at))}` : ''}${t.done ? ` · afgevinkt door ${esc(name(t.done_by))}${t.confirmed ? ' (bevestigd)' : ' (wacht op bevestiging)'}` : ''}</p>
    ${canEdit && projectOptions ? `<label class="q-field"><span>${t.projectId === OFFER ? 'Project toewijzen' : 'Project'}</span><select id="tdProject">${projectOptions(t.projectId)}</select></label>` : ''}
    ${canEdit ? `<label class="q-field"><span>Korte samenvatting</span><input id="tdShort" maxlength="80" value="${esc(titleOf(t))}"></label>
      <label class="q-field"><span>Uitleg</span><textarea id="tdDetails" rows="4" placeholder="Meer uitleg (mag leeg)">${esc(detailsOf(t))}</textarea></label>`
      : `${detailsOf(t) ? `<p class="todo-text">${esc(detailsOf(t)).replace(/\n/g, '<br>')}</p>` : '<p class="muted">Geen extra uitleg.</p>'}`}
    <h3 style="margin-top:14px">Foto's (${(t.photos ?? []).length})</h3>
    <div class="photo-grid">${(t.photos ?? []).map((p) => `<button type="button" class="photo" data-photo="${esc(p.name)}" aria-label="Foto bekijken"></button>`).join('') || '<p class="muted small">Nog geen foto\'s.</p>'}</div>
    <label class="btn secondary photo-add">📷 Foto's toevoegen<input type="file" accept="image/*" multiple hidden></label>
    ${t.private && t.by === me ? '<p><button class="secondary" data-a="publish">▶ In uitvoering zetten (zichtbaar voor iedereen)</button></p>' : ''}
    <div class="row modal-actions"><button class="secondary" data-a="close">Sluiten</button>${canEdit ? '<button class="primary" data-a="save">Opslaan</button>' : ''}</div>
  </div>`;
  document.body.append(wrap);
  loadPhotos(ctx, wrap);
  const close = () => { wrap.remove(); onSaved?.(); };
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) return close();
    const ph = e.target.closest('[data-photo]');
    if (ph?.dataset.url) {
      const all = [...wrap.querySelectorAll('[data-photo]')].filter((x) => x.dataset.url);
      return showPhoto(all.map((x) => x.dataset.url), all.indexOf(ph));
    }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') close();
    if (a === 'publish') {
      change(ctx, (doc) => { const x = doc.items.find((i) => i.id === id); if (x) Object.assign(x, { private: false, updated: Date.now() }); });
      toast('In uitvoering: iedereen ziet het puntje nu', 'ok');
      close();
    }
    if (a === 'save') {
      const short = wrap.querySelector('#tdShort').value.trim();
      const details = wrap.querySelector('#tdDetails').value.trim();
      const pid = wrap.querySelector('#tdProject')?.value;
      change(ctx, (doc) => {
        const x = doc.items.find((i) => i.id === id);
        if (x) Object.assign(x, { title: summarize(short || details) || titleOf(x), details, text: undefined, updated: Date.now(), ...(pid ? { projectId: pid } : {}) });
      });
      if (pid && pid !== t.projectId) todoOpen = pid;
      toast('Bewaard', 'ok');
      close();
    }
  });
  wrap.querySelector('.photo-add input').onchange = async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    const lbl = wrap.querySelector('.photo-add');
    lbl.classList.add('busy');
    lbl.firstChild.textContent = `Foto's opslaan (${files.length})… `;
    try {
      const n = await addPhotos(ctx, id, files, me);
      toast(`${n} foto${n === 1 ? '' : "'s"} toegevoegd`, 'ok');
      wrap.remove();
      openDetail(ctx, id, { me, name, label, asAdmin, onSaved, projectOptions });
    } catch (err) {
      toast(err.message, 'err');
      lbl.classList.remove('busy');
      lbl.firstChild.textContent = "📷 Foto's toevoegen";
    }
  };
}

/**
 * ToDo-scherm. asAdmin: ook afvinkingen bevestigen en elk puntje verwijderen.
 */
export function renderTodo(el, { ctx, asAdmin = false, onChange = null }) {
  const m = ctx.master();
  const me = ctx.me?.()?.username ?? (asAdmin ? 'beheerder' : null);
  const name = (u) => alive(m.employees).find((e) => e.username === u)?.name ?? u ?? '';
  // eigen puntjes (nog niet in uitvoering) ziet enkel wie ze maakte
  const items = todoItems(ctx).filter((t) => !t.private || t.by === me);
  const projects = alive(m.projects).filter((p) => p.active !== false);
  const label = (id) => (id === STOCK ? '🛒 Stock / atelier (geen project)' : id === OFFER ? '📄 Offertes (nog geen project)'
    : projectLabel(m.projects.find((p) => p.id === id), m) || 'Onbekend project');
  const projectOptions = (sel) => `${sel === OFFER ? `<option value="${OFFER}" selected>📄 Nog geen project</option>` : ''}
    <option value="${STOCK}" ${sel === STOCK ? 'selected' : ''}>🛒 Stock / atelier (geen project)</option>
    ${[...projects].sort((a, b) => label(a.id).localeCompare(label(b.id), 'nl')).map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(label(p.id))}</option>`).join('')}`;
  const kindOk = (t) => !todoKind || (todoKind === 'eigen' ? !!t.private : (t.kind ?? 'taak') === todoKind);
  // per project, enkel projecten met minstens één open (niet afgevinkt) puntje
  const groups = new Map();
  for (const t of items) {
    if (t.confirmed || !kindOk(t)) continue;
    if (!groups.has(t.projectId)) groups.set(t.projectId, []);
    groups.get(t.projectId).push(t);
  }
  // afgevinkte puntjes blijven onderaan in hun project staan tot de beheerder ze bevestigt
  const open = [...groups.entries()].filter(([, list]) => list.length)
    .sort((a, b) => label(a[0]).localeCompare(label(b[0]), 'nl'));
  const waiting = items.filter((t) => t.done && !t.confirmed);
  const badges = (t) => `${t.private ? ' <span class="todo-badge">🔒 eigen</span>' : ''}${t.kind && t.kind !== 'taak' ? ` <span class="todo-badge">${esc(TODO_KINDS[t.kind] ?? t.kind)}</span>` : ''}${(t.photos ?? []).length ? ` <span class="todo-badge">📷 ${(t.photos ?? []).length}</span>` : ''}${detailsOf(t) ? ' <span class="todo-badge">📝</span>' : ''}`;

  // zoals Apple Notities: rond vinkje, tekst, achteraan klein de initialen en datum
  const itemHtml = (t) => `<li class="todo-item ${t.done ? 'done' : ''}" data-id="${esc(t.id)}">
      <input type="checkbox" class="round-check" data-act="toggle" ${t.done ? 'checked' : ''} aria-label="Afvinken">
      <button type="button" class="todo-title" data-act="open">${esc(titleOf(t))}${badges(t)}
        <small class="todo-meta" title="${esc(t.done ? `afgevinkt door ${name(t.done_by)}, wacht op bevestiging` : name(t.by))}">${t.done
          ? `✓ ${esc(initials(name(t.done_by)))} · ${esc(when(t.done_at))} · te bevestigen`
          : `${esc(initials(name(t.by)))}${t.at ? ` · ${esc(when(t.at))}` : ''}`}</small></button>
      ${!t.done && (asAdmin || t.by === me) ? '<button class="link danger todo-del" data-act="del" aria-label="Verwijderen">✕</button>' : ''}
    </li>`;
  // accordeon: gezocht met één resultaat → dat project open
  if (!open.some(([pid]) => pid === todoOpen)) todoOpen = null;

  const searchHtml = `<input type="search" id="todoSearch" class="todo-search" placeholder="🔍 Zoek een project…" value="${esc(todoQuery)}" autocomplete="off" aria-label="Zoek een project">`;
  el.innerHTML = `
    <div class="todo-head">${asAdmin ? (open.length ? searchHtml : '<span></span>') : `<h1 class="page-title">ToDo${info('Tik op een project om zijn puntjes te tonen. Tik op een puntje voor meer uitleg en foto\'s. Afgevinkte puntjes schuiven naar onder tot de beheerder ze bevestigt.')}</h1>`}
      <button type="button" class="fab-add" id="todoNewBtn" aria-label="Nieuw puntje" title="Nieuw puntje">+</button></div>
    ${!asAdmin && open.length ? searchHtml : ''}
    <nav class="subtabs todo-kinds" aria-label="Soort">${[['', 'Alles'], ['prijs', '📄 Offerte'], ['tekort', '🛒 Tekort'], ['eigen', '🔒 Eigen']].map(([k, l]) => `<a href="#" data-kind="${k}" class="${k === todoKind ? 'active' : ''}">${l}</a>`).join('')}</nav>
    ${asAdmin ? `<section class="card"><h2>Afgevinkt, te bevestigen ${waiting.length ? `<span class="tab-badge">${waiting.length}</span>` : ''}</h2>
      ${waiting.length ? `<ul class="todo-list">${waiting.sort((a, b) => (b.done_at ?? 0) - (a.done_at ?? 0)).map((t) => `<li class="todo-item done" data-id="${esc(t.id)}">
        <span><b>${esc(label(t.projectId))}</b><br><button type="button" class="todo-title" data-act="open">${esc(titleOf(t))}${badges(t)}</button></span>
        <small class="muted">afgevinkt door ${esc(name(t.done_by))} · ${esc(when(t.done_at))}</small>
        <span class="row"><button class="primary" data-act="confirm">✔ Bevestigen</button><button class="secondary" data-act="reopen">Terug open</button></span></li>`).join('')}</ul>`
        : '<p class="muted">Niets te bevestigen.</p>'}</section>` : ''}
    ${open.length ? `<div class="todo-groups">${open.map(([pid, list]) => {
      const isOpen = pid === todoOpen;
      const n = list.filter((t) => !t.done).length;
      return `<section class="todo-project ${isOpen ? 'open' : ''}" data-project="${esc(pid)}" data-label="${esc(label(pid).toLowerCase())}">
        <button type="button" class="todo-head-btn" data-act="fold" aria-expanded="${isOpen}">
          <span class="todo-pname">${esc(label(pid))}</span><span class="todo-count">${n}</span><span class="chev" aria-hidden="true">›</span></button>
        ${isOpen ? `<ul class="todo-list">${notesOrder(list).map(itemHtml).join('')}</ul>
        <form class="todo-add" data-project="${esc(pid)}" data-kind="${esc(todoKind === 'eigen' ? '' : pid === OFFER ? 'prijs' : todoKind)}"><span class="round-check ghost" aria-hidden="true"></span><input name="text" maxlength="2000" placeholder="Nieuw puntje" autocomplete="off" aria-label="Puntje toevoegen"></form>` : ''}
      </section>`;
    }).join('')}</div>`
      : `<section class="card"><p class="muted">Er staan geen open puntjes.${!asAdmin && waiting.length ? ` ${waiting.length} afgevinkt puntje(s) wacht(en) op bevestiging van de beheerder.` : ''}</p></section>`}
    ${!asAdmin && open.length && waiting.length ? `<p class="muted small center">${waiting.length} afgevinkt puntje(s) wacht(en) op bevestiging van de beheerder.</p>` : ''}
    <p class="muted small center" id="todoNoMatch" hidden>Geen project gevonden.</p>`;

  const redraw = () => (onChange ? onChange() : renderTodo(el, { ctx, asAdmin }));
  const detailOpts = { me, name, label, asAdmin, onSaved: redraw, projectOptions };
  /** Nieuw puntje: korte samenvatting + (bij lange tekst) de volledige uitleg */
  const add = (projectId, text, { kind = 'taak', priv = false } = {}) => {
    text = String(text ?? '').trim();
    if (!projectId || !text) return null;
    const title = summarize(text);
    const id = uid();
    change(ctx, (doc) => doc.items.push({
      id, projectId, title, details: title === text ? '' : text, photos: [], by: me, at: Date.now(), done: false, confirmed: false, updated: Date.now(),
      ...(kind && kind !== 'taak' ? { kind } : {}), ...(priv ? { private: true } : {}),
    }));
    return id;
  };
  // zoeken per project (onthouden tussen het hertekenen)
  const search = el.querySelector('#todoSearch');
  const filter = () => {
    const q = todoQuery.trim().toLowerCase();
    let shown = 0;
    el.querySelectorAll('.todo-project').forEach((s) => { const hit = !q || s.dataset.label.includes(q); s.hidden = !hit; shown += hit; });
    el.querySelector('#todoNoMatch').hidden = shown > 0 || !q;
    return shown;
  };
  if (search) {
    search.oninput = () => {
      todoQuery = search.value;
      // nog maar één project over: meteen openklappen
      const one = todoQuery.trim() && filter() === 1 ? el.querySelector('.todo-project:not([hidden])') : null;
      if (one && one.dataset.project !== todoOpen) {
        todoOpen = one.dataset.project;
        redraw();
        const s = el.querySelector('#todoSearch');
        s?.focus(); s?.setSelectionRange(s.value.length, s.value.length);
      }
    };
    filter();
  }

  // nieuw puntje: in een venster via de + rechtsboven
  el.querySelector('#todoNewBtn').onclick = () => {
    const sorted = projects.sort((a, b) => label(a.id).localeCompare(label(b.id), 'nl'));
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<form class="modal todo-new" role="dialog" aria-modal="true" aria-labelledby="tnTitle">
      <h2 id="tnTitle">Nieuw puntje</h2>
      <select name="kind" aria-label="Soort" data-native>${Object.entries(TODO_KINDS).map(([k, l]) => `<option value="${k}" ${k === todoKind ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <select name="project" required aria-label="Project"><option value="">— kies een project —</option>
        <option value="${OFFER}" ${todoKind === 'prijs' ? 'selected' : ''}>📄 Nog geen project (offerte)</option>
        <option value="${STOCK}">🛒 Stock / atelier (geen project)</option>
        ${sorted.map((p) => `<option value="${esc(p.id)}">${esc(label(p.id))}</option>`).join('')}
        <option value="__new">+ Nieuw project…</option></select>
      <textarea name="text" required maxlength="2000" rows="3" placeholder="Wat moet er nog gebeuren? (de eerste zin wordt de samenvatting)"></textarea>
      <div class="row"><label class="btn secondary photo-add">📷 Foto's<input type="file" name="photos" accept="image/*" multiple hidden></label>
        <span class="muted small" data-count></span></div>
      <label class="check-row"><span>🔒 Enkel voor mij ${info('Pas zichtbaar voor de anderen als je het puntje in uitvoering zet.')}</span><input type="checkbox" class="ios-switch" name="priv" ${todoKind === 'eigen' ? 'checked' : ''}></label>
      <div class="row modal-actions"><button type="button" class="secondary" data-a="close">Annuleren</button><button class="primary">Toevoegen</button></div>
    </form>`;
    document.body.append(wrap);
    const nf = wrap.querySelector('form');
    // project voorinvullen als er maar één project overblijft na het zoeken
    const visible = [...el.querySelectorAll('.todo-project:not([hidden])')];
    if (todoQuery.trim() && visible.length === 1) nf.elements.project.value = visible[0].dataset.project;
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-a="close"]')) close(); });
    // offerte: nog geen project nodig (later toewijzen in het puntje)
    nf.elements.kind.onchange = () => {
      const pv = nf.elements.project.value;
      if (nf.elements.kind.value === 'prijs' && !pv) nf.elements.project.value = OFFER;
      if (nf.elements.kind.value !== 'prijs' && pv === OFFER) nf.elements.project.value = '';
    };
    nf.elements.project.onchange = async () => {
      if (nf.elements.project.value !== '__new') return;
      nf.elements.project.value = '';
      const p = await newProjectDialog(ctx, {});
      if (!p) return;
      nf.elements.project.insertAdjacentHTML('beforeend', `<option value="${esc(p.id)}">${esc(p.name)}</option>`);
      nf.elements.project.value = p.id;
      nf.elements.project.dispatchEvent(new Event('change', { bubbles: true }));
    };
    nf.elements.photos.onchange = () => { wrap.querySelector('[data-count]').textContent = nf.elements.photos.files.length ? `${nf.elements.photos.files.length} foto('s) gekozen` : ''; };
    nf.onsubmit = async (e) => {
      e.preventDefault();
      const files = [...nf.elements.photos.files];
      const id = add(nf.elements.project.value, nf.elements.text.value, { kind: nf.elements.kind.value, priv: nf.elements.priv.checked });
      if (!id) return;
      if (files.length) {
        nf.querySelector('button.primary').disabled = true;
        toast("Foto's opslaan…");
        try { await addPhotos(ctx, id, files, me); } catch (err) { toast(err.message, 'err'); }
      }
      close();
      toast('Puntje toegevoegd', 'ok');
      todoOpen = nf.elements.project.value;
      redraw();
    };
    setTimeout(() => (nf.elements.project.value ? nf.elements.text : nf.elements.project).focus(), 50);
  };
  el.querySelectorAll('.todo-add').forEach((f) => f.onsubmit = (e) => {
    e.preventDefault();
    if (add(f.dataset.project, f.elements.text.value, { kind: f.dataset.kind || 'taak', priv: todoKind === 'eigen' })) redraw();
    el.querySelector(`.todo-add[data-project="${CSS.escape(f.dataset.project)}"] input`)?.focus();
  });
  el.onclick = (e) => {
    const kb = e.target.closest('[data-kind]');
    if (kb && kb.tagName === 'A') { e.preventDefault(); todoKind = kb.dataset.kind; return redraw(); }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'fold') {
      // accordeon: dit project open, de rest dicht (nog eens tikken = dicht)
      const pid = e.target.closest('.todo-project').dataset.project;
      todoOpen = todoOpen === pid ? null : pid;
      redraw();
      el.querySelector(`.todo-project[data-project="${CSS.escape(pid)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    const id = e.target.closest('[data-id]')?.dataset.id;
    if (!act || !id || act === 'toggle') return;
    if (act === 'open') return openDetail(ctx, id, detailOpts);
    change(ctx, (doc) => {
      const t = doc.items.find((x) => x.id === id);
      if (!t) return;
      if (act === 'del') Object.assign(t, { deleted: true });
      if (act === 'confirm') Object.assign(t, { confirmed: true, confirmed_by: me, confirmed_at: Date.now() });
      if (act === 'reopen') Object.assign(t, { done: false, done_by: null, done_at: null });
      t.updated = Date.now();
    });
    toast(act === 'confirm' ? 'Bevestigd' : act === 'reopen' ? 'Terug open gezet' : 'Verwijderd', 'ok');
    redraw();
  };
  el.onchange = (e) => {
    if (e.target.dataset.act !== 'toggle') return;
    const id = e.target.closest('[data-id]').dataset.id;
    const on = e.target.checked;
    change(ctx, (doc) => {
      const t = doc.items.find((x) => x.id === id);
      if (t) Object.assign(t, on ? { done: true, done_by: me, done_at: Date.now() } : { done: false, done_by: null, done_at: null }, { updated: Date.now() });
    });
    if (on) toast('Afgevinkt: de beheerder bevestigt nog', 'ok');
    setTimeout(redraw, on ? 600 : 0);
  };
}
