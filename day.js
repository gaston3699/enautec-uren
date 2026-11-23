// Dagstaat: automatisch voorstel, aanpassen (tijdsblokken zoals Atree), materiaal en bevestigen.
import { buildTimeline, summarize, roundSegments, applyAnswers, diffSegments, compactSegments, KINDS } from './engine.js';
import { localTime, localToTs, dayRange, fmtHours, fmtDate, today, shiftDate, datesBetween } from './time.js';
import { PATHS } from './store.js';
import { esc, uid, alive, projectLabel, byName, toast, resolveId } from './ui.js';
import { confirmDialog } from './update.js';
import { workTypeOptions, workTypeName, newProjectDialog, defaultWorkType } from './projects.js';
import { parseTime, weekStart, expectedMinutes, monthDays, holidayName } from './periods.js';
import { trackHtml, legendHtml, counterHtml, hourRange, gapsOf, dayTotals, savedDays, CAT } from './report.js';

const TRAVEL = new Set(['verplaatsing', 'woon-werk']);
const WORKLIKE = new Set(['werk', 'atelier', 'leverancier']);
const MIN = 60000;

export const DEFAULT_RULES = {
  minStayMin: 10, unknownMinStayMin: 20, maxAccuracyM: 250, clusterRadiusM: 200,
  // Badges binnen 10 minuten na elkaar tellen als één (bv. eerst de poort, dan de deur)
  avgSpeedKmh: 50, roadFactor: 1.3, homeTravelIsWork: false, badgeDebounceSec: 600,
  // Afronden per kwartier: begin tot 5 min erna naar beneden, einde tot 8 min erna naar beneden
  roundMinutes: 15, roundStartDownMax: 5, roundEndDownMax: 8,
  // Verwachte arbeidstijd per werkdag (uren)
  dayHours: 8,
};
export const rulesFrom = (master) => ({ ...DEFAULT_RULES, ...(master.settings?.rules ?? {}) });

export const emptyReg = (username, month) => ({ username, month, days: {} });

/** Zones voor één werknemer: gedeelde zones + enkel het eigen thuisadres */
export const sitesFor = (master, username) =>
  alive(master.sites).filter((s) => s.active !== false && (s.type !== 'thuis' || s.employee_id === username));

/** Voorstel berekenen uit ruwe gegevens van de server */
export function proposal(master, planning, username, date, raw) {
  const [, end] = dayRange(date);
  const segs = buildTimeline({
    points: raw?.points ?? [],
    badges: raw?.badges ?? [],
    sites: sitesFor(master, username),
    projects: alive(master.projects).map((p) => ({ ...p, active: p.active !== false })),
    planning: alive(planning.items).filter((p) => p.username === username && p.date === date).map((p) => ({ project_id: p.projectId })),
    rules: rulesFrom(master),
    openEnd: date === today() ? Math.min(Date.now(), end) : end,
  });
  // antwoorden op "Aan het werk?" en "Bij wie ben je?" verwerken; samengevoegde projecten doorverwijzen
  return applyAnswers(segs, raw?.answers ?? []).segs
    .map((s) => (s.projectId ? { ...s, projectId: resolveId(master.projects, s.projectId) } : s));
}

/** Antwoordde de werknemer "Nee" op "Aan het werk?" */
export const declinedAnswer = (raw) => (raw?.answers ?? []).filter((a) => a.kind === 'start' && a.answer).at(-1)?.answer.answer === 'nee'
  ? (raw.answers ?? []).filter((a) => a.kind === 'start' && a.answer).at(-1) : null;

/** Huidige stand van een dag (bevestigd, aangepast of automatisch voorstel) */
export function dayState(ctx, username, date, raw) {
  const master = ctx.master();
  const month = date.slice(0, 7);
  const reg = ctx.store.get(PATHS.reg(month, username), emptyReg(username, month));
  const rec = reg.days[date];
  const auto = proposal(master, ctx.planning(), username, date, raw);
  const useSaved = rec && (rec.status === 'bevestigd' || rec.status === 'nietgewerkt' || rec.segmentsEdited);
  const segments = rec?.status === 'nietgewerkt' ? [] : useSaved ? rec.segments : auto;
  return {
    date, username, master,
    status: rec?.status === 'bevestigd' ? 'bevestigd' : rec?.status === 'nietgewerkt' ? 'nietgewerkt' : 'voorstel',
    edited: !!rec?.segmentsEdited,
    segments,
    material: rec?.material ?? [],
    note: rec?.note ?? '',
    summary: summarize(segments, rulesFrom(master)),
    hasRaw: !!raw,
    auto,
    // voor de beheerder: voorstel zoals het was bij het (eerste) bevestigen, en wie wanneer bevestigde/aanpaste
    savedProposal: rec?.proposal ?? null,
    log: rec?.log ?? [],
  };
}

function saveDay(ctx, username, date, patch) {
  const month = date.slice(0, 7);
  ctx.store.change(PATHS.reg(month, username), emptyReg(username, month), (reg) => {
    const cur = reg.days[date] ?? { segments: [], material: [] };
    reg.days[date] = { ...cur, ...patch, updated: Date.now() };
  });
}

