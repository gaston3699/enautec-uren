// Enautec Uren – hoofdmodule: opstarten, aanmelden, navigatie en de schermen voor de werknemer.
import { MS_CLIENT_ID, APP_VERSION, STORAGE, SERVER_URL } from './config.js';
import * as auth from './auth.js';
import { OneDrive, TestDrive } from './drive.js';
import { GoogleDrive } from './gdrive.js';
import { Store, PATHS, EMPTY_MASTER } from './store.js';
import { renderDay, emptyReg, rulesFrom } from './day.js';
import { Admin } from './admin.js';
import { summarize } from './engine.js';
import { today, shiftDate, fmtDate, isDate, fmtHours } from './time.js';
import { esc, alive, byName, projectLabel, toast, sha256, copyText } from './ui.js';
import { seedDemo } from './demo.js';
import { initUpdates } from './update.js';

const params = new URLSearchParams(location.search);
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
if (LOCAL && params.has('test')) localStorage.setItem('enautec.test', '1');
const TEST = LOCAL && localStorage.getItem('enautec.test') === '1';

const GOOGLE = STORAGE === 'google';
const STORE_NAME = TEST ? 'testopslag' : GOOGLE ? 'Google Drive' : 'OneDrive';

const DEVICE = 'enautec.device';
const ADMIN_KEY = 'enautec.adminKey';
const SERVER = 'enautec.server';
const BILLING_TEST = 'enautec.testBilling';
const ADMIN_OK = 'enautec.adminOk';

const $main = document.getElementById('main');
const $status = document.getElementById('syncStatus');
const $nav = document.getElementById('nav');

const lsGet = (k, d = null) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* geblokkeerd */ } };

// ---------- Opslag ----------
const device = () => lsGet(DEVICE);
const serverUrl = () => (localStorage.getItem(SERVER) || (TEST ? location.origin : SERVER_URL) || '').replace(/\/+$/, '');
const adminKey = () => localStorage.getItem(ADMIN_KEY) || '';
const ME = 'enautec.me';
/** Is de gekoppelde werknemer op dit toestel ook beheerder? (bijgehouden door de server) */
const isAdminEmployee = () => { const me = lsGet(ME); return !!(me?.isAdmin && me.username === device()?.username); };
/** Mag dit toestel het beheer openen: beheersleutel, beheerder-werknemer, of testmodus */
const canAdmin = () => TEST || STORAGE !== 'google' || !!adminKey() || isAdminEmployee();
/** Headers voor beheerverzoeken aan de server */
function adminHeaders() {
  if (adminKey()) return { 'X-Admin-Key': adminKey() };
  if (isAdminEmployee()) return { Authorization: `Bearer ${device().token}` };
  return null;
}

