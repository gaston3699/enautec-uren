// Bouwt automatisch een dagstaat uit locatiepunten (OwnTracks) en badges (Loxone).
// Puur rekenwerk zonder database, zodat het eenvoudig te testen is.
import { distance, pathLength, matchSite } from './geo.js';

export const KINDS = {
  werk: 'Werk bij klant',
  atelier: 'Atelier',
  leverancier: 'Leverancier',
  verplaatsing: 'Verplaatsing',
  'woon-werk': 'Woon-werkverkeer',
  pauze: 'Pauze',
  onbekend: 'Onbekende locatie',
};

/** Standaardregels (de beheerder kan ze aanpassen in Instellingen) */
export const DEFAULT_RULES = {
  minStayMin: 5, unknownMinStayMin: 20, maxAccuracyM: 250, clusterRadiusM: 200,
  // Badges binnen 10 minuten na elkaar tellen als één (bv. eerst de poort, dan de deur)
  avgSpeedKmh: 50, roadFactor: 1.3, homeTravelIsWork: false, badgeDebounceSec: 600,
  // Afronden per kwartier: begin tot 5 min erna naar beneden, einde tot 8 min erna naar beneden
  roundMinutes: 15, roundStartDownMax: 5, roundEndDownMax: 8,
  // Verwachte arbeidstijd per werkdag (uren)
  dayHours: 8,
};

/** Soorten die altijd als arbeidstijd tellen */
const ALWAYS_WORK = new Set(['werk', 'atelier', 'leverancier', 'verplaatsing']);

export const isWorkKind = (kind, rules) =>
  ALWAYS_WORK.has(kind) || (kind === 'woon-werk' && rules.homeTravelIsWork);

const MIN = 60000;

function travelEstimateMs(a, b, rules) {
  const km = (distance(a, b) * rules.roadFactor) / 1000;
  return (km / rules.avgSpeedKmh) * 3600000;
}

/** Groepeer opeenvolgende punten die op dezelfde plek liggen */
function clusterPoints(pts, rules) {
  const clusters = [];
  for (const p of pts) {
    const c = clusters.at(-1);
    const siteId = p.site?.id ?? null;
    const same = c && c.siteId === siteId &&
      (siteId !== null || distance(c.anchor, p) <= rules.clusterRadiusM);
    if (same) c.pts.push(p);
    else clusters.push({ siteId, site: p.site, anchor: p, pts: [p] });
  }
  // Een verblijf loopt door tot vlak voor het eerstvolgende punt elders,
  // min de geschatte reistijd daarheen (OwnTracks stuurt weinig punten als je stilstaat).
  clusters.forEach((c, i) => {
    c.start = c.pts[0].ts;
    c.end = c.pts.at(-1).ts;
    const next = clusters[i + 1];
    if (next) {
      const est = travelEstimateMs(c.pts.at(-1), next.pts[0], rules);
      c.end = Math.max(c.end, next.pts[0].ts - est);
    }
  });
  return clusters;
}

/** Filter echte verblijven en voeg opeenvolgende verblijven op dezelfde plek samen */
function findStays(clusters, rules) {
  const minKnown = rules.minStayMin * MIN;
  const minUnknown = Math.max(rules.minStayMin, rules.unknownMinStayMin ?? 20) * MIN;
  const stays = [];
  for (const c of clusters) {
    if (c.end - c.start < (c.siteId === null ? minUnknown : minKnown)) continue;
    const prev = stays.at(-1);
    const samePlace = prev && prev.siteId === c.siteId &&
      (c.siteId !== null || distance(prev.anchor, c.anchor) <= rules.clusterRadiusM);
    if (samePlace) {
      prev.end = c.end;
      prev.pts.push(...c.pts);
    } else {
      stays.push({ ...c, pts: [...c.pts] });
    }
  }
  return stays;
}

function staySegment(s) {
  const type = s.site?.type;
  const kind = type === 'klant' ? 'werk' : type === 'atelier' ? 'atelier' : type === 'leverancier' ? 'leverancier' : 'onbekend';
  const center = s.site ?? s.anchor;
  return {
    start: s.start, end: s.end, kind, siteId: s.siteId, source: 'gps',
    lat: center.lat, lon: center.lon,
  };
}

