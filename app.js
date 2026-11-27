// Enautec Uren – hoofdmodule: opstarten, aanmelden, navigatie en de schermen voor de werknemer.
import { MS_CLIENT_ID, APP_VERSION, STORAGE, SERVER_URL } from './config.js';
import * as auth from './auth.js';
import { OneDrive, TestDrive } from './drive.js';
import { GoogleDrive } from './gdrive.js';
import { Store, PATHS, EMPTY_MASTER } from './store.js';
import { renderDay, emptyReg, rulesFrom, wireNeeds } from './day.js';
import { Admin } from './admin.js';
import { summarize } from './engine.js';
import { today, shiftDate, fmtDate, isDate, fmtHours } from './time.js';
import { esc, alive, byName, projectLabel, toast, sha256, copyText, info, iosGroup, iosRow, iosPageHead, initials } from './ui.js';
import { seedDemo } from './demo.js';
import { initUpdates, confirmDialog } from './update.js';
import { weekHtml, monthHtml, yearHtml, ensureMonths, openDays, openDaysButton } from './report.js';
import { initCombos } from './combo.js';
import { renderTodo } from './todo.js';
import { planningHtml, NAV_APPS, defaultNav } from './calendar.js';
import { weekStart, shiftMonth } from './periods.js';
import { pushSupport, enablePush, disablePush, currentSubscription, syncPlaces, syncPlanning, renderQuestion } from './questions.js';
import { renderSetup, installHtml, autoOpenHtml, owntracksGuideHtml } from './setup.js';

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

// ---------- Voorkeuren van dit toestel (achtergrond, tellers op het dagscherm) ----------
const PREFS = 'enautec.prefs';
/** Bezig met de open dagen een voor een te bevestigen (knop in het overzicht) */
const CONFIRM_RUN = 'enautec.confirmRun';
const prefs = () => lsGet(PREFS, {}) ?? {};
const applyTheme = () => {
  const t = prefs().theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
};
function setPref(k, v) { lsSet(PREFS, { ...prefs(), [k]: v }); if (k === 'theme') applyTheme(); }
applyTheme();

// typen op een gsm: de onderste balk verbergen (het toetsenbord duwt hem anders midden op het scherm)
document.addEventListener('focusin', (e) => {
  if (e.target.matches?.('input:not([type=checkbox]):not([type=radio]), textarea, select')) document.body.classList.add('typing');
});
document.addEventListener('focusout', () => setTimeout(() => {
  const a = document.activeElement;
  if (!a?.matches?.('input:not([type=checkbox]):not([type=radio]), textarea, select')) document.body.classList.remove('typing');
}, 50));

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
  if (isAdminEmployee()) return { Authorization: `Bearer ${device().session}` };
  return null;
}

/** Toegangstokens voor Google Drive, verkregen via de verzamelserver */
function googleTokens(slot) {
  let cache = null;
  return async (force = false) => {
    if (!force && cache && Date.now() < cache.exp - 60000) return cache;
    const dev = device();
    const authHdr = slot === 'A' && dev?.session ? { Authorization: `Bearer ${dev.session}` } : adminHeaders();
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

const hasGoogleAccess = () => !!serverUrl() && !!(device()?.session || adminKey());

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
  prefs,
  /**
   * Dag bevestigd (of "niet gewerkt"): kwam je via de knop "nog niet bevestigd", dan meteen
   * naar de volgende open dag; zijn ze allemaal klaar, terug naar het overzicht.
   */
  afterConfirm: (date) => {
    let run = false;
    try { run = sessionStorage.getItem(CONFIRM_RUN) === '1'; } catch { /* geblokkeerd */ }
    if (!run) return;
    const next = openDays(ctx, device().username).find((d) => d !== date);
    if (next) {
      toast(`Volgende open dag: ${fmtDate(next)}`, 'ok');
      setTimeout(() => { location.hash = `#dag/${next}`; }, 600);
    } else {
      try { sessionStorage.removeItem(CONFIRM_RUN); } catch { /* geblokkeerd */ }
      toast('✔ Alle dagen zijn bevestigd', 'ok');
      setTimeout(() => { location.hash = '#overzicht'; }, 900);
    }
  },
  /** Standaardpauze (minuten) van de aangemelde werknemer: lokaal meteen, op de server voor de meldingen */
  setPauseMin: (min) => {
    lsSet(ME, { ...(lsGet(ME) ?? {}), pauseMin: min });
    const s = device()?.session;
    if (s) postJson('/api/me/pause', { minutes: min }, s).catch((e) => toast(e.message, 'err'));
  },
  /** Dag als "niet gewerkt" (of terug open) doorgeven: dan stuurt de server die dag geen vragen meer */
  /** Materiaal uit de planning: wat is al ingeladen (gedeeld per project), en afvinken */
  checks: async (date) => {
    const s = device()?.session;
    if (!s || !serverUrl()) return null;
    const r = await fetch(`${serverUrl()}/api/checks?date=${date}`, { headers: { Authorization: `Bearer ${s}` } });
    return r.ok ? r.json() : null;
  },
  /** Via het widget toegevoegd materiaal (de app neemt het op in de planning) */
  needAdds: async (date) => {
    const s = device()?.session;
    if (!s || !serverUrl()) return null;
    const r = await fetch(`${serverUrl()}/api/needs/added?date=${date}`, { headers: { Authorization: `Bearer ${s}` } });
    return r.ok ? r.json() : null;
  },
  setCheck: (body) => {
    const s = device()?.session;
    if (!s) return Promise.reject(new Error('Niet aangemeld.'));
    return postJson('/api/checks', body, s);
  },
  /** Badgen met de gsm (vergeten te badgen in het atelier); daarna de dag opnieuw ophalen */
  badge: async () => {
    const s = device()?.session;
    if (!s) throw new Error('Niet aangemeld.');
    const r = await postJson('/api/me/badge', {}, s);
    rawCache.clear();
    route();
    return r;
  },
  notWorked: (date, on) => {
    const s = device()?.session;
    if (s) postJson('/api/questions/day', { date, notWorked: !!on }, s).catch(() => {});
    rawCache.delete(date);
  },
  sessionsHtml: (list, opts) => sessionsHtml(list, opts),
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
  if (!dev?.session || !url) return { raw: null, error: '' };
  const hit = rawCache.get(date);
  if (hit && Date.now() - hit.at < 60000) return hit.value;
  let value;
  try {
    const res = await fetch(`${url}/api/raw?date=${date}`, { headers: { Authorization: `Bearer ${dev.session}` } });
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
/** OwnTracks heeft een eigen wachtwoord (niet het app-wachtwoord); de app krijgt het van de server */
function owntracksLink(ot) {
  const conf = {
    _type: 'configuration', mode: 3, url: `${ctx.serverUrl()}/api/owntracks`, auth: true,
    username: ot.username, password: ot.password, deviceId: 'gsm',
    tid: ot.username.replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase() || 'XX',
    monitoring: 1, locatorDisplacement: 100, locatorInterval: 180, pubExtendedData: true,
    cmd: true, // de server mag de zones (klanten in de buurt) doorsturen die OwnTracks zelf bewaakt
  };
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(conf))));
  return `owntracks:///config?inline=${encodeURIComponent(b64)}`;
}

// ---------- Synchroniseren ----------
function myPaths(date = today()) {
  const paths = [PATHS.master, PATHS.planning, PATHS.todos];
  const dev = device();
  if (dev?.username) {
    const months = new Set([date.slice(0, 7), today().slice(0, 7), shiftDate(`${today().slice(0, 7)}-01`, -1).slice(0, 7)]);
    for (const m of months) paths.push(PATHS.reg(m, dev.username));
  }
  return paths;
}
const syncNow = () => store.sync(myPaths(currentDate())).then((r) => { pushPlaces(); return r; });

/** Zones/klanten/projecten naar de server (voor het herkennen van aankomsten) */
function pushPlaces() {
  const hdr = device()?.session ? { Authorization: `Bearer ${device().session}` } : adminHeaders();
  if (store.has(PATHS.master)) syncPlaces(ctx.master(), ctx.serverUrl(), hdr);
  if (store.has(PATHS.planning)) syncPlanning(ctx.planning(), ctx.serverUrl(), hdr);
}

let rerenderTimer;
// tik op een pushmelding terwijl de app al open staat → naar de vraag
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.type === 'OPEN' && typeof e.data.url === 'string') {
    const u = new URL(e.data.url, location.href);
    if (u.origin === location.origin) location.hash = u.hash;
  }
});