/** Toegangstokens voor Google Drive, verkregen via de verzamelserver */
function googleTokens(slot) {
  let cache = null;
  return async (force = false) => {
    if (!force && cache && Date.now() < cache.exp - 60000) return cache;
    const dev = device();
    const authHdr = slot === 'A' && dev?.token ? { Authorization: `Bearer ${dev.token}` } : adminHeaders();
    if (!authHdr) throw Object.assign(new Error('Dit toestel is niet gekoppeld.'), { needsLogin: true });
    const headers = { 'Content-Type': 'application/json', ...authHdr };
    const res = await fetch(`${serverUrl()}/api/google/token`, { method: 'POST', headers, body: JSON.stringify({ slot }) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 409) throw Object.assign(new Error(data.error || 'Geen toegang tot Google Drive.'), { needsLogin: true });
    if (!res.ok) throw new Error(data.error || `Server: fout ${res.status}`);
    cache = { token: data.access_token, exp: data.expires_at, email: data.email };
    return cache;
  };
}

const hasGoogleAccess = () => !!serverUrl() && !!(device()?.token || adminKey());

function makeDriveA() {
  if (TEST) return new TestDrive('A');
  if (GOOGLE) return hasGoogleAccess() ? new GoogleDrive('A', googleTokens('A')) : null;
  return auth.account('A') ? new OneDrive('A') : null;
}
function makeDriveB() {
  if (TEST) return localStorage.getItem(BILLING_TEST) ? new TestDrive('B') : null;
  if (GOOGLE) return serverUrl() && adminHeaders() ? new GoogleDrive('B', googleTokens('B')) : null;
  return auth.account('B') ? new OneDrive('B') : null;
}
let driveA = makeDriveA();
let driveB = makeDriveB();

const STATUS = {
  ok: ['ok', `Bewaard in ${STORE_NAME}`],
  busy: ['busy', 'Synchroniseren…'],
  idle: ['busy', 'Verbinden…'],
  offline: ['warn', 'Offline · bewaard op toestel'],
  login: ['err', GOOGLE ? 'Google Drive niet gekoppeld' : 'Opnieuw aanmelden'],
  error: ['err', `Probleem met ${STORE_NAME}`],
  local: ['warn', 'Niet verbonden'],
};
function showStatus(s, err) {
  const [cls, text] = STATUS[s] ?? STATUS.local;
  $status.className = `sync ${cls}`;
  $status.querySelector('span').textContent = TEST && s === 'ok' ? 'Testmodus · bewaard' : text;
  $status.title = err || '';
}
const store = new Store(driveA, showStatus);

async function serverAdmin(path, opts = {}) {
  const ah = adminHeaders();
  if (!serverUrl() || !ah) throw new Error('Geen beheerrechten op dit toestel (serveradres of beheersleutel ontbreekt).');
  const res = await fetch(serverUrl() + path, { ...opts, headers: { ...ah, 'Content-Type': 'application/json', ...(opts.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Server: fout ${res.status}`);
  return data;
}

const ctx = {
  store,
  storage: TEST ? 'test' : STORAGE,
  storeName: STORE_NAME,
  master: () => ({ ...EMPTY_MASTER(), ...store.get(PATHS.master, EMPTY_MASTER()) }),
  planning: () => store.get(PATHS.planning, { items: [] }),
  serverUrl,
  setServerUrl: (u) => (u ? localStorage.setItem(SERVER, u.replace(/\/+$/, '')) : localStorage.removeItem(SERVER)),
  adminKey,
  setAdminKey: (k) => (k ? localStorage.setItem(ADMIN_KEY, k) : localStorage.removeItem(ADMIN_KEY)),
  adminHeaders,
  serverAdmin,
  me: () => lsGet(ME),
  billingDrive: () => driveB,
  /** Google-koppeling (A = gegevens, B = facturatie): status, koppelen, ontkoppelen */
  googleStatus: () => serverAdmin('/api/admin/google/status'),
  connectGoogle: async (slot) => {
    if (TEST) {
      if (slot === 'B') { localStorage.setItem(BILLING_TEST, '1'); driveB = new TestDrive('B'); route(); }
      return;
    }
    const { url } = await serverAdmin('/api/admin/google/start', { method: 'POST', body: JSON.stringify({ slot, returnTo: location.origin + location.pathname }) });
    location.assign(url);
  },
  disconnectGoogle: (slot) => serverAdmin(`/api/admin/google/${slot}`, { method: 'DELETE' }),
  loginBilling: () => {
    if (TEST || GOOGLE) return ctx.connectGoogle('B');
    auth.login('B');
  },
  logoutBilling: () => {
    if (TEST) { localStorage.removeItem(BILLING_TEST); driveB = null; }
    else if (!GOOGLE) { auth.logout('B'); driveB = null; }
  },
};
const admin = new Admin(ctx);

// ---------- Ruwe gegevens van de server ----------
const rawCache = new Map();
async function fetchRaw(date) {
  const dev = device();
  const url = ctx.serverUrl();
  if (!dev?.token || !url) return { raw: null, error: '' };
  const hit = rawCache.get(date);
  if (hit && Date.now() - hit.at < 60000) return hit.value;
  let value;
  try {
    const res = await fetch(`${url}/api/raw?date=${date}`, { headers: { Authorization: `Bearer ${dev.token}` } });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) value = { raw: null, error: 'De koppeling met de server is niet meer geldig. Vraag een nieuwe koppellink.' };
    else if (!res.ok) value = { raw: null, error: data.error ?? `Server: fout ${res.status}` };
    else value = { raw: data, error: '' };
  } catch {
    value = { raw: null, error: 'Server niet bereikbaar. Je kan je regels ook zelf ingeven.' };
  }
  rawCache.set(date, { at: Date.now(), value });
  return value;
}

// ---------- OwnTracks ----------
function owntracksLink(dev) {
  const conf = {
    _type: 'configuration', mode: 3, url: `${ctx.serverUrl()}/api/owntracks`, auth: true,
    username: dev.username, password: dev.token, deviceId: 'gsm',
    tid: dev.username.replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase() || 'XX',
    monitoring: 1, locatorDisplacement: 100, locatorInterval: 180, pubExtendedData: true,
  };
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(conf))));
  return `owntracks:///config?inline=${encodeURIComponent(b64)}`;
}

// ---------- Synchroniseren ----------
function myPaths(date = today()) {
  const paths = [PATHS.master, PATHS.planning];
  const dev = device();
  if (dev?.username) {
    const months = new Set([date.slice(0, 7), today().slice(0, 7), shiftDate(`${today().slice(0, 7)}-01`, -1).slice(0, 7)]);
    for (const m of months) paths.push(PATHS.reg(m, dev.username));
  }
  return paths;
}
const syncNow = () => store.sync(myPaths(currentDate()));

let rerenderTimer;
store.onChange((path, source) => {
  if (source !== 'remote') return;
  const a = document.activeElement;
  if (a && ['INPUT', 'SELECT', 'TEXTAREA'].includes(a.tagName)) return; // niet storen tijdens typen
  clearTimeout(rerenderTimer);
  rerenderTimer = setTimeout(() => {
    // In het dagoverzicht van het beheer: enkel de tabel bijwerken, niet het hele scherm
    const view = location.hash.slice(1).split('/')[0];
    if (view === 'beheer' && admin.remoteChanged()) return;
    route();
  }, 300);
});

// ---------- Navigatie ----------
function currentDate() {
  const [view, arg] = location.hash.slice(1).split('/');
  return view === 'dag' && isDate(arg) ? arg : today();
}

const $switch = document.getElementById('modeSwitch');

/** Navigatie: onderaan de werknemerstabs; bovenaan een knop om te wisselen tussen werknemer en beheer */
function setNav(active) {
  const dev = device();
  const adminView = active === 'beheer';
  const items = [['dag', 'Dag', '🕒'], ['planning', 'Planning', '📅'], ['overzicht', 'Overzicht', '📋'], ['meer', 'Meer', '⚙']];
  $nav.innerHTML = items.map(([k, label, icon]) => `<a href="#${k}" class="${k === active ? 'active' : ''}"><span aria-hidden="true">${icon}</span>${label}</a>`).join('');
  $nav.hidden = adminView || !dev || (!store.drive && !TEST);
  document.body.classList.toggle('admin-mode', adminView);
  if (adminView && dev) {
    $switch.hidden = false;
    $switch.href = '#dag';
    $switch.innerHTML = '<span aria-hidden="true">👤</span> Werknemer';
    $switch.title = 'Terug naar je eigen uren';
  } else if (!adminView && dev && canAdmin()) {
    $switch.hidden = false;
    $switch.href = '#beheer';
    $switch.innerHTML = '<span aria-hidden="true">🔒</span> Beheer';
    $switch.title = 'Naar het beheer';
  } else {
    $switch.hidden = true;
  }
}

function route() {
  const [view = '', ...rest] = location.hash.slice(1).split('/');
  if (!driveA) return viewWelcome();
  const dev = device();
  if (view === 'beheer') return viewAdmin(rest[0] || 'overzicht');
  if (!dev) return GOOGLE && !TEST ? viewAdmin(rest[0] || 'overzicht') : viewWho();
  if (view === 'planning') return viewPlanning();
  if (view === 'overzicht') return viewHistory();
  if (view === 'meer') return viewMore();
  return viewDay(isDate(rest[0]) ? rest[0] : today());
}

// ---------- Schermen ----------
function viewWelcome(message = '') {
  setNav('');
  $nav.hidden = true;
  showStatus('local');
  if (GOOGLE && !TEST) return viewWelcomeGoogle(message);
  $main.innerHTML = `<section class="card welcome">
    <img src="logo.svg" alt="Enautec – Automatisatie &amp; elektrotechnieken" class="welcome-logo">
    <h1>Urenregistratie</h1>
    <p>Meld je aan met het <b>gedeelde Microsoft-account van Enautec</b>. Je uren, planning en materiaal worden in OneDrive bewaard.</p>
    ${message ? `<div class="error">${esc(message)}</div>` : ''}
    ${MS_CLIENT_ID ? '<button class="primary big" data-act="login">Aanmelden met Microsoft</button><p class="muted small">Vink bij Microsoft <b>"Aangemeld blijven"</b> aan, dan hoef je dit niet opnieuw te doen.</p>'
      : '<div class="notice">De app is nog niet gekoppeld aan Microsoft. Beheerder: vul MS_CLIENT_ID in (zie HANDLEIDING.md).</div>'}
    ${LOCAL ? '<p><a href="?test=1">Testmodus starten (zonder Microsoft)</a></p>' : ''}
  </section>`;
  $main.querySelector('[data-act=login]')?.addEventListener('click', () => auth.login('A'));
}

/** Startscherm bij opslag in Google Drive: koppellink (werknemer) of beheerder instellen */
async function viewWelcomeGoogle(message = '') {
  const isAdmin = !!adminKey() && !!serverUrl();
  let gs = null;
  let gsErr = '';
  if (isAdmin) { try { gs = await ctx.googleStatus(); } catch (e) { gsErr = e.message; } }
  $main.innerHTML = `<section class="card welcome">
    <img src="logo.svg" alt="Enautec – Automatisatie &amp; elektrotechnieken" class="welcome-logo">
    <h1>Urenregistratie</h1>
    ${message ? `<div class="error">${esc(message)}</div>` : ''}
    ${isAdmin ? `
      ${gsErr ? `<div class="error">${esc(gsErr)}</div>` : ''}
      ${gs && !gs.configured ? '<div class="notice">Google is nog niet ingesteld op de server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). Zie HANDLEIDING.md, deel B.</div>' : ''}
      ${gs?.configured && !gs.A ? `<p>Koppel nu het <b>Google-account van Enautec Uren</b>. Daar worden de uren, planning en het materiaal bewaard.</p>
        <button class="primary big" data-act="connect">Koppelen met Google Drive</button>
        <p class="muted small">Kies bij Google het juiste account en vink de toegang tot Google Drive aan.</p>` : ''}
      ${gs?.A ? `<p>✔ Gekoppeld met <b>${esc(gs.A.email ?? 'Google Drive')}</b>.</p><a class="btn primary" href="#beheer">Naar beheer</a>` : ''}
      <p><button class="link" data-act="forget">Beheerdersgegevens van dit toestel wissen</button></p>`
    : `<p><b>Werknemer?</b> ${isStandalone() ? 'Plak hieronder de <b>koppellink</b> die je van de beheerder kreeg.' : 'Open de <b>koppellink</b> die je van de beheerder kreeg, op deze gsm, of plak ze hieronder.'} Daarna werkt de app vanzelf, zonder wachtwoord.</p>
      <form id="linkForm" class="link-form">
        <input name="link" placeholder="Plak hier je koppellink" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Koppellink">
        <div class="row">
          ${navigator.clipboard?.readText ? '<button type="button" class="secondary" data-act="paste">Plakken</button>' : ''}
          <button class="primary">Koppelen</button>
        </div>
      </form><div id="linkErr"></div>
      <details><summary>Beheerder</summary>
        <form id="adminSetup" class="form-grid" style="text-align:left">
          <label><span>Adres van de verzamelserver</span><input name="server" required placeholder="https://enautec-uren.….workers.dev" value="${esc(serverUrl())}"></label>
          <label><span>Beheersleutel (ADMIN_KEY)</span><input name="key" type="password" required autocomplete="off"></label>
          <div><button class="primary">Verbinden</button></div>
        </form><div id="setupErr"></div>
      </details>`}
    ${LOCAL ? '<p><a href="?test=1">Testmodus starten</a></p>' : ''}
  </section>`;
  $main.querySelector('[data-act=connect]')?.addEventListener('click', () => ctx.connectGoogle('A').catch((e) => toast(e.message, 'err')));
  $main.querySelector('[data-act=forget]')?.addEventListener('click', () => { ctx.setAdminKey(''); location.reload(); });
  const lf = $main.querySelector('#linkForm');
  if (lf) {
    const tryLink = (text) => {
      const k = parseKoppel(text);
      if (!k) { $main.querySelector('#linkErr').innerHTML = '<div class="error">Dit is geen geldige koppellink. Kopieer de volledige link die je kreeg (met "#koppel=" erin).</div>'; return; }
      linkDevice(k);
      location.hash = '#meer';
      location.reload();
    };
    lf.onsubmit = (e) => { e.preventDefault(); tryLink(lf.elements.link.value); };
    $main.querySelector('[data-act=paste]')?.addEventListener('click', async () => {
      try { const t = await navigator.clipboard.readText(); lf.elements.link.value = t; tryLink(t); } catch { lf.elements.link.focus(); }
    });
  }
  const form = $main.querySelector('#adminSetup');
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    const url = form.elements.server.value.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(url)) { $main.querySelector('#setupErr').innerHTML = '<div class="error">Het adres moet met https:// beginnen.</div>'; return; }
    ctx.setServerUrl(url);
    ctx.setAdminKey(form.elements.key.value.trim());
    try {
      await ctx.googleStatus();
      location.reload();
    } catch (err) {
      ctx.setAdminKey('');
      $main.querySelector('#setupErr').innerHTML = `<div class="error">${esc(err.message)}</div>`;
    }
  };
}

function viewWho() {
  setNav('');
  const emps = alive(ctx.master().employees).filter((e) => e.active !== false).sort(byName);
  $main.innerHTML = `<section class="card">
    <h1>Wie ben jij?</h1>
    <p class="muted">Kies je naam. De app onthoudt dit op dit toestel. Heb je een koppellink gekregen? Open die dan, zo wordt ook de automatische registratie gekoppeld.</p>
    <div class="who">${emps.map((e) => `<button class="secondary" data-u="${esc(e.username)}">${esc(e.name)}</button>`).join('') || '<p class="muted" style="grid-column:1/-1">Nog geen werknemers. De beheerder voegt ze toe via <a href="#beheer/employees">Beheer</a>.</p>'}</div>
  </section>`;
  $main.querySelectorAll('[data-u]').forEach((b) => b.onclick = () => {
    lsSet(DEVICE, { username: b.dataset.u, token: null });
    syncNow();
    location.hash = '#dag';
    route();
  });
}

async function viewDay(date) {
  setNav('dag');
  const dev = device();
  const emp = alive(ctx.master().employees).find((e) => e.username === dev.username);
  $main.innerHTML = `<section class="card"><div class="datebar">
      <a class="icon" href="#dag/${shiftDate(date, -1)}" aria-label="Vorige dag">‹</a>
      <div><b>${esc(fmtDate(date))}</b>${date === today() ? ' <span class="pill red">vandaag</span>' : ''}
        <input type="date" id="dayPick" value="${date}" max="${today()}" aria-label="Kies een datum"></div>
      ${date < today() ? `<a class="icon" href="#dag/${shiftDate(date, 1)}" aria-label="Volgende dag">›</a>` : '<span class="icon" aria-hidden="true"></span>'}
    </div>${emp ? '' : '<p class="muted">Je naam staat niet (meer) in de lijst met werknemers.</p>'}
    <div class="row spread small muted" style="margin-top:8px"><span id="rawInfo"></span><button class="link" data-act="refresh">↻ Vernieuwen</button></div></section>
    <div id="dayBody"><p class="muted center">Laden…</p></div>`;
  $main.querySelector('#dayPick').onchange = (e) => { if (isDate(e.target.value)) location.hash = `#dag/${e.target.value}`; };
  $main.querySelector('[data-act=refresh]').onclick = () => { rawCache.delete(date); viewDay(date); };
  if (!store.has(PATHS.reg(date.slice(0, 7), dev.username))) await store.sync([PATHS.reg(date.slice(0, 7), dev.username)]);
  const { raw, error } = await fetchRaw(date);
  const body = $main.querySelector('#dayBody');
  if (!body) return;
  renderDay(body, { ctx, username: dev.username, date, raw, rawError: error });
  showRawInfo(raw);
  watchDay(date, raw);
}

/** Toon wanneer de automatische gegevens laatst opgehaald zijn en wat de laatste badge was */
function showRawInfo(raw) {
  const el = $main.querySelector('#rawInfo');
  if (!el) return;
  if (!raw) { el.textContent = ''; return; }
  const last = raw.badges?.at(-1)?.ts;
  el.textContent = `Bijgewerkt ${fmtClock(Date.now())}${last ? ` · laatste badge ${fmtClock(last)}` : ''}`;
}
const fmtClock = (ts) => new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }).format(new Date(ts));

/** Vandaag: elke minuut nieuwe badges en locaties ophalen en het dagscherm bijwerken als er iets veranderde */
let dayTimer = null;
function watchDay(date, raw) {
  clearInterval(dayTimer);
  if (date !== today() || !raw) return;
  const key = (r) => `${r?.points?.length ?? 0}|${r?.badges?.length ?? 0}|${r?.badges?.at(-1)?.ts ?? 0}`;
  let seen = key(raw);
  dayTimer = setInterval(async () => {
    if (location.hash.slice(1).split('/')[0] !== 'dag' || currentDate() !== date) { clearInterval(dayTimer); return; }
    if (document.visibilityState !== 'visible') return;
    const a = document.activeElement;
    if (a && ['INPUT', 'SELECT', 'TEXTAREA'].includes(a.tagName)) return; // niet storen tijdens typen
    rawCache.delete(date);
    const { raw: fresh, error } = await fetchRaw(date);
    if (!fresh) return;
    const body = $main.querySelector('#dayBody');
    if (!body) return;
    // ook zonder nieuwe badges opnieuw tekenen: een open atelierblok groeit mee met de tijd
    seen = key(fresh);
    renderDay(body, { ctx, username: device().username, date, raw: fresh, rawError: error });
    showRawInfo(fresh);
  }, 60000);
}

function viewPlanning() {
  setNav('planning');
  const dev = device();
  const m = ctx.master();
  const items = alive(ctx.planning().items).filter((p) => p.username === dev.username && p.date >= today()).sort((a, b) => a.date.localeCompare(b.date));
  const byDate = Object.groupBy ? Object.groupBy(items, (i) => i.date) : items.reduce((acc, i) => ((acc[i.date] ??= []).push(i), acc), {});
  $main.innerHTML = `<h1 class="page-title">Mijn planning</h1>
    ${Object.entries(byDate).map(([date, list]) => `<section class="card"><h2>${esc(fmtDate(date))}</h2>
      ${list.map((it) => {
        const p = m.projects.find((x) => x.id === it.projectId);
        const site = m.sites.find((s) => s.id === p?.site_id);
        return `<div class="plan-item"><div><b>${esc(projectLabel(p, m) || 'Onbekend project')}</b>
          ${site ? `<div class="muted">📍 ${esc(site.name)}${site.address ? ` · ${esc(site.address)}` : ''}</div>` : ''}
          ${it.note ? `<div>${esc(it.note)}</div>` : ''}</div>
          ${site?.lat != null ? `<a class="btn secondary" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${site.lat},${site.lon}">Route</a>` : ''}</div>`;
      }).join('')}</section>`).join('') || '<section class="card"><p class="muted">Er is niets ingepland voor jou.</p></section>'}`;
}

function viewHistory() {
  setNav('overzicht');
  const dev = device();
  const m = ctx.master();
  const rules = rulesFrom(m);
  const months = [today().slice(0, 7), shiftDate(`${today().slice(0, 7)}-01`, -1).slice(0, 7)];
  const days = [];
  for (const mo of months) {
    const reg = store.get(PATHS.reg(mo, dev.username), emptyReg(dev.username, mo));
    for (const [date, d] of Object.entries(reg.days)) days.push({ date, d, sum: summarize(d.segments ?? [], rules) });
  }
  days.sort((a, b) => b.date.localeCompare(a.date));
  const missing = [];
  for (let d = shiftDate(today(), -1), i = 0; i < 14; i++, d = shiftDate(d, -1)) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6 && !days.some((x) => x.date === d && x.d.status === 'bevestigd')) missing.push(d);
  }
  const totalMonth = days.filter((x) => x.date.startsWith(months[0]) && x.d.status === 'bevestigd').reduce((s, x) => s + x.sum.workMinutes, 0);
  $main.innerHTML = `<h1 class="page-title">Mijn overzicht</h1>
    <section class="card"><div class="stats"><div class="stat"><span>Bevestigd deze maand</span><b>${fmtHours(totalMonth)}</b></div>
      <div class="stat"><span>Werkdagen nog te bevestigen</span><b>${missing.length}</b></div></div>
      ${missing.length ? `<p class="muted">Nog te bevestigen (laatste 2 weken): ${missing.map((d) => `<a href="#dag/${d}">${esc(fmtDate(d, { weekday: 'short', day: 'numeric', month: 'short' }))}</a>`).join(', ')}</p>` : ''}
    </section>
    <section class="card table-wrap"><table><thead><tr><th>Dag</th><th>Arbeidstijd</th><th>Materiaal</th><th>Status</th></tr></thead><tbody>
      ${days.map(({ date, d, sum }) => `<tr class="click" data-date="${date}"><td>${esc(fmtDate(date, { weekday: 'short', day: 'numeric', month: 'short' }))}</td>
        <td>${fmtHours(sum.workMinutes)}</td><td>${(d.material ?? []).length || ''}</td>
        <td>${d.status === 'bevestigd' ? '<span class="pill ok">Bevestigd</span>' : '<span class="pill warn">Open</span>'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nog niets bewaard.</td></tr>'}
    </tbody></table></section>`;
  $main.querySelectorAll('[data-date]').forEach((tr) => tr.onclick = () => { location.hash = `#dag/${tr.dataset.date}`; });
}