export function validate(segments, date) {
  const [from, to] = dayRange(date);
  const s = [...segments].sort((a, b) => a.start - b.start);
  for (let i = 0; i < s.length; i++) {
    const n = `Regel ${i + 1} (${localTime(s[i].start)})`;
    if (!(s[i].end > s[i].start)) return `${n}: de eindtijd moet na de begintijd liggen.`;
    if (s[i].start < from || s[i].end > to) return `${n}: valt buiten deze dag.`;
    if (s[i].kind === 'onbekend') return `${n}: kies wat er gebeurde op de onbekende locatie.`;
    if (s[i].kind === 'werk' && !s[i].projectId) return `${n}: kies een project.`;
    if (i > 0 && s[i].start < s[i - 1].end) return `${n} overlapt met de vorige regel.`;
  }
  return null;
}

/** Controle van de dag (zoals Atree): fouten, aandachtspunten of een groen vinkje */
export function dayChecks(segs, rules) {
  const out = [];
  const s = [...segs].sort((a, b) => a.start - b.start);
  s.forEach((x, i) => {
    const t = `${localTime(x.start)}–${localTime(x.end)}`;
    if (!(x.end > x.start)) out.push(['fout', `${t}: einde ligt voor het begin.`]);
    if (i > 0 && x.start < s[i - 1].end) out.push(['fout', `${t} overlapt met ${localTime(s[i - 1].start)}–${localTime(s[i - 1].end)}.`]);
    if (x.kind === 'onbekend') out.push(['fout', `${t}: onbekende plek, kies pauze, werk of verplaatsing.`]);
    if (x.kind === 'werk' && !x.projectId) out.push(['fout', `${t}: kies een project.`]);
    if (x.openBadge) out.push(['let', `${t}: ingebadged in het atelier maar (nog) niet uitgebadged.`]);
  });
  for (const g of gapsOf(segs)) out.push(['let', `Niets ingegeven van ${localTime(g.start)} tot ${localTime(g.end)}.`]);
  const sum = summarize(segs, rules);
  const hasGapPause = s.some((x, i) => i > 0 && x.start - s[i - 1].end >= 15 * MIN);
  if (sum.workMinutes > 6 * 60 && !sum.minutes.pauze && !hasGapPause) out.push(['let', 'Meer dan 6 uur gewerkt zonder pauze.']);
  return out;
}

