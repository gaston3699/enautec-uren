// Weken, maanden, jaren, Belgische feestdagen, verwachte uren en snelle tijdingave.
import { shiftDate } from './time.js';

/** Weekdag 1 = maandag … 7 = zondag */
export const isoDay = (date) => new Date(`${date}T12:00:00Z`).getUTCDay() || 7;

/** Maandag van de week van `date` */
export const weekStart = (date) => shiftDate(date, 1 - isoDay(date));

/** ISO-weeknummer */
export function weekNumber(date) {
  const thu = shiftDate(date, 4 - isoDay(date));
  const jan1 = `${thu.slice(0, 4)}-01-01`;
  return Math.floor((Date.parse(`${thu}T12:00:00Z`) - Date.parse(`${jan1}T12:00:00Z`)) / 86400000 / 7) + 1;
}

export const monthDays = (month) => {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
};

export const shiftMonth = (month, n) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

/** Paaszondag (algoritme van Meeus/Jones/Butcher) */
function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const holidayCache = new Map();
/** Wettelijke feestdagen in België: { 'YYYY-MM-DD': naam } */
export function holidays(year) {
  if (holidayCache.has(year)) return holidayCache.get(year);
  const e = easter(year);
  const h = {
    [`${year}-01-01`]: 'Nieuwjaar', [shiftDate(e, 1)]: 'Paasmaandag', [`${year}-05-01`]: 'Dag van de Arbeid',
    [shiftDate(e, 39)]: 'O.L.H. Hemelvaart', [shiftDate(e, 50)]: 'Pinkstermaandag', [`${year}-07-21`]: 'Nationale feestdag',
    [`${year}-08-15`]: 'O.L.V. Hemelvaart', [`${year}-11-01`]: 'Allerheiligen', [`${year}-11-11`]: 'Wapenstilstand',
    [`${year}-12-25`]: 'Kerstmis',
  };
  holidayCache.set(year, h);
  return h;
}
export const holidayName = (date) => holidays(Number(date.slice(0, 4)))[date] ?? null;

/** Verwachte arbeidstijd (minuten) op een dag: werkdag zonder feestdag = dagnorm */
export const expectedMinutes = (date, dayMinutes = 480) => (isoDay(date) <= 5 && !holidayName(date) ? dayMinutes : 0);

/**
 * Snelle tijdingave → 'HH:MM' (of null als het niet te lezen is).
 *  8, 8u, 8.00, 8,00, 08:00 → 08:00 · 730, 7.30, 7u30 → 07:30
 *  komma = decimaal uur: 8,5 → 08:30 · punt of u met één cijfer = tientallen minuten: 8.5, 8u5 → 08:50
 */
export function parseTime(text) {
  const t = String(text ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!t) return null;
  let h; let m;
  let r;
  if ((r = t.match(/^(\d{1,2}),(\d{1,2})$/))) { h = +r[1]; m = Math.round(Number(`0.${r[2]}`) * 60); }
  else if ((r = t.match(/^(\d{1,2})[.:u](\d)$/))) { h = +r[1]; m = +r[2] * 10; }
  else if ((r = t.match(/^(\d{1,2})[.:u](\d{2})$/))) { h = +r[1]; m = +r[2]; }
  else if ((r = t.match(/^(\d{1,2})u?$/))) { h = +r[1]; m = 0; }
  else if ((r = t.match(/^(\d{1,2})(\d{2})$/))) { h = +r[1]; m = +r[2]; }
  else return null;
  if (m === 60) { h += 1; m = 0; }
  if (h > 24 || m > 59 || (h === 24 && m > 0)) return null;
  return `${String(h % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
