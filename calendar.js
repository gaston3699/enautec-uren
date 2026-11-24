// Planning in kalendervorm: dag, week (standaard) of maand.
//  - Werknemer: eigen planning. Route: #planning/<dag|week|maand>/<datum>
//  - Beheer (admin: true): iedereen, per project met de namen; dagen aantikken om te selecteren
//    (de navigatie loopt dan via data-v / data-d in plaats van de adresbalk).
import { esc, alive, projectLabel } from './ui.js';
import { today, shiftDate, fmtDate, isDate } from './time.js';
import { weekStart, weekNumber, monthDays, shiftMonth, isoDay, holidayName } from './periods.js';

export const VIEWS = [['dag', 'Dag'], ['week', 'Week'], ['maand', 'Maand']];
const WD = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

/** Kleur per project (vast, zodat hetzelfde project overal dezelfde kleur heeft) */
export function hue(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

/** Alle dagen die in de huidige weergave te zien zijn (voor "selecteer alle werkdagen") */
export function visibleDays(view, date) {
  if (view === 'dag') return [date];
  if (view === 'week') return Array.from({ length: 7 }, (_, i) => shiftDate(weekStart(date), i));
  return monthDays(date.slice(0, 7));
}

export function planningHtml({ master: m, planning, username, view = 'week', date, admin = false, selected = new Set() }) {
  if (!VIEWS.some(([k]) => k === view)) view = 'week';
  const t = today();
  if (!isDate(date)) date = t;
  const all = alive(planning.items).filter((p) => admin || p.username === username);
  const emps = alive(m.employees);
  const person = (u) => emps.find((e) => e.username === u)?.name ?? u;
  const proj = (id) => m.projects.find((x) => x.id === id);
  const name = (id) => projectLabel(proj(id), m) || 'Onbekend project';
  /** per dag: groepjes per project, met de mensen */
  const on = (d) => {
    const g = new Map();
    for (const it of all.filter((p) => p.date === d)) g.set(it.projectId, [...(g.get(it.projectId) ?? []), it]);
    return [...g.entries()].map(([projectId, items]) => ({ projectId, items }));
  };
  const who = (e) => (admin ? `<span class="cal-who">${esc(e.items.map((i) => person(i.username).split(' ')[0]).join(', '))}</span>` : '');
  const chip = (e, cls = '') => `<span class="cal-chip ${cls}" style="--h:${hue(e.projectId)}">${esc(name(e.projectId))}${cls ? '' : who(e)}</span>`;
  const link = (v, d) => (admin ? '#' : `#planning/${v}/${d}`);
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
      return `<section class="card cal-day-item" style="--h:${hue(e.projectId)}">
        <div><b>${esc(name(e.projectId))}</b>
        ${site ? `<div class="muted">📍 ${esc(site.name)}${site.address ? ` · ${esc(site.address)}` : ''}</div>` : ''}
        ${notes.map((n) => `<div>${esc(n)}</div>`).join('')}
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
        <span class="cal-items">${hol ? `<span class="cal-hol">${esc(hol)}</span>` : ''}${on(d).map((e) => chip(e)).join('') || (hol ? '' : '<span class="muted small">—</span>')}</span>
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
        ${list.slice(0, 2).map((e) => chip(e, 'mini')).join('')}${list.length > 2 ? `<small class="muted">+${list.length - 2}</small>` : ''}
        <span class="cal-dots">${list.map((e) => `<i style="--h:${hue(e.projectId)}"></i>`).join('')}</span>
        ${admin ? `<span class="cal-count">${list.reduce((n, e) => n + e.items.length, 0) || ''}</span>` : ''}
      </a>`;
    }).join('')}</div>`;
    // legende: welke projecten deze maand (op gsm staan in de kalender enkel bolletjes)
    const count = new Map();
    for (const it of all.filter((p) => p.date.startsWith(mo))) count.set(it.projectId, [...(count.get(it.projectId) ?? []), it]);
    const daysOf = (list) => new Set(list.map((i) => i.date)).size;
    body += count.size ? `<section class="card cal-legend"><h3>Deze maand</h3>${[...count.values()].map((list) => `<div class="cal-leg-row">
        <i style="--h:${hue(list[0].projectId)}"></i><span>${esc(name(list[0].projectId))}${admin ? `<small class="muted"> · ${esc([...new Set(list.map((i) => person(i.username).split(' ')[0]))].join(', '))}</small>` : ''}</span>
        <small class="muted">${daysOf(list)} dag${daysOf(list) === 1 ? '' : 'en'}</small></div>`).join('')}</section>`
      : '<p class="muted center">Niets ingepland deze maand.</p>';
  }

  const isNow = view === 'dag' ? date === t : view === 'week' ? weekStart(date) === weekStart(t) : date.slice(0, 7) === t.slice(0, 7);
  return `${admin ? '' : '<h1 class="page-title">Mijn planning</h1>'}
    <nav class="subtabs" aria-label="Weergave">${VIEWS.map(([k, l]) => `<a ${nav(k, date)} class="${k === view ? 'active' : ''}">${l}</a>`).join('')}</nav>
    <div class="cal-nav">
      <a class="btn secondary" ${nav(view, prev)} aria-label="Vorige">‹</a>
      <h2>${esc(title)}</h2>
      <a class="btn secondary" ${nav(view, next)} aria-label="Volgende">›</a>
    </div>
    ${isNow ? '' : `<p class="center cal-today"><a ${nav(view, t)}>Naar vandaag</a></p>`}
    ${body}`;
}