/** Zet verblijven om in segmenten (verblijf + verplaatsing ertussen) */
function staysToSegments(stays, pts, rules, home = null) {
  const segs = [];
  // De dag begint onderweg (de gsm stuurde thuis niets meer sinds gisteren): toch een rit tot het
  // eerste verblijf, vanaf thuis (vertrek geschat uit de afstand tot het eerste punt).
  const first = stays[0];
  const before = first && first.site?.type !== 'thuis' ? pts.filter((p) => p.ts < first.pts[0].ts) : [];
  if (before.length) {
    const p0 = before[0];
    const fromHome = !!home && p0.site?.id !== home.id;
    const start = fromHome ? p0.ts - travelEstimateMs(home, p0, rules) : p0.ts;
    const route = [...(fromHome ? [home] : []), ...before, first.pts[0]];
    const meters = Math.max(pathLength(route), distance(route[0], first.pts[0]) * rules.roadFactor);
    if (first.start > start) segs.push({ start, end: first.start, kind: 'woon-werk', siteId: null, source: 'gps', km: Math.round(meters / 100) / 10 });
  }
  for (let i = 0; i < stays.length; i++) {
    const s = stays[i];
    const prev = stays[i - 1];
    if (prev) {
      const fromHome = prev.site?.type === 'thuis';
      const toHome = s.site?.type === 'thuis';
      if (!(fromHome && toHome)) {
        const a = prev.pts.at(-1);
        const b = s.pts[0];
        const route = [a, ...pts.filter((p) => p.ts > a.ts && p.ts < b.ts), b];
        const meters = Math.max(pathLength(route), distance(a, b) * rules.roadFactor);
        segs.push({
          start: prev.end, end: s.start,
          kind: fromHome || toHome ? 'woon-werk' : 'verplaatsing',
          siteId: null, source: 'gps', km: Math.round(meters / 100) / 10,
        });
      }
    }
    if (s.site?.type !== 'thuis') segs.push(staySegment(s));
  }
  return segs.filter((s) => s.end > s.start);
}

/**
 * Badges → werktijd in het atelier.
 * De badge opent ook de deur van het atelier, dus badges tussendoor tellen niet:
 *  - de eerste badge van de dag = start,
 *  - de laatste badge van de dag = einde (vandaag: het blok loopt door tot je vertrekt, want de
 *    laatste badge tot nu kan nog een deur-badge zijn),
 *  - tijd waarin de gsm toont dat je elders was (klant, onderweg, leverancier) wordt eruit geknipt.
 * Pauzes komen niet van de badges maar van de bevestiging op de gsm.
 */
function badgeIntervals(badges, gpsSegs, rules, openEnd, { live = false, atelier = null } = {}) {
  const sorted = [...badges].sort((a, b) => a.ts - b.ts);
  if (!sorted.length) return [];
  const first = sorted[0].ts;
  const last = sorted.at(-1).ts;
  // elders = verblijf of rit die niet in het atelier is (onbekende plekken enkel als het atelier een zone heeft)
  const away = (s) => s.kind !== 'atelier' && s.kind !== 'pauze' && (s.kind !== 'onbekend' || atelier?.lat != null);
  // na een badge vertrokken: de gsm is daarna (nog) elders
  const leftAfter = (ts) => gpsSegs.find((s) => s.end > ts + MIN && away(s));
  // een badge bewijst dat je op dat moment in het atelier was: zo'n stuk niet wegknippen
  const hasBadge = (s) => sorted.some((b) => b.ts > s.start && b.ts < s.end);
  const twoBadges = sorted.length > 1 && last - first >= rules.badgeDebounceSec * 1000;
  let end;
  let open = false;
  if (twoBadges && !(live && !leftAfter(last))) {
    end = last;
  } else {
    // één badge (of vandaag nog niet vertrokken): tot de gsm toont dat je weg bent, anders tot nu
    const left = leftAfter(twoBadges ? last : first);
    if (left && left.end > first) end = Math.max(left.start, twoBadges ? last : first);
    else { end = Math.max(first + MIN, openEnd); open = true; }
  }
  // stukken waarin de gsm elders was, uitknippen
  let parts = [{ start: first, end }];
  for (const s of gpsSegs.filter((x) => away(x) && !hasBadge(x))) {
    parts = parts.flatMap((p) => {
      if (s.end <= p.start || s.start >= p.end) return [p];
      return [{ start: p.start, end: s.start }, { start: s.end, end: p.end }].filter((x) => x.end - x.start >= MIN);
    });
  }
  return parts.map((p, i) => ({ ...p, closedBy: open && i === parts.length - 1 && p.end === end ? 'open' : 'badge' }))
    .filter((iv) => iv.end > iv.start);
}

