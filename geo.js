// Afstanden en zones (puur rekenwerk, werkt in de browser en in Node).
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

/** Afstand in meter tussen twee punten {lat, lon} */
export function distance(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Lengte (meter) van een reeks punten */
export function pathLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) len += distance(points[i - 1], points[i]);
  return len;
}

/**
 * Zoek de locatie (zone) waarin een punt valt. Bij overlap wint de dichtstbijzijnde.
 * De nauwkeurigheid van het punt wordt beperkt meegerekend (max. 50 m extra marge).
 */
export function matchSite(point, sites) {
  let best = null;
  let bestDist = Infinity;
  const margin = Math.min(point.acc ?? 0, 50);
  for (const s of sites) {
    if (s.lat == null || s.lon == null || s.active === false) continue;
    const d = distance(point, s);
    if (d <= (s.radius_m ?? 150) + margin && d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

/** Tekst als "50.8631, 3.0694" (bv. gekopieerd uit Google Maps) omzetten naar coördinaten */
export function parseLatLon(text) {
  const m = String(text ?? '').match(/(-?\d{1,2}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)/);
  return m ? { lat: Number(m[1]), lon: Number(m[2]) } : null;
}
