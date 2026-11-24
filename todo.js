// ToDo per project: puntjes die nog moeten gebeuren.
// - Iedereen kan puntjes aanmaken (geen bevestiging nodig), met uitleg en foto's.
// - In de lijst staat altijd een korte samenvatting; tikken toont de uitleg en de foto's.
// - Werknemers vinken af; de beheerder bevestigt het afvinken (of zet het terug open).
// - Projecten zonder open puntjes verdwijnen uit de lijst van de werknemer.
import { PATHS } from './store.js';
import { esc, uid, alive, projectLabel, toast, resolveId } from './ui.js';
import { fmtDate, localDate } from './time.js';

const EMPTY = () => ({ items: [] });
const when = (ts) => (ts ? fmtDate(localDate(ts), { day: 'numeric', month: 'short' }) : '');
const MAX_TITLE = 60;

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

function showPhoto(url) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop photo-view';
  wrap.innerHTML = `<img src="${url}" alt="Foto"><button class="secondary" aria-label="Sluiten">✕</button>`;
  wrap.onclick = () => wrap.remove();
  document.body.append(wrap);
}

/** Detailvenster van een puntje: uitleg, foto's, foto's toevoegen, uitleg aanpassen */
function openDetail(ctx, id, { me, name, label, asAdmin, onSaved }) {
  const t = todoItems(ctx).find((x) => x.id === id);
  if (!t) return;
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  const canEdit = !t.done || asAdmin;
  wrap.innerHTML = `<div class="modal todo-detail" role="dialog" aria-modal="true" aria-labelledby="tdTitle">
    <p class="muted small">${esc(label(t.projectId))}</p>
    <h2 id="tdTitle">${esc(titleOf(t))}</h2>
    <p class="muted small">Aangemaakt door ${esc(name(t.by))}${t.at ? ` · ${esc(when(t.at))}` : ''}${t.done ? ` · afgevinkt door ${esc(name(t.done_by))}${t.confirmed ? ' (bevestigd)' : ' (wacht op bevestiging)'}` : ''}</p>
    ${canEdit ? `<label class="q-field"><span>Korte samenvatting</span><input id="tdShort" maxlength="80" value="${esc(titleOf(t))}"></label>
      <label class="q-field"><span>Uitleg</span><textarea id="tdDetails" rows="4" placeholder="Meer uitleg (mag leeg)">${esc(detailsOf(t))}</textarea></label>`
      : `${detailsOf(t) ? `<p class="todo-text">${esc(detailsOf(t)).replace(/\n/g, '<br>')}</p>` : '<p class="muted">Geen extra uitleg.</p>'}`}
    <h3 style="margin-top:14px">Foto's (${(t.photos ?? []).length})</h3>
    <div class="photo-grid">${(t.photos ?? []).map((p) => `<button type="button" class="photo" data-photo="${esc(p.name)}" aria-label="Foto bekijken"></button>`).join('') || '<p class="muted small">Nog geen foto\'s.</p>'}</div>
    <label class="btn secondary photo-add">📷 Foto's toevoegen<input type="file" accept="image/*" multiple hidden></label>
    <div class="row modal-actions"><button class="secondary" data-a="close">Sluiten</button>${canEdit ? '<button class="primary" data-a="save">Opslaan</button>' : ''}</div>
  </div>`;
  document.body.append(wrap);
  loadPhotos(ctx, wrap);
  const close = () => { wrap.remove(); onSaved?.(); };
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) return close();
    const ph = e.target.closest('[data-photo]');
    if (ph?.dataset.url) return showPhoto(ph.dataset.url);
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') close();
    if (a === 'save') {
      const short = wrap.querySelector('#tdShort').value.trim();
      const details = wrap.querySelector('#tdDetails').value.trim();
      change(ctx, (doc) => {
        const x = doc.items.find((i) => i.id === id);
        if (x) Object.assign(x, { title: summarize(short || details) || titleOf(x), details, text: undefined, updated: Date.now() });
      });
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
      openDetail(ctx, id, { me, name, label, asAdmin, onSaved });
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
  const items = todoItems(ctx);
  const projects = alive(m.projects).filter((p) => p.active !== false);
  const label = (id) => projectLabel(m.projects.find((p) => p.id === id), m) || 'Onbekend project';
  // per project, enkel projecten met minstens één open (niet afgevinkt) puntje
  const groups = new Map();
  for (const t of items) {
    if (t.confirmed) continue;
    if (!groups.has(t.projectId)) groups.set(t.projectId, []);
    groups.get(t.projectId).push(t);
  }
  const open = [...groups.entries()].filter(([, list]) => list.some((t) => !t.done))
    .sort((a, b) => label(a[0]).localeCompare(label(b[0]), 'nl'));
  const waiting = items.filter((t) => t.done && !t.confirmed);
  const badges = (t) => `${(t.photos ?? []).length ? ` <span class="todo-badge">📷 ${(t.photos ?? []).length}</span>` : ''}${detailsOf(t) ? ' <span class="todo-badge">📝</span>' : ''}`;

  const itemHtml = (t) => `<li class="todo-item ${t.done ? 'done' : ''}" data-id="${esc(t.id)}">
      <span class="todo-main"><input type="checkbox" data-act="toggle" ${t.done ? 'checked' : ''} aria-label="Afvinken">
        <button type="button" class="todo-title" data-act="open">${esc(titleOf(t))}${badges(t)}</button></span>
      <small class="muted">${t.done ? `afgevinkt door ${esc(name(t.done_by))} · wacht op bevestiging` : `${esc(name(t.by))}${t.at ? ` · ${esc(when(t.at))}` : ''}`}</small>
      ${!t.done && (asAdmin || t.by === me) ? '<button class="link danger" data-act="del" aria-label="Verwijderen">✕</button>' : ''}
    </li>`;

  el.innerHTML = `
    ${asAdmin ? '' : '<h1 class="page-title">ToDo</h1>'}
    <section class="card">
      <h2>Nieuw puntje</h2>
      <form id="todoNew" class="todo-new">
        <select name="project" required aria-label="Project"><option value="">— kies een project —</option>
          ${projects.sort((a, b) => label(a.id).localeCompare(label(b.id), 'nl')).map((p) => `<option value="${esc(p.id)}">${esc(label(p.id))}</option>`).join('')}</select>
        <textarea name="text" required maxlength="2000" rows="2" placeholder="Wat moet er nog gebeuren? (de eerste zin wordt de samenvatting)"></textarea>
        <div class="row"><label class="btn secondary photo-add">📷 Foto's<input type="file" name="photos" accept="image/*" multiple hidden></label>
          <span class="muted small" id="todoPhotoCount"></span><button class="primary" style="margin-left:auto">Toevoegen</button></div>
      </form>
    </section>
    ${asAdmin ? `<section class="card"><h2>Afgevinkt, te bevestigen ${waiting.length ? `<span class="tab-badge">${waiting.length}</span>` : ''}</h2>
      ${waiting.length ? `<ul class="todo-list">${waiting.sort((a, b) => (b.done_at ?? 0) - (a.done_at ?? 0)).map((t) => `<li class="todo-item done" data-id="${esc(t.id)}">
        <span><b>${esc(label(t.projectId))}</b><br><button type="button" class="todo-title" data-act="open">${esc(titleOf(t))}${badges(t)}</button></span>
        <small class="muted">afgevinkt door ${esc(name(t.done_by))} · ${esc(when(t.done_at))}</small>
        <span class="row"><button class="primary" data-act="confirm">✔ Bevestigen</button><button class="secondary" data-act="reopen">Terug open</button></span></li>`).join('')}</ul>`
        : '<p class="muted">Niets te bevestigen.</p>'}</section>` : ''}
    ${open.length ? open.map(([pid, list]) => `<section class="card todo-project" data-project="${esc(pid)}">
        <h2>${esc(label(pid))}</h2>
        <ul class="todo-list">${list.sort((a, b) => Number(a.done) - Number(b.done) || (a.at ?? 0) - (b.at ?? 0)).map(itemHtml).join('')}</ul>
        <form class="todo-add" data-project="${esc(pid)}"><input name="text" maxlength="2000" placeholder="+ Puntje toevoegen" autocomplete="off" aria-label="Puntje toevoegen"><button class="secondary">+</button></form>
      </section>`).join('')
      : `<section class="card"><p class="muted">Er staan geen open puntjes.${!asAdmin && waiting.length ? ` ${waiting.length} afgevinkt puntje(s) wacht(en) op bevestiging van de beheerder.` : ''}</p></section>`}
    ${!asAdmin && open.length && waiting.length ? `<p class="muted small center">${waiting.length} afgevinkt puntje(s) wacht(en) op bevestiging van de beheerder.</p>` : ''}
    <p class="muted small center">Tik op een puntje voor meer uitleg en foto's.</p>`;

  const redraw = () => (onChange ? onChange() : renderTodo(el, { ctx, asAdmin }));
  const detailOpts = { me, name, label, asAdmin, onSaved: redraw };
  /** Nieuw puntje: korte samenvatting + (bij lange tekst) de volledige uitleg */
  const add = (projectId, text) => {
    text = String(text ?? '').trim();
    if (!projectId || !text) return null;
    const title = summarize(text);
    const id = uid();
    change(ctx, (doc) => doc.items.push({
      id, projectId, title, details: title === text ? '' : text, photos: [], by: me, at: Date.now(), done: false, confirmed: false, updated: Date.now(),
    }));
    return id;
  };
  const nf = el.querySelector('#todoNew');
  nf.elements.photos.onchange = () => { el.querySelector('#todoPhotoCount').textContent = nf.elements.photos.files.length ? `${nf.elements.photos.files.length} foto('s) gekozen` : ''; };
  nf.onsubmit = async (e) => {
    e.preventDefault();
    const files = [...nf.elements.photos.files];
    const id = add(nf.elements.project.value, nf.elements.text.value);
    if (!id) return;
    if (files.length) {
      nf.querySelector('button.primary').disabled = true;
      toast("Foto's opslaan…");
      try { await addPhotos(ctx, id, files, me); } catch (err) { toast(err.message, 'err'); }
    }
    toast('Puntje toegevoegd', 'ok');
    redraw();
  };
  el.querySelectorAll('.todo-add').forEach((f) => f.onsubmit = (e) => {
    e.preventDefault();
    if (add(f.dataset.project, f.elements.text.value)) redraw();
    el.querySelector(`.todo-add[data-project="${CSS.escape(f.dataset.project)}"] input`)?.focus();
  });
  el.onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
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
