// Aanmelden bij Microsoft (OAuth 2.0 met PKCE, zonder extra bibliotheek).
// Twee "sloten": 'A' = OneDrive met uren (gedeeld account), 'B' = OneDrive facturatie (enkel beheerder).
//
// Aangemeld blijven: het toegangstoken (1 uur) wordt vernieuwd met het vernieuwingstoken (24 uur).
// Is dat verlopen, dan meldt de app zich stil opnieuw aan via Microsoft (geen wachtwoord nodig
// zolang Microsoft de sessie onthoudt). Pas als Microsoft de sessie vergeten is, moet je opnieuw aanmelden.
import { MS_CLIENT_ID, MS_TENANT } from './config.js';

const AUTH = `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0`;
const SCOPES = 'openid profile offline_access User.Read Files.ReadWrite';
const KEY = (slot) => `enautec.auth.${slot}`;
const PKCE = 'enautec.pkce';
const SILENT_TRIED = 'enautec.silentTried';

export const authConfigured = () => !!MS_CLIENT_ID;

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomStr = (n = 48) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const redirectUri = () => location.origin + location.pathname;

function load(slot) {
  try { return JSON.parse(localStorage.getItem(KEY(slot)) || 'null'); } catch { return null; }
}
function save(slot, v) {
  try { v ? localStorage.setItem(KEY(slot), JSON.stringify(v)) : localStorage.removeItem(KEY(slot)); } catch { /* opslag geblokkeerd */ }
}

function parseIdToken(idt) {
  try {
    const p = JSON.parse(decodeURIComponent(escape(atob(idt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))));
    return { name: p.name || '', username: p.preferred_username || p.email || '' };
  } catch { return { name: '', username: '' }; }
}

/** Gegevens van het aangemelde account (of null) */
export function account(slot) {
  return load(slot)?.account ?? null;
}

/** Start aanmelden: de pagina gaat naar Microsoft en komt daarna terug */
export async function login(slot, { silent = false } = {}) {
  if (!MS_CLIENT_ID) throw new Error('De app is nog niet gekoppeld aan Microsoft (MS_CLIENT_ID in config.js).');
  const verifier = randomStr(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = `${slot}.${randomStr(12)}`;
  sessionStorage.setItem(PKCE, JSON.stringify({ verifier, state, slot, silent, hash: location.hash }));
  const p = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    prompt: silent ? 'none' : 'select_account',
  });
  const hint = account(slot)?.username;
  if (hint) p.set('login_hint', hint);
  location.assign(`${AUTH}/authorize?${p}`);
  return new Promise(() => {}); // pagina verlaat de app
}

async function tokenRequest(params) {
  const res = await fetch(`${AUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: MS_CLIENT_ID, scope: SCOPES, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error_description || data.error || `Aanmelden mislukt (${res.status})`);
    e.code = data.error;
    throw e;
  }
  return data;
}

function storeTokens(slot, data, prev) {
  const now = Date.now();
  const acc = data.id_token ? parseIdToken(data.id_token) : prev?.account;
  const v = {
    access: data.access_token,
    accessExp: now + (data.expires_in ?? 3600) * 1000,
    refresh: data.refresh_token ?? prev?.refresh,
    // Microsoft geeft webapps een vernieuwingstoken van 24 uur
    refreshExp: data.refresh_token && !prev?.refresh ? now + 23.5 * 3600000 : prev?.refreshExp ?? now + 23.5 * 3600000,
    account: acc,
  };
  save(slot, v);
  return v;
}

/**
 * Verwerk de terugkeer van Microsoft na aanmelden. Geeft { slot, ok, error } terug of null.
 */
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('state') || !(q.has('code') || q.has('error'))) return null;
  let pk;
  try { pk = JSON.parse(sessionStorage.getItem(PKCE) || 'null'); } catch { pk = null; }
  sessionStorage.removeItem(PKCE);
  history.replaceState(null, '', redirectUri() + (pk?.hash || ''));
  if (!pk || pk.state !== q.get('state')) return { slot: pk?.slot, ok: false, error: 'Aanmelden onderbroken. Probeer opnieuw.' };
  if (q.has('error')) {
    return { slot: pk.slot, ok: false, silent: pk.silent, error: q.get('error_description') || q.get('error') };
  }
  try {
    const data = await tokenRequest({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri(), code_verifier: pk.verifier });
    const prev = load(pk.slot);
    storeTokens(pk.slot, data, { account: prev?.account });
    sessionStorage.removeItem(SILENT_TRIED);
    return { slot: pk.slot, ok: true };
  } catch (e) {
    return { slot: pk.slot, ok: false, error: e.message };
  }
}

export class NeedsLogin extends Error {
  constructor(slot) { super('Opnieuw aanmelden nodig'); this.slot = slot; this.needsLogin = true; }
}

const refreshing = {};

/** Geldig toegangstoken, vernieuwd indien nodig */
export async function getToken(slot) {
  const t = load(slot);
  if (!t) throw new NeedsLogin(slot);
  if (t.access && Date.now() < t.accessExp - 120000) return t.access;
  if (t.refresh && Date.now() < t.refreshExp) {
    refreshing[slot] ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh })
      .then((data) => storeTokens(slot, data, t).access)
      .finally(() => { delete refreshing[slot]; });
    try { return await refreshing[slot]; } catch (e) {
      if (!navigator.onLine || e instanceof TypeError) throw e; // offline: later opnieuw
      save(slot, { account: t.account });
    }
  }
  throw new NeedsLogin(slot);
}

/** Vernieuwingstoken verlopen? Probeer één keer per sessie stil opnieuw aan te melden. */
export async function trySilentRenew(slot) {
  const t = load(slot);
  if (!t?.account || !MS_CLIENT_ID || !navigator.onLine) return false;
  if (t.refresh && Date.now() < t.refreshExp) return false;
  if (sessionStorage.getItem(SILENT_TRIED)) return false;
  sessionStorage.setItem(SILENT_TRIED, '1');
  await login(slot, { silent: true });
  return true;
}

export function logout(slot) {
  save(slot, null);
}

export function needsInteractive(slot) {
  const t = load(slot);
  return !t?.refresh || Date.now() >= (t.refreshExp ?? 0);
}
