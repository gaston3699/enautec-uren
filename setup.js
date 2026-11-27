// Eerste keer aanmelden op een gsm: verplichte stappen voor je de app kan gebruiken.
//  1. App op het beginscherm (al gebeurd: aanmelden op een gsm kan enkel in de app op het beginscherm)
//  2. Meldingen aanzetten
//  3. OwnTracks instellen (klaar zodra de eerste locatie binnenkomt)
//  4. Widget (iPhone: Scriptable; klaar zodra het widget de eerste keer gegevens ophaalt)
import { esc, toast, copyText, info } from './ui.js';
import { pushSupport, enablePush, currentSubscription } from './questions.js';

const MIN = 60000;

import { SCRIPT_VERSION, widgetScript } from './widget-script.js';

export { SCRIPT_VERSION, widgetScript };

/** Scherm "Zet de app op je beginscherm" (op een gsm in de browser, vóór het aanmelden) */
export function installHtml({ ios, canPrompt, installed }) {
  return `<section class="card setup">
    <img src="logo.svg" alt="Enautec" class="welcome-logo">
    <h1>Eerst de app op je beginscherm${info('Op je gsm gebruik je Enautec Uren als app op je beginscherm. Enkel zo krijg je meldingen en blijf je aangemeld. Op een computer kan je gewoon in de browser aanmelden.')}</h1>
    ${installed ? '<div class="notice ok">✔ Geïnstalleerd. Open nu <b>Enautec Uren</b> via het icoon op je beginscherm en meld je daar aan.</div>'
      : ios ? homeGuideHtml()
      : `${canPrompt ? '<button class="primary big" data-act="install">📲 App installeren</button>' : ''}
        <ol class="setup-steps">
        ${canPrompt ? '' : '<li>Tik in Chrome rechtsboven op <b>⋮</b>.</li><li>Kies <b>App installeren</b> of <b>Toevoegen aan startscherm</b>.</li>'}
        <li>Open <b>Enautec Uren</b> via het icoon op je beginscherm en meld je daar aan.</li></ol>`}
  </section>`;
}

const ALL_STEPS = [
  ['home', '📲', 'Beginscherm'],
  ['push', '🔔', 'Meldingen'],
  ['owntracks', '📍', 'OwnTracks'],
  ['auto', '⏰', 'Automatisch'], // enkel iPhone
  ['widget', '🧩', 'Widget'],
];

