// Gegevens eerst op het toestel, daarna naar OneDrive (zoals Leervoortgang).
// Elk bestand wordt lokaal bewaard; wijzigingen gaan op de achtergrond naar OneDrive.
// Bij gelijktijdige wijzigingen worden de bestanden per regel samengevoegd (nieuwste wint).
import { DATA_FOLDER } from './config.js';

const PREFIX = 'enautec.doc.';
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

export const PATHS = {
  master: `${DATA_FOLDER}/stamgegevens.json`,
  planning: `${DATA_FOLDER}/planning.json`,
  todos: `${DATA_FOLDER}/todo.json`,
  todoPhoto: (name) => `${DATA_FOLDER}/todo-fotos/${name}`,
  regFolder: (month) => `${DATA_FOLDER}/registraties/${month}`,
  reg: (month, username) => `${DATA_FOLDER}/registraties/${month}/${username}.json`,
};

export const EMPTY_MASTER = () => ({
  employees: [], customers: [], sites: [], projects: [], articles: [],
  settings: { updated: 0 },
});

/** Lijsten met {id, updated, deleted} samenvoegen: per id wint de nieuwste */
function mergeRecords(a = [], b = []) {
  const map = new Map();
  for (const r of [...a, ...b]) {
    const cur = map.get(r.id);
    if (!cur || (r.updated ?? 0) > (cur.updated ?? 0)) map.set(r.id, r);
  }
  return [...map.values()];
}

/** Twee versies van een bestand samenvoegen */
export function mergeDoc(local, remote) {
  if (!local) return remote;
  if (!remote) return local;
  const out = { ...remote };
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const l = local[k];
    const r = remote[k];
    if (Array.isArray(l) || Array.isArray(r)) out[k] = mergeRecords(l, r);
    else if (k === 'days') {
      const days = { ...(r ?? {}) };
      for (const [d, v] of Object.entries(l ?? {})) if (!days[d] || (v.updated ?? 0) > (days[d].updated ?? 0)) days[d] = v;
      out[k] = days;
    } else if (l && r && typeof l === 'object' && 'updated' in l) out[k] = (l.updated ?? 0) > (r.updated ?? 0) ? l : r;
    else out[k] = r ?? l;
  }
  return out;
}

export class Store {
  constructor(drive, onStatus = () => {}) {
    this.drive = drive;
    this.onStatus = onStatus;
    this.timer = null;
    this.status = drive ? 'idle' : 'local';
    this.lastError = '';
    this.listeners = new Set();
  }

  _read(path) {
    try { return JSON.parse(localStorage.getItem(PREFIX + path) || 'null'); } catch { return null; }
  }
  _write(path, entry) {
    try { localStorage.setItem(PREFIX + path, JSON.stringify(entry)); } catch (e) { this.lastError = 'Opslag op dit toestel is vol of geblokkeerd.'; }
  }

  /** Inhoud van een bestand (kopie), of de standaardwaarde */
  get(path, fallback) {
    const e = this._read(path);
    return clone(e?.data ?? fallback);
  }

  has(path) { return !!this._read(path); }

  /** Wijzig een bestand lokaal en plan het bewaren in OneDrive */
  change(path, fallback, fn) {
    const e = this._read(path) ?? { data: clone(fallback), eTag: null };
    const data = clone(e.data);
    fn(data);
    this._write(path, { ...e, data, dirty: true });
    this._emit(path, 'local');
    this.schedulePush();
    return data;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(path, source) { for (const fn of this.listeners) fn(path, source); }

  dirtyPaths() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) {
        const p = k.slice(PREFIX.length);
        if (this._read(p)?.dirty) out.push(p);
      }
    }
    return out;
  }

  _setStatus(s, err = '') {
    this.status = s;
    this.lastError = err;
    this.onStatus(s, err);
  }

  _handleError(e) {
    if (e?.needsLogin) this._setStatus('login', e.message);
    else if (!navigator.onLine || e instanceof TypeError) this._setStatus('offline');
    else this._setStatus('error', e.message);
  }

  /** Haal de laatste versie uit OneDrive en voeg samen met lokale wijzigingen */
  async pull(path) {
    if (!this.drive) return;
    const remote = await this.drive.readJson(path);
    const e = this._read(path);
    if (!remote) return;
    if (e?.eTag === remote.eTag && !e.dirty) return; // niets nieuws
    if (e?.dirty) {
      this._write(path, { data: mergeDoc(e.data, remote.data), eTag: remote.eTag, dirty: true });
    } else {
      this._write(path, { data: remote.data, eTag: remote.eTag, dirty: false });
    }
    this._emit(path, 'remote');
  }

  /** Stuur lokale wijzigingen naar OneDrive (bij conflict: samenvoegen en opnieuw) */
  async push(path, attempt = 0) {
    if (!this.drive) return;
    const e = this._read(path);
    if (!e?.dirty) return;
    try {
      const { eTag } = await this.drive.writeJson(path, e.data, e.eTag);
      const now = this._read(path);
      // Werd er tijdens het bewaren nog iets gewijzigd? Dan blijft het "dirty".
      const changed = JSON.stringify(now.data) !== JSON.stringify(e.data);
      this._write(path, { data: now.data, eTag, dirty: changed });
      if (changed) this.schedulePush();
    } catch (err) {
      if (err.conflict && attempt < 3) {
        await this.pull(path);
        return this.push(path, attempt + 1);
      }
      throw err;
    }
  }

  schedulePush() {
    if (!this.drive) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync([]), 800);
  }

  /** Haal de gevraagde bestanden op en bewaar alle lokale wijzigingen */
  sync(pullPaths = []) {
    if (!this.drive) { this._setStatus('local'); return Promise.resolve(); }
    if (this.running) {
      // Er loopt al een synchronisatie: deze paden komen in de volgende ronde
      this.queue = [...new Set([...(this.queue ?? []), ...pullPaths])];
      this.next ??= this.running.then(() => {
        const q = this.queue ?? [];
        this.queue = null;
        this.next = null;
        return this.sync(q);
      });
      return this.next;
    }
    this.running = this._run(pullPaths).finally(() => { this.running = null; });
    return this.running;
  }

  async _run(pullPaths) {
    this._setStatus('busy');
    try {
      for (const p of pullPaths) await this.pull(p);
      for (const p of this.dirtyPaths()) await this.push(p);
      this._setStatus('ok');
    } catch (e) {
      this._handleError(e);
    }
  }

  /** Lijst van bestanden in een map van OneDrive (bv. alle werknemers van een maand) */
  async list(folder) {
    if (!this.drive) return [];
    return this.drive.list(folder);
  }
}
