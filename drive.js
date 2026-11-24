// Toegang tot OneDrive via Microsoft Graph, plus een testversie die alles in de browser bewaart.
import { getToken, account } from './auth.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const encPath = (p) => p.split('/').filter(Boolean).map(encodeURIComponent).join('/');

export class ConflictError extends Error {
  constructor() { super('Bestand werd intussen elders gewijzigd'); this.conflict = true; }
}

/** Echte OneDrive (van het account in slot 'A' of 'B') */
export class OneDrive {
  constructor(slot) { this.slot = slot; }

  get account() { return account(this.slot); }

  async req(path, opts = {}, retry = true) {
    const token = await getToken(this.slot);
    const res = await fetch(path.startsWith('http') ? path : GRAPH + path, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) },
    });
    if (res.status === 401 && retry) return this.req(path, opts, false);
    return res;
  }

  /** JSON-bestand lezen → { data, eTag } of null als het niet bestaat */
  async readJson(path) {
    const meta = await this.req(`/me/drive/root:/${encPath(path)}?select=id,eTag,@microsoft.graph.downloadUrl`);
    if (meta.status === 404) return null;
    if (!meta.ok) throw new Error(`OneDrive lezen mislukt (${meta.status})`);
    const m = await meta.json();
    const res = await fetch(m['@microsoft.graph.downloadUrl'], { cache: 'no-store' });
    if (!res.ok) throw new Error(`OneDrive lezen mislukt (${res.status})`);
    return { data: await res.json(), eTag: m.eTag };
  }

  /** JSON-bestand schrijven. Met eTag: enkel als het intussen niet gewijzigd werd. */
  async writeJson(path, data, eTag) {
    const headers = { 'Content-Type': 'application/json' };
    let url = `/me/drive/root:/${encPath(path)}:/content`;
    if (eTag) headers['If-Match'] = eTag;
    else url += '?@microsoft.graph.conflictBehavior=fail';
    const res = await this.req(url, { method: 'PUT', headers, body: JSON.stringify(data) });
    if (res.status === 412 || res.status === 409) throw new ConflictError();
    if (!res.ok) throw new Error(`OneDrive bewaren mislukt (${res.status})`);
    const item = await res.json();
    return { eTag: item.eTag };
  }

  /** Namen van de bestanden in een map */
  async list(folder) {
    const res = await this.req(`/me/drive/root:/${encPath(folder)}:/children?select=name,file&$top=500`);
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`OneDrive map lezen mislukt (${res.status})`);
    return (await res.json()).value.filter((x) => x.file).map((x) => x.name);
  }

  /** Willekeurig bestand uploaden (bv. Excel-export); overschrijft een bestaand bestand */
  async upload(path, blob, contentType) {
    const res = await this.req(`/me/drive/root:/${encPath(path)}:/content`, {
      method: 'PUT', headers: { 'Content-Type': contentType }, body: blob,
    });
    if (!res.ok) throw new Error(`Uploaden mislukt (${res.status})`);
    const item = await res.json();
    return { webUrl: item.webUrl };
  }

  /** Bestand ophalen als Blob, of null als het niet bestaat */
  async download(path) {
    const res = await this.req(`/me/drive/root:/${encPath(path)}:/content`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`OneDrive ophalen mislukt (${res.status})`);
    return res.blob();
  }
}

/** Testversie: "OneDrive" in de browser (enkel voor localhost / demo) */
export class TestDrive {
  constructor(slot) { this.slot = slot; this.key = `enautec.testdrive.${slot}`; }
  get account() { return { name: this.slot === 'A' ? 'Testaccount uren' : 'Testaccount facturatie', username: this.slot === 'A' ? 'uren@test' : 'facturatie@test' }; }
  _all() { try { return JSON.parse(localStorage.getItem(this.key) || '{}'); } catch { return {}; } }
  _save(all) { localStorage.setItem(this.key, JSON.stringify(all)); }
  async readJson(path) {
    await new Promise((r) => setTimeout(r, 60));
    const f = this._all()[path];
    return f ? { data: JSON.parse(f.body), eTag: f.eTag } : null;
  }
  async writeJson(path, data, eTag) {
    const all = this._all();
    const cur = all[path];
    if (cur && cur.eTag !== eTag) throw new ConflictError();
    if (!cur && eTag) throw new ConflictError();
    const next = `"${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}"`;
    all[path] = { body: JSON.stringify(data), eTag: next };
    this._save(all);
    return { eTag: next };
  }
  async list(folder) {
    const pre = folder.replace(/\/$/, '') + '/';
    return Object.keys(this._all()).filter((p) => p.startsWith(pre) && !p.slice(pre.length).includes('/')).map((p) => p.slice(pre.length));
  }
  async upload(path, blob) {
    const all = this._all();
    // afbeeldingen als data-URL (testmodus), andere bestanden enkel een beschrijving
    const body = blob.type?.startsWith('image/')
      ? await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(blob); })
      : JSON.stringify({ bestand: path, grootte: blob.size });
    all[path] = { body, eTag: 'x' };
    this._save(all);
    return { webUrl: null };
  }
  async download(path) {
    const f = this._all()[path];
    if (!f) return null;
    return f.body.startsWith('data:') ? (await fetch(f.body)).blob() : new Blob([f.body]);
  }
}
