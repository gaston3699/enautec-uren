// Pushmeldingen in de app: inschrijven, en het vraagscherm ("Aan het werk?", "Bij wie ben je?").
import { PATHS, EMPTY_MASTER } from './store.js';
import { distance } from './geo.js';
import { localTime, today } from './time.js';
import { esc, uid, alive, byName, toast, projectLabel } from './ui.js';
import { confirmDialog } from './update.js';
import { workTypeOptions, newProjectDialog } from './projects.js';

const b64uToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));

/** Kan dit toestel pushmeldingen ontvangen? */
export function pushSupport() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return { ok: false, reason: ios && !standalone ? 'ios-home' : 'unsupported' };
  }
  return { ok: true, permission: Notification.permission };
}

async function registration() {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error('De app is nog niet volledig geïnstalleerd op dit toestel. Herlaad de app en probeer opnieuw.');
  return navigator.serviceWorker.ready;
}

/** Huidige inschrijving van dit toestel (of null) */
export async function currentSubscription() {
  try { return await (await registration()).pushManager.getSubscription(); } catch { return null; }
}

/** Meldingen aanzetten: toestemming vragen, inschrijven en de server laten weten */
export async function enablePush(server, session, device) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Meldingen zijn geweigerd. Zet ze aan in de instellingen van je toestel of browser.' : 'Geen toestemming gekregen.');
  const { publicKey } = await fetch(`${server}/api/push/key`).then((r) => r.json());
  if (!publicKey) throw new Error('Meldingen zijn nog niet ingesteld op de server.');
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (sub && sub.options?.applicationServerKey) {
    const cur = new Uint8Array(sub.options.applicationServerKey);
    const want = b64uToBytes(publicKey);
    if (cur.length !== want.length || cur.some((b, i) => b !== want[i])) { await sub.unsubscribe(); sub = null; }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToBytes(publicKey) });
  const res = await fetch(`${server}/api/push/subscribe`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
    body: JSON.stringify({ ...sub.toJSON(), device }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Inschrijven mislukt.');
  return sub;
}

export async function disablePush(server, session) {
  const sub = await currentSubscription();
  if (!sub) return;
  await fetch(`${server}/api/push/unsubscribe`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` }, body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {});
  await sub.unsubscribe();
}

/** Zones, klanten en projecten naar de server sturen als ze veranderden (nodig om aankomsten te herkennen) */
let placesBusy = false;
export async function syncPlaces(master, server, headers) {
  if (placesBusy || !server || !headers) return;
  const data = {
    sites: alive(master.sites).map(({ id, type, name, address, lat, lon, radius_m, customer_id, employee_id, active }) => ({ id, type, name, address, lat, lon, radius_m, customer_id, employee_id, active })),
    customers: alive(master.customers).map(({ id, name }) => ({ id, name })),
    projects: alive(master.projects).map(({ id, code, name, customer_id, site_id, active }) => ({ id, code, name, customer_id, site_id, active })),
  };
  const body = JSON.stringify(data);
  let h = 0;
  for (let i = 0; i < body.length; i++) h = (h * 31 + body.charCodeAt(i)) | 0;
  const key = `${server}|${h}`;
  try { if (localStorage.getItem('enautec.placesHash') === key) return; } catch { /* geen opslag */ }
  placesBusy = true;
  try {
    const res = await fetch(`${server}/api/places`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body });
    if (res.ok) try { localStorage.setItem('enautec.placesHash', key); } catch { /* geen opslag */ }
  } catch { /* offline: volgende keer */ } finally { placesBusy = false; }
}

/** "Pauze?" (start nu of geen pauze) en "Pauze voorbij?" (stop nu) */
function renderPause(el, { q, ctx, answer }) {
  const min = ctx.me?.()?.pauseMin ?? 30;
  const hm = `${Math.floor(min / 60)}u${String(min % 60).padStart(2, '0')}`;
  const prev = q.answer;
  const start = q.kind === 'pauze';
  el.innerHTML = `<section class="card question">
    <h1>${start ? '☕ Pauze?' : '☕ Pauze voorbij?'}</h1>
    <p class="muted">${start ? `Het is middag. Je standaardpauze is ${hm}. Je pauze start op het moment dat je bevestigt; na ${hm} krijg je een melding om ze te stoppen.`
      : 'Je pauze stopt op het moment dat je bevestigt.'}</p>
    ${prev ? `<p class="pill ok">Al beantwoord om ${localTime(prev.at ?? q.answeredAt)}: ${prev.answer === 'nee' ? 'geen pauze' : start ? 'pauze gestart' : 'pauze gestopt'}.</p>` : ''}
    <div class="q-actions">
      ${start ? '<button class="primary big" data-a="ja">☕ Start pauze nu</button><button class="secondary" data-a="nee">Geen pauze vandaag (drukke dag)</button>'
        : '<button class="primary big" data-a="ja">✔ Pauze gedaan, verder werken</button>'}
    </div></section>`;
  el.querySelector('.q-actions').onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a) answer({ answer: a });
  };
}

const fmtKm = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);

/**
 * Vraagscherm. q = vraag van de server; ctx = app-context; answer(body) stuurt het antwoord.
 * Klanten worden voorgesteld in volgorde van afstand tot waar je toekwam.
 */
export function renderQuestion(el, { q, ctx, answer, planned = [] }) {
  if (q.kind === 'pauze' || q.kind === 'pauze_einde') return renderPause(el, { q, ctx, answer });
  const m = ctx.master();
  const customers = alive(m.customers).sort(byName);
  let projects = alive(m.projects).filter((p) => p.active !== false);
  const here = q.lat != null ? { lat: q.lat, lon: q.lon } : null;
  // dichtstbijzijnde zone per klant
  const near = new Map();
  for (const s of alive(m.sites)) {
    if (s.type !== 'klant' || !s.customer_id || s.lat == null || s.active === false) continue;
    const d = here ? distance(here, s) : Infinity;
    const cur = near.get(s.customer_id);
    if (!cur || d < cur.d) near.set(s.customer_id, { d, site: s });
  }
  const sug = [...near.entries()].map(([cid, v]) => ({ cust: customers.find((c) => c.id === cid), ...v })).filter((x) => x.cust)
    .sort((a, b) => a.d - b.d).slice(0, 6);
  const atSite = q.siteId && alive(m.sites).find((s) => s.id === q.siteId);
  const inAtelier = q.siteType === 'atelier';
  const prev = q.answer;
  let chosen = prev?.customerId ?? (atSite?.customer_id || sug[0]?.cust.id) ?? null;
  let chosenSite = prev?.siteId ?? (atSite?.customer_id === chosen ? atSite.id : near.get(chosen)?.site.id) ?? null;

  const projOptions = (cid, sel) => {
    const list = projects.filter((p) => (cid ? p.customer_id === cid : true));
    const plannedHere = list.filter((p) => planned.includes(p.id));
    const pick = sel ?? plannedHere[0]?.id ?? (list.length === 1 ? list[0].id : null);
    return `<option value="">— ${list.length ? 'kies een project' : 'nog geen project voor deze klant'} —</option>
      ${list.map((p) => `<option value="${esc(p.id)}" ${p.id === pick ? 'selected' : ''}>${esc(projectLabel(p, ctx.master()))}${planned.includes(p.id) ? ' (gepland)' : ''}</option>`).join('')}<option value="__new">+ Nieuw project…</option>`;
  };

  const title = q.kind === 'start' ? 'Aan het werk?' : 'Bij wie ben je?';
  const when = `${q.kind === 'start' ? 'Toegekomen' : 'Aangekomen'} om ${localTime(q.ts)}${inAtelier ? ' in het atelier' : atSite ? ` bij ${atSite.name}` : ''}.`;
  el.innerHTML = `<section class="card question">
    <h1>${title}</h1>
    <p class="muted">${esc(when)}${q.date !== today() ? ` (${esc(q.date)})` : ''}</p>
    ${prev ? `<p class="pill ok">Al beantwoord: ${prev.answer === 'nee' ? 'niet aan het werk' : prev.answer === 'geen' ? 'geen klant' : 'ja'}. Je kan je antwoord nog wijzigen.</p>` : ''}
    ${inAtelier ? `<label class="q-field"><span>Project (mag leeg)</span><select id="qProject">${projOptions(null, prev?.projectId)}</select></label>`
    : `<h2 class="q-sub">Bij welke klant?</h2>
      <div class="q-list">${sug.map(({ cust, d, site }) => `<label class="q-opt"><input type="radio" name="cust" value="${esc(cust.id)}" data-site="${esc(site.id)}" ${cust.id === chosen ? 'checked' : ''}>
        <span><b>${esc(cust.name)}</b><small>${esc(site.address || site.name)}</small></span>${d < Infinity ? `<em>${fmtKm(d)}</em>` : ''}</label>`).join('')
        || '<p class="muted">Geen klanten met een locatie in de buurt.</p>'}</div>
      <details class="q-more"><summary>Andere klant kiezen</summary>
        <select id="qOther"><option value="">— kies een klant —</option>${customers.map((c) => `<option value="${esc(c.id)}" ${c.id === chosen && !sug.some((s) => s.cust.id === c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      </details>
      <details class="q-more"><summary>+ Nieuwe klant aanmaken</summary>
        <div class="form-grid"><label><span>Naam klant</span><input id="qNewName" placeholder="bv. Bv Vandenberghe"></label>
          <label><span>Project (mag leeg)</span><input id="qNewProj" placeholder="bv. Renovatie keuken"></label></div>
        <p class="muted small">De app maakt meteen een locatie op de plek waar je nu bent, zodat je de volgende keer herkend wordt.</p>
      </details>
      <label class="q-field"><span>Project</span><select id="qProject">${projOptions(chosen, prev?.projectId)}</select></label>`}
    <label class="q-field"><span>Type werk</span><select id="qWorkType">${workTypeOptions(m, prev?.workType ?? projects.find((p) => p.id === prev?.projectId)?.work_type)}</select></label>
    <div class="err-slot"></div>
    <div class="q-actions">
      ${q.kind === 'start' ? '<button class="primary big" data-act="ja">✔ Ja, aan het werk</button><button class="secondary" data-act="nee">Nee, ik werk vandaag niet</button>'
      : '<button class="primary big" data-act="klant">✔ Opslaan</button><button class="secondary" data-act="geen">Geen klant (pauze of privé)</button>'}
    </div>
  </section>`;

  const projSel = el.querySelector('#qProject');
  const wtSel = el.querySelector('#qWorkType');
  projSel.onchange = async () => {
    if (projSel.value === '__new') {
      const p = await newProjectDialog(ctx, { customerId: inAtelier ? null : chosen, siteId: inAtelier ? null : chosenSite, workType: wtSel.value || null });
      projects = alive(ctx.master().projects).filter((x) => x.active !== false);
      projSel.innerHTML = projOptions(inAtelier ? null : chosen, p?.id ?? null);
      if (p) { projSel.value = p.id; if (p.work_type) wtSel.value = p.work_type; }
      return;
    }
    const p = projects.find((x) => x.id === projSel.value);
    if (p?.work_type && !wtSel.value) wtSel.value = p.work_type;
  };
  const setCustomer = (cid, siteId) => {
    chosen = cid || null;
    chosenSite = siteId ?? near.get(chosen)?.site.id ?? null;
    projSel.innerHTML = projOptions(chosen, null);
  };
  el.querySelectorAll('input[name=cust]').forEach((r) => r.onchange = () => { setCustomer(r.value, r.dataset.site); const o = el.querySelector('#qOther'); if (o) o.value = ''; });
  const other = el.querySelector('#qOther');
  if (other) other.onchange = () => { el.querySelectorAll('input[name=cust]').forEach((r) => { r.checked = false; }); setCustomer(other.value, null); };
  const err = (t) => { el.querySelector('.err-slot').innerHTML = t ? `<div class="error">${esc(t)}</div>` : ''; };

  /** Nieuwe klant (+ locatie op deze plek + project) in de stamgegevens */
  function createCustomer() {
    const name = el.querySelector('#qNewName')?.value.trim();
    if (!name) return null;
    const pname = el.querySelector('#qNewProj')?.value.trim();
    // nieuw vanuit de werknemer: door de beheerder te bevestigen (of samen te voegen met een bestaande klant)
    const by = ctx.me?.()?.username ?? null;
    const c = { id: uid(), name, pending: true, created_by: by, created_at: Date.now(), updated: Date.now() };
    const s = here ? { id: uid(), type: 'klant', name, customer_id: c.id, lat: Number(here.lat.toFixed(6)), lon: Number(here.lon.toFixed(6)), radius_m: 150, active: true, from_customer: true, geo: 'gsm', address: '', updated: Date.now() } : null;
    const p = pname ? { id: uid(), name: pname, customer_id: c.id, site_id: s?.id ?? null, work_type: el.querySelector('#qWorkType')?.value || null, active: true, pending: true, created_by: by, created_at: Date.now(), updated: Date.now() } : null;
    ctx.store.change(PATHS.master, EMPTY_MASTER(), (mm) => {
      (mm.customers ??= []).push(c);
      if (s) (mm.sites ??= []).push(s);
      if (p) (mm.projects ??= []).push(p);
    });
    return { customerId: c.id, siteId: s?.id ?? null, projectId: p?.id ?? null };
  }

  el.querySelector('.q-actions').onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    err('');
    if (act === 'nee') {
      const sure = await confirmDialog({ title: 'Ben je zeker?', text: 'Dan wordt de rest van vandaag niets geregistreerd en krijg je vandaag geen vragen meer.', ok: 'Ja, ik werk niet', cancel: 'Terug' });
      if (!sure) return;
      return answer({ answer: 'nee' });
    }
    if (act === 'geen') return answer({ answer: 'geen' });
    const made = createCustomer();
    const body = {
      answer: act, siteType: inAtelier ? 'atelier' : made || chosen ? 'klant' : q.siteType,
      customerId: made?.customerId ?? chosen, siteId: made?.siteId ?? (inAtelier ? q.siteId : chosenSite),
      projectId: made?.projectId ?? (projSel.value && projSel.value !== '__new' ? projSel.value : null), workType: wtSel.value || null,
    };
    if (!inAtelier && !body.customerId) return err('Kies een klant, of maak een nieuwe klant aan.');
    return answer(body);
  };
}
