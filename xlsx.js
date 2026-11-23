// Een tabel inlezen uit een Excel- (.xlsx) of CSV-bestand, zonder externe bibliotheek.
// Een .xlsx is een zip met XML; we lezen enkel het eerste werkblad.

/** Bestand → rijen (array van arrays met tekst) */
export async function readTable(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0x50 && buf[1] === 0x4b) return readXlsx(buf);
  return readCsv(new TextDecoder('utf-8').decode(buf));
}

/** CSV met ; of , als scheidingsteken (Excel in België gebruikt meestal ;) */
export function readCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const sep = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function unzip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // einde van de centrale map zoeken
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Geen geldig Excel-bestand.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let n = 0; n < count; n++) {
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    files[name] = { method, size, local };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return async (name) => {
    const f = files[name];
    if (!f) return null;
    const start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true);
    const data = buf.subarray(start, start + f.size);
    if (f.method === 0) return new TextDecoder().decode(data);
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  };
}

const colIndex = (ref) => {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

async function readXlsx(buf) {
  const get = await unzip(buf);
  const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml');
  const textOf = (el) => Array.from(el.getElementsByTagName('t')).map((t) => t.textContent).join('');
  const sstXml = await get('xl/sharedStrings.xml');
  const strings = sstXml ? Array.from(parse(sstXml).getElementsByTagName('si')).map(textOf) : [];
  // eerste werkblad volgens workbook.xml + relaties, anders sheet1.xml
  let sheetPath = 'xl/worksheets/sheet1.xml';
  try {
    const wb = parse(await get('xl/workbook.xml'));
    const rid = wb.getElementsByTagName('sheet')[0]?.getAttribute('r:id');
    const rels = parse(await get('xl/_rels/workbook.xml.rels'));
    const target = Array.from(rels.getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  } catch { /* standaardpad */ }
  const sheet = parse(await get(sheetPath) ?? '');
  const rows = [];
  for (const r of Array.from(sheet.getElementsByTagName('row'))) {
    const out = [];
    for (const c of Array.from(r.getElementsByTagName('c'))) {
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      out[colIndex(c.getAttribute('r'))] = t === 's' ? strings[Number(v)] ?? '' : t === 'inlineStr' ? textOf(c) : v;
    }
    rows[Number(r.getAttribute('r')) - 1] = Array.from(out, (x) => x ?? '');
  }
  return Array.from(rows, (x) => x ?? []);
}
