// Deterministic validators for AI-drafted communications (addendum R10.1). Pure. The AI never sees personal values: it writes
// wording with placeholders and locked blocks only, and these rules accept or refuse the draft. AI is data here, never a
// decision: a refused draft falls back to fixed text (request-template.js or explain.js) and is kept for the founder.
// Rule ids V-* are recorded in app.comms_drafts.failures. The Deno functions use the same file (copied by sync-core).
import { scanInjection } from './injection.js';

export const COMMS_VALIDATOR_VERSION = 1;
export const MAX_WORDING_CHARS = 600;
export const MAX_TOTAL_CHARS = 6000;
export const MAX_STUDENT_WORDING_CHARS = 400;

// ---- University emails ----------------------------------------------------------------------------------------------
export const EMAIL_BLOCKS = Object.freeze(['BANNER', 'AUTHORISATION', 'QUESTIONS', 'ANSWER_FORMAT', 'STOP_FOOTER', 'SIGNATURE']);
const CORE_PLACEHOLDERS = ['CASE_REF', 'INSTITUTION_NAME'];
// Identity kind -> placeholder. Claim detail fields use their upper-case name ({{OFFER_TYPE}}).
export const IDENTITY_PLACEHOLDER = Object.freeze({
  name_on_application: 'APPLICANT_NAME', application_email: 'APPLICATION_EMAIL', application_reference: 'APPLICATION_REFERENCE',
  programme: 'PROGRAMME', intake: 'INTAKE',
});
const DETAIL_FIELDS = Object.freeze({
  application_received: ['application_reference', 'programme', 'intake'],
  admission_granted: ['programme', 'intake', 'offer_type', 'offer_date'],
  scholarship_awarded: ['scholarship_name', 'amount', 'currency'],
  agent_authorized: ['consultant_name', 'company_name', 'city'],
  deposit_instruction_authentic: ['beneficiary_name', 'bank_name', 'account_last4', 'amount', 'currency'],
});
const CLAIM_WORDS = Object.freeze({
  application_received: [/\bapplication (?:received|number|record)/i, /\brecords? of an application\b/i],
  admission_granted: [/\boffers?\b/i, /\badmitted\b/i, /\bunconditional\b/i, /\bconditional\b/i, /\bCAS\b/, /\bCoE\b/],
  scholarship_awarded: [/\bscholarships?\b/i, /\bbursar(?:y|ies)\b/i, /\bfunding\b/i],
  agent_authorized: [/\bagents?\b/i, /\brepresentatives?\b/i, /\bconsultan(?:t|cy|ts)\b/i, /\brecruiters?\b/i],
  deposit_instruction_authentic: [/\bdeposits?\b/i, /\bpayments?\b/i, /\bbank\b/i, /\bbeneficiary\b/i, /\bfees?\b/i, /\binvoices?\b/i],
});
const PROMISE = /\b(?:guarantee[ds]?|promise[ds]?|will be admitted|approved|verified)\b|confirm on our behalf/i;
const ACCUSE = /\b(?:fraud|fraudster|fraudulent|scam|scammer|fake|cheat|cheater|criminal|thief|liar|dhoka|dhokebaz|fraudia|chor)\b/i;
const URGENCY = /\b(?:urgent|urgently|immediately|asap|right now|act now|hurry|at once|without delay)\b/i;
const URL_LIKE = /:\/\/|\bwww\.|(?:^|[^a-z0-9])[a-z0-9-]{2,63}\.(?:com|net|org|info|biz|xyz|top|ru|cn|click|link|edu|io|co|me|app|site|online|pk|uk|us|in)\b/i;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+/;
const HEADER_LINE = /^\s*(?:to|cc|bcc|from|subject|reply-to|sender|return-path|date|received|message-id|in-reply-to|references|mime-version|x-[\w-]+|content-[\w-]+)\s*:/im;
const LATIN_ONLY = /^[\n\x20-\x7eÀ-ÖØ-öø-ſ]*$/;
const TOKEN = /\{\{([^{}]*)\}\}/g;

const parseDraft = (draft) => {
  let d = draft;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return null; } }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const keys = Object.keys(d).sort();
  if (keys.length !== 2 || keys[0] !== 'body_template' || keys[1] !== 'injection_suspected') return null;
  if (typeof d.body_template !== 'string' || typeof d.injection_suspected !== 'boolean') return null;
  return d;
};

/** Text with every {{...}} token removed (the AI's own wording). */
export const wordingOutsideTokens = (t) => String(t).replace(TOKEN, '');