// stamgegevens gewijzigd (hier of elders) → zones ook naar de server
let placesTimer = null;
store.onChange((path) => {
  if (path !== PATHS.master && path !== PATHS.planning) return;
  clearTimeout(placesTimer);
  placesTimer = setTimeout(pushPlaces, 3000);
});
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
  const items = [['dag', 'Dag', '🕒'], ['planning', 'Planning', '📅'], ['overzicht', 'Overzicht', '📋'], ['todo', 'ToDo', '✅'], ['meer', 'Meer', '⚙']];
  $nav.innerHTML = items.map(([k, label, icon]) => `<a href="#${k}" class="${k === active ? 'active' : ''}"><span aria-hidden="true">${icon}</span>${label}</a>`).join('');
  $nav.hidden = adminView || !dev || (!store.drive && !TEST);
  document.body.classList.toggle('admin-mode', adminView);
  if (adminView && (dev?.session || adminKey())) {
    // zonder werknemerssessie (enkel beheersleutel) leidt de knop naar het aanmeldscherm
    $switch.hidden = false;
    $switch.href = '#dag';
    $switch.innerHTML = '<span aria-hidden="true">👤</span> Werknemer';
    $switch.title = dev?.session ? 'Terug naar je eigen uren' : 'Aanmelden als werknemer';
  } else if (!adminView && dev?.session && canAdmin()) {
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
  const hasSession = !!dev?.session;
  if (GOOGLE || TEST) {
    // niet aangemeld: enkel een beheerder met beheersleutel mag (naar het beheer); anders aanmelden
    // (de beheersleutel geeft enkel toegang tot het beheer; de werknemersweergave vraagt altijd aanmelden)
    if (!hasSession) return adminKey() && view === 'beheer' ? viewAdmin(rest[0] || 'overzicht') : viewLogin();
    // eerste keer aangemeld op een gsm: eerst de verplichte stappen
    // vanuit Meer geopend en de werknemer tikt een ander tabblad aan: de stap sluiten
    const ss = lsGet(SETUP);
    if (ss?.from && !ss.done && location.hash !== ss.from) lsSet(SETUP, { ...ss, done: true, step: null, only: null, from: null });
    if (needsSetup()) return viewSetup();
  } else if (!dev) return viewWho();
  if (view === 'beheer') return viewAdmin(rest[0] || 'overzicht');
  if (view === 'planning') return viewPlanning(rest);
  if (view === 'todo') { setNav('todo'); return renderTodo($main, { ctx }); }
  if (view === 'overzicht') return viewHistory(rest);
  if (view === 'meer') return viewMore(rest[0] ?? '');
  if (view === 'vraag') return viewQuestion(rest[0]);
  if (view === 'owntracks') return viewOwnTracks();
  return viewDay(isDate(rest[0]) ? rest[0] : today(), rest[1] ?? null);
}

// ---------- Eerste keer op een gsm ----------
// Op een gsm kan je enkel aanmelden in de app op het beginscherm (iPhone: Safari en de app op het
// beginscherm hebben elk hun eigen opslag). Na de eerste aanmelding volgen verplichte stappen.
const SETUP = 'enautec.setup';
let installPrompt = null;
let appInstalled = false;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if ($main.querySelector('.setup')) route();
});
window.addEventListener('appinstalled', () => { appInstalled = true; installPrompt = null; if ($main.querySelector('.setup')) route(); });

const needsInstall = () => isMobile() && !isStandalone() && !device()?.session && !adminKey();
function needsSetup() {
  const dev = device();
  const s = lsGet(SETUP);
  if (!isMobile() || !dev?.session || s?.username !== dev.username) return false;
  // nieuwe stap voor wie al ingesteld was (iPhone): OwnTracks automatisch openen, één keer tonen
  if (s.done && isIOS() && !s.auto && !s.autoAsked) {
    lsSet(SETUP, { ...s, done: false, step: 'auto', optional: true, only: 'auto', autoAsked: true });
    return true;
  }
  return !s.done;
}

function viewInstall() {
  setNav('');
  $nav.hidden = true;
  $switch.hidden = true;
  showStatus('local');
  $main.innerHTML = installHtml({ ios: isIOS(), canPrompt: !!installPrompt, installed: appInstalled });
  $main.querySelector('[data-act=install]')?.addEventListener('click', async () => {
    const p = installPrompt;
    if (!p) return;
    p.prompt();
    const { outcome } = await p.userChoice.catch(() => ({}));
    if (outcome === 'accepted') appInstalled = true;
    installPrompt = null;
    viewInstall();
  });
  $main.querySelectorAll('[data-copy]').forEach((b) => b.onclick = async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = '✔ Link gekopieerd'; } catch { prompt('Kopieer deze link:', b.dataset.copy); }
  });
}

function viewSetup() {
  const dev = device();
  const me = lsGet(ME) ?? {};
  const back = lsGet(SETUP)?.from ?? null; // geopend vanuit Meer: daar terugkeren, onderste balk blijft
  setNav(back ? 'meer' : '');
  $nav.hidden = !back;
  $switch.hidden = true;
  renderSetup($main, {
    server: serverUrl(), session: dev.session, name: me.name ?? dev.username, ios: isIOS(),
    deviceKey: localDeviceKey, deviceLabel, owntracksLink,
    optional: !!lsGet(SETUP)?.optional,
    back,
    getState: () => lsGet(SETUP),
    setState: (st) => lsSet(SETUP, st),
    onDone: () => {
      lsSet(SETUP, { ...(lsGet(SETUP) ?? {}), from: null });
      if (back) { if (location.hash === back) route(); else location.hash = back; return; }
      toast('Je gsm is ingesteld', 'ok');
      if (location.hash === '#dag') route(); else location.hash = '#dag';
    },
  });
}

/** Stappen (opnieuw) starten vanuit Meer, bv. om het widget in te stellen; terug = naar die pagina in Meer */
function startSetup(step, only = false) {
  lsSet(SETUP, { ...(lsGet(SETUP) ?? {}), username: device().username, done: false, step, optional: true, only: only ? step : null, from: location.hash.startsWith('#meer') ? location.hash : '#meer' });
  route();
}

/** Na de melding "OwnTracks staat niet aan?": OwnTracks openen */
function viewOwnTracks() {
  setNav('dag');
  $main.innerHTML = `<section class="card setup">
    <h1>📍 OwnTracks openen</h1>
    <p>Er kwam vandaag nog geen locatie van je gsm binnen. Waarschijnlijk is OwnTracks afgesloten (weggeveegd uit het app-overzicht). Open het even; daarna mag je gewoon terugkeren.</p>
    <a class="btn primary big" href="owntracks:///">📍 OwnTracks openen</a>
    ${isIOS() ? `<details><summary>Zo opent je iPhone OwnTracks voortaan zelf</summary>${autoOpenHtml()}</details>` : ''}
    <p class="center"><a href="#dag">Naar vandaag</a></p>
  </section>`;
}

// ---------- Schermen ----------
function viewWelcome(message = '') {
  setNav('');
  $nav.hidden = true;
  showStatus('local');
  if (GOOGLE || TEST) return viewLogin(message);
  $main.innerHTML = `<section class="card welcome">
    <img src="logo.svg" alt="Enautec – Automatisatie &amp; elektrotechnieken" class="welcome-logo">
    <h1>Urenregistratie</h1>
    <p>Meld je aan met het <b>gedeelde Microsoft-account van Enautec</b>. Je uren, planning en materiaal worden in OneDrive bewaard.</p>
    ${message ? `<div class="error">${esc(message)}</div>` : ''}
    ${MS_CLIENT_ID ? `<button class="primary big" data-act="login">Aanmelden met Microsoft</button>${info('Vink bij Microsoft "Aangemeld blijven" aan, dan hoef je dit niet opnieuw te doen.')}`
      : '<div class="notice">De app is nog niet gekoppeld aan Microsoft. Beheerder: vul MS_CLIENT_ID in (zie HANDLEIDING.md).</div>'}
    ${LOCAL ? '<p><a href="?test=1">Testmodus starten (zonder Microsoft)</a></p>' : ''}
  </section>`;
  $main.querySelector('[data-act=login]')?.addEventListener('click', () => auth.login('A'));
}

/** Beschrijving van dit toestel voor de lijst "aangemelde toestellen", bv. "iPhone · Safari (app)" */
function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Onbekend';
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox|FxiOS/.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'browser';
  return `${os} · ${browser}${isStandalone() ? ' (app)' : ''}`;
}
const isMobile = () => isIOS() || /Android|Mobile/.test(navigator.userAgent);
const deviceInfo = () => ({ device: deviceLabel(), type: isMobile() ? 'mobiel' : 'computer', deviceKey: localDeviceKey() ?? undefined });

