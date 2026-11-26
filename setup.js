// Eerste keer aanmelden op een gsm: verplichte stappen voor je de app kan gebruiken.
//  1. App op het beginscherm (al gebeurd: aanmelden op een gsm kan enkel in de app op het beginscherm)
//  2. Meldingen aanzetten
//  3. OwnTracks instellen (klaar zodra de eerste locatie binnenkomt)
//  4. Widget (iPhone: Scriptable; klaar zodra het widget de eerste keer gegevens ophaalt)
import { esc, toast, copyText } from './ui.js';
import { pushSupport, enablePush, currentSubscription } from './questions.js';

const MIN = 60000;

/** Versie van het script (de server meldt als er een nieuwere is: dan opnieuw instellen via Meer) */
export const SCRIPT_VERSION = 3;

/**
 * Script voor Scriptable: toont de stand van vandaag (uren, waar, open vragen) en 's ochtends
 * de planning met het materiaal. Middelgroot/groot: tik op een materiaalregel om af te vinken
 * (voor iedereen op dat project) en op de pauzeknop om je pauze te starten of te stoppen.
 * Een tik opent Scriptable even (een widget kan op iPhone niets doen zonder een app te openen).
 */
export function widgetScript({ server, key, name = '' }) {
  return `// Enautec Uren – widget${name ? ` voor ${name}` : ''}
// Gemaakt door de app op ${new Date().toLocaleDateString('nl-BE')}. Deze sleutel geeft enkel de stand van vandaag,
// pauze starten/stoppen en materiaal afvinken. Afmelden kan in de app bij Meer → Mijn toestellen ("Widget").
const SCRIPT_VERSION = ${SCRIPT_VERSION};
const SERVER = ${JSON.stringify(server)};
const KEY = ${JSON.stringify(key)};

const RED = new Color("#e3262e");
const FG = Color.dynamic(new Color("#111111"), new Color("#ffffff"));
const MUTED = Color.dynamic(new Color("#6b6b6b"), new Color("#a0a0a0"));
const BTN = Color.dynamic(new Color("#f0f0ee"), new Color("#2c2c2e"));
const STATUS = { geen: "Nog niet gestart", werk: "Aan het werk", pauze: "Pauze", onderweg: "Onderweg", gedaan: "Dag gedaan", nee: "Niet gewerkt" };
const hm = (min) => Math.floor(min / 60) + "u" + String(min % 60).padStart(2, "0");
const hhmm = (ts) => { const d = new Date(ts); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };

async function api(path, body) {
  const r = new Request(SERVER + path);
  r.headers = { Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
  r.timeoutInterval = 20;
  if (body) { r.method = "POST"; r.body = JSON.stringify(body); }
  const d = await r.loadJSON();
  if (r.response.statusCode !== 200) throw new Error(d.error || "Fout " + r.response.statusCode);
  return d;
}

// getikt op het widget: eerst de actie uitvoeren
const q = args.queryParameters || {};
let banner = null;
try {
  if (q.act === "pause") {
    await api("/api/widget/pause", { action: q.v });
    banner = q.v === "start" ? "✔ Pauze gestart" : "✔ Pauze gestopt";
  } else if (q.act === "check") {
    await api("/api/widget/check", { date: q.d, projectId: q.p, key: q.k, done: q.v === "1" });
    banner = (q.v === "1" ? "✔ Ingeladen: " : "↺ Niet meer ingeladen: ") + (q.t || "");
  }
} catch (e) { banner = "⚠ " + (e.message || e); }

// in de app (na een tik) tonen we het middelgrote widget, zodat je verder kan aftikken
const family = config.runsInWidget ? (config.widgetFamily || "small") : "medium";
const taps = family === "medium" || family === "large";
const link = (p) => "scriptable:///run/" + encodeURIComponent(Script.name()) + "?" + Object.keys(p).map((k) => k + "=" + encodeURIComponent(p[k])).join("&");
const w = new ListWidget();
const style = (x, font, color, lines) => { x.font = font; x.textColor = color; if (lines) x.lineLimit = lines; x.minimumScaleFactor = 0.7; return x; };
const text = (t, font, color, lines) => style(w.addText(t), font, color, lines);
/** regel met een eigen tikvlak (enkel middelgroot en groot) */
function tapRow(t, font, color, url, button) {
  if (!taps) return text(t, font, color, 1);
  const s = w.addStack();
  s.url = url;
  s.centerAlignContent();
  if (button) { s.backgroundColor = BTN; s.cornerRadius = 8; s.setPadding(4, 8, 4, 8); }
  style(s.addText(t), font, color, 1);
  if (!button) s.addSpacer();
  return s;
}
/** vandaag nog geen locatie: OwnTracks is waarschijnlijk weggeveegd → tik om het te openen */
function owntracksRow(d) {
  if (!d.otMissing) return;
  if (family === "small") { w.url = "owntracks:///"; text("📍 OwnTracks uit · tik", Font.semiboldSystemFont(11), RED, 1); }
  else tapRow("📍 OwnTracks staat uit · tik om te openen", Font.semiboldSystemFont(12), RED, "owntracks:///", true);
  w.addSpacer(3);
}
function pauseButton(d) {
  if (!taps || !["werk", "pauze", "onderweg"].includes(d.status)) return;
  w.addSpacer(4);
  if (d.pause === "loopt") tapRow("☕ Pauze stoppen · sinds " + hhmm(d.pauseSince), Font.semiboldSystemFont(12), FG, link({ act: "pause", v: "stop" }), true);
  else if (d.pause === "mogelijk") tapRow("☕ Pauze starten", Font.semiboldSystemFont(12), FG, link({ act: "pause", v: "start" }), true);
}
try {
  const d = await api("/api/widget");
  const status = STATUS[d.status] + (d.since && ["werk", "pauze"].includes(d.status) ? " sinds " + hhmm(d.since) : "");
  const openPlan = (d.plan || []).some((p) => p.material.some((m) => !m.done));
  w.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e"));
  if (family.startsWith("accessory")) {
    // vergrendelscherm
    w.backgroundColor = null;
    text("Enautec · " + hm(d.workedMin), Font.boldSystemFont(14), Color.white(), 1);
    text(d.otMissing ? "📍 OwnTracks uit" : d.openCount ? "❓ vraag open" : status, Font.systemFont(12), Color.white(), 1);
    if (d.otMissing) w.url = "owntracks:///";
    if (family === "accessoryRectangular" && (d.project || d.place)) text(d.project || d.place, Font.systemFont(12), Color.white(), 1);
  } else if ((d.plan || []).length && (d.status === "geen" || new Date().getHours() < 10 || (!config.runsInWidget && openPlan && q.act === "check"))) {
    // 's ochtends: wat staat er vandaag gepland en welk materiaal moet mee (tik = ingeladen)
    w.setPadding(12, 14, 12, 14);
    if (banner) text(banner, Font.semiboldSystemFont(11), RED, 1);
    const max = family === "large" ? 14 : family === "medium" ? 5 : 3;
    text("ENAUTEC · VANDAAG", Font.heavySystemFont(11), RED, 1);
    w.addSpacer(3);
    owntracksRow(d);
    let left = max;
    for (const p of d.plan.slice(0, family === "small" ? 1 : 3)) {
      text(p.project, Font.boldSystemFont(family === "small" ? 13 : 14), FG, family === "small" ? 2 : 1);
      if (family !== "small" && (p.place || p.note)) text([p.place, p.note].filter(Boolean).join(" · "), Font.systemFont(11), MUTED, 1);
      if (!p.material.length) { text("Geen materiaal opgegeven", Font.systemFont(11), MUTED, 1); continue; }
      // nog in te laden eerst
      const list = p.material.filter((m) => !m.done).concat(p.material.filter((m) => m.done));
      for (const m of list.slice(0, Math.max(left, 0))) {
        tapRow((m.done ? "✅ " : "⬜️ ") + m.text, Font.systemFont(12), m.done ? MUTED : FG,
          link({ act: "check", d: d.date, p: p.projectId, k: m.key, v: m.done ? "0" : "1", t: m.text }));
      }
      if (list.length > left) text("+ " + (list.length - Math.max(left, 0)) + " meer in de app", Font.systemFont(11), MUTED, 1);
      left -= list.length;
      w.addSpacer(3);
    }
    if (family === "small") {
      const all = d.plan.flatMap((p) => p.material);
      if (all.length) text(all.filter((m) => m.done).length + "/" + all.length + " ingeladen · tik om af te vinken", Font.systemFont(10), MUTED, 2);
      if (d.plan.length > 1) text("+ " + (d.plan.length - 1) + " project", Font.systemFont(11), MUTED, 1);
    }
    w.addSpacer();
    if (d.openCount) text("❓ " + (d.openCount === 1 ? "1 vraag open" : d.openCount + " vragen open"), Font.semiboldSystemFont(11), RED, 1);
  } else {
    w.setPadding(12, 14, 12, 14);
    if (banner) text(banner, Font.semiboldSystemFont(11), RED, 1);
    text("ENAUTEC", Font.heavySystemFont(11), RED);
    w.addSpacer(2);
    owntracksRow(d);
    text(hm(d.workedMin), Font.boldSystemFont(32), FG, 1);
    text(status, Font.mediumSystemFont(12), MUTED, 1);
    if (d.project || d.place) { w.addSpacer(4); text(d.project || d.place, Font.semiboldSystemFont(12), FG, family === "small" ? 2 : 1); }
    if (family !== "small" && d.project && d.place) text("📍 " + d.place, Font.systemFont(11), MUTED, 1);
    pauseButton(d);
    w.addSpacer();
    if (d.openCount) text("❓ " + (d.openCount === 1 ? "1 vraag open" : d.openCount + " vragen open"), Font.semiboldSystemFont(11), RED, 1);
    else text("Bijgewerkt " + hhmm(d.now), Font.systemFont(10), MUTED, 1);
  }
  if (d.scriptVersion > SCRIPT_VERSION && !family.startsWith("accessory")) text("Nieuwe versie: app → Meer → Widget instellen", Font.systemFont(10), RED, 2);
} catch (e) {
  w.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e"));
  text("ENAUTEC", Font.heavySystemFont(11), RED);
  w.addSpacer(4);
  text(String(e.message || e), Font.systemFont(12), FG, 4);
}
w.refreshAfterDate = new Date(Date.now() + 10 * 60 * 1000);
if (config.runsInWidget) Script.setWidget(w);
else await w.presentMedium();
Script.complete();
`;
}

