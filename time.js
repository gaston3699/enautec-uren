// Tijdzonehulp (Europe/Brussels). Tijdstippen = epoch-milliseconden, dagen = 'YYYY-MM-DD'.
export const TZ = 'Europe/Brussels';

const dateFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('nl-BE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

export const localDate = (ts) => dateFmt.format(new Date(ts));
export const localTime = (ts) => timeFmt.format(new Date(ts));
export const today = () => localDate(Date.now());
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

function tzOffset(ts) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - (ts - (ts % 1000));
}

/** Epoch-ms van een lokale datum + 'HH:MM' */
export function localToTs(date, hhmm = '00:00') {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  return guess - tzOffset(guess - tzOffset(guess));
}

export function shiftDate(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** [start, einde) van een lokale dag */
export const dayRange = (date) => [localToTs(date, '00:00'), localToTs(shiftDate(date, 1), '00:00')];

export const fmtDate = (date, opts = { weekday: 'long', day: 'numeric', month: 'long' }) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('nl-BE', opts);

export const fmtHours = (min) => `${Math.floor(min / 60)}u${String(Math.round(min % 60)).padStart(2, '0')}`;

/** Alle datums van een periode (inclusief) */
export function datesBetween(from, to) {
  const out = [];
  for (let d = from; d <= to; d = shiftDate(d, 1)) out.push(d);
  return out;
}