export function summaryHtml(st) {
  const s = st.summary;
  const pill = st.status === 'bevestigd' ? '<span class="pill ok">Bevestigd</span>'
    : st.edited ? '<span class="pill warn">Aangepast, nog niet bevestigd</span>' : '<span class="pill warn">Voorstel</span>';
  const travel = (s.minutes.verplaatsing ?? 0) + (s.minutes['woon-werk'] ?? 0);
  return `<div class="row spread">${pill}<span class="muted">${s.start ? `${localTime(s.start)} – ${localTime(s.end)}` : ''}</span></div>
    <div class="stats">
      <div class="stat"><span>Arbeidstijd</span><b>${fmtHours(s.workMinutes)}</b></div>
      <div class="stat"><span>Verplaatsing</span><b>${fmtHours(travel)}</b></div>
      <div class="stat"><span>Kilometers</span><b>${s.km}</b></div>
    </div>
    ${s.warnings.length && st.status !== 'bevestigd' && st.segments.length ? `<ul class="notice">${s.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}`;
}

/** Manuele aanpassingen van een bevestigde dag (voor de beheerder) */
export function manualChanges(st) {
  if (st.status !== 'bevestigd' || !st.savedProposal) return null;
  return diffSegments(st.savedProposal, compactSegments(st.segments));
}

function changesHtml(st, master) {
  const list = manualChanges(st);
  if (!list) return '<section class="card"><h2>Manuele aanpassingen</h2><p class="muted">Geen gegevens: deze dag werd bevestigd vóór deze functie bestond.</p></section>';
  const proj = (id) => (id ? projectLabel(master.projects.find((p) => p.id === id), master) || '?' : 'geen project');
  const span = (s) => `${localTime(s.start)}–${localTime(s.end)}`;
  const line = (c) => {
    const k = KINDS[c.kind] ?? c.kind;
    if (c.type === 'toegevoegd') return `<li class="add"><b>Toegevoegd:</b> ${esc(k)} ${span(c.to)}${c.to.projectId ? ` · ${esc(proj(c.to.projectId))}` : ''}</li>`;
    if (c.type === 'verwijderd') return `<li class="del"><b>Verwijderd:</b> ${esc(KINDS[c.from.kind] ?? c.from.kind)} ${span(c.from)}</li>`;
    const parts = [];
    if (c.what.includes('begin')) parts.push(`begin ${localTime(c.from.start)} → <b>${localTime(c.to.start)}</b>`);
    if (c.what.includes('einde')) parts.push(`einde ${localTime(c.from.end)} → <b>${localTime(c.to.end)}</b>`);
    if (c.what.includes('soort')) parts.push(`soort ${esc(KINDS[c.from.kind] ?? c.from.kind)} → <b>${esc(k)}</b>`);
    if (c.what.includes('project')) parts.push(`project ${esc(proj(c.from.projectId))} → <b>${esc(proj(c.to.projectId))}</b>`);
    if (c.what.includes('km')) parts.push(`km ${c.from.km} → <b>${c.to.km}</b>`);
    return `<li class="mod"><b>${esc(k)} ${span(c.to)}:</b> ${parts.join(', ')}</li>`;
  };
  const noAuto = st.savedProposal && !st.savedProposal.length;
  return `<section class="card changes"><h2>Manuele aanpassingen ${list.length ? `<span class="pill warn">${list.length}</span>` : '<span class="pill ok">geen</span>'}</h2>
    <p class="muted small">Vergelijking tussen het automatische voorstel (gsm en badges) en de bevestigde uren. Enkel zichtbaar voor de beheerder.</p>
    ${noAuto ? '<p class="muted">Er was geen automatisch voorstel voor deze dag: alle uren werden manueel ingegeven.</p>' : ''}
    ${list.length ? `<ul class="change-list">${list.map(line).join('')}</ul>` : noAuto ? '' : '<p class="ok-text">✓ Bevestigd zoals voorgesteld.</p>'}
    ${st.log.length ? `<details><summary>Historiek</summary><ul class="change-list">${st.log.map((l) => `<li>${esc(new Date(l.ts).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}: ${esc(l.action)} door ${esc(l.by)}${l.changes ? ` (${l.changes} aanpassing${l.changes > 1 ? 'en' : ''})` : ''}</li>`).join('')}</ul></details>` : ''}
  </section>`;
}

const ICON = { werf: '⛑️', atelier: '🏭', verpl: '🚗', pauze: '☕', onbekend: '❓' };
const SUB = {
  werk: 'Gewerkte uren bij de klant', atelier: 'Gewerkte uren in het atelier', leverancier: 'Materiaal halen',
  verplaatsing: 'Rit naar of tussen klanten', 'woon-werk': 'Van of naar huis', pauze: 'Middagpauze', onbekend: 'Wat gebeurde hier?',
};

/**
 * Teken de dag in `el`.
 * opts: { ctx, username, date, raw, asAdmin }
 */
export function renderDay(el, { ctx, username, date, raw, asAdmin = false, rawError = '', editing = false }) {
  const st = dayState(ctx, username, date, raw);
  let master = st.master;
  const rules = rulesFrom(master);
  const again =(extra = {}) => renderDay(el, { ctx, username, date, raw, asAdmin, rawError, ...extra });

  // De beheerder ziet enkel bevestigde uren (voorstellen en open dagen blijven bij de werknemer)
  if (asAdmin && st.status !== 'bevestigd' && !editing) {
    el.innerHTML = `<section class="card"><p class="muted">${st.status === 'nietgewerkt' ? 'Aangeduid als <b>niet gewerkt</b>.'
      : 'Deze dag is nog <b>niet bevestigd</b>. Voorgestelde uren zijn enkel zichtbaar voor de werknemer zelf.'}</p></section>`;
    return;
  }
  // Niet gewerkt aangevinkt
  if (st.status === 'nietgewerkt') {
    el.innerHTML = `<section class="card"><h2>Niet gewerkt</h2>
      <p class="muted">Deze dag is aangeduid als niet gewerkt. Er wordt niets geregistreerd en je krijgt voor deze dag geen vragen meer.</p>
      <button class="secondary" data-act="worked">Toch gewerkt: uren ingeven</button></section>`;
    el.querySelector('[data-act=worked]').onclick = () => {
      saveDay(ctx, username, date, { status: 'concept', segmentsEdited: false, segments: [] });
      ctx.notWorked?.(date, false);
      again();
    };
    return;
  }
  // Bevestigd = alleen lezen, tot je op "Uren aanpassen" tikt (dan pas bewaren bij opnieuw bevestigen)
  const editingConfirmed = st.status === 'bevestigd' && editing;
  const readonly = st.status === 'bevestigd' && !editing;
  const pauseMin = ctx.me?.()?.pauseMin ?? 30;
  // voorstel van de app: tijden in blauw/schuin tot je ze aanpast
  const allAuto = !st.edited && st.status !== 'bevestigd';
  const dfltType = defaultWorkType(master);
  let segs = st.segments.map((s) => ({
    ...s, candidates: s.candidates ?? [], ...(allAuto ? { auto: { start: true, end: true } } : {}),
    ...(!readonly && WORKLIKE.has(s.kind) && !s.workType ? { workType: dfltType } : {}),
  }));
  let material = st.material.map((m) => ({ ...m }));
  let projects = alive(master.projects).filter((p) => p.active !== false);
  const sitesById = new Map(master.sites.map((s) => [s.id, s]));
  /** Na het aanmaken van een project: lijsten opnieuw inlezen */
  const refreshMaster = () => {
    master = ctx.master();
    projects = alive(master.projects).filter((p) => p.active !== false);
  };
  const articles = alive(master.articles).filter((a) => a.active !== false).sort(byName);
  const planned = alive(ctx.planning().items).filter((p) => p.username === username && p.date === date);
  const dayGoal = (rules.dayHours ?? 8) * 60;

  const clean = (list) => list.map(({ auto, ...s }) => s);
  const persistSegments = () => { if (!editingConfirmed) saveDay(ctx, username, date, { segments: clean(segs), segmentsEdited: true, status: 'concept' }); };
  const persistMaterial = () => { if (!editingConfirmed) saveDay(ctx, username, date, { material, ...(st.edited ? {} : { segments: clean(segs) }) }); };

  function projectOptions(sel, candidates = []) {
    const cand = candidates.map((id) => projects.find((p) => p.id === id)).filter(Boolean);
    const plannedP = planned.map((pl) => projects.find((p) => p.id === pl.projectId)).filter((p) => p && !cand.includes(p));
    const first = [...cand, ...plannedP];
    const rest = projects.filter((p) => !first.includes(p)).sort((a, b) => projectLabel(a, master).localeCompare(projectLabel(b, master), 'nl'));
    const opt = (p) => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(projectLabel(p, master))}</option>`;
    const current = sel && !projects.some((p) => p.id === sel) ? master.projects.find((p) => p.id === sel) : null;
    return `<option value="">— geen project —</option>${current ? opt(current) : ''}
      ${first.length ? `<optgroup label="Voorgesteld">${first.map(opt).join('')}</optgroup>` : ''}
      <optgroup label="Alle projecten">${rest.map(opt).join('')}</optgroup>
      <option value="__new">+ Nieuw project…</option>`;
  }

  function segHtml(s, i) {
    const site = sitesById.get(s.siteId);
    const proj = s.projectId ? master.projects.find((p) => p.id === s.projectId) : null;
    const place = [proj ? projectLabel(proj, master) : '', site && site.name !== projectLabel(proj, master) ? `📍 ${site.name}` : '', s.source === 'badge' ? 'badge' : '']
      .filter(Boolean).join(' · ');
    const c = CAT[s.kind] ?? 'onbekend';
    const dur = Math.round((s.end - s.start) / MIN);
    const bad = !(s.end > s.start);
    const dis = readonly ? 'disabled' : '';
    const kinds = Object.entries(KINDS).filter(([k]) => k !== 'onbekend' || s.kind === 'onbekend')
      .map(([k, v]) => `<option value="${k}" ${k === s.kind ? 'selected' : ''}>${esc(v)}</option>`).join('');
    const timeInput = (f) => `<input class="t ${s.auto?.[f] ? 'auto' : ''}" data-f="${f}" value="${localTime(s[f])}" inputmode="decimal" autocomplete="off"
      aria-label="${f === 'start' ? 'Begin' : 'Einde'}" title="${s.auto?.[f] ? 'Automatisch ingevuld, pas gerust aan' : 'Typ bv. 8, 730, 7u30 of 16.45'}" ${dis}>`;
    return `<div class="blk ${bad ? 'err' : ''}" data-kind="${s.kind}" data-i="${i}">
      <div class="blk-ico c-${c}" aria-hidden="true">${ICON[c] ?? '•'}</div>
      <div class="blk-head"><b>${esc(KINDS[s.kind] ?? s.kind)}</b><span class="muted">${esc(place || SUB[s.kind] || '')}</span></div>
      <div class="blk-time">${timeInput('start')}<span aria-hidden="true">→</span>${timeInput('end')}
        <span class="dur ${bad ? 'bad' : ''}">${bad ? '??' : fmtHours(dur)}</span>
        ${TRAVEL.has(s.kind) ? `<label class="muted small km">km <input type="number" inputmode="decimal" step="0.1" min="0" data-f="km" value="${s.km ?? ''}" style="width:5em" ${dis}></label>` : ''}</div>
      ${readonly || s.kind === 'pauze' ? '' : `<div class="blk-more"><select class="${WORKLIKE.has(s.kind) ? '' : 'full'} ${s.kind === 'werk' && !s.projectId ? 'bad' : ''}" data-f="projectId" aria-label="Project">${projectOptions(s.projectId, s.candidates)}</select>
        ${WORKLIKE.has(s.kind) ? `<select data-f="workType" aria-label="Type werk">${workTypeOptions(master, s.workType)}</select>` : ''}</div>`}
      ${readonly && s.workType ? `<div class="blk-msg muted">${esc(workTypeName(master, s.workType))}</div>` : ''}
      ${readonly ? '' : `<details class="blk-more-wrap" style="grid-column:1/-1" ${s.kind === 'onbekend' ? 'open' : ''}><summary class="small muted">Soort, opmerking, verwijderen</summary>
        <div class="blk-more">
          <select data-f="kind" aria-label="Soort">${kinds}</select>
          <input type="text" data-f="note" placeholder="Opmerking" value="${esc(s.note ?? '')}">
          <button class="link danger full" style="justify-self:end" data-act="del-seg">Blok verwijderen</button>
        </div></details>`}
      ${readonly && s.note ? `<div class="blk-msg muted">${esc(s.note)}</div>` : ''}
      ${bad ? '<div class="blk-msg danger">Einde ligt voor het begin.</div>' : ''}
    </div>`;
  }

  function matHtml(m, i) {
    const dis = readonly ? 'disabled' : '';
    return `<div class="mat" data-m="${i}">
      <input class="mat-desc" list="artikels" data-mf="description" placeholder="Artikel of omschrijving" value="${esc(m.description)}" ${dis}>
      <input class="mat-qty" type="number" inputmode="decimal" step="any" min="0" data-mf="qty" value="${m.qty ?? ''}" aria-label="Aantal" ${dis}>
      <input class="mat-unit" data-mf="unit" placeholder="st" value="${esc(m.unit ?? '')}" aria-label="Eenheid" ${dis}>
      <select class="mat-proj" data-mf="projectId" aria-label="Project" ${dis}>${projectOptions(m.projectId)}</select>
      ${readonly ? '' : '<button class="link danger" data-act="del-mat" aria-label="Verwijderen">✕</button>'}
    </div>`;
  }

  /** Week- en maandtotaal: bewaarde dagen + deze dag zoals hij nu op het scherm staat */
  function periodTotals(cur) {
    const sum = (dates) => {
      const saved = savedDays(ctx, username, dates.filter((d) => d !== date));
      return dates.reduce((s, d) => s + (d === date ? cur : saved[d]?.tot.work ?? 0), 0);
    };
    const wk = datesBetween(weekStart(date), shiftDate(weekStart(date), 6));
    const mo = monthDays(date.slice(0, 7));
    return {
      week: sum(wk), weekExp: wk.reduce((s, d) => s + expectedMinutes(d, dayGoal), 0),
      month: sum(mo), monthExp: mo.reduce((s, d) => s + expectedMinutes(d, dayGoal), 0),
    };
  }

  function draw() {
    const cur = dayState(ctx, username, date, raw);
    const sorted = [...segs].map((s, i) => ({ s, i })).sort((a, b) => a.s.start - b.s.start);
    const tot = dayTotals(segs, rules);
    const pt = periodTotals(tot.work);
    const checks = dayChecks(segs, rules);
    const hol = holidayName(date);
    const pill = cur.status === 'bevestigd' ? '<span class="pill ok">Bevestigd</span>'
      : cur.edited ? '<span class="pill warn">Aangepast, nog niet bevestigd</span>' : '<span class="pill warn">Voorstel van de app</span>';
    const goal = (label, v, e) => `<div class="goal-line">${label}: <b class="${v >= e ? 'ok-text' : 'danger'}">${fmtHours(v)}</b> <span class="muted">van ${fmtHours(e)}</span></div>`;
    el.innerHTML = `
      <div class="counters dark">
        ${counterHtml('Werk', tot.werf + tot.atelier, dayGoal)}
        ${counterHtml('Verplaatsing', tot.verpl, 120)}
        ${counterHtml('Netto dag', tot.work, expectedMinutes(date, dayGoal) || dayGoal, { cls: 'red' })}
        ${counterHtml('Week', pt.week, pt.weekExp || null, { cls: 'red' })}
      </div>
      <section class="card" style="margin-top:12px">
        <div class="row spread">${pill}${hol ? `<span class="pill red">${esc(hol)}</span>` : ''}<span class="muted small">${tot.start ? `${localTime(tot.start)} – ${localTime(tot.end)}` : ''}${tot.km ? ` · ${tot.km} km` : ''}</span></div>
        <div style="margin-top:10px">${trackHtml(segs, date, hourRange([{ segs, date }], date))}</div>
        ${legendHtml()}
        ${rawError ? `<p class="muted">⚠ ${esc(rawError)}</p>` : ''}
        ${!raw && !rawError && !readonly ? '<p class="muted small">Geen automatische gegevens (geen koppeling met de server). Voeg je blokken zelf toe.</p>' : ''}
        ${declinedAnswer(raw) && !cur.edited && !readonly ? `<div class="notice">Je antwoordde <b>Nee</b> op "Aan het werk?" (${localTime(declinedAnswer(raw).ts)}). Vandaag wordt niets automatisch geregistreerd. Toch gewerkt? Voeg je blokken hieronder toe of <a href="#vraag/${declinedAnswer(raw).id}">wijzig je antwoord</a>.</div>` : ''}
      </section>
      ${asAdmin && cur.status === 'bevestigd' ? changesHtml(cur, master) : ''}
      <section class="card">
        <h2>Controle van de dag</h2>
        <div class="goal-line"><b>${fmtHours(tot.work)} netto</b> <span class="muted">(verplaatsing ${fmtHours(tot.verpl)}${tot.pauze ? ` · pauze ${fmtHours(tot.pauze)}` : ''})</span></div>
        ${goal('Week', pt.week, pt.weekExp)}${goal('Maand', pt.month, pt.monthExp)}
        <ul class="check-list">${checks.length ? checks.map(([k, t]) => `<li class="${k}">${esc(t)}</li>`).join('') : segs.length ? '<li class="ok">Geen overlappingen of gaten.</li>' : '<li class="let">Nog niets ingegeven voor deze dag.</li>'}</ul>
      </section>
      <section class="card">
        <div class="row spread"><h2>Tijdsblokken</h2>${!readonly && cur.edited ? '<button class="link" data-act="reset">↺ Automatisch voorstel</button>' : ''}</div>
        ${segs.length ? sorted.map(({ s, i }) => segHtml(s, i)).join('') : '<p class="muted">Nog geen blokken voor deze dag.</p>'}
        ${readonly ? '' : `<div class="quick-add">
          <button class="secondary" data-act="add" data-kind="verplaatsing">🚗 + Heenrit</button>
          <button class="secondary" data-act="add" data-kind="werk">⛑️ + Werk</button>
          <button class="secondary" data-act="add" data-kind="atelier">🏭 + Atelier</button>
          <button class="secondary" data-act="add" data-kind="pauze">☕ + Pauze</button>
          <button class="secondary" data-act="add" data-kind="terug">🚗 + Terugrit</button></div>
          <div class="pause-set"><span>☕ <b>Standaard pauze</b><small>Om 12:00 krijg je een melding om je pauze te starten.</small></span>
            <span class="stepper"><button class="secondary" data-act="pause-" aria-label="Pauze korter">−</button><b id="pauseVal">${fmtHours(pauseMin)}</b><button class="secondary" data-act="pause+" aria-label="Pauze langer">+</button></span></div>
          <p class="muted small">Tijden typ je kort: <b>8</b> = 8:00, <b>730</b> of <b>7u30</b> = 7:30, <b>16.45</b>. Blauw en schuin = voorgesteld, gewoon overschrijven. Bij bevestigen wordt per kwartier afgerond (begin tot 5 min, einde tot 8 min na het kwartier naar beneden).</p>`}
      </section>
      <section class="card">
        <h2>Gebruikt materiaal</h2>
        <datalist id="artikels">${articles.map((a) => `<option value="${esc(a.name)}">${esc([a.code, a.unit].filter(Boolean).join(' · '))}</option>`).join('')}</datalist>
        ${material.length ? `<div class="mat-head muted"><span>Artikel</span><span>Aantal</span><span>Eenh.</span><span>Project</span></div>${material.map(matHtml).join('')}` : '<p class="muted">Nog geen materiaal ingegeven.</p>'}
        ${readonly ? '' : '<button class="secondary" data-act="add-mat">+ Materiaal</button>'}
      </section>
      <section class="card">
        ${readonly ? `${cur.note ? `<p>Opmerking: ${esc(cur.note)}</p>` : ''}<p class="muted">Deze dag is bevestigd. Klopt er iets niet? Pas de uren aan en bevestig opnieuw.</p>
          <div class="row"><button class="secondary" data-act="edit">✎ Uren aanpassen</button>${asAdmin ? '<button class="link" data-act="reopen">Terug naar de werknemer (heropenen)</button>' : ''}</div>`
        : `<label class="muted" for="daynote">Opmerking bij deze dag</label>
          <textarea id="daynote" data-f="daynote">${esc(cur.note)}</textarea>
          <div class="err-slot"></div>
          <button class="primary big" data-act="confirm">${editingConfirmed ? 'Opnieuw bevestigen' : 'Dag bevestigen'}</button>
          ${editingConfirmed ? '<button class="secondary" style="margin-top:8px" data-act="cancel-edit">Annuleren</button>'
            : asAdmin ? '' : '<p class="center"><button class="link" data-act="notworked">Niet gewerkt op deze dag</button></p>'}`}
      </section>`;
  }

  /** Nieuw blok met voorgestelde tijden (zoals Atree: aansluitend, na werk eerst een halfuur pauze) */
  function addBlock(kindKey) {
    const sorted = [...segs].sort((a, b) => a.start - b.start);
    const last = sorted.at(-1);
    const [, dayEnd] = dayRange(date);
    const kind = kindKey === 'terug' ? 'verplaatsing' : kindKey;
    const pz = ctx.me?.()?.pauseMin || 30;
    const dflt = { verplaatsing: 30, terug: 30, werk: 240, atelier: 240, pauze: pz }[kindKey];
    let start = last ? last.end : localToTs(date, kindKey === 'verplaatsing' ? '07:30' : '08:00');
    const workLike = (k) => k === 'werk' || k === 'atelier';
    if (last && workLike(kind) && workLike(last.kind)) {
      // tweede periode: eerst de standaardpauze
      segs.push({ start, end: start + pz * MIN, kind: 'pauze', projectId: null, candidates: [], siteId: null, auto: { start: true, end: true } });
      start += pz * MIN;
    }
    const prevWork = [...sorted].reverse().find((s) => workLike(s.kind) && s.projectId);
    const end = Math.min(start + dflt * MIN, dayEnd - MIN);
    segs.push({
      start, end, kind, candidates: [], siteId: null, auto: { start: true, end: true },
      projectId: kind === 'pauze' ? null : prevWork?.projectId ?? planned[0]?.projectId ?? null,
      workType: WORKLIKE.has(kind) ? [...sorted].reverse().find((s) => s.workType)?.workType ?? dfltType : null,
    });
    persistSegments(); draw();
    const box = el.querySelector(`.blk[data-i="${segs.length - 1}"] input.t[data-f=end]`);
    box?.focus(); box?.select();
  }

  el.oninput = (e) => {
    const m = e.target.closest('.mat');
    if (m && e.target.dataset.mf === 'description') {
      const art = articles.find((a) => a.name === e.target.value);
      const item = material[Number(m.dataset.m)];
      item.description = e.target.value;
      if (art) {
        item.articleId = art.id;
        item.unit = art.unit ?? item.unit;
        m.querySelector('[data-mf=unit]').value = item.unit ?? '';
      } else item.articleId = null;
      persistMaterial();
    }
    if (e.target.classList.contains('t')) e.target.classList.remove('auto', 'bad');
  };

  el.onchange = (e) => {
    const t = e.target;
    if (t.dataset.f === 'daynote') { if (!editingConfirmed) saveDay(ctx, username, date, { note: t.value, ...(st.edited ? {} : { segments: clean(segs) }) }); return; }
    const box = t.closest('.blk');
    if (box) {
      const i = Number(box.dataset.i);
      const s = segs[i];
      const f = t.dataset.f;
      if (f === 'start' || f === 'end') {
        const hhmm = parseTime(t.value);
        if (!hhmm) { t.classList.add('bad'); toast('Tijd niet herkend. Typ bv. 8, 730, 7u30 of 16.45', 'err'); return; }
        const old = s[f];
        const ts = hhmm === '24:00' || (f === 'end' && hhmm === '00:00') ? dayRange(date)[1] - MIN : localToTs(date, hhmm);
        s[f] = ts;
        if (s.auto) delete s.auto[f];
        // aansluitend blok schuift mee (einde heenrit = begin werk). Een voorgestelde pauze schuift
        // helemaal op (blijft een halfuur), zodat ook de tweede periode later begint, zoals in Atree.
        if (f === 'end') {
          let prevEnd = old; let newEnd = ts;
          for (let guard = 0; guard < segs.length; guard++) {
            const o = segs.find((x) => x !== s && x.start === prevEnd);
            if (!o) break;
            if (o.kind === 'pauze' && o.auto?.start && o.auto?.end) {
              const d = o.end - o.start;
              prevEnd = o.end; o.start = newEnd; o.end = newEnd + d; newEnd = o.end;
              continue;
            }
            if (newEnd < o.end) o.start = newEnd;
            break;
          }
        } else {
          for (const o of segs) if (o !== s && o.end === old && ts > o.start) o.end = ts;
        }
      } else if (f === 'km') s.km = t.value === '' ? null : Number(t.value);
      else if (f === 'workType') s.workType = t.value || null;
      else if (f === 'projectId' && t.value === '__new') {
        const site = sitesById.get(s.siteId);
        newProjectDialog(ctx, { customerId: site?.customer_id ?? null, siteId: site?.id ?? null, workType: s.workType }).then((p) => {
          refreshMaster();
          if (p) {
            s.projectId = p.id;
            if (p.work_type && !s.workType && WORKLIKE.has(s.kind)) s.workType = p.work_type;
            toast(`Project "${p.name}" aangemaakt`, 'ok');
            persistSegments();
          }
          draw();
        });
        return;
      } else if (f === 'projectId') {
        s.projectId = t.value || null;
        const p = projects.find((x) => x.id === s.projectId);
        if (p?.work_type && !s.workType && WORKLIKE.has(s.kind)) s.workType = p.work_type;
        if (s.kind === 'werk' && s.projectId) {
          const sorted = [...segs].sort((a, b) => a.start - b.start);
          const k = sorted.indexOf(s);
          for (const n of [sorted[k - 1], sorted[k + 1]]) if (n && TRAVEL.has(n.kind) && !n.projectId) n.projectId = s.projectId;
        }
      } else if (f === 'kind') {
        s.kind = t.value;
        if (WORKLIKE.has(s.kind) && !s.workType) s.workType = dfltType;
      }
      else s[f] = t.value;
      persistSegments();
      if (f !== 'note' && f !== 'km') draw();
      return;
    }
    const m = t.closest('.mat');
    if (m && t.dataset.mf === 'projectId' && t.value === '__new') {
      const item = material[Number(m.dataset.m)];
      newProjectDialog(ctx, {}).then((p) => {
        refreshMaster();
        if (p) { item.projectId = p.id; persistMaterial(); }
        draw();
      });
      return;
    }
    if (m && t.dataset.mf && t.dataset.mf !== 'description') {
      const item = material[Number(m.dataset.m)];
      item[t.dataset.mf] = t.dataset.mf === 'qty' ? (t.value === '' ? null : Number(t.value)) : t.value || null;
      persistMaterial();
    }
  };

  // Enter in een tijdveld = naar het volgende tijdveld
  el.onkeydown = (e) => {
    if (e.key !== 'Enter' || !e.target.classList.contains('t')) return;
    e.preventDefault();
    const all = [...el.querySelectorAll('input.t')];
    const next = all[all.indexOf(e.target) + 1];
    e.target.blur();
    setTimeout(() => {
      const again = [...el.querySelectorAll('input.t')];
      const n = again[all.indexOf(e.target) + 1] ?? next;
      n?.focus(); n?.select?.();
    }, 0);
  };

  el.onclick = (e) => {
    const btn = e.target.closest('[data-act]');
    const act = btn?.dataset.act;
    if (!act) return;
    if (act === 'add') addBlock(btn.dataset.kind);
    else if (act === 'edit') again({ editing: true });
    else if (act === 'cancel-edit') again();
    else if (act === 'pause-' || act === 'pause+') {
      const cur = ctx.me?.()?.pauseMin ?? 30;
      const next = Math.max(0, Math.min(120, cur + (act === 'pause+' ? 5 : -5)));
      ctx.setPauseMin?.(next);
      const v = el.querySelector('#pauseVal');
      if (v) v.textContent = fmtHours(next);
    } else if (act === 'notworked') {
      confirmDialog({ title: 'Niet gewerkt?', text: `Deze dag (${fmtDate(date)}) wordt leeggemaakt en telt als niet gewerkt. Je krijgt voor deze dag geen vragen meer. Je kan dit later nog ongedaan maken.`, ok: 'Ja, niet gewerkt', cancel: 'Terug' })
        .then((ok) => {
          if (!ok) return;
          saveDay(ctx, username, date, { status: 'nietgewerkt', segments: [], segmentsEdited: true });
          ctx.notWorked?.(date, true);
          toast('Aangeduid als niet gewerkt', 'ok');
          again();
        });
    } else if (act === 'del-seg') {
      segs.splice(Number(e.target.closest('.blk').dataset.i), 1);
      persistSegments(); draw();
    } else if (act === 'reset') {
      saveDay(ctx, username, date, { segmentsEdited: false });
      segs = dayState(ctx, username, date, raw).segments.map((s) => ({ ...s, auto: { start: true, end: true } }));
      draw();
    } else if (act === 'add-mat') {
      const defProject = [...segs].reverse().find((s) => s.kind === 'werk' && s.projectId)?.projectId ?? planned[0]?.projectId ?? null;
      material.push({ id: uid(), description: '', qty: 1, unit: '', projectId: defProject, articleId: null });
      persistMaterial(); draw();
      el.querySelectorAll('.mat-desc')[material.length - 1]?.focus();
    } else if (act === 'del-mat') {
      material.splice(Number(e.target.closest('.mat').dataset.m), 1);
      persistMaterial(); draw();
    } else if (act === 'confirm') {
      // bij bevestigen altijd per kwartier afronden (ook manueel aangepaste tijden)
      segs = roundSegments(clean(segs).map(({ openBadge, ...s }) => s), rules);
      const err = validate(segs, date) || (material.some((m) => m.description && !m.projectId) ? 'Kies bij elk materiaal een project.' : null);
      const slot = el.querySelector('.err-slot');
      if (err) { slot.innerHTML = `<div class="error">${esc(err)}</div>`; return; }
      if (!segs.length && !confirm('Er staan geen blokken op deze dag. Toch bevestigen?')) return;
      material = material.filter((m) => m.description);
      const finalSegs = [...segs].sort((a, b) => a.start - b.start).map(({ candidates, ...s }) => s);
      // automatisch voorstel bewaren (enkel bij de eerste keer bevestigen) om manuele aanpassingen te tonen aan de beheerder
      const proposalSaved = st.savedProposal ?? compactSegments(st.auto ?? []);
      const changes = diffSegments(proposalSaved, compactSegments(finalSegs)).length;
      const me = ctx.me?.() ?? {};
      saveDay(ctx, username, date, {
        segments: finalSegs,
        material, segmentsEdited: true, status: 'bevestigd', confirmedAt: Date.now(),
        note: el.querySelector('#daynote')?.value ?? '',
        proposal: proposalSaved, ...(st.savedProposal ? {} : { autoAvailable: !!raw }),
        log: [...st.log, { ts: Date.now(), by: me.username ?? (asAdmin ? 'beheerder' : username), action: editingConfirmed ? 'aangepast na bevestiging' : 'bevestigd', changes }].slice(-30),
      });
      toast(`Dag bevestigd: ${fmtDate(date)}`, 'ok');
      renderDay(el, { ctx, username, date, raw, asAdmin, rawError });
    } else if (act === 'reopen') {
      if (!confirm('Deze dag heropenen? De werknemer kan dan opnieuw aanpassen.')) return;
      saveDay(ctx, username, date, { status: 'concept' });
      renderDay(el, { ctx, username, date, raw, asAdmin, rawError });
    }
  };

  draw();
}