/** Placeholder names the drafter may use for this request (without the braces). */
export function allowedPlaceholders({ purpose, claims = [], allowedFields = [] }) {
  const out = new Set(CORE_PLACEHOLDERS);
  for (const b of EMAIL_BLOCKS) out.add(`BLOCK:${b}`);
  if (purpose === 'university_reminder') out.add('BLOCK:REMINDER');
  for (const f of allowedFields) if (IDENTITY_PLACEHOLDER[f]) out.add(IDENTITY_PLACEHOLDER[f]);
  for (const c of claims) for (const f of DETAIL_FIELDS[c] || []) out.add(f.toUpperCase());
  return out;
}

const KNOWN_FIELD_PLACEHOLDERS = new Set([...Object.values(IDENTITY_PLACEHOLDER), ...Object.values(DETAIL_FIELDS).flat().map((f) => f.toUpperCase())]);

/**
 * validateEmailDraft(draft, { purpose, claims, allowedFields }) -> { ok, failures: ['V-...'], version }
 * Never throws. `draft` may be the model's raw JSON string.
 */
export function validateEmailDraft(draft, ctx = {}) {
  const failures = new Set();
  try {
    const d = parseDraft(draft);
    if (!d) return { ok: false, failures: ['V-JSON'], version: COMMS_VALIDATOR_VERSION };
    const t = d.body_template;
    const claims = Array.isArray(ctx.claims) ? ctx.claims : [];
    const allowed = allowedPlaceholders({ purpose: ctx.purpose, claims, allowedFields: Array.isArray(ctx.allowedFields) ? ctx.allowedFields : [] });
    const tokens = [...t.matchAll(TOKEN)].map((m) => m[1]);
    for (const tok of tokens) {
      if (allowed.has(tok)) continue;
      if (KNOWN_FIELD_PLACEHOLDERS.has(tok)) failures.add('V-FIELDS'); else failures.add('V-PLACEHOLDERS');
    }
    if (/\{\{|\}\}/.test(t.replace(TOKEN, ''))) failures.add('V-PLACEHOLDERS');
    // blocks: each exactly once, banner first, signature last, questions before the answer format
    const needed = ctx.purpose === 'university_reminder' ? [...EMAIL_BLOCKS, 'REMINDER'] : [...EMAIL_BLOCKS];
    for (const b of needed) if (tokens.filter((x) => x === `BLOCK:${b}`).length !== 1) failures.add('V-BLOCKS');
    const nonEmpty = t.split('\n').map((l) => l.trim()).filter(Boolean);
    if (nonEmpty[0] !== '{{BLOCK:BANNER}}' || nonEmpty[nonEmpty.length - 1] !== '{{BLOCK:SIGNATURE}}') failures.add('V-BLOCKS');
    if (t.indexOf('{{BLOCK:QUESTIONS}}') > t.indexOf('{{BLOCK:ANSWER_FORMAT}}')) failures.add('V-BLOCKS');
    const words = wordingOutsideTokens(t);
    // claims not consented
    for (const c of Object.keys(CLAIM_WORDS)) {
      if (claims.includes(c)) continue;
      if (CLAIM_WORDS[c].some((re) => re.test(words))) failures.add('V-CLAIMS');
    }
    if (URL_LIKE.test(words)) failures.add('V-LINK');
    if (EMAIL_LIKE.test(words) || /\d{5,}/.test(words)) failures.add('V-CONTACT');
    if (PROMISE.test(words)) failures.add('V-PROMISE');
    if (ACCUSE.test(words)) failures.add('V-ACCUSE');
    if (HEADER_LINE.test(t) || /\r/.test(t)) failures.add('V-HEADER');
    if (words.length > MAX_WORDING_CHARS || t.length > MAX_TOTAL_CHARS) failures.add('V-LEN');
    if (!LATIN_ONLY.test(t)) failures.add('V-LANG');
    if (/[–—]|!/.test(t) || URGENCY.test(words)) failures.add('V-STYLE');
    if (d.injection_suspected || scanInjection({ text: words }).suspicious) failures.add('V-INJECTION');
  } catch {
    failures.add('V-JSON');
  }
  return { ok: failures.size === 0, failures: [...failures].sort(), version: COMMS_VALIDATOR_VERSION };
}

// ---- Student messages -----------------------------------------------------------------------------------------------
export const STUDENT_BLOCKS = Object.freeze(['STATUS', 'NEXT_STEP', 'HELP']);
export const STUDENT_KINDS = Object.freeze(['request_progress', 'action_needed', 'result_positive', 'result_negative', 'result_inconclusive', 'request_stopped', 'delay', 'safeguarding']);
const STATUS_WORDS = /\b(?:verified|confirmed|genuine|real|fake|fraud|scam|approved|rejected|accepted|admitted|safe|guaranteed|visa)\b/i;
export const SOFTENING_PHRASES = Object.freeze(['do not worry', "don't worry", 'nothing to worry about', 'probably', 'likely', 'should be fine', 'good news', 'congratulations',
  'no need to worry', 'not a big deal', 'just a formality', 'it will be fine', 'nothing serious', 'minor issue', 'small problem', 'looks fine', 'all good', 'rest assured', 'no cause for concern', 'almost certainly']);
