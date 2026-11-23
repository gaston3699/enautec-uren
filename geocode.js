// Coördinaten opzoeken bij een adres via OpenStreetMap (Nominatim).
// Gratis, maar maximaal 1 opzoeking per seconde: alle opzoekingen gaan via een wachtrij.
const URL_BASE = 'https://nominatim.openstreetmap.org/search';
let last = 0;
let chain = Promise.resolve();

/** Straat opkuisen zoals ze uit de boekhouding komt: "Groenedreef(Kru) 15A", "Dijk 349/F000", "Heirweg 0004" */
export function cleanStreet(street) {
  return String(street ?? '')
    .replace(/\([^)]*\)/g, ' ')          // (Kru), (Onk): deelgemeente-afkorting
    .split(/\s+-\s+/)[0]                 // "Tenhovestraat 6a - IZ. Zuid C3"
    .replace(/(\d+[a-zA-Z]?)\s*\/\s*\S+/, '$1') // busnummer: 349/F000 → 349
    .replace(/\b0+(\d)/g, '$1')          // 0004 → 4
    .replace(/\s+/g, ' ')
    .trim();
}

/** Land afleiden uit de postcode: 4 cijfers = België, 5 cijfers = Frankrijk */
export function countryOf(postcode) {
  const p = String(postcode ?? '').trim();
  if (/^\d{5}$/.test(p)) return 'fr';
  if (/^\d{4}\s?[a-z]{2}$/i.test(p)) return 'nl';
  return 'be';
}

/** Adres als één regel voor op het scherm */
export function addressLine({ street, postcode, city }) {
  return [String(street ?? '').trim(), [postcode, city].filter(Boolean).join(' ').trim()].filter(Boolean).join(', ');
}

/** "Straat 1, 8800 Roeselare" → { street, postcode, city } */
export function splitAddress(text) {
  const t = String(text ?? '').trim();
  const m = t.match(/^(.*?)[,\s]+(\d{4,5})\s+(.+)$/);
  return m ? { street: m[1].trim(), postcode: m[2], city: m[3].trim() } : { street: t, postcode: '', city: '' };
}

async function ask(params) {
  // wachtrij: minstens 1,1 s tussen twee opzoekingen
  const run = async () => {
    const wait = last + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const q = new URLSearchParams({ format: 'jsonv2', limit: '1', addressdetails: '0', 'accept-language': 'nl', ...params });
    const res = await fetch(`${URL_BASE}?${q}`);
    if (!res.ok) throw new Error(`Adres opzoeken mislukt (${res.status})`);
    return res.json();
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

const HOUSE = new Set(['house', 'building', 'residential', 'commercial', 'industrial', 'retail', 'office', 'yes', 'farm', 'apartments', 'detached', 'semidetached_house', 'warehouse', 'place']);

/**
 * Coördinaten voor een adres. Resultaat: { lat, lon, geo } met geo = 'adres' (huisnummer gevonden)
 * of 'straat' (enkel de straat gevonden: controleren), of null als niets gevonden.
 * Enkel de gemeente is niet genoeg: dan zou de zone verkeerde plaatsen herkennen.
 */
export async function geocode({ street, postcode, city }) {
  const s = cleanStreet(street);
  if (!s || (!postcode && !city)) return null;
  const countrycodes = countryOf(postcode);
  const tries = [
    { street: s, postalcode: String(postcode ?? '').trim(), city: String(city ?? '').trim(), countrycodes },
    { street: s, postalcode: String(postcode ?? '').trim(), countrycodes },
    { q: `${s}, ${postcode ?? ''} ${city ?? ''}`.trim(), countrycodes },
  ];
  for (const params of tries) {
    for (const k of Object.keys(params)) if (!params[k]) delete params[k];
    const [hit] = await ask(params);
    if (!hit) continue;
    const kind = hit.addresstype ?? hit.type;
    if (['city', 'town', 'village', 'municipality', 'county', 'state', 'country', 'postcode', 'suburb', 'hamlet', 'neighbourhood', 'quarter'].includes(kind)) continue;
    const exact = HOUSE.has(kind) || hit.category === 'building' || (hit.place_rank ?? 0) >= 28;
    return { lat: Number(Number(hit.lat).toFixed(6)), lon: Number(Number(hit.lon).toFixed(6)), geo: exact ? 'adres' : 'straat' };
  }
  return null;
}