/** Uitleg: OwnTracks elke werkdag zelf laten openen (Opdrachten-app op iPhone), met tekeningen */
export function autoOpenHtml() {
  const sheet = (body) => `<div class="ph-sheet">${body}</div>`;
  const action = (icon, color, label, inner = label) => `<div class="ph-action"><span class="ph-ai" style="background:${color}">${icon}</span><span>${inner}</span><span class="ph-i">i</span></div>`;
  const steps = [
    guideStep(1, 'Opdrachten openen',
      `<p>Zoek op je iPhone de app <b>Opdrachten</b> (paars-roze icoon, twee blokjes op elkaar) en open ze.</p>
       <p>Tik <b>onderaan in het midden</b> op de ronde <b>+</b>.</p>`,
      phone('Alle opdrachten', `<div class="ph-empty">◇<br><b>Geen opdrachten</b></div>${fab()}`, { back: true })),
    guideStep(2, 'Kies "Tijdstip"', '<p>Onderaan schuift een lijst omhoog.</p>', [
      ['Tik op het blauwe knopje <b>Automatisering</b>.',
        phone('Opdracht ⌄', sheet(`<div class="ph-search">🔍 Zoek</div><div class="ph-chips">${tap('<span class="ph-chip">⏱ Automatisering</span>')}<span class="ph-chip">Scripten</span></div>
          ${action('💬', '#34c759', 'Verstuur bericht')}${action('↗', '#5e5ce6', 'Open app')}`), { back: true })],
      ['Tik op <b>Tijdstip</b> (bovenaan, met de oranje klok).',
        phone('', sheet(`<div class="ph-search">🔍 <span class="ph-chip small">⏱ Automatisering</span></div><b class="ph-h">Dagelijkse routine</b>
          ${tap(`<div class="ph-action"><span class="ph-ai" style="background:#ff9f0a">🕘</span><span><b>Tijdstip</b><small>"Om 8 uur, op weekdagen"</small></span><span class="ph-i">i</span></div>`)}
          <div class="ph-action"><span class="ph-ai" style="background:#ff9f0a">⏰</span><span><b>Wekker</b></span><span class="ph-i">i</span></div>`))],
    ]),
    guideStep(3, 'Het uur kiezen', '<p>Bovenaan staat nu een blok <b>Om 08:00</b>.</p>', [
      ['Tik op het <b>blauwe uur</b> en kies een uur vóór je vertrekt, bv. <b>06:30</b>.',
        phone('Opdracht ⌄', `<div class="ph-block">🕘 Om ${tap('<span class="ph-blue">06:30</span>', 'Uur kiezen')} <span class="ph-blue">⊙›</span></div>`, { back: true })],
      ['Tik op het <b>blauwe pijltje ›</b>. Kies bij <b>Herhaal</b> maandag tot vrijdag. <b>Automatisering</b> moet aan staan (groen).',
        phone('Opdracht ⌄', `<div class="ph-block">🕘 Om <span class="ph-blue">06:30</span> ${tap('<span class="ph-blue">⊙›</span>', 'Dagen')}</div>
          <div class="ph-group">${row('Herhaal', '<small>ma, di, wo, do, vr</small> ›')}${row('Automatisering', sw(true))}${row('Meld', sw(false))}</div>`, { back: true })],
    ]),
    guideStep(4, 'OwnTracks laten openen', '', [
      ['Tik onderaan in de lijst op <b>Open app</b>. Zie je het niet? Typ "Open app" in <b>Zoek</b>.',
        phone('Opdracht ⌄', `<div class="ph-block">🕘 Om <span class="ph-blue">06:30</span> <span class="ph-blue">⊙›</span></div>
          ${sheet(`<div class="ph-search">🔍 Zoek</div>${action('💬', '#34c759', 'Verstuur bericht')}${tap(action('↗', '#5e5ce6', 'Open app'))}${action('♫', '#fc3c44', 'Speel muziek af')}`)}`, { back: true })],
      ['Tik in het nieuwe blok op het lichtblauwe woord <b>app</b> en kies <b>OwnTracks</b>.',
        phone('Open app ⌄', `<div class="ph-block">🕘 Om <span class="ph-blue">06:30</span> <span class="ph-blue">⊙›</span></div>
          <div class="ph-block"><span class="ph-ai" style="background:#5e5ce6">↗</span> Open ${tap('<span class="ph-blue dim">app</span>', 'Kies OwnTracks')}</div>`, { back: true })],
    ]),
    guideStep(5, 'Bewaren',
      `<p>Zo moet het eruitzien. Tik linksboven op <b>‹</b>. Er is geen knop "Klaar" of "Volgende": het is meteen bewaard.</p>
       <p>Je ziet de opdracht nu bij <b>Alle opdrachten</b>.</p>`,
      phone('Open app ⌄', `<div class="ph-block">🕘 Om <span class="ph-blue">06:30</span> <span class="ph-blue">⊙›</span></div>
        <div class="ph-block"><span class="ph-ai" style="background:#5e5ce6">↗</span> Open <span class="ph-blue">📍 OwnTracks</span></div>`, { left: tap('<span class="ph-back">‹</span>', 'Bewaren') })),
  ];
  return `<p>Zo gaat OwnTracks elke werkdag vanzelf open, ook als je het per ongeluk hebt weggeveegd.</p>
    <ol class="ot-guide">${steps.join('')}</ol>
    <details><summary>Oudere iPhone (iOS 18 of vroeger)?</summary>
      <p class="muted small">Tik in Opdrachten onderaan op <b>Automatisering</b> → <b>+</b> → <b>Tijdstip</b>. Kies het uur en <b>Wekelijks</b> (ma–vr) en <b>Voer onmiddellijk uit</b>, en tik op <b>Volgende</b>. Kies <b>Nieuwe lege automatisering</b> → <b>Open app</b> → <b>OwnTracks</b>.</p></details>
    <details><summary>Rij je met CarPlay of Bluetooth in de wagen? (aangeraden)</summary>
      <p class="muted small">Maak op dezelfde manier een tweede opdracht, maar kies als activiteit <b>CarPlay</b> (verbinding maken) of <b>Bluetooth</b> (je wagen), met de actie <b>Open app</b> → <b>OwnTracks</b>. Dan gaat OwnTracks ook open telkens je instapt.</p></details>
    <p class="muted small">Testen: veeg OwnTracks weg uit het app-overzicht en tik op <a href="owntracks:///">OwnTracks openen</a>. Vergeet je het toch, dan krijg je om 08:00 een melding als er nog geen locatie binnenkwam.</p>`;
}