const SOFTEN = new RegExp(`(?:${SOFTENING_PHRASES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i');
const POSITIVE_WORDS = /\b(?:great news|good news|congratulations|well done|success(?:ful)?|pleased|happy to|excellent|wonderful|delighted|all good|looks good)\b/i;
const NEGATIVE_WORDS = /\b(?:unfortunately|bad news|sorry to|failed|problem|wrong|rejected|denied|not genuine)\b/i;
const POSITIVE_STATUSES = new Set(['INSTITUTION_CONFIRMED', 'OFFICIAL_PORTAL_REVIEWED']);
const NEGATIVE_STATUSES = new Set(['INSTITUTION_CONTRADICTED', 'INSTITUTION_DECLINED']);

const sentencesOf = (t) => t.split(/[.?]+|\n+/).map((s) => s.trim()).filter(Boolean);

/**
 * validateStudentMessage(draft, { kind, status, language }) -> { ok, failures, version }
 * `status` is the published status the status block describes (PENDING for progress and delay messages).
 * Urdu, safeguarding and every message about a request stopped by a person use fixed text only: an AI draft for them is refused.
 */
export function validateStudentMessage(draft, ctx = {}) {
  const failures = new Set();
  try {
    const d = parseDraft(draft);
    if (!d) return { ok: false, failures: ['V-JSON'], version: COMMS_VALIDATOR_VERSION };
    const t = d.body_template;
    if (ctx.language !== 'en') failures.add('V-FIXED-ONLY');
    if (ctx.kind === 'safeguarding') failures.add('V-FIXED-ONLY');
    const tokens = [...t.matchAll(TOKEN)].map((m) => m[1]);
    for (const tok of tokens) if (!STUDENT_BLOCKS.map((b) => `BLOCK:${b}`).includes(tok)) failures.add('V-PLACEHOLDERS');
    if (/\{\{|\}\}/.test(t.replace(TOKEN, ''))) failures.add('V-PLACEHOLDERS');
    for (const b of STUDENT_BLOCKS) if (tokens.filter((x) => x === `BLOCK:${b}`).length !== 1) failures.add('V-STATUS');
    const words = wordingOutsideTokens(t);
    if (STATUS_WORDS.test(words)) failures.add('V-STATUS-WORDS');
    const softenOk = ctx.kind === 'result_positive' && /good news/i.test(words) && !SOFTEN_WITHOUT_GOOD_NEWS(words);
    if (SOFTEN.test(words) && !softenOk) failures.add('V-SOFTEN');
    const status = String(ctx.status || 'PENDING');
    if (POSITIVE_WORDS.test(words) && !POSITIVE_STATUSES.has(status) && !softenOk) failures.add('V-CONTRADICT');
    if (NEGATIVE_WORDS.test(words) && POSITIVE_STATUSES.has(status)) failures.add('V-CONTRADICT');
    if (POSITIVE_WORDS.test(words) && NEGATIVE_STATUSES.has(status)) failures.add('V-CONTRADICT');
    const sents = sentencesOf(words);
    if (sents.some((s) => s.split(/\s+/).length > 20) || sents.length > 3) failures.add('V-READ');
    if (URL_LIKE.test(words)) failures.add('V-LINK');
    if (EMAIL_LIKE.test(words) || /\d{5,}/.test(words)) failures.add('V-CONTACT');
    if (/[–—]|!/.test(t) || URGENCY.test(words)) failures.add('V-STYLE');
    if (!LATIN_ONLY.test(t)) failures.add('V-LANG');
    if (words.length > MAX_STUDENT_WORDING_CHARS) failures.add('V-LEN');
    if (d.injection_suspected || scanInjection({ text: words }).suspicious) failures.add('V-INJECTION');
  } catch {
    failures.add('V-JSON');
  }
  return { ok: failures.size === 0, failures: [...failures].sort(), version: COMMS_VALIDATOR_VERSION };
}
const SOFTEN_WITHOUT_GOOD_NEWS = (w) => SOFTEN.test(w.replace(/good news/gi, ''));

/** Fill `{{BLOCK:...}}` tokens of a validated student draft with the locked texts; anything unknown stays out. */
export function fillBlocks(template, blocks) {
  return String(template).replace(TOKEN, (m, name) => (name.startsWith('BLOCK:') && Object.prototype.hasOwnProperty.call(blocks, name.slice(6)) ? blocks[name.slice(6)] : ''));
}