async function postJson(path, body, token) {
  const res = await fetch(`${serverUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `Server: fout ${res.status}`), { status: res.status, data });
  return data;
}

/** Gebruikers die zich op dit toestel aanmeldden (keuzelijst op het aanmeldscherm; geen wachtwoorden) */
const USERS = 'enautec.users';
const knownUsers = () => (Array.isArray(lsGet(USERS)) ? lsGet(USERS) : []);
function rememberUser(username, name) {
  if (!username) return;
  const old = knownUsers().find((u) => u.username === username);
  lsSet(USERS, [{ username, name: name ?? old?.name ?? username }, ...knownUsers().filter((u) => u.username !== username)].slice(0, 20));
}
function forgetUser(username) {
  lsSet(USERS, knownUsers().filter((u) => u.username !== username));
}

/** Aangemeld: sessie op dit toestel bewaren */
function signedIn({ session, username, name, isAdmin, mustChange }) {
  rememberUser(username, name);
  // eerste keer op deze gsm (of een andere gebruiker): verplichte stappen
  if (isMobile() && lsGet(SETUP)?.username !== username) lsSet(SETUP, { username, done: false, step: 'push' });
  if (isMobile() && lsGet(SETUP)?.username === username && !lsGet(SETUP).done) lsSet(SETUP, { ...lsGet(SETUP), optional: false });
  lsSet(DEVICE, { username, session });
  lsSet(ME, { username, name, isAdmin, mustChange: !!mustChange });
  lsSet(ADMIN_OK, null);
  location.hash = '#dag';
  location.reload();
}

// ---------- Toestelkeuze ----------
// Een browser kan niet zien op welk toestel hij draait (geen MAC-adres). Daarom vraagt de app bij de
// eerste aanmelding in een nieuwe browser één keer welk toestel dit is; browsers op hetzelfde toestel
// delen dan een toestelsleutel en staan in de lijst als één toestel.
const DEVICE_KEY = 'enautec.deviceKey';
const localDeviceKey = () => { try { return localStorage.getItem(DEVICE_KEY); } catch { return null; } };
const setLocalDeviceKey = (k) => { try { k ? localStorage.setItem(DEVICE_KEY, k) : localStorage.removeItem(DEVICE_KEY); } catch { /* geblokkeerd */ } };
const newDeviceKey = () => `t${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(2)).join('').slice(0, 12)}`;
const defaultDeviceName = () => {
  const os = deviceLabel().split(' · ')[0];
  const me = lsGet(ME)?.name?.split(' ')[0];
  const kind = isMobile() ? (os === 'iPhone' || os === 'iPad' ? os : `${os}-gsm`) : os === 'Mac' ? 'Mac' : 'Laptop';
  return me ? `${kind} ${me}` : kind;
};

let deviceAsked = false;
/** Na het aanmelden (of bij het opstarten): weet de server bij welk toestel deze browser hoort? */
async function ensureDevice({ force = false } = {}) {
  const dev = device();
  if ((deviceAsked && !force) || !dev?.session) return;
  deviceAsked = true;
  let list;
  try {
    const res = await fetch(`${serverUrl()}/api/sessions`, { headers: { Authorization: `Bearer ${dev.session}` } });
    if (!res.ok) { deviceAsked = false; return; }
    list = await res.json();
  } catch { deviceAsked = false; return; }
  const cur = list.find((s) => s.current);
  if (!cur) return;
  const save = async (key, name, join) => {
    setLocalDeviceKey(key);
    try { await postJson('/api/me/device', { key, name, ...(join ? { join } : {}) }, dev.session); } catch (e) { toast(e.message, 'err'); }
  };
  if (!force) {
    if (cur.deviceKey && cur.deviceName) { if (!localDeviceKey()) setLocalDeviceKey(cur.deviceKey); return; }
    // deze browser kent zijn toestel al (bv. een collega meldt zich aan op dezelfde laptop)
    const key = localDeviceKey();
    if (key) return save(key, list.find((s) => s.deviceKey === key && s.deviceName)?.deviceName ?? defaultDeviceName());
  }
  // andere toestellen van deze werknemer (met sleutel, of oudere aanmeldingen per soort toestel)
  const others = new Map();
  for (const s of list) {
    if (s.current) continue;
    const id = s.deviceKey ?? `s${s.id}`;
    const o = others.get(id) ?? { key: s.deviceKey, join: s.deviceKey ? null : s.id, name: s.deviceName ?? s.device, type: s.type, browsers: new Set(), lastSeen: 0 };
    o.browsers.add(String(s.device ?? '').split(' · ')[1] ?? '');
    o.lastSeen = Math.max(o.lastSeen, s.lastSeen);
    others.set(id, o);
  }
  const options = [...others.values()].sort((a, b) => (a.type === cur.type ? -1 : 1) - (b.type === cur.type ? -1 : 1) || b.lastSeen - a.lastSeen);
  if (!options.length && !force) return save(newDeviceKey(), defaultDeviceName());

  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<form class="modal device-pick" role="dialog" aria-modal="true" aria-labelledby="dpTitle">
      <h2 id="dpTitle">Welk toestel is dit?${info('Ben je op dit toestel al aangemeld in een andere browser of in de app? Kies het dan, zodat het maar één keer in de lijst staat.')}</h2>
      <p class="muted small">Je bent aangemeld in <b>${esc(cur.device ?? 'een nieuwe browser')}</b>.</p>
      ${options.map((o, i) => `<label class="device-opt"><input type="radio" name="dev" value="${i}">
        <span><b>${o.type === 'mobiel' ? '📱' : '💻'} ${esc(o.name)}</b><small class="muted">${esc([...o.browsers].filter(Boolean).join(', '))}</small></span></label>`).join('')}
      <label class="device-opt"><input type="radio" name="dev" value="new" ${options.length ? '' : 'checked'}>
        <span><b>➕ Een ander toestel</b><small class="muted">nog niet in de lijst</small></span></label>
      <label class="q-field" id="dpNameBox"><span>Naam van dit toestel</span><input name="name" maxlength="40" value="${esc(cur.deviceName ?? defaultDeviceName())}"></label>
      <div class="row modal-actions"><button class="primary">Bewaren</button></div>
    </form>`;
  document.body.append(wrap);
  const f = wrap.querySelector('form');
  const sync = () => { wrap.querySelector('#dpNameBox').style.display = f.elements.dev.value === 'new' ? '' : 'none'; };
  f.onchange = sync;
  sync();
  await new Promise((done) => {
    f.onsubmit = async (e) => {
      e.preventDefault();
      const v = f.elements.dev.value;
      if (!v) return toast('Kies een toestel.', 'err');
      if (v === 'new') {
        const name = f.elements.name.value.trim();
        if (!name) return f.elements.name.focus();
        await save(newDeviceKey(), name);
      } else {
        const o = options[Number(v)];
        await save(o.key ?? newDeviceKey(), o.key ? o.name : defaultDeviceName(), o.join);
      }
      wrap.remove();
      toast('Toestel bewaard', 'ok');
      done();
    };
  });
}

/** Afmelden op dit toestel */
async function signOut() {
  const dev = device();
  try { if (dev?.session) await postJson('/api/logout', {}, dev.session); } catch { /* offline: toch lokaal afmelden */ }
  lsSet(DEVICE, null);
  lsSet(ME, null);
  lsSet(ADMIN_OK, null);
  location.hash = '';
  location.reload();
}