/** Leg een interval over de segmenten: overlappende delen worden weggeknipt */
function overlay(segs, iv, seg) {
  const out = [];
  for (const s of segs) {
    if (s.end <= iv.start || s.start >= iv.end) { out.push(s); continue; }
    if (s.start < iv.start) out.push({ ...s, end: iv.start });
    if (s.end > iv.end) out.push({ ...s, start: iv.end });
  }
  out.push(seg);
  return out.sort((a, b) => a.start - b.start);
}

function mergeAdjacent(segs) {
  const out = [];
  for (const s of segs) {
    const p = out.at(-1);
    if (p && p.kind === s.kind && p.siteId === s.siteId && s.start - p.end <= MIN && !['verplaatsing', 'woon-werk'].includes(s.kind)) {
      p.end = Math.max(p.end, s.end);
      if (s.source === 'badge') p.source = 'badge';
    } else out.push({ ...s });
  }
  return out;
}

/** Kies automatisch het project voor elk segment */
function assignProjects(segs, { sitesById, projects, planning }) {
  const active = projects.filter((p) => p.active);
  const planned = planning.map((pl) => projects.find((p) => p.id === pl.project_id)).filter(Boolean);
  const ids = (list) => [...new Set(list.map((p) => p.id))];

  for (const s of segs) {
    s.projectId = null;
    s.candidates = [];
    if (s.kind === 'werk') {
      const site = sitesById.get(s.siteId);
      const matches = (p) => p.site_id === site.id || (site.customer_id && p.customer_id === site.customer_id);
      const plannedHere = planned.filter(matches);
      const bySite = active.filter((p) => p.site_id === site.id);
      const byCustomer = active.filter((p) => site.customer_id && p.customer_id === site.customer_id);
      for (const list of [plannedHere, bySite, byCustomer]) {
        if (list.length === 1) { s.projectId = list[0].id; break; }
      }
      s.candidates = ids([...plannedHere, ...bySite, ...byCustomer]);
    } else if (s.kind === 'atelier' || s.kind === 'leverancier') {
      if (planned.length === 1) s.projectId = planned[0].id;
      s.candidates = ids(planned);
    }
  }
  // Verplaatsing hoort bij het project van de bestemming (of anders van het vertrekpunt)
  segs.forEach((s, i) => {
    if (s.kind !== 'verplaatsing') return;
    const next = segs.slice(i + 1).find((x) => x.kind !== 'verplaatsing');
    const prev = segs.slice(0, i).reverse().find((x) => x.kind !== 'verplaatsing');
    s.projectId = next?.projectId || prev?.projectId || null;
  });
  return segs;
}

/**
 * Hoofdfunctie: dagstaat opbouwen.
 * @param {object} input
 * @param {Array<{ts,lat,lon,acc}>} input.points  locatiepunten van die dag
 * @param {Array<{ts}>} input.badges              badges van die dag
 * @param {Array} input.sites                      actieve locaties (incl. thuisadres van deze werknemer)
 * @param {Array} input.projects                   alle projecten
 * @param {Array} input.planning                   planning van deze werknemer voor die dag
 * @param {object} input.rules                     regels uit config
 * @param {number} input.openEnd                   eindtijd voor een open badge (nu, of einde van de dag)
 */
export function buildTimeline({ points, badges = [], sites, projects = [], planning = [], rules, openEnd, live = false }) {
  const sitesById = new Map(sites.map((s) => [s.id, s]));
  const pts = points
    .filter((p) => p.acc == null || p.acc <= rules.maxAccuracyM)
    .sort((a, b) => a.ts - b.ts)
    .map((p) => ({ ...p, site: matchSite(p, sites) }));

  const stays = findStays(clusterPoints(pts, rules), rules);
  // Vandaag: het laatste verblijf op een gekende plek (klant, atelier, leverancier) loopt door tot nu.
  // De gsm stuurt niets zolang je stilstaat; pas als je vertrekt komt er een nieuw punt.
  const lastStay = stays.at(-1);
  if (live && lastStay?.site && lastStay.site.type !== 'thuis' && openEnd > lastStay.end) lastStay.end = openEnd;
  let segs = staysToSegments(stays, pts, rules, sites.find((s) => s.type === 'thuis'));

  const atelier = sites.find((s) => s.type === 'atelier');
  const intervals = badgeIntervals(badges, segs, rules, openEnd, { live, atelier });
  for (const iv of intervals) {
    segs = overlay(segs, iv, {
      start: iv.start, end: iv.end, kind: 'atelier', siteId: atelier?.id ?? null,
      source: 'badge', openBadge: iv.closedBy === 'open',
    });
  }
  segs = mergeAdjacent(segs.filter((s) => s.end - s.start >= MIN));
  assignProjects(segs, { sitesById, projects, planning });
  return roundSegments(segs, rules);
}

