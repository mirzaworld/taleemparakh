// Defensive RFC 5322 / MIME parser for untrusted inbound email (BUILD-SPEC 4.8, 4.9, 10.1).
// Pure: bytes (or a string) in, a plain-data description out. Never throws, never executes or renders anything.
// Runs unchanged in the browser, Node and Deno (TextEncoder / TextDecoder only).
//
// Hostile input handled: folded headers, RFC 2047 encoded words in any charset TextDecoder knows, RFC 2231
// parameters, nested multiparts, unterminated or missing boundaries, base64 and quoted-printable, 8-bit,
// HTML-only bodies (tag-stripped copy with hidden text separated), attachments, CR/LF/NUL smuggled into
// header values (directly or through encoded words), duplicate singleton headers, oversize input.

export const LIMITS = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxHeaders: 400,
  maxHeaderLength: 16 * 1024,
  maxDepth: 6,
  maxParts: 100,
  maxTextChars: 1024 * 1024,
});

const SINGLETON_HEADERS = ['from', 'sender', 'reply-to', 'to', 'date', 'subject', 'message-id', 'in-reply-to', 'content-type', 'content-transfer-encoding'];

// ---------- small helpers ----------

const latin1 = (bytes) => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return out;
};
const toBytes = (binStr) => {
  const out = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) out[i] = binStr.charCodeAt(i) & 0xff;
  return out;
};
const CTL = /[\x00-\x08\x0a-\x1f\x7f]/; // tab is allowed in header values
const CTL_ANY = CTL;

export function decodeBytes(bytes, charset) {
  const label = String(charset || '').trim().replace(/^["']|["']$/g, '').split('*')[0].toLowerCase() || 'utf-8';
  let known = true;
  let dec;
  try { dec = new TextDecoder(label, { fatal: false }); } catch { known = false; dec = new TextDecoder('utf-8', { fatal: false }); }
  let text;
  try { text = dec.decode(bytes); } catch { text = ''; known = false; }
  return { text, known };
}

export function base64ToBytes(s) {
  const clean = String(s || '').replace(/[^A-Za-z0-9+/_-]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  try {
    const bin = atob(padded);
    return toBytes(bin);
  } catch { return new Uint8Array(0); }
}

export function quotedPrintableToBytes(s, { header = false } = {}) {
  let str = String(s || '');
  if (header) str = str.replace(/_/g, ' ');
  else str = str.replace(/=[ \t]*\r?\n/g, ''); // soft line breaks
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(str.substr(i + 1, 2))) { out.push(parseInt(str.substr(i + 1, 2), 16)); i += 2; }
    else out.push(str.charCodeAt(i) & 0xff);
  }
  return Uint8Array.from(out);
}

/** Remove RFC 5322 (nested) comments in one linear pass; escaped parentheses are kept out of the way. */
function stripParenComments(s) {
  let out = '';
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length) { if (!depth) out += c + s[i + 1]; i++; continue; }
    if (c === '(') { depth++; continue; }
    if (c === ')' && depth) { depth--; continue; }
    if (!depth) out += c;
  }
  return out;
}

// ---------- RFC 2047 encoded words ----------

const ENCODED_WORD = /=\?([^?\s]{1,60})\?([bBqQ])\?([^?\s]{0,1000})\?=/g;

/** Decode RFC 2047 encoded words. Returns { text, flags }; control characters are stripped and flagged. */
export function decodeEncodedWords(value) {
  const flags = [];
  const src = String(value || '').slice(0, 50000);
  let out = '';
  let last = 0;
  let prevWasWord = false;
  ENCODED_WORD.lastIndex = 0;
  let m;
  while ((m = ENCODED_WORD.exec(src)) !== null) {
    const between = src.slice(last, m.index);
    if (!(prevWasWord && /^[ \t\r\n]*$/.test(between))) out += between; // whitespace between adjacent words is dropped
    const bytes = m[2].toLowerCase() === 'b' ? base64ToBytes(m[3]) : quotedPrintableToBytes(m[3], { header: true });
    const { text, known } = decodeBytes(bytes, m[1]);
    if (!known) flags.push('unknown_charset');
    out += known ? text : m[0];
    prevWasWord = true;
    last = m.index + m[0].length;
  }
  out += src.slice(last);
  if (CTL_ANY.test(out)) flags.push('control_chars_in_decoded_header');
  out = out.replace(/[\x00-\x08\x0a-\x1f\x7f]+/g, ' ');
  return { text: out, flags };
}

