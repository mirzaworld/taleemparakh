// Builds the plain-text verification email (BUILD-SPEC 4.6). Pure: values in, text out. Nothing is sent here.
// Only consented claims and allowed fields appear. Question numbers are fixed per claim (a missing question is never
// renumbered). Student-entered values are untrusted: control characters, line breaks, links and our own marker line
// are stripped so a value can never add a header, a second recipient, a link or fake template structure.
// No full account number is ever accepted: only "account ending <last4>".
import { stripFormat } from './normalize.js';
import { QUESTION_NUMBER, CLAIM_DETAIL_FIELDS, MAX_DETAIL_LENGTH } from './claims.js';

export const TEMPLATE_ID = 'verify';
export const REMINDER_TEMPLATE_ID = 'reminder';
export const TEMPLATE_VERSION = 1;
export const ENVIRONMENTS = Object.freeze(['simulation', 'controlled', 'live']);
export const ALLOWED_FIELDS = Object.freeze(['name_on_application', 'application_email', 'application_reference', 'programme', 'intake']);

const BANNER = {
  simulation: 'THIS IS A SIMULATION. It comes from the TaleemParakh test system and is not a real request. Please do not act on it.',
  controlled: 'THIS IS A CONTROLLED TEST between project-owned mailboxes. It is not a real request. Please do not act on it.',
  live: '',
};
const SUBJECT_PREFIX = { simulation: '[SIMULATION] ', controlled: '[CONTROLLED TEST] ', live: '' };
const CASE_REF = /^TP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const MARKER_RE = /-{2,}\s*taleemparakh request/gi;

