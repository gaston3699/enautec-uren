// Planning in kalendervorm: dag, week (standaard) of maand.
//  - Werknemer: eigen planning. Route: #planning/<dag|week|maand>/<datum>
//  - Beheer (admin: true): iedereen, per project met de namen; dagen aantikken om te selecteren
//    (de navigatie loopt dan via data-v / data-d in plaats van de adresbalk).
import { esc, alive, projectLabel, personPickHtml, initials } from './ui.js';
import { today, shiftDate, fmtDate, isDate } from './time.js';
import { weekStart, weekNumber, monthDays, shiftMonth, isoDay, holidayName } from './periods.js';

export const VIEWS = [['dag', 'Dag'], ['week', 'Week'], ['maand', 'Maand']];
/** Verlof in de planning: een planningsregel met dit "project" (niet beschikbaar) */
export const LEAVE = '__verlof';
const WD = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

/** Kleur per project (vast, zodat hetzelfde project overal dezelfde kleur heeft) */
export function hue(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

/** Materiaal dat nodig is voor een project op een dag (gedeeld door iedereen op dat project) */
export const needId = (date, projectId) => `${date}|${projectId}`;
export const needOf = (planning, date, projectId) => alive(planning?.needs).find((n) => n.id === needId(date, projectId)) ?? null;
export const needLine = (l) => [l.qty != null && l.qty !== '' ? String(l.qty).replace('.', ',') : '', l.unit, l.description].filter(Boolean).join(' ');
/** Sleutel van een materiaalregel om af te vinken (zelfde op de server: worker/src/widget.js) */
export const needKey = (description) => String(description ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
/** checkable: met vakjes om af te vinken als ingeladen (de stand komt van de server) */
export function needHtml(need, { checkable = false } = {}) {
  const lines = (need?.lines ?? []).filter((l) => l.description);
  if (!lines.length) return '';
  return `<div class="cal-need"><b>🧰 Mee te nemen</b>${checkable
    ? `<div class="need-checks">${lines.map((l) => `<label class="need-check"><input type="checkbox" data-ck="${esc(need.projectId)}" data-key="${esc(needKey(l.description))}" data-t="${esc(needLine(l))}">
        <span>${esc(needLine(l))}</span><small class="muted"></small></label>`).join('')}</div>`
    : `<ul>${lines.map((l) => `<li>${esc(needLine(l))}</li>`).join('')}</ul>`}</div>`;
}

/** Alle dagen die in de huidige weergave te zien zijn (voor "selecteer alle werkdagen") */
export function visibleDays(view, date) {
  if (view === 'dag') return [date];
  if (view === 'week') return Array.from({ length: 7 }, (_, i) => shiftDate(weekStart(date), i));
  return monthDays(date.slice(0, 7));
}

/**
 * Blokjes in de kalender verslepen naar een andere dag (muis: meteen slepen; gsm: even ingedrukt houden).
 * onDrop({ from, projectId, ids, to }) wordt opgeroepen bij loslaten op een andere dag ([data-day]).
 * Geeft een functie terug die meldt of er net gesleept werd (dan de klik erna negeren).
 */
export function enableChipDrag(root, onDrop) {
  let st = null; // { chip, x0, y0, timer, active, ghost, target }
  let justDragged = 0;
  const dayAt = (x, y) => document.elementFromPoint(x, y)?.closest?.('[data-day]');
  const start = () => {
    st.active = true;
    const r = st.chip.getBoundingClientRect();
    st.ghost = st.chip.cloneNode(true);
    st.ghost.classList.add('cal-ghost');
    Object.assign(st.ghost.style, { width: `${r.width}px`, left: `${r.left}px`, top: `${r.top}px` });
    st.dx = st.x0 - r.left; st.dy = st.y0 - r.top;
    document.body.append(st.ghost);
    st.chip.classList.add('dragging');
    navigator.vibrate?.(15);
  };
  const move = (x, y) => {
    st.ghost.style.left = `${x - st.dx}px`; st.ghost.style.top = `${y - st.dy}px`;
    const d = dayAt(x, y);
    if (d !== st.target) { st.target?.classList.remove('drop-on'); st.target = d; d?.classList.add('drop-on'); }
  };
  const end = (drop) => {
    if (!st) return;
    clearTimeout(st.timer);
    if (st.active) {
      st.ghost.remove(); st.chip.classList.remove('dragging'); st.target?.classList.remove('drop-on');
      justDragged = Date.now();
      const [from, projectId] = st.chip.dataset.move.split('|');
      const to = st.target?.dataset.day;
      if (drop && to && to !== from) onDrop({ from, projectId, ids: st.chip.dataset.ids.split(',').filter(Boolean), to });
    }
    st = null;
  };
  root.addEventListener('pointerdown', (e) => {
    const chip = e.target.closest('[data-move]');
    if (!chip || e.target.closest('button') || e.button > 0) return;
    st = { chip, x0: e.clientX, y0: e.clientY, active: false, touch: e.pointerType !== 'mouse' };
    if (st.touch) st.timer = setTimeout(() => st && start(), 350);
  });
  root.addEventListener('pointermove', (e) => {
    if (!st) return;
    const far = Math.hypot(e.clientX - st.x0, e.clientY - st.y0) > 8;
    if (!st.active) {
      if (!far) return;
      if (st.touch) return end(false); // bewogen voor het ingedrukt houden: gewoon scrollen
      start();
    }
    move(e.clientX, e.clientY);
  });
  // tijdens het slepen op een gsm niet scrollen
  root.addEventListener('touchmove', (e) => { if (st?.active) e.preventDefault(); }, { passive: false });
  root.addEventListener('pointerup', () => end(true));
  root.addEventListener('pointercancel', () => end(false));
  root.addEventListener('contextmenu', (e) => { if (st?.active || e.target.closest('[data-move]')) e.preventDefault(); });
  return () => Date.now() - justDragged < 400;
}

export function planningHtml({ master: m, planning, username, of = null, view = 'week', date, admin = false, selected = new Set(), only = null }) {
  of = of || username; // wiens agenda: de eigen, die van een collega of van meerdere (komma's)
  const ofSet = new Set(String(of).split(',').filter(Boolean));
  const multi = !admin && ofSet.size > 1;
  if (!VIEWS.some(([k]) => k === view)) view = 'week';
  const t = today();
  if (!isDate(date)) date = t;
  const everyone = alive(planning.items);
  // beheer: enkel de aangevinkte personen (only); werknemer: de gekozen agenda's
  const all = everyone.filter((p) => (admin ? !only || only.has(p.username) : ofSet.has(p.username)));
  const emps = alive(m.employees);
  const person = (u) => emps.find((e) => e.username === u)?.name ?? u;
  const proj = (id) => m.projects.find((x) => x.id === id);
  const name = (id) => (id === LEAVE ? '🏖 Verlof' : projectLabel(proj(id), m) || 'Onbekend project');
  const hueOf = (id) => (id === LEAVE ? 0 : hue(id));
  /** vroegste uur van een groepje (mag leeg) */
  const timeOf = (items) => items.map((i) => i.time).filter(Boolean).sort()[0] ?? '';
  /** per dag: groepjes per project, met de mensen */
  const on = (d) => {
    const g = new Map();
    for (const it of all.filter((p) => p.date === d)) g.set(it.projectId, [...(g.get(it.projectId) ?? []), it]);
    return [...g.entries()].map(([projectId, items]) => ({ projectId, items }));
  };
  const first = (u) => (u === username && !admin ? 'jij' : person(u).split(' ')[0]);
  /** collega's die die dag ook op dat project staan */
  const mates = (d, projectId) => (projectId === LEAVE ? [] : [...new Set(everyone.filter((p) => p.date === d && p.projectId === projectId && !ofSet.has(p.username)).map((p) => p.username))]);
  const who = (e, d) => {
    if (admin || multi) return `<span class="cal-who">${esc(e.items.map((i) => first(i.username)).join(', '))}</span>`;
    const w = mates(d, e.projectId);
    return w.length ? `<span class="cal-who">met ${esc(w.map(first).join(', '))}</span>` : '';
  };
  // beheer: een blokje (project op een dag, met al zijn mensen) kan je naar een andere dag slepen
  const chip = (e, d, cls = '') => `<span class="cal-chip ${cls} ${e.projectId === LEAVE ? 'leave' : ''}" style="--h:${hueOf(e.projectId)}"${admin ? ` data-move="${esc(`${d}|${e.projectId}`)}" data-ids="${esc(e.items.map((i) => i.id).join(','))}" title="Sleep naar een andere dag om te verplaatsen"` : ''}>${timeOf(e.items) ? `<small>${esc(timeOf(e.items))}</small> ` : ''}${esc(name(e.projectId))}${!cls && needOf(planning, d, e.projectId)?.lines?.length ? ' <span title="Materiaal nodig">🧰</span>' : ''}${cls ? '' : who(e, d)}${admin && !cls && e.projectId !== LEAVE ? `<button type="button" class="cal-add" data-need="${esc(`${d}|${e.projectId}`)}" title="Materiaal nodig" aria-label="Materiaal toevoegen">+</button>` : ''}</span>`;
  const link = (v, d) => (admin ? '#' : `#planning/${v}/${d}${of !== username ? `/${encodeURIComponent(of)}` : ''}`);
  const nav = (v, d) => `href="${link(v, d)}" data-v="${v}" data-d="${d}"`;
  const sel = (d) => (selected.has(d) ? 'sel' : '');
  // werknemer: dag openen; beheer: dag (de)selecteren
  const cellAttr = (d) => (admin ? `href="#" data-day="${d}"` : nav('dag', d));

  let title; let prev; let next; let body;
  if (view === 'dag') {
    title = fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    prev = shiftDate(date, -1); next = shiftDate(date, 1);
    const list = on(date);
    const hol = holidayName(date);
    body = `${hol ? `<p class="cal-hol">🎉 ${esc(hol)}</p>` : ''}${list.length ? list.map((e) => {
      const p = proj(e.projectId);
      const site = m.sites.find((s) => s.id === p?.site_id);
      const notes = [...new Set(e.items.map((i) => i.note).filter(Boolean))];
      return `<section class="card cal-day-item" style="--h:${hueOf(e.projectId)}">
        <div><b>${timeOf(e.items) ? `${esc(timeOf(e.items))} · ` : ''}${esc(name(e.projectId))}</b>${multi ? ` <span class="cal-who">${esc(e.items.map((i) => first(i.username)).join(', '))}</span>` : ''}
        ${site ? `<div class="muted">📍 ${esc(site.name)}${site.address ? ` · ${esc(site.address)}` : ''}</div>` : ''}
        ${notes.map((n) => `<div>${esc(n)}</div>`).join('')}
        ${needHtml(needOf(planning, date, e.projectId))}
        ${admin && e.projectId !== LEAVE ? `<div><button type="button" class="link" data-need="${esc(`${date}|${e.projectId}`)}">🧰 ${needOf(planning, date, e.projectId)?.lines?.length ? 'Materiaal wijzigen' : 'Materiaal nodig toevoegen'}</button></div>` : ''}
        ${!admin && !multi && date >= t && of === username && e.projectId !== LEAVE ? `<div><a href="#dag/${date}">🧰 Mee te nemen bekijken of aanvullen</a></div>` : ''}
        ${!admin && mates(date, e.projectId).length ? `<div class="cal-mates">👷 Samen met ${esc(mates(date, e.projectId).map(first).join(', '))}</div>` : ''}
        ${admin ? `<div class="cal-people">${e.items.map((i) => `<span class="pill">${esc(person(i.username))}<button type="button" class="link danger" data-del="${esc(i.id)}" aria-label="${esc(person(i.username))} uitplannen">✕</button></span>`).join('')}</div>` : ''}</div>
        ${!admin && site?.lat != null ? `<a class="btn secondary" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${site.lat},${site.lon}">Route</a>` : ''}
      </section>`;
    }).join('') : `<section class="card"><p class="muted">${isoDay(date) > 5 ? 'Weekend: niets ingepland.' : 'Niets ingepland op deze dag.'}</p></section>`}`;
  } else if (view === 'week') {
    const ws = weekStart(date);
    const days = visibleDays('week', date);
    title = `Week ${weekNumber(ws)} · ${fmtDate(ws, { day: 'numeric', month: 'short' })} – ${fmtDate(days[6], { day: 'numeric', month: 'short', year: 'numeric' })}`;
    prev = shiftDate(ws, -7); next = shiftDate(ws, 7);
    body = `<div class="cal-week">${days.map((d, i) => {
      const hol = holidayName(d);
      return `<a class="cal-wday ${d === t ? 'today' : ''} ${i >= 5 ? 'weekend' : ''} ${d < t ? 'past' : ''} ${sel(d)}" ${cellAttr(d)}>
        <span class="cal-date"><small>${WD[i]}</small><b>${Number(d.slice(8))}</b></span>
        <span class="cal-items">${hol ? `<span class="cal-hol">${esc(hol)}</span>` : ''}${on(d).map((e) => chip(e, d)).join('') || (hol ? '' : '<span class="muted small">—</span>')}</span>
        ${admin ? `<span class="cal-open" data-v="dag" data-d="${d}" title="Dag openen" aria-label="Dag openen">›</span>` : ''}
      </a>`;
    }).join('')}</div>`;
  } else {
    const mo = date.slice(0, 7);
    title = fmtDate(`${mo}-01`, { month: 'long', year: 'numeric' });
    prev = `${shiftMonth(mo, -1)}-01`; next = `${shiftMonth(mo, 1)}-01`;
    const days = monthDays(mo);
    const lead = isoDay(days[0]) - 1;
    const cells = [...Array(lead).fill(null), ...days];
    while (cells.length % 7) cells.push(null);
    body = `<div class="cal-month">${WD.map((w) => `<span class="cal-head">${w}</span>`).join('')}${cells.map((d) => {
      if (!d) return '<span class="cal-cell empty"></span>';
      const list = on(d);
      const hol = holidayName(d);
      const tip = [hol, ...list.map((e) => `${name(e.projectId)}${admin ? `: ${e.items.map((i) => person(i.username)).join(', ')}` : ''}`)].filter(Boolean).join('\n');
      return `<a class="cal-cell ${d === t ? 'today' : ''} ${isoDay(d) > 5 ? 'weekend' : ''} ${hol ? 'holiday' : ''} ${sel(d)}" ${cellAttr(d)} title="${esc(tip)}">
        <b>${Number(d.slice(8))}</b>
        ${list.slice(0, 2).map((e) => chip(e, d, 'mini')).join('')}${list.length > 2 ? `<small class="muted">+${list.length - 2}</small>` : ''}
        <span class="cal-dots">${list.map((e) => `<i style="--h:${hueOf(e.projectId)}"></i>`).join('')}</span>
        ${admin ? `<span class="cal-count">${list.reduce((n, e) => n + e.items.length, 0) || ''}</span>` : ''}
      </a>`;
    }).join('')}</div>`;
    // legende: welke projecten deze maand (op gsm staan in de kalender enkel bolletjes)
    const count = new Map();
    for (const it of all.filter((p) => p.date.startsWith(mo))) count.set(it.projectId, [...(count.get(it.projectId) ?? []), it]);
    const daysOf = (list) => new Set(list.map((i) => i.date)).size;
    body += count.size ? `<section class="card cal-legend"><h3>Deze maand</h3>${[...count.values()].map((list) => `<div class="cal-leg-row">
        <i style="--h:${hueOf(list[0].projectId)}"></i><span>${esc(name(list[0].projectId))}${(() => {
          const people = admin ? [...new Set(list.map((i) => i.username))] : [...new Set(list.flatMap((i) => mates(i.date, i.projectId)))];
          return people.length ? `<small class="muted"> · ${admin ? '' : 'met '}${esc(people.map(first).join(', '))}</small>` : '';
        })()}</span>
        <small class="muted">${daysOf(list)} dag${daysOf(list) === 1 ? '' : 'en'}</small></div>`).join('')}</section>`
      : '<p class="muted center">Niets ingepland deze maand.</p>';
  }

  const isNow = view === 'dag' ? date === t : view === 'week' ? weekStart(date) === weekStart(t) : date.slice(0, 7) === t.slice(0, 7);
  const colleagues = emps.filter((e) => e.active !== false && e.username !== username).sort((a, b) => String(a.name).localeCompare(String(b.name), 'nl'));
  // agenda's aanvinken: de eigen en/of die van collega's (samen in één kalender)
  const picker = admin ? '' : `<div class="cal-of">
      <h1 class="page-title">${of === username ? 'Mijn planning' : ofSet.size === 1 ? `Planning van ${esc(person(of))}` : 'Planning'}</h1>
      ${colleagues.length ? personPickHtml({
        id: 'calOf', label: "Agenda's", empty: 'Mezelf', selected: [...ofSet],
        people: [{ value: username, label: 'Mezelf', short: initials(person(username)) || 'Ik' }, ...colleagues.map((e) => ({ value: e.username, label: e.name }))],
      }) : ''}
    </div>`;
  return `${picker}
    <nav class="subtabs" aria-label="Weergave">${VIEWS.map(([k, l]) => `<a ${nav(k, date)} class="${k === view ? 'active' : ''}">${l}</a>`).join('')}</nav>
    <div class="cal-nav">
      <a class="btn secondary" ${nav(view, prev)} aria-label="Vorige">‹</a>
      <h2>${esc(title)}</h2>
      <a class="btn secondary" ${nav(view, next)} aria-label="Volgende">›</a>
    </div>
    ${isNow ? '' : `<p class="center cal-today"><a ${nav(view, t)}>Naar vandaag</a></p>`}
    ${body}`;
}