/** Startscherm: aanmelden met gebruikersnaam en wachtwoord (of beheerder met beheersleutel) */
async function viewLogin(message = '') {
  if (needsInstall()) return viewInstall();
  setNav('');
  $nav.hidden = true;
  showStatus('local');
  let dev = device();
  let legacy = dev?.token && !dev.session; // toestel van vóór het aanmelden met wachtwoord
  if (legacy) {
    // al een wachtwoord gekozen (bv. op een ander toestel)? Dan gewoon aanmelden, niet opnieuw kiezen.
    try {
      const res = await fetch(`${serverUrl()}/api/password`, { headers: { Authorization: `Bearer ${dev.token}` } });
      const st = await res.json().catch(() => ({}));
      if (res.status === 401 || st.hasPassword) {
        dev = { username: dev.username };
        lsSet(DEVICE, dev);
        legacy = false;
        if (!message && st.hasPassword) message = 'Je hebt al een wachtwoord. Meld je hier aan met je gebruikersnaam en wachtwoord.';
      }
    } catch { /* geen verbinding: formulier tonen, de server controleert bij het bewaren */ }
  }
  const isKeyAdmin = !!adminKey() && !!serverUrl() && !dev?.session && !legacy;
  if (dev?.username) rememberUser(dev.username);
  // alle gebruikers van de server (keuzelijst, zoekbaar); zonder verbinding: wie hier al aanmeldde
  let serverUsers = [];
  if (!legacy && serverUrl()) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(`${serverUrl()}/api/login/users`, { signal: ctl.signal });
      clearTimeout(timer);
      if (r.ok) serverUsers = await r.json();
    } catch { /* offline */ }
  }
  const known = knownUsers();
  const users = serverUsers.length ? serverUsers : known;
  const pick = dev?.username ?? known[0]?.username ?? '__none';
  let gs = null;
  let gsErr = '';
  if (isKeyAdmin && !TEST) { try { gs = await ctx.googleStatus(); } catch (e) { gsErr = e.message; } }
  $main.innerHTML = `<section class="card welcome">
    <img src="logo.svg" alt="Enautec – Automatisatie &amp; elektrotechnieken" class="welcome-logo">
    <h1>Urenregistratie</h1>
    ${message ? `<div class="error">${esc(message)}</div>` : ''}
    ${legacy ? `
      <p>Hallo <b>${esc(dev.username)}</b>. Vanaf nu meld je je aan met je gebruikersnaam en een <b>wachtwoord</b>. Kies hier je wachtwoord (minstens 8 tekens).</p>
      <form id="pwForm" class="link-form">
        <input name="pw1" type="password" autocomplete="new-password" placeholder="Nieuw wachtwoord" required minlength="8" aria-label="Nieuw wachtwoord">
        <input name="pw2" type="password" autocomplete="new-password" placeholder="Herhaal wachtwoord" required minlength="8" aria-label="Herhaal wachtwoord">
        <div class="row"><button class="primary">Wachtwoord instellen</button></div>
      </form><div id="pwErr"></div>`
    : `
      <form id="loginForm" class="link-form">
        ${users.length ? `<select name="pick" aria-label="Gebruiker">
          ${users.some((u) => u.username === pick) ? '' : '<option value="__none" selected hidden>— kies je naam (typ om te zoeken) —</option>'}
          ${users.map((u) => `<option value="${esc(u.username)}" ${u.username === pick ? 'selected' : ''}>${esc(u.name && u.name !== u.username ? `${u.name} (${u.username})` : u.username)}</option>`).join('')}
          <option value="">Andere gebruiker…</option>
        </select>` : ''}
        <input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Gebruikersnaam" aria-label="Gebruikersnaam" ${users.length ? 'hidden' : 'required'}>
        <input name="password" type="password" autocomplete="current-password" placeholder="Wachtwoord" required aria-label="Wachtwoord">
        <button class="primary big">Aanmelden</button>
      </form><div id="loginErr"></div>
      ${users.length && !serverUsers.length ? '<p class="small"><button type="button" class="link" data-act="forgetuser">Deze gebruiker uit de lijst verwijderen</button></p>' : ''}
      <p class="muted small">Aangemeld blijven${info('Je blijft aangemeld op dit toestel tot je zelf afmeldt (Meer → Afmelden). Gebruik je het toestel van een collega? Meld je daarna af.')}
        · Wachtwoord vergeten?${info('Vraag een beheerder om een nieuw wachtwoord. Daarna kan je het zelf wijzigen via Meer → Wachtwoord wijzigen.')}</p>
      ${TEST ? '<p class="muted small">Testmodus: gebruiker <b>tomas</b>, <b>ruben</b> of <b>philippe</b>, wachtwoord <b>demo1234</b>.</p>' : ''}
      ${isKeyAdmin ? `<section class="key-admin">
        <h2>Beheer met beheersleutel</h2>
        ${gsErr ? `<div class="error">${esc(gsErr)}</div>` : ''}
        ${gs && !gs.configured ? '<div class="notice">Google is nog niet ingesteld op de server (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). Zie HANDLEIDING.md.</div>' : ''}
        ${gs?.configured && !gs.A ? `<p>Koppel nu het <b>Google-account van Enautec Uren</b>. Daar worden de uren, planning en het materiaal bewaard.</p>
          <button class="primary" data-act="connect">Koppelen met Google Drive</button>` : ''}
        ${gs?.A ? `<p class="small">✔ Gekoppeld met <b>${esc(gs.A.email ?? 'Google Drive')}</b>.</p>` : ''}
        ${gs?.A || TEST ? '<a class="btn secondary" href="#beheer">Naar beheer (zonder aanmelden)</a>' : ''}
        <p><button class="link" data-act="forget">Beheersleutel van dit toestel wissen</button></p>
      </section>` : `<details><summary>Beheerder met beheersleutel</summary>
        <form id="adminSetup" class="form-grid" style="text-align:left">
          <label><span>Adres van de verzamelserver</span><input name="server" required placeholder="https://enautec-uren.….workers.dev" value="${esc(serverUrl())}"></label>
          <label><span>Beheersleutel (ADMIN_KEY)</span><input name="key" type="password" required autocomplete="off"></label>
          <div><button class="primary">Verbinden</button></div>
        </form><div id="setupErr"></div>
      </details>`}`}
    ${LOCAL && !TEST ? '<p><a href="?test=1">Testmodus starten</a></p>' : ''}
  </section>`;

  $main.querySelector('[data-act=connect]')?.addEventListener('click', () => ctx.connectGoogle('A').catch((e) => toast(e.message, 'err')));
  $main.querySelector('[data-act=forget]')?.addEventListener('click', () => { ctx.setAdminKey(''); location.reload(); });

  const lf = $main.querySelector('#loginForm');
  const sel = lf?.elements.pick;
  if (sel) {
    const other = () => {
      const isOther = sel.value === '';
      lf.elements.username.hidden = !isOther;
      lf.elements.username.required = isOther;
      if (isOther) lf.elements.username.focus(); else if (sel.value !== '__none') lf.elements.password.focus();
      const fu = $main.querySelector('[data-act=forgetuser]');
      if (fu) fu.hidden = isOther;
    };
    sel.onchange = other;
    $main.querySelector('[data-act=forgetuser]')?.addEventListener('click', () => {
      if (!sel.value || !confirm(`${sel.selectedOptions[0].textContent} uit de lijst op dit toestel verwijderen?`)) return;
      forgetUser(sel.value);
      if (device()?.username === sel.value) lsSet(DEVICE, null);
      viewLogin();
    });
  }
  if (lf) lf.onsubmit = async (e) => {
    e.preventDefault();
    const btn = lf.querySelector('button.primary');
    if (sel?.value === '__none') { $main.querySelector('#loginErr').innerHTML = '<div class="error">Kies eerst je naam in de lijst.</div>'; return; }
    const username = (sel?.value || lf.elements.username.value).trim().toLowerCase();
    if (!username) { lf.elements.username.hidden = false; lf.elements.username.focus(); return; }
    btn.disabled = true;
    try {
      signedIn(await postJson('/api/login', { username, password: lf.elements.password.value, ...deviceInfo() }));
    } catch (err) {
      $main.querySelector('#loginErr').innerHTML = `<div class="error">${esc(err.status ? err.message : 'De server is niet bereikbaar. Controleer je internetverbinding.')}</div>`;
      btn.disabled = false;
    }
  };

  const pf = $main.querySelector('#pwForm');
  if (pf) pf.onsubmit = async (e) => {
    e.preventDefault();
    const err = (m) => { $main.querySelector('#pwErr').innerHTML = `<div class="error">${esc(m)}</div>`; };
    if (pf.elements.pw1.value !== pf.elements.pw2.value) return err('De twee wachtwoorden zijn niet gelijk.');
    try {
      signedIn(await postJson('/api/password', { new: pf.elements.pw1.value, ...deviceInfo() }, dev.token));
    } catch (e2) {
      if (e2.data?.needLogin) { lsSet(DEVICE, { username: dev.username }); viewLogin(e2.message); return; }
      err(e2.message);
    }
  };

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
    <h1>Wie ben jij?${info('Kies je naam. De app onthoudt dit op dit toestel. Heb je een koppellink gekregen? Open die dan, zo wordt ook de automatische registratie gekoppeld.')}</h1>
    <div class="who">${emps.map((e) => `<button class="secondary" data-u="${esc(e.username)}">${esc(e.name)}</button>`).join('') || '<p class="muted" style="grid-column:1/-1">Nog geen werknemers. De beheerder voegt ze toe via <a href="#beheer/employees">Beheer</a>.</p>'}</div>
  </section>`;
  $main.querySelectorAll('[data-u]').forEach((b) => b.onclick = () => {
    lsSet(DEVICE, { username: b.dataset.u, token: null });
    syncNow();
    location.hash = '#dag';
    route();
  });
}

async function viewDay(date, focus = null) {
  setNav('dag');
  const dev = device();
  const emp = alive(ctx.master().employees).find((e) => e.username === dev.username);
  $main.innerHTML = `<section class="card day-head"><div class="datebar">
      <a class="icon" href="#dag/${shiftDate(date, -1)}" aria-label="Vorige dag">‹</a>
      <div><div class="date-title"><b>${esc(fmtDate(date))}</b>${date === today() ? ' <span class="pill red">vandaag</span>' : ''}
        <input type="date" id="dayPick" value="${date}" max="${shiftDate(today(), 60)}" aria-label="Kies een datum"></div>
        ${date > today() ? '<div class="day-head-info muted">Planning: wat mee moet</div>' : '<div class="day-head-info muted"><span id="rawInfo"></span> · <button class="link" data-act="refresh">↻ Vernieuwen</button></div>'}</div>
      ${date < shiftDate(today(), 60) ? `<a class="icon" href="#dag/${shiftDate(date, 1)}" aria-label="Volgende dag">›</a>` : '<span class="icon" aria-hidden="true" style="visibility:hidden"></span>'}
    </div>${emp ? '' : '<p class="muted">Je naam staat niet (meer) in de lijst met werknemers.</p>'}</section>
    <div id="openQuestions"></div>
    ${isMobile() && pushSupport().ok && Notification.permission === 'default' && date === today() ? '<a class="q-banner soft" href="#meer">🔔 <span>Zet de <b>meldingen</b> aan: dan vraagt de app zelf bij wie je bent.</span></a>' : ''}
    <div id="dayBody"><p class="muted center">Laden…</p></div>`;
  showOpenQuestions(date);
  $main.querySelector('#dayPick').onchange = (e) => { if (isDate(e.target.value)) location.hash = `#dag/${e.target.value}`; };
  $main.querySelector('[data-act=refresh]')?.addEventListener('click', () => { rawCache.delete(date); viewDay(date); });
  if (date > today()) { renderDay($main.querySelector('#dayBody'), { ctx, username: dev.username, date, raw: null }); return; }
  if (!store.has(PATHS.reg(date.slice(0, 7), dev.username))) await store.sync([PATHS.reg(date.slice(0, 7), dev.username)]);
  const { raw, error } = await fetchRaw(date);
  const body = $main.querySelector('#dayBody');
  if (!body) return;
  renderDay(body, { ctx, username: dev.username, date, raw, rawError: error });
  showRawInfo(raw);
  watchDay(date, raw);
  // via de melding "Welk materiaal gebruikt?": meteen naar het materiaal
  if (focus === 'materiaal') {
    const sec = body.querySelector('.mat-card');
    sec?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    sec?.classList.add('flash');
  }
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

