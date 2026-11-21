// Enautec Uren – hoofdmodule: opstarten, aanmelden, navigatie en de schermen voor de werknemer.
import { MS_CLIENT_ID, APP_VERSION } from './config.js';
import * as auth from './auth.js';
import { OneDrive, TestDrive } from './drive.js';
import { Store, PATHS, EMPTY_MASTER } from './store.js';
import { renderDay, emptyReg, rulesFrom } from './day.js';
import { Admin } from './admin.js';
import { summarize } from './engine.js';
import { today, shiftDate, fmtDate, isDate, fmtHours } from './time.js';
import { esc, alive, byName, projectLabel, toast, sha256, copyText } from './ui.js';
import { seedDemo } from './demo.js';

const params = new URLSearchParams(location.search);
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
if (LOCAL && params.has('test')) localStorage.setItem('enautec.test', '1');
const TEST = LOCAL && localStorage.getItem('enautec.test') === '1';

const DEVICE = 'enautec.device';
const ADMIN_KEY = 'enautec.adminKey';
const BILLING_TEST = 'enautec.testBilling';
const ADMIN_OK = 'enautec.adminOk';

const $main = document.getElementById('main');
const $status = document.getElementById('syncStatus');
const $nav = document.getElementById('nav');

const lsGet = (k, d = null) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch { /* geblokkeerd */ } };

// ---------- Opslag ----------
let driveA = TEST ? new TestDrive('A') : auth.account('A') ? new OneDrive('A') : null;
let driveB = TEST ? (localStorage.getItem(BILLING_TEST) ? new TestDrive('B') : null) : auth.account('B') ? new OneDrive('B') : null;

const STATUS = {
  ok: ['ok', 'Bewaard in OneDrive'],
  busy: ['busy', 'Synchroniseren…'],
  idle: ['busy', 'Verbinden…'],
  offline: ['warn', 'Offline · bewaard op toestel'],
  login: ['err', 'Opnieuw aanmelden'],
  error: ['err', 'Probleem met OneDrive'],
  local: ['warn', 'Niet verbonden'],
};
function showStatus(s, err) {
  const [cls, text] = STATUS[s] ?? STATUS.local;
  $status.className = `sync ${cls}`;
  $status.querySelector('span').textContent = TEST && s === 'ok' ? 'Testmodus · bewaard' : text;
  $status.title = err || '';
}
const store = new Store(driveA, showStatus);

const device = () => lsGet(DEVICE);

const ctx = {
  store,
  master: () => ({ ...EMPTY_MASTER(), ...store.get(PATHS.master, EMPTY_MASTER()) }),
  planning: () => store.get(PATHS.planning, { items: [] }),
  serverUrl: () => (ctx.master().settings?.serverUrl || '').replace(/\/+$/, ''),
  adminKey: () => localStorage.getItem(ADMIN_KEY) || '',
  setAdminKey: (k) => (k ? localStorage.setItem(ADMIN_KEY, k) : localStorage.removeItem(ADMIN_KEY)),
  billingDrive: () => driveB,
  loginBilling: () => {
    if (TEST) { localStorage.setItem(BILLING_TEST, '1'); driveB = new TestDrive('B'); route(); return; }
    auth.login('B');
  },
  logoutBilling: () => { if (TEST) localStorage.removeItem(BILLING_TEST); else auth.logout('B'); driveB = null; },
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
  rerenderTimer = setTimeout(route, 300);
});

// ---------- Navigatie ----------
function currentDate() {
  const [view, arg] = location.hash.slice(1).split('/');
  return view === 'dag' && isDate(arg) ? arg : today();
}

function setNav(active) {
  const dev = device();
  const items = [
    ['dag', 'Dag', '🕒'], ['planning', 'Planning', '📅'], ['overzicht', 'Overzicht', '📋'], ['meer', 'Meer', '⚙'],
  ];
  if (!dev) items.length = 0;
  items.push(['beheer', 'Beheer', '🔒']);
  $nav.innerHTML = items.map(([k, label, icon]) => `<a href="#${k}" class="${k === active ? 'active' : ''}"><span aria-hidden="true">${icon}</span>${label}</a>`).join('');
  $nav.hidden = !store.drive && !TEST;
}

function route() {
  const [view = '', ...rest] = location.hash.slice(1).split('/');
  if (!driveA) return viewWelcome();
  const dev = device();
  if (view === 'beheer') return viewAdmin(rest[0] || 'overzicht');
  if (!dev) return viewWho();
  if (view === 'planning') return viewPlanning();
  if (view === 'overzicht') return viewHistory();
  if (view === 'meer') return viewMore();
  return viewDay(isDate(rest[0]) ? rest[0] : today());
}

