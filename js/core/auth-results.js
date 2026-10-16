// Authentication-Results (RFC 8601) reader for untrusted inbound mail (BUILD-SPEC A4).
// Trust rule: only the TOPMOST Authentication-Results header counts, and only when its authserv-id equals the
// configured trusted id. Everything else (lower headers, ARC, X- variants, text inside comments or quoted reasons)
// is ignored, so an attacker who writes their own header block can never produce a "pass". Fails closed:
// no trusted id configured, no header, parse trouble => every method is "unknown".
// Pure: no I/O, never throws.

const RESULTS = new Set(['pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror', 'policy', 'hardfail']);

function stripComments(s) {
  let out = '';
  let depth = 0;
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { if (!depth) out += c + s[i + 1]; i++; continue; }
    if (c === '"' && !depth) q = !q;
    if (!q && c === '(') { depth++; continue; }
    if (!q && c === ')' && depth) { depth--; continue; }
    if (!depth) out += c;
  }
  return out;
}

function splitOutsideQuotes(s, sep) {
  const parts = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && q && i + 1 < s.length) { cur += c + s[++i]; continue; }
    if (c === '"') q = !q;
    if (c === sep && !q) { parts.push(cur); cur = ''; } else cur += c;
  }
  parts.push(cur);
  return parts;
}

// property tokens: ptype.property=value where value may be quoted
function parseProps(s) {
  const props = {};
  const re = /([A-Za-z][A-Za-z0-9-]{0,30}\.[A-Za-z][A-Za-z0-9._-]{0,60})\s{0,5}=\s{0,5}("(?:[^"\\]|\\.)*"|[^\s;]+)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const k = m[1].toLowerCase();
    if (!(k in props)) props[k] = m[2].replace(/^"|"$/g, '').replace(/\\(.)/g, '$1');
  }
  return props;
}

const dom = (v) => String(v || '').toLowerCase().replace(/^.*@/, '').replace(/\.$/, '').trim();

/** Parse one Authentication-Results header value. */
export function parseAuthResultsValue(value) {
  const cleaned = stripComments(String(value || '').slice(0, 8000)).replace(/\s+/g, ' ').trim();
  const segs = splitOutsideQuotes(cleaned, ';');
  const head = (segs.shift() || '').trim().split(' ');
  const authservId = (head[0] || '').replace(/^"|"$/g, '').toLowerCase();
  const out = { authservId, dkim: [], spf: [], dmarc: [], other: [] };
  for (const seg of segs) {
    const t = seg.trim();
    if (!t || t.toLowerCase() === 'none') continue;
    const m = /^([A-Za-z][A-Za-z0-9-]*)\s*=\s*([A-Za-z]+)(?:\s|$)(.*)$/.exec(t);
    if (!m) continue;
    const method = m[1].toLowerCase();
    const result = RESULTS.has(m[2].toLowerCase()) ? m[2].toLowerCase() : 'unknown';
    const props = parseProps(m[3]);
    if (method === 'dkim') out.dkim.push({ result, d: dom(props['header.d']), i: String(props['header.i'] || '').toLowerCase(), s: String(props['header.s'] || '').toLowerCase() });
    else if (method === 'spf') out.spf.push({ result, domain: dom(props['smtp.mailfrom'] || props['smtp.helo']) });
    else if (method === 'dmarc') out.dmarc.push({ result, headerFrom: dom(props['header.from']) });
    else out.other.push({ method, result });
  }
  return out;
}

/**
 * Read the trusted results from a message's headers.
 * `headers`: array of { lname, value } in message order (top first), as produced by mime.js parseMessage().headers.
 * Returns { trusted, reason, authservId, dkim:[{result,d,i,s}], spf:[{result,domain}], dmarc:[{result,headerFrom}],
 *           topmostCount, untrustedCount }.
 */
export function readTrustedAuthResults(headers, { trustedAuthservId } = {}) {
  const blank = { trusted: false, reason: 'no_authentication_results', authservId: '', dkim: [], spf: [], dmarc: [], topmostCount: 0, untrustedCount: 0 };
  try {
    const list = (Array.isArray(headers) ? headers : []).filter((h) => h && h.lname === 'authentication-results');
    if (!list.length) return blank;
    const base = { ...blank, topmostCount: 1, untrustedCount: list.length - 1 };
    const trustedId = String(trustedAuthservId || '').trim().toLowerCase();
    if (!trustedId) return { ...base, reason: 'no_trusted_authserv_id_configured' };
    const top = parseAuthResultsValue(list[0].value);
    if (top.authservId !== trustedId) return { ...base, reason: 'topmost_not_from_trusted_server', authservId: top.authservId };
    return { ...base, trusted: true, reason: 'ok', authservId: top.authservId, dkim: top.dkim, spf: top.spf, dmarc: top.dmarc };
  } catch {
    return { ...blank, reason: 'parse_error' };
  }
}

/**
 * Summarise for a given From domain (exact, lower-case). Everything stays "unknown" unless the trusted header
 * says otherwise. DKIM "pass" requires header.d EXACTLY equal to the From domain (strict alignment, A5);
 * a pass for a parent domain only sets dkimRelaxedOnly; a pass for any other domain sets dkimOtherDomainPass.
 */
export function summariseAuth(trustedResults, fromDomain) {
  const fd = dom(fromDomain);
  const r = trustedResults || {};
  const out = {
    trusted: !!r.trusted, spf: 'unknown', dkim: 'unknown', dmarc: 'unknown',
    dkimAlignedDomain: '', dkimRelaxedOnly: false, dkimOtherDomainPass: false, dmarcAligned: false, multipleDkim: (r.dkim || []).length > 1,
  };
  if (!r.trusted || !fd) return out;
  const dk = r.dkim || [];
  const aligned = dk.find((x) => x.result === 'pass' && x.d === fd);
  if (aligned) { out.dkim = 'pass'; out.dkimAlignedDomain = aligned.d; }
  else {
    const passes = dk.filter((x) => x.result === 'pass' && x.d);
    if (passes.some((x) => fd.endsWith(`.${x.d}`))) out.dkimRelaxedOnly = true;
    else if (passes.length) out.dkimOtherDomainPass = true;
    out.dkim = dk.length ? 'fail' : 'unknown'; // a pass that is not aligned does not authenticate this sender
  }
  const dmarcs = r.dmarc || [];
  if (dmarcs.length) {
    if (dmarcs.every((x) => x.result === 'pass' && x.headerFrom === fd)) { out.dmarc = 'pass'; out.dmarcAligned = true; }
    else if (dmarcs.some((x) => ['pass', 'fail', 'softfail', 'hardfail'].includes(x.result))) out.dmarc = 'fail';
  }
  const sp = (r.spf || [])[0];
  if (sp) out.spf = sp.result === 'pass' ? 'pass' : ['fail', 'softfail', 'hardfail'].includes(sp.result) ? 'fail' : 'unknown';
  return out;
}
