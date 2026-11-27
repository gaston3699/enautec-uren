// Script voor het widget op de iPhone (app Scriptable). Gedeeld door de app (eerste installatie)
// en de server (het widget haalt hier zelf zijn nieuwste versie op).

/** Versie van het script. Hoger dan die van het widget = het widget werkt zichzelf bij. */
export const SCRIPT_VERSION = 4;

/**
 * Toont de stand van vandaag (uren, waar, open vragen) en het materiaal dat vandaag mee moet.
 * Middelgroot/groot: tik op een materiaalregel om af te vinken (voor iedereen op dat project),
 * op "+ Toevoegen" om materiaal toe te voegen en op de pauzeknop om je pauze te starten of te stoppen.
 * Een tik opent Scriptable even (een widget kan op iPhone niets doen zonder een app te openen).
 */
export function widgetScript({ server, key, name = '' }) {
  return `// Enautec Uren – widget${name ? ` voor ${name}` : ''}
// Gemaakt door Enautec Uren. Deze sleutel geeft enkel de stand van vandaag, pauze starten/stoppen
// en materiaal afvinken/toevoegen. Afmelden kan in de app bij Meer → account → Mijn toestellen ("Widget").
// Het widget werkt zichzelf bij als er een nieuwe versie is.
const SCRIPT_VERSION = ${SCRIPT_VERSION};
const SERVER = ${JSON.stringify(server)};
const KEY = ${JSON.stringify(key)};

const RED = new Color("#e3262e");
const ACC = Color.dynamic(new Color("#d4a900"), new Color("#ffd60a"));
const BG = Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e"));
const FG = Color.dynamic(new Color("#111111"), new Color("#ffffff"));
const MUTED = Color.dynamic(new Color("#8a8a8e"), new Color("#98989f"));
const FILL = Color.dynamic(new Color("#f2f2f7"), new Color("#2c2c2e"));
const STATUS = { geen: "Nog niet gestart", werk: "Aan het werk", pauze: "Pauze", onderweg: "Onderweg", gedaan: "Dag gedaan", nee: "Niet gewerkt" };
const DOT = { werk: new Color("#34c759"), pauze: new Color("#ff9500"), onderweg: new Color("#0a84ff") };
const hm = (min) => Math.floor(min / 60) + "u" + String(min % 60).padStart(2, "0");
const hhmm = (ts) => { const d = new Date(ts); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };

function req(path, body) {
  const r = new Request(SERVER + path);
  r.headers = { Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
  r.timeoutInterval = 20;
  if (body) { r.method = "POST"; r.body = JSON.stringify(body); }
  return r;
}
async function api(path, body) {
  const r = req(path, body);
  const d = await r.loadJSON();
  if (r.response.statusCode !== 200) throw new Error(d.error || "Fout " + r.response.statusCode);
  return d;
}
/** nieuwere versie van het script ophalen en zichzelf vervangen (geldt vanaf de volgende keer) */
async function selfUpdate() {
  try {
    const r = req("/api/widget/script");
    const code = await r.loadString();
    if (r.response.statusCode !== 200 || !code.includes("SCRIPT_VERSION")) return false;
    try { FileManager.iCloud().writeString(module.filename, code); } catch (e) { FileManager.local().writeString(module.filename, code); }
    return true;
  } catch (e) { return false; }
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
  } else if (q.act === "add" && !config.runsInWidget) {
    const a = new Alert();
    a.title = "Materiaal toevoegen";
    a.message = (q.n || "Vandaag") + "\\nBv. 2 st kabelgoot of 50 m kabel 3G2,5";
    a.addTextField("Wat moet er mee?", "");
    a.addAction("Toevoegen");
    a.addCancelAction("Annuleer");
    if ((await a.presentAlert()) === 0) {
      const t = a.textFieldValue(0).trim();
      if (t) { await api("/api/widget/add", { date: q.d, projectId: q.p, text: t }); banner = "✔ Toegevoegd: " + t; }
    }
  }
} catch (e) { banner = "⚠ " + (e.message || e); }

// in Scriptable (na een tik) tonen we het grote widget, zodat je verder kan aftikken
const family = config.runsInWidget ? (config.widgetFamily || "small") : "large";
const taps = family === "medium" || family === "large";
const link = (p) => "scriptable:///run/" + encodeURIComponent(Script.name()) + "?" + Object.keys(p).map((k) => k + "=" + encodeURIComponent(p[k])).join("&");
const w = new ListWidget();
w.backgroundColor = BG;
const style = (x, font, color, lines) => { x.font = font; x.textColor = color; x.lineLimit = lines || 1; x.minimumScaleFactor = 0.75; return x; };
const text = (t, font, color, lines, parent) => style((parent || w).addText(t), font, color, lines);
function symbol(parent, name, color, size) {
  const s = SFSymbol.named(name);
  if (!s) return;
  s.applyFont(Font.systemFont(size));
  const img = parent.addImage(s.image);
  img.imageSize = new Size(size + 2, size + 2);
  img.tintColor = color;
}
/** regel met een symbool links en een eigen tikvlak (enkel middelgroot en groot) */
function row(sym, symColor, t, font, color, url) {
  const s = w.addStack();
  s.centerAlignContent();
  if (taps && url) s.url = url;
  symbol(s, sym, symColor, 14);
  s.addSpacer(7);
  text(t, font, color, 1, s);
  s.addSpacer();
  w.addSpacer(4);
  return s;
}
function chip(t, url, color) {
  const s = w.addStack();
  s.centerAlignContent();
  s.backgroundColor = FILL;
  s.cornerRadius = 9;
  s.setPadding(5, 10, 5, 10);
  if (taps && url) s.url = url;
  text(t, Font.semiboldSystemFont(12), color || FG, 1, s);
  return s;
}
/** kop: ENAUTEC links, uren en status rechts */
function header(d, status) {
  const h = w.addStack();
  h.centerAlignContent();
  text("ENAUTEC", Font.heavySystemFont(11), RED, 1, h);
  h.addSpacer();
  if (DOT[d.status]) { symbol(h, "circle.fill", DOT[d.status], 6); h.addSpacer(4); }
  text(hm(d.workedMin) + (family === "small" ? "" : " · " + status), Font.semiboldSystemFont(11), MUTED, 1, h);
  w.addSpacer(6);
}
function owntracksRow(d) {
  if (!d.otMissing) return;
  if (family === "small") w.url = "owntracks:///";
  row("location.slash.fill", RED, family === "small" ? "OwnTracks uit · tik" : "OwnTracks staat uit · tik om te openen", Font.semiboldSystemFont(12), RED, "owntracks:///");
}
function footer(d) {
  if (taps && ["werk", "pauze", "onderweg"].includes(d.status)) {
    if (d.pause === "loopt") chip("☕ Pauze stoppen · sinds " + hhmm(d.pauseSince), link({ act: "pause", v: "stop" }));
    else if (d.pause === "mogelijk") chip("☕ Pauze starten", link({ act: "pause", v: "start" }));
    w.addSpacer(4);
  }
  if (d.openCount) text("❓ " + (d.openCount === 1 ? "1 vraag open" : d.openCount + " vragen open") + " · open de app", Font.semiboldSystemFont(11), RED, 1);
}

try {
  let d = await api("/api/widget");
  if (d.scriptVersion > SCRIPT_VERSION && await selfUpdate()) banner = banner || "✔ Widget bijgewerkt";
  const status = STATUS[d.status] + (d.since && ["werk", "pauze"].includes(d.status) ? " sinds " + hhmm(d.since) : "");
  const plan = (d.plan || []).filter((p) => !p.leave);
  if (family.startsWith("accessory")) {
    // vergrendelscherm
    w.backgroundColor = null;
    text("Enautec · " + hm(d.workedMin), Font.boldSystemFont(14), Color.white());
    text(d.otMissing ? "📍 OwnTracks uit" : d.openCount ? "❓ vraag open" : status, Font.systemFont(12), Color.white());
    if (d.otMissing) w.url = "owntracks:///";
    if (family === "accessoryRectangular" && (d.project || d.place)) text(d.project || d.place, Font.systemFont(12), Color.white());
  } else if (plan.length && family !== "small") {
    // vandaag ingepland: projecten met wat mee moet (tik = ingeladen, + = toevoegen)
    w.setPadding(14, 16, 12, 16);
    header(d, status);
    if (banner) { text(banner, Font.semiboldSystemFont(11), ACC, 1); w.addSpacer(3); }
    owntracksRow(d);
    let left = family === "large" ? 15 : 5;
    for (const p of plan.slice(0, family === "large" ? 3 : 1)) {
      if (left <= 0) break;
      text((p.time ? p.time + "  " : "") + p.project, Font.boldSystemFont(14), FG, 1);
      left--;
      if (family === "large" && (p.place || p.note)) { text([p.place, p.note].filter(Boolean).join(" · "), Font.systemFont(11), MUTED, 1); left--; }
      w.addSpacer(4);
      // nog in te laden eerst
      const list = p.material.filter((m) => !m.done).concat(p.material.filter((m) => m.done));
      const room = Math.max(0, left - 1);
      for (const m of list.slice(0, room)) {
        row(m.done ? "checkmark.circle.fill" : "circle", m.done ? ACC : MUTED, m.text, Font.systemFont(13), m.done ? MUTED : FG,
          link({ act: "check", d: d.date, p: p.projectId, k: m.key, v: m.done ? "0" : "1", t: m.text }));
      }
      left -= Math.min(list.length, room);
      if (!list.length) { text("Nog niets opgegeven", Font.systemFont(12), MUTED, 1); w.addSpacer(3); }
      // + Toevoegen, met rechts hoeveel er nog niet getoond is
      const more = [list.length > room ? "+ " + (list.length - room) + " meer" : "", family === "medium" && plan.length > 1 ? "+ " + (plan.length - 1) + " project" : ""].filter(Boolean).join(" · ");
      const a = row("plus.circle.fill", ACC, "Toevoegen", Font.semiboldSystemFont(13), ACC, link({ act: "add", d: d.date, p: p.projectId, n: p.project }));
      if (more) text(more, Font.systemFont(11), MUTED, 1, a);
      left--;
      w.addSpacer(4);
    }
    w.addSpacer();
    if (family === "large") footer(d);
    else if (d.openCount) text("❓ vraag open · open de app", Font.semiboldSystemFont(11), RED, 1);
    if (family === "medium") w.url = link({ act: "list" });
  } else if (plan.length && family === "small" && (d.status === "geen" || new Date().getHours() < 10)) {
    // klein widget 's ochtends: hoeveel is er al ingeladen
    w.setPadding(12, 14, 12, 14);
    header(d, status);
    owntracksRow(d);
    const p = plan[0];
    text(p.project, Font.boldSystemFont(14), FG, 2);
    w.addSpacer(4);
    const all = plan.flatMap((x) => x.material);
    if (all.length) text(all.filter((m) => m.done).length + " van " + all.length + " ingeladen", Font.semiboldSystemFont(12), ACC, 1);
    else text("Geen materiaal opgegeven", Font.systemFont(12), MUTED, 1);
    w.addSpacer();
    text(plan.length > 1 ? "+ " + (plan.length - 1) + " project" : "Tik om af te vinken", Font.systemFont(10), MUTED, 1);
    w.url = link({ act: "list" });
  } else {
    // uren van vandaag
    w.setPadding(14, 16, 12, 16);
    text("ENAUTEC", Font.heavySystemFont(11), RED);
    w.addSpacer(4);
    if (banner) text(banner, Font.semiboldSystemFont(11), ACC, 1);
    owntracksRow(d);
    text(hm(d.workedMin), Font.boldRoundedSystemFont ? Font.boldRoundedSystemFont(34) : Font.boldSystemFont(34), FG);
    const st = w.addStack();
    st.centerAlignContent();
    if (DOT[d.status]) { symbol(st, "circle.fill", DOT[d.status], 7); st.addSpacer(5); }
    text(status, Font.mediumSystemFont(12), MUTED, 1, st);
    if (d.project || d.place) { w.addSpacer(6); text(d.project || d.place, Font.semiboldSystemFont(13), FG, family === "small" ? 2 : 1); }
    if (family !== "small" && d.project && d.place) text(d.place, Font.systemFont(11), MUTED, 1);
    w.addSpacer();
    footer(d);
    if (!d.openCount) text("Bijgewerkt " + hhmm(d.now), Font.systemFont(10), MUTED, 1);
  }
} catch (e) {
  w.setPadding(14, 16, 12, 16);
  text("ENAUTEC", Font.heavySystemFont(11), RED);
  w.addSpacer(4);
  text(String(e.message || e), Font.systemFont(12), FG, 4);
}
w.refreshAfterDate = new Date(Date.now() + 10 * 60 * 1000);
if (config.runsInWidget) Script.setWidget(w);
else await w.presentLarge();
Script.complete();
`;
}
