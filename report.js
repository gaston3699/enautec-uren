// Visuele weergave van uren: dagbalk, tellers, en de overzichten per week, maand en jaar.
// Kleuren (zoals Atree Urencontrole, in Enautec-stijl): werk bij klant rood, atelier donker,
// verplaatsing grijs gearceerd, pauze licht, gaten rood gearceerd.
import { summarize } from './engine.js';
import { localTime, dayRange, fmtHours, fmtDate, today, shiftDate, datesBetween } from './time.js';
import { PATHS } from './store.js';
import { emptyReg, rulesFrom } from './day.js';
import { esc } from './ui.js';
import { isoDay, weekStart, weekNumber, monthDays, shiftMonth, holidayName, expectedMinutes } from './periods.js';

const MIN = 60000;
export const CAT = {
  werk: 'werf', leverancier: 'werf', atelier: 'atelier', verplaatsing: 'verpl', 'woon-werk': 'verpl', pauze: 'pauze', onbekend: 'onbekend',
};
export const CAT_LABEL = { werf: 'Werk bij klant', atelier: 'Atelier', verpl: 'Verplaatsing', pauze: 'Pauze', gat: 'Niets ingegeven' };

const hm = (min) => fmtHours(Math.max(0, Math.round(min)));
const signed = (min) => `${min >= 0 ? '+' : '−'}${hm(Math.abs(min))}`;

/** Minuten per categorie (enkel arbeidstijd telt mee in werf/atelier/verpl) */
export function dayTotals(segs, rules) {
  const sum = summarize(segs, rules);
  const by = { werf: 0, atelier: 0, verpl: 0, pauze: 0 };
  for (const [kind, m] of Object.entries(sum.minutes)) {
    const c = CAT[kind];
    if (c === 'verpl' && kind === 'woon-werk' && !rules.homeTravelIsWork) continue;
    if (c in by) by[c] += m;
  }
  return { ...by, work: sum.workMinutes, km: sum.km, start: sum.start, end: sum.end };
}

/** Gaten van minstens 15 min tussen twee regels (pauze telt niet als gat) */
export function gapsOf(segs) {
  const s = [...segs].sort((a, b) => a.start - b.start);
  const out = [];
  for (let i = 1; i < s.length; i++) {
    const end = Math.max(...s.slice(0, i).map((x) => x.end));
    if (s[i].start - end >= 15 * MIN) out.push({ start: end, end: s[i].start });
  }
  return out;
}

/** Uurbereik voor een balk: standaard 7–17 u, uitgerekt tot hele uren rond de blokken */
export function hourRange(segLists, date, from = 7, to = 17) {
  let lo = from; let hi = to;
  for (const { segs, date: d } of segLists) {
    const [d0] = dayRange(d ?? date);
    for (const s of segs) {
      lo = Math.min(lo, Math.floor((s.start - d0) / 3600000));
      hi = Math.max(hi, Math.ceil((s.end - d0) / 3600000));
    }
  }
  return [Math.max(0, lo), Math.min(24, hi)];
}

