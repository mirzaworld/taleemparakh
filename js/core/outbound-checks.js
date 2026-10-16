// Automatic checks before a person reviews an outgoing university email (addendum B.3, B.3.1). Pure: values in, check rows out.
// A `hard` row blocks the draft; a `soft` row raises the item to the careful tier. The database repeats the checks that
// grant trust (app.field_problem in 0017); tests/outbound-checks.test.js and supabase/tests/r13_presend_tests.sql feed both
// layers the same strings (UNI-05). Rows hold field names and codes only, never message text.
import { scanInjection } from './injection.js';

export const CHECKS_VERSION = 1;

// Characters that never belong in a field: C0 and C1 controls (CR, LF and TAB included), bidi marks and overrides, zero width.
const CTRL = /[\u0000-\u001f\u007f-\u009f­؜᠎​-‏‪-‮⁠-⁤⁦-⁩﻿]/u;
// Email-bound fields: Latin letters (Basic Latin, Latin-1, Latin Extended-A), digits, space and .,'-&()/
const SCRIPT_OK = /^[A-Za-z0-9À-ÖØ-öø-ſ .,'\-&()/]*$/;
const NAME_OK = /^[A-Za-zÀ-ÖØ-öø-ſ .'-]*$/;
const CITY_OK = /^[A-Za-zÀ-ÖØ-öø-ſ -]*$/;
const REF_OK = /^[A-Za-z0-9/-]*$/;
const AMOUNT_OK = /^\d+(\.\d+)?$/;
const EMAIL = /^[a-z0-9._%+'-]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;
const URL_LIKE = /:\/\/|\bwww\.|(?:^|[^a-z0-9])[a-z0-9-]{2,63}\.(?:com|net|org|info|biz|xyz|top|ru|cn|click|link|edu|io|co|me|app|site|online|pk|uk|us|in|ly|gg|tk|ml|ga|cf|gq|shop|live|icu|cc)\b/i;
const ACCUSE = /\b(?:fraud|fraudster|fraudulent|scam|scammer|fake|cheat|cheater|criminal|thief|liar|dhoka|dhokebaz|fraudia|chor)\b|فراڈ|دھوکہ|جعلی/i;
const ANSWER_LINE = /(?:^|[^a-z0-9])q[1-5]\b|\bdecline\b|taleemparakh\s+request|^\s*-{2,}/im;
const COMBINING_RUN = /\p{M}{3,}/u;
const CURRENCIES = Object.freeze(['PKR', 'GBP', 'USD', 'EUR', 'AUD', 'CAD', 'NZD', 'AED', 'CNY', 'MYR', 'TRY', 'SEK', 'CHF']);
// Per-currency ceilings (hard above, soft above half). The database reads the same numbers (app.money_ceiling in 0017).
export const MONEY_CEILING = Object.freeze({ PKR: 20000000, GBP: 100000, USD: 100000, EUR: 100000, AUD: 150000, CAD: 150000, NZD: 150000, AED: 400000, CNY: 700000, MYR: 450000, TRY: 3000000, SEK: 1000000, CHF: 100000 });

/** Rules per field name (B.3.1). `kind` selects the allowed character set. */
export const FIELD_RULES = Object.freeze({
  name_on_application: { max: 80, kind: 'name', minLetters: 2, accuse: false },
  application_email: { max: 254, kind: 'email' },
  application_reference: { max: 40, kind: 'ref', minLen: 3 },
  programme: { max: 120, kind: 'script', minLetters: 3 },
  intake: { max: 30, kind: 'intake' },
  offer_type: { max: 20, kind: 'enum', values: ['conditional', 'unconditional'] },
  offer_date: { max: 10, kind: 'date' },
  scholarship_name: { max: 120, kind: 'script' },
  amount: { max: 15, kind: 'amount' },
  currency: { max: 3, kind: 'enum', values: CURRENCIES },
  consultant_name: { max: 80, kind: 'name', accuse: true },
  company_name: { max: 120, kind: 'script', accuse: true },
  city: { max: 60, kind: 'city' },
  beneficiary_name: { max: 120, kind: 'script', accuse: true },
  bank_name: { max: 80, kind: 'script' },
  account_last4: { max: 4, kind: 'last4' },
});

/** Every field name a student value may carry into an email. */
export const EMAIL_FIELDS = Object.freeze(Object.keys(FIELD_RULES));

/** NFKC, trim, collapse spaces. The stored value is this one (F-NORM). */
export const normalizeValue = (v) => String(v ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const SEASONS = { spring: 2, summer: 5, autumn: 8, fall: 8, winter: 0 };

/** Parses "September 2027", "09/2027", "Fall 2026" into { y, m } (m 0 to 11) or null. */
export function parseIntake(s) {
  const t = String(s).trim().toLowerCase();
  let m = /^([a-z]{3,9})\.?,?\s+(\d{4})$/.exec(t);
  if (m) {
    const mi = MONTHS.findIndex((x) => x === m[1] || x.slice(0, 3) === m[1]);
    if (mi >= 0) return { y: Number(m[2]), m: mi };
    if (Object.prototype.hasOwnProperty.call(SEASONS, m[1])) return { y: Number(m[2]), m: SEASONS[m[1]] };
    return null;
  }
  m = /^(\d{1,2})[/-](\d{4})$/.exec(t);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return { y: Number(m[2]), m: Number(m[1]) - 1 };
  return null;
}

const monthsBetween = (now, y, m) => (y - now.getUTCFullYear()) * 12 + (m - now.getUTCMonth());

/** One field -> list of { check, result, code }. Only failures and soft flags are listed; the caller adds the passes. */
export function checkField(field, raw, now = new Date()) {
  const rule = FIELD_RULES[field];
  const out = [];
  const add = (check, result, code) => out.push({ check, result, code });
  if (!rule) { add('P-CLAIMSET', 'hard', 'unknown_field'); return out; }
  const original = String(raw ?? '');
  if (CTRL.test(original)) add('F-CTRL', 'hard', 'control_or_bidi');
  const v = normalizeValue(original.replace(CTRL, ' '));
  if (v !== original) out.push({ check: 'F-NORM', result: 'pass', code: 'normalised' });
  if (v.length > rule.max || original.length > rule.max * 4) add('F-LEN', 'hard', 'too_long');
  if (v.length === 0) { add('F-LEN', 'hard', 'empty'); return out; }
  if (COMBINING_RUN.test(v)) add('F-MARK', 'hard', 'combining_marks');
  const isMail = rule.kind === 'email';
  if (!isMail) {
    if (/@/.test(v) || EMAIL.test(v)) add('F-MAIL', 'hard', 'email_not_allowed');
    if (URL_LIKE.test(v)) add('F-URL', 'hard', 'link_not_allowed');
  }
  if (!['amount', 'last4', 'date', 'email', 'ref'].includes(rule.kind) && /\d{7,}/.test(v)) add('F-PHONE', 'hard', 'long_digit_run');
  if (ANSWER_LINE.test(v)) add('F-ANSWER', 'hard', 'answer_line_pattern');
  if (scanInjection({ text: v }).suspicious) add('F-INJ', 'hard', 'injection_pattern');
  if (rule.accuse && ACCUSE.test(v)) add('F-ACC', 'hard', 'accusation_word');
  switch (rule.kind) {
    case 'script': if (!SCRIPT_OK.test(v)) add('F-SCRIPT', 'hard', 'not_latin_letters'); break;
    case 'name': if (!NAME_OK.test(v)) add('F-SCRIPT', 'hard', 'not_latin_letters'); break;
    case 'city': if (!CITY_OK.test(v)) add('F-SCRIPT', 'hard', 'not_latin_letters'); break;
    case 'ref': if (!REF_OK.test(v)) add('F-SCRIPT', 'hard', 'bad_reference_characters'); break;
    case 'email': {
      if (!EMAIL.test(v)) add('F-MAIL', 'hard', 'bad_email');
      else if (/(^|\.)xn--/.test(v.split('@')[1])) add('F-MAIL', 'soft', 'idn_domain');
      break;
    }
    case 'intake': {
      if (!SCRIPT_OK.test(v)) add('F-SCRIPT', 'hard', 'not_latin_letters');
      const p = parseIntake(v);
      if (!p) add('P-DATE', 'hard', 'intake_format');
      else { const d = monthsBetween(now, p.y, p.m); if (d < -12 || d > 24) add('P-DATE', 'hard', 'intake_out_of_range'); }
      break;
    }
    case 'date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      const t = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
      if (!m || !Number.isFinite(t) || new Date(t).getUTCDate() !== Number(m[3])) add('P-DATE', 'hard', 'bad_date');
      else if (t > now.getTime() + 86400000) add('P-DATE', 'hard', 'date_in_future');
      else if (t < Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 24, now.getUTCDate())) add('P-DATE', 'hard', 'date_too_old');
      break;
    }
    case 'enum': if (!rule.values.includes(field === 'currency' ? v.toUpperCase() : v)) add(field === 'currency' ? 'P-MONEY' : 'P-CLAIMSET', 'hard', 'not_in_list'); break;
    case 'amount': {
      if (!AMOUNT_OK.test(v) || Number(v) <= 0 || (v.split('.')[1] || '').length > 2) add('P-MONEY', 'hard', 'bad_amount');
      break;
    }
    case 'last4': if (!/^\d{4}$/.test(v)) add('P-LAST4', 'hard', 'not_4_digits'); break;
    default: break;
  }
  return out;
}

/** Amount against its ceiling: 'hard' above, 'soft' above half. */
export function moneyResult(amount, currency) {
  const c = MONEY_CEILING[String(currency || '').toUpperCase()];
  const n = Number(amount);
  if (!c || !Number.isFinite(n)) return 'pass';
  return n > c ? 'hard' : n >= c / 2 ? 'soft' : 'pass';
}

export const expectedSubject = (environment, caseRef) =>
  `${{ simulation: '[SIMULATION] ', controlled: '[CONTROLLED TEST] ', live: '' }[environment] ?? '[?] '}Applicant-authorised verification request ${caseRef}`;

const SLOT = (i) => `ZZSLOT${String(i).padStart(2, '0')}ZZ`;
const SLOT_RE = /ZZSLOT\d\dZZ(?:@zzslot\.test)?/gi;
const fieldName = (key) => String(key).slice(String(key).lastIndexOf('.') + 1);

/**
 * T-SLOTS: the rendered body equals the template with only the declared slots filled. `render(valuesByField)` is the
 * caller's renderer (request-template.js buildRequest wrapped); it is called with the real values and with slot tokens.
 * Passes when the literal text around the slots is identical and no slot holds a line break.
 */
export function checkSlots(render, fields) {
  const names = Object.keys(fields).sort();
  const tokens = {};
  names.forEach((f, i) => {
    const n = fieldName(f);
    tokens[f] = n === 'account_last4' ? fields[f] : n === 'application_email' ? `${SLOT(i)}@zzslot.test` : SLOT(i);
  });
  const real = render(fields);
  const holes = render(tokens);
  if (!real || !holes || typeof real.text !== 'string' || typeof holes.text !== 'string') return { ok: false, code: 'render_failed' };
  const parts = holes.text.split(SLOT_RE);
  let at = 0;
  if (!real.text.startsWith(parts[0])) return { ok: false, code: 'template_drift' };
  at = parts[0].length;
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i];
    // the slot value runs up to the next literal segment (or the end)
    const next = seg === '' && i === parts.length - 1 ? real.text.length : real.text.indexOf(seg, at);
    if (next < 0) return { ok: false, code: 'template_drift' };
    const value = real.text.slice(at, next);
    if (/[\r\n]/.test(value)) return { ok: false, code: 'slot_has_line_break' };
    at = next + seg.length;
  }
  return at === real.text.length ? { ok: true } : { ok: false, code: 'template_drift' };
}

