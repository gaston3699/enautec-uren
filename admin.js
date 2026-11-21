// Beheer: dagoverzicht, stamgegevens, planning, export naar facturatie en instellingen.
import { PATHS, EMPTY_MASTER } from './store.js';
import { renderDay, dayState, emptyReg } from './day.js';
import { buildWorkbook } from './export.js';
import { today, shiftDate, fmtDate, fmtHours, localTime, isDate } from './time.js';
import { parseLatLon } from './geo.js';
import { esc, uid, alive, byName, projectLabel, toast, copyText, sha256 } from './ui.js';

const SITE_TYPES = { klant: 'Klant / werf', atelier: 'Atelier', leverancier: 'Leverancier', thuis: 'Thuisadres werknemer' };

// ---------- Stamgegevens: veldbeschrijvingen ----------
const ENTITIES = {
  employees: {
    title: 'Werknemers', newLabel: 'Nieuwe werknemer',
    help: 'De gebruikersnaam wordt ook gebruikt in OwnTracks. "Loxone-gebruiker" = exact dezelfde naam als in Loxone Config. Voeg daarna bij Locaties het thuisadres toe. Een <b>beheerder</b> is ook gewoon werknemer, maar kan via de knop "Beheer" bovenaan in de app ook het beheer openen.',
    fields: [
      { k: 'name', label: 'Naam', req: true },
      { k: 'username', label: 'Gebruikersnaam', req: true, help: 'kleine letters, bv. ruben' },
      { k: 'loxone_user', label: 'Loxone-gebruiker' },
      { k: 'is_admin', label: 'Beheerder', type: 'bool', def: false },
      { k: 'active', label: 'Actief', type: 'bool' },
    ],
  },
  customers: {
    title: 'Klanten', newLabel: 'Nieuwe klant',
    fields: [{ k: 'name', label: 'Naam', req: true }, { k: 'note', label: 'Opmerking' }],
  },
  sites: {
    title: 'Locaties', newLabel: 'Nieuwe locatie',
    help: 'Elke locatie krijgt een zone met een straal in meter. Coördinaten: rechtsklik op de plek in Google Maps → klik op de coördinaten (ze worden gekopieerd) en plak ze hier. Of sta ter plaatse en tik "Mijn locatie".',
    fields: [
      { k: 'type', label: 'Soort', type: 'select', req: true, options: () => Object.entries(SITE_TYPES).map(([id, name]) => ({ id, name })) },
      { k: 'name', label: 'Naam', req: true },
      { k: 'address', label: 'Adres' },
      { k: 'coords', label: 'Coördinaten', type: 'coords' },
      { k: 'radius_m', label: 'Straal (m)', type: 'number', def: 150 },
      { k: 'customer_id', label: 'Klant', type: 'select', options: (m) => alive(m.customers).sort(byName) },
      { k: 'employee_id', label: 'Werknemer (bij thuisadres)', type: 'select', options: (m) => alive(m.employees).map((e) => ({ id: e.username, name: e.name })).sort(byName) },
      { k: 'active', label: 'Actief', type: 'bool' },
    ],
  },
  projects: {
    title: 'Projecten', newLabel: 'Nieuw project',
    help: 'Koppel een project aan een klant en (optioneel) aan een werf. Heeft een klant maar één actief project, dan wordt het automatisch gekozen.',
    fields: [
      { k: 'code', label: 'Projectcode' },
      { k: 'name', label: 'Naam', req: true },
      { k: 'customer_id', label: 'Klant', type: 'select', options: (m) => alive(m.customers).sort(byName) },
      { k: 'site_id', label: 'Werf', type: 'select', options: (m) => alive(m.sites).filter((s) => s.type === 'klant').sort(byName) },
      { k: 'active', label: 'Actief', type: 'bool' },
    ],
  },
  articles: {
    title: 'Artikels', newLabel: 'Nieuw artikel',
    help: 'Artikellijst voor het materiaal. Werknemers kunnen ook vrije tekst ingeven.',
    fields: [
      { k: 'code', label: 'Artikelcode' },
      { k: 'name', label: 'Omschrijving', req: true },
      { k: 'unit', label: 'Eenheid', help: 'st, m, rol, …' },
      { k: 'active', label: 'Actief', type: 'bool' },
    ],
  },
};

/** Ja/nee-veld: niet ingevuld = standaardwaarde van het veld (meestal ja, bij "Beheerder" nee) */
const boolOf = (v, f) => {
  const val = v ?? f.def ?? true;
  return val !== false && val !== 0;
};

const fieldValue = (f, row, m) => {
  if (f.type === 'bool') return boolOf(row[f.k], f) ? '✔' : '—';
  if (f.type === 'coords') return row.lat != null ? `<a href="https://www.google.com/maps?q=${row.lat},${row.lon}" target="_blank" rel="noopener">kaart</a>` : '<span class="pill warn">ontbreekt</span>';
  if (f.type === 'select') return esc(f.options(m).find((o) => o.id === row[f.k])?.name ?? '');
  return esc(row[f.k] ?? '');
};