/**
 * Antwoorden op de vragen (pushmeldingen) verwerken in het voorstel:
 *  - "Aan het werk?" Nee → niets registreren voor die dag.
 *  - "Aan het werk?" Ja bij een klant → de rit van thuis naar de klant telt als werk (verplaatsing);
 *    in het atelier blijft die rit woon-werkverkeer (telt niet mee).
 *  - Gekozen klant/project → op het blok waar de werknemer op dat moment was (en de rit ernaartoe).
 *  - "Geen klant" → dat blok wordt pauze.
 * Resultaat: { segs, declined } (declined = het antwoord "nee", of null)
 */
export function applyAnswers(segs, answers = [], { now = null } = {}) {
  const res = applyAnswersRaw(segs, answers, now);
  return { ...res, segs: dropTrailingPause(res.segs, now) };
}

/** Er wordt nog gewerkt na dit moment (rijden en pauze tellen niet) */
const workedAfter = (segs, ts) => segs.some((s) => !['pauze', 'verplaatsing', 'woon-werk'].includes(s.kind) && s.end > ts + MIN);

/**
 * Een pauze waarna niet meer gewerkt wordt, valt weg (de dag eindigt niet met een pauze).
 * Een pauze die nu nog loopt (vandaag, einde nog niet bereikt) blijft staan.
 */
export function dropTrailingPause(segs, now = null) {
  return segs.filter((s) => s.kind !== 'pauze' || (now != null && s.end > now) || workedAfter(segs, s.end));
}

function applyAnswersRaw(segs, answers, now) {
  const start = answers.filter((a) => a.kind === 'start' && a.answer).at(-1);
  if (start?.answer.answer === 'nee') return { segs: [], declined: start };
  const out = segs.map((s) => ({ ...s }));
  const TRAVEL = new Set(['verplaatsing', 'woon-werk']);
  if (start?.answer.answer === 'ja' && (start.answer.siteType ?? start.siteType) !== 'atelier') {
    const firstStay = out.find((s) => !TRAVEL.has(s.kind) && s.kind !== 'pauze');
    for (const s of out) if (s.kind === 'woon-werk' && firstStay && s.end <= firstStay.start + MIN) s.kind = 'verplaatsing';
  }
  const picks = answers.filter((a) => a.answer && ((a.kind === 'start' && a.answer.answer === 'ja') || (a.kind === 'waar' && ['klant', 'geen'].includes(a.answer.answer))));
  for (const a of picks) {
    // blok waarin de werknemer toen was, of het eerste blok dat kort erna begint
    let i = out.findIndex((s) => !TRAVEL.has(s.kind) && s.start <= a.ts + 5 * MIN && s.end > a.ts);
    if (i < 0) i = out.findIndex((s) => !TRAVEL.has(s.kind) && s.start >= a.ts && s.start - a.ts <= 20 * MIN);
    // vandaag "Aan het werk? Ja" maar de gsm heeft nog geen verblijf (te weinig punten): de regel staat
    // er meteen, vanaf het moment van de vraag tot nu (of tot het volgende blok)
    if (i < 0 && a.kind === 'start' && now != null && now > a.ts && now - a.ts < 14 * 3600000) {
      const Q = 15 * MIN;
      const start = Math.round(a.ts / Q) * Q;
      const next = out.filter((s) => s.start > a.ts).sort((x, y) => x.start - y.start)[0];
      const end = Math.min(now, next?.start ?? now);
      if (end - start >= MIN) {
        out.push({ start, end, kind: (a.answer.siteType ?? a.siteType) === 'atelier' ? 'atelier' : 'werk', siteId: a.answer.siteId ?? a.siteId ?? null,
          projectId: null, candidates: [], source: 'melding', running: !next });
        out.sort((x, y) => x.start - y.start);
        i = out.findIndex((s) => s.source === 'melding' && s.start === start);
        // de rit naar de klant telt als werk (zoals hierboven, maar het blok bestond toen nog niet)
        if (out[i].kind === 'werk') for (const s of out) if (s.kind === 'woon-werk' && s.end <= start + 5 * MIN && !out.slice(0, i).some((x) => !TRAVEL.has(x.kind) && x.kind !== 'pauze')) s.kind = 'verplaatsing';
      }
    }
    if (i < 0) continue;
    const seg = out[i];
    if (a.answer.answer === 'geen') { Object.assign(seg, { kind: 'pauze', projectId: null, candidates: [] }); continue; }
    if (seg.kind === 'onbekend' || (a.answer.customerId && seg.kind !== 'atelier')) seg.kind = 'werk';
    if (a.answer.siteId) seg.siteId = a.answer.siteId;
    if (a.answer.workType) seg.workType = a.answer.workType;
    if (a.answer.projectId) {
      seg.projectId = a.answer.projectId;
      const prev = out[i - 1];
      if (prev && TRAVEL.has(prev.kind) && prev.kind !== 'woon-werk') prev.projectId = a.answer.projectId;
    }
    seg.answered = true;
  }
  // pauze via de melding: van het bevestigen van "Pauze?" tot "Pauze voorbij?" (of de standaardpauze)
  const p = answers.filter((a) => a.kind === 'pauze' && a.answer).at(-1);
  if (p?.answer.answer === 'ja') {
    // per kwartier: begin en einde naar het dichtstbijzijnde kwartier (12:04 → 12:00, 12:35 → 12:30), minstens een kwartier
    const Q = 15 * MIN;
    const q = (ts) => Math.round(ts / Q) * Q;
    const start = q(p.answer.at ?? p.answeredAt ?? p.ts);
    const endA = answers.filter((a) => a.kind === 'pauze_einde' && a.answer?.answer === 'ja').at(-1);
    const end = Math.max(start + Q, endA ? q(endA.answer.at ?? endA.answeredAt) : start + (p.answer.pauseMin ?? 30) * MIN);
    // geen werk meer na de pauze (en ze loopt niet meer): niet als pauze uitknippen
    const running = now != null && end > now && !endA;
    if (end > start && (running || workedAfter(out, end - MIN))) {
      const cut = [];
      for (const s of out) {
        if (s.end <= start || s.start >= end) { cut.push(s); continue; }
        if (s.start < start) cut.push({ ...s, end: start });
        if (s.end > end) cut.push({ ...s, start: end });
      }
      cut.push({ start, end, kind: 'pauze', siteId: null, projectId: null, candidates: [], source: 'melding' });
      return { segs: cut.sort((a, b) => a.start - b.start), declined: null, pause: { start, end } };
    }
  }
  return { segs: out, declined: null };
}