/** Clean one untrusted value. Returns '' if nothing safe remains. */
export function cleanValue(v, max = MAX_DETAIL_LENGTH) {
  if (typeof v !== 'string' && typeof v !== 'number') return '';
  let s = stripFormat(String(v).slice(0, 2000)).normalize('NFKC').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(MARKER_RE, ' ').replace(/^[-=_*>#|]+\s*/, '');
  if (/(?:https?|ftp|file|data|javascript):|\bwww\.|:\/\/|[a-z0-9-]{1,63}\.(?:com|net|org|info|biz|xyz|top|ru|cn|click|link)\b/i.test(s)) return '';
  if (/@/.test(s)) return '';
  return s.slice(0, max);
}

const cleanEmail = (v) => { const s = typeof v === 'string' ? stripFormat(v).trim().toLowerCase() : ''; return /^[a-z0-9._%+'-]{1,64}@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(s) && s.length <= 254 ? s : ''; };
const cleanUrl = (v, live) => { const s = typeof v === 'string' ? v.trim() : ''; return (live ? /^https:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]{4,500}$/ : /^https?:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]{4,500}$/).test(s) ? s : ''; };
const cleanDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : '');

const join = (...parts) => parts.filter(Boolean).join(', ');

function questionLine(claim, d) {
  const n = QUESTION_NUMBER[claim];
  switch (claim) {
    case 'application_received': return `Q${n} Application received: `;
    case 'admission_granted': { const i = join(d.offer_type, d.offer_date); return `Q${n} Offer issued as described${i ? ` (${i})` : ''}: `; }
    case 'scholarship_awarded': { const i = join(d.scholarship_name, join(d.amount, d.currency).replace(', ', ' ')); return `Q${n} Scholarship as described${i ? ` (${i})` : ''}: `; }
    case 'agent_authorized': return `Q${n} ${d.consultant_name || 'The named consultant'}${d.company_name ? ` of ${d.company_name}` : ''} is your authorised representative: `;
    case 'deposit_instruction_authentic': {
      const parts = [d.beneficiary_name && `beneficiary ${d.beneficiary_name}`, d.bank_name, d.account_last4 && `account ending ${d.account_last4}`, join(d.amount, d.currency).replace(', ', ' ')];
      const i = join(...parts);
      return `Q${n} Payment details are yours${i ? ` (${i})` : ''}: `;
    }
    default: return '';
  }
}

/**
 * buildRequest({ environment, kind, caseRef, consentViewUrl, claims, details, allowedFields, identities, signature,
 *                reminderOfDate, templateVersion })
 *   claims: consented claim_type values; details: { [claim]: { field: value } }; identities: { name_on_application, application_email }
 *   signature (live): { name, registrationNumber, address, policyUrl }
 * -> { ok, error?, subject, text, templateId, templateVersion, questions[], includedFields[], omitted[] }
 * Never throws. `ok: false` means "do not send". The environment is never defaulted: an unknown one is an error.
 */
export function buildRequest(input) {
  const fail = (error) => ({ ok: false, error, subject: '', text: '', templateId: '', templateVersion: 0, questions: [], includedFields: [], omitted: [], pieces: null });
  try {
    const o = input && typeof input === 'object' ? input : {};
    const env = o.environment;
    if (!ENVIRONMENTS.includes(env)) return fail('unknown_environment');
    const live = env === 'live';
    const caseRef = typeof o.caseRef === 'string' ? o.caseRef.trim().toUpperCase() : '';
    if (!CASE_REF.test(caseRef)) return fail('bad_case_ref');
    const url = cleanUrl(o.consentViewUrl, live);
    if (!url) return fail('bad_consent_url');
    const kind = o.kind === 'reminder' ? 'reminder' : 'initial';
    const reminderDate = kind === 'reminder' ? cleanDate(o.reminderOfDate) : '';
    if (kind === 'reminder' && !reminderDate) return fail('bad_reminder_date');
    const claims = [...new Set((Array.isArray(o.claims) ? o.claims : []).filter((c) => Object.prototype.hasOwnProperty.call(QUESTION_NUMBER, c)))].sort((a, b) => QUESTION_NUMBER[a] - QUESTION_NUMBER[b]);
    if (!claims.length) return fail('no_consented_claims');
    const allowed = new Set((Array.isArray(o.allowedFields) ? o.allowedFields : []).filter((f) => ALLOWED_FIELDS.includes(f)));
    const ids = o.identities && typeof o.identities === 'object' ? o.identities : {};
    const det = o.details && typeof o.details === 'object' ? o.details : {};

    const omitted = [];
    const clean = {};
    for (const c of claims) {
      clean[c] = {};
      const src = det[c] && typeof det[c] === 'object' ? det[c] : {};
      for (const f of CLAIM_DETAIL_FIELDS[c]) {
        if (!(f in src)) continue;
        if (f === 'account_last4') {
          const s = String(src[f] ?? '').trim();
          if (/^\d{4}$/.test(s)) clean[c][f] = s; else omitted.push(`${c}.${f}`);
          continue;
        }
        const v = cleanValue(src[f]);
        if (v) clean[c][f] = v; else if (src[f] !== undefined && src[f] !== '') omitted.push(`${c}.${f}`);
      }
    }
    // programme and intake come from whichever consented claim carries them
    const pick = (f) => { for (const c of claims) if (clean[c][f]) return clean[c][f]; return ''; };
    const header = [];
    const included = [];
    const name = allowed.has('name_on_application') ? cleanValue(ids.name_on_application, 120) : '';
    const email = allowed.has('application_email') ? cleanEmail(ids.application_email) : '';
    const ref = allowed.has('application_reference') ? cleanValue(ids.application_reference || pick('application_reference'), 80) : '';
    const programme = allowed.has('programme') ? pick('programme') : '';
    const intake = allowed.has('intake') ? pick('intake') : '';
    if (name) { header.push(`Applicant name (as on the application): ${name}`); included.push('name_on_application'); } else if (allowed.has('name_on_application')) omitted.push('identity.name_on_application');
    if (email) { header.push(`Email used to apply: ${email}`); included.push('application_email'); } else if (allowed.has('application_email')) omitted.push('identity.application_email');
    if (ref) { header.push(`Application reference: ${ref}`); included.push('application_reference'); }
    if (programme || intake) { header.push(`Programme and intake: ${join(programme, intake)}`); if (programme) included.push('programme'); if (intake) included.push('intake'); }
    header.push(`Our case reference: ${caseRef}`);

    let signature;
    if (live) {
      const s = o.signature && typeof o.signature === 'object' ? o.signature : {};
      const sig = { name: cleanValue(s.name, 160), registrationNumber: cleanValue(s.registrationNumber, 80), address: cleanValue(s.address, 240), policyUrl: cleanUrl(s.policyUrl, true) };
      if (!sig.name || !sig.registrationNumber || !sig.address || !sig.policyUrl) return fail('live_signature_incomplete');
      signature = `${sig.name}\nRegistration number: ${sig.registrationNumber}\n${sig.address}\nOur public verification policy: ${sig.policyUrl}`;
    } else signature = env === 'simulation' ? 'TaleemParakh test system, not a real request' : 'TaleemParakh controlled test, not a real request';

    const authorisation = ['The applicant authorised this request. You can see their authorisation here:', url, '(this page shows the consent text, the claims, the date and the expiry, nothing else)'];
    const reminderLine = kind === 'reminder' ? `This is a reminder of our request of ${reminderDate}. If you have already replied, thank you.` : '';
    const questionLines = claims.map((c) => questionLine(c, clean[c]));
    const marker = `--- TaleemParakh request ${caseRef} (please reply above this line) ---`;
    const lines = [];
    if (BANNER[env]) lines.push(BANNER[env], '');
    if (kind === 'reminder') lines.push(`This is a reminder of our request of ${reminderDate}. If you have already replied, thank you.`, '');
    lines.push('Dear Admissions team,', '');
    lines.push('An applicant has asked TaleemParakh, an independent student-protection service, to check some facts', 'with you. The applicant authorised this request. You can see their authorisation here:', url, '(this page shows the consent text, the claims, the date and the expiry, nothing else)', '');
    lines.push(...header, '');
    lines.push('Please answer each question with YES, NO or CANNOT SAY. You can write in your own words if you prefer.');
    for (const c of claims) lines.push(questionLine(c, clean[c]));
    lines.push('', 'If you cannot share this with us, please write DECLINE, and tell us the official way the applicant can', 'check for themselves.', '');
    lines.push("We will not treat a refusal or no reply as evidence that the applicant's claim is false.", 'We will never ask for passwords, codes or more personal data.', '', signature, `--- TaleemParakh request ${caseRef} (please reply above this line) ---`);

    return {
      ok: true,
      subject: `${SUBJECT_PREFIX[env]}Applicant-authorised verification request ${caseRef}`,
      text: lines.join('\n'),
      templateId: kind === 'reminder' ? REMINDER_TEMPLATE_ID : TEMPLATE_ID,
      templateVersion: Number.isInteger(o.templateVersion) && o.templateVersion > 0 ? o.templateVersion : TEMPLATE_VERSION,
      questions: claims.map((c) => QUESTION_NUMBER[c]),
      includedFields: included,
      omitted,
      // Locked pieces for AI wording (renderDraft): every value in them already passed cleanValue above.
      pieces: { banner: BANNER[env], reminderLine, authorisation: authorisation.join('\n'), details: header, questionLines, signature, marker, caseRef, clean, identity: { name, email, ref, programme, intake } },
    };
  } catch {
    return fail('builder_error');
  }
}

// ---- AI wording (R10.1) ---------------------------------------------------------------------------------------------
export const AI_TEMPLATE_ID = 'verify-ai';
export const AI_REMINDER_TEMPLATE_ID = 'reminder-ai';
const DETAIL_PLACEHOLDER_FIELDS = [...new Set(Object.values(CLAIM_DETAIL_FIELDS).flat())];

/** The standard wording as a body template (what the AI is asked to improve). Blocks are filled by renderDraft. */
export function standardBodyTemplate(kind = 'initial') {
  return ['{{BLOCK:BANNER}}', '', ...(kind === 'reminder' ? ['{{BLOCK:REMINDER}}', ''] : []), 'Dear {{INSTITUTION_NAME}} Admissions team,', '',
    'An applicant has asked TaleemParakh, an independent student-protection service, to check some facts with you.', '', '{{BLOCK:AUTHORISATION}}', '',
    '{{BLOCK:QUESTIONS}}', '', '{{BLOCK:ANSWER_FORMAT}}', '', '{{BLOCK:STOP_FOOTER}}', '', '{{BLOCK:SIGNATURE}}'].join('\n');
}

/**
 * renderDraft(input, bodyTemplate) -> same shape as buildRequest (templateId verify-ai). `input` is the buildRequest input
 * plus `institutionName`. Placeholders and blocks are replaced from values buildRequest already cleaned; an unknown
 * placeholder or a leftover brace makes the render fail (the caller then uses the fixed template). Nothing is sent here.
 */
export function renderDraft(input, bodyTemplate) {
  const base = buildRequest(input);
  if (!base.ok) return base;
  const fail = (error) => ({ ...base, ok: false, error, text: '' });
  if (typeof bodyTemplate !== 'string') return fail('bad_template');
  const p = base.pieces;
  const inst = cleanValue(input && input.institutionName, 160) || 'the';
  const vals = { CASE_REF: p.caseRef, INSTITUTION_NAME: inst, APPLICANT_NAME: p.identity.name, APPLICATION_EMAIL: p.identity.email,
    APPLICATION_REFERENCE: p.identity.ref, PROGRAMME: p.identity.programme, INTAKE: p.identity.intake };
  for (const f of DETAIL_PLACEHOLDER_FIELDS) {
    const key = f.toUpperCase();
    if (vals[key] !== undefined) continue;
    for (const c of Object.keys(p.clean)) if (p.clean[c][f]) { vals[key] = p.clean[c][f]; break; }
  }
  const blocks = {
    BANNER: p.banner, REMINDER: p.reminderLine, AUTHORISATION: p.authorisation,
    QUESTIONS: [...p.details, '', ...p.questionLines].join('\n'),
    ANSWER_FORMAT: 'Please answer each question above with YES, NO or CANNOT SAY. You can write in your own words if you prefer.\nIf you cannot share this with us, please write DECLINE, and tell us the official way the applicant can check for themselves.',
    STOP_FOOTER: "We will not treat a refusal or no reply as evidence that the applicant's claim is false.\nWe will never ask for passwords, codes or more personal data.",
    SIGNATURE: `${p.signature}\n${p.marker}`,
  };
  let bad = false;
  let text = bodyTemplate.replace(/\{\{([^{}]*)\}\}/g, (m, name) => {
    if (name.startsWith('BLOCK:')) { const b = name.slice(6); if (Object.prototype.hasOwnProperty.call(blocks, b)) return blocks[b]; bad = true; return ''; }
    if (Object.prototype.hasOwnProperty.call(vals, name)) return vals[name] ?? '';
    bad = true; return '';
  });
  if (bad || /\{\{|\}\}/.test(text)) return fail('bad_placeholder');
  // An empty banner (live) leaves its line and the blank line after it: remove them so the email does not start with blank lines.
  text = text.replace(/^\n+/, '');
  return { ...base, text, templateId: input && input.kind === 'reminder' ? AI_REMINDER_TEMPLATE_ID : AI_TEMPLATE_ID };
}

/** Flat map of every value that can reach an email: `identity.<kind>` for allowed identities and `<claim>.<field>` for details. */
export function extractFields(input) {
  const o = input && typeof input === 'object' ? input : {};
  const allowed = new Set(Array.isArray(o.allowedFields) ? o.allowedFields : []);
  const ids = o.identities && typeof o.identities === 'object' ? o.identities : {};
  const det = o.details && typeof o.details === 'object' ? o.details : {};
  const out = {};
  for (const k of ALLOWED_FIELDS) if (allowed.has(k) && ids[k] !== undefined && ids[k] !== null && ids[k] !== '') out[`identity.${k}`] = String(ids[k]);
  for (const c of Array.isArray(o.claims) ? o.claims : []) {
    const src = det[c] && typeof det[c] === 'object' ? det[c] : {};
    for (const f of CLAIM_DETAIL_FIELDS[c] || []) if (src[f] !== undefined && src[f] !== null && src[f] !== '') out[`${c}.${f}`] = String(src[f]);
  }
  return out;
}

/** The inverse of extractFields: a copy of `input` whose identities and details come from `fields`. */
export function applyFields(input, fields) {
  const identities = {}; const details = {};
  for (const [k, v] of Object.entries(fields || {})) {
    const i = k.indexOf('.');
    const scope = k.slice(0, i); const f = k.slice(i + 1);
    if (scope === 'identity') identities[f] = v; else (details[scope] ??= {})[f] = v;
  }
  return { ...input, identities, details };
}