/**
 * runOutboundChecks({ fields, claims, rendered, environment, caseRef, now, render, kind, parentText, reminderLinePrefix })
 *   fields: { fieldName: value } for every value that reaches the email (identities and claim details)
 *   rendered: { subject, text }; render: function for T-SLOTS (optional; without it T-SLOTS is a hard failure)
 * -> { checks: [{ check_id, layer: 'js', result, detail }], hard: [ids], soft: [ids] } one row per check id.
 */
export function runOutboundChecks(input) {
  const o = input && typeof input === 'object' ? input : {};
  const now = o.now instanceof Date ? o.now : new Date();
  const fields = o.fields && typeof o.fields === 'object' ? o.fields : {};
  const byId = new Map();
  const note = (id, result, field, code) => {
    const cur = byId.get(id) ?? { check_id: id, layer: 'js', result: 'pass', detail: { fields: [], codes: [] } };
    const rank = { pass: 0, soft: 1, hard: 2 };
    if (rank[result] > rank[cur.result]) cur.result = result;
    if (field && result !== 'pass' && !cur.detail.fields.includes(fieldName(field))) cur.detail.fields.push(fieldName(field));
    if (code && !cur.detail.codes.includes(code)) cur.detail.codes.push(code);
    byId.set(id, cur);
  };
  for (const id of ['F-NORM', 'F-CTRL', 'F-SCRIPT', 'F-MARK', 'F-LEN', 'F-URL', 'F-MAIL', 'F-PHONE', 'F-ANSWER', 'F-INJ', 'F-ACC', 'P-DATE', 'P-MONEY', 'P-LAST4', 'P-CLAIMSET', 'T-SLOTS', 'T-HDR']) note(id, 'pass');
  const changed = [];
  for (const f of Object.keys(fields)) {
    for (const r of checkField(fieldName(f), fields[f], now)) {
      if (r.check === 'F-NORM') { changed.push(fieldName(f)); continue; }
      note(r.check, r.result, f, r.code);
    }
  }
  if (changed.length) byId.get('F-NORM').detail.fields = changed;
  // Money: amount against its ceiling in the same currency.
  for (const k of Object.keys(fields)) {
    if (fieldName(k) !== 'amount') continue;
    const cur = fields[`${k.slice(0, k.length - 6)}currency`];
    if (cur === undefined) continue;
    const m = moneyResult(normalizeValue(fields[k]), normalizeValue(cur));
    if (m !== 'pass') note('P-MONEY', m, 'amount', m === 'hard' ? 'above_ceiling' : 'above_half_ceiling');
  }
  // The rendered message: no control characters except line feed, the exact subject, only declared slots filled.
  const r = o.rendered && typeof o.rendered === 'object' ? o.rendered : {};
  if (typeof r.text !== 'string' || /[\u0000-\u0009\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/u.test(r.text)) note('F-CTRL', 'hard', 'body', 'control_or_bidi');
  if (typeof r.subject !== 'string' || r.subject !== expectedSubject(o.environment, o.caseRef)) note('T-HDR', 'hard', 'subject', 'subject_differs');
  if (typeof o.render !== 'function') note('T-SLOTS', 'hard', 'body', 'render_function_missing');
  else {
    const s = checkSlots(o.render, fields);
    if (!s.ok) note('T-SLOTS', 'hard', 'body', s.code);
  }
  if (o.kind === 'reminder') {
    const drift = reminderDrift(o.parentText, r.text);
    note('T-REMINDER-DRIFT', drift ? 'soft' : 'pass', drift ? 'body' : undefined, drift ? 'reminder_body_drift' : undefined);
  }
  const checks = [...byId.values()];
  return { checks, hard: checks.filter((c) => c.result === 'hard').map((c) => c.check_id), soft: checks.filter((c) => c.result === 'soft').map((c) => c.check_id) };
}

/** A reminder may differ from the approved original only by its reminder line (and the blank line after it). */
export function reminderDrift(parentText, text) {
  if (typeof parentText !== 'string' || typeof text !== 'string') return true;
  const stripped = text.replace(/^(?:THIS IS[^\n]*\n\n)?This is a reminder of our request of \d{4}-\d{2}-\d{2}\. If you have already replied, thank you\.\n\n/m, (m) => (m.startsWith('THIS IS') ? m.slice(0, m.indexOf('\n\n') + 2) : ''));
  return stripped !== parentText;
}