/** Planning als kalender: #planning/<dag|week|maand>/<datum> (standaard: week) */
function viewPlanning([view = 'week', date, of] = []) {
  setNav('planning');
  const me = device().username;
  of = of ? decodeURIComponent(of) : me;
  $main.innerHTML = planningHtml({ master: ctx.master(), planning: ctx.planning(), username: me, of, view, date, nav: prefs().nav ?? null });
  // dagweergave van de eigen planning: materiaal afvinken en toevoegen (zoals op Dag)
  if (view === 'dag' && $main.querySelector('form.need-add')) {
    wireNeeds($main, ctx, me, isDate(date) ? date : today(), () => viewPlanning([view, date, of]));
  }
  // agenda van een collega bekijken
  // agenda's van collega's aanvinken (meerdere tegelijk); niets aangevinkt = de eigen
  // keuzelijst met schakelaars: toepassen als ze dichtgaat (zo kan je er meerdere na elkaar aanzetten)
  const pick = $main.querySelector('#calOf');
  if (pick) pick.addEventListener('toggle', () => {
    if (pick.open) return;
    const list = [...pick.querySelectorAll('input:checked')].map((x) => x.value);
    const v = list.length ? list.join(',') : me;
    if (v === of) return;
    location.hash = `#planning/${view}/${isDate(date) ? date : today()}${v !== me ? `/${encodeURIComponent(v)}` : ''}`;
  });
}

/** Overzicht per week, maand of jaar: #overzicht/week/<datum>, #overzicht/maand/<jjjj-mm>, #overzicht/jaar/<jjjj> */
async function viewHistory([kind = 'week', arg] = []) {
  setNav('overzicht');
  const dev = device();
  if (!['week', 'maand', 'jaar'].includes(kind)) kind = 'week';
  const t = today();
  const key = kind === 'week' ? (isDate(arg) ? arg : t) : kind === 'maand' ? (/^\d{4}-\d{2}$/.test(arg ?? '') ? arg : t.slice(0, 7)) : (/^\d{4}$/.test(arg ?? '') ? arg : t.slice(0, 4));
  const tabs = [['week', 'Week', t], ['maand', 'Maand', t.slice(0, 7)], ['jaar', 'Jaar', t.slice(0, 4)]];
  // bij wisselen van tab dezelfde periode behouden
  const linkFor = (k, dflt) => {
    if (k === kind) return `#overzicht/${k}/${key}`;
    const ref = kind === 'week' ? key : kind === 'maand' ? `${key}-01` : `${key}-01-01`;
    return `#overzicht/${k}/${k === 'week' ? (ref.slice(0, 7) === t.slice(0, 7) ? t : ref) : k === 'maand' ? ref.slice(0, 7) : ref.slice(0, 4)}` || dflt;
  };
  $main.innerHTML = `<h1 class="page-title">Mijn overzicht</h1>
    <nav class="subtabs" aria-label="Periode">${tabs.map(([k, l, d]) => `<a href="${linkFor(k, d)}" class="${k === kind ? 'active' : ''}">${l}</a>`).join('')}</nav>
    <div id="period"><p class="muted center">Laden…</p></div>`;
  const months = kind === 'week' ? [...new Set([weekStart(key), shiftDate(weekStart(key), 6)].map((d) => d.slice(0, 7)))]
    : kind === 'maand' ? [key] : Array.from({ length: 12 }, (_, i) => `${key}-${String(i + 1).padStart(2, '0')}`).filter((mo) => mo <= t.slice(0, 7));
  // ook de laatste drie maanden: voor de knop "nog niet bevestigd"
  const recent = [0, -1, -2].map((n) => shiftMonth(t.slice(0, 7), n));
  await ensureMonths(ctx, dev.username, [...new Set([...months, ...recent])]);
  const box = $main.querySelector('#period');
  if (!box) return;
  box.innerHTML = openDaysButton(ctx, dev.username)
    + (kind === 'week' ? weekHtml(ctx, dev.username, key) : kind === 'maand' ? monthHtml(ctx, dev.username, key) : yearHtml(ctx, dev.username, key));
  // de dagen een voor een nakijken: na bevestigen meteen naar de volgende
  box.querySelector('[data-confirm-run]')?.addEventListener('click', () => { try { sessionStorage.setItem(CONFIRM_RUN, '1'); } catch { /* geblokkeerd */ } });
  box.querySelectorAll('[data-href]').forEach((tr) => tr.onclick = () => { location.hash = tr.dataset.href; });
}

/** Vraag van een pushmelding beantwoorden: #vraag/<id> */
async function viewQuestion(id) {
  setNav('dag');
  const dev = device();
  const server = ctx.serverUrl();
  $main.innerHTML = '<p class="muted center">Vraag laden…</p>';
  let q;
  try {
    const res = await fetch(`${server}/api/questions/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${dev.session}` } });
    if (res.status === 401) { signOutLocal('Meld je aan om de vraag te beantwoorden.'); return; }
    q = await res.json();
    if (!res.ok) throw new Error(q.error ?? `Server: fout ${res.status}`);
  } catch (e) {
    $main.innerHTML = `<section class="card"><div class="error">${esc(e.message || 'Server niet bereikbaar.')}</div><a class="btn secondary" href="#dag">Naar mijn dag</a></section>`;
    return;
  }
  const planned = alive(ctx.planning().items).filter((p) => p.username === dev.username && p.date === q.date && p.projectId !== '__verlof').map((p) => p.projectId);
  renderQuestion($main, {
    q, ctx, planned,
    answer: async (body) => {
      try {
        await postJson(`/api/questions/${q.id}/answer`, body, dev.session);
        rawCache.delete(q.date);
        pushPlaces();
        toast(q.kind === 'pauze' ? (body.answer === 'nee' ? 'Oké, geen pauze vandaag.' : 'Pauze gestart ☕') : q.kind === 'pauze_einde' ? 'Pauze gestopt, verder werken'
          : body.answer === 'nee' ? 'Oké, vandaag wordt niets geregistreerd.' : 'Bewaard', 'ok');
        location.hash = `#dag/${q.date}`;
      } catch (e) { toast(e.message, 'err'); }
    },
  });
}

