// RFC 4226 (HOTP) and RFC 6238 (TOTP) with Web Crypto only. Used for the staff second-factor checks and their tests.
// Pure apart from crypto.subtle: time is a parameter (`now`, milliseconds), nothing reads a clock, nothing is stored.
// Secrets are given as base32 text or bytes; this module never generates randomness itself.

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const HASHES = { 'SHA-1': 'SHA-1', 'SHA-256': 'SHA-256', 'SHA-512': 'SHA-512' };

/** RFC 4648 base32 text to bytes. Ignores spaces, hyphens and padding; returns null for any other character. */
export function base32Decode(text) {
  const s = String(text == null ? '' : text).slice(0, 1000).toUpperCase().replace(/[\s-]+/g, '').replace(/=+$/, '');
  if (!s) return new Uint8Array(0);
  let bits = 0; let value = 0;
  const out = [];
  for (const ch of s) {
    const i = B32.indexOf(ch);
    if (i < 0) return null;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; value &= (1 << bits) - 1; }
  }
  return Uint8Array.from(out);
}

export function base32Encode(bytes) {
  let bits = 0; let value = 0; let out = '';
  for (const b of bytes || []) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

const toBytes = (secret) => (typeof secret === 'string' ? base32Decode(secret) : secret instanceof Uint8Array ? secret : null);

/** HOTP value for a counter. Returns a zero-padded string, or null for bad input. */
export async function hotp(secret, counter, { digits = 6, algorithm = 'SHA-1' } = {}) {
  try {
    const key = toBytes(secret);
    if (!key || !key.length || !Number.isSafeInteger(counter) || counter < 0 || !HASHES[algorithm] || !Number.isInteger(digits) || digits < 6 || digits > 10) return null;
    const msg = new Uint8Array(8);
    const dv = new DataView(msg.buffer);
    dv.setUint32(0, Math.floor(counter / 2 ** 32));
    dv.setUint32(4, counter >>> 0);
    const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: HASHES[algorithm] }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, msg));
    const off = mac[mac.length - 1] & 0x0f;
    const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
    return String(bin % 10 ** digits).padStart(digits, '0');
  } catch { return null; }
}

/** TOTP at `now` (ms since epoch). */
export async function totp(secret, { now, step = 30, digits = 6, algorithm = 'SHA-1', t0 = 0 } = {}) {
  if (!Number.isFinite(now) || !Number.isInteger(step) || step < 1) return null;
  return hotp(secret, Math.floor((Math.floor(now / 1000) - t0) / step), { digits, algorithm });
}

const constantTimeEqual = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

/**
 * verifyTotp(secret, code, { now, window = 1, lastUsedCounter = null })
 * -> { ok, counter, reason }. Accepts the current step and `window` steps either side. A code at a counter at or below
 * `lastUsedCounter` is rejected as a replay, so the caller stores the returned counter after a success.
 */
export async function verifyTotp(secret, code, { now, step = 30, digits = 6, algorithm = 'SHA-1', window = 1, lastUsedCounter = null } = {}) {
  const c = typeof code === 'string' ? code.replace(/\s+/g, '') : typeof code === 'number' ? String(code).padStart(digits, '0') : '';
  if (!new RegExp(`^\\d{${digits}}$`).test(c)) return { ok: false, counter: null, reason: 'bad_format' };
  if (!Number.isFinite(now) || !Number.isInteger(window) || window < 0 || window > 5) return { ok: false, counter: null, reason: 'bad_parameters' };
  const key = toBytes(secret);
  if (!key || !key.length) return { ok: false, counter: null, reason: 'bad_secret' };
  const center = Math.floor(Math.floor(now / 1000) / step);
  let matched = null;
  for (let d = -window; d <= window; d++) {
    const ctr = center + d;
    if (ctr < 0) continue;
    const v = await hotp(key, ctr, { digits, algorithm }); // always evaluate every candidate (no early exit on timing)
    if (v !== null && constantTimeEqual(v, c) && matched === null) matched = ctr;
  }
  if (matched === null) return { ok: false, counter: null, reason: 'mismatch' };
  if (lastUsedCounter !== null && matched <= lastUsedCounter) return { ok: false, counter: matched, reason: 'replayed' };
  return { ok: true, counter: matched, reason: 'ok' };
}

/** otpauth:// provisioning URI (the secret is shown to the user once; never logged). */
export function otpauthUri({ secret, account, issuer = 'TaleemParakh', digits = 6, period = 30, algorithm = 'SHA1' }) {
  const enc = encodeURIComponent;
  return `otpauth://totp/${enc(issuer)}:${enc(account || '')}?secret=${enc(String(secret || '').replace(/=+$/, ''))}&issuer=${enc(issuer)}&algorithm=${enc(algorithm)}&digits=${digits}&period=${period}`;
}