// ---------- OwnTracks: handleiding met tekeningen van de schermen ----------
// Elke stap toont een klein gsm-scherm zoals je het ziet, met een rode cirkel "tik hier".
const tap = (inner, label = 'Tik hier', cls = '') => `<span class="ph-tap ${cls}">${inner}<span class="ph-tap-lbl">👆 ${label}</span></span>`;
const phone = (title, body, { back = false, left = '', right = '' } = {}) => `<div class="ph" aria-hidden="true">
  <div class="ph-top">${left || (back ? '<span class="ph-back">‹</span>' : '<span></span>')}<b>${title}</b><span>${right}</span></div>
  <div class="ph-body">${body}</div></div>`;
/** ronde + onderaan in het midden (Scriptable, Opdrachten) */
const fab = (label = 'Tik op +') => `<div class="ph-fabrow">${tap('<span class="ph-fab">+</span>', label)}</div>`;
/** genummerde stap met uitleg en één tekening, of een lijst [tekst, tekening] (a, b, c…) */
const guideStep = (n, title, text, pic = '') => `<li class="ot-step"><div class="ot-num">${n}</div><div class="ot-txt"><h3>${title}</h3>${text}</div>${!pic ? ''
  : Array.isArray(pic) ? `<div class="ot-pics">${pic.map(([t, p], i) => `<div class="ot-sub"><p><b class="ot-letter">${'abcdef'[i]}</b> ${t}</p><div class="ot-pic">${p}</div></div>`).join('')}</div>`
  : `<div class="ot-pic">${pic}</div>`}</li>`;

/** iPhone: de app op het beginscherm zetten (Safari), met tekeningen */
export function homeGuideHtml() {
  const bar = (menuTap) => `<div class="ph-safari"><span class="ph-round">‹</span><span class="ph-addr">${menuTap ? tap('<span class="ph-menu-ic">≡</span>', 'Tik hier', 'l') : '<span class="ph-menu-ic">≡</span>'}<span>gaston3699.github.io</span><span>↻</span></span><span class="ph-round">⧉</span></div>`;
  const page = '<div class="ph-page"><b>Eerst de app op je beginscherm</b><small>1. Open deze pagina in Safari…</small></div>';
  const steps = [
    guideStep(1, 'Open deze pagina in Safari',
      `<p>Safari is het blauwe kompas 🧭 op je iPhone. Kwam je hier via WhatsApp of mail? Tik dan op de knop om de link te kopiëren, open <b>Safari</b>, tik in de adresbalk en kies <b>Plak en bezoek</b>.</p>
       <button type="button" class="secondary" data-copy="${esc(location.origin + location.pathname)}">🔗 Kopieer de link</button>`),
    guideStep(2, 'Het menu openen', '', [
      ['Tik onderaan in de adresbalk op de <b>drie streepjes ≡</b> (links).', phone('', `${page}${bar(true)}`)],
      ['Tik bovenaan in het menu op <b>Deel</b>.',
        phone('', `<div class="ph-menu">${['<div class="ph-mi">' + tap('⇪ Deel') + '</div>', '<div class="ph-mi">🔗 Kopieer</div>', '<div class="ph-mi">📋 Plak en bezoek</div>', '<div class="ph-mi">🎙 Zoek met stem</div>', '<div class="ph-mi" style="color:#ff453a">✕ Sluit tabblad</div>'].join('')}</div>`)],
    ]),
    guideStep(3, 'Zet op beginscherm', '', [
      ['Scrol een beetje naar beneden en tik op <b>Zet op beginscherm</b> (vierkantje met een +).',
        phone('', `<div class="ph-app"><span class="ph-icon" style="background:#fff">🎄</span><span><b>Enautec Uren</b><small>gaston3699.github.io</small></span><span class="ph-x">✕</span></div>
          <div class="ph-group">${row('📖 Voeg bladwijzer toe aan…')}${row('☆ Zet in favorieten')}${row('🔍 Zoek op pagina')}${tap(row('⊞ <b>Zet op beginscherm</b>'))}</div>`)],
      ['Tik rechtsboven op <b>Voeg toe</b>.',
        phone('Zet op beginscherm', `<div class="ph-app"><span class="ph-icon" style="background:#fff">🎄</span><span><b>Enautec Uren</b><small>gaston3699.github.io</small></span></div>
          <div class="ph-group">${row('Open als webapp', sw(true))}</div>`, { left: '<span class="ph-blue">Annuleer</span>', right: tap('<span class="ph-blue">Voeg toe</span>', 'Tik hier', 'r') })],
    ]),
    guideStep(4, 'Open de app via het nieuwe icoon',
      `<p>Ga naar je beginscherm. Daar staat nu <b>Enautec Uren</b> met het Enautec-logo. Tik erop en meld je daar aan.</p>
       <p class="muted small">Meld je aan in de app op je beginscherm, niet hier in Safari: Safari en de app onthouden elk iets anders.</p>`,
      phone('', `<div class="ph-icons">${['<span class="ph-appicon still"><span style="background:#1b2a4a">{ }</span><small>Scriptable</small></span>', `<span class="ph-appicon still">${tap('<span style="background:#fff">🎄</span>', 'Tik', 'l')}<small>Enautec Uren</small></span>`, '<span class="ph-appicon still"><span style="background:#4a6fb5">📍</span><small>OwnTracks</small></span>'].join('')}</div>`)),
  ];
  return `<ol class="ot-guide">${steps.join('')}</ol>
    <details><summary>Zie je geen ≡ in de adresbalk? (oudere iPhone)</summary>
      <p class="muted small">Tik onderaan in het midden op <b>Deel</b> (vierkantje met een pijl omhoog ⬆︎), scrol en tik op <b>Zet op beginscherm</b> → <b>Voeg toe</b>.</p></details>`;
}

