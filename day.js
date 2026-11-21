// Dagstaat: automatisch voorstel, aanpassen, materiaal en bevestigen.
import { buildTimeline, summarize, KINDS } from './engine.js';
import { localTime, localToTs, dayRange, fmtHours, fmtDate, today } from './time.js';
import { PATHS } from './store.js';
import { esc, uid, alive, projectLabel, byName, toast } from './ui.js';

const TRAVEL = new Set(['verplaatsing', 'woon-werk']);

export const DEFAULT_RULES = {
  minStayMin: 10, unknownMinStayMin: 20, maxAccuracyM: 250, clusterRadiusM: 200,
  avgSpeedKmh: 50, roadFactor: 1.3, homeTravelIsWork: false, badgeDebounceSec: 60,
};
export const rulesFrom = (master) => ({ ...DEFAULT_RULES, ...(master.settings?.rules ?? {}) });

export const emptyReg = (username, month) => ({ username, month, days: {} });

/** Zones voor één werknemer: gedeelde zones + enkel het eigen thuisadres */
export const sitesFor = (master, username) =>
  alive(master.sites).filter((s) => s.active !== false && (s.type !== 'thuis' || s.employee_id === username));

/** Voorstel berekenen uit ruwe gegevens van de server */
export function proposal(master, planning, username, date, raw) {
  const [, end] = dayRange(date);
  return buildTimeline({
    points: raw?.points ?? [],
    badges: raw?.badges ?? [],
    sites: sitesFor(master, username),
    projects: alive(master.projects).map((p) => ({ ...p, active: p.active !== false })),
    planning: alive(planning.items).filter((p) => p.username === username && p.date === date).map((p) => ({ project_id: p.projectId })),
    rules: rulesFrom(master),
    openEnd: date === today() ? Math.min(Date.now(), end) : end,
  });
}

