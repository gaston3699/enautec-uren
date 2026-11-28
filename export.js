// Excel-export voor de facturatie (en het loon): enkel bevestigde dagen.
import { KINDS, isWorkKind } from './engine.js';
import { localTime, datesBetween } from './time.js';
import { alive } from './ui.js';
import { rulesFrom } from './day.js';
import { workTypeName } from './projects.js';

const EXCELJS = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';

function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = EXCELJS;
    s.onload = () => resolve(window.ExcelJS);
    s.onerror = () => reject(new Error('Excel-module kon niet geladen worden (internet nodig).'));
    document.head.append(s);
  });
}

const hours = (ms) => Math.round((ms / 3600000) * 100) / 100;

function styleHeader(ws) {
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF111111' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (ws.columnCount) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

/**
 * Verzamel de bevestigde regels uit de registratiebestanden.
 * regs: lijst van registratiebestanden { username, days }
 */
export function collect(master, regs, from, to) {
  const emp = new Map(master.employees.map((e) => [e.username, e]));
  const proj = new Map(master.projects.map((p) => [p.id, p]));
  const cust = new Map(master.customers.map((c) => [c.id, c]));
  const site = new Map(master.sites.map((s) => [s.id, s]));
  const rows = [];
  const mats = [];
  const open = [];
  const dates = new Set(datesBetween(from, to));
  for (const reg of regs) {
    for (const [date, d] of Object.entries(reg.days ?? {})) {
      if (!dates.has(date)) continue;
      const name = emp.get(reg.username)?.name ?? reg.username;
      if (d.status === 'nietgewerkt') continue; // aangeduid als niet gewerkt: niets te factureren
      if (d.status !== 'bevestigd') { open.push({ date, name }); continue; }
      for (const s of d.segments ?? []) {
        const p = proj.get(s.projectId);
        rows.push({
          date, employee: name, start: s.start, end: s.end, kind: s.kind, km: s.km ?? null, note: s.note ?? '',
          site: site.get(s.siteId)?.name ?? '', projectCode: p?.code ?? '', project: p?.name ?? '',
          customer: cust.get(p?.customer_id)?.name ?? '',
          workType: workTypeName(master, s.workType ?? p?.work_type) || '',
        });
      }
      for (const m of d.material ?? []) {
        const p = proj.get(m.projectId);
        const art = alive(master.articles).find((a) => a.id === m.articleId);
        mats.push({
          date, employee: name, description: m.description, articleCode: art?.code ?? '', qty: m.qty, unit: m.unit ?? '',
          projectCode: p?.code ?? '', project: p?.name ?? '', customer: cust.get(p?.customer_id)?.name ?? '',
          // eigen materiaal van een zelfstandige: die rekent het zelf aan
          billedBy: m.own ? name : 'Enautec',
        });
      }
    }
  }
  const sortKey = (r) => `${r.date}|${r.employee}|${r.start ?? ''}`;
  rows.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  mats.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  open.sort((a, b) => (a.date + a.name).localeCompare(b.date + b.name));
  return { rows, mats, open };
}

export async function buildWorkbook(master, regs, from, to) {
  const ExcelJS = await loadExcelJS();
  const rules = rulesFrom(master);
  const { rows, mats, open } = collect(master, regs, from, to);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Enautec urenregistratie';
  wb.created = new Date();

  // 1. Per project: uren, km en materiaal (facturatie)
  const per = new Map();
  const keyOf = (r) => `${r.customer}|${r.projectCode}|${r.project}|${r.workType ?? ''}`;
  for (const r of rows) {
    if (!r.project) continue;
    const p = per.get(keyOf(r)) ?? { customer: r.customer, projectCode: r.projectCode, project: r.project, workType: r.workType ?? '', werk: 0, reis: 0, km: 0, mat: 0 };
    if (r.kind === 'verplaatsing' || r.kind === 'woon-werk') p.reis += r.end - r.start;
    else if (r.kind !== 'pauze') p.werk += r.end - r.start;
    p.km += r.km ?? 0;
    per.set(keyOf(r), p);
  }
  for (const m of mats) {
    if (!m.project) continue;
    // materiaal bij de eerste regel van hetzelfde project (los van het type werk)
    const pre = `${m.customer}|${m.projectCode}|${m.project}|`;
    const k = [...per.keys()].find((x) => x.startsWith(pre)) ?? keyOf(m);
    const p = per.get(k) ?? { customer: m.customer, projectCode: m.projectCode, project: m.project, workType: '', werk: 0, reis: 0, km: 0, mat: 0 };
    p.mat += 1;
    per.set(k, p);
  }
  const prj = wb.addWorksheet('Per project');
  prj.columns = [
    { header: 'Klant', key: 'customer', width: 26 },
    { header: 'Projectcode', key: 'projectCode', width: 13 },
    { header: 'Project', key: 'project', width: 30 },
    { header: 'Type werk', key: 'workType', width: 20 },
    { header: 'Werkuren', key: 'werk', width: 10 },
    { header: 'Reisuren', key: 'reis', width: 10 },
    { header: 'Km', key: 'km', width: 8 },
    { header: 'Materiaalregels', key: 'mat', width: 15 },
  ];
  for (const p of [...per.values()].sort((a, b) => (a.customer + a.projectCode).localeCompare(b.customer + b.projectCode, 'nl'))) {
    prj.addRow({ ...p, werk: hours(p.werk), reis: hours(p.reis), km: Math.round(p.km * 10) / 10 });
  }
  styleHeader(prj);

  // 2. Materiaal
  const mat = wb.addWorksheet('Materiaal');
  mat.columns = [
    { header: 'Datum', key: 'date', width: 12 },
    { header: 'Werknemer', key: 'employee', width: 16 },
    { header: 'Klant', key: 'customer', width: 24 },
    { header: 'Projectcode', key: 'projectCode', width: 13 },
    { header: 'Project', key: 'project', width: 26 },
    { header: 'Artikelcode', key: 'articleCode', width: 12 },
    { header: 'Omschrijving', key: 'description', width: 34 },
    { header: 'Aantal', key: 'qty', width: 9 },
    { header: 'Eenheid', key: 'unit', width: 9 },
    { header: 'Aangerekend door', key: 'billedBy', width: 18 },
  ];
  mats.forEach((m) => mat.addRow(m));
  styleHeader(mat);

  // 3. Detail van de uren
  const det = wb.addWorksheet('Uren detail');
  det.columns = [
    { header: 'Datum', key: 'date', width: 12 },
    { header: 'Werknemer', key: 'employee', width: 16 },
    { header: 'Van', key: 'from', width: 7 },
    { header: 'Tot', key: 'to', width: 7 },
    { header: 'Soort', key: 'kind', width: 18 },
    { header: 'Arbeidstijd', key: 'work', width: 11 },
    { header: 'Uren', key: 'hours', width: 8 },
    { header: 'Km', key: 'km', width: 7 },
    { header: 'Klant', key: 'customer', width: 24 },
    { header: 'Projectcode', key: 'projectCode', width: 13 },
    { header: 'Project', key: 'project', width: 26 },
    { header: 'Type werk', key: 'workType', width: 20 },
    { header: 'Locatie', key: 'site', width: 22 },
    { header: 'Opmerking', key: 'note', width: 30 },
  ];
  for (const r of rows) {
    det.addRow({ ...r, from: localTime(r.start), to: localTime(r.end), kind: KINDS[r.kind] ?? r.kind, work: isWorkKind(r.kind, rules) ? 'ja' : 'nee', hours: hours(r.end - r.start) });
  }
  styleHeader(det);

  // 4. Per werknemer per dag (loon)
  const perDay = new Map();
  for (const r of rows) {
    const k = `${r.date}|${r.employee}`;
    const d = perDay.get(k) ?? { date: r.date, employee: r.employee, start: r.start, end: r.end, work: 0, pauze: 0, woonwerk: 0, km: 0 };
    d.start = Math.min(d.start, r.start);
    d.end = Math.max(d.end, r.end);
    if (isWorkKind(r.kind, rules)) d.work += r.end - r.start;
    if (r.kind === 'pauze') d.pauze += r.end - r.start;
    if (r.kind === 'woon-werk') d.woonwerk += r.end - r.start;
    d.km += r.km ?? 0;
    perDay.set(k, d);
  }
  const loon = wb.addWorksheet('Per werknemer per dag');
  loon.columns = [
    { header: 'Datum', key: 'date', width: 12 },
    { header: 'Werknemer', key: 'employee', width: 16 },
    { header: 'Begin', key: 'start', width: 8 },
    { header: 'Einde', key: 'end', width: 8 },
    { header: 'Arbeidsuren', key: 'work', width: 12 },
    { header: 'Pauze (u)', key: 'pauze', width: 10 },
    { header: 'Woon-werk (u)', key: 'woonwerk', width: 13 },
    { header: 'Km', key: 'km', width: 8 },
  ];
  for (const d of perDay.values()) {
    loon.addRow({ ...d, start: localTime(d.start), end: localTime(d.end), work: hours(d.work), pauze: hours(d.pauze), woonwerk: hours(d.woonwerk), km: Math.round(d.km * 10) / 10 });
  }
  styleHeader(loon);

  // 5. Nog niet bevestigd
  const nb = wb.addWorksheet('Niet bevestigd');
  nb.columns = [{ header: 'Datum', key: 'date', width: 12 }, { header: 'Werknemer', key: 'name', width: 20 }];
  open.forEach((o) => nb.addRow(o));
  styleHeader(nb);

  const buf = await wb.xlsx.writeBuffer();
  return {
    blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    counts: { rows: rows.length, mats: mats.length, open: open.length, projects: per.size },
  };
}
