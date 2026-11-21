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
function staysToSegments(stays, pts, rules) {
  const segs = [];
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

/** Badges koppelen tot intervallen in het atelier */
function badgeIntervals(badges, gpsSegs, rules, openEnd) {
  const sorted = [...badges].sort((a, b) => a.ts - b.ts);
  const deduped = [];
  for (const b of sorted) {
    if (deduped.length && b.ts - deduped.at(-1).ts < rules.badgeDebounceSec * 1000) continue;
    deduped.push(b);
  }
  const intervals = [];
  let open = null;
  for (const b of deduped) {
    if (open) {
      // Vertrok de werknemer (volgens GPS) al vóór deze badge? Dan was dit een nieuwe inbadge.
      const left = gpsSegs.find((s) => s.start >= open.start && s.start < b.ts && s.kind !== 'atelier');
      if (left) {
        intervals.push({ start: open.start, end: left.start, closedBy: 'gps' });
        open = { start: b.ts };
      } else {
        intervals.push({ start: open.start, end: b.ts, closedBy: 'badge' });
        open = null;
      }
    } else {
      open = { start: b.ts };
    }
  }
  if (open) {
    const left = gpsSegs.find((s) => s.start >= open.start && s.kind !== 'atelier');
    if (left) intervals.push({ start: open.start, end: left.start, closedBy: 'gps' });
    else intervals.push({ start: open.start, end: Math.max(open.start, openEnd), closedBy: 'open' });
  }
  return intervals.filter((iv) => iv.end > iv.start);
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
export function buildTimeline({ points, badges = [], sites, projects = [], planning = [], rules, openEnd }) {
  const sitesById = new Map(sites.map((s) => [s.id, s]));
  const pts = points
    .filter((p) => p.acc == null || p.acc <= rules.maxAccuracyM)
    .sort((a, b) => a.ts - b.ts)
    .map((p) => ({ ...p, site: matchSite(p, sites) }));

  const stays = findStays(clusterPoints(pts, rules), rules);
  let segs = staysToSegments(stays, pts, rules);

  const atelier = sites.find((s) => s.type === 'atelier');
  const intervals = badgeIntervals(badges, segs, rules, openEnd);
  for (const iv of intervals) {
    segs = overlay(segs, iv, {
      start: iv.start, end: iv.end, kind: 'atelier', siteId: atelier?.id ?? null,
      source: 'badge', openBadge: iv.closedBy === 'open',
    });
  }
  segs = mergeAdjacent(segs.filter((s) => s.end - s.start >= MIN));
  assignProjects(segs, { sitesById, projects, planning });
  return segs;
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
