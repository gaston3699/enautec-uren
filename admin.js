// Beheer: dagoverzicht, stamgegevens, planning, export naar facturatie en instellingen.
import { PATHS, EMPTY_MASTER } from './store.js';
import { renderDay, dayState, emptyReg, manualChanges } from './day.js';
import { buildWorkbook } from './export.js';
import { today, shiftDate, fmtDate, fmtHours, localTime, isDate, localDate as localDateOf } from './time.js';
import { parseLatLon, distance } from './geo.js';
import { geocode, addressLine, splitAddress } from './geocode.js';
import { readTable } from './xlsx.js';
import { workTypesOf, DEFAULT_WORK_TYPES, similarTo, workTypeOptions } from './projects.js';
import { renderTodo, todoToConfirm } from './todo.js';
import { esc, uid, alive, byName, projectLabel, toast, copyText, sha256 } from './ui.js';

const SITE_TYPES = { klant: 'Klant / werf', atelier: 'Atelier', leverancier: 'Leverancier', thuis: 'Thuisadres werknemer' };

// ---------- Stamgegevens: veldbeschrijvingen ----------
const ENTITIES = {
  employees: {
    title: 'Werknemers', newLabel: 'Nieuwe werknemer',
    help: 'Iedereen opent dezelfde link (de app) en meldt zich aan met <b>gebruikersnaam</b> en <b>wachtwoord</b>. Geef bij een nieuwe werknemer een startwachtwoord (min. 8 tekens); de werknemer kan het zelf wijzigen bij Meer. "Nieuw wachtwoord" leeg laten = ongewijzigd; een nieuw wachtwoord meldt die werknemer overal af. "Loxone-gebruiker" = exact dezelfde naam als in Loxone Config. Een <b>beheerder</b> is ook gewoon werknemer, maar kan via de knop "Beheer" bovenaan ook het beheer openen.',
    fields: [
      { k: 'name', label: 'Naam', req: true },
      { k: 'username', label: 'Gebruikersnaam', req: true, help: 'kleine letters, bv. ruben' },
      { k: 'password', label: 'Nieuw wachtwoord', type: 'password', noList: true, help: 'leeg = ongewijzigd (vergeten? stel hier een nieuw in)' },
      { k: 'loxone_user', label: 'Loxone-gebruiker' },
      { k: 'start_date', label: 'Uren tellen vanaf', type: 'date', noList: true, help: 'leeg = eerste ingegeven dag' },
      { k: 'is_admin', label: 'Beheerder', type: 'bool', def: false },
      { k: 'has_password', label: 'Wachtwoord', type: 'bool', def: false, noForm: true },
      { k: 'active', label: 'Actief', type: 'bool' },
    ],
  },
  customers: {
    title: 'Klanten', newLabel: 'Nieuwe klant',
    help: 'Met een adres maakt de app zelf een locatie (zone) voor deze klant en zoekt de coördinaten op. Een volledige lijst inlezen kan onderaan met "Klanten importeren".',
    fields: [
      { k: 'name', label: 'Naam', req: true },
      { k: 'street', label: 'Adres', help: 'straat en nummer' },
      { k: 'postcode', label: 'Postcode' },
      { k: 'city', label: 'Gemeente' },
      { k: 'phone', label: 'Telefoon', noList: true },
      { k: 'vat', label: 'BTW-nummer' },
      { k: 'note', label: 'Opmerking', noList: true },
    ],
  },
  sites: {
    title: 'Locaties', newLabel: 'Nieuwe locatie',
    help: 'Elke locatie krijgt een zone met een straal in meter. Coördinaten leeg laten = de app zoekt ze zelf op bij het adres (of tik "Zoek bij adres"). Klopt het niet? Rechtsklik op de plek in Google Maps → klik op de coördinaten (ze worden gekopieerd) en plak ze hier, of sta ter plaatse en tik "Mijn locatie". Klanten met een adres krijgen automatisch een locatie.',
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
      { k: 'work_type', label: 'Type werk', type: 'select', options: (m) => workTypesOf(m) },
      { k: 'active', label: 'Actief', type: 'bool' },
    ],
  },
  workTypes: {
    title: 'Soorten werk', newLabel: 'Nieuw soort werk',
    help: 'Werknemers kiezen bij elk tijdsblok welk soort werk ze deden (bv. elektrische werken, elektrisch tekenen, software). Dat komt mee in de export.',
    fields: [{ k: 'name', label: 'Naam', req: true }, { k: 'active', label: 'Actief', type: 'bool' }],
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
  if (f.type === 'coords') {
    if (row.lat == null) return `<span class="pill warn">${row.geo === 'niet gevonden' ? 'adres niet gevonden' : 'ontbreekt'}</span>`;
    return `<a href="https://www.google.com/maps?q=${row.lat},${row.lon}" target="_blank" rel="noopener">kaart</a>${row.geo === 'straat' ? ' <span class="pill warn" title="Enkel de straat werd gevonden, niet het huisnummer">controleer</span>' : ''}${row.overlap && row.active === false ? ` <span class="pill warn" title="Zelfde plaats als ${esc(row.overlap)}: deze zone staat uit">= ${esc(row.overlap)}</span>` : ''}`;
  }
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
    return `<span class="row"><input name="coords" placeholder="leeg = zelf opzoeken bij het adres" value="${row?.lat != null ? `${row.lat}, ${row.lon}` : ''}"><button type="button" class="secondary" data-act="lookup">Zoek bij adres</button><button type="button" class="secondary" data-act="here">Mijn locatie</button></span>`;
  }
  if (f.type === 'password') {
    // zichtbaar voor de beheerder, zodat die het meteen kan doorgeven
    return `<span class="row"><input name="${f.k}" type="text" autocomplete="off" autocapitalize="none" spellcheck="false" minlength="8" placeholder="${esc(f.help ?? '')}"><button type="button" class="secondary" data-act="genpw">Genereer</button></span>`;
  }
  return `<input name="${f.k}" ${f.type === 'number' ? 'type="number" step="any"' : f.type === 'date' ? 'type="date"' : ''} value="${esc(v ?? f.def ?? '')}" ${f.req ? 'required' : ''} placeholder="${esc(f.help ?? '')}">`;
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
    this.tab = tab;
    if (tab !== 'overzicht') clearInterval(this.ovTimer);
    const n = this.pendingCount();
    const nt = todoToConfirm(this.ctx);
    const tabs = { overzicht: 'Dagoverzicht', nieuw: `Te bevestigen${n ? ` <span class="tab-badge">${n}</span>` : ''}`, todo: `ToDo${nt ? ` <span class="tab-badge">${nt}</span>` : ''}`, planning: 'Planning', employees: 'Werknemers', toestellen: 'Toestellen', customers: 'Klanten', sites: 'Locaties', projects: 'Projecten', workTypes: 'Soorten werk', articles: 'Artikels', export: 'Export', instellingen: 'Instellingen' };
    el.innerHTML = `<nav class="tabs" aria-label="Beheer">${Object.entries(tabs).map(([k, v]) => `<a href="#beheer/${k}" class="${k === tab ? 'active' : ''}">${v}</a>`).join('')}</nav><div id="adminView"></div>`;
    const view = el.querySelector('#adminView');
    const fn = { overzicht: this.overview, nieuw: this.review, todo: (v) => { this.ctx.store.sync([PATHS.todos]).catch(() => {}).then(() => renderTodo(v, { ctx: this.ctx, asAdmin: true, onChange: () => this.render(this.el, 'todo') })); }, planning: this.planning, toestellen: this.devices, export: this.exportView, instellingen: this.settings }[tab];
    Promise.resolve().then(() => (fn ? fn.call(this, view) : this.entity(view, tab)))
      .catch((e) => { view.innerHTML = `<div class="card error">${esc(e.message)}</div>`; });
  }

  // ---------- Stamgegevens ----------
  entity(view, name, edit = null) {
    const ent = ENTITIES[name];
    if (!ent) { view.innerHTML = '<p>Onbekend tabblad.</p>'; return; }
    // eerste keer: de standaard soorten werk in de stamgegevens zetten, zodat ze aanpasbaar zijn
    if (name === 'workTypes' && !(this.ctx.master().workTypes ?? []).length) {
      this.ctx.store.change(PATHS.master, EMPTY_MASTER(), (mm) => { mm.workTypes = DEFAULT_WORK_TYPES.map((w) => ({ ...w, active: true, updated: Date.now() })); });
    }
    const m = this.ctx.master();
    const rows = alive(m[name]).sort(byName);
    view.innerHTML = `
      <section class="card">
        <h2>${edit ? 'Wijzigen' : ent.newLabel}</h2>
        ${ent.help ? `<p class="muted">${ent.help}</p>` : ''}
        <form class="form-grid" id="entForm">
          ${ent.fields.filter((f) => !f.noForm).map((f) => `<label><span>${f.label}</span>${fieldInput(f, edit, m)}</label>`).join('')}
          <div class="row"><button class="primary">${edit ? 'Opslaan' : 'Toevoegen'}</button>${edit ? '<button type="button" class="secondary" data-act="cancel">Annuleren</button>' : ''}</div>
        </form>
        <div id="entErr"></div>
        <div id="entExtra"></div>
      </section>
      <section class="card table-wrap">
        <h2>${ent.title} (${rows.length})</h2>
        <table><thead><tr>${ent.fields.filter((f) => !f.noList).map((f) => `<th>${f.label}</th>`).join('')}<th></th></tr></thead>
        <tbody>${rows.map((r) => `<tr>${ent.fields.filter((f) => !f.noList).map((f) => `<td>${fieldValue(f, r, m)}</td>`).join('')}
          <td class="actions"><button class="link" data-edit="${esc(r.id)}">Wijzig</button><button class="link danger" data-del="${esc(r.id)}">Verwijder</button></td></tr>`).join('')}</tbody></table>
      </section>
      ${name === 'customers' ? `<section class="card" id="importCard"><h2>Klanten importeren</h2>
        <p class="muted">Kies een Excel- (.xlsx) of CSV-bestand met kolommen zoals <b>Naam, Adres, Postcode, Gemeente, Telefoonnummer, BTW-nummer</b> (bv. de export uit de boekhouding). Bestaande klanten (zelfde btw-nummer of naam) worden bijgewerkt, niet dubbel gemaakt. Per klant met adres maakt de app een locatie en zoekt ze de coördinaten op.</p>
        <input type="file" id="importFile" accept=".xlsx,.csv,text/csv">
        <div id="importOut"></div></section>` : ''}
      ${name === 'sites' ? '<div id="geoBox"></div>' : ''}`;

    const form = view.querySelector('#entForm');
    const err = (msg) => { view.querySelector('#entErr').innerHTML = msg ? `<div class="error">${esc(msg)}</div>` : ''; };
    form.onsubmit = async (e) => {
      e.preventDefault();
      const rec = { ...(edit ?? { id: uid() }) };
      for (const f of ent.fields.filter((x) => !x.noForm)) {
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
      if (name === 'sites') {
        const coordsText = form.elements.coords.value.trim();
        if (rec.lat != null && coordsText !== (edit?.lat != null ? `${edit.lat}, ${edit.lon}` : '')) {
          rec.geo = form.dataset.lookup === coordsText ? form.dataset.geo : 'manueel';
        }
        if (rec.lat == null && rec.address) {
          // geen coördinaten ingevuld: zelf opzoeken bij het adres
          const btn = form.querySelector('button.primary');
          btn.disabled = true;
          try {
            const g = await geocode(splitAddress(rec.address));
            if (g) Object.assign(rec, g);
            else { rec.geo = 'niet gevonden'; toast('Adres niet gevonden. Vul de coördinaten zelf in (Google Maps of "Mijn locatie").', 'err'); }
          } catch (e2) { toast(e2.message, 'err'); } finally { btn.disabled = false; }
        }
      }
      let newPassword = null;
      if (name === 'employees') {
        const me = this.ctx.me();
        if (me?.username === rec.username && me.isAdmin && !rec.is_admin && !this.ctx.adminKey()
          && !confirm('Je neemt je eigen beheerrecht af. Daarna kan je het beheer op dit toestel niet meer openen. Doorgaan?')) return;
        // wachtwoord en beheerrecht worden door de server bewaakt: eerst daar bewaren (wachtwoord nooit in de opslag)
        const password = rec.password;
        delete rec.password;
        if (password && password.length < 8) return err('Het wachtwoord moet minstens 8 tekens lang zijn.');
        if (password && edit && !confirm(`Nieuw wachtwoord instellen voor ${rec.name}? Die wordt dan op al zijn/haar toestellen afgemeld.`)) return;
        if (this.hasServer()) {
          try {
            const out = await this.server(`/api/admin/employees/${encodeURIComponent(rec.username)}`, {
              method: 'PUT', body: JSON.stringify({ name: rec.name, loxone_user: rec.loxone_user, is_admin: !!rec.is_admin, ...(password ? { password } : {}) }),
            });
            rec.has_password = !!out?.has_password;
            newPassword = password || null;
          } catch (e2) {
            if (password || rec.is_admin !== boolOf(edit?.is_admin, { def: false })) return err(`Niet bewaard: ${e2.message}`);
            toast(`Bewaard, maar niet doorgegeven aan de server: ${e2.message}`, 'err');
          }
        } else if (rec.is_admin || password) {
          return err('Beheerders en wachtwoorden instellen kan enkel als de server bereikbaar is.');
        }
        if (!edit && !rec.has_password) toast('Let op: zonder wachtwoord kan deze werknemer zich niet aanmelden.', 'err');
      }
      rec.updated = Date.now();
      this.ctx.store.change(PATHS.master, EMPTY_MASTER(), (mm) => {
        mm[name] = (mm[name] ?? []).filter((x) => x.id !== rec.id);
        mm[name].push(rec);
      });
      toast('Bewaard', 'ok');
      if (name === 'customers') this.syncCustomerSite(rec);
      this.entity(view, name);
      if (name === 'employees' && newPassword) {
        // eenmalig tonen: het wachtwoord wordt nergens leesbaar bewaard
        const box = view.querySelector('#entExtra');
        box.innerHTML = `<div class="notice"><p><b>Geef deze gegevens door aan ${esc(rec.name ?? rec.username)}</b> (worden maar één keer getoond):</p>
          <div class="copy-list">${[['Link', location.origin + location.pathname], ['Gebruikersnaam', rec.username], ['Wachtwoord', newPassword]].map(([l, v]) => `
            <div class="copy-row"><span class="muted small">${l}</span><code>${esc(v)}</code><button class="secondary" data-copy="${esc(v)}">Kopieer</button></div>`).join('')}</div></div>`;
        box.querySelectorAll('[data-copy]').forEach((b) => b.onclick = async () => {
          try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = '✔ Gekopieerd'; } catch { /* niet toegelaten */ }
        });
        box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };
    form.querySelector('[data-act=lookup]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const addr = form.elements.address?.value.trim();
      if (!addr) return err('Vul eerst het adres in, bv. Ieperseweg 112, 8800 Roeselare.');
      btn.disabled = true;
      try {
        const g = await geocode(splitAddress(addr));
        if (!g) return err('Adres niet gevonden. Controleer het adres of vul de coördinaten zelf in.');
        err('');
        form.elements.coords.value = `${g.lat}, ${g.lon}`;
        form.dataset.lookup = form.elements.coords.value;
        form.dataset.geo = g.geo;
        toast(g.geo === 'adres' ? 'Coördinaten gevonden' : 'Enkel de straat gevonden: controleer op de kaart', g.geo === 'adres' ? 'ok' : 'err');
      } catch (e2) { err(e2.message); } finally { btn.disabled = false; }
    });
    if (name === 'customers') {
      view.querySelector('#importFile').onchange = (e) => { if (e.target.files[0]) this.importCustomers(view, e.target.files[0]); };
    }
    if (name === 'sites') this.geoMissingBox(view.querySelector('#geoBox'));
    form.querySelector('[data-act=genpw]')?.addEventListener('click', () => {
      // goed leesbaar en makkelijk over te typen: geen 0/O, 1/l/I
      const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
      const rnd = crypto.getRandomValues(new Uint32Array(10));
      form.elements.password.value = Array.from(rnd, (n) => chars[n % chars.length]).join('').replace(/^(.{5})/, '$1-');
    });
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
        // klant weg → ook de locatie die de app voor die klant maakte
        if (name === 'customers') for (const s of mm.sites ?? []) if (s.from_customer && s.customer_id === id) Object.assign(s, { deleted: true, updated: Date.now() });
      });
      if (name === 'employees' && this.hasServer()) {
        try { await this.server(`/api/admin/employees/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch { /* server niet bereikbaar */ }
      }
      this.entity(view, name);
    });
    if (name === 'employees' && !edit) this.syncAdminFlags(view);
  }

  // ---------- Te bevestigen: nieuwe klanten en projecten van werknemers ----------
  pendingCount() {
    const m = this.ctx.master();
    return alive(m.customers).filter((c) => c.pending).length + alive(m.projects).filter((p) => p.pending).length;
  }

  review(view) {
    const m = this.ctx.master();
    const emps = alive(m.employees);
    const who = (r) => `${esc(emps.find((e) => e.username === r.created_by)?.name ?? r.created_by ?? 'onbekend')}${r.created_at ? ` · ${esc(fmtDate(localDateOf(r.created_at), { day: 'numeric', month: 'short' }))}` : ''}`;
    const pc = alive(m.customers).filter((c) => c.pending).sort(byName);
    const pp = alive(m.projects).filter((p) => p.pending).sort(byName);
    const okCust = alive(m.customers).filter((c) => !c.pending).sort(byName);
    const okProj = alive(m.projects).filter((p) => !p.pending);
    const custOpts = (sel) => alive(m.customers).sort(byName).map((c) => `<option value="${esc(c.id)}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}${c.pending ? ' (nieuw)' : ''}</option>`).join('');
    const mergeSelect = (list, name, label) => {
      const sim = similarTo(list, name);
      const rest = list.filter((x) => !sim.includes(x)).sort((a, b) => label(a).localeCompare(label(b), 'nl'));
      return `<select data-f="target"><option value="">— samenvoegen met… —</option>
        ${sim.length ? `<optgroup label="Lijkt op">${sim.map((x) => `<option value="${esc(x.id)}">${esc(label(x))}</option>`).join('')}</optgroup>` : ''}
        <optgroup label="Alle">${rest.map((x) => `<option value="${esc(x.id)}">${esc(label(x))}</option>`).join('')}</optgroup></select>`;
    };
    const card = (kind, r, body, sim) => `<div class="review" data-kind="${kind}" data-id="${esc(r.id)}">
      <div class="row spread"><b>${esc(r.name)}</b><span class="muted small">aangemaakt door ${who(r)}</span></div>
      ${sim.length ? `<p class="warn-text">Lijkt op: ${sim.slice(0, 3).map((x) => `<b>${esc(kind === 'projects' ? projectLabel(x, m) : x.name)}</b>`).join(', ')}</p>` : ''}
      <div class="form-grid">${body}</div>
      <div class="row" style="margin-top:8px"><button class="primary" data-act="confirm">✔ Bevestigen</button>
        ${kind === 'projects' ? mergeSelect(okProj, r.name, (x) => projectLabel(x, m)) : mergeSelect(okCust, r.name, (x) => x.name)}
        <button class="secondary" data-act="merge">Samenvoegen</button></div></div>`;
    view.innerHTML = `<section class="card"><h2>Te bevestigen</h2>
      <p class="muted">Klanten en projecten die werknemers zelf aanmaakten (in de app of via een melding). Pas de naam aan of vul aan en <b>bevestig</b>, of <b>voeg samen</b> met een bestaande klant of een bestaand project: dan worden alle uren, materiaal en planning mee omgezet.</p>
      ${pc.length + pp.length ? '' : '<p class="ok-text">✓ Niets te bevestigen.</p>'}</section>
      ${pc.length ? `<section class="card"><h2>Nieuwe klanten (${pc.length})</h2>${pc.map((c) => card('customers', c,
        `<label><span>Naam klant</span><input data-f="name" value="${esc(c.name)}"></label>
         <label><span>Opmerking</span><input data-f="note" value="${esc(c.note ?? '')}"></label>`, similarTo(okCust, c.name))).join('')}</section>` : ''}
      ${pp.length ? `<section class="card"><h2>Nieuwe projecten (${pp.length})</h2>${pp.map((p) => card('projects', p,
        `<label><span>Naam project</span><input data-f="name" value="${esc(p.name)}"></label>
         <label><span>Projectcode</span><input data-f="code" value="${esc(p.code ?? '')}"></label>
         <label><span>Klant</span><select data-f="customer_id"><option value="">— geen klant —</option>${custOpts(p.customer_id)}</select></label>
         <label><span>Type werk</span><select data-f="work_type">${workTypeOptions(m, p.work_type)}</select></label>`,
        similarTo(okProj.filter((x) => !p.customer_id || x.customer_id === p.customer_id || !x.customer_id), p.name))).join('')}</section>` : ''}`;

    view.onclick = async (e) => {
      const btn = e.target.closest('[data-act]');
      const box = e.target.closest('.review');
      if (!btn || !box) return;
      const kind = box.dataset.kind;
      const id = box.dataset.id;
      const val = (f) => box.querySelector(`[data-f=${f}]`)?.value.trim() ?? '';
      if (btn.dataset.act === 'confirm') {
        if (!val('name')) return toast('Geef een naam.', 'err');
        this.ctx.store.change(PATHS.master, EMPTY_MASTER(), (mm) => {
          const r = mm[kind].find((x) => x.id === id);
          if (!r) return;
          r.name = val('name');
          if (kind === 'customers') r.note = val('note') || null;
          else { r.code = val('code'); r.customer_id = val('customer_id') || null; r.work_type = val('work_type') || null; }
          // de locatie die bij een nieuwe klant gemaakt werd, krijgt de nieuwe naam mee
          if (kind === 'customers') for (const s of mm.sites ?? []) if (s.from_customer && s.customer_id === id) s.name = r.name;
          delete r.pending;
          r.confirmed_at = Date.now();
          r.updated = Date.now();
        });
        toast('Bevestigd', 'ok');
        this.render(this.el, 'nieuw');
      } else if (btn.dataset.act === 'merge') {
        const target = val('target');
        if (!target) return toast('Kies eerst met wie je wil samenvoegen.', 'err');
        const tName = kind === 'projects' ? projectLabel(m.projects.find((x) => x.id === target), m) : m.customers.find((x) => x.id === target)?.name;
        if (!confirm(`"${box.querySelector('b').textContent}" samenvoegen met "${tName}"? Alle uren, materiaal en planning gaan naar "${tName}".`)) return;
        btn.disabled = true;
        try {
          const n = await this.mergeInto(kind, id, target);
          toast(`Samengevoegd${n ? ` (${n} dag${n > 1 ? 'en' : ''} aangepast)` : ''}`, 'ok');
        } catch (e2) { toast(e2.message, 'err'); }
        this.render(this.el, 'nieuw');
      }
    };
  }

  /**
   * Klant of project samenvoegen met een bestaande: alle verwijzingen omzetten (uren, materiaal, planning,
   * projecten en locaties van de klant). Het oude record blijft bewaard met merged_into (doorverwijzing).
   */
  async mergeInto(kind, fromId, toId) {
    const m = this.ctx.master();
    const from = m[kind].find((x) => x.id === fromId);
    const startMonth = localDateOf(Math.min(from?.created_at ?? Date.now(), Date.now()) - 7 * 86400000).slice(0, 7);
    const months = [];
    for (let mo = startMonth; mo <= today().slice(0, 7); mo = shiftDate(`${mo}-01`, 32).slice(0, 7)) months.push(mo);
    const paths = alive(m.employees).flatMap((e) => months.map((mo) => PATHS.reg(mo, e.username)));
    await this.ctx.store.sync([PATHS.master, PATHS.planning, ...paths]);
    let days = 0;
    if (kind === 'projects') {
      const fix = (x) => { if (x.projectId === fromId) { x.projectId = toId; return true; } return false; };
      for (const p of paths) {
        if (!this.ctx.store.has(p)) continue;
        const reg = this.ctx.store.get(p, null);
        const hit = Object.values(reg?.days ?? {}).some((d) => [...(d.segments ?? []), ...(d.material ?? [])].some((x) => x.projectId === fromId));
        if (!hit) continue;
        this.ctx.store.change(p, null, (r) => {
          for (const d of Object.values(r.days ?? {})) {
            let changed = false;
            for (const x of [...(d.segments ?? []), ...(d.material ?? [])]) changed = fix(x) || changed;
            if (changed) { d.updated = Date.now(); days++; }
          }
        });
      }
      if (this.ctx.store.has(PATHS.planning)) {
        this.ctx.store.change(PATHS.planning, { items: [] }, (pl) => {
          for (const it of pl.items ?? []) if (it.projectId === fromId) { it.projectId = toId; it.updated = Date.now(); }
        });
      }
    }
    this.ctx.store.change(PATHS.master, EMPTY_MASTER(), (mm) => {
      const r = mm[kind].find((x) => x.id === fromId);
      if (r) Object.assign(r, { deleted: true, merged_into: toId, pending: false, updated: Date.now() });
      if (kind === 'customers') {
        const target = mm.customers.find((x) => x.id === toId);
        for (const p of mm.projects ?? []) if (p.customer_id === fromId) { p.customer_id = toId; p.updated = Date.now(); }
        // de locatie op de plek van de werknemer blijft, als extra zone van de bestaande klant
        for (const s of mm.sites ?? []) if (s.customer_id === fromId) { s.customer_id = toId; s.name = target?.name ?? s.name; s.updated = Date.now(); }
      }
    });
    return days;
  }

  // ---------- Klanten: locatie en import ----------
  /**
   * Klant met adres → één locatie (zone) "van de klant". Adres gewijzigd → coördinaten opnieuw opzoeken.
   * Extra werven van dezelfde klant maak je zelf bij Locaties; die blijven ongemoeid.
   * Geeft de id van de locatie terug als die opnieuw opgezocht moet worden.
   */
  customerSite(mm, cust) {
    const line = addressLine(cust);
    if (!cust.street || (!cust.postcode && !cust.city)) return null;
    mm.sites = mm.sites ?? [];
    let site = mm.sites.find((s) => !s.deleted && s.from_customer && s.customer_id === cust.id);
    if (site && site.address === line) {
      if (site.name !== cust.name) Object.assign(site, { name: cust.name, updated: Date.now() });
      return site.lat == null && site.geo !== 'niet gevonden' ? site.id : null;
    }
    if (!site) {
      site = { id: uid(), type: 'klant', from_customer: true, customer_id: cust.id, radius_m: 150, active: true };
      mm.sites.push(site);
    }
    Object.assign(site, { name: cust.name, address: line, lat: null, lon: null, geo: null, updated: Date.now() });
    return site.id;
  }

  syncCustomerSite(cust) {
    let id = null;
    this.ctx.store.change(PATHS.master, EMPTY_MASTER(), (mm) => { id = this.customerSite(mm, cust); });
    if (id) this.geocodeSites([id]).then(({ found, missing }) => {
      if (found) toast(`Coördinaten gevonden voor ${cust.name}`, 'ok');
      if (missing) toast(`Adres van ${cust.name} niet gevonden: vul de coördinaten aan bij Locaties.`, 'err');
    });
  }

  /** Coördinaten opzoeken voor de gegeven locaties (1 per seconde). onProgress(i, n) */
  async geocodeSites(ids, onProgress = () => {}, shouldStop = () => false) {
    let found = 0;
    let missing = 0;
    for (let i = 0; i < ids.length; i++) {
      if (shouldStop()) break;
      onProgress(i, ids.length);
      const site = alive(this.ctx.master().sites).find((s) => s.id === ids[i]);
      if (!site?.address || site.lat != null) continue;
      let g = null;
      try { g = await geocode(splitAddress(site.address)); } catch (e) { toast(e.message, 'err'); break; }
      if (g) found++; else missing++;
      // zelfde plek als het atelier, een thuisadres of leverancier? Dan uitschakelen, anders "wint" de klant daar
      const clash = g && alive(this.ctx.master().sites).find((o) => o.id !== site.id && o.type !== 'klant' && o.lat != null
        && distance(o, g) <= (o.radius_m ?? 150));
      this.ctx.store.change(PATHS.master, EMPTY_MASTER(), (mm) => {
        const s = mm.sites.find((x) => x.id === site.id);
        if (s && s.lat == null) {
          Object.assign(s, g ?? { geo: 'niet gevonden' }, clash ? { active: false, overlap: clash.name } : {}, { updated: Date.now() });
        }
      });
    }
    onProgress(ids.length, ids.length);
    return { found, missing };
  }

  /** Locaties: knop om alle ontbrekende coördinaten op te zoeken */
  geoMissingBox(box) {
    if (!box) return;
    const todo = alive(this.ctx.master().sites).filter((s) => s.address && s.lat == null);
    if (!todo.length) { box.innerHTML = ''; return; }
    const notFound = todo.filter((s) => s.geo === 'niet gevonden').length;
    box.innerHTML = `<section class="card"><h2>Coördinaten ontbreken (${todo.length})</h2>
      <p class="muted">De app zoekt ze op bij het adres via OpenStreetMap (ongeveer 1 per seconde).${notFound ? ` ${notFound} adres(sen) werden eerder niet gevonden: controleer die adressen of vul de coördinaten zelf in.` : ''}</p>
      <div class="row"><button class="primary" data-act="geoall">Coördinaten opzoeken</button></div><div class="geo-progress"></div></section>`;
    box.querySelector('[data-act=geoall]').onclick = async (e) => {
      e.currentTarget.disabled = true;
      const out = box.querySelector('.geo-progress');
      const { found, missing } = await this.geocodeSites(todo.map((s) => s.id), (i, n) => { out.innerHTML = `<p class="muted">Bezig: ${i} / ${n}…</p>`; });
      toast(`${found} gevonden${missing ? `, ${missing} niet gevonden` : ''}`, missing ? 'err' : 'ok');
      this.entity(box.closest('#adminView') ?? this.el.querySelector('#adminView'), 'sites');
    };
  }

  /** Excel/CSV met klanten inlezen: voorbeeld tonen, daarna importeren en coördinaten opzoeken */
  async importCustomers(view, file) {
    const out = view.querySelector('#importOut');
    let rows;
    try { rows = await readTable(file); } catch (e) { out.innerHTML = `<div class="error">${esc(e.message)}</div>`; return; }
    const norm = (s) => String(s ?? '').trim();
    const hi = rows.findIndex((r) => r.some((c) => /^naam$/i.test(norm(c))));
    if (hi < 0) { out.innerHTML = '<div class="error">Geen kolom "Naam" gevonden in de eerste rijen.</div>'; return; }
    const head = rows[hi].map((c) => norm(c).toLowerCase());
    const col = (re) => head.findIndex((h) => re.test(h));
    const C = { name: col(/^naam/), street: col(/^(adres|straat)/), postcode: col(/^post/), city: col(/^(gemeente|plaats|stad|woonplaats)/), phone: col(/^(telefoon|tel|gsm)/), vat: col(/^(btw|vat|ondernemingsnummer)/) };
    const vatKey = (v) => norm(v).replace(/[^0-9a-z]/gi, '').toUpperCase();
    const m = this.ctx.master();
    const existing = alive(m.customers);
    const items = [];
    const skipped = [];
    for (const r of rows.slice(hi + 1)) {
      const get = (k) => (C[k] >= 0 ? norm(r[C[k]]).replace(/\s+/g, ' ') : '');
      const rec = { name: get('name'), street: get('street'), postcode: get('postcode'), city: get('city'), phone: get('phone'), vat: get('vat') };
      if (!rec.name) continue;
      if (rec.postcode && !/^\d{4,5}$/.test(rec.postcode)) {
        // kapotte rij (alles in één kolom): klant wel overnemen, adres niet
        skipped.push(`${rec.name}: adres onleesbaar, zonder locatie overgenomen`);
        rec.note = `Adres uit import: ${rec.street}`;
        rec.street = ''; rec.postcode = ''; rec.city = '';
      }
      // "MOORSLEDE", "izegem" → "Moorslede", "Izegem"
      if (rec.city === rec.city.toUpperCase() || rec.city === rec.city.toLowerCase()) {
        rec.city = rec.city.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (x) => x.toUpperCase());
      }
      const match = (rec.vat && existing.find((c) => c.vat && vatKey(c.vat) === vatKey(rec.vat)))
        || existing.find((c) => c.name.trim().toLowerCase() === rec.name.toLowerCase())
        || items.find((x) => x.rec.name.toLowerCase() === rec.name.toLowerCase())?.match;
      items.push({ rec, match });
    }
    const nNew = items.filter((x) => !x.match).length;
    const withAddr = items.filter((x) => x.rec.street && (x.rec.postcode || x.rec.city)).length;
    out.innerHTML = `<div class="notice">
      <p><b>${items.length}</b> klanten gevonden: <b>${nNew}</b> nieuw, <b>${items.length - nNew}</b> bestaand (worden bijgewerkt). ${withAddr} met adres → locatie + coördinaten.</p>
      ${skipped.length ? `<details><summary>Opmerkingen (${skipped.length})</summary><ul>${skipped.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></details>` : ''}
      <div class="row"><button class="primary" data-act="doimport">Importeren</button><button class="secondary" data-act="cancelimport">Annuleren</button></div></div>`;
    out.querySelector('[data-act=cancelimport]').onclick = () => { out.innerHTML = ''; view.querySelector('#importFile').value = ''; };
    out.querySelector('[data-act=doimport]').onclick = async () => {
      const geoIds = [];
      this.ctx.store.change(PATHS.master, EMPTY_MASTER(), (mm) => {
        mm.customers = mm.customers ?? [];
        for (const { rec, match } of items) {
          let cust = match && mm.customers.find((c) => c.id === match.id);
          if (!cust) { cust = { id: uid() }; mm.customers.push(cust); }
          for (const [k, v] of Object.entries(rec)) if (v || !cust[k]) cust[k] = v || cust[k] || '';
          cust.updated = Date.now();
          const id = this.customerSite(mm, cust);
          if (id) geoIds.push(id);
        }
      });
      let stop = false;
      out.innerHTML = `<div class="notice"><p>✔ ${items.length} klanten bewaard. Coördinaten opzoeken: <b class="geo-count">0 / ${geoIds.length}</b> <span class="muted small">(ongeveer ${Math.ceil(geoIds.length * 1.2 / 60)} min; je mag verder werken in de app, maar laat ze open)</span></p>
        <div class="row"><button class="secondary" data-act="stopgeo">Stoppen</button></div></div>`;
      out.querySelector('[data-act=stopgeo]').onclick = () => { stop = true; };
      const { found, missing } = await this.geocodeSites(geoIds, (i, n) => {
        const el = document.querySelector('.geo-count');
        if (el) el.textContent = `${i} / ${n}`;
      }, () => stop);
      toast(`Import klaar: ${found} locaties gevonden${missing ? `, ${missing} niet gevonden (zie Locaties)` : ''}`, missing ? 'err' : 'ok');
      if (out.isConnected) this.entity(view, 'customers');
    };
  }

  /** Beheerrecht en "wachtwoord ingesteld" staan op de server: neem ze over in de lijst als ze verschillen */
  async syncAdminFlags(view) {
    if (!this.hasServer()) return;
    let list;
    try { list = await this.server('/api/admin/employees'); } catch { return; }
    const srv = new Map(list.map((e) => [e.username, { is_admin: !!e.is_admin, has_password: !!e.has_password }]));
    const differs = (e) => srv.has(e.username) && (srv.get(e.username).is_admin !== !!e.is_admin || srv.get(e.username).has_password !== !!e.has_password);
    if (!alive(this.ctx.master().employees).some(differs)) return;
    this.ctx.store.change(PATHS.master, EMPTY_MASTER(), (mm) => {
      for (const e of mm.employees) if (differs(e)) Object.assign(e, srv.get(e.username), { updated: Date.now() });
    });
    if (view.isConnected) this.entity(view, 'employees');
  }

  // ---------- Toestellen: waar is iedereen aangemeld ----------
  async devices(view) {
    view.innerHTML = `<section class="card"><h2>Aangemelde toestellen</h2>
      <p class="muted">Alle toestellen waarop een werknemer aangemeld is. Een toestel afmelden: de werknemer moet zich daar opnieuw aanmelden. Gsm kwijt? Meld het toestel af én geef bij Werknemers een nieuw wachtwoord.</p>
      <div id="devList"><p class="muted">Laden…</p></div></section>`;
    const box = view.querySelector('#devList');
    if (!this.hasServer()) { box.innerHTML = '<p class="muted">Geen verbinding met de server ingesteld.</p>'; return; }
    try {
      const list = await this.server('/api/admin/sessions');
      const people = new Set(list.map((s) => s.username)).size;
      box.innerHTML = `<p class="muted small">${list.length} toestel(len) voor ${people} werknemer(s).</p>${this.ctx.sessionsHtml(list, { showUser: true })}`;
      box.querySelectorAll('[data-revoke]').forEach((b) => b.onclick = async () => {
        if (!confirm('Dit toestel afmelden?')) return;
        try { await this.server(`/api/admin/sessions/${b.dataset.revoke}`, { method: 'DELETE' }); } catch (e) { toast(e.message, 'err'); }
        this.devices(view);
      });
    } catch (e) {
      box.innerHTML = `<div class="error">${esc(e.message)}</div>`;
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
    view.querySelector('[data-act=prev]').onclick = () => { this.date = shiftDate(date, -1); this.openEmp = null; this.overview(view); };
    view.querySelector('[data-act=next]').onclick = () => { this.date = shiftDate(date, 1); this.openEmp = null; this.overview(view); };
    view.querySelector('#ovDate').onchange = (e) => { if (isDate(e.target.value)) { this.date = e.target.value; this.openEmp = null; this.overview(view); } };
    this.ovView = view;
    await this.refreshOverview(view, { pull: true });

    // Live: elke 20 seconden nieuwe registraties (Google Drive) en badges/locaties (server) ophalen
    clearInterval(this.ovTimer);
    this.ovTimer = setInterval(() => {
      if (!view.isConnected) { clearInterval(this.ovTimer); return; }
      if (document.visibilityState !== 'visible') return;
      this.refreshOverview(view, { pull: true });
    }, 20000);
  }

  /** Iets veranderde in de opslag (bv. een werknemer bevestigde zijn dag): het open beheerscherm bijwerken */
  remoteChanged() {
    if (this.tab === 'overzicht' && this.ovView?.isConnected) { this.refreshOverview(this.ovView, { pull: false }); return true; }
    return false;
  }

  /** Tabel van het dagoverzicht (en de open dag) opnieuw opbouwen, zonder de rest van het scherm te storen */
  async refreshOverview(view, { pull }) {
    if (this.ovBusy) return;
    this.ovBusy = true;
    try {
      await this._refreshOverview(view, pull);
    } finally {
      this.ovBusy = false;
    }
  }

  async _refreshOverview(view, pull) {
    const date = this.date;
    const m = this.ctx.master();
    const emps = alive(m.employees).filter((e) => e.active !== false).sort(byName);
    const month = date.slice(0, 7);
    if (pull) await this.ctx.store.sync([PATHS.master, PATHS.planning, ...emps.map((e) => PATHS.reg(month, e.username))]);
    // De beheerder ziet enkel bevestigde uren: geen ruwe gegevens en geen voorstellen ophalen
    const raws = {};
    const rawErr = '';
    if (!view.isConnected || date !== this.date) return;
    const typing = () => { const a = document.activeElement; return a && ['INPUT', 'SELECT', 'TEXTAREA'].includes(a.tagName) && view.contains(a); };
    if (typing()) return; // niet storen tijdens het typen; volgende ronde opnieuw

    const rows = emps.map((e) => ({ e, st: dayState(this.ctx, e.username, date, raws[e.username]) }));
    view.querySelector('#ovTable').innerHTML = `
      ${rawErr ? `<p class="muted">⚠ ${esc(rawErr)}</p>` : ''}
      <p class="muted small live-note">● Live · bijgewerkt ${localTime(Date.now())}</p>
      <table><thead><tr><th>Werknemer</th><th>Status</th><th>Van – tot</th><th>Arbeidstijd</th><th>Km</th><th>Materiaal</th><th>Manueel aangepast</th></tr></thead><tbody>
      ${rows.map(({ e, st }) => {
        const ok = st.status === 'bevestigd';
        return `<tr class="click" data-emp="${esc(e.username)}">
        <td>${esc(e.name)}</td>
        <td>${ok ? '<span class="pill ok">Bevestigd</span>' : st.status === 'nietgewerkt' ? '<span class="pill">Niet gewerkt</span>' : '<span class="pill warn">Nog niet bevestigd</span>'}</td>
        <td>${ok && st.summary.start ? `${localTime(st.summary.start)} – ${localTime(st.summary.end)}` : ''}</td>
        <td>${ok ? fmtHours(st.summary.workMinutes) : ''}</td>
        <td>${ok ? st.summary.km : ''}</td>
        <td>${ok ? st.material.length || '' : ''}</td>
        <td>${(() => { const ch = ok ? manualChanges(st) : null; return ch == null ? '' : ch.length ? `<span class="pill warn">${ch.length}</span>` : '<span class="muted">nee</span>'; })()}</td></tr>`;
      }).join('')}
      </tbody></table>`;
    const showDay = (u, scroll) => {
      const box = view.querySelector('#ovDay');
      box.innerHTML = `<h2 class="section-title">${esc(alive(m.employees).find((x) => x.username === u)?.name ?? u)} · ${esc(fmtDate(date))}</h2><div></div>`;
      renderDay(box.lastElementChild, { ctx: this.ctx, username: u, date, raw: raws[u], asAdmin: true });
      if (scroll) box.scrollIntoView({ behavior: 'smooth' });
    };
    view.querySelectorAll('[data-emp]').forEach((tr) => tr.onclick = () => { this.openEmp = tr.dataset.emp; showDay(tr.dataset.emp, true); });
    // Was er een werknemer open? Die dag ook bijwerken (de scrollpositie blijft behouden)
    if (this.openEmp) showDay(this.openEmp, false);

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