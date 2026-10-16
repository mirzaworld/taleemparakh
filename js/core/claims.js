// Claim vocabulary: founder names <-> database enum, fixed question numbers, detail fields and the
// student-facing labels for every published status (BUILD-SPEC 4.2, 4.6, 4.12). Pure data and helpers.
import { stripFormat } from './normalize.js';

// Urdu strings are drafts until a native-speaking counsellor has reviewed them (docs/plan/GATES.md).

export const FOUNDER_TO_ENUM = Object.freeze({
  application_received: 'application_received',
  offer_issued: 'admission_granted',
  scholarship: 'scholarship_awarded',
  consultant_authority: 'agent_authorized',
  payment_details: 'deposit_instruction_authentic',
});

export const ENUM_TO_FOUNDER = Object.freeze({
  application_received: 'application_received',
  admission_granted: 'offer_issued',
  scholarship_awarded: 'scholarship',
  agent_authorized: 'consultant_authority',
  deposit_instruction_authentic: 'payment_details',
});

/** Claims offered to students in v1. `application_submitted` is reserved for the Common App advisor route. */
export const OFFERED_CLAIMS = Object.freeze(Object.values(FOUNDER_TO_ENUM));
export const RESERVED_CLAIMS = Object.freeze(['application_submitted']);

/** Fixed question numbers: a missing question is never renumbered. */
export const QUESTION_NUMBER = Object.freeze({
  application_received: 1,
  admission_granted: 2,
  scholarship_awarded: 3,
  agent_authorized: 4,
  deposit_instruction_authentic: 5,
});
export const CLAIM_BY_QUESTION = Object.freeze({ 1: 'application_received', 2: 'admission_granted', 3: 'scholarship_awarded', 4: 'agent_authorized', 5: 'deposit_instruction_authentic' });

/** Claims the classifier may be asked about (the five offered claims). */
export const CLAIM_TYPES_ASKED = Object.freeze(Object.keys(QUESTION_NUMBER));

export const MAX_DETAIL_LENGTH = 200;

/** Detail fields the student enters per claim. Bank account: last 4 digits only, never the full number. */
export const CLAIM_DETAIL_FIELDS = Object.freeze({
  application_received: ['application_reference', 'programme', 'intake'],
  admission_granted: ['programme', 'intake', 'offer_type', 'offer_date'],
  scholarship_awarded: ['scholarship_name', 'amount', 'currency'],
  agent_authorized: ['consultant_name', 'company_name', 'city'],
  deposit_instruction_authentic: ['beneficiary_name', 'bank_name', 'account_last4', 'amount', 'currency'],
});

export const QUESTION_TEXT = Object.freeze({
  application_received: 'Is an application with these details recorded?',
  admission_granted: 'Does the described offer match a decision you issued?',
  scholarship_awarded: 'Was this scholarship awarded as described?',
  agent_authorized: 'Is this person or company your authorised representative?',
  deposit_instruction_authentic: 'Are these your official payment details for this applicant?',
});

export function claimToFounder(enumValue) { return ENUM_TO_FOUNDER[enumValue] || null; }
export function founderToClaim(name) { return Object.prototype.hasOwnProperty.call(FOUNDER_TO_ENUM, name) ? FOUNDER_TO_ENUM[name] : null; }

/** Validate and clean student-entered details. Never throws; returns { ok, details, errors }. */
export function cleanClaimDetails(claim, input) {
  const fields = CLAIM_DETAIL_FIELDS[claim];
  if (!fields) return { ok: false, details: {}, errors: ['unknown_claim'] };
  const src = input && typeof input === 'object' ? input : {};
  const details = {};
  const errors = [];
  for (const f of fields) {
    // Control characters (including CR and LF) would let a value inject extra lines into an email.
    let v = typeof src[f] === 'string' ? stripFormat(src[f]).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
    if (v.length > MAX_DETAIL_LENGTH) { errors.push(`${f}:too_long`); v = v.slice(0, MAX_DETAIL_LENGTH); }
    if (f === 'account_last4') {
      if (v && !/^\d{4}$/.test(v)) { errors.push('account_last4:must_be_4_digits'); v = ''; }
    }
    if (v) details[f] = v;
  }
  return { ok: errors.length === 0, details, errors };
}