function viewMore() {
  setNav('meer');
  const dev = device();
  const emp = alive(ctx.master().employees).find((e) => e.username === dev.username);
  const acc = driveA?.account;
  const server = ctx.serverUrl();
  $main.innerHTML = `<h1 class="page-title">Meer</h1>
    <section class="card"><h2>Ik ben</h2><p><b>${esc(emp?.name ?? dev.username)}</b> <span class="muted">(${esc(dev.username)})</span></p>
      <p class="muted">${dev.token ? '✔ Gekoppeld met de automatische registratie.' : 'Niet gekoppeld met de automatische registratie. Vraag de beheerder om je koppellink.'}</p>
      <button class="link" data-act="switch">Iemand anders kiezen</button></section>
    ${dev.token && !isStandalone() ? `<section class="card"><h2>App op je beginscherm</h2>
      ${isIOS() ? `<ol>
        <li>Tik in Safari onderaan op <b>Deel</b> (vierkantje met pijl) → <b>Zet op beginscherm</b>.</li>
        <li>Tik hieronder op <b>Kopieer koppellink</b>.</li>
        <li>Open de app via het nieuwe icoon op je beginscherm en tik op <b>Plakken</b> → <b>Koppelen</b>.</li>
      </ol>
      <p class="muted small">Op iPhone heeft de app op het beginscherm een eigen geheugen, los van Safari. Daarom moet je ze daar één keer opnieuw koppelen.</p>`
      : '<p>Menu (⋮) → <b>Toevoegen aan startscherm</b> of <b>App installeren</b>. Lukt het koppelen daarna niet, kopieer dan je koppellink en plak ze in de app.</p>'}
      <button class="secondary" data-act="copylink">Kopieer koppellink</button>
    </section>` : ''}
    ${dev.token && server ? `<section class="card"><h2>Automatische registratie (OwnTracks)</h2>
      <ol><li>Installeer de gratis app <b>OwnTracks</b> (App Store / Google Play).</li>
      <li>Tik hier: <a class="btn primary" href="${esc(owntracksLink(dev))}">OwnTracks instellen</a></li>
      <li>Geef OwnTracks locatietoegang <b>"Altijd"</b> en zet batterijbesparing voor OwnTracks uit.</li></ol>
      <p class="muted">Buiten de werkuren kan je OwnTracks op <b>Rustig</b> zetten. Je locatie wordt enkel gebruikt om je uren voor te stellen en na enkele weken gewist.</p>
      <details><summary>Manueel instellen</summary>
        <p class="muted small">Werkt de knop niet (bv. op iPhone)? Open OwnTracks → ⓘ → Instellingen, kies <b>Mode: HTTP</b>, zet <b>Authenticatie</b> aan en kopieer deze gegevens één voor één. Laat "Geheime coderingssleutel" leeg.</p>
        <div class="copy-list">
          ${[['URL', `${server}/api/owntracks`], ['Gebruikersnaam', dev.username], ['Wachtwoord', dev.token], ['Apparaat ID', 'gsm']].map(([label, value]) => `
          <div class="copy-row"><span class="muted small">${label}</span><code>${esc(value)}</code>
            <button class="secondary" data-copy="${esc(value)}">Kopieer</button></div>`).join('')}
        </div>
      </details>
    </section>` : ''}
    <section class="card"><h2>Opslag</h2>
      <p>${TEST ? 'Testmodus: gegevens staan enkel in deze browser.'
        : acc ? `${esc(STORE_NAME)}: <b>${esc(acc.username || acc.name)}</b>` : GOOGLE ? 'Google Drive (via de koppeling van de beheerder).' : 'Niet aangemeld.'}</p>
      <div class="row"><button class="secondary" data-act="sync">Nu synchroniseren</button>
      ${TEST ? '<button class="link danger" data-act="testreset">Testgegevens wissen</button>'
        : GOOGLE ? '<button class="link danger" data-act="unlink">Dit toestel ontkoppelen</button>' : '<button class="link danger" data-act="logout">Afmelden</button>'}</div>
    </section>
    <section class="card"><p class="muted small">Enautec Uren versie ${APP_VERSION} · <a href="privacy.html" target="_blank" rel="noopener">Privacy</a></p></section>`;
  $main.querySelector('[data-act=copylink]')?.addEventListener('click', async (e) => {
    await copyText(myKoppelLink());
    e.target.textContent = '✔ Gekopieerd';
    setTimeout(() => { e.target.textContent = 'Kopieer koppellink'; }, 1500);
  });
  $main.querySelectorAll('[data-copy]').forEach((b) => b.onclick = async () => {
    await copyText(b.dataset.copy);
    const old = b.textContent;
    b.textContent = '✔ Gekopieerd';
    setTimeout(() => { b.textContent = old; }, 1500);
  });
  $main.querySelector('[data-act=switch]').onclick = () => { if (confirm('Wil je een andere naam kiezen op dit toestel?')) { lsSet(DEVICE, null); location.hash = ''; route(); } };
  $main.querySelector('[data-act=sync]').onclick = async () => { rawCache.clear(); await syncNow(); toast(store.status === 'ok' ? 'Gesynchroniseerd' : store.lastError || 'Synchroniseren niet gelukt', store.status === 'ok' ? 'ok' : 'err'); };
  $main.querySelector('[data-act=logout]')?.addEventListener('click', () => {
    if (store.dirtyPaths().length && !confirm('Er zijn nog wijzigingen die niet in OneDrive staan. Toch afmelden?')) return;
    if (!confirm('Afmelden van OneDrive op dit toestel?')) return;
    auth.logout('A'); driveA = null; store.drive = null; route();
  });
  $main.querySelector('[data-act=unlink]')?.addEventListener('click', () => {
    if (store.dirtyPaths().length && !confirm('Er zijn nog wijzigingen die niet in Google Drive staan. Toch ontkoppelen?')) return;
    if (!confirm('Dit toestel ontkoppelen? Je hebt daarna opnieuw een koppellink nodig.')) return;
    lsSet(DEVICE, null);
    location.href = location.pathname;
  });
  $main.querySelector('[data-act=testreset]')?.addEventListener('click', () => {
    if (!confirm('Alle testgegevens in deze browser wissen?')) return;
    Object.keys(localStorage).filter((k) => k.startsWith('enautec.')).forEach((k) => localStorage.removeItem(k));
    location.href = location.pathname;
  });
}