// ---------- Schermen ----------
function viewWelcome(message = '') {
  setNav('');
  $nav.hidden = true;
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
    </div>${emp ? '' : '<p class="muted">Je naam staat niet (meer) in de lijst met werknemers.</p>'}</section>
    <div id="dayBody"><p class="muted center">Laden…</p></div>`;
  $main.querySelector('#dayPick').onchange = (e) => { if (isDate(e.target.value)) location.hash = `#dag/${e.target.value}`; };
  if (!store.has(PATHS.reg(date.slice(0, 7), dev.username))) await store.sync([PATHS.reg(date.slice(0, 7), dev.username)]);
  const { raw, error } = await fetchRaw(date);
  const body = $main.querySelector('#dayBody');
  if (!body) return;
  renderDay(body, { ctx, username: dev.username, date, raw, rawError: error });
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
    ${dev.token && server ? `<section class="card"><h2>Automatische registratie (OwnTracks)</h2>
      <ol><li>Installeer de gratis app <b>OwnTracks</b> (App Store / Google Play).</li>
      <li>Tik hier: <a class="btn primary" href="${esc(owntracksLink(dev))}">OwnTracks instellen</a></li>
      <li>Geef OwnTracks locatietoegang <b>"Altijd"</b> en zet batterijbesparing voor OwnTracks uit.</li></ol>
      <p class="muted">Buiten de werkuren kan je OwnTracks op <b>Rustig</b> zetten. Je locatie wordt enkel gebruikt om je uren voor te stellen en na enkele weken gewist.</p>
      <details><summary>Manueel instellen</summary><p>Modus <b>HTTP</b> · URL <code>${esc(server)}/api/owntracks</code> · gebruiker <code>${esc(dev.username)}</code> · wachtwoord <code>${esc(dev.token)}</code></p></details>
    </section>` : ''}
    <section class="card"><h2>OneDrive</h2>
      <p>${TEST ? 'Testmodus: gegevens staan enkel in deze browser.' : acc ? `Aangemeld als <b>${esc(acc.name || acc.username)}</b> <span class="muted">${esc(acc.username)}</span>` : 'Niet aangemeld.'}</p>
      <div class="row"><button class="secondary" data-act="sync">Nu synchroniseren</button>
      ${TEST ? '<button class="link danger" data-act="testreset">Testgegevens wissen</button>' : '<button class="link danger" data-act="logout">Afmelden</button>'}</div>
    </section>
    <section class="card"><p class="muted small">Enautec Uren versie ${APP_VERSION}</p></section>`;
  $main.querySelector('[data-act=switch]').onclick = () => { if (confirm('Wil je een andere naam kiezen op dit toestel?')) { lsSet(DEVICE, null); location.hash = ''; route(); } };
  $main.querySelector('[data-act=sync]').onclick = async () => { rawCache.clear(); await syncNow(); toast(store.status === 'ok' ? 'Gesynchroniseerd' : store.lastError || 'Synchroniseren niet gelukt', store.status === 'ok' ? 'ok' : 'err'); };
  $main.querySelector('[data-act=logout]')?.addEventListener('click', () => {
    if (store.dirtyPaths().length && !confirm('Er zijn nog wijzigingen die niet in OneDrive staan. Toch afmelden?')) return;
    if (!confirm('Afmelden van OneDrive op dit toestel?')) return;
    auth.logout('A'); driveA = null; store.drive = null; route();
  });
  $main.querySelector('[data-act=testreset]')?.addEventListener('click', () => {
    if (!confirm('Alle testgegevens in deze browser wissen?')) return;
    Object.keys(localStorage).filter((k) => k.startsWith('enautec.')).forEach((k) => localStorage.removeItem(k));
    location.href = location.pathname;
  });
}

async function viewAdmin(tab) {
  setNav('beheer');
  const m = ctx.master();
  if (sessionStorage.getItem(ADMIN_OK) !== '1') {
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
      sessionStorage.setItem(ADMIN_OK, '1');
      route();
    };
    return;
  }
  $main.innerHTML = '<h1 class="page-title">Beheer</h1><div id="adminRoot"></div>';
  admin.render($main.querySelector('#adminRoot'), tab);
}

// ---------- Opstarten ----------
async function start() {
  const r = await auth.handleRedirect();
  if (r?.ok && r.slot === 'A') { driveA = new OneDrive('A'); store.drive = driveA; }
  if (r?.ok && r.slot === 'B') { driveB = new OneDrive('B'); toast('Verbonden met OneDrive facturatie', 'ok'); }
  if (r && !r.ok && !r.silent) toast(r.error, 'err');

  // Koppellink: #koppel=gebruikersnaam.code
  const km = location.hash.match(/^#koppel=([^.]+)\.(.+)$/);
  if (km) {
    lsSet(DEVICE, { username: decodeURIComponent(km[1]), token: km[2] });
    history.replaceState(null, '', `${location.pathname}${location.search}#meer`);
    toast('Toestel gekoppeld. Stel nu OwnTracks in.', 'ok');
  }

  if (driveA && !TEST && auth.needsInteractive('A')) {
    if (r?.silent && !r.ok) showStatus('login');
    else if (await auth.trySilentRenew('A')) return; // pagina gaat even naar Microsoft
  }

  if (!driveA) { viewWelcome(r && !r.ok && r.slot === 'A' ? r.error : ''); return; }

  window.addEventListener('hashchange', route);
  if (!store.has(PATHS.master)) $main.innerHTML = '<p class="muted center">Gegevens ophalen uit OneDrive…</p>';
  await syncNow();
  route();

  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { rawCache.clear(); syncNow(); } });
  window.addEventListener('online', syncNow);
  $status.onclick = () => {
    if (store.status === 'login') auth.login('A');
    else syncNow();
  };
}

if ('serviceWorker' in navigator && !LOCAL) navigator.serviceWorker.register('sw.js').catch(() => {});
if (TEST) document.documentElement.classList.add('test');
start().catch((e) => { $main.innerHTML = `<div class="card error">${esc(e.message)}</div>`; });

export { copyText };
