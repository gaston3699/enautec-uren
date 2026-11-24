// Eerste keer aanmelden op een gsm: verplichte stappen voor je de app kan gebruiken.
//  1. App op het beginscherm (al gebeurd: aanmelden op een gsm kan enkel in de app op het beginscherm)
//  2. Meldingen aanzetten
//  3. OwnTracks instellen (klaar zodra de eerste locatie binnenkomt)
//  4. Widget (iPhone: Scriptable; klaar zodra het widget de eerste keer gegevens ophaalt)
import { esc, toast, copyText } from './ui.js';
import { pushSupport, enablePush, currentSubscription } from './questions.js';

const MIN = 60000;

/** Script voor Scriptable: toont de stand van vandaag (uren, waar, open vragen) */
export function widgetScript({ server, key, name = '' }) {
  return `// Enautec Uren – widget${name ? ` voor ${name}` : ''}
// Gemaakt door de app op ${new Date().toLocaleDateString('nl-BE')}. Deze sleutel geeft enkel de stand van vandaag.
// Afmelden kan in de app bij Meer → Mijn toestellen ("Widget").
const SERVER = ${JSON.stringify(server)};
const KEY = ${JSON.stringify(key)};

const RED = new Color("#e3262e");
const FG = Color.dynamic(new Color("#111111"), new Color("#ffffff"));
const MUTED = Color.dynamic(new Color("#6b6b6b"), new Color("#a0a0a0"));
const STATUS = { geen: "Nog niet gestart", werk: "Aan het werk", pauze: "Pauze", onderweg: "Onderweg", gedaan: "Dag gedaan", nee: "Niet gewerkt" };
const hm = (min) => Math.floor(min / 60) + "u" + String(min % 60).padStart(2, "0");
const hhmm = (ts) => { const d = new Date(ts); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };

async function load() {
  const r = new Request(SERVER + "/api/widget");
  r.headers = { Authorization: "Bearer " + KEY };
  r.timeoutInterval = 20;
  const d = await r.loadJSON();
  if (r.response.statusCode !== 200) throw new Error(d.error || "Fout " + r.response.statusCode);
  return d;
}

const family = config.widgetFamily || "small";
const w = new ListWidget();
const text = (t, font, color, lines) => { const x = w.addText(t); x.font = font; x.textColor = color; if (lines) x.lineLimit = lines; x.minimumScaleFactor = 0.7; return x; };
try {
  const d = await load();
  const status = STATUS[d.status] + (d.since && ["werk", "pauze"].includes(d.status) ? " sinds " + hhmm(d.since) : "");
  if (family.startsWith("accessory")) {
    // vergrendelscherm
    text("Enautec · " + hm(d.workedMin), Font.boldSystemFont(14), Color.white(), 1);
    text(d.openCount ? "❓ vraag open" : status, Font.systemFont(12), Color.white(), 1);
    if (family === "accessoryRectangular" && (d.project || d.place)) text(d.project || d.place, Font.systemFont(12), Color.white(), 1);
  } else if ((d.plan || []).length && (d.status === "geen" || new Date().getHours() < 10)) {
    // 's ochtends: wat staat er vandaag gepland en welk materiaal moet mee
    w.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e"));
    w.setPadding(12, 14, 12, 14);
    const max = family === "large" ? 14 : family === "medium" ? 5 : 3;
    text("ENAUTEC · VANDAAG", Font.heavySystemFont(11), RED, 1);
    w.addSpacer(3);
    let left = max;
    for (const p of d.plan.slice(0, family === "small" ? 1 : 3)) {
      text(p.project, Font.boldSystemFont(family === "small" ? 13 : 14), FG, family === "small" ? 2 : 1);
      if (family !== "small" && (p.place || p.note)) text([p.place, p.note].filter(Boolean).join(" · "), Font.systemFont(11), MUTED, 1);
      if (!p.material.length) { text("Geen materiaal opgegeven", Font.systemFont(11), MUTED, 1); continue; }
      for (const m of p.material.slice(0, Math.max(left, 0))) text("🧰 " + m, Font.systemFont(12), FG, 1);
      if (p.material.length > left) text("+ " + (p.material.length - Math.max(left, 0)) + " meer in de app", Font.systemFont(11), MUTED, 1);
      left -= p.material.length;
      w.addSpacer(3);
    }
    if (family === "small" && d.plan.length > 1) text("+ " + (d.plan.length - 1) + " project", Font.systemFont(11), MUTED, 1);
    w.addSpacer();
    if (d.openCount) text("❓ " + (d.openCount === 1 ? "1 vraag open" : d.openCount + " vragen open"), Font.semiboldSystemFont(11), RED, 1);
  } else {
    w.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e"));
    w.setPadding(12, 14, 12, 14);
    text("ENAUTEC", Font.heavySystemFont(11), RED);
    w.addSpacer(2);
    text(hm(d.workedMin), Font.boldSystemFont(32), FG, 1);
    text(status, Font.mediumSystemFont(12), MUTED, 1);
    if (d.project || d.place) { w.addSpacer(4); text(d.project || d.place, Font.semiboldSystemFont(12), FG, family === "small" ? 2 : 1); }
    if (family !== "small" && d.project && d.place) text("📍 " + d.place, Font.systemFont(11), MUTED, 1);
    w.addSpacer();
    if (d.openCount) text("❓ " + (d.openCount === 1 ? "1 vraag open" : d.openCount + " vragen open"), Font.semiboldSystemFont(11), RED, 1);
    else text("Bijgewerkt " + hhmm(d.now), Font.systemFont(10), MUTED, 1);
  }
} catch (e) {
  w.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e"));
  text("ENAUTEC", Font.heavySystemFont(11), RED);
  w.addSpacer(4);
  text(String(e.message || e), Font.systemFont(12), FG, 4);
}
w.refreshAfterDate = new Date(Date.now() + 10 * 60 * 1000);
if (config.runsInWidget) Script.setWidget(w);
else await w.presentSmall();
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

const STEPS = [
  ['home', '📲', 'Beginscherm'],
  ['push', '🔔', 'Meldingen'],
  ['owntracks', '📍', 'OwnTracks'],
  ['widget', '🧩', 'Widget'],
];

/**
 * Stappen tonen in `el`. deps: { server, session, username, name, ios, deviceKey, deviceLabel,
 *   owntracksLink(ot), getState(), setState(st), onDone(), optional }
 */
export function renderSetup(el, deps) {
  const { server, session } = deps;
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
    if (i >= STEPS.length - 1) { save({ done: true, step: null, otSince: null }); clearInterval(timer); el._setupRun = null; deps.onDone(); return; }
    go(STEPS[i + 1][0]);
  };
  const poll = (fn, ms = 5000) => {
    clearInterval(timer);
    timer = setInterval(() => { if (!active()) { clearInterval(timer); return; } fn(); }, ms);
  };

  function frame(body) {
    const cur = stepIndex(current());
    el.innerHTML = `<section class="card setup">
      <h1>Je gsm instellen</h1>
      <p class="muted">Nog ${STEPS.length - cur} stap${STEPS.length - cur > 1 ? 'pen' : ''}. Daarna kan je de app gebruiken.</p>
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
    const store = deps.ios ? 'App Store' : 'Google Play';
    frame(`<h2>📍 OwnTracks instellen</h2>
      <p>OwnTracks stuurt je locatie door, zodat de app je uren en verplaatsingen zelf voorstelt.</p>
      <ol class="setup-steps">
        <li>Installeer de gratis app <b>OwnTracks</b> uit de ${store}.</li>
        <li>Tik hier: ${ot ? `<a class="btn primary" href="${esc(deps.owntracksLink(ot))}">OwnTracks instellen</a>` : '<span class="muted">(laden…)</span>'}<br><span class="muted small">Vraagt OwnTracks om de instellingen te importeren? Tik op <b>OK</b> of <b>Importeren</b>.</span></li>
        <li>Geef OwnTracks locatietoegang <b>"Altijd"</b>${deps.ios ? ' (Instellingen → OwnTracks → Locatie → Altijd, en Nauwkeurige locatie aan)' : ' en zet batterijbesparing voor OwnTracks uit'}.</li>
        <li>Open OwnTracks en tik op het pijltje <b>↑</b> (verzenden), zodat je eerste locatie vertrekt.</li>
      </ol>
      ${ok ? `<div class="notice ok">✔ Locatie ontvangen om ${new Date(me.lastLocation).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}. OwnTracks werkt.</div>`
        : '<div class="notice wait"><span class="spinner" aria-hidden="true"></span> Wachten op je eerste locatie…</div>'}
      ${ot ? `<details><summary>Lukt de knop niet? Manueel instellen</summary>
        <p class="muted small">Open OwnTracks → ⓘ → Instellingen, kies <b>Mode: HTTP</b>, zet <b>Authenticatie</b> en <b>cmd</b> aan en kopieer deze gegevens één voor één. Het OwnTracks-wachtwoord is een aparte code, niet je app-wachtwoord.</p>
        <div class="copy-list">${[['URL', `${server}/api/owntracks`], ['Gebruikersnaam', ot.username], ['Wachtwoord', ot.password], ['Apparaat ID', 'gsm']].map(([label, value]) => `
          <div class="copy-row"><span class="muted small">${label}</span><code>${esc(value)}</code><button class="secondary" data-copy="${esc(value)}">Kopieer</button></div>`).join('')}</div>
      </details>` : ''}
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
      <p>Het widget toont 's ochtends je planning en het materiaal dat mee moet, en daarna je uren van vandaag, waar je bent en of er een vraag openstaat. Kies <b>middelgroot</b> om meer materiaal te zien.</p>
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

  function draw() {
    const k = current();
    if (k === 'push') return drawPush();
    if (k === 'owntracks') return drawOwnTracks();
    return drawWidget();
  }
  // terug in de app (na OwnTracks of Scriptable): meteen opnieuw controleren
  const onVisible = () => { if (!active()) { document.removeEventListener('visibilitychange', onVisible); return; } if (document.visibilityState === 'visible') draw(); };
  document.addEventListener('visibilitychange', onVisible);
  draw();
}