/** Pincode van het beheer onthouden voor 12 uur op dit toestel */
const adminUnlocked = () => (lsGet(ADMIN_OK)?.until ?? 0) > Date.now();
const unlockAdmin = () => lsSet(ADMIN_OK, { until: Date.now() + 12 * 3600000 });

async function viewAdmin(tab) {
  if (!canAdmin()) {
    toast('Je hebt geen beheerrechten op dit toestel.', 'err');
    location.hash = '#dag';
    return;
  }
  setNav('beheer');
  const m = ctx.master();
  if (!adminUnlocked()) {
    const first = !m.settings?.adminPinHash;
    $main.innerHTML = `<section class="card narrow"><h1>Beheer</h1>
      <p class="muted">${first ? 'Stel een pincode in voor het beheer (4 tot 8 cijfers). Enkel de beheerder kent deze code.' : 'Geef de pincode van het beheer.'}</p>
      <form id="pinForm" class="row"><input name="pin" type="password" inputmode="numeric" autocomplete="${first ? 'new-password' : 'current-password'}" required placeholder="Pincode" aria-label="Pincode"><button class="primary">${first ? 'Instellen' : 'Openen'}</button></form>
      ${TEST ? '<p class="muted small">Testmodus: probeer pincode 1234 na het laden van de demo.</p>' : ''}
      <div id="pinErr"></div></section>
      ${TEST && !alive(m.employees).length ? '<section class="card narrow"><h2>Testmodus</h2><p class="muted">Laad fictieve klanten, projecten en werknemers om de app uit te proberen.</p><button class="secondary" data-act="demo">Demogegevens laden</button></section>' : ''}`;
    $main.querySelector('[data-act=demo]')?.addEventListener('click', async () => { await seedDemo(ctx); toast('Demogegevens geladen. Pincode: 1234', 'ok'); route(); });
    $main.querySelector('#pinForm').onsubmit = async (e) => {
      e.preventDefault();
      const pin = e.target.elements.pin.value;
      if (!/^\d{4,8}$/.test(pin)) { $main.querySelector('#pinErr').innerHTML = '<div class="error">Gebruik 4 tot 8 cijfers.</div>'; return; }
      const hash = await sha256(`enautec:${pin}`);
      if (first) {
        store.change(PATHS.master, EMPTY_MASTER(), (mm) => { mm.settings = { ...mm.settings, adminPinHash: hash, updated: Date.now() }; });
      } else if (hash !== m.settings.adminPinHash) {
        $main.querySelector('#pinErr').innerHTML = '<div class="error">Verkeerde pincode.</div>';
        return;
      }
      unlockAdmin();
      route();
    };
    return;
  }
  $main.innerHTML = '<h1 class="page-title">Beheer</h1><div id="adminRoot"></div>';
  admin.render($main.querySelector('#adminRoot'), tab);
}

