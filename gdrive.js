// Opslag in Google Drive (zelfde werking als OneDrive in drive.js: bestanden op pad).
// De app ziet enkel de bestanden die ze zelf aanmaakte (toegang "drive.file").
// Het toegangstoken komt van de verzamelserver (Cloudflare Worker), die de koppeling bewaart.
import { ConflictError } from './drive.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const quote = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export class GoogleDrive {
  /**
   * @param {string} slot 'A' (gegevens) of 'B' (facturatie)
   * @param {(force?: boolean) => Promise<{token: string, email: string}>} getToken
   */
  constructor(slot, getToken) {
    this.slot = slot;
    this.getToken = getToken;
    this.ids = new Map(); // pad van map → id
    this.email = null;
  }

  get account() { return this.email ? { name: 'Google Drive', username: this.email } : null; }

  async req(url, opts = {}, retry = true) {
    const t = await this.getToken(!retry);
    this.email = t.email ?? this.email;
    const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${t.token}`, ...(opts.headers ?? {}) } });
    if (res.status === 401 && retry) return this.req(url, opts, false);
    return res;
  }

  async _json(res, what) {
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(`Google Drive ${what} mislukt (${res.status}${d.error?.message ? `: ${d.error.message}` : ''})`);
    }
    return res.json();
  }

  /** Zoek een bestand of map op naam in een map (oudste eerst, zodat alle toestellen dezelfde kiezen) */
  async find(name, parentId, isFolder) {
    const q = `name='${quote(name)}' and '${parentId}' in parents and trashed=false and mimeType${isFolder ? '=' : '!='}'${FOLDER}'`;
    const res = await this.req(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,version,webViewLink)&orderBy=createdTime&pageSize=10&spaces=drive`);
    return (await this._json(res, 'zoeken')).files[0] ?? null;
  }

  /** Id van een map (pad als lijst van namen), eventueel aanmaken */
  async folderId(parts, create) {
    let parent = 'root';
    let key = '';
    for (const name of parts) {
      key += `/${name}`;
      let id = this.ids.get(key);
      if (!id) {
        const f = await this.find(name, parent, true);
        if (f) id = f.id;
        else if (create) {
          const res = await this.req(`${API}/files?fields=id`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }),
          });
          id = (await this._json(res, 'map maken')).id;
        } else return null;
        this.ids.set(key, id);
      }
      parent = id;
    }
    return parent;
  }

  split(path) {
    const parts = path.split('/').filter(Boolean);
    return { dirs: parts.slice(0, -1), name: parts.at(-1) };
  }

  async _create(dir, name, body, type) {
    const boundary = `enautec${Math.random().toString(36).slice(2)}`;
    const meta = JSON.stringify({ name, parents: [dir], mimeType: type });
    const blob = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
      `--${boundary}\r\nContent-Type: ${type}\r\n\r\n`, body, `\r\n--${boundary}--`,
    ]);
    const res = await this.req(`${UPLOAD}/files?uploadType=multipart&fields=id,version,webViewLink`, {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: blob,
    });
    return this._json(res, 'bewaren');
  }

  async _update(id, body, type) {
    const res = await this.req(`${UPLOAD}/files/${id}?uploadType=media&fields=id,version,webViewLink`, {
      method: 'PATCH', headers: { 'Content-Type': type }, body,
    });
    return this._json(res, 'bewaren');
  }

  /** JSON-bestand lezen → { data, eTag } of null */
  async readJson(path) {
    const { dirs, name } = this.split(path);
    const dir = await this.folderId(dirs, false);
    if (!dir) return null;
    const f = await this.find(name, dir, false);
    if (!f) return null;
    const res = await this.req(`${API}/files/${f.id}?alt=media`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Google Drive lezen mislukt (${res.status})`);
    return { data: await res.json(), eTag: String(f.version) };
  }

  /** JSON-bestand schrijven; met eTag enkel als het intussen niet gewijzigd werd */
  async writeJson(path, data, eTag) {
    const { dirs, name } = this.split(path);
    const dir = await this.folderId(dirs, true);
    const f = await this.find(name, dir, false);
    const body = JSON.stringify(data);
    let out;
    if (f) {
      if (String(f.version) !== String(eTag ?? '')) throw new ConflictError();
      out = await this._update(f.id, body, 'application/json');
    } else {
      out = await this._create(dir, name, body, 'application/json');
    }
    return { eTag: String(out.version) };
  }

  /** Namen van de bestanden in een map */
  async list(folder) {
    const dir = await this.folderId(folder.split('/').filter(Boolean), false);
    if (!dir) return [];
    const q = `'${dir}' in parents and trashed=false and mimeType!='${FOLDER}'`;
    const res = await this.req(`${API}/files?q=${encodeURIComponent(q)}&fields=files(name)&pageSize=1000&spaces=drive`);
    return (await this._json(res, 'map lezen')).files.map((x) => x.name);
  }

  /** Bestand uploaden (bv. Excel-export); vervangt een bestaand bestand met dezelfde naam */
  async upload(path, blob, contentType) {
    const { dirs, name } = this.split(path);
    const dir = await this.folderId(dirs, true);
    const f = await this.find(name, dir, false);
    const out = f ? await this._update(f.id, blob, contentType) : await this._create(dir, name, blob, contentType);
    return { webUrl: out.webViewLink ?? null };
  }
}
