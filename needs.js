// "Mee te nemen" materiaal: gedeeld door de app en de server (widget).

/** "2 st kabelgoot" → { qty: 2, unit: 'st', description: 'kabelgoot' } (aantal en eenheid mogen ontbreken) */
export function parseNeedLine(text) {
  const t = String(text ?? '').trim().replace(/\s+/g, ' ').slice(0, 160);
  const m = /^(\d+(?:[.,]\d+)?)\s*(st|stuks?|m|meter|rol|rollen|doos|dozen|pak|kg|l)?\s+(.+)$/i.exec(t);
  if (!m) return { description: t, qty: null, unit: null };
  return { description: m[3], qty: Number(m[1].replace(',', '.')), unit: m[2] ? m[2].toLowerCase() : null };
}

/** Sleutel van een materiaalregel om af te vinken */
export const needKey = (description) => String(description ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);

/** "10 st kabel 3G2,5" */
export const materialLine = (l) => [l.qty != null ? String(l.qty).replace('.', ',') : '', l.unit, l.description].filter(Boolean).join(' ');