/**
 * Widget (Scriptable) instellen, met tekeningen. copyHtml = de knop om het script te kopiëren.
 */
export function widgetGuideHtml(copyHtml = '') {
  const icon = (bg, t, label) => `<span class="ph-appicon"><span style="background:${bg}">${t}</span><small>${label}</small></span>`;
  const menu = (items) => `<div class="ph-menu">${items.join('')}</div>`;
  const steps = [
    guideStep(1, 'Scriptable installeren',
      `<p>Tik op de knop. De App Store opent. Tik daar op <b>Download</b> (of het wolkje ☁️). Daarna kom je terug naar deze app.</p>
       <a class="btn secondary" href="https://apps.apple.com/app/scriptable/id1405459188" target="_blank" rel="noopener">📲 Scriptable in de App Store</a>`,
      phone('App Store', `<div class="ph-app"><span class="ph-icon" style="background:#1b2a4a">{ }</span><span><b>Scriptable</b><small>Automation with JavaScript</small></span>${tap('<span class="ph-btn">Download</span>')}</div>`)),
    guideStep(2, 'Het script kopiëren',
      `<p>Tik op de knop. Je gsm onthoudt nu het script (zoals bij kopiëren en plakken van een tekst).</p>${copyHtml}`),
    guideStep(3, 'Het script in Scriptable plakken', '<p>Open de app <b>Scriptable</b> (zwart icoon met <b>{ }</b>).</p>', [
      ['Tik <b>onderaan in het midden</b> op de ronde <b>+</b>.',
        phone('All Scripts', `<div class="ph-search">🔍 Zoek</div><div class="ph-empty">▢<br><b>No Scripts</b></div>${fab()}`, { back: true })],
      ['Je ziet een leeg blad. <b>Tik in het lege blad</b> en kies <b>Plak</b>. Er komt veel tekst: dat is goed.',
        phone('Untitled Script ⌄', `<div class="ph-code"><span>1</span>${tap('<span class="ph-paste">Plak</span>', 'Tik in het blad → Plak', 'l')}</div>`, { left: '<span class="ph-x">✕</span>' })],
    ]),
    guideStep(4, 'Een naam geven en testen', '', [
      ['Tik bovenaan op <b>Untitled Script ⌄</b> en daarna op <b>Wijzig naam</b>. Typ <b>Enautec</b>.',
        phone(tap('Untitled Script ⌄', 'Tik hier'), `${menu([`<div class="ph-mi">${tap('✎ Wijzig naam')}</div>`, '<div class="ph-mi">🎨 Edit Icon</div>', '<div class="ph-mi">⧉ Duplicate</div>'])}`, { left: '<span class="ph-x">✕</span>' })],
      ['Tik onderaan rechts op <b>▶</b>. Je ziet je widget. Sluit het met <b>✕</b> linksboven: het script is bewaard.',
        phone('Enautec ⌄', `<div class="ph-code small"><span>55</span> w.backgroundColor = …<br><span>56</span> w.setPadding(12, 14, 12, 14);</div>
          <div class="ph-toolbar"><span>⚙</span><span>▤</span><span>⇪</span><span>🔍</span>${tap('<span>▶</span>', 'Testen')}</div>`, { left: '<span class="ph-x">✕</span>' })],
    ]),
    guideStep(5, 'Het widget op je beginscherm zetten', '<p>Ga naar je beginscherm (veeg omhoog).</p>', [
      ['Hou je vinger op een <b>lege plek</b> tot de iconen wiebelen. Tik linksboven op het <b>penseel</b>.',
        phone('', `<div class="ph-editbar">${tap('<span class="ph-pill">🖌</span>', 'Penseel', 'l')}<span class="ph-pill">✓</span></div>
          <div class="ph-icons">${icon('#e8743b', '✳', 'Claude')}${icon('#fff', '🎄', 'Enautec')}${icon('#1b2a4a', '{ }', 'Scriptable')}${icon('#4a6fb5', '📍', 'OwnTracks')}</div>`)],
      ['Tik op <b>Voeg widget toe</b>.',
        phone('', `${menu([`<div class="ph-mi">${tap('⊞ Voeg widget toe')}</div>`, '<div class="ph-mi">✎ Pas aan</div>', '<div class="ph-mi">❀ Wijzig achtergrond</div>', '<div class="ph-mi">▯ Wijzig pagina\'s</div>'])}`)],
      ['Typ bovenaan in <b>Zoek widgets</b>: <b>Scr</b> en tik op <b>Scriptable</b>.',
        phone('', `<div class="ph-search">🔍 Scr</div><div class="ph-group">${tap(row('<span class="ph-mini-icon">{ }</span> <b>Scriptable</b>'))}</div>`)],
      ['Veeg naar links tot je het <b>grote</b> widget ziet (daar past al het materiaal op). Tik op <b>Voeg widget toe</b>.',
        phone('Scriptable', `<div class="ph-wbig"></div><div class="ph-dots">○ ○ ●</div><div class="ph-fabrow">${tap('<span class="ph-btn">+ Voeg widget toe</span>')}</div>`)],
    ]),
    guideStep(6, 'Het script kiezen', '<p>Het nieuwe widget is nog leeg. De iconen wiebelen nog.</p>', [
      ['Tik op het <b>lege widget</b>. Je ziet "Run Script". Tik op <b>Script</b> en kies <b>Enautec</b>.',
        phone('', `<div class="ph-runscript"><div><span class="ph-mini-icon">{ }</span> <b>Run Script</b><small>Scriptable</small></div>
          <div class="ph-group">${tap(row('Script', '<span class="ph-blue">Kies</span>'), 'Kies Enautec')}${row('Parameter', '<small>Parameter</small>')}</div></div>`)],
      ['Tik naast het venster en daarna rechtsboven op <b>✓</b>. Klaar!',
        phone('', `<div class="ph-editbar"><span class="ph-pill">🖌</span>${tap('<span class="ph-pill">✓</span>', 'Klaar')}</div>
          <div class="ph-widget"><b class="r">ENAUTEC</b><b>07:30 Werken Atree</b><span>✓ 50 m kabel 3G2,5</span><span>○ 2 st kabelgoot</span><span class="y">⊕ Toevoegen</span></div>`)],
    ]),
    guideStep(7, 'Zo gebruik je het widget',
      `<p>Tik op een <b>bolletje ○</b> als dat materiaal in de camionette ligt: het wordt een geel vinkje voor iedereen op dat project.</p>
       <p>Tik op <b>⊕ Toevoegen</b> om iets op de lijst te zetten. Tik op <b>☕</b> om je pauze te starten of te stoppen.</p>
       <p class="muted small">Scriptable gaat dan even open. Veeg daarna gewoon terug naar je beginscherm.</p>`),
  ];
  return `<ol class="ot-guide">${steps.join('')}</ol>`;
}
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
    ios ? step(3, `Toegang geven in de iPhone-instellingen${info('Zonder deze toegang werkt OwnTracks enkel als de app open staat.')}`,
      `<p>Open de app <b>Instellingen</b> van je iPhone (het grijze tandwiel ⚙️) en volg a tot d.</p>`,
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
      <div class="copy-list">${fields.map(([label, value], i) => `<div class="copy-row"><span class="muted small">${'①②③④'[i]} ${label}${label === 'Wachtwoord' ? info('Het OwnTracks-wachtwoord is een aparte code, niet je wachtwoord van deze app.') : ''}</span><code>${esc(value)}</code><button class="secondary" data-copy="${esc(value)}">Kopieer</button></div>`).join('')}</div>
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
    // geopend vanuit Meer: terugknop linksboven en enkel deze ene stap (geen stappenbalk)
    const fromMeer = !!deps.back;
    el.innerHTML = `${fromMeer ? `<a class="ios-back" href="${esc(deps.back)}" data-act="later"><span aria-hidden="true">‹</span> Meer</a>` : ''}
      <section class="card setup">
      ${fromMeer && st().only ? '' : `<h1>Je gsm instellen</h1>
      <p class="muted">Nog ${left} stap${left > 1 ? 'pen' : ''}. Daarna kan je de app gebruiken.</p>
      <ol class="setup-bar">${STEPS.map(([k, ico, label], i) => `<li class="${i < cur ? 'done' : i === cur ? 'now' : ''}"><span aria-hidden="true">${i < cur ? '✔' : ico}</span>${label}</li>`).join('')}</ol>`}
      <div class="setup-body">${body}</div>
      ${deps.optional && !fromMeer ? '<p class="center"><button class="link" data-act="later">Later verder</button></p>' : ''}
    </section>`;
    el.querySelectorAll('[data-act=later]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); clearInterval(timer); el._setupRun = null; save({ done: true, step: null, only: null }); deps.onDone(); }));
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
    frame(`<h2>🔔 Meldingen aanzetten${info('De app vraagt via een melding "Aan het werk?" en "Bij wie ben je?", zodat je het juiste project meteen kiest.')}</h2>
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
    frame(`<h2>📍 OwnTracks instellen${info('OwnTracks stuurt je locatie door, zodat de app je uren en verplaatsingen zelf voorstelt.')}</h2>
      <p>Volg de 5 stappen. Op elke tekening toont de <b class="red-text">rode cirkel</b> waar je tikt.</p>
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
    // een bewaard script van een oudere versie: opnieuw aanmaken met dezelfde sleutel (anders kopieer je het oude)
    const old = st();
    const oldKey = old.script && /\nconst KEY = ("(?:[^"\\]|\\.)*");/.exec(old.script);
    if (oldKey && !old.script.includes(`const SCRIPT_VERSION = ${SCRIPT_VERSION};`)) {
      try { save({ script: widgetScript({ server, key: JSON.parse(oldKey[1]), name: deps.name }) }); } catch { /* laat het oude staan */ }
    }
    const s = st();
    try { await fetchMe(); } catch { /* offline */ }
    const ok = s.widgetAt && me?.widgetSeen && me.widgetSeen >= s.widgetAt;
    frame(`<h2>🧩 Widget op je beginscherm${info("Het widget toont je uren van vandaag en het materiaal dat vandaag mee moet. Tik op een bolletje om iets af te vinken als ingeladen, op + Toevoegen om materiaal toe te voegen en op ☕ om je pauze te starten of te stoppen. Scriptable opent dan even; veeg daarna terug naar je beginscherm. Het widget werkt zichzelf bij als er een nieuwe versie is.")}</h2>
      ${widgetGuideHtml(s.script ? `<button class="primary big" data-act="copy">📋 Kopieer het script</button>${info('Opnieuw kopiëren kan altijd.')}` : '<button class="primary big" data-act="make">Script klaarzetten</button><p class="muted small">Tik eerst hier; daarna verschijnt de knop "Kopieer het script".</p>')}
      <details><summary>Ik zie "[object Object]" of het widget ziet er anders uit</summary>
        <p class="muted small">Dan heb je nog een oude versie. Open Scriptable, tik lang op het oude script → <b>Delete</b>, en doe de stappen hierboven opnieuw (Kopieer het script → Plak). Vanaf deze versie werkt het widget zichzelf bij.</p></details>
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
