// Planning van een werknemer in kalendervorm: dag, week (standaard) of maand.
// Route: #planning/<dag|week|maand>/<datum>
import { esc, alive, projectLabel } from './ui.js';
import { today, shiftDate, fmtDate, isDate } from './time.js';
import { weekStart, weekNumber, monthDays, shiftMonth, isoDay, holidayName } from './periods.js';

const VIEWS = [['dag', 'Dag'], ['week', 'Week'], ['maand', 'Maand']];
const WD = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

/** Kleur per project (vast, zodat hetzelfde project overal dezelfde kleur heeft) */
function hue(id) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

export function planningHtml({ master: m, planning, username, view = 'week', date }) {
  if (!VIEWS.some(([k]) => k === view)) view = 'week';
  const t = today();
  if (!isDate(date)) date = t;
  const mine = alive(planning.items).filter((p) => p.username === username);
  const on = (d) => mine.filter((p) => p.date === d);
  const proj = (it) => m.projects.find((x) => x.id === it.projectId);
  const name = (it) => projectLabel(proj(it), m) || 'Onbekend project';
  const chip = (it, cls = '') => `<span class="cal-chip ${cls}" style="--h:${hue(it.projectId)}">${esc(name(it))}</span>`;
  const link = (v, d) => `#planning/${v}/${d}`;

  let title; let prev; let next; let body;
  if (view === 'dag') {
    title = fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    prev = shiftDate(date, -1); next = shiftDate(date, 1);
    const list = on(date);
    const hol = holidayName(date);
    body = `${hol ? `<p class="cal-hol">🎉 ${esc(hol)}</p>` : ''}${list.length ? list.map((it) => {
      const p = proj(it);
      const site = m.sites.find((s) => s.id === p?.site_id);
      return `<section class="card cal-day-item" style="--h:${hue(it.projectId)}">
        <div><b>${esc(name(it))}</b>
        ${site ? `<div class="muted">📍 ${esc(site.name)}${site.address ? ` · ${esc(site.address)}` : ''}</div>` : ''}
        ${it.note ? `<div>${esc(it.note)}</div>` : ''}</div>
        ${site?.lat != null ? `<a class="btn secondary" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${site.lat},${site.lon}">Route</a>` : ''}
      </section>`;
    }).join('') : `<section class="card"><p class="muted">${isoDay(date) > 5 ? 'Weekend: niets ingepland.' : 'Niets ingepland op deze dag.'}</p></section>`}`;
  } else if (view === 'week') {
    const ws = weekStart(date);
    const days = Array.from({ length: 7 }, (_, i) => shiftDate(ws, i));
    title = `Week ${weekNumber(ws)} · ${fmtDate(ws, { day: 'numeric', month: 'short' })} – ${fmtDate(days[6], { day: 'numeric', month: 'short', year: 'numeric' })}`;
    prev = shiftDate(ws, -7); next = shiftDate(ws, 7);
    body = `<div class="cal-week">${days.map((d, i) => {
      const hol = holidayName(d);
      return `<a class="cal-wday ${d === t ? 'today' : ''} ${i >= 5 ? 'weekend' : ''} ${d < t ? 'past' : ''}" href="${link('dag', d)}">
        <span class="cal-date"><small>${WD[i]}</small><b>${Number(d.slice(8))}</b></span>
        <span class="cal-items">${hol ? `<span class="cal-hol">${esc(hol)}</span>` : ''}${on(d).map((it) => chip(it)).join('') || (hol ? '' : '<span class="muted small">—</span>')}</span>
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
      return `<a class="cal-cell ${d === t ? 'today' : ''} ${isoDay(d) > 5 ? 'weekend' : ''} ${hol ? 'holiday' : ''}" href="${link('dag', d)}" title="${esc([hol, ...list.map(name)].filter(Boolean).join(', '))}">
        <b>${Number(d.slice(8))}</b>
        ${list.slice(0, 2).map((it) => chip(it, 'mini')).join('')}${list.length > 2 ? `<small class="muted">+${list.length - 2}</small>` : ''}
        <span class="cal-dots">${list.map((it) => `<i style="--h:${hue(it.projectId)}"></i>`).join('')}</span>
      </a>`;
    }).join('')}</div>`;
    // legende: welke projecten deze maand (op gsm staan in de kalender enkel bolletjes)
    const inMonth = mine.filter((p) => p.date.startsWith(mo));
    const count = new Map();
    for (const it of inMonth) count.set(it.projectId, [...(count.get(it.projectId) ?? []), it]);
    body += count.size ? `<section class="card cal-legend"><h3>Deze maand</h3>${[...count.values()].map((list) => `<div class="cal-leg-row">
        <i style="--h:${hue(list[0].projectId)}"></i><span>${esc(name(list[0]))}</span><small class="muted">${list.length} dag${list.length === 1 ? '' : 'en'}</small></div>`).join('')}</section>`
      : '<p class="muted center">Niets ingepland deze maand.</p>';
  }

  const isNow = view === 'dag' ? date === t : view === 'week' ? weekStart(date) === weekStart(t) : date.slice(0, 7) === t.slice(0, 7);
  return `<h1 class="page-title">Mijn planning</h1>
    <nav class="subtabs" aria-label="Weergave">${VIEWS.map(([k, l]) => `<a href="${link(k, date)}" class="${k === view ? 'active' : ''}">${l}</a>`).join('')}</nav>
    <div class="cal-nav">
      <a class="btn secondary" href="${link(view, prev)}" aria-label="Vorige">‹</a>
      <h2>${esc(title)}</h2>
      <a class="btn secondary" href="${link(view, next)}" aria-label="Volgende">›</a>
    </div>
    ${isNow ? '' : `<p class="center cal-today"><a href="${link(view, t)}">Naar vandaag</a></p>`}
    ${body}`;
}