/** Scherm "Zet de app op je beginscherm" (op een gsm in de browser, vóór het aanmelden) */
export function installHtml({ ios, canPrompt, installed }) {
  return `<section class="card setup">
    <img src="logo.svg" alt="Enautec" class="welcome-logo">
    <h1>Eerst de app op je beginscherm</h1>
    <p>Op je gsm gebruik je Enautec Uren als app op je beginscherm. Enkel zo krijg je meldingen en blijf je aangemeld.</p>
    ${installed ? '<div class="notice ok">✔ Geïnstalleerd. Open nu <b>Enautec Uren</b> via het icoon op je beginscherm en meld je daar aan.</div>'
      : ios ? `<ol class="setup-steps">
        <li>Open deze pagina in <b>Safari</b> (niet in een andere app).</li>
        <li>Tik onderaan op <b>Deel</b> <span class="ios-share" aria-hidden="true">⬆︎</span> (vierkantje met pijl).</li>
        <li>Scrol en tik op <b>Zet op beginscherm</b> → <b>Voeg toe</b>.</li>
        <li>Open <b>Enautec Uren</b> via het nieuwe icoon en meld je daar aan.</li></ol>`
      : `${canPrompt ? '<button class="primary big" data-act="install">📲 App installeren</button>' : ''}
        <ol class="setup-steps">
        ${canPrompt ? '' : '<li>Tik in Chrome rechtsboven op <b>⋮</b>.</li><li>Kies <b>App installeren</b> of <b>Toevoegen aan startscherm</b>.</li>'}
        <li>Open <b>Enautec Uren</b> via het icoon op je beginscherm en meld je daar aan.</li></ol>`}
    <p class="muted small">Op een computer kan je gewoon in de browser aanmelden.</p>
  </section>`;
}