/** Horizontale dagbalk met blokken, gaten en (optioneel) uurlabels */
export function trackHtml(segs, date, [h0, h1], { labels = true, gaps = true, status = '', compact = false, hours = true, step: stepOpt = null } = {}) {
  const [d0] = dayRange(date);
  const span = (h1 - h0) * 3600000;
  const pos = (ts) => Math.max(0, Math.min(100, ((ts - d0 - h0 * 3600000) / span) * 100));
  const block = (s, cls, title, text) => {
    const l = pos(s.start); const w = Math.max(0.6, pos(s.end) - l);
    return `<div class="tb ${cls}" style="left:${l}%;width:${w}%" title="${esc(title)}">${text && !compact ? `<span>${esc(text)}</span>` : ''}</div>`;
  };
  const lines = [];
  for (let h = h0 + 1; h < h1; h++) lines.push(`<i style="left:${((h - h0) / (h1 - h0)) * 100}%"></i>`);
  const blocks = segs.map((s) => {
    const c = CAT[s.kind] ?? 'onbekend';
    const t = `${CAT_LABEL[c] ?? s.kind} ${localTime(s.start)}–${localTime(s.end)}${s.label ? ` · ${s.label}` : ''}`;
    return block(s, `c-${c}${s.openBadge ? ' open' : ''}`, t, (s.end - s.start) / MIN >= 50 ? s.label ?? '' : '');
  }).join('');
  const gapHtml = gaps ? gapsOf(segs).map((g) => block(g, 'c-gat', `Niets ingegeven ${localTime(g.start)}–${localTime(g.end)}`, '')).join('') : '';
  const step = stepOpt ?? (h1 - h0 > 14 ? 2 : 1);
  const hourLabels = labels && hours ? `<div class="track-hours">${Array.from({ length: Math.floor((h1 - h0) / step) + 1 }, (_, i) => h0 + i * step)
    .map((h) => `<span style="left:${((h - h0) / (h1 - h0)) * 100}%">${h}u</span>`).join('')}</div>` : '';
  return `<div class="track ${compact ? 'compact' : ''} ${status}"><div class="track-lines">${lines.join('')}</div>${blocks}${gapHtml}</div>${hourLabels}`;
}

export function legendHtml(keys = ['werf', 'atelier', 'verpl', 'pauze', 'gat']) {
  return `<div class="legend">${keys.map((k) => `<span><i class="sw c-${k}"></i>${CAT_LABEL[k]}</span>`).join('')}</div>`;
}

/** Teller met balk: label, waarde, (doel) */
export function counterHtml(label, min, goal = null, { cls = '' } = {}) {
  const pct = goal ? Math.min(100, (min / goal) * 100) : 0;
  return `<div class="counter ${cls}"><span>${esc(label)}</span><b>${hm(min)}${goal ? `<small> / ${hm(goal)}</small>` : ''}</b>
    ${goal ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div>`;
}

// ---------- Gegevens ----------
/** Bewaarde dagen (concept of bevestigd) voor een reeks datums */
export function savedDays(ctx, username, dates) {
  const out = {};
  const rules = rulesFrom(ctx.master());
  for (const date of dates) {
    const month = date.slice(0, 7);
    const reg = ctx.store.get(PATHS.reg(month, username), emptyReg(username, month));
    const d = reg.days[date];
    if (!d || !(d.segments?.length || d.status === 'bevestigd')) continue;
    const segs = (d.segments ?? []).map((s) => ({ ...s, label: labelOf(ctx, s) }));
    out[date] = { segs, status: d.status === 'bevestigd' ? 'bevestigd' : 'concept', tot: dayTotals(segs, rules), material: (d.material ?? []).length };
  }
  return out;
}

function labelOf(ctx, s) {
  const m = ctx.master();
  if (s.projectId) {
    const p = m.projects.find((x) => x.id === s.projectId);
    const c = p && m.customers.find((x) => x.id === p.customer_id);
    return c?.name ?? p?.name ?? '';
  }
  return m.sites.find((x) => x.id === s.siteId)?.name ?? '';
}

/**
 * Vanaf wanneer tellen verwachte uren en ontbrekende dagen? De startdatum van de werknemer (Beheer → Werknemers),
 * anders de eerste dag met ingegeven uren. Zo lijken de maanden vóór het gebruik van de app niet "ontbrekend".
 */
export function startDate(ctx, username) {
  const emp = (ctx.master().employees ?? []).find((e) => e.username === username && !e.deleted);
  if (emp?.start_date) return emp.start_date;
  let first = null;
  for (let mo = shiftMonth(today().slice(0, 7), -36); mo <= today().slice(0, 7); mo = shiftMonth(mo, 1)) {
    const p = PATHS.reg(mo, username);
    if (!ctx.store.has(p)) continue;
    const days = Object.entries(ctx.store.get(p, emptyReg(username, mo)).days ?? {})
      .filter(([, d]) => d.segments?.length || d.status === 'bevestigd').map(([d]) => d).sort();
    if (days.length) { first = days[0]; break; }
  }
  return first ?? today();
}