function fieldInput(f, row, m) {
  const v = row?.[f.k];
  if (f.type === 'bool') return `<input type="checkbox" name="${f.k}" ${boolOf(v, f) ? 'checked' : ''}>`;
  if (f.type === 'select') {
    return `<select name="${f.k}" ${f.req ? 'required' : ''}><option value="">—</option>${f.options(m).map((o) => `<option value="${esc(o.id)}" ${o.id === v ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
  }
  if (f.type === 'coords') {
    return `<span class="row"><input name="coords" placeholder="50.8631, 3.0694" value="${row?.lat != null ? `${row.lat}, ${row.lon}` : ''}"><button type="button" class="secondary" data-act="here">Mijn locatie</button></span>`;
  }
  return `<input name="${f.k}" ${f.type === 'number' ? 'type="number" step="any"' : ''} value="${esc(v ?? f.def ?? '')}" ${f.req ? 'required' : ''} placeholder="${esc(f.help ?? '')}">`;
}

export class Admin {
  constructor(ctx) {
    this.ctx = ctx;
    this.date = today();
    this.planDate = today();
  }

  // ---------- Server ----------
  /** Beheerverzoek aan de server (met beheersleutel of als werknemer met beheerrecht) */
  server(path, opts = {}) {
    return this.ctx.serverAdmin(path, opts);
  }

  /** Heeft dit toestel toegang tot het beheer op de server? */
  hasServer() {
    return !!(this.ctx.serverUrl() && this.ctx.adminHeaders());
  }

  render(el, tab = 'overzicht') {
    this.el = el;
    const tabs = { overzicht: 'Dagoverzicht', planning: 'Planning', employees: 'Werknemers', customers: 'Klanten', sites: 'Locaties', projects: 'Projecten', articles: 'Artikels', export: 'Export', instellingen: 'Instellingen' };
    el.innerHTML = `<nav class="tabs" aria-label="Beheer">${Object.entries(tabs).map(([k, v]) => `<a href="#beheer/${k}" class="${k === tab ? 'active' : ''}">${v}</a>`).join('')}</nav><div id="adminView"></div>`;
    const view = el.querySelector('#adminView');
    const fn = { overzicht: this.overview, planning: this.planning, export: this.exportView, instellingen: this.settings }[tab];
    Promise.resolve().then(() => (fn ? fn.call(this, view) : this.entity(view, tab)))
      .catch((e) => { view.innerHTML = `<div class="card error">${esc(e.message)}</div>`; });
  }

  // ---------- Stamgegevens ----------
  entity(view, name, edit = null) {
    const ent = ENTITIES[name];
    if (!ent) { view.innerHTML = '<p>Onbekend tabblad.</p>'; return; }
    const m = this.ctx.master();
    const rows = alive(m[name]).sort(byName);
    view.innerHTML = `
      <section class="card">
        <h2>${edit ? 'Wijzigen' : ent.newLabel}</h2>
        ${ent.help ? `<p class="muted">${ent.help}</p>` : ''}
        <form class="form-grid" id="entForm">
          ${ent.fields.map((f) => `<label><span>${f.label}</span>${fieldInput(f, edit, m)}</label>`).join('')}
          <div class="row"><button class="primary">${edit ? 'Opslaan' : 'Toevoegen'}</button>${edit ? '<button type="button" class="secondary" data-act="cancel">Annuleren</button>' : ''}</div>
        </form>
        <div id="entErr"></div>
        <div id="entExtra"></div>
      </section>
      <section class="card table-wrap">
        <h2>${ent.title} (${rows.length})</h2>
        <table><thead><tr>${ent.fields.map((f) => `<th>${f.label}</th>`).join('')}<th></th></tr></thead>
        <tbody>${rows.map((r) => `<tr>${ent.fields.map((f) => `<td>${fieldValue(f, r, m)}</td>`).join('')}
          <td class="actions">${name === 'employees' ? `<button class="link" data-link="${esc(r.username)}">Koppellink</button>` : ''}<button class="link" data-edit="${esc(r.id)}">Wijzig</button><button class="link danger" data-del="${esc(r.id)}">Verwijder</button></td></tr>`).join('')}</tbody></table>
      </section>`;

    const form = view.querySelector('#entForm');
    const err = (msg) => { view.querySelector('#entErr').innerHTML = msg ? `<div class="error">${esc(msg)}</div>` : ''; };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const rec = { ...(edit ?? { id: uid() }) };
      for (const f of ent.fields) {
        const inp = form.elements[f.k];
        if (f.type === 'bool') rec[f.k] = inp.checked;
        else if (f.type === 'coords') {
          const c = parseLatLon(inp.value);
          if (inp.value && !c) return err('Coördinaten niet herkend. Gebruik bv. 50.8631, 3.0694');
          rec.lat = c?.lat ?? null; rec.lon = c?.lon ?? null;
        } else if (f.type === 'number') rec[f.k] = inp.value === '' ? null : Number(inp.value);
        else rec[f.k] = inp.value.trim() || null;
      }
      if (name === 'employees') {
        rec.username = String(rec.username ?? '').toLowerCase();
        if (!/^[a-z0-9._-]{2,40}$/.test(rec.username)) return err('Gebruikersnaam: enkel kleine letters, cijfers, punt, - of _.');
        if (alive(m.employees).some((x) => x.username === rec.username && x.id !== rec.id)) return err('Deze gebruikersnaam bestaat al.');
        if (edit && edit.username !== rec.username) return err('De gebruikersnaam kan niet gewijzigd worden. Maak eventueel een nieuwe werknemer aan.');
        rec.id = rec.username;
      }
      if (name === 'sites' && rec.type === 'thuis' && !rec.employee_id) return err('Kies de werknemer bij een thuisadres.');
      if (name === 'employees') {
        const me = this.ctx.me();
        if (me?.username === rec.username && me.isAdmin && !rec.is_admin && !this.ctx.adminKey()
          && !confirm('Je neemt je eigen beheerrecht af. Daarna kan je het beheer op dit toestel niet meer openen. Doorgaan?')) return;
        // beheerrecht wordt door de server bewaakt: eerst daar bewaren
        if (this.hasServer()) {
          try {
            await this.server(`/api/admin/employees/${encodeURIComponent(rec.username)}`, {
              method: 'PUT', body: JSON.stringify({ name: rec.name, loxone_user: rec.loxone_user, is_admin: !!rec.is_admin }),
            });
          } catch (e2) {
            if (rec.is_admin !== boolOf(edit?.is_admin, { def: false })) return err(`Beheerrecht niet gewijzigd: ${e2.message}`);
            toast(`Bewaard, maar niet doorgegeven aan de server: ${e2.message}`, 'err');
          }
        } else if (rec.is_admin) {
          return err('Beheerders aanduiden kan enkel als de server bereikbaar is.');
        }
      }
      rec.updated = Date.now();
      this.ctx.store.change(PATHS.master, EMPTY_MASTER(), (mm) => {
        mm[name] = (mm[name] ?? []).filter((x) => x.id !== rec.id);
        mm[name].push(rec);
      });
      toast('Bewaard', 'ok');
      this.entity(view, name);
    };
    form.querySelector('[data-act=here]')?.addEventListener('click', () => {
      if (!navigator.geolocation) return err('Locatie niet beschikbaar op dit toestel.');
      navigator.geolocation.getCurrentPosition(
        (p) => { form.elements.coords.value = `${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`; toast(`Nauwkeurigheid ±${Math.round(p.coords.accuracy)} m`); },
        (e2) => err(`Locatie ophalen mislukt: ${e2.message}`),
        { enableHighAccuracy: true, timeout: 15000 },
      );
    });
    view.querySelector('[data-act=cancel]')?.addEventListener('click', () => this.entity(view, name));
    view.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => { this.entity(view, name, rows.find((r) => r.id === b.dataset.edit)); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    view.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      if (!confirm('Verwijderen? Tip: vink liever "Actief" uit, dan blijft de geschiedenis kloppen.')) return;
      const id = b.dataset.del;
      this.ctx.store.change(PATHS.master, EMPTY_MASTER(), (mm) => {
        const r = mm[name].find((x) => x.id === id);
        if (r) Object.assign(r, { deleted: true, updated: Date.now() });
      });
      if (name === 'employees' && this.hasServer()) {
        try { await this.server(`/api/admin/employees/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch { /* server niet bereikbaar */ }
      }
      this.entity(view, name);
    });
    view.querySelectorAll('[data-link]').forEach((b) => b.onclick = () => this.showLink(view.querySelector('#entExtra'), b.dataset.link));
    if (name === 'employees' && !edit) this.syncAdminFlags(view);
  }

  /** Beheerrecht staat op de server: neem het over in de lijst als het verschilt */
  async syncAdminFlags(view) {
    if (!this.hasServer()) return;
    let list;
    try { list = await this.server('/api/admin/employees'); } catch { return; }
    const srv = new Map(list.map((e) => [e.username, !!e.is_admin]));
    const differ = alive(this.ctx.master().employees).filter((e) => srv.has(e.username) && srv.get(e.username) !== !!e.is_admin);
    if (!differ.length) return;
    this.ctx.store.change(PATHS.master, EMPTY_MASTER(), (mm) => {
      for (const e of mm.employees) if (srv.has(e.username) && srv.get(e.username) !== !!e.is_admin) Object.assign(e, { is_admin: srv.get(e.username), updated: Date.now() });
    });
    if (view.isConnected) this.entity(view, 'employees');
  }

  async showLink(box, username) {
    box.innerHTML = '<p class="muted">Koppellink ophalen…</p>';
    try {
      const all = await this.server('/api/admin/employees');
      let e = all.find((x) => x.username === username);
      if (!e) {
        const rec = alive(this.ctx.master().employees).find((x) => x.username === username);
        e = await this.server(`/api/admin/employees/${encodeURIComponent(username)}`, { method: 'PUT', body: JSON.stringify({ name: rec?.name, loxone_user: rec?.loxone_user }) });
      }
      const link = `${location.origin}${location.pathname}#koppel=${encodeURIComponent(username)}.${e.token}&s=${encodeURIComponent(this.ctx.serverUrl())}`;
      box.innerHTML = `<div class="callout">
        <h3>Koppellink voor ${esc(e.name)}</h3>
        <p>Stuur deze link naar de werknemer (bv. via WhatsApp) en laat hem openen op zijn gsm. De app onthoudt dan wie hij is en toont de knop om OwnTracks in te stellen.</p>
        <p><code>${esc(link)}</code></p>
        <div class="row"><button class="secondary" data-act="copy">Kopiëren</button>${navigator.share ? '<button class="secondary" data-act="share">Delen…</button>' : ''}<button class="link danger" data-act="renew">Nieuwe link (oude wordt ongeldig)</button></div>
      </div>`;
      box.querySelector('[data-act=copy]').onclick = () => copyText(link);
      box.querySelector('[data-act=share]')?.addEventListener('click', () => navigator.share({ title: 'Enautec uren', text: `Koppellink urenregistratie voor ${e.name}`, url: link }).catch(() => {}));
      box.querySelector('[data-act=renew]').onclick = async () => {
        if (!confirm('De oude link en het OwnTracks-wachtwoord van deze werknemer worden ongeldig. Doorgaan?')) return;
        await this.server(`/api/admin/employees/${encodeURIComponent(username)}/token`, { method: 'POST' });
        this.showLink(box, username);
      };
    } catch (err) {
      box.innerHTML = `<div class="error">${esc(err.message)}</div>`;
    }
  }

  // ---------- Dagoverzicht ----------
  async overview(view) {
    const date = this.date;
    const m = this.ctx.master();
    const emps = alive(m.employees).filter((e) => e.active !== false).sort(byName);
    view.innerHTML = `<section class="card"><div class="datebar">
        <button class="icon" data-act="prev" aria-label="Vorige dag">‹</button>
        <div><b>${esc(fmtDate(date))}</b><input type="date" id="ovDate" value="${date}"></div>
        <button class="icon" data-act="next" aria-label="Volgende dag">›</button></div></section>
      <section class="card table-wrap" id="ovTable"><p class="muted">Laden…</p></section>
      <div id="ovDay"></div><div id="ovBadges"></div>`;
    view.querySelector('[data-act=prev]').onclick = () => { this.date = shiftDate(date, -1); this.overview(view); };
    view.querySelector('[data-act=next]').onclick = () => { this.date = shiftDate(date, 1); this.overview(view); };
    view.querySelector('#ovDate').onchange = (e) => { if (isDate(e.target.value)) { this.date = e.target.value; this.overview(view); } };

    const month = date.slice(0, 7);
    await this.ctx.store.sync(emps.map((e) => PATHS.reg(month, e.username)));
    let raws = {};
    let rawErr = '';
    if (this.hasServer()) {
      try { raws = await this.server(`/api/admin/raw?date=${date}`); } catch (e) { rawErr = e.message; }
    } else rawErr = 'Geen server ingesteld: enkel ingegeven/bevestigde uren.';

    const rows = emps.map((e) => ({ e, st: dayState(this.ctx, e.username, date, raws[e.username]) }));
    view.querySelector('#ovTable').innerHTML = `
      ${rawErr ? `<p class="muted">⚠ ${esc(rawErr)}</p>` : ''}
      <table><thead><tr><th>Werknemer</th><th>Status</th><th>Van – tot</th><th>Arbeidstijd</th><th>Km</th><th>Materiaal</th><th>Aandachtspunten</th></tr></thead><tbody>
      ${rows.map(({ e, st }) => `<tr class="click" data-emp="${esc(e.username)}">
        <td>${esc(e.name)}</td>
        <td>${st.status === 'bevestigd' ? '<span class="pill ok">Bevestigd</span>' : st.segments.length ? '<span class="pill warn">Open</span>' : '<span class="muted">—</span>'}</td>
        <td>${st.summary.start ? `${localTime(st.summary.start)} – ${localTime(st.summary.end)}` : ''}</td>
        <td>${st.segments.length ? fmtHours(st.summary.workMinutes) : ''}</td>
        <td>${st.segments.length ? st.summary.km : ''}</td>
        <td>${st.material.length || ''}</td>
        <td class="muted">${st.status !== 'bevestigd' && st.segments.length ? esc(st.summary.warnings.join(' ')) : ''}</td></tr>`).join('')}
      </tbody></table>`;
    view.querySelectorAll('[data-emp]').forEach((tr) => tr.onclick = () => {
      const u = tr.dataset.emp;
      const box = view.querySelector('#ovDay');
      box.innerHTML = `<h2 class="section-title">${esc(alive(m.employees).find((x) => x.username === u)?.name ?? u)} · ${esc(fmtDate(date))}</h2><div></div>`;
      renderDay(box.lastElementChild, { ctx: this.ctx, username: u, date, raw: raws[u], asAdmin: true });
      box.scrollIntoView({ behavior: 'smooth' });
    });

    if (this.hasServer()) {
      try {
        const unknown = await this.server('/api/admin/badges/unknown');
        if (unknown.length) {
          view.querySelector('#ovBadges').innerHTML = `<section class="card"><h2>Onbekende badges</h2>
            <p class="muted">Deze tekst kwam van Loxone, maar hoort bij geen enkele werknemer. Vul bij Werknemers het veld "Loxone-gebruiker" aan.</p>
            <table>${unknown.slice(0, 15).map((u) => `<tr><td>${new Date(u.ts).toLocaleString('nl-BE')}</td><td><code>${esc(u.raw)}</code></td></tr>`).join('')}</table></section>`;
        }
      } catch { /* niet erg */ }
    }
  }

  // ---------- Planning ----------
  async planning(view) {
    const date = this.planDate;
    const m = this.ctx.master();
    const emps = alive(m.employees).filter((e) => e.active !== false).sort(byName);
    const projects = alive(m.projects).filter((p) => p.active !== false);
    const items = alive(this.ctx.planning().items).filter((p) => p.date === date);
    view.innerHTML = `<section class="card">
        <div class="datebar"><button class="icon" data-act="prev" aria-label="Vorige dag">‹</button>
        <div><b>${esc(fmtDate(date))}</b><input type="date" id="plDate" value="${date}"></div>
        <button class="icon" data-act="next" aria-label="Volgende dag">›</button></div>
        <p class="muted">De planning helpt het juiste project te kiezen als een klant meerdere open projecten heeft. Werknemers zien hun planning in de app, met een knop voor de route.</p>
        <form class="form-grid" id="plForm">
          <label><span>Werknemer</span><select name="username" required><option value="">—</option>${emps.map((e) => `<option value="${esc(e.username)}">${esc(e.name)}</option>`).join('')}</select></label>
          <label><span>Project</span><select name="projectId" required><option value="">—</option>${projects.map((p) => `<option value="${esc(p.id)}">${esc(projectLabel(p, m))}</option>`).join('')}</select></label>
          <label><span>Opmerking</span><input name="note" placeholder="bv. sleutel bij buren"></label>
          <div><button class="primary">Inplannen</button></div>
        </form>
      </section>
      <section class="card table-wrap"><table><thead><tr><th>Werknemer</th><th>Project</th><th>Opmerking</th><th></th></tr></thead><tbody>
        ${items.map((it) => `<tr><td>${esc(alive(m.employees).find((e) => e.username === it.username)?.name ?? it.username)}</td>
          <td>${esc(projectLabel(m.projects.find((p) => p.id === it.projectId), m))}</td><td>${esc(it.note ?? '')}</td>
          <td><button class="link danger" data-del="${esc(it.id)}">Verwijder</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Niets gepland op deze dag.</td></tr>'}
      </tbody></table>
      <button class="secondary" data-act="copy-prev">Planning van vorige werkdag kopiëren</button></section>`;
    view.querySelector('[data-act=prev]').onclick = () => { this.planDate = shiftDate(date, -1); this.planning(view); };
    view.querySelector('[data-act=next]').onclick = () => { this.planDate = shiftDate(date, 1); this.planning(view); };
    view.querySelector('#plDate').onchange = (e) => { if (isDate(e.target.value)) { this.planDate = e.target.value; this.planning(view); } };
    view.querySelector('#plForm').onsubmit = (e) => {
      e.preventDefault();
      const f = e.target.elements;
      this.ctx.store.change(PATHS.planning, { items: [] }, (pl) => {
        pl.items.push({ id: uid(), date, username: f.username.value, projectId: f.projectId.value, note: f.note.value.trim(), updated: Date.now() });
      });
      this.planning(view);
    };
    view.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => {
      this.ctx.store.change(PATHS.planning, { items: [] }, (pl) => {
        const it = pl.items.find((x) => x.id === b.dataset.del);
        if (it) Object.assign(it, { deleted: true, updated: Date.now() });
      });
      this.planning(view);
    });
    view.querySelector('[data-act=copy-prev]').onclick = () => {
      let d = shiftDate(date, -1);
      const all = alive(this.ctx.planning().items);
      for (let i = 0; i < 7 && !all.some((x) => x.date === d); i++) d = shiftDate(d, -1);
      const src = all.filter((x) => x.date === d);
      if (!src.length) return toast('Geen planning gevonden in de vorige 7 dagen.');
      this.ctx.store.change(PATHS.planning, { items: [] }, (pl) => {
        for (const s of src) {
          if (!pl.items.some((x) => !x.deleted && x.date === date && x.username === s.username && x.projectId === s.projectId)) {
            pl.items.push({ ...s, id: uid(), date, updated: Date.now() });
          }
        }
      });
      toast(`Planning van ${fmtDate(d)} gekopieerd.`, 'ok');
      this.planning(view);
    };
  }

  // ---------- Export naar facturatie ----------
  async exportView(view) {
    const m = this.ctx.master();
    const first = `${today().slice(0, 7)}-01`;
    const folder = m.settings?.billingFolder || 'Facturatie/Uren Enautec';
    const google = this.ctx.storage === 'google';
    const billName = google ? 'Google Drive facturatie' : this.ctx.storage === 'test' ? 'testopslag facturatie' : 'OneDrive facturatie';
    let accB = this.ctx.billingDrive()?.account;
    if (google) {
      try {
        const gs = await this.ctx.googleStatus();
        accB = gs.B ? { name: gs.B.email ?? 'Google-account', username: gs.B.email ?? '' } : null;
      } catch { accB = null; }
    }
    view.innerHTML = `<section class="card">
      <h2>Export naar de facturatie</h2>
      <p class="muted">Enkel bevestigde dagen. Het Excel-bestand bevat: per project (uren, km, materiaal), materiaal, uren in detail, per werknemer per dag (voor het loon) en de dagen die nog niet bevestigd zijn.</p>
      <div class="form-grid">
        <label><span>Van</span><input type="date" id="exFrom" value="${first}"></label>
        <label><span>Tot</span><input type="date" id="exTo" value="${today()}"></label>
      </div>
      <h3>${esc(billName[0].toUpperCase() + billName.slice(1))}</h3>
      ${accB ? `<p>Verbonden met <b>${esc(accB.name || accB.username)}</b> · map <code>${esc(folder)}</code></p>`
        : `<p class="muted">Nog niet verbonden. ${google ? 'Koppel het Google-account van de facturatie. Werknemers krijgen daar nooit toegang toe.' : 'Meld je aan met het account van de facturatie. Dat gebeurt enkel op dit toestel.'}</p>`}
      <div class="row">
        ${accB ? `<button class="primary" data-act="export">Exporteren naar ${esc(billName)}</button><button class="link" data-act="logoutB">${google ? 'Ontkoppelen' : 'Afmelden facturatie'}</button>`
          : `<button class="primary" data-act="loginB">Verbinden met ${esc(billName)}</button>`}
        <button class="secondary" data-act="download">Enkel downloaden</button>
      </div>
      <div id="exOut"></div></section>`;
    const out = view.querySelector('#exOut');
    const make = async () => {
      const from = view.querySelector('#exFrom').value;
      const to = view.querySelector('#exTo').value;
      if (!isDate(from) || !isDate(to) || from > to) throw new Error('Kies een geldige periode.');
      out.innerHTML = `<p class="muted">Gegevens ophalen uit ${esc(this.ctx.storeName)}…</p>`;
      const regs = await this.loadRegs(from, to);
      out.innerHTML = '<p class="muted">Excel maken…</p>';
      const wb = await buildWorkbook(this.ctx.master(), regs, from, to);
      return { ...wb, name: `Uren Enautec ${from} tot ${to}.xlsx` };
    };
    view.querySelector('[data-act=loginB]')?.addEventListener('click', () => Promise.resolve(this.ctx.loginBilling()).catch((e) => { out.innerHTML = `<div class="error">${esc(e.message)}</div>`; }));
    view.querySelector('[data-act=logoutB]')?.addEventListener('click', async () => {
      if (!confirm(`${billName} ontkoppelen?`)) return;
      try { if (google) await this.ctx.disconnectGoogle('B'); else this.ctx.logoutBilling(); } catch (e) { toast(e.message, 'err'); }
      this.exportView(view);
    });
    view.querySelector('[data-act=download]').onclick = async () => {
      try {
        const r = await make();
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(r.blob), download: r.name });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        out.innerHTML = `<p class="ok-text">Gedownload: ${esc(r.name)} (${r.counts.rows} urenregels, ${r.counts.mats} materiaalregels).</p>`;
      } catch (e) { out.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
    };
    view.querySelector('[data-act=export]')?.addEventListener('click', async () => {
      try {
        const r = await make();
        out.innerHTML = `<p class="muted">Uploaden naar ${esc(billName)}…</p>`;
        const res = await this.ctx.billingDrive().upload(`${folder}/${r.name}`, r.blob, r.blob.type);
        out.innerHTML = `<p class="ok-text">✔ Bewaard in ${esc(billName)}: <b>${esc(folder)}/${esc(r.name)}</b>
          (${r.counts.projects} projecten, ${r.counts.rows} urenregels, ${r.counts.mats} materiaalregels${r.counts.open ? `, <b>${r.counts.open} dag(en) nog niet bevestigd</b>` : ''}).</p>
          ${res.webUrl ? `<p><a href="${esc(res.webUrl)}" target="_blank" rel="noopener">Openen</a></p>` : ''}`;
      } catch (e) {
        if (e.needsLogin) { out.innerHTML = `<div class="error">De koppeling met ${esc(billName)} is verlopen of ontbreekt. Verbind opnieuw.</div>`; return; }
        out.innerHTML = `<div class="error">${esc(e.message)}</div>`;
      }
    });
  }

  /** Alle registratiebestanden van de maanden in een periode ophalen */
  async loadRegs(from, to) {
    const months = [];
    for (let mth = from.slice(0, 7); mth <= to.slice(0, 7);) {
      months.push(mth);
      const [y, mm] = mth.split('-').map(Number);
      mth = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, '0')}`;
    }
    const regs = [];
    for (const mth of months) {
      let names = [];
      try { names = await this.ctx.store.list(PATHS.regFolder(mth)); } catch (e) { if (!e.needsLogin) throw e; }
      const users = new Set([...names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)), ...alive(this.ctx.master().employees).map((e) => e.username)]);
      const paths = [...users].map((u) => PATHS.reg(mth, u));
      await this.ctx.store.sync(paths);
      for (const u of users) {
        const r = this.ctx.store.get(PATHS.reg(mth, u), null);
        if (r) regs.push(r);
      }
    }
    return regs;
  }

  // ---------- Instellingen ----------
  async settings(view) {
    const m = this.ctx.master();
    const s = m.settings ?? {};
    const rules = s.rules ?? {};
    const google = this.ctx.storage === 'google';
    let gs = null;
    let gsErr = '';
    if (google) { try { gs = await this.ctx.googleStatus(); } catch (e) { gsErr = e.message; } }
    const since = (c) => (c?.connectedAt ? ` · sinds ${new Date(c.connectedAt).toLocaleDateString('nl-BE')}` : '');
    view.innerHTML = `
    ${google ? `<section class="card">
      <h2>Google Drive (gegevens)</h2>
      <p class="muted">Hier staan de uren, planning, het materiaal en de stamgegevens, in de map <code>Enautec Uren</code>. De verzamelserver bewaart de koppeling; werknemers melden zich nooit aan bij Google.</p>
      ${gsErr ? `<div class="error">${esc(gsErr)}</div>` : ''}
      ${gs && !gs.configured ? '<div class="notice">Google is nog niet ingesteld op de server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).</div>' : ''}
      ${gs?.A ? `<p>✔ Gekoppeld met <b>${esc(gs.A.email ?? 'Google-account')}</b>${since(gs.A)}</p>` : gs ? '<p class="warn-text">Nog niet gekoppeld.</p>' : ''}
      <div class="row">${gs?.configured ? `<button class="primary" data-act="gconnect">${gs.A ? 'Opnieuw koppelen' : 'Koppelen met Google Drive'}</button>` : ''}
        ${gs?.A ? '<button class="link danger" data-act="gdisconnect">Ontkoppelen</button>' : ''}</div>
    </section>` : ''}
    <section class="card">
      <h2>Verzamelserver (Cloudflare)</h2>
      <p class="muted">De server ontvangt de gsm-locaties (OwnTracks) en de badges (Loxone)${google ? ' en bewaart de koppeling met Google Drive' : ''}. Het adres en de beheersleutel worden enkel op dit toestel bewaard; werknemers krijgen het adres via hun koppellink.</p>
      <form class="form-grid" id="srvForm">
        <label><span>Adres van de server</span><input name="serverUrl" placeholder="https://enautec-uren.…workers.dev" value="${esc(this.ctx.serverUrl())}"></label>
        <label><span>Beheersleutel (ADMIN_KEY)</span><input name="adminKey" type="password" autocomplete="off" value="${esc(this.ctx.adminKey())}"></label>
        <div class="row"><button class="primary">Opslaan</button><button type="button" class="secondary" data-act="test">Verbinding testen</button></div>
      </form><div id="srvOut"></div>
    </section>
    <section class="card">
      <h2>Regels</h2>
      <form class="form-grid" id="ruleForm">
        <label><span>Minimale tijd op een locatie (min)</span><input type="number" name="minStayMin" value="${rules.minStayMin ?? 10}" min="3" max="60"></label>
        <label><span>Stilstand op onbekende plek telt vanaf (min)</span><input type="number" name="unknownMinStayMin" value="${rules.unknownMinStayMin ?? 20}" min="5" max="120"></label>
        <label class="check"><input type="checkbox" name="homeTravelIsWork" ${rules.homeTravelIsWork ? 'checked' : ''}> Woon-werkverkeer telt als arbeidstijd</label>
        <label><span>Map voor de export (facturatie)</span><input name="billingFolder" value="${esc(s.billingFolder ?? 'Facturatie/Uren Enautec')}"></label>
        <div><button class="primary">Opslaan</button></div>
      </form>
    </section>
    <section class="card">
      <h2>Beheer-pincode</h2>
      <p class="muted">Beschermt het beheer in de app op een toestel waar de beheersleutel staat.${google ? '' : ' Let op: iedereen met het gedeelde Microsoft-account kan de bestanden in OneDrive wel openen.'}</p>
      <form class="row" id="pinForm"><input name="pin" type="password" inputmode="numeric" placeholder="Nieuwe pincode (min. 4 cijfers)" autocomplete="new-password"><button class="secondary">Wijzigen</button></form>
    </section>
    <section class="card">
      <h2>Loxone</h2>
      <p>Virtuele uitgang in Loxone Config:</p>
      <ul><li>Adres: <code>${esc(this.ctx.serverUrl() || 'https://enautec-uren.…workers.dev')}</code></li>
      <li>Opdracht bij AAN: <code>/api/loxone/badge?key=&lt;LOXONE_KEY&gt;&amp;user=&lt;v&gt;</code></li></ul>
      <p class="muted">Zie HANDLEIDING.md voor de volledige uitleg.</p>
    </section>`;
    const out = view.querySelector('#srvOut');
    view.querySelector('#srvForm').onsubmit = (e) => {
      e.preventDefault();
      const f = e.target.elements;
      const url = f.serverUrl.value.trim().replace(/\/+$/, '');
      if (url && !/^https?:\/\//.test(url)) { out.innerHTML = '<div class="error">Het adres moet met https:// beginnen.</div>'; return; }
      this.ctx.setAdminKey(f.adminKey.value.trim());
      this.ctx.setServerUrl(url);
      toast('Bewaard op dit toestel', 'ok');
    };
    view.querySelector('[data-act=gconnect]')?.addEventListener('click', () => this.ctx.connectGoogle('A').catch((e) => toast(e.message, 'err')));
    view.querySelector('[data-act=gdisconnect]')?.addEventListener('click', async () => {
      if (!confirm('Google Drive ontkoppelen? Niemand kan dan nog uren bewaren tot je opnieuw koppelt. De bestanden in Google Drive blijven bestaan.')) return;
      try { await this.ctx.disconnectGoogle('A'); toast('Ontkoppeld'); } catch (e) { toast(e.message, 'err'); }
      this.settings(view);
    });
    view.querySelector('[data-act=test]').onclick = async () => {
      out.innerHTML = '<p class="muted">Testen…</p>';
      try {
        const emps = await this.server('/api/admin/employees');
        out.innerHTML = `<p class="ok-text">✔ Verbonden. ${emps.length} werknemer(s) gekend op de server.</p>`;
        // werknemers die nog niet op de server staan, doorsturen
        const missing = alive(this.ctx.master().employees).filter((e) => !emps.some((x) => x.username === e.username));
        for (const e of missing) await this.server(`/api/admin/employees/${encodeURIComponent(e.username)}`, { method: 'PUT', body: JSON.stringify({ name: e.name, loxone_user: e.loxone_user }) });
        if (missing.length) out.innerHTML += `<p class="muted">${missing.length} werknemer(s) toegevoegd op de server.</p>`;
      } catch (e) { out.innerHTML = `<div class="error">${esc(e.message)}</div>`; }
    };
    view.querySelector('#ruleForm').onsubmit = (e) => {
      e.preventDefault();
      const f = e.target.elements;
      this.ctx.store.change(PATHS.master, EMPTY_MASTER(), (mm) => {
        mm.settings = {
          ...mm.settings,
          billingFolder: f.billingFolder.value.trim().replace(/^\/+|\/+$/g, '') || 'Facturatie/Uren Enautec',
          rules: { ...(mm.settings?.rules ?? {}), minStayMin: Number(f.minStayMin.value), unknownMinStayMin: Number(f.unknownMinStayMin.value), homeTravelIsWork: f.homeTravelIsWork.checked },
          updated: Date.now(),
        };
      });
      toast('Regels bewaard', 'ok');
    };
    view.querySelector('#pinForm').onsubmit = async (e) => {
      e.preventDefault();
      const pin = e.target.elements.pin.value;
      if (!/^\d{4,8}$/.test(pin)) return toast('Gebruik 4 tot 8 cijfers.', 'err');
      const hash = await sha256(`enautec:${pin}`);
      this.ctx.store.change(PATHS.master, EMPTY_MASTER(), (mm) => { mm.settings = { ...mm.settings, adminPinHash: hash, updated: Date.now() }; });
      e.target.reset();
      toast('Pincode gewijzigd', 'ok');
    };
  }
}

export { emptyReg };