const ALL_STEPS = [
  ['home', '📲', 'Beginscherm'],
  ['push', '🔔', 'Meldingen'],
  ['owntracks', '📍', 'OwnTracks'],
  ['auto', '⏰', 'Automatisch'], // enkel iPhone
  ['widget', '🧩', 'Widget'],
];

/** Uitleg: OwnTracks elke werkdag zelf laten openen (Opdrachten-app op iPhone) */
export function autoOpenHtml() {
  return `<p class="muted small">In de app <b>Opdrachten</b> maak je een opdracht die zelf start op een vast uur. Ze opent OwnTracks.</p>
    <ol class="setup-steps">
      <li>Open de app <b>Opdrachten</b> (blauw-roze icoon) en maak een nieuwe opdracht met <b>+</b>, met een automatisering <b>Tijdstip</b>.
        Je ziet dan bovenaan een blok <b>"Om …"</b> met Activiteit, Herhaal, Automatisering en Meld.</li>
      <li>Tik op het uur en kies een uur vóór je vertrekt (bv. <b>06:30</b>).</li>
      <li>Tik bij <b>Herhaal</b> op "Elke dag" en kies <b>maandag t.e.m. vrijdag</b>.</li>
      <li>Laat <b>Automatisering</b> aan (groen): dan start ze zonder te vragen. <b>Meld</b> mag uit.</li>
      <li>Tik onderaan in <b>Zoek</b>, typ <b>Open app</b> en tik op die actie. Tik in de actie op het blauwe woord <b>App</b> en kies <b>OwnTracks</b>.</li>
      <li>Tik linksboven op <b>‹</b>: het is bewaard. Er is geen knop "Volgende".</li>
    </ol>
    <details><summary>Oudere iPhone (iOS 18 of vroeger)?</summary>
      <p class="muted small">Tik in Opdrachten onderaan op <b>Automatisering</b> → <b>+</b> → <b>Tijdstip</b>. Kies het uur en <b>Wekelijks</b> (ma–vr) en <b>Voer onmiddellijk uit</b>, en tik op <b>Volgende</b>. Kies <b>Nieuwe lege automatisering</b> → <b>Open app</b> → <b>OwnTracks</b>.</p></details>
    <details><summary>Rij je met CarPlay of Bluetooth in de wagen? (aangeraden)</summary>
      <p class="muted small">Maak op dezelfde manier een tweede opdracht, maar kies als activiteit <b>CarPlay</b> (verbinding maken) of <b>Bluetooth</b> (je wagen), met de actie <b>Open app</b> → <b>OwnTracks</b>. Dan gaat OwnTracks ook open telkens je instapt.</p></details>
    <p class="muted small">Testen: veeg OwnTracks weg uit het app-overzicht en tik op <a href="owntracks:///">OwnTracks openen</a>. Vergeet je het toch, dan krijg je om 08:00 een melding als er nog geen locatie binnenkwam.</p>`;
}