/** Openstaande vragen van vandaag tonen bovenaan de dag (handig als een melding gemist werd) */
async function showOpenQuestions(date) {
  const dev = device();
  const server = ctx.serverUrl();
  if (date !== today() || !dev?.session || !server) return;
  try {
    const res = await fetch(`${server}/api/questions?open=1`, { headers: { Authorization: `Bearer ${dev.session}` } });
    if (!res.ok) return;
    const list = await res.json();
    const box = $main.querySelector('#openQuestions');
    if (!box || !list.length) return;
    const label = { start: ['Aan het werk?', 'Toegekomen om'], waar: ['Bij wie ben je?', 'Aangekomen om'], pauze: ['☕ Pauze?', 'Gevraagd om'], pauze_einde: ['☕ Pauze voorbij?', 'Gevraagd om'] };
    box.innerHTML = list.map((q) => `<a class="q-banner" href="#vraag/${q.id}"><b>${label[q.kind]?.[0] ?? 'Vraag'}</b>
      <span>${label[q.kind]?.[1] ?? ''} ${esc(fmtClock(q.ts))} · tik om te antwoorden</span></a>`).join('');
  } catch { /* offline */ }
}

/** Meldingen: kaart in "Meer" */
async function pushCard(box) {
  const dev = device();
  const server = ctx.serverUrl();
  const sup = pushSupport();
  const draw = async (msg = '') => {
    if (!sup.ok) {
      box.innerHTML = `<p class="ios-foot">${sup.reason === 'ios-home'
        ? 'Op een iPhone werken meldingen enkel in de app op je beginscherm: Safari → Deel → <b>Zet op beginscherm</b>, open de app via het icoon en zet hier de meldingen aan.'
        : 'Deze browser ondersteunt geen meldingen.'}</p>`;
      return;
    }
    const sub = await currentSubscription();
    let on = false;
    if (sub) {
      try { on = (await (await fetch(`${server}/api/push/status?endpoint=${encodeURIComponent(sub.endpoint)}`, { headers: { Authorization: `Bearer ${dev.session}` } })).json()).subscribed; } catch { on = true; }
    }
    // zoals iOS: schakelaar "Sta meldingen toe", daaronder de uitleg
    box.innerHTML = `${Notification.permission === 'denied' ? '<p class="error">Meldingen zijn geblokkeerd voor deze app. Zet ze aan in de instellingen van je toestel of browser.</p>' : ''}
      ${iosGroup([iosRow({ icon: '🔔', color: '#ff3b30', label: 'Sta meldingen toe', toggle: `data-act="ptoggle" ${on ? 'checked' : ''}` }),
        on ? iosRow({ label: 'Testmelding sturen', act: 'ptest' }) : ''],
        { footer: 'Je krijgt een melding als je ergens toekomt: "Aan het werk?" (\'s ochtends), "Bij wie ben je?" (na een verplaatsing) en "Dag bevestigen?" als je thuiskomt. Zo kies je meteen het juiste project.' })}${msg}`;
  };
  box.onchange = (e) => {
    if (e.target.dataset.act !== 'ptoggle') return;
    e.target.disabled = true;
    box.onclick({ target: e.target, act: e.target.checked ? 'pon' : 'poff' });
  };
  box.onclick = async (e) => {
    const act = e.act ?? e.target.closest('button[data-act]')?.dataset.act;
    if (!act) return;
    e.target.disabled = true;
    try {
      if (act === 'pon') { await enablePush(server, dev.session, deviceLabel()); await draw('<p class="ok-text">✔ Meldingen staan aan.</p>'); }
      if (act === 'poff') { await disablePush(server, dev.session); await draw(); }
      if (act === 'ptest') {
        const r = await postJson('/api/push/test', {}, dev.session);
        await draw(r.sent ? '<p class="ok-text">✔ Verstuurd. Je krijgt zo een melding.</p>' : '<p class="error">Niet verstuurd: geen toestellen ingeschreven.</p>');
      }
    } catch (err) { await draw(`<p class="error">${esc(err.message)}</p>`); }
  };
  await draw();
}

/** Lijst van aangemelde toestellen (eigen of, voor de beheerder, van iedereen) */
function sessionsHtml(list, { showUser = false } = {}) {
  const fmt = (ts) => new Date(ts).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  if (!list.length) return '<p class="muted">Geen aangemelde toestellen.</p>';
  return `<div class="table-wrap"><table><thead><tr>${showUser ? '<th>Werknemer</th>' : ''}<th>Toestel</th><th>Aangemeld sinds</th><th>Laatst actief</th><th></th></tr></thead><tbody>
    ${list.map((s) => `<tr>${showUser ? `<td>${esc(s.name ?? s.username)}</td>` : ''}
      <td>${s.type === 'widget' ? '🧩 <b>Widget</b> ·' : s.type === 'mobiel' ? '📱' : '💻'} ${s.deviceName ? `<b>${esc(s.deviceName)}</b> <span class="muted small">${esc(s.device ?? '')}</span>` : esc(s.device ?? 'Onbekend')}${s.current ? ' <span class="pill ok">dit toestel</span>' : ''}</td>
      <td>${fmt(s.createdAt)}</td><td>${fmt(s.lastSeen)}</td>
      <td>${s.current ? '' : `<button class="link danger" data-revoke="${s.id}">Afmelden</button>`}</td></tr>`).join('')}
  </tbody></table></div>`;
}

