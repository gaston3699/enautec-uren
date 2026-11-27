// Fictieve gegevens voor de testmodus (enkel op localhost).
import { PATHS, EMPTY_MASTER } from './store.js';
import { sha256 } from './ui.js';
import { shiftDate, today } from './time.js';

export async function seedDemo(ctx) {
  const now = Date.now();
  const r = (o) => ({ ...o, updated: now });
  const P = {
    atelier: [50.8631, 3.0694], thuisTomas: [50.9020, 3.0350], thuisRuben: [50.8800, 3.1500],
    werfA: [50.9461, 3.1225], werfB: [50.9147, 3.2135], werfC: [50.8577, 3.1226], groothandel: [50.9300, 3.1050],
  };
  const site = (id, type, name, [lat, lon], extra = {}) => r({ id, type, name, lat, lon, radius_m: type === 'atelier' ? 100 : 150, active: true, ...extra });
  const master = {
    ...EMPTY_MASTER(),
    employees: [
      r({ id: 'tomas', username: 'tomas', name: 'Tomas', loxone_user: 'Tomas', active: true }),
      r({ id: 'ruben', username: 'ruben', name: 'Ruben', loxone_user: 'Ruben', active: true }),
      r({ id: 'philippe', username: 'philippe', name: 'Philippe', loxone_user: 'Philippe', active: true }),
    ],
    customers: [
      r({ id: 'cA', name: 'Demo klant Janssens' }),
      r({ id: 'cB', name: 'Demo bouwbedrijf Peeters' }),
      r({ id: 'cC', name: 'Demo bakkerij Claes' }),
    ],
    sites: [
      site('atelier', 'atelier', 'Atelier Enautec', P.atelier),
      site('thuis-tomas', 'thuis', 'Thuis Tomas', P.thuisTomas, { employee_id: 'tomas' }),
      site('thuis-ruben', 'thuis', 'Thuis Ruben', P.thuisRuben, { employee_id: 'ruben' }),
      site('groothandel', 'leverancier', 'Groothandel elektro', P.groothandel),
      site('sA', 'klant', 'Werf Janssens', P.werfA, { customer_id: 'cA', address: 'Demostraat 1, Roeselare' }),
      site('sB', 'klant', 'Werf Peeters – nieuwbouw', P.werfB, { customer_id: 'cB', address: 'Demolaan 12, Izegem' }),
      site('sC', 'klant', 'Bakkerij Claes', P.werfC, { customer_id: 'cC', address: 'Markt 5, Ledegem' }),
    ],
    projects: [
      r({ id: 'p41', code: '2026-041', name: 'Renovatie woning', customer_id: 'cA', site_id: 'sA', active: true }),
      r({ id: 'p52', code: '2026-052', name: 'Nieuwbouw appartementen', customer_id: 'cB', site_id: 'sB', active: true }),
      r({ id: 'p58', code: '2026-058', name: 'Werfkeet & tijdelijke aansluiting', customer_id: 'cB', site_id: 'sB', active: true }),
      r({ id: 'p60', code: '2026-060', name: 'Loxone-installatie winkel', customer_id: 'cC', site_id: 'sC', active: true }),
    ],
    articles: [
      r({ id: 'a1', code: 'XVB3G25', name: 'Kabel XVB 3G2,5', unit: 'm', active: true }),
      r({ id: 'a2', code: 'XVB5G6', name: 'Kabel XVB 5G6', unit: 'm', active: true }),
      r({ id: 'a3', code: 'DOOS68', name: 'Inbouwdoos 68 mm', unit: 'st', active: true }),
      r({ id: 'a4', code: 'DIFF30', name: 'Differentieelschakelaar 40A 30mA', unit: 'st', active: true }),
      r({ id: 'a5', code: 'LOX-TREE', name: 'Loxone Tree-kabel', unit: 'm', active: true }),
      r({ id: 'a6', code: 'WAGO221', name: 'Wago-klem 221-413', unit: 'st', active: true }),
    ],
    settings: {
      updated: now,
      serverUrl: location.origin,
      billingFolder: 'Facturatie/Uren Enautec',
      adminPinHash: await sha256('enautec:1234'),
      rules: { minStayMin: 5, unknownMinStayMin: 20, homeTravelIsWork: false },
    },
  };
  ctx.store.change(PATHS.master, EMPTY_MASTER(), (m) => Object.assign(m, master));
  const y = shiftDate(today(), -1);
  ctx.store.change(PATHS.planning, { items: [] }, (pl) => {
    pl.items.push(r({ id: 'pl1', date: y, username: 'ruben', projectId: 'p52', note: '' }));
    pl.items.push(r({ id: 'pl2', date: today(), username: 'tomas', projectId: 'p41', note: 'Sleutel bij de buren (nr. 3)' }));
    pl.items.push(r({ id: 'pl3', date: shiftDate(today(), 1), username: 'tomas', projectId: 'p60', note: '' }));
  });
  ctx.setAdminKey('demo');
}
