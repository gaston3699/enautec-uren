// Soorten werk en "nieuw project" (overal bruikbaar: tijdsblok, atelier, verplaatsing, pushmelding).
import { PATHS, EMPTY_MASTER } from './store.js';
import { esc, uid, alive, byName } from './ui.js';

/** Standaard soorten werk (de beheerder kan ze aanpassen bij Beheer → Soorten werk) */
export const DEFAULT_WORK_TYPES = [
  { id: 'elektrisch', name: 'Elektrische werken' },
  { id: 'tekenen', name: 'Elektrisch tekenen' },
  { id: 'software', name: 'Software' },
];

/** Actieve soorten werk uit de stamgegevens (of de standaardlijst zolang er niets is ingesteld) */
export const workTypesOf = (master) => {
  const list = Array.isArray(master.workTypes) && master.workTypes.length ? alive(master.workTypes) : DEFAULT_WORK_TYPES;
  return list.filter((w) => w.active !== false);
};
export const workTypeName = (master, id) => (Array.isArray(master.workTypes) && master.workTypes.length ? master.workTypes : DEFAULT_WORK_TYPES)
  .find((w) => w.id === id)?.name ?? '';

/** Standaard type werk: "Elektrische werken" (of het eerste actieve type) */
export const defaultWorkType = (master) => {
  const list = workTypesOf(master);
  return (list.find((w) => w.id === 'elektrisch') ?? list.find((w) => /elektrische werken/i.test(w.name)) ?? list[0])?.id ?? null;
};

/** Keuzelijst met soorten werk (standaard: Elektrische werken) */
export const workTypeOptions = (master, sel) => {
  const pick = sel || defaultWorkType(master);
  return workTypesOf(master).map((w) => `<option value="${esc(w.id)}" ${w.id === pick ? 'selected' : ''}>${esc(w.name)}</option>`).join('');
};

/** Naam vergelijkbaar maken: kleine letters, zonder rechtsvorm (bv, bvba, nv, …) en leestekens */
export const normName = (s) => String(s ?? '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\b(bvba|bv|nv|cv|vof|comm\.?\s?v|commv|gcv|srl|sprl|sa|vzw|bvba)\b\.?/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim();

/** Gelijkenis tussen twee namen (0–1): zelfde naam, de ene zit in de andere, of overlap van lettergroepjes */
export function similarity(a, b) {
  const x = normName(a); const y = normName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  const grams = (s) => { const g = new Map(); const t = ` ${s} `; for (let i = 0; i < t.length - 1; i++) { const k = t.slice(i, i + 2); g.set(k, (g.get(k) ?? 0) + 1); } return g; };
  const gx = grams(x); const gy = grams(y);
  let common = 0; let total = 0;
  for (const [k, n] of gx) { common += Math.min(n, gy.get(k) ?? 0); total += n; }
  for (const n of gy.values()) total += n;
  return (2 * common) / total;
}

/** Bestaande (bevestigde) records die op `name` lijken, beste eerst */
export const similarTo = (list, name, min = 0.45) => list
  .map((r) => ({ r, score: similarity(r.name, name) })).filter((x) => x.score >= min)
  .sort((a, b) => b.score - a.score).map((x) => x.r);

/** Wie maakt iets aan (voor "te bevestigen" bij de beheerder) */
const creator = (ctx) => ctx.me?.()?.username ?? null;

/**
 * Project bewaren in de stamgegevens; geeft het nieuwe project terug.
 * Aangemaakt vanuit de werknemersweergave → "te bevestigen" door de beheerder (samenvoegen of bevestigen).
 */
export function createProject(ctx, { name, customerId = null, siteId = null, code = '', workType = null }) {
  const p = {
    id: uid(), name: name.trim(), code: code.trim(), customer_id: customerId || null, site_id: siteId || null, work_type: workType || null,
    active: true, pending: true, created_by: creator(ctx), created_at: Date.now(), updated: Date.now(),
  };
  ctx.store.change(PATHS.master, EMPTY_MASTER(), (mm) => { (mm.projects ??= []).push(p); });
  return p;
}

/**
 * Venster "Nieuw project": naam, klant (voorgekozen) en type werk.
 * Geeft het nieuwe project terug, of null bij annuleren.
 */
export function newProjectDialog(ctx, { customerId = null, siteId = null, workType = null } = {}) {
  const m = ctx.master();
  const customers = alive(m.customers).sort(byName);
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-labelledby="npTitle">
      <h2 id="npTitle">Nieuw project</h2>
      <div class="form-grid">
        <label><span>Naam van het project</span><input name="name" required placeholder="bv. Renovatie keuken" autocomplete="off"></label>
        <label><span>Klant</span><select name="customer"><option value="">— geen klant (bv. intern) —</option>
          ${customers.map((c) => `<option value="${esc(c.id)}" ${c.id === customerId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <label><span>Type werk</span><select name="workType">${workTypeOptions(m, workType)}</select></label>
        <label><span>Projectcode (mag leeg)</span><input name="code" autocomplete="off"></label>
      </div>
      <p class="muted small">Bestaat het project al? Kies het dan liever uit de lijst. Een nieuw project wordt nog nagekeken door de beheerder.</p>
      <div class="row modal-actions"><button type="button" class="secondary" data-a="cancel">Annuleren</button><button class="primary">Project aanmaken</button></div>
    </form>`;
    const form = wrap.querySelector('form');
    const done = (v) => { wrap.remove(); resolve(v); };
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-a=cancel]')) done(null); });
    form.onsubmit = (e) => {
      e.preventDefault();
      const name = form.elements.name.value.trim();
      if (!name) return;
      const cid = form.elements.customer.value || null;
      done(createProject(ctx, { name, customerId: cid, siteId: cid && cid === customerId ? siteId : null, code: form.elements.code.value, workType: form.elements.workType.value || null }));
    };
    document.body.append(wrap);
    form.elements.name.focus();
  });
}