/** Published statuses a student can ever see (SUSPECTED_FRAUD_REVIEW and MANUAL_SECURITY_REVIEW are never published). */
export const PUBLISHED_STATUSES = Object.freeze([
  'INSTITUTION_CONFIRMED', 'INSTITUTION_CONTRADICTED', 'INSTITUTION_DECLINED', 'PENDING', 'INCONCLUSIVE',
  'DOCUMENT_ONLY_UNVERIFIED', 'OFFICIAL_PORTAL_REVIEWED', 'BLOCK_EXTERNAL_VERIFICATION',
]);

// resultClass maps to the existing CSS classes. `reply_received` splits PENDING in two.
export const STATUS_LABELS = Object.freeze({
  INSTITUTION_CONFIRMED: { en: 'Verified: the university confirmed this exact claim', ur: 'تصدیق شدہ: یونیورسٹی نے اسی دعوے کی تصدیق کی', resultClass: 'ok' },
  INSTITUTION_CONTRADICTED: { en: "Contradicted: the university's answer does not match this claim", ur: 'تضاد: یونیورسٹی کا جواب اس دعوے سے نہیں ملتا', resultClass: 'danger' },
  INSTITUTION_DECLINED: { en: 'University declined to confirm. This is not proof either way', ur: 'یونیورسٹی نے تصدیق سے انکار کیا۔ یہ کسی بھی طرف ثبوت نہیں', resultClass: 'unknown' },
  PENDING: { en: 'Awaiting university', ur: 'یونیورسٹی کے جواب کا انتظار', resultClass: 'unknown' },
  PENDING_REPLY_RECEIVED: { en: 'Reply received, a person is checking it', ur: 'جواب مل گیا ہے، ایک شخص اسے دیکھ رہا ہے', resultClass: 'unknown' },
  INCONCLUSIVE: { en: 'Inconclusive: the answer was unclear, or there was no reply in time', ur: 'نتیجہ واضح نہیں: جواب غیر واضح تھا، یا وقت پر جواب نہیں آیا', resultClass: 'caution' },
  DOCUMENT_ONLY_UNVERIFIED: { en: 'Not verified: we only have a document', ur: 'تصدیق نہیں ہوئی: ہمارے پاس صرف ایک دستاویز ہے', resultClass: 'caution' },
  OFFICIAL_PORTAL_REVIEWED: { en: 'Seen on the official applicant portal by a reviewer (not a university confirmation)', ur: 'ایک جائزہ کار نے سرکاری درخواست گزار پورٹل پر دیکھا (یہ یونیورسٹی کی تصدیق نہیں)', resultClass: 'callout-info' },
  BLOCK_EXTERNAL_VERIFICATION: { en: 'Not started: we need your permission first', ur: 'شروع نہیں ہوا: پہلے ہمیں آپ کی اجازت درکار ہے', resultClass: 'unknown' },
});

export const CLAIM_LABELS = Object.freeze({
  application_received: { en: 'Application received', ur: 'درخواست موصول ہوئی' },
  admission_granted: { en: 'Offer issued', ur: 'پیشکش جاری ہوئی' },
  scholarship_awarded: { en: 'Scholarship', ur: 'اسکالرشپ' },
  agent_authorized: { en: 'Consultant authority', ur: 'کنسلٹنٹ کا اختیار' },
  deposit_instruction_authentic: { en: 'Payment details', ur: 'ادائیگی کی تفصیلات' },
  application_submitted: { en: 'Application submitted', ur: 'درخواست جمع کرائی گئی' },
});

/** Label key for a published status; unknown or unpublished values fall back to the safe PENDING label. */
export function statusLabel(status, { replyReceived = false, lang = 'en' } = {}) {
  const key = status === 'PENDING' && replyReceived ? 'PENDING_REPLY_RECEIVED' : status;
  const entry = STATUS_LABELS[key] || STATUS_LABELS.PENDING;
  return { key: STATUS_LABELS[key] ? key : 'PENDING', text: entry[lang === 'ur' ? 'ur' : 'en'], resultClass: entry.resultClass };
}