async function viewMore(sub = '') {
  setNav('meer');
  const dev = device();
  const me = lsGet(ME) ?? {};
  const emp = alive(ctx.master().employees).find((e) => e.username === dev.username);
  const acc = driveA?.account;
  const server = ctx.serverUrl();
  const ot = me.owntracks;
  const mobile = isMobile();
  // Zoals Instellingen op de iPhone: hoofdlijst met gegroepeerde rijen, tik = subpagina met terugknop
  const name = emp?.name ?? me.name ?? dev.username;
  const THEMES = [['', 'Automatisch'], ['light', 'Wit'], ['dark', 'Zwart']];
  const themeName = THEMES.find(([v]) => v === (prefs().theme ?? ''))?.[1] ?? 'Automatisch';
  const appUrl = location.origin + location.pathname.replace(/index\.html$/, '');
  const storeName = TEST ? 'Testmodus' : acc ? STORE_NAME : GOOGLE ? 'Google Drive' : 'Niet aangemeld';
  const navName = (NAV_APPS.find(([v]) => v === (prefs().nav ?? defaultNav())) ?? NAV_APPS[0])[1];
  const back = () => iosPageHead(esc({ account: name, pauze: 'Standaardpauze', weergave: 'Weergave', meldingen: 'Meldingen', navigatie: 'Navigatie', owntracks: 'OwnTracks', widget: 'Widget en snelkoppelingen', beginscherm: 'App op je beginscherm', opslag: 'Opslag' }[sub] ?? ''), '#meer', 'Meer');
  const pages = {
    account: () => `${back()}
      ${iosGroup([iosRow({ label: 'Gebruikersnaam', value: esc(dev.username) }), me.isAdmin ? iosRow({ label: 'Rol', value: 'Beheerder' }) : ''])}
      ${iosGroup([`<li class="ios-form"><form id="pwChange" class="link-form">
          <input name="current" type="password" autocomplete="current-password" placeholder="Huidig wachtwoord" required aria-label="Huidig wachtwoord">
          <input name="pw1" type="password" autocomplete="new-password" placeholder="Nieuw wachtwoord (min. 8 tekens)" required minlength="8" aria-label="Nieuw wachtwoord">
          <input name="pw2" type="password" autocomplete="new-password" placeholder="Herhaal nieuw wachtwoord" required minlength="8" aria-label="Herhaal nieuw wachtwoord">
          <button class="primary">Wachtwoord wijzigen</button></form><div id="pwMsg"></div></li>`],
        { header: 'Wachtwoord', footer: 'Na het wijzigen word je op je andere toestellen afgemeld.' })}
      ${iosGroup([`<li class="ios-form"><div id="mySessions"><p class="muted">Laden…</p></div></li>`],
        { header: 'Mijn toestellen', footer: 'Hier ben je aangemeld. Herken je een toestel niet? Meld het af en wijzig je wachtwoord.' })}
      ${iosGroup([iosRow({ label: 'Afmelden / andere gebruiker', act: 'signout', danger: true })])}`,
    pauze: () => `${back()}
      ${iosGroup([0, 15, 30, 45, 60].map((v) => `<li><button type="button" class="ios-row" data-pause-pick="${v}"><span class="ios-label">${v ? fmtHours(v) : 'Geen pauze'}</span>
        <span class="ios-check" aria-hidden="true">${(me.pauseMin ?? 30) === v ? '✓' : ''}</span></button></li>`),
        { header: 'Standaardpauze', footer: 'Werk je na de middag, dan stelt de app deze pauze voor in je uren. Je kan ze per dag nog aanpassen. Om 12:00 krijg je een melding om je pauze te starten.' })}`,
    weergave: () => `${back()}
      ${iosGroup(THEMES.map(([v, l]) => `<li><button type="button" class="ios-row" data-theme-pick="${v}"><span class="ios-label">${l}${v ? '' : '<small>Zoals je toestel</small>'}</span>
        <span class="ios-check" aria-hidden="true">${(prefs().theme ?? '') === v ? '✓' : ''}</span></button></li>`), { header: 'Achtergrond' })}
      ${iosGroup([iosRow({ label: 'Tellers tonen', toggle: `data-pref="counters" ${prefs().counters ? 'checked' : ''}` })],
        { footer: 'Werk, pauze en netto als tellers bovenaan het dagscherm.' })}
      ${iosGroup([iosRow({ label: 'Uren in detail', toggle: `data-pref="detail" ${prefs().detail ? 'checked' : ''}` })],
        { footer: 'Bij je uren ook de verplaatsingen apart tonen (rit heen, werk, rit terug), zoals de app ze gemeten heeft. Uit = één regel per project.' })}`,
    meldingen: () => `${back()}<div id="pushCard"><p class="muted">Laden…</p></div>`,
    navigatie: () => `${back()}
      ${iosGroup(NAV_APPS.map(([v, l]) => `<li><button type="button" class="ios-row" data-nav-pick="${v}"><span class="ios-label">${l}</span>
        <span class="ios-check" aria-hidden="true">${navName === l ? '✓' : ''}</span></button></li>`),
        { header: 'Route openen in', footer: 'De knop "Route" in de planning opent het adres in deze app. Staat ze niet op je gsm, dan opent de website.' })}`,
    owntracks: () => `${back()}${mobile && ot && server ? `<section class="card">${owntracksGuideHtml({ ios: isIOS(), link: owntracksLink(ot), ot, server })}</section>`
      : '<p class="ios-foot">De automatische registratie (OwnTracks) stel je enkel in op je gsm.</p>'}
      <p class="ios-foot">OwnTracks stuurt je locatie door zodat de app je uren voorstelt. Je locatie wordt enkel daarvoor gebruikt en na enkele weken gewist.</p>`,
    widget: () => `${back()}
      ${iosGroup([isIOS() ? iosRow({ icon: '🧩', color: '#5856d6', label: 'Widget instellen', act: 'widget' }) : '',
        isIOS() ? iosRow({ icon: '⏰', color: '#ff9500', label: 'OwnTracks automatisch openen', act: 'autoot' }) : '',
        iosRow({ icon: '↺', color: '#8e8e93', label: 'Instelstappen opnieuw doorlopen', act: 'setup' })],
        { footer: isIOS() ? 'Zet je uren van vandaag als widget op je beginscherm (met de gratis app Scriptable).' : 'Hou het icoon van Enautec Uren ingedrukt voor snelkoppelingen naar Vandaag, Materiaal, Planning en ToDo.' })}`,
    beginscherm: () => `${back()}<section class="card">${isIOS() ? '<p>Tik in Safari onderaan op <b>Deel</b> (vierkantje met pijl) → <b>Zet op beginscherm</b>. Open de app daarna via het icoon en meld je daar één keer aan.</p>'
      : '<p>Menu (⋮) → <b>Toevoegen aan startscherm</b> of <b>App installeren</b>. Open de app daarna via het icoon.</p>'}</section>`,
    opslag: () => `${back()}
      ${iosGroup([iosRow({ label: TEST ? 'Testmodus' : acc ? STORE_NAME : GOOGLE ? 'Google Drive' : 'Opslag', value: TEST ? 'enkel deze browser' : acc ? esc(acc.username || acc.name) : GOOGLE ? 'via de beheerder' : 'niet aangemeld' }),
        iosRow({ label: 'Nu synchroniseren', act: 'sync' }), TEST ? iosRow({ label: 'Testgegevens wissen', act: 'testreset', danger: true }) : ''])}`,
  };
  $main.innerHTML = pages[sub] ? pages[sub]() : `<h1 class="page-title">Meer</h1>
    <a class="ios-profile" href="#meer/account"><span class="ios-avatar">${esc(initials(name) || '?')}</span>
      <span class="ios-label"><b>${esc(name)}</b><small>Account, wachtwoord en toestellen${me.isAdmin ? ' · beheerder' : ''}</small></span><span class="ios-chev" aria-hidden="true">›</span></a>
    ${iosGroup([
      iosRow({ icon: '🔔', color: '#ff3b30', label: 'Meldingen', href: '#meer/meldingen' }),
      iosRow({ icon: '☕', color: '#a2845e', label: 'Standaardpauze', value: (me.pauseMin ?? 30) ? fmtHours(me.pauseMin ?? 30) : 'geen', href: '#meer/pauze' }),
      iosRow({ icon: '◐', color: '#5856d6', label: 'Weergave', value: themeName, href: '#meer/weergave' }),
      iosRow({ icon: '➤', color: '#34c759', label: 'Navigatie', value: esc(navName), href: '#meer/navigatie' }),
    ])}
    ${iosGroup([
      mobile && ot && server ? iosRow({ icon: '📍', color: '#34c759', label: 'OwnTracks', sub: 'Automatische registratie', href: '#meer/owntracks' }) : '',
      mobile && isStandalone() ? iosRow({ icon: '🧩', color: '#007aff', label: 'Widget en snelkoppelingen', href: '#meer/widget' }) : '',
      mobile && !isStandalone() ? iosRow({ icon: '📲', color: '#007aff', label: 'App op je beginscherm', href: '#meer/beginscherm' }) : '',
    ], { footer: mobile ? '' : 'Je gebruikt een computer. De automatische registratie (OwnTracks) stel je enkel in op je gsm.' })}
    ${iosGroup([
      `<li><div class="ios-row app-link"><span class="ios-ico" style="background:#f5c400" aria-hidden="true">🔗</span>
        <span class="ios-label">Link naar de app<small class="app-url">${esc(appUrl)}</small></span></div></li>`,
      iosRow({ label: 'Kopieer link', act: 'copylink' }),
      navigator.share ? iosRow({ label: 'Delen…', sub: 'WhatsApp, Mail, Berichten…', act: 'sharelink' }) : '',
    ], { header: 'App delen met een collega', footer: 'Stuur deze link naar een nieuwe werknemer. Die opent hem op de gsm, zet de app op het beginscherm en meldt zich aan met de gebruikersnaam en het wachtwoord van de beheerder.' })}
    ${iosGroup([iosRow({ icon: '☁', color: '#8e8e93', label: 'Opslag', value: esc(storeName), href: '#meer/opslag' })])}
    <p class="ios-foot center">Enautec Uren versie ${APP_VERSION} · <a href="privacy.html" target="_blank" rel="noopener">Privacy</a></p>`;

  $main.querySelectorAll('[data-copy]').forEach((b) => b.onclick = async () => {
    await copyText(b.dataset.copy);
    const old = b.textContent;
    b.textContent = '✔ Gekopieerd';
    setTimeout(() => { b.textContent = old; }, 1500);
  });
  $main.querySelectorAll('[data-pref]').forEach((inp) => inp.onchange = () => {
    setPref(inp.dataset.pref, inp.type === 'checkbox' ? inp.checked : inp.value || null);
    toast('Bewaard', 'ok');
  });
  $main.querySelector('[data-act=widget]')?.addEventListener('click', () => startSetup('widget', true));
  $main.querySelector('[data-act=autoot]')?.addEventListener('click', () => startSetup('auto', true));
  $main.querySelector('[data-act=setup]')?.addEventListener('click', () => startSetup('push'));
  $main.querySelectorAll('[data-pause-pick]').forEach((b) => b.onclick = () => { ctx.setPauseMin(Number(b.dataset.pausePick)); toast('Bewaard', 'ok'); viewMore(sub); });
  $main.querySelectorAll('[data-theme-pick]').forEach((b) => b.onclick = () => { setPref('theme', b.dataset.themePick || null); viewMore(sub); });
  $main.querySelectorAll('[data-nav-pick]').forEach((b) => b.onclick = () => { setPref('nav', b.dataset.navPick); toast('Bewaard', 'ok'); viewMore(sub); });
  const on = (sel, fn) => { const el = $main.querySelector(sel); if (el) el.onclick = fn; };
  on('[data-act=signout]', () => {
    if (store.dirtyPaths().length && !confirm('Er zijn nog wijzigingen die niet bewaard zijn in de opslag. Toch afmelden?')) return;
    if (confirm('Afmelden op dit toestel? Daarna kan je (of een collega) je opnieuw aanmelden.')) signOut();
  });
  on('[data-act=copylink]', async () => {
    try { await navigator.clipboard.writeText(appUrl); toast('Link gekopieerd', 'ok'); } catch { prompt('Kopieer deze link:', appUrl); }
  });
  on('[data-act=sharelink]', () => navigator.share({ title: 'Enautec Uren', text: 'De app Enautec Uren:', url: appUrl }).catch(() => {}));
  on('[data-act=sync]', async () => { rawCache.clear(); await syncNow(); toast(store.status === 'ok' ? 'Gesynchroniseerd' : store.lastError || 'Synchroniseren niet gelukt', store.status === 'ok' ? 'ok' : 'err'); });
  $main.querySelector('[data-act=testreset]')?.addEventListener('click', () => {
    if (!confirm('Alle testgegevens in deze browser wissen?')) return;
    Object.keys(localStorage).filter((k) => k.startsWith('enautec.')).forEach((k) => localStorage.removeItem(k));
    location.href = location.pathname;
  });

  const pc = $main.querySelector('#pwChange');
  if (openPwChange && pc) {
    openPwChange = false;
    pc.scrollIntoView({ block: 'center' });
    pc.elements.current.focus();
  }
  if (pc) pc.onsubmit = async (e) => {
    e.preventDefault();
    const msg = (t, cls = 'error') => { $main.querySelector('#pwMsg').innerHTML = `<div class="${cls}">${esc(t)}</div>`; };
    if (pc.elements.pw1.value !== pc.elements.pw2.value) return msg('De twee nieuwe wachtwoorden zijn niet gelijk.');
    try {
      await postJson('/api/password', { current: pc.elements.current.value, new: pc.elements.pw1.value }, dev.session);
      pc.reset();
      lsSet(ME, { ...lsGet(ME), mustChange: false });
      msg('✔ Wachtwoord gewijzigd. Je andere toestellen zijn afgemeld.', 'ok-text');
      loadMySessions();
    } catch (err) { msg(err.message); }
  };

  async function loadMySessions() {
    const box = $main.querySelector('#mySessions');
    if (!box) return;
    try {
      const res = await fetch(`${server}/api/sessions`, { headers: { Authorization: `Bearer ${dev.session}` } });
      if (res.status === 401) { signOutLocal('Je bent afgemeld op dit toestel. Meld je opnieuw aan.'); return; }
      const list = await res.json();
      box.innerHTML = `${sessionsHtml(list)}<p><button class="secondary" data-act="pickdev">Ander toestel kiezen voor deze browser</button></p>`;
      box.querySelector('[data-act=pickdev]').onclick = async () => { await ensureDevice({ force: true }); loadMySessions(); };
      box.querySelectorAll('[data-revoke]').forEach((b) => b.onclick = async () => {
        if (!confirm('Dit toestel afmelden?')) return;
        await fetch(`${server}/api/sessions/${b.dataset.revoke}`, { method: 'DELETE', headers: { Authorization: `Bearer ${dev.session}` } });
        loadMySessions();
      });
    } catch {
      box.innerHTML = '<p class="muted">De lijst kon niet geladen worden (geen verbinding met de server).</p>';
    }
  }
  loadMySessions();
  const pcBox = $main.querySelector('#pushCard');
  if (pcBox) pushCard(pcBox);
}