/** Huidige stand van een dag (bevestigd, aangepast of automatisch voorstel) */
export function dayState(ctx, username, date, raw) {
  const master = ctx.master();
  const month = date.slice(0, 7);
  const reg = ctx.store.get(PATHS.reg(month, username), emptyReg(username, month));
  const rec = reg.days[date];
  const auto = proposal(master, ctx.planning(), username, date, raw);
  const useSaved = rec && (rec.status === 'bevestigd' || rec.segmentsEdited);
  const segments = useSaved ? rec.segments : auto;
  return {
    date, username, master,
    status: rec?.status === 'bevestigd' ? 'bevestigd' : 'voorstel',
    edited: !!rec?.segmentsEdited,
    segments,
    material: rec?.material ?? [],
    note: rec?.note ?? '',
    summary: summarize(segments, rulesFrom(master)),
    hasRaw: !!raw,
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

/**
 * Teken de dag in `el`.
 * opts: { ctx, username, date, raw, asAdmin, onChanged }
 */
export function renderDay(el, { ctx, username, date, raw, asAdmin = false, rawError = '' }) {
  const st = dayState(ctx, username, date, raw);
  const master = st.master;
  const readonly = st.status === 'bevestigd';
  let segs = st.segments.map((s) => ({ ...s, candidates: s.candidates ?? [] }));
  let material = st.material.map((m) => ({ ...m }));
  const projects = alive(master.projects).filter((p) => p.active !== false);
  const sitesById = new Map(master.sites.map((s) => [s.id, s]));
  const articles = alive(master.articles).filter((a) => a.active !== false).sort(byName);
  const planned = alive(ctx.planning().items).filter((p) => p.username === username && p.date === date);

  const persistSegments = () => saveDay(ctx, username, date, { segments: segs, segmentsEdited: true, status: 'concept' });
  const persistMaterial = () => saveDay(ctx, username, date, { material, ...(st.edited ? {} : { segments: segs }) });

  function projectOptions(sel, candidates = []) {
    const cand = candidates.map((id) => projects.find((p) => p.id === id)).filter(Boolean);
    const plannedP = planned.map((pl) => projects.find((p) => p.id === pl.projectId)).filter((p) => p && !cand.includes(p));
    const first = [...cand, ...plannedP];
    const rest = projects.filter((p) => !first.includes(p)).sort((a, b) => projectLabel(a, master).localeCompare(projectLabel(b, master), 'nl'));
    const opt = (p) => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(projectLabel(p, master))}</option>`;
    const current = sel && !projects.some((p) => p.id === sel) ? master.projects.find((p) => p.id === sel) : null;
    return `<option value="">— geen project —</option>${current ? opt(current) : ''}
      ${first.length ? `<optgroup label="Voorgesteld">${first.map(opt).join('')}</optgroup>` : ''}
      <optgroup label="Alle projecten">${rest.map(opt).join('')}</optgroup>`;
  }

  function segHtml(s, i) {
    const site = sitesById.get(s.siteId);
    const place = site ? site.name : s.kind === 'onbekend' ? 'Onbekende plek' : '';
    const dis = readonly ? 'disabled' : '';
    const kinds = Object.entries(KINDS).filter(([k]) => k !== 'onbekend' || s.kind === 'onbekend')
      .map(([k, v]) => `<option value="${k}" ${k === s.kind ? 'selected' : ''}>${esc(v)}</option>`).join('');
    return `<div class="seg" data-kind="${s.kind}" data-i="${i}">
      <div class="seg-grid">
        <input type="time" aria-label="Van" data-f="start" value="${localTime(s.start)}" ${dis}>
        <input type="time" aria-label="Tot" data-f="end" value="${localTime(s.end)}" ${dis}>
        <select data-f="kind" aria-label="Soort" ${dis}>${kinds}</select>
        ${place ? `<div class="full muted">📍 ${esc(place)}${s.source === 'badge' ? ' · badge' : ''}</div>` : ''}
        ${s.kind === 'pauze' ? '' : `<select class="full" data-f="projectId" aria-label="Project" ${dis}>${projectOptions(s.projectId, s.candidates)}</select>`}
        ${s.kind === 'werk' && !s.projectId && !readonly ? '<div class="full warn-text">Kies een project</div>' : ''}
        ${TRAVEL.has(s.kind) ? `<label class="muted km">km <input type="number" inputmode="decimal" step="0.1" min="0" data-f="km" value="${s.km ?? ''}" ${dis}></label>` : ''}
        <input type="text" class="full" data-f="note" placeholder="Opmerking" value="${esc(s.note ?? '')}" ${dis}>
        ${readonly ? '' : `<button class="link danger full-right" data-act="del-seg">Regel verwijderen</button>`}
      </div></div>`;
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

  function draw() {
    const cur = dayState(ctx, username, date, raw);
    const view = { ...cur, segments: segs, summary: summarize(segs, rulesFrom(master)) };
    el.innerHTML = `
      <section class="card">
        ${summaryHtml(view)}
        ${rawError ? `<p class="muted">⚠ ${esc(rawError)}</p>` : ''}
        ${!raw && !rawError && !readonly ? '<p class="muted">Geen automatische gegevens (geen koppeling met de server). Voeg je regels zelf toe.</p>' : ''}
      </section>
      <section class="card">
        <div class="row spread"><h2>Tijdlijn</h2>${!readonly && cur.edited ? '<button class="link" data-act="reset">↺ Automatisch voorstel</button>' : ''}</div>
        ${segs.length ? segs.map(segHtml).join('') : '<p class="muted">Nog geen activiteiten voor deze dag.</p>'}
        ${readonly ? '' : '<button class="secondary" data-act="add-seg">+ Regel toevoegen</button>'}
      </section>
      <section class="card">
        <h2>Gebruikt materiaal</h2>
        <datalist id="artikels">${articles.map((a) => `<option value="${esc(a.name)}">${esc([a.code, a.unit].filter(Boolean).join(' · '))}</option>`).join('')}</datalist>
        ${material.length ? `<div class="mat-head muted"><span>Artikel</span><span>Aantal</span><span>Eenh.</span><span>Project</span></div>${material.map(matHtml).join('')}` : '<p class="muted">Nog geen materiaal ingegeven.</p>'}
        ${readonly ? '' : '<button class="secondary" data-act="add-mat">+ Materiaal</button>'}
      </section>
      <section class="card">
        ${readonly ? `${cur.note ? `<p>Opmerking: ${esc(cur.note)}</p>` : ''}<p class="muted">Deze dag is bevestigd${asAdmin ? '' : '. Wil je nog iets wijzigen? Vraag het aan de beheerder'}.</p>
          ${asAdmin ? '<button class="secondary" data-act="reopen">Heropenen</button>' : ''}`
        : `<label class="muted" for="daynote">Opmerking bij deze dag</label>
          <textarea id="daynote" data-f="daynote">${esc(cur.note)}</textarea>
          <div class="err-slot"></div>
          <button class="primary big" data-act="confirm">Dag bevestigen</button>`}
      </section>`;
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
  };

  el.onchange = (e) => {
    const t = e.target;
    if (t.dataset.f === 'daynote') { saveDay(ctx, username, date, { note: t.value, ...(st.edited ? {} : { segments: segs }) }); return; }
    const box = t.closest('.seg');
    if (box) {
      const i = Number(box.dataset.i);
      const s = segs[i];
      const f = t.dataset.f;
      if (f === 'start' || f === 'end') { if (t.value) s[f] = localToTs(date, t.value); }
      else if (f === 'km') s.km = t.value === '' ? null : Number(t.value);
      else if (f === 'projectId') {
        s.projectId = t.value || null;
        if (s.kind === 'werk' && s.projectId) {
          for (const n of [segs[i - 1], segs[i + 1]]) if (n?.kind === 'verplaatsing' && !n.projectId) n.projectId = s.projectId;
        }
      } else if (f === 'kind') s.kind = t.value;
      else s[f] = t.value;
      persistSegments();
      if (f === 'kind' || f === 'projectId' || f === 'start' || f === 'end') draw();
      return;
    }
    const m = t.closest('.mat');
    if (m && t.dataset.mf && t.dataset.mf !== 'description') {
      const item = material[Number(m.dataset.m)];
      item[t.dataset.mf] = t.dataset.mf === 'qty' ? (t.value === '' ? null : Number(t.value)) : t.value || null;
      persistMaterial();
    }
  };

  el.onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'add-seg') {
      const last = segs.at(-1);
      const start = last ? last.end : localToTs(date, '08:00');
      segs.push({ start, end: Math.min(start + 3600000, dayRange(date)[1] - 60000), kind: 'werk', projectId: planned[0]?.projectId ?? null, candidates: [], siteId: null });
      persistSegments(); draw();
    } else if (act === 'del-seg') {
      segs.splice(Number(e.target.closest('.seg').dataset.i), 1);
      persistSegments(); draw();
    } else if (act === 'reset') {
      saveDay(ctx, username, date, { segmentsEdited: false });
      segs = dayState(ctx, username, date, raw).segments.map((s) => ({ ...s }));
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
      const err = validate(segs, date) || (material.some((m) => m.description && !m.projectId) ? 'Kies bij elk materiaal een project.' : null);
      const slot = el.querySelector('.err-slot');
      if (err) { slot.innerHTML = `<div class="error">${esc(err)}</div>`; return; }
      if (!segs.length && !confirm('Er staan geen regels op deze dag. Toch bevestigen?')) return;
      material = material.filter((m) => m.description);
      saveDay(ctx, username, date, {
        segments: [...segs].sort((a, b) => a.start - b.start).map(({ candidates, ...s }) => s),
        material, segmentsEdited: true, status: 'bevestigd', confirmedAt: Date.now(),
        note: el.querySelector('#daynote')?.value ?? '',
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