// ---------- parameters (Content-Type, Content-Disposition), RFC 2231 ----------

/** Parse "type/subtype; a=b; c*=utf-8''%41" into { value, params }. Tolerant of junk. */
export function parseParameterized(raw) {
  const s = String(raw || '').slice(0, 20000);
  const params = {};
  const parts = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && inQ && i + 1 < s.length) { cur += c + s[++i]; continue; }
    if (c === '"') inQ = !inQ;
    if (c === ';' && !inQ) { parts.push(cur); cur = ''; } else cur += c;
  }
  parts.push(cur);
  const value = stripParenComments(parts.shift() || '').trim().toLowerCase();
  const pieces = {};
  for (const p of parts) {
    const eq = p.indexOf('=');
    if (eq < 1) continue;
    const name = p.slice(0, eq).trim().toLowerCase();
    let v = p.slice(eq + 1).trim();
    if (v.startsWith('"')) v = v.replace(/^"/, '').replace(/"[^"]*$/, '').replace(/\\(.)/g, '$1');
    const m = /^([^*]+)(?:\*(\d+))?(\*)?$/.exec(name);
    if (!m || !/^[a-z0-9_.-]+$/.test(m[1])) continue;
    (pieces[m[1]] = pieces[m[1]] || []).push({ idx: m[2] === undefined ? 0 : Number(m[2]), enc: !!m[3], v });
  }
  for (const [name, list] of Object.entries(pieces)) {
    list.sort((a, b) => a.idx - b.idx);
    let charset = null;
    let acc = '';
    let bytesMode = false;
    const bytes = [];
    for (const [i, p] of list.entries()) {
      let v = p.v;
      if (p.enc) {
        if (i === 0) { const mm = /^([^']*)'[^']*'(.*)$/.exec(v); if (mm) { charset = mm[1] || 'utf-8'; v = mm[2]; } }
        bytesMode = true;
        for (let k = 0; k < v.length; k++) {
          if (v[k] === '%' && /^[0-9A-Fa-f]{2}$/.test(v.substr(k + 1, 2))) { bytes.push(parseInt(v.substr(k + 1, 2), 16)); k += 2; }
          else bytes.push(v.charCodeAt(k) & 0xff);
        }
      } else if (bytesMode) { for (let k = 0; k < v.length; k++) bytes.push(v.charCodeAt(k) & 0xff); } else acc += v;
    }
    params[name] = bytesMode ? decodeBytes(Uint8Array.from(bytes), charset || 'utf-8').text : decodeEncodedWords(acc).text;
  }
  return { value, params };
}

// ---------- address lists ----------

/**
 * Parse an address header into [{ name, address }]. Handles quoted names, comments, groups, commas inside quotes.
 * `name` has encoded words decoded. `address` is lower-cased. Entries that are not a plain addr-spec are returned
 * in `invalid` (never silently dropped). Never throws.
 */
export function parseAddressList(value) {
  const src = String(value || '');
  const addresses = [];
  const invalid = [];
  const items = [];
  let cur = '';
  let inQ = false;
  let angle = false;
  let paren = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\' && (inQ || paren) && i + 1 < src.length) { cur += c + src[++i]; continue; }
    if (!paren && c === '"') inQ = !inQ;
    else if (!inQ && c === '(') paren++;
    else if (!inQ && c === ')' && paren) paren--;
    else if (!inQ && !paren && c === '<') angle = true;
    else if (!inQ && !paren && c === '>') angle = false;
    if (!inQ && !paren && !angle && (c === ',' || c === ';')) { items.push(cur); cur = ''; continue; }
    cur += c;
  }
  items.push(cur);
  for (let item of items) {
    item = item.trim();
    if (!item) continue;
    item = item.replace(/^[^"<@]*?:\s*(?=[^:]*$)/, (g) => (g.includes('"') ? g : '')); // group label "undisclosed-recipients:"
    // strip comments outside quotes
    let noComment = '';
    let q = false;
    let depth = 0;
    for (let i = 0; i < item.length; i++) {
      const c = item[i];
      if (c === '\\' && i + 1 < item.length) { if (!depth) noComment += c + item[i + 1]; i++; continue; }
      if (c === '"' && !depth) q = !q;
      if (!q && c === '(') { depth++; continue; }
      if (!q && c === ')' && depth) { depth--; continue; }
      if (!depth) noComment += c;
    }
    const angleM = /<([^<>]*)>\s*$/.exec(noComment);
    let addr;
    let name;
    if (angleM) { addr = angleM[1].trim(); name = noComment.slice(0, angleM.index).trim(); }
    else { addr = noComment.trim(); name = ''; }
    if (name.startsWith('"')) name = name.replace(/^"/, '').replace(/"\s*$/, '').replace(/\\(.)/g, '$1');
    const decodedName = decodeEncodedWords(name).text.trim();
    if (/^[^\s<>()[\]\\,;:@"]+@[^\s<>()[\]\\,;:@"]+$/.test(addr) && addr.length <= 320 && !addr.includes('..')) {
      addresses.push({ name: decodedName, address: addr.toLowerCase() });
    } else invalid.push(item.slice(0, 200));
  }
  return { addresses, invalid };
}

// ---------- dates ----------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ZONES = { ut: 0, gmt: 0, z: 0, est: -300, edt: -240, cst: -360, cdt: -300, mst: -420, mdt: -360, pst: -480, pdt: -420 };

/** RFC 5322 date to epoch milliseconds, or null. Strict on structure, tolerant of comments and case. */
export function parseDateHeader(value) {
  const s = stripParenComments(String(value || '').slice(0, 300)).replace(/\s+/g, ' ').trim();
  const m = /^(?:[A-Za-z]{3},? ?)?(\d{1,2}) ([A-Za-z]{3})[A-Za-z]* (\d{2,4}) (\d{1,2}):(\d{2})(?::(\d{2}))? ?([+-]\d{4}|[A-Za-z]{1,3})$/.exec(s);
  if (!m) return null;
  const mon = MONTHS.indexOf(m[2].toLowerCase());
  if (mon < 0) return null;
  let year = Number(m[3]);
  if (m[3].length === 2) year += year < 50 ? 2000 : 1900;
  else if (m[3].length === 3) year += 1900;
  const day = Number(m[1]); const hh = Number(m[4]); const mm = Number(m[5]); const ss = m[6] ? Number(m[6]) : 0;
  if (day < 1 || day > 31 || hh > 23 || mm > 59 || ss > 60) return null;
  let offset;
  if (/^[+-]\d{4}$/.test(m[7])) offset = (m[7][0] === '-' ? -1 : 1) * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(3)));
  else if (m[7].toLowerCase() in ZONES) offset = ZONES[m[7].toLowerCase()];
  else return null;
  const t = Date.UTC(year, mon, day, hh, mm, ss) - offset * 60000;
  const check = new Date(Date.UTC(year, mon, day));
  return check.getUTCDate() === day && Number.isFinite(t) ? t : null;
}

// ---------- HTML to text (tag-stripped copy for reviewers; never rendered) ----------

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const BLOCK = new Set(['p', 'div', 'br', 'li', 'tr', 'table', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'hr', 'section', 'article', 'header', 'footer']);
const SKIP = new Set(['script', 'style', 'head', 'title', 'noscript', 'template', 'svg', 'object', 'iframe']);
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', hellip: '...', copy: '(c)' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (all, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : ' ';
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}
const HIDDEN_STYLE = /display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0(?:px|pt|em|%)?\s*(?:;|$|!)|opacity\s*:\s*0(?:\.0+)?\s*(?:;|$|!)|(?:max-)?height\s*:\s*0(?:px)?\s*;[^"]*overflow\s*:\s*hidden|text-indent\s*:\s*-\d{3,}|color\s*:\s*(?:#fff(?:fff)?\b|white\b|transparent)/i;

/** Returns { text, hiddenText, flags }. Hidden text (display:none, zero font, white-on-white, comments, hidden attr) is split out. */
export function htmlToText(html) {
  const src = String(html || '').slice(0, LIMITS.maxTextChars);
  const tokens = /<!--([\s\S]*?)(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>?|([^<]+)|</g;
  const stack = [];
  let text = '';
  let hidden = '';
  const flags = [];
  let m;
  while ((m = tokens.exec(src)) !== null) {
    if (m[1] !== undefined) { if (m[1].trim()) { hidden += `${m[1]}\n`; flags.push('html_comment_text'); } continue; }
    if (m[3]) {
      const name = m[3].toLowerCase();
      if (m[2]) {
        const idx = stack.map((e) => e.name).lastIndexOf(name);
        if (idx >= 0) stack.length = idx;
        if (BLOCK.has(name)) text += '\n';
        continue;
      }
      const attrs = m[4] || '';
      const selfClosed = /\/\s*$/.test(attrs);
      const parentHidden = stack.some((e) => e.hidden);
      const hid = parentHidden || SKIP.has(name) || /\shidden(?:\s|=|$)/i.test(` ${attrs}`) || /aria-hidden\s*=\s*["']?true/i.test(attrs) || HIDDEN_STYLE.test(((/style\s*=\s*("[^"]*"|'[^']*')/i.exec(attrs) || [''])[1] || '').slice(1, -1));
      if (BLOCK.has(name)) text += '\n';
      if (!VOID.has(name) && !selfClosed) stack.push({ name, hidden: hid });
      continue;
    }
    const chunk = m[5];
    if (chunk === undefined) continue;
    const skipEl = stack.some((e) => SKIP.has(e.name));
    const decoded = decodeEntities(chunk);
    if (skipEl) { if (!stack.some((e) => e.name === 'head' || e.name === 'title')) { hidden += decoded; } continue; }
    if (stack.some((e) => e.hidden)) { hidden += `${decoded}\n`; flags.push('html_hidden_text'); } else text += decoded;
  }
  const clean = (t) => t.replace(/[ \t\u{a0}]+/gu, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: clean(text), hiddenText: clean(hidden), flags: [...new Set(flags)] };
}

// ---------- structure ----------

function splitHeaderBlock(str) {
  // header block ends at the first empty line (CRLF or LF); returns [headerLines, body]
  const m = /\r?\n\r?\n/.exec(str);
  let headText;
  let body;
  if (!m) {
    // no blank line: if it looks like headers only, everything is headers
    headText = str; body = '';
  } else { headText = str.slice(0, m.index); body = str.slice(m.index + m[0].length); }
  return [headText, body];
}

// Raw 8-bit header values (RFC 6532): valid UTF-8 is decoded, anything else is read as windows-1252.
function decodeRawHeader(v) {
  if (!/[\x80-\xff]/.test(v)) return v;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(toBytes(v)); } catch { return decodeBytes(toBytes(v), 'windows-1252').text; }
}

function parseHeaderLines(headText, flags) {
  const headers = [];
  const lines = headText.split(/\r?\n/);
  let cur = null;
  const push = () => { if (cur) { headers.push(cur); cur = null; } };
  for (const line of lines) {
    if (line === '') continue;
    if (/^[ \t]/.test(line)) {
      if (cur) { cur.value += ` ${line.trim()}`; cur.raw += `\n${line}`; if (cur.raw.length > LIMITS.maxHeaderLength) { flags.add('header_too_long'); cur.value = cur.value.slice(0, LIMITS.maxHeaderLength); } }
      else flags.add('malformed_header_line');
      continue;
    }
    push();
    const c = line.indexOf(':');
    if (c < 1) { flags.add('malformed_header_line'); continue; }
    let name = line.slice(0, c);
    if (/[ \t]$/.test(name)) { flags.add('space_before_colon'); name = name.trim(); }
    if (!/^[\x21-\x39\x3b-\x7e]+$/.test(name)) { flags.add('malformed_header_line'); continue; }
    cur = { name, lname: name.toLowerCase(), value: line.slice(c + 1).trim(), raw: line };
    if (headers.length >= LIMITS.maxHeaders) { flags.add('too_many_headers'); cur = null; break; }
  }
  push();
  for (const h of headers) {
    if (/\r/.test(h.raw) || CTL.test(h.value)) { flags.add('header_injection'); h.injected = true; }
    h.value = decodeRawHeader(h.value).replace(/[\x00-\x08\x0a-\x1f\x7f]+/g, ' ');
    h.value = h.value.slice(0, LIMITS.maxHeaderLength);
  }
  return headers;
}

const first = (headers, name) => { const h = headers.find((x) => x.lname === name); return h ? h.value : ''; };

function decodeBody(body, cte, charset, flags) {
  const enc = String(cte || '7bit').trim().toLowerCase();
  let bytes;
  if (enc === 'base64') bytes = base64ToBytes(body);
  else if (enc === 'quoted-printable') bytes = quotedPrintableToBytes(body);
  else { bytes = toBytes(body); if (!['7bit', '8bit', 'binary', ''].includes(enc)) flags.add('unknown_transfer_encoding'); }
  return bytes;
}

function textFromBytes(bytes, charset, flags) {
  let cs = charset;
  if (!cs) {
    const d = decodeBytes(bytes, 'utf-8');
    // 8-bit without a charset: valid UTF-8 or fall back to windows-1252
    let utf8ok = true;
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { utf8ok = false; }
    if (!utf8ok) { flags.add('undeclared_8bit_charset'); return decodeBytes(bytes, 'windows-1252').text; }
    return d.text;
  }
  const { text, known } = decodeBytes(bytes, cs);
  if (!known) flags.add('unknown_charset');
  return text;
}

function splitMultipart(body, boundary, flags) {
  const lines = body.split(/\r?\n/);
  const delim = `--${boundary}`;
  const parts = [];
  let cur = null;
  let closed = false;
  let sawFirst = false;
  for (const line of lines) {
    const t = line.length > 1000 ? line.slice(0, 1000).trimEnd() : line.trimEnd();
    if (t === delim) { if (cur) parts.push(cur); cur = []; sawFirst = true; continue; }
    if (t === `${delim}--`) { if (cur) parts.push(cur); cur = null; closed = true; break; }
    if (cur) cur.push(line);
  }
  if (cur) { parts.push(cur); }
  if (!sawFirst) flags.add('multipart_boundary_not_found');
  else if (!closed) flags.add('unterminated_multipart');
  return parts.map((p) => p.join('\n'));
}

const hasAttachmentDisposition = (disp, ct, params) =>
  disp.value === 'attachment' || !!disp.params.filename || !!params.name;

/**
 * Parse a raw message. `raw` is a Uint8Array/ArrayBuffer (preferred) or a string.
 * Returns plain data, never throws:
 * { ok, errors[], flags[], headers[{name,lname,value,injected?}], from[], sender[], replyTo[], to[], subject, date, dateMs,
 *   messageId, inReplyTo, references[], text, textSource, hasPlainPart, hasHtmlPart, hiddenText,
 *   attachments[{filename,contentType,kind,extension,size,disposition}], contentType, isReport, partCount, bodyBytes }
 */
export function parseMessage(raw, opts = {}) {
  const limits = { ...LIMITS, ...opts };
  const flags = new Set();
  const errors = [];
  const empty = (err) => ({
    ok: false, errors: [err], flags: [], headers: [], from: [], fromInvalid: [], sender: [], replyTo: [], to: [], subject: '', date: '', dateMs: null,
    messageId: '', inReplyTo: '', references: [], text: '', textSource: null, hasPlainPart: false, hasHtmlPart: false, html: '', hiddenText: '',
    attachments: [], contentType: '', isReport: false, partCount: 0, bodyBytes: 0,
  });
  let bytes;
  try {
    if (typeof raw === 'string') bytes = new TextEncoder().encode(raw);
    else if (raw instanceof Uint8Array) bytes = raw;
    else if (raw instanceof ArrayBuffer) bytes = new Uint8Array(raw);
    else return empty('input_not_bytes');
  } catch { return empty('input_not_bytes'); }
  if (!bytes.length) return empty('empty');
  if (bytes.length > limits.maxBytes) return empty('too_large');

  const str = latin1(bytes);
  if (/\r(?!\n)/.test(str.slice(0, 200000))) flags.add('bare_cr');
  const [headText, bodyStr] = splitHeaderBlock(str);
  const headers = parseHeaderLines(headText, flags);
  if (!headers.length) { errors.push('no_headers'); }

  for (const n of SINGLETON_HEADERS) if (headers.filter((h) => h.lname === n).length > 1) flags.add(`duplicate_${n}`);
  // encoded words in header values that smuggle CR/LF
  for (const h of headers) {
    if (h.value.includes('=?')) { const d = decodeEncodedWords(h.value); if (d.flags.includes('control_chars_in_decoded_header')) { flags.add('header_injection'); h.injected = true; } }
  }

  const state = { parts: 0, attachments: [], plain: [], html: [], flags };
  const walk = (hdrs, body, depth) => {
    if (state.parts++ >= limits.maxParts) { flags.add('too_many_parts'); return; }
    const ct = parseParameterized(first(hdrs, 'content-type') || 'text/plain');
    const disp = parseParameterized(first(hdrs, 'content-disposition'));
    const type = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(ct.value) ? ct.value : 'text/plain';
    if (type !== ct.value && first(hdrs, 'content-type')) flags.add('invalid_content_type');
    if (type.startsWith('multipart/')) {
      if (depth >= limits.maxDepth) { flags.add('too_deep'); return; }
      const boundary = ct.params.boundary;
      if (!boundary || /[\r\n]/.test(boundary)) { flags.add('multipart_boundary_missing'); return; }
      for (const p of splitMultipart(body, boundary, flags)) {
        const [pt, pb] = splitHeaderBlock(p.replace(/^\n/, '\n'));
        const ph = p.startsWith('\n') ? [] : parseHeaderLines(pt, flags);
        const pbody = p.startsWith('\n') ? p.replace(/^\n/, '') : pb;
        walk(ph, pbody, depth + 1);
      }
      return;
    }
    const bytesDec = decodeBody(body, first(hdrs, 'content-transfer-encoding'), ct.params.charset, flags);
    const filename = (disp.params.filename || ct.params.name || '').replace(/[\x00-\x1f\x7f\u{202a}-\u{202e}]/gu, '').slice(0, 255);
    const attachment = hasAttachmentDisposition(disp, ct, ct.params) || !(type === 'text/plain' || type === 'text/html');
    if (!attachment && (type === 'text/plain' || type === 'text/html')) {
      const text = textFromBytes(bytesDec, ct.params.charset, flags).slice(0, limits.maxTextChars);
      if (bytesDec.length > limits.maxTextChars) flags.add('text_truncated');
      (type === 'text/plain' ? state.plain : state.html).push(text);
      return;
    }
    const ext = (/\.([A-Za-z0-9]{1,8})$/.exec(filename) || [, ''])[1].toLowerCase();
    const kind = type === 'application/pdf' ? 'pdf' : /^image\/(png|jpe?g|gif|webp|heic)$/.test(type) ? 'image' : 'other';
    state.attachments.push({ filename, contentType: type, kind, extension: ext, size: bytesDec.length, disposition: disp.value || 'attachment' });
  };
  walk(headers, bodyStr, 0);

  const addr = (n) => parseAddressList(first(headers, n));
  const fromList = addr('from');
  const dateRaw = first(headers, 'date');
  const topCt = parseParameterized(first(headers, 'content-type'));
  let text = state.plain[0] ?? '';
  let textSource = state.plain.length ? 'text/plain' : null;
  const html = state.html.join('\n');
  let hiddenText = '';
  if (html) {
    const h = htmlToText(html);
    hiddenText = h.hiddenText;
    for (const f of h.flags) flags.add(f);
    if (!state.plain.length) { text = h.text; textSource = 'html_stripped'; flags.add('html_only'); }
  }
  if (state.plain.length > 1) flags.add('multiple_text_parts');
  const refs = (first(headers, 'references').match(/<[^<>\s]{1,998}>/g) || []);
  return {
    ok: errors.length === 0,
    errors,
    flags: [...flags].sort(),
    headers: headers.map((h) => ({ name: h.name, lname: h.lname, value: h.value, ...(h.injected ? { injected: true } : {}) })),
    from: fromList.addresses,
    fromInvalid: fromList.invalid,
    sender: addr('sender').addresses,
    replyTo: addr('reply-to').addresses,
    to: addr('to').addresses,
    subject: decodeEncodedWords(first(headers, 'subject')).text,
    date: dateRaw,
    dateMs: parseDateHeader(dateRaw),
    messageId: (/<[^<>\s]{1,998}>/.exec(first(headers, 'message-id')) || [''])[0],
    inReplyTo: (/<[^<>\s]{1,998}>/.exec(first(headers, 'in-reply-to')) || [''])[0],
    references: refs,
    text,
    textSource,
    hasPlainPart: state.plain.length > 0,
    hasHtmlPart: state.html.length > 0,
    hiddenText,
    attachments: state.attachments,
    contentType: topCt.value,
    isReport: topCt.value === 'multipart/report',
    partCount: state.parts,
    bodyBytes: bytes.length,
  };
}

/** All values of a header (top to bottom as they appear in the message). */
export function getHeaders(msg, name) {
  const n = String(name || '').toLowerCase();
  return (msg && Array.isArray(msg.headers) ? msg.headers : []).filter((h) => h.lname === n).map((h) => h.value);
}
export function getHeader(msg, name) { return getHeaders(msg, name)[0] ?? ''; }