/** Sessie ongeldig (afgemeld vanop een ander toestel of nieuw wachtwoord): lokaal afmelden */
function signOutLocal(message) {
  lsSet(DEVICE, null);
  lsSet(ME, null);
  lsSet(ADMIN_OK, null);
  driveA = makeDriveA();
  store.drive = driveA;
  location.hash = '';
  viewLogin(message);
}
/** Wachtwoord ingesteld door een beheerder: één keer voorstellen om een eigen wachtwoord te kiezen */
let pwOffered = false;
let openPwChange = false;
async function offerPasswordChange() {
  const dev = device();
  if (pwOffered || !dev?.session || !lsGet(ME)?.mustChange) return;
  pwOffered = true;
  const change = await confirmDialog({
    title: 'Eigen wachtwoord kiezen?',
    text: 'Je wachtwoord werd ingesteld door een beheerder. Wil je nu een eigen wachtwoord kiezen? Je kan ook dit wachtwoord houden.',
    ok: 'Wachtwoord wijzigen', cancel: 'Houden',
  });
  if (change) {
    openPwChange = true;
    if (location.hash === '#meer/account') viewMore('account'); else location.hash = '#meer/account';
    return;
  }
  try {
    await postJson('/api/password/keep', {}, dev.session);
    lsSet(ME, { ...lsGet(ME), mustChange: false });
  } catch { pwOffered = false; /* offline: volgende keer opnieuw vragen */ }
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
      <p class="muted">${first ? `Stel een pincode in voor het beheer (4 tot 8 cijfers).${info('Enkel de beheerder kent deze code.')}` : 'Geef de pincode van het beheer.'}</p>
      <form id="pinForm" class="row"><input name="pin" type="password" inputmode="numeric" autocomplete="${first ? 'new-password' : 'current-password'}" required placeholder="Pincode" aria-label="Pincode"><button class="primary">${first ? 'Instellen' : 'Openen'}</button></form>
      ${TEST ? '<p class="muted small">Testmodus: probeer pincode 1234 na het laden van de demo.</p>' : ''}
      <div id="pinErr"></div></section>
      ${TEST && !alive(m.employees).length ? `<section class="card narrow"><h2>Testmodus${info('Laad fictieve klanten, projecten en werknemers om de app uit te proberen.')}</h2><button class="secondary" data-act="demo">Demogegevens laden</button></section>` : ''}`;
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

/** Oude koppellink "…#koppel=gebruiker.code&s=<server>": nog enkel om een eerste wachtwoord te kiezen */
function parseKoppel(text) {
  const m = String(text ?? '').trim().match(/#?koppel=([^.&\s]+)\.([^&\s]+)(?:&s=([^\s]+))?/);
  if (!m) return null;
  return { username: decodeURIComponent(m[1]), token: m[2], server: m[3] ? decodeURIComponent(m[3]) : null };
}

// testmodus: ?standalone=1 doet alsof de app op het beginscherm staat (om de eerste stappen uit te proberen)
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
  || (TEST && new URLSearchParams(location.search).get('standalone') === '1');
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Bij de server nagaan of de gekoppelde werknemer beheerder is (op de achtergrond) */
async function refreshMe() {
  const dev = device();
  if (!dev?.session || !serverUrl()) return;
  try {
    const res = await fetch(`${serverUrl()}/api/me`, { headers: { Authorization: `Bearer ${dev.session}` } });
    if (res.status === 401) { signOutLocal('Je bent afgemeld op dit toestel (vanop een ander toestel of door een nieuw wachtwoord). Meld je opnieuw aan.'); return; }
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
  if (device() && !/^#(google|koppel)=/.test(location.hash) && !/^#(dag|planning|overzicht|todo|meer)/.test(location.hash)) {
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

  // Oude koppellink geopend: dit toestel laat de werknemer een eerste wachtwoord kiezen
  const km = parseKoppel(location.hash);
  if (km) {
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    if (!device()?.session) {
      lsSet(DEVICE, { username: km.username, token: km.token });
      if (km.server) ctx.setServerUrl(km.server);
    }
  }
  // Toestel van vóór het aanmelden met wachtwoord, of niet aangemeld → aanmeldscherm
  if (GOOGLE && !device()?.session && device()?.token) { viewLogin(); return; }

  if (!GOOGLE && driveA && !TEST && auth.needsInteractive('A')) {
    if (r?.silent && !r.ok) showStatus('login');
    else if (await auth.trySilentRenew('A')) return; // pagina gaat even naar Microsoft
  }

  if (!driveA) { viewWelcome(r && !r.ok && r.slot === 'A' ? r.error : ''); return; }

  // Beheerder zonder werknemerskoppeling: eerst Google Drive koppelen als dat nog niet gebeurd is
  if (GOOGLE && !TEST && !device()?.session) {
    try {
      const gs = await ctx.googleStatus();
      if (!gs.A) { viewWelcome(); return; }
    } catch (e) { viewWelcome(e.message); return; }
  }

  window.addEventListener('hashchange', route);
  if (!store.has(PATHS.master)) $main.innerHTML = `<p class="muted center">Gegevens ophalen uit ${esc(STORE_NAME)}…</p>`;
  await syncNow();
  if (GOOGLE && store.status === 'login' && !device()?.session && !adminKey()) { viewWelcome(); return; }
  route();
  refreshMe().then(offerPasswordChange).then(() => ensureDevice()).catch(() => {});

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
// alle keuzelijsten zoekbaar maken (typen om de lijst te verkleinen)
initCombos(document.body);
start().catch((e) => { $main.innerHTML = `<div class="card error">${esc(e.message)}</div>`; });

export { copyText };
