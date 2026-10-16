// Minimal client for the TaleemParakh platform (BUILD-SPEC 7.4). Plain fetch, no libraries, no cookies.
// The session lives in sessionStorage only (gone when the tab closes); never localStorage.
// Every write goes through a database function that checks the caller; this file is convenience, not security.
import { CONFIG } from './config.js';

const BASE = CONFIG.supabaseUrl;
const KEY = CONFIG.publishableKey;
const SESSION_KEY = 'tp.session';

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
function writeSession(s) {
  try { if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); else sessionStorage.removeItem(SESSION_KEY); } catch { /* private mode */ }
}

export class ApiError extends Error {
  constructor(code, status, detail) { super(code); this.code = code; this.status = status; this.detail = detail; }
}

// Database refusals arrive in two shapes (M12, N-1): a raised error whose message is "tp:<reason>" (HTTP 400), and, for the
// RPCs that must log before refusing, a normal answer {"error": "tp:<reason>"} (HTTP 200). Both become the same ApiError code.
// A returned text that starts with "tp:" is NOT converted here: publish_claim and close_finding answer in words on purpose.
export function refusalCode(data) {
  const e = data && typeof data === 'object' && !Array.isArray(data) ? data.error : null;
  const m = typeof e === 'string' ? e.match(/^tp:([a-z_]+)$/) : null;
  return m ? m[1] : null;
}

// Everything else becomes a generic code (never raw server text).
function errorCode(body, status) {
  const text = `${body?.message || ''} ${body?.msg || ''} ${body?.error_description || ''} ${body?.error || ''}`;
  const m = text.match(/tp:([a-z_]+)/);
  if (m) return m[1];
  if (/sign in with the code we email you/i.test(text)) return 'code_required';
  if (status === 401 || status === 403) return 'not_allowed';
  if (status === 429) return 'too_many_requests';
  if (/not open yet/i.test(text)) return 'not_open_yet';
  if (/otp|token.*(expired|invalid)/i.test(text)) return 'code_invalid';
  return 'unexpected';
}

async function call(path, { method = 'GET', body, headers = {}, auth = true } = {}) {
  const s = auth ? await freshSession() : null;
  const res = await fetch(BASE + path, {
    method,
    credentials: 'omit',
    headers: { apikey: KEY, 'content-type': 'application/json', ...(s ? { authorization: `Bearer ${s.access_token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw new ApiError(errorCode(data, res.status), res.status);
  const refused = refusalCode(data);
  if (refused) throw new ApiError(refused, res.status);
  return data;
}

async function freshSession() {
  const s = readSession();
  if (!s) return null;
  if (Date.now() < (s.expires_at - 60) * 1000) return s;
  try {
    const res = await fetch(`${BASE}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', credentials: 'omit', headers: { apikey: KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    if (!res.ok) { writeSession(null); return null; }
    const d = await res.json();
    const next = { ...d, expires_at: Math.floor(Date.now() / 1000) + Number(d.expires_in || 3600) };
    writeSession(next);
    return next;
  } catch {
    return s;
  }
}

export const auth = {
  signedIn: () => Boolean(readSession()),
  email: () => readSession()?.user?.email || '',
  aal: () => {
    const t = readSession()?.access_token;
    try { return JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal || 'aal1'; } catch { return 'aal1'; }
  },
  // Students create their account with their first code; staff pass { createUser: false } (accounts are made by invitation).
  async sendCode(email, { createUser = true } = {}) {
    await call('/auth/v1/otp', { method: 'POST', body: { email, create_user: createUser }, auth: false });
  },
  async verifyCode(email, token) {
    const d = await call('/auth/v1/verify', { method: 'POST', body: { type: 'email', email, token }, auth: false });
    writeSession({ ...d, expires_at: Math.floor(Date.now() / 1000) + Number(d.expires_in || 3600) });
    return d;
  },
  // No password sign-in exists (M12, guard 3): the database refuses every password session. Staff use sendCode, verifyCode, then verifyTotp.
  async factors() {
    const u = await call('/auth/v1/user');
    return (u?.factors || []).filter((f) => f.factor_type === 'totp' && f.status === 'verified');
  },
  // Raises the session to aal2 with a TOTP code (Supabase Auth MFA challenge and verify).
  async verifyTotp(factorId, code) {
    const ch = await call(`/auth/v1/factors/${factorId}/challenge`, { method: 'POST', body: {} });
    const d = await call(`/auth/v1/factors/${factorId}/verify`, { method: 'POST', body: { challenge_id: ch.id, code } });
    writeSession({ ...d, expires_at: Math.floor(Date.now() / 1000) + Number(d.expires_in || 3600) });
    return d;
  },
  async signOut() {
    try { await call('/auth/v1/logout', { method: 'POST', body: {} }); } catch { /* signing out anyway */ }
    writeSession(null);
  },
};

// Database functions in schema app: POST /rest/v1/rpc/<name>.
export function rpc(name, params = {}) {
  return call(`/rest/v1/rpc/${encodeURIComponent(name)}`, { method: 'POST', body: params, headers: { 'Content-Profile': 'app' } });
}

// Views in schema app: GET /rest/v1/<view>?<query>.
export function view(name, query = '') {
  return call(`/rest/v1/${encodeURIComponent(name)}${query ? `?${query}` : ''}`, { headers: { 'Accept-Profile': 'app' } });
}

// Edge Functions that a signed-in person may call.
export function fn(name, body = {}) {
  return call(`/functions/v1/${encodeURIComponent(name)}`, { method: 'POST', body });
}

export async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const ENV_LABEL = CONFIG.envLabel;