// ---------- OwnTracks: handleiding met tekeningen van de schermen ----------
// Elke stap toont een klein gsm-scherm zoals je het ziet, met een rode cirkel "tik hier".
const tap = (inner, label = 'Tik hier') => `<span class="ph-tap">${inner}<span class="ph-tap-lbl">👆 ${label}</span></span>`;
const phone = (title, body, { back = false } = {}) => `<div class="ph" aria-hidden="true">
  <div class="ph-top">${back ? '<span class="ph-back">‹</span>' : '<span></span>'}<b>${title}</b><span></span></div>
  <div class="ph-body">${body}</div></div>`;
const row = (label, right = '', cls = '') => `<div class="ph-row ${cls}"><span>${label}</span><span class="ph-right">${right}</span></div>`;
const sw = (on = true) => `<span class="ph-sw ${on ? 'on' : ''}"><i></i></span>`;

/** De stappen voor OwnTracks, met tekeningen. link = de knop die alles in één keer instelt. */
export function owntracksGuideHtml({ ios = true, link = '', ot = null, server = '' } = {}) {
  const store = ios ? 'App Store' : 'Google Play';
  const storeUrl = ios ? 'https://apps.apple.com/app/owntracks/id692424691' : 'https://play.google.com/store/apps/details?id=org.owntracks.android';
  // pic: één tekening, of een lijst [tekst, tekening] die na elkaar komen (a, b, c…)
  const step = (n, title, text, pic = '') => `<li class="ot-step"><div class="ot-num">${n}</div><div class="ot-txt"><h3>${title}</h3>${text}</div>${!pic ? ''
    : Array.isArray(pic) ? `<div class="ot-pics">${pic.map(([t, p], i) => `<div class="ot-sub"><p><b class="ot-letter">${'abcdef'[i]}</b> ${t}</p><div class="ot-pic">${p}</div></div>`).join('')}</div>`
    : `<div class="ot-pic">${pic}</div>`}</li>`;
  const steps = [
    step(1, 'OwnTracks installeren',
      `<p>Tik op de knop. De ${store} opent. Tik daar op <b>${ios ? 'Download' : 'Installeren'}</b>${ios ? ' (of het wolkje ☁️)' : ''}.</p>
       <a class="btn secondary" href="${storeUrl}" target="_blank" rel="noopener">📲 OwnTracks in de ${store}</a>
       <p class="muted small">Daarna kom je gewoon terug naar deze app.</p>`,
      phone(store, `<div class="ph-app"><span class="ph-icon">📍</span><span><b>OwnTracks</b><small>Your location companion</small></span>${tap(`<span class="ph-btn">${ios ? 'Download' : 'Installeren'}</span>`)}</div>`)),
    step(2, 'Alles in één keer instellen',
      `<p>Tik op de rode knop hieronder. OwnTracks gaat open en vraagt of het de instellingen mag overnemen. Tik op <b>${ios ? 'Importeren' : 'OK'}</b>.</p>
       ${link ? `<a class="btn primary big" href="${esc(link)}">⚙️ OwnTracks instellen</a>` : '<span class="muted">(laden…)</span>'}`,
      phone('OwnTracks', `<div class="ph-dialog"><b>Configuratie importeren?</b><small>enautec-uren…/api/owntracks</small>
        <div class="ph-dialog-btns"><span>Annuleren</span>${tap('<span class="ph-btn">Importeren</span>')}</div></div>`)),
    ios ? step(3, 'Toegang geven in de iPhone-instellingen',
      `<p>Open de app <b>Instellingen</b> van je iPhone (het grijze tandwiel ⚙️) en volg a tot d.</p>
       <p class="muted small">Zonder deze toegang werkt OwnTracks enkel als de app open staat.</p>`,
      [
        ['Scrol helemaal naar beneden en tik op <b>Apps</b>.',
          phone('Instellingen', `<div class="ph-group">${row('🔒 Privacy en beveiliging', '›')}</div><div class="ph-group">${row('☁️ iCloud', '›')}${row('💳 Wallet en Apple Pay', '›')}</div>
            <div class="ph-group">${tap(row('🔲 <b>Apps</b>', '›'))}</div><div class="ph-search">🔍 Zoek</div>`)],
        ['Tik onderaan in <b>Zoek apps</b>, typ <b>Own</b> en tik op <b>OwnTracks</b>.',
          phone('Apps', `<div class="ph-search">🔍 Own</div><div class="ph-group">${tap(row('📍 <b>OwnTracks</b>', '›'))}</div>`, { back: true })],
        ['Zet alles zoals hier: <b>Locatie</b> op <b>Altijd</b>, en <b>Beweging en conditie</b>, <b>Ververs op achtergrond</b> en <b>Mobiele data</b> aan (groen). Tik daarna op <b>Locatie</b>.',
          phone('OwnTracks', `<div class="ph-group">${tap(row('➤ Locatie', '<small>Altijd</small> ›'), 'Tik hier')}${row('🏃 Beweging en conditie', sw(true))}${row('🔔 Meldingen', '›')}
            ${row('🔄 Ververs op achtergrond', tap(sw(true), 'Aan!'))}${row('📶 Mobiele data', sw(true))}</div>`, { back: true })],
        ['Tik op <b>Altijd</b> en zet <b>Nauwkeurige locatie</b> aan.',
          phone('Locatie', `<div class="ph-group">${row('Nooit')}${row('Vraag volgende keer')}${row('Bij gebruik van app')}${tap(row('Altijd', '<b class="ph-check">✓</b>', 'sel'))}</div>
            <div class="ph-group">${row('Nauwkeurige locatie', tap(sw(true), 'Aan'))}</div>`, { back: true })],
      ])
      : step(3, 'Locatie: altijd toestaan',
        `<p>Vraagt OwnTracks om je locatie? Kies <b>Altijd toestaan</b> (of "Toestaan, altijd").</p>
         <p>Open daarna de <b>Instellingen</b> van je gsm → <b>Apps</b> → <b>OwnTracks</b> → <b>Batterij</b> en kies <b>Onbeperkt</b> (niet optimaliseren).</p>`,
        phone('Locatietoegang', `<div class="ph-group">${tap(row('Altijd toestaan', '<b class="ph-check">●</b>', 'sel'))}${row('Alleen toestaan bij gebruik van app')}${row('Niet toestaan')}</div>`, { back: true })),
    step(4, 'Kies "Significant"',
      `<p>Open <b>OwnTracks</b>. Bovenaan op de kaart staan vier knoppen. Tik op <b>Significant</b>: dan volgt OwnTracks je de hele dag, zonder je batterij leeg te trekken.</p>`,
      phone('Kaart', `<div class="ph-map"><div class="ph-seg"><span>Rustig</span><span>Handmatig</span>${tap('<span class="on">Significant</span>')}<span>Actie</span></div><span class="ph-pin">📍</span></div>`)),
    step(5, 'Controleren',
      `<p>Tik in OwnTracks linksboven op <b>ⓘ</b>. Bij <b>Plaats</b> → <b>Coördinaten</b> zie je "… seconden geleden": OwnTracks werkt.</p>
       <p>Kom terug naar deze app: hieronder verschijnt dan een groen vinkje ✔.</p>`,
      phone('Statusinformatie', `<div class="ph-group">${row('Toestand', '<small>inactief</small>')}</div>
        <div class="ph-group">${tap(row('Coördinaten', '<small>51,0…° 3,1…°<br>1 seconde geleden</small>'), 'Kijk hier')}</div>`, { back: true })),
  ];
  // manueel: het instellingenscherm van OwnTracks met de velden genummerd
  const fields = ot ? [['URL', `${server}/api/owntracks`], ['Gebruikersnaam', ot.username], ['Wachtwoord', ot.password], ['Apparaat ID', 'gsm']] : [];
  const manual = ot ? `<details class="ot-manual"><summary>De knop in stap 2 lukt niet? Zo stel je het zelf in</summary>
      <ol class="ot-mini">
        <li>Open OwnTracks en tik linksboven op <b>ⓘ</b>, daarna op <b>Instellingen</b>.</li>
        <li>Tik bij <b>Mode</b> op <b>HTTP</b>.</li>
        <li>Zet <b>Authenticatie</b> aan (groen).</li>
        <li>Tik op elk vak hieronder op <b>Kopieer</b>, tik in OwnTracks op hetzelfde vak en kies <b>Plak</b>.</li>
      </ol>
      ${phone('Instellingen', `<div class="ph-group">${row('Mode', `<span class="ph-seg small"><span>MQTT</span>${tap('<span class="on">HTTP</span>', 'stap 2')}</span>`)}
        ${row('Apparaat ID', '<small>④ gsm</small>')}${row('Gebruikersnaam', '<small>②</small>')}${row('Authenticatie', tap(sw(true), 'stap 3'))}${row('Wachtwoord', '<small>③</small>')}
        <div class="ph-row"><small>① https://…/api/owntracks</small></div></div>`, { back: true })}
      <div class="copy-list">${fields.map(([label, value], i) => `<div class="copy-row"><span class="muted small">${'①②③④'[i]} ${label}</span><code>${esc(value)}</code><button class="secondary" data-copy="${esc(value)}">Kopieer</button></div>`).join('')}</div>
      <p class="muted small">Het OwnTracks-wachtwoord is een aparte code, niet je wachtwoord van deze app.</p>
    </details>` : '';
  return `<ol class="ot-guide">${steps.join('')}</ol>${manual}`;
}

/**
 * Stappen tonen in `el`. deps: { server, session, username, name, ios, deviceKey, deviceLabel,
 *   owntracksLink(ot), getState(), setState(st), onDone(), optional }
 */
export function renderSetup(el, deps) {
  const { server, session } = deps;
  const STEPS = ALL_STEPS.filter(([k]) => k !== 'auto' || deps.ios);
  let me = null;
  let timer = null;
  // het scherm kan opnieuw getekend worden (bv. terug in de app): enkel de laatste keer blijft actief
  const run = {};
  el._setupRun = run;
  const active = () => el._setupRun === run && !!el.querySelector('.setup');
  const st = () => deps.getState() ?? {};
  const save = (patch) => deps.setState({ ...st(), ...patch });
  const auth = { Authorization: `Bearer ${session}` };
  const fetchMe = async () => {
    const r = await fetch(`${server}/api/me`, { headers: auth });
    if (!r.ok) throw new Error(`Server: fout ${r.status}`);
    me = await r.json();
    return me;
  };
  const stepIndex = (k) => STEPS.findIndex(([x]) => x === k);
  const current = () => st().step && stepIndex(st().step) > 0 ? st().step : 'push';
  const go = (k) => { save({ step: k }); draw(); };
  const next = () => {
    const i = stepIndex(current());
    // vanuit Meer voor één stap gestart: daarna klaar
    if (i >= STEPS.length - 1 || st().only === current()) { save({ done: true, step: null, otSince: null, only: null }); clearInterval(timer); el._setupRun = null; deps.onDone(); return; }
    go(STEPS[i + 1][0]);
  };
  const poll = (fn, ms = 5000) => {
    clearInterval(timer);
    timer = setInterval(() => { if (!active()) { clearInterval(timer); return; } fn(); }, ms);
  };

  function frame(body) {
    const cur = stepIndex(current());
    const left = st().only ? 1 : STEPS.length - cur;
    el.innerHTML = `<section class="card setup">
      <h1>Je gsm instellen</h1>
      <p class="muted">Nog ${left} stap${left > 1 ? 'pen' : ''}. Daarna kan je de app gebruiken.</p>
      <ol class="setup-bar">${STEPS.map(([k, ico, label], i) => `<li class="${i < cur ? 'done' : i === cur ? 'now' : ''}"><span aria-hidden="true">${i < cur ? '✔' : ico}</span>${label}</li>`).join('')}</ol>
      <div class="setup-body">${body}</div>
      ${deps.optional ? '<p class="center"><button class="link" data-act="later">Later verder</button></p>' : ''}
    </section>`;
    el.querySelector('[data-act=later]')?.addEventListener('click', () => { clearInterval(timer); el._setupRun = null; save({ done: true, step: null }); deps.onDone(); });
  }

  async function drawPush() {
    const sup = pushSupport();
    let on = false;
    if (sup.ok) {
      const sub = await currentSubscription();
      if (sub) {
        try { on = (await (await fetch(`${server}/api/push/status?endpoint=${encodeURIComponent(sub.endpoint)}`, { headers: auth })).json()).subscribed; } catch { on = false; }
      }
    }
    const denied = sup.ok && Notification.permission === 'denied';
    frame(`<h2>🔔 Meldingen aanzetten</h2>
      <p>De app vraagt via een melding <b>"Aan het werk?"</b> en <b>"Bij wie ben je?"</b>, zodat je het juiste project meteen kiest.</p>
      ${on ? '<div class="notice ok">✔ Meldingen staan aan op deze gsm.</div>'
        : denied ? '<div class="error">Meldingen zijn geweigerd. Zet ze aan bij Instellingen van je gsm → Meldingen → Enautec Uren, en tik daarna op Opnieuw controleren.</div>'
        : !sup.ok ? '<div class="notice">Deze gsm of browser ondersteunt geen meldingen. Je kan verder, maar je krijgt geen vragen.</div>'
        : '<button class="primary big" data-act="pon">🔔 Meldingen aanzetten</button>'}
      <div class="row setup-nav">
        ${on || !sup.ok ? '<button class="primary" data-act="next">Volgende</button>' : denied ? '<button class="secondary" data-act="recheck">Opnieuw controleren</button><button class="link" data-act="next">Toch verder zonder meldingen</button>' : ''}
      </div>`);
    el.querySelector('[data-act=pon]')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try { await enablePush(server, session, deps.deviceLabel()); toast('Meldingen staan aan', 'ok'); } catch (err) { toast(err.message, 'err'); }
      drawPush();
    });
    el.querySelector('[data-act=recheck]')?.addEventListener('click', drawPush);
    el.querySelector('[data-act=next]')?.addEventListener('click', next);
  }

  async function drawOwnTracks() {
    const startedAt = st().otSince ?? Date.now();
    if (!st().otSince) save({ otSince: startedAt });
    try { await fetchMe(); } catch { /* offline: hieronder opnieuw */ }
    const ot = me?.owntracks;
    // een locatie van de laatste 15 minuten (of sinds deze stap) = OwnTracks werkt
    const ok = me?.lastLocation && me.lastLocation >= Math.min(startedAt, Date.now() - 15 * MIN);
    const status = ok ? `<div class="notice ok">✔ Locatie ontvangen om ${new Date(me.lastLocation).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}. OwnTracks werkt.</div>`
      : '<div class="notice wait"><span class="spinner" aria-hidden="true"></span> Wachten op je eerste locatie…</div>';
    frame(`<h2>📍 OwnTracks instellen</h2>
      <p>OwnTracks stuurt je locatie door, zodat de app je uren en verplaatsingen zelf voorstelt. Volg de 5 stappen. Op elke tekening toont de <b class="red-text">rode cirkel</b> waar je tikt.</p>
      ${ok ? status : ''}
      ${owntracksGuideHtml({ ios: deps.ios, link: ot ? deps.owntracksLink(ot) : '', ot, server })}
      ${ok ? '' : status}
      <div class="row setup-nav">${ok ? '<button class="primary" data-act="next">Volgende</button>' : '<button class="secondary" data-act="recheck">Opnieuw controleren</button>'}</div>`);
    el.querySelectorAll('[data-copy]').forEach((b) => b.onclick = async () => { await copyText(b.dataset.copy); b.textContent = '✔ Gekopieerd'; });
    el.querySelector('[data-act=recheck]')?.addEventListener('click', drawOwnTracks);
    el.querySelector('[data-act=next]')?.addEventListener('click', next);
    if (!ok) poll(async () => { try { await fetchMe(); } catch { return; } if (me?.lastLocation && me.lastLocation >= Math.min(startedAt, Date.now() - 15 * MIN)) drawOwnTracks(); });
    else clearInterval(timer);
  }

  async function drawWidget() {
    clearInterval(timer);
    if (!deps.ios) {
      frame(`<h2>🧩 Snel naar de app</h2>
        <p>Widgets met je uren bestaan voorlopig enkel op iPhone. Op Android kan je wel snel naar een scherm springen:</p>
        <ol class="setup-steps"><li>Hou het icoon van <b>Enautec Uren</b> op je beginscherm ingedrukt.</li>
          <li>Je ziet <b>Vandaag</b>, <b>Materiaal</b>, <b>Planning</b> en <b>ToDo</b>. Sleep er één naar je beginscherm voor een eigen icoon.</li></ol>
        <div class="row setup-nav"><button class="primary" data-act="next">Klaar</button></div>`);
      el.querySelector('[data-act=next]').onclick = next;
      return;
    }
    const s = st();
    try { await fetchMe(); } catch { /* offline */ }
    const ok = s.widgetAt && me?.widgetSeen && me.widgetSeen >= s.widgetAt;
    frame(`<h2>🧩 Widget op je beginscherm</h2>
      <p>Het widget toont 's ochtends je planning en het materiaal dat mee moet, en daarna je uren van vandaag, waar je bent en of er een vraag openstaat. Kies <b>middelgroot</b>: dan tik je op een materiaalregel om ze af te vinken als ingeladen, en op <b>☕ Pauze starten/stoppen</b>. Scriptable opent dan even; veeg daarna terug naar je beginscherm.</p>
      <ol class="setup-steps">
        <li>Installeer de gratis app <b>Scriptable</b> uit de App Store.</li>
        <li>${s.script ? '<button class="primary" data-act="copy">📋 Kopieer het script</button>' : '<button class="primary" data-act="make">Script klaarzetten</button>'}
          ${s.script ? '<span class="muted small"> (opnieuw kopiëren kan altijd)</span>' : ''}</li>
        <li>Open <b>Scriptable</b>, tik rechtsboven op <b>+</b>, tik in het lege blad en kies <b>Plak</b>.</li>
        <li>Tik bovenaan op de naam en noem het script <b>Enautec</b>. Tik onderaan op <b>▶</b>: je ziet het widget. Tik op <b>Klaar</b>.</li>
        <li>Op je beginscherm: hou een lege plek ingedrukt → <b>Wijzig</b> → <b>Voeg widget toe</b> → <b>Scriptable</b> → klein of middelgroot formaat → <b>Voeg widget toe</b>.</li>
        <li>Tik op het nieuwe widget (terwijl de iconen wiebelen) en kies bij <b>Script</b>: <b>Enautec</b>.</li>
      </ol>
      ${ok ? '<div class="notice ok">✔ Het widget werkt.</div>'
        : s.script ? '<div class="notice wait"><span class="spinner" aria-hidden="true"></span> Wachten tot het widget (of ▶ in Scriptable) de eerste keer je gegevens ophaalt…</div>' : ''}
      ${s.script ? `<details><summary>Kopiëren lukt niet?</summary><p class="muted small">Selecteer de tekst hieronder (lang tikken → Alles selecteren → Kopieer).</p>
        <textarea class="script-box" readonly rows="6">${esc(s.script)}</textarea></details>` : ''}
      <div class="row setup-nav">${ok ? '<button class="primary" data-act="next">Klaar</button>' : s.script ? '<button class="secondary" data-act="recheck">Opnieuw controleren</button>' : ''}</div>`);
    el.querySelector('[data-act=make]')?.addEventListener('click', async (e) => {
      e.target.disabled = true;
      try {
        const r = await fetch(`${server}/api/me/widget`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceKey: deps.deviceKey() }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? `Server: fout ${r.status}`);
        save({ script: widgetScript({ server, key: d.key, name: deps.name }), widgetAt: Date.now() - 5000 });
      } catch (err) { toast(err.message, 'err'); }
      drawWidget();
    });
    el.querySelector('[data-act=copy]')?.addEventListener('click', async (e) => {
      try { await copyText(st().script); e.target.textContent = '✔ Gekopieerd'; toast('Script gekopieerd. Plak het nu in Scriptable.', 'ok'); } catch { toast('Kopiëren lukte niet: gebruik "Kopiëren lukt niet?" hieronder.', 'err'); }
    });
    el.querySelector('[data-act=recheck]')?.addEventListener('click', drawWidget);
    el.querySelector('[data-act=next]')?.addEventListener('click', next);
    if (s.script && !ok) poll(async () => { try { await fetchMe(); } catch { return; } if (me?.widgetSeen && me.widgetSeen >= st().widgetAt) drawWidget(); });
  }

  function drawAuto() {
    clearInterval(timer);
    frame(`<h2>⏰ OwnTracks automatisch openen</h2>
      <p>Veeg je OwnTracks weg uit het app-overzicht, dan stuurt je iPhone <b>geen locaties</b> meer en worden je uren niet bijgehouden. Laat je iPhone OwnTracks daarom elke werkdag zelf openen.</p>
      ${autoOpenHtml()}
      <div class="row setup-nav"><button class="primary" data-act="next">✔ Ingesteld</button></div>`);
    el.querySelector('[data-act=next]').onclick = () => { save({ auto: true }); next(); };
  }

  function draw() {
    const k = current();
    if (k === 'push') return drawPush();
    if (k === 'owntracks') return drawOwnTracks();
    if (k === 'auto') return drawAuto();
    return drawWidget();
  }
  // terug in de app (na OwnTracks of Scriptable): meteen opnieuw controleren
  const onVisible = () => { if (!active()) { document.removeEventListener('visibilitychange', onVisible); return; } if (document.visibilityState === 'visible') draw(); };
  document.addEventListener('visibilitychange', onVisible);
  draw();
}