/** Koppellink herkennen: "…#koppel=gebruiker.code&s=<server>" (ook als volledige link geplakt) */
function parseKoppel(text) {
  const m = String(text ?? '').trim().match(/#?koppel=([^.&\s]+)\.([^&\s]+)(?:&s=([^\s]+))?/);
  if (!m) return null;
  return { username: decodeURIComponent(m[1]), token: m[2], server: m[3] ? decodeURIComponent(m[3]) : null };
}

/** Dit toestel koppelen aan een werknemer */
function linkDevice({ username, token, server }) {
  lsSet(DEVICE, { username, token });
  lsSet(ME, null);
  if (server) ctx.setServerUrl(server);
  driveA = makeDriveA();
  store.drive = driveA;
}

/** Koppellink van dit toestel (om de app op het beginscherm te koppelen) */
function myKoppelLink() {
  const dev = device();
  if (!dev?.token) return '';
  return `${location.origin}${location.pathname}#koppel=${encodeURIComponent(dev.username)}.${dev.token}&s=${encodeURIComponent(serverUrl())}`;
}

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Bij de server nagaan of de gekoppelde werknemer beheerder is (op de achtergrond) */
async function refreshMe() {
  const dev = device();
  if (!dev?.token || !serverUrl()) return;
  try {
    const res = await fetch(`${serverUrl()}/api/me`, { headers: { Authorization: `Bearer ${dev.token}` } });
    if (!res.ok) return;
    const me = await res.json();
    const before = isAdminEmployee();
    lsSet(ME, me);
    if (before !== isAdminEmployee()) {
      if (!driveB) driveB = makeDriveB();
      const view = location.hash.slice(1).split('/')[0];
      if (view !== 'beheer') setNav(view || 'dag');
      else if (!canAdmin()) location.hash = '#dag';
    }
  } catch { /* offline: vorige toestand behouden */ }
}

// ---------- Opstarten ----------
async function start() {
  // Altijd eerst de werknemersweergave tonen (behalve bij terugkeer van Google of een koppellink)
  if (device() && !/^#(google|koppel)=/.test(location.hash) && !/^#(dag|planning|overzicht|meer)/.test(location.hash)) {
    history.replaceState(null, '', `${location.pathname}${location.search}#dag`);
  }
  let r = null;
  if (!GOOGLE && !TEST) {
    r = await auth.handleRedirect();
    if (r?.ok && r.slot === 'A') { driveA = new OneDrive('A'); store.drive = driveA; }
    if (r?.ok && r.slot === 'B') { driveB = new OneDrive('B'); toast('Verbonden met OneDrive facturatie', 'ok'); }
    if (r && !r.ok && !r.silent) toast(r.error, 'err');
  }

  // Terug van Google na koppelen: #google=ok|fout&slot=A&msg=…
  const gm = location.hash.match(/^#google=(ok|fout)&slot=([AB])(?:&msg=(.*))?$/);
  if (gm) {
    history.replaceState(null, '', `${location.pathname}${location.search}${gm[2] === 'B' ? '#beheer/export' : '#beheer/instellingen'}`);
    if (gm[1] === 'ok') toast(gm[2] === 'A' ? 'Google Drive gekoppeld' : 'Google Drive facturatie gekoppeld', 'ok');
    else toast(`Koppelen mislukt: ${decodeURIComponent(gm[3] ?? '')}`, 'err');
  }

  // Koppellink: #koppel=gebruikersnaam.code&s=<serveradres>
  const km = parseKoppel(location.hash);
  if (km) {
    linkDevice(km);
    history.replaceState(null, '', `${location.pathname}${location.search}#meer`);
    toast('Toestel gekoppeld. Stel nu OwnTracks in.', 'ok');
  }

  if (!GOOGLE && driveA && !TEST && auth.needsInteractive('A')) {
    if (r?.silent && !r.ok) showStatus('login');
    else if (await auth.trySilentRenew('A')) return; // pagina gaat even naar Microsoft
  }

  if (!driveA) { viewWelcome(r && !r.ok && r.slot === 'A' ? r.error : ''); return; }

  // Beheerder zonder werknemerskoppeling: eerst Google Drive koppelen als dat nog niet gebeurd is
  if (GOOGLE && !TEST && !device()) {
    try {
      const gs = await ctx.googleStatus();
      if (!gs.A) { viewWelcome(); return; }
    } catch (e) { viewWelcome(e.message); return; }
  }

  window.addEventListener('hashchange', route);
  if (!store.has(PATHS.master)) $main.innerHTML = `<p class="muted center">Gegevens ophalen uit ${esc(STORE_NAME)}…</p>`;
  await syncNow();
  if (GOOGLE && store.status === 'login' && !device()?.token && !adminKey()) { viewWelcome(); return; }
  route();
  refreshMe();

  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    rawCache.clear();
    syncNow();
    // terug in de app op het dagscherm: meteen de nieuwste badges en locaties tonen
    if (location.hash.slice(1).split('/')[0] === 'dag' || location.hash === '' || location.hash === '#') route();
  });
  window.addEventListener('online', syncNow);
  $status.onclick = () => {
    if (store.status === 'login' && !GOOGLE) auth.login('A');
    else if (store.status === 'login') toast(store.lastError || 'Google Drive is niet gekoppeld. Vraag het aan de beheerder.', 'err');
    else syncNow();
  };
}

// Offline-module + updates (op localhost enkel als 'enautec.swtest' aan staat, om te testen)
if (!LOCAL || localStorage.getItem('enautec.swtest') === '1') initUpdates();
if (TEST) document.documentElement.classList.add('test');
start().catch((e) => { $main.innerHTML = `<div class="card error">${esc(e.message)}</div>`; });

export { copyText };