/**
 * Manuele aanpassingen: het automatische voorstel vergelijken met wat bevestigd werd.
 * Blokken worden gekoppeld op de grootste overlap. Resultaat (in volgorde van tijd):
 *  { type: 'toegevoegd' | 'verwijderd' | 'gewijzigd', kind, from: {start,end,kind,projectId}, to: {...}, what: [...] }
 *  what: 'begin', 'einde', 'soort', 'project', 'km'
 */
export function diffSegments(proposalSegs = [], finalSegs = []) {
  const P = proposalSegs.map((s, i) => ({ s, i }));
  const F = finalSegs.map((s, i) => ({ s, i }));
  const pairs = [];
  for (const p of P) for (const f of F) {
    const ov = Math.min(p.s.end, f.s.end) - Math.max(p.s.start, f.s.start);
    if (ov > 0) pairs.push({ p, f, ov: ov + (p.s.kind === f.s.kind ? 1 : 0) });
  }
  pairs.sort((a, b) => b.ov - a.ov);
  const usedP = new Set(); const usedF = new Set();
  const out = [];
  for (const { p, f } of pairs) {
    if (usedP.has(p.i) || usedF.has(f.i)) continue;
    usedP.add(p.i); usedF.add(f.i);
    const what = [];
    if (Math.abs(p.s.start - f.s.start) >= MIN) what.push('begin');
    if (Math.abs(p.s.end - f.s.end) >= MIN) what.push('einde');
    if (p.s.kind !== f.s.kind) what.push('soort');
    if (p.s.projectId && f.s.projectId !== p.s.projectId) what.push('project');
    if (p.s.km != null && f.s.km != null && Math.abs(p.s.km - f.s.km) >= 0.5) what.push('km');
    if (what.length) out.push({ type: 'gewijzigd', kind: f.s.kind, from: p.s, to: f.s, what });
  }
  for (const p of P) if (!usedP.has(p.i)) out.push({ type: 'verwijderd', kind: p.s.kind, from: p.s, to: null, what: [] });
  for (const f of F) if (!usedF.has(f.i)) out.push({ type: 'toegevoegd', kind: f.s.kind, from: null, to: f.s, what: [] });
  return out.sort((a, b) => (a.to ?? a.from).start - (b.to ?? b.from).start);
}