let START = '0000-00-00';
const expAt = (date, dayGoal = 480) => (date < START ? 0 : expectedMinutes(date, dayGoal));
/** Werkdag in het verleden zonder bevestigde uren? */
const isMissing = (date, day) => date < today() && expAt(date) > 0 && day?.status !== 'bevestigd';

/** Zorg dat de maandbestanden geladen zijn */
export async function ensureMonths(ctx, username, months) {
  const need = months.map((mo) => PATHS.reg(mo, username)).filter((p) => !ctx.store.has(p));
  if (need.length) { try { await ctx.store.sync(need); } catch { /* offline: wat er is */ } }
}

// ---------- Week ----------
export function weekHtml(ctx, username, anyDate) {
  START = startDate(ctx, username);
  const mon = weekStart(anyDate);
  const dates = datesBetween(mon, shiftDate(mon, 6));
  const days = savedDays(ctx, username, dates);
  const range = hourRange(Object.entries(days).map(([date, d]) => ({ date, segs: d.segs })), mon);
  const t = { work: 0, werf: 0, atelier: 0, verpl: 0, km: 0 };
  for (const d of Object.values(days)) for (const k of Object.keys(t)) t[k] += d.tot[k];
  const expected = dates.reduce((s, d) => s + expAt(d), 0);
  const missing = dates.filter((d) => isMissing(d, days[d]));
  const rows = dates.map((date) => {
    const d = days[date];
    const hol = holidayName(date);
    const we = isoDay(date) >= 6;
    const exp = expAt(date);
    const miss = isMissing(date, d);
    const work = d?.tot.work ?? 0;
    return `<a class="wrow ${we || hol ? 'off' : ''} ${date === today() ? 'today' : ''}" href="#dag/${date}">
      <div class="wday"><b>${esc(fmtDate(date, { weekday: 'short' }))}</b> ${esc(fmtDate(date, { day: 'numeric', month: 'numeric' }))}
        ${hol ? `<small>${esc(hol)}</small>` : ''}</div>
      <div class="wtrack">${d ? trackHtml(d.segs, date, range, { labels: false, status: d.status === 'bevestigd' ? '' : 'concept' })
        : `<div class="track empty ${miss ? 'missing' : ''}">${miss ? '<span>Niets ingegeven</span>' : ''}</div>`}</div>
      <div class="wtot ${exp && d ? (work >= exp ? 'ok' : 'short') : ''}">${d ? hm(work) : miss ? '<span class="pill red">!</span>' : ''}
        ${d?.status === 'concept' ? '<small>open</small>' : ''}</div></a>`;
  }).join('');
  const covered = t.work;
  return `<section class="card">
    <div class="period-head"><a class="icon" href="#overzicht/week/${shiftDate(mon, -7)}" aria-label="Vorige week">‹</a>
      <div><h2>Week ${weekNumber(mon)}</h2><div class="muted small">${esc(fmtDate(mon, { day: 'numeric', month: 'long' }))} – ${esc(fmtDate(shiftDate(mon, 6), { day: 'numeric', month: 'long', year: 'numeric' }))}</div></div>
      <a class="icon" href="#overzicht/week/${shiftDate(mon, 7)}" aria-label="Volgende week">›</a></div>
    ${mon !== weekStart(today()) ? `<p class="center"><a href="#overzicht/week/${today()}">Naar deze week</a></p>` : ''}
    <div class="counters light">
      ${counterHtml('Gewerkt', covered, expected, { cls: expected && covered >= expected ? 'ok' : 'red' })}
      ${counterHtml('Werk bij klant', t.werf)}${counterHtml('Atelier', t.atelier)}${counterHtml('Verplaatsing', t.verpl)}
      <div class="counter"><span>Kilometers</span><b>${Math.round(t.km)}</b></div>
      <div class="counter ${missing.length ? 'warn' : ''}"><span>Niet bevestigd</span><b>${missing.length}</b></div>
    </div>
  </section>
  <section class="card week">
    <div class="wrow head"><div></div><div class="wtrack">${trackHtml([], mon, range, { gaps: false, compact: true, step: range[1] - range[0] > 8 ? 2 : 1 }).replace('class="track compact ', 'class="track compact axis ')}</div><div class="wtot muted small">Totaal</div></div>
    ${rows}
    <div class="wrow foot"><div><b>Week</b></div><div class="muted small">${expected ? `verwacht ${hm(expected)} · ${covered >= expected ? `<span class="ok-text">${signed(covered - expected)}</span>` : `<span class="danger">${signed(covered - expected)}</span>`}` : ''}</div><div class="wtot"><b>${hm(covered)}</b></div></div>
    ${legendHtml()}
    <p class="muted small">Tik op een dag om ze te openen. Gestreepte rand = nog niet bevestigd.</p>
  </section>`;
}

