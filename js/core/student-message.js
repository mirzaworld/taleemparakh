// Student messages in the portal (addendum R10.1). Pure. The status sentence and the next step sentence come from rules
// (explain.js), never from AI. An AI draft may only add a greeting and up to 2 short sentences around the locked blocks, and only
// if comms-validator.js accepts it; otherwise the fixed text is used. Urdu, safeguarding and "request stopped" use fixed text only
// until a native-speaking counsellor has audited AI wording (FD-R10-2). The email to the student stays content free (BS 4.15).
import { explainClaim } from './explain.js';
import { validateStudentMessage, fillBlocks, STUDENT_KINDS } from './comms-validator.js';

const HELP = { en: 'If you want to talk to a person, open Help in the app.', ur: 'اگر آپ کسی فرد سے بات کرنا چاہتے ہیں تو ایپ میں مدد کھولیں۔' };
const HELLO = { en: 'Hello,', ur: 'سلام،' };
const BY_KIND = {
  request_progress: { status: { en: 'We are working on your request.', ur: 'ہم آپ کی درخواست پر کام کر رہے ہیں۔' }, next: { en: 'You do not need to do anything. We will tell you when there is an update.', ur: 'آپ کو کچھ کرنے کی ضرورت نہیں۔ نئی اطلاع پر ہم آپ کو بتائیں گے۔' } },
  action_needed: { status: { en: 'We need something from you.', ur: 'ہمیں آپ سے کچھ چاہیے۔' }, next: { en: 'Open your request and follow the step shown there.', ur: 'اپنی درخواست کھولیں اور وہاں دکھایا گیا قدم اٹھائیں۔' } },
  delay: { status: { en: 'Your request is taking longer than we hoped.', ur: 'آپ کی درخواست میں ہماری امید سے زیادہ وقت لگ رہا ہے۔' }, next: { en: "You do not need to do anything. You can also check through the university's own website.", ur: 'آپ کو کچھ کرنے کی ضرورت نہیں۔ آپ یونیورسٹی کی اپنی ویب سائٹ سے بھی جانچ سکتے ہیں۔' } },
  request_stopped: { status: { en: 'We stopped your request.', ur: 'ہم نے آپ کی درخواست روک دی ہے۔' }, next: { en: 'Open your request to see why and what you can do next.', ur: 'وجہ اور اگلا قدم جاننے کے لیے اپنی درخواست کھولیں۔' } },
};
const SAFEGUARDING = {
  en: 'Hello,\n\nWe have your request for help. A person will look at it.\n\nIf you are in danger or feel unsafe, contact your local emergency service now.\n\nYou can also open Help in the app to talk to a person.',
  ur: 'سلام،\n\nہمیں آپ کی مدد کی درخواست مل گئی ہے۔ ایک فرد اسے دیکھے گا۔\n\nاگر آپ خطرے میں ہیں یا خود کو غیر محفوظ محسوس کرتے ہیں تو ابھی اپنی مقامی ہنگامی سروس سے رابطہ کریں۔\n\nآپ ایپ میں مدد کھول کر کسی فرد سے بات بھی کر سکتے ہیں۔',
};
const RESULT_KINDS = new Set(['result_positive', 'result_negative', 'result_inconclusive']);

/** The locked blocks for a message: { STATUS, NEXT_STEP, HELP }. Safeguarding has no blocks (whole text is fixed). */
export function studentMessageBlocks({ kind, status = 'PENDING', trace = [], claimType = null, replyReceived = false, lang = 'en', pendingDays = 30 } = {}) {
  const l = lang === 'ur' ? 'ur' : 'en';
  if (RESULT_KINDS.has(kind)) {
    const e = explainClaim({ status, trace, claimType, replyReceived, lang: l, pendingDays });
    return { STATUS: e.meaning, NEXT_STEP: e.steps[0] || '', HELP: HELP[l] };
  }
  const k = BY_KIND[kind];
  if (!k) return null;
  return { STATUS: k.status[l], NEXT_STEP: k.next[l], HELP: HELP[l] };
}

/** The fixed message (no AI). Unknown kinds give null. */
export function fixedStudentMessage(args) {
  const l = args && args.lang === 'ur' ? 'ur' : 'en';
  if (args && args.kind === 'safeguarding') return SAFEGUARDING[l];
  const b = studentMessageBlocks(args);
  return b ? `${HELLO[l]}\n\n${b.STATUS}\n\n${b.NEXT_STEP}\n\n${b.HELP}` : null;
}

/** Message kinds whose wording may be AI at all (everything else is fixed). */
export const AI_WORDING_KINDS = Object.freeze(['request_progress', 'action_needed', 'delay', 'result_positive', 'result_inconclusive', 'result_negative']);

/**
 * buildStudentMessage({ kind, status, trace, claimType, replyReceived, lang, pendingDays, draft })
 *   -> { ok, text, source: 'ai' | 'fixed', failures: [] }
 * `draft` is the model's `{ body_template, injection_suspected }` (object or JSON string), or undefined (AI off). A draft that
 * fails any rule is dropped and the failures are returned so the caller can record them; the fixed text is used instead.
 */
export function buildStudentMessage(args) {
  const a = args && typeof args === 'object' ? args : {};
  if (!STUDENT_KINDS.includes(a.kind)) return { ok: false, text: '', source: 'fixed', failures: ['bad_kind'] };
  const fixed = fixedStudentMessage(a);
  if (fixed === null) return { ok: false, text: '', source: 'fixed', failures: ['bad_kind'] };
  if (a.draft === undefined || a.draft === null || !AI_WORDING_KINDS.includes(a.kind) || (a.lang && a.lang !== 'en')) return { ok: true, text: fixed, source: 'fixed', failures: [] };
  const v = validateStudentMessage(a.draft, { kind: a.kind, status: a.status, language: 'en' });
  if (!v.ok) return { ok: true, text: fixed, source: 'fixed', failures: v.failures };
  const d = typeof a.draft === 'string' ? JSON.parse(a.draft) : a.draft;
  const text = fillBlocks(d.body_template, studentMessageBlocks(a)).replace(/\n{3,}/g, '\n\n').trim();
  return { ok: true, text, source: 'ai', failures: [] };
}