/** Enkel wat nodig is om later te vergelijken (bewaard bij het bevestigen) */
export const compactSegments = (segs) => segs.map(({ start, end, kind, projectId = null, siteId = null, km = null }) => ({ start, end, kind, projectId, siteId, km }));

/**
 * Afronden per kwartier (instelbaar). Een verblijf/verplaatsing die op de vorige aansluit,
 * deelt dezelfde afgeronde grens. Regels (standaard):
 *  - begin (start van de dag of na een pauze): tot 5 min na het kwartier naar beneden, daarna naar boven
 *    (8:00–8:05 → 8:00, 8:06–8:15 → 8:15)
 *  - einde (einde van de dag of voor een pauze): tot 8 min na het kwartier naar beneden
 *    (17:00–17:08 → 17:00, 17:09–17:15 → 17:15)
 *  - aansluitende grens tussen twee regels: naar het dichtstbijzijnde kwartier
 * Een atelierblok dat nog loopt (ingebadged, nog niet weg) wordt niet afgerond.
 */
export function roundSegments(segs, rules) {
  const q = (rules.roundMinutes ?? 0) * MIN;
  if (!q) return segs;
  const startDown = rules.roundStartDownMax ?? 5;
  const endDown = rules.roundEndDownMax ?? 8;
  const rnd = (t, downMax) => {
    const r = ((t % q) + q) % q;
    if (r === 0) return t;
    return Math.floor(r / MIN) <= downMax ? t - r : t - r + q;
  };
  const sorted = [...segs].sort((a, b) => a.start - b.start).map((s) => ({ ...s }));
  const out = sorted.map((s) => ({ ...s }));
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    if (s.openBadge) continue;
    const prev = sorted[i - 1];
    const next = sorted[i + 1];
    const joinedPrev = prev && Math.abs(s.start - prev.end) < MIN;
    const joinedNext = next && Math.abs(next.start - s.end) < MIN;
    out[i].start = joinedPrev ? rnd(s.start, Math.floor(rules.roundMinutes / 2)) : rnd(s.start, startDown);
    out[i].end = joinedNext ? rnd(next.start, Math.floor(rules.roundMinutes / 2)) : rnd(s.end, endDown);
  }
  // aansluitende regels: einde van de vorige = begin van de volgende
  for (let i = 1; i < out.length; i++) {
    if (!out[i].openBadge && Math.abs(sorted[i].start - sorted[i - 1].end) < MIN) out[i].start = out[i - 1].end;
  }
  return out.filter((s) => s.end > s.start);
}

/** Totalen en waarschuwingen voor een lijst segmenten (voorstel of bevestigd) */
export function summarize(segs, rules) {
  const minutes = {};
  let work = 0;
  let km = 0;
  for (const s of segs) {
    const m = Math.round((s.end - s.start) / MIN);
    minutes[s.kind] = (minutes[s.kind] ?? 0) + m;
    if (isWorkKind(s.kind, rules)) work += m;
    km += s.km ?? 0;
  }
  const warnings = [];
  if (!segs.length) warnings.push('Geen gegevens voor deze dag.');
  const unknown = segs.filter((s) => s.kind === 'onbekend').length;
  if (unknown) warnings.push(`${unknown} onbekende locatie(s): kies pauze of een project.`);
  const noProject = segs.filter((s) => s.kind === 'werk' && !s.projectId).length;
  if (noProject) warnings.push(`${noProject} werkregel(s) zonder project.`);
  if (segs.some((s) => s.openBadge)) warnings.push('Ingebadged in het atelier maar niet uitgebadged.');
  // Een onderbreking van minstens 15 minuten tussen twee regels telt ook als pauze
  const sorted = [...segs].sort((a, b) => a.start - b.start);
  const hasGapPause = sorted.some((s, i) => i > 0 && s.start - sorted[i - 1].end >= 15 * MIN);
  if (work > 6 * 60 && !minutes.pauze && !hasGapPause) warnings.push('Meer dan 6 uur gewerkt zonder geregistreerde pauze.');
  return {
    minutes,
    workMinutes: work,
    km: Math.round(km * 10) / 10,
    start: segs[0]?.start ?? null,
    end: segs.at(-1)?.end ?? null,
    warnings,
  };
}