// ---------- Maand ----------
/** Grafiek op schaal 1:1 tekenen (leesbare tekst op gsm én computer) */
const chartWidth = () => Math.round(Math.max(320, Math.min(840, (globalThis.document?.querySelector('main')?.clientWidth ?? 720) - 66)));
const SVG_DEFS = `<defs>
  <pattern id="hatchGrey" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" class="f-verpl"/><line x1="0" y1="0" x2="0" y2="6" class="hatch-line"/></pattern>
</defs>`;

function stackBars(x, w, yOf, parts) {
  let acc = 0;
  return parts.map(([cls, min]) => {
    if (!min) return '';
    const y1 = yOf(acc); acc += min; const y2 = yOf(acc);
    return `<rect x="${x}" y="${y2}" width="${w}" height="${Math.max(0, y1 - y2)}" class="${cls}"/>`;
  }).join('');
}

export function monthHtml(ctx, username, month) {
  START = startDate(ctx, username);
  const dates = monthDays(month);
  const days = savedDays(ctx, username, dates);
  const rules = rulesFrom(ctx.master());
  const dayGoal = rules.dayHours ? rules.dayHours * 60 : 480;
  let work = 0; let km = 0; let confirmed = 0;
  for (const d of Object.values(days)) { work += d.tot.work; km += d.tot.km; if (d.status === 'bevestigd') confirmed++; }
  const expected = dates.reduce((s, d) => s + expAt(d, dayGoal), 0);
  const missing = dates.filter((d) => isMissing(d, days[d])).length;
  // lopende maand: verschil tegenover wat er tot vandaag verwacht werd
  const isCur = month === today().slice(0, 7);
  const expSoFar = isCur ? dates.filter((d) => d <= today()).reduce((s, d) => s + expAt(d, dayGoal), 0) : expected;
  // grafiek
  const W = chartWidth(); const H = 230; const L = 30; const B = 34; const T = 18;
  const maxMin = Math.max(10 * 60, ...Object.values(days).map((d) => d.tot.work + 30));
  const colW = (W - L - 6) / dates.length;
  const yOf = (m) => H - B - ((H - B - T) * m) / maxMin;
  const grid = [];
  for (let h = 0; h * 60 <= maxMin; h += 2) grid.push(`<line x1="${L}" x2="${W}" y1="${yOf(h * 60)}" y2="${yOf(h * 60)}" class="grid"/><text x="${L - 6}" y="${yOf(h * 60) + 4}" class="ax" text-anchor="end">${h}u</text>`);
  const cols = dates.map((date, i) => {
    const x = L + i * colW;
    const d = days[date];
    const off = isoDay(date) >= 6 || holidayName(date);
    const bw = colW * 0.64; const bx = x + (colW - bw) / 2;
    const exp = expAt(date, dayGoal);
    const miss = isMissing(date, d);
    return `<a href="#dag/${date}"><title>${esc(fmtDate(date))}${d ? `: ${hm(d.tot.work)}` : miss ? ': niets bevestigd' : ''}</title>
      <rect x="${x}" y="${T}" width="${colW}" height="${H - B - T}" class="${date === today() ? 'col-today' : off ? 'col-off' : 'col'}"/>
      ${d ? stackBars(bx, bw, yOf, [['f-werf', d.tot.werf], ['f-atelier', d.tot.atelier], ['f-verpl-h', d.tot.verpl]]) : ''}
      ${d?.status === 'concept' ? `<rect x="${bx}" y="${yOf(d.tot.work)}" width="${bw}" height="${yOf(0) - yOf(d.tot.work)}" class="concept-outline"/>` : ''}
      ${exp ? `<line x1="${x + 1}" x2="${x + colW - 1}" y1="${yOf(exp)}" y2="${yOf(exp)}" class="goal"/>` : ''}
      ${miss ? `<circle cx="${x + colW / 2}" cy="${yOf(0) - 6}" r="3.5" class="miss"/>` : ''}
      ${d && colW > 18 ? `<text x="${x + colW / 2}" y="${yOf(d.tot.work) - 4}" class="val" text-anchor="middle">${(d.tot.work / 60).toFixed(1).replace('.', ',')}</text>` : ''}
      ${colW >= 14 || Number(date.slice(8)) % 2 === 1 ? `<text x="${x + colW / 2}" y="${H - B + 14}" class="ax ${off ? 'off' : ''}" text-anchor="middle">${Number(date.slice(8))}</text>` : ''}
      ${colW > 16 ? `<text x="${x + colW / 2}" y="${H - B + 27}" class="ax small ${off ? 'off' : ''}" text-anchor="middle">${esc(fmtDate(date, { weekday: 'narrow' }))}</text>` : ''}</a>`;
  }).join('');
  // per week
  const weeks = [];
  for (const date of dates) {
    const wk = weekNumber(date);
    let w = weeks.find((x) => x.wk === wk);
    if (!w) { w = { wk, start: date, end: date, work: 0, exp: 0 }; weeks.push(w); }
    w.end = date; w.work += days[date]?.tot.work ?? 0; w.exp += expAt(date, dayGoal);
  }
  const title = new Date(`${month}-15T12:00:00Z`).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });
  return `<section class="card">
    <div class="period-head"><a class="icon" href="#overzicht/maand/${shiftMonth(month, -1)}" aria-label="Vorige maand">‹</a>
      <div><h2 class="cap">${esc(title)}</h2></div>
      <a class="icon" href="#overzicht/maand/${shiftMonth(month, 1)}" aria-label="Volgende maand">›</a></div>
    ${month !== today().slice(0, 7) ? `<p class="center"><a href="#overzicht/maand/${today().slice(0, 7)}">Naar deze maand</a></p>` : ''}
    <div class="counters light">
      ${counterHtml('Gewerkt', work, expected, { cls: expected && work >= expected ? 'ok' : 'red' })}
      <div class="counter"><span>${isCur ? 'Verschil tot nu' : 'Verschil'}</span><b class="${work - expSoFar >= 0 ? 'ok-text' : 'danger'}">${signed(work - expSoFar)}</b></div>
      <div class="counter"><span>Bevestigde dagen</span><b>${confirmed}</b></div>
      <div class="counter ${missing ? 'warn' : ''}"><span>Niet bevestigd</span><b>${missing}</b></div>
      <div class="counter"><span>Kilometers</span><b>${Math.round(km)}</b></div>
    </div>
  </section>
  <section class="card">
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Uren per dag">${SVG_DEFS}${grid.join('')}${cols}</svg>
    ${legendHtml(['werf', 'atelier', 'verpl'])}
    <p class="muted small">Stippellijn = verwachte ${hm(dayGoal)} per werkdag. Rood bolletje = werkdag zonder bevestigde uren. Tik op een dag om ze te openen.</p>
  </section>
  <section class="card table-wrap"><table class="num"><thead><tr><th>Week</th><th>Periode</th><th>Gewerkt</th><th>Verwacht</th><th>Verschil</th></tr></thead><tbody>
    ${weeks.map((w) => `<tr class="click" data-href="#overzicht/week/${w.start}"><td>${w.wk}</td><td>${Number(w.start.slice(8))}–${Number(w.end.slice(8))}</td>
      <td>${hm(w.work)}</td><td>${hm(w.exp)}</td><td class="${w.work - w.exp >= 0 ? 'ok-text' : 'danger'}">${signed(w.work - w.exp)}</td></tr>`).join('')}
    <tr class="total"><td colspan="2">Totaal</td><td>${hm(work)}</td><td>${hm(expected)}</td><td class="${work - expected >= 0 ? 'ok-text' : 'danger'}">${signed(work - expected)}</td></tr>
  </tbody></table></section>`;
}

