// Redaction before any text reaches an AI model or a student view (BUILD-SPEC 4.11, 4.13).
// Emails -> [EMAIL], phone numbers (Pakistani and international) -> [PHONE], the applicant's names -> [APPLICANT],
// references (application reference, case reference, anything the caller lists) -> [REF], IBAN-like -> [ACCOUNT].
// Truncated to 6,000 characters. Idempotent: redact(redact(x)) === redact(x). Pure, never throws.

export const MAX_REDACTED_CHARS = 6000;
const MAX_INPUT_CHARS = 60000;
const PLACEHOLDERS = ['EMAIL', 'PHONE', 'APPLICANT', 'REF', 'ACCOUNT'];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fold = (s) => String(s || '').normalize('NFKD').replace(/[\u{0300}-\u{036f}]/gu, '').toLowerCase();

// Arabic-Indic and Persian digits count as digits for phone detection.
const toAsciiDigits = (s) => s.replace(/[\u{0660}-\u{0669}\u{06f0}-\u{06f9}]/gu, (c) => String((c.codePointAt(0) & 0xf)));

// Bounded quantifiers everywhere: untrusted input must never cause quadratic or exponential backtracking.
const EMAIL = /[A-Za-z0-9._%+'-]{1,64}(?:[ \t]{0,3}[[(][ \t]{0,3}at[ \t]{0,3}[\])][ \t]{0,3}|@)[A-Za-z0-9-]{1,63}(?:(?:[ \t]{0,3}[[(][ \t]{0,3}dot[ \t]{0,3}[\])][ \t]{0,3}|\.)[A-Za-z0-9-]{1,63}){1,6}/gi;
const PHONE_CANDIDATE = /(?<![\w[])(?:\+|00)?[(]?[\d\u{0660}-\u{0669}\u{06f0}-\u{06f9}][\d\u{0660}-\u{0669}\u{06f0}-\u{06f9}\s().-]{7,20}[\d\u{0660}-\u{0669}\u{06f0}-\u{06f9}](?![\w\]])/gu;
const IBANISH = /(?<![\w[])[A-Z]{2}\d{2}[A-Z0-9]{10,30}(?![\w\]])/g;
const CASE_REF = /\bTP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}\b/gi;

function redactPhones(text, counts) {
  return text.replace(PHONE_CANDIDATE, (m) => {
    const digits = toAsciiDigits(m).replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) return m;
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(m.trim()) || /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(m.trim())) return m; // dates
    counts.phone += 1;
    const lead = /^\s+/.exec(m);
    return `${lead ? lead[0] : ''}[PHONE]`;
  });
}

/**
 * redact(text, { names, references, emails }) -> { text, counts, truncated }
 * names: array of strings (full names; each word of 3+ letters is also redacted). references: strings.
 * emails: extra addresses to redact even if oddly formatted.
 */
export function redact(input, options) {
  const { names = [], references = [], emails = [] } = options && typeof options === 'object' ? options : {};
  const counts = { email: 0, phone: 0, name: 0, ref: 0, account: 0 };
  let text = '';
  let inputCut = false;
  try {
    // work on a bounded slice: placeholders shorten text, so keep ten times the output limit
    const whole = String(input == null ? '' : input);
    text = whole.slice(0, MAX_INPUT_CHARS).normalize('NFC');
    inputCut = whole.length > MAX_INPUT_CHARS;
    // 1. references first
    const refs = [...new Set((Array.isArray(references) ? references : []).map((r) => String(r || '').trim()).filter((r) => r.length >= 3 && !PLACEHOLDERS.includes(r.toUpperCase())))].sort((a, b) => b.length - a.length);
    for (const r of refs) text = text.replace(new RegExp(escapeRe(r), 'gi'), () => { counts.ref += 1; return '[REF]'; });
    text = text.replace(CASE_REF, () => { counts.ref += 1; return '[REF]'; });
    // 2. emails
    for (const e of (Array.isArray(emails) ? emails : []).map((x) => String(x || '').trim()).filter(Boolean)) text = text.replace(new RegExp(escapeRe(e), 'gi'), () => { counts.email += 1; return '[EMAIL]'; });
    text = text.replace(EMAIL, () => { counts.email += 1; return '[EMAIL]'; });
    // 3. account-like strings, then phones
    text = text.replace(IBANISH, () => { counts.account += 1; return '[ACCOUNT]'; });
    text = redactPhones(text, counts);
    // 4. names last, on text that already has placeholders (which the name matcher skips)
    const words = new Set();
    const full = [];
    for (const n of Array.isArray(names) ? names : []) {
      const nm = String(n || '').trim();
      if (nm.length < 2) continue;
      full.push(nm);
      for (const w of nm.split(/[\s,.]+/)) if (w.length >= 3 && !PLACEHOLDERS.includes(w.toUpperCase())) words.add(w);
    }
    for (const w of full.filter((f) => !PLACEHOLDERS.includes(f.toUpperCase())).sort((x, y) => y.length - x.length)) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}[])${escapeRe(w).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}\\]])`, 'giu');
      text = text.replace(re, () => { counts.name += 1; return '[APPLICANT]'; });
    }
    // each name word, matched case- and accent-insensitively on whole word tokens
    const folded = new Set([...words].map(fold));
    if (folded.size) {
      text = text.replace(/[\p{L}\p{M}]+/gu, (tok, at, whole) => (folded.has(fold(tok)) && whole[at - 1] !== '[' && whole[at + tok.length] !== ']' ? (counts.name += 1, '[APPLICANT]') : tok));
    }
  } catch {
    return { text: '[REDACTION FAILED]', counts, truncated: false, failed: true };
  }
  let truncated = inputCut;
  if (text.length > MAX_REDACTED_CHARS) { text = text.slice(0, MAX_REDACTED_CHARS); truncated = true; }
  return { text, counts, truncated };
}