// ---------- Jaar ----------
export function yearHtml(ctx, username, year) {
  START = startDate(ctx, username);
  const rules = rulesFrom(ctx.master());
  const dayGoal = rules.dayHours ? rules.dayHours * 60 : 480;
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const rows = months.map((mo) => {
    const dates = monthDays(mo);
    const days = savedDays(ctx, username, dates);
    const r = { mo, work: 0, werf: 0, atelier: 0, verpl: 0, km: 0, exp: 0, missing: 0, future: mo > today().slice(0, 7) };
    for (const d of Object.values(days)) for (const k of ['work', 'werf', 'atelier', 'verpl', 'km']) r[k] += d.tot[k];
    for (const d of dates) { r.exp += expAt(d, dayGoal); if (isMissing(d, days[d])) r.missing++; }
    return r;
  });
  const tot = rows.reduce((a, r) => { for (const k of ['work', 'werf', 'atelier', 'verpl', 'km', 'exp', 'missing']) a[k] += r[k]; return a; },
    { work: 0, werf: 0, atelier: 0, verpl: 0, km: 0, exp: 0, missing: 0 });
  // verwacht tot vandaag (anders lijkt het jaar altijd achter)
  const expSoFar = rows.reduce((s, r) => s + (r.mo < today().slice(0, 7) ? r.exp
    : r.mo === today().slice(0, 7) ? monthDays(r.mo).filter((d) => d <= today()).reduce((x, d) => x + expAt(d, dayGoal), 0) : 0), 0);
  const W = chartWidth(); const H = 240; const L = 36; const B = 30; const T = 18;
  const maxMin = Math.max(...rows.map((r) => Math.max(r.exp, r.work)), 60 * 60) * 1.1;
  const colW = (W - L - 6) / 12;
  const yOf = (m) => H - B - ((H - B - T) * m) / maxMin;
  const step = maxMin > 200 * 60 ? 40 : 20;
  const grid = [];
  for (let h = 0; h * 60 <= maxMin; h += step) grid.push(`<line x1="${L}" x2="${W}" y1="${yOf(h * 60)}" y2="${yOf(h * 60)}" class="grid"/><text x="${L - 6}" y="${yOf(h * 60) + 4}" class="ax" text-anchor="end">${h}u</text>`);
  const cols = rows.map((r, i) => {
    const x = L + i * colW;
    const bw = colW * 0.34;
    const cur = r.mo === today().slice(0, 7);
    const name = new Date(`${r.mo}-15T12:00:00Z`).toLocaleDateString('nl-BE', { month: 'short' }).replace('.', '');
    return `<a href="#overzicht/maand/${r.mo}"><title>${esc(name)}: ${hm(r.work)} van ${hm(r.exp)}</title>
      <rect x="${x}" y="${T}" width="${colW}" height="${H - B - T}" class="${cur ? 'col-today' : 'col'}"/>
      <rect x="${x + colW * 0.12}" y="${yOf(r.exp)}" width="${bw}" height="${yOf(0) - yOf(r.exp)}" class="f-exp"/>
      ${stackBars(x + colW * 0.12 + bw + 2, bw, yOf, [['f-werf', r.werf], ['f-atelier', r.atelier], ['f-verpl-h', r.verpl]])}
      ${r.work ? `<text x="${x + colW * 0.12 + bw * 1.5 + 2}" y="${yOf(r.work) - 4}" class="val" text-anchor="middle">${Math.round(r.work / 60)}</text>` : ''}
      <text x="${x + colW / 2}" y="${H - B + 16}" class="ax" text-anchor="middle">${esc(name)}</text></a>`;
  }).join('');
  const y = Number(year);
  return `<section class="card">
    <div class="period-head"><a class="icon" href="#overzicht/jaar/${y - 1}" aria-label="Vorig jaar">‹</a>
      <div><h2>${y}</h2></div><a class="icon" href="#overzicht/jaar/${y + 1}" aria-label="Volgend jaar">›</a></div>
    <div class="counters light">
      ${counterHtml('Gewerkt', tot.work, expSoFar || null, { cls: tot.work >= expSoFar ? 'ok' : 'red' })}
      <div class="counter"><span>Verschil tot nu</span><b class="${tot.work - expSoFar >= 0 ? 'ok-text' : 'danger'}">${signed(tot.work - expSoFar)}</b></div>
      ${counterHtml('Verplaatsing', tot.verpl)}
      <div class="counter"><span>Kilometers</span><b>${Math.round(tot.km)}</b></div>
      <div class="counter ${tot.missing ? 'warn' : ''}"><span>Niet bevestigd</span><b>${tot.missing}</b></div>
    </div>
  </section>
  <section class="card">
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Uren per maand">${SVG_DEFS}${grid.join('')}${cols}</svg>
    <div class="legend"><span><i class="sw c-exp"></i>Verwacht</span><span><i class="sw c-werf"></i>Werk bij klant</span><span><i class="sw c-atelier"></i>Atelier</span><span><i class="sw c-verpl"></i>Verplaatsing</span></div>
  </section>
  <section class="card table-wrap"><table class="num"><thead><tr><th>Maand</th><th>Verwacht</th><th>Gewerkt</th><th>Verschil</th><th>Klant</th><th>Atelier</th><th>Verpl.</th><th>km</th><th>Open</th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="click" data-href="#overzicht/maand/${r.mo}"><td class="cap">${esc(new Date(`${r.mo}-15T12:00:00Z`).toLocaleDateString('nl-BE', { month: 'long' }))}</td>
      <td>${hm(r.exp)}</td><td><b>${r.work ? hm(r.work) : ''}</b></td>
      <td class="${r.work - r.exp >= 0 ? 'ok-text' : 'danger'}">${r.future && !r.work ? '' : signed(r.work - r.exp)}</td>
      <td>${r.werf ? hm(r.werf) : ''}</td><td>${r.atelier ? hm(r.atelier) : ''}</td><td>${r.verpl ? hm(r.verpl) : ''}</td><td>${r.km ? Math.round(r.km) : ''}</td>
      <td>${r.missing ? `<span class="pill red">${r.missing}</span>` : ''}</td></tr>`).join('')}
    <tr class="total"><td>Totaal</td><td>${hm(tot.exp)}</td><td>${hm(tot.work)}</td><td></td><td>${hm(tot.werf)}</td><td>${hm(tot.atelier)}</td><td>${hm(tot.verpl)}</td><td>${Math.round(tot.km)}</td><td>${tot.missing || ''}</td></tr>
  </tbody></table></section>`;
}
