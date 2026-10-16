// Student-facing explanations for a claim result (BUILD-SPEC 4.12, 4.14, 4.17). Pure: status and trace in, plain text out.
// Rules (AGENTS.md voice): short sentences, calm, never blame the student, a concrete next step in every result,
// no dashes in visible copy, never the word that promises an outcome, and the Contradicted text never says fraud or scam.
// Urdu is a DRAFT until a native-speaking counsellor has reviewed it (docs/plan/GATES.md).
// Text is returned as plain strings; render them with textContent only.
import { STATUS_LABELS, CLAIM_LABELS } from './claims.js';

const T = {
  INSTITUTION_CONFIRMED: {
    meaning: { en: 'The university told us, from its checked email address, that this exact claim is correct. A person at TaleemParakh read the reply before we showed you this.', ur: 'یونیورسٹی نے اپنے جانچے ہوئے ای میل پتے سے ہمیں بتایا کہ یہی دعویٰ درست ہے۔ آپ کو دکھانے سے پہلے تعلیم پرکھ کے ایک فرد نے جواب پڑھا۔' },
    notProof: { en: 'This covers this one claim only. It does not confirm any other claim, such as a scholarship or a payment request. It cannot promise what happens later, for example a visa decision.', ur: 'یہ صرف اسی ایک دعوے کے بارے میں ہے۔ یہ کسی اور دعوے کی تصدیق نہیں کرتا، مثلاً اسکالرشپ یا ادائیگی کی درخواست۔ یہ آئندہ کی کسی بات کا وعدہ نہیں، مثلاً ویزا کا فیصلہ۔' },
    steps: [
      { en: 'Keep the message fingerprint and the evidence on this page.', ur: 'اس صفحے پر موجود پیغام کا فنگر پرنٹ اور ثبوت محفوظ رکھیں۔' },
      { en: 'Before you pay anyone, check the payment details as a separate claim.', ur: 'کسی کو رقم دینے سے پہلے ادائیگی کی تفصیلات کو الگ دعوے کے طور پر جانچیں۔' },
    ],
  },
  INSTITUTION_CONTRADICTED: {
    meaning: { en: "The university's answer does not match this claim. A person at TaleemParakh checked the reply.", ur: 'یونیورسٹی کا جواب اس دعوے سے نہیں ملتا۔ تعلیم پرکھ کے ایک فرد نے جواب کی جانچ کی۔' },
    notProof: { en: 'This does not mean you did anything wrong. It does not say why the answer is different or who is responsible. Mistakes in documents and messages happen.', ur: 'اس کا مطلب یہ نہیں کہ آپ نے کچھ غلط کیا۔ یہ نہیں بتاتا کہ جواب مختلف کیوں ہے یا ذمہ دار کون ہے۔ دستاویزات اور پیغامات میں غلطیاں ہو جاتی ہیں۔' },
    steps: [
      { en: 'Do not pay or sign anything based on this claim.', ur: 'اس دعوے کی بنیاد پر کوئی رقم نہ دیں اور کسی چیز پر دستخط نہ کریں۔' },
      { en: 'You can appeal if you think the answer is wrong. Tell us why.', ur: 'اگر آپ کو لگتا ہے کہ جواب غلط ہے تو اپیل کر سکتے ہیں۔ ہمیں وجہ بتائیں۔' },
      { en: 'Keep your documents and messages. Do not delete anything.', ur: 'اپنی دستاویزات اور پیغامات محفوظ رکھیں۔ کچھ بھی ڈیلیٹ نہ کریں۔' },
      { en: 'You can talk to a person. Use "Request human help".', ur: 'آپ کسی انسان سے بات کر سکتے ہیں۔ "انسانی مدد کی درخواست" استعمال کریں۔' },
    ],
  },
  INSTITUTION_DECLINED: {
    meaning: { en: 'The university chose not to confirm this by email.', ur: 'یونیورسٹی نے ای میل پر اس کی تصدیق نہ کرنے کا فیصلہ کیا۔' },
    notProof: { en: 'A refusal is not proof either way. It does not mean your claim is false, and it does not mean it is true.', ur: 'انکار کسی بھی طرف ثبوت نہیں۔ اس کا مطلب یہ نہیں کہ آپ کا دعویٰ غلط ہے، اور یہ بھی نہیں کہ درست ہے۔' },
    steps: [
      { en: 'Log in to the official applicant portal yourself and look for this information there.', ur: 'خود سرکاری درخواست گزار پورٹل میں لاگ اِن کریں اور یہ معلومات وہاں دیکھیں۔' },
      { en: 'Ask the university which official way you can check this yourself.', ur: 'یونیورسٹی سے پوچھیں کہ آپ خود اسے کس سرکاری طریقے سے جانچ سکتے ہیں۔' },
      { en: 'Do not pay anyone until you have seen it on a portal you logged in to yourself.', ur: 'جب تک آپ نے اسے اپنے لاگ اِن کیے ہوئے پورٹل پر نہ دیکھ لیا ہو، کسی کو رقم نہ دیں۔' },
    ],
  },
  PENDING: {
    meaning: { en: 'We have asked the university. We have not had a reply yet.', ur: 'ہم نے یونیورسٹی سے پوچھا ہے۔ ابھی تک جواب نہیں آیا۔' },
    notProof: { en: 'No reply yet is not proof either way. Universities can be slow.', ur: 'ابھی جواب نہ آنا کسی بھی طرف ثبوت نہیں۔ یونیورسٹیاں سست ہو سکتی ہیں۔' },
    steps: [
      { en: 'You do not need to do anything. We will remind the university up to two times.', ur: 'آپ کو کچھ کرنے کی ضرورت نہیں۔ ہم یونیورسٹی کو زیادہ سے زیادہ دو بار یاد دہانی بھیجیں گے۔' },
      { en: 'Do not pay because someone is pressing you. You can ask for more time.', ur: 'کسی کے دباؤ پر رقم نہ دیں۔ آپ مزید وقت مانگ سکتے ہیں۔' },
      { en: 'You can also check the official applicant portal yourself.', ur: 'آپ خود سرکاری درخواست گزار پورٹل بھی دیکھ سکتے ہیں۔' },
    ],
  },
  PENDING_REPLY_RECEIVED: {
    meaning: { en: 'A reply has arrived. A person is checking it before you see a result.', ur: 'جواب آ گیا ہے۔ نتیجہ دکھانے سے پہلے ایک فرد اسے جانچ رہا ہے۔' },
    notProof: { en: 'We do not show a result until it has been checked. This is not proof either way.', ur: 'جانچ مکمل ہونے تک ہم نتیجہ نہیں دکھاتے۔ یہ کسی بھی طرف ثبوت نہیں۔' },
    steps: [
      { en: 'You do not need to do anything. We will tell you when there is an update.', ur: 'آپ کو کچھ کرنے کی ضرورت نہیں۔ نئی اطلاع پر ہم آپ کو بتائیں گے۔' },
      { en: 'Do not pay anyone only because of this claim while you wait.', ur: 'انتظار کے دوران صرف اس دعوے کی بنیاد پر کسی کو رقم نہ دیں۔' },
    ],
  },
  INCONCLUSIVE: {
    meaning: { en: 'The answer was unclear, or we could not be sure it came from the university.', ur: 'جواب واضح نہیں تھا، یا ہم یقین نہیں کر سکے کہ یہ یونیورسٹی کی طرف سے آیا ہے۔' },
    notProof: { en: 'This is not proof either way. It does not mean your claim is false.', ur: 'یہ کسی بھی طرف ثبوت نہیں۔ اس کا مطلب یہ نہیں کہ آپ کا دعویٰ غلط ہے۔' },
    steps: [
      { en: 'Log in to the official applicant portal yourself and look for this information there.', ur: 'خود سرکاری درخواست گزار پورٹل میں لاگ اِن کریں اور یہ معلومات وہاں دیکھیں۔' },
      { en: 'Do not pay anyone only because of this claim.', ur: 'صرف اس دعوے کی بنیاد پر کسی کو رقم نہ دیں۔' },
      { en: 'You can talk to a person who can help you decide what to do next.', ur: 'آپ ایسے فرد سے بات کر سکتے ہیں جو اگلا قدم طے کرنے میں مدد کرے۔' },
    ],
  },
  INCONCLUSIVE_NO_REPLY: {
    meaning: { en: 'No reply from the university in {days} days.', ur: 'یونیورسٹی کی طرف سے {days} دن میں کوئی جواب نہیں آیا۔' },
    notProof: { en: 'This is not proof either way. It does not mean your claim is false.', ur: 'یہ کسی بھی طرف ثبوت نہیں۔ اس کا مطلب یہ نہیں کہ آپ کا دعویٰ غلط ہے۔' },
    steps: [
      { en: 'Log in to the official applicant portal yourself and look for this information there.', ur: 'خود سرکاری درخواست گزار پورٹل میں لاگ اِن کریں اور یہ معلومات وہاں دیکھیں۔' },
      { en: 'Write to the university yourself using the contact on its official website.', ur: 'یونیورسٹی کی سرکاری ویب سائٹ پر دیے گئے رابطے سے خود انہیں لکھیں۔' },
      { en: 'You can talk to a person who can help you decide what to do next.', ur: 'آپ ایسے فرد سے بات کر سکتے ہیں جو اگلا قدم طے کرنے میں مدد کرے۔' },
    ],
  },
  DOCUMENT_ONLY_UNVERIFIED: {
    meaning: { en: 'We only have a document. A document alone cannot show that the university issued it.', ur: 'ہمارے پاس صرف ایک دستاویز ہے۔ صرف دستاویز سے یہ ثابت نہیں ہوتا کہ یونیورسٹی نے اسے جاری کیا۔' },
    notProof: { en: 'This is not a finding about you or your document. We have not yet asked the university.', ur: 'یہ آپ یا آپ کی دستاویز کے بارے میں کوئی فیصلہ نہیں۔ ہم نے ابھی یونیورسٹی سے نہیں پوچھا۔' },
    steps: [
      { en: 'Give permission so we can ask the university, or check the official applicant portal yourself.', ur: 'اجازت دیں تاکہ ہم یونیورسٹی سے پوچھ سکیں، یا خود سرکاری درخواست گزار پورٹل دیکھیں۔' },
      { en: 'Do not pay anyone only because of this document.', ur: 'صرف اس دستاویز کی بنیاد پر کسی کو رقم نہ دیں۔' },
    ],
  },
  OFFICIAL_PORTAL_REVIEWED: {
    meaning: { en: 'A TaleemParakh reviewer saw this on the official applicant portal. This is not a message from the university to us.', ur: 'تعلیم پرکھ کے ایک جائزہ کار نے اسے سرکاری درخواست گزار پورٹل پر دیکھا۔ یہ یونیورسٹی کی طرف سے ہمیں بھیجا گیا پیغام نہیں۔' },
    notProof: { en: 'A portal view is not the same as the university confirming this to us. It covers this one claim only.', ur: 'پورٹل پر دیکھنا اس کے برابر نہیں کہ یونیورسٹی نے ہمیں تصدیق کی ہو۔ یہ صرف اسی ایک دعوے کے بارے میں ہے۔' },
    steps: [
      { en: 'Log in to the portal yourself and keep a copy of what you see.', ur: 'خود پورٹل میں لاگ اِن کریں اور جو نظر آئے اس کی نقل رکھیں۔' },
      { en: 'Check any payment request as a separate claim before you pay.', ur: 'رقم دینے سے پہلے ہر ادائیگی کی درخواست کو الگ دعوے کے طور پر جانچیں۔' },
    ],
  },
  BLOCK_EXTERNAL_VERIFICATION: {
    meaning: { en: 'We have not started. We need your permission first. We will not contact the university until you give it.', ur: 'ہم نے شروع نہیں کیا۔ پہلے ہمیں آپ کی اجازت درکار ہے۔ جب تک آپ اجازت نہ دیں ہم یونیورسٹی سے رابطہ نہیں کریں گے۔' },
    notProof: { en: 'Nothing has been checked yet. This is not a finding about your claim.', ur: 'ابھی کچھ نہیں جانچا گیا۔ یہ آپ کے دعوے کے بارے میں کوئی فیصلہ نہیں۔' },
    steps: [
      { en: 'Read the permission page and give permission if you agree. You can withdraw it at any time.', ur: 'اجازت کا صفحہ پڑھیں اور اگر آپ متفق ہوں تو اجازت دیں۔ آپ کسی بھی وقت اسے واپس لے سکتے ہیں۔' },
    ],
  },
};

// Statuses a student must never see by name: the engine's candidates and security states show as "reply received".
const HIDDEN_TO_PENDING = new Set([
  'INSTITUTION_CONFIRMED_CANDIDATE', 'INSTITUTION_CONTRADICTED_CANDIDATE', 'INSTITUTION_DECLINED_CANDIDATE', 'MANUAL_SECURITY_REVIEW', 'SUSPECTED_FRAUD_REVIEW',
]);

const TRACE = {
  no_valid_consent: { en: 'Your permission is missing, has ended or was withdrawn, so we did not contact the university.', ur: 'آپ کی اجازت موجود نہیں، ختم ہو چکی ہے یا واپس لے لی گئی ہے، اس لیے ہم نے یونیورسٹی سے رابطہ نہیں کیا۔' },
  raw_document_only: { en: 'We only have a document you gave us.', ur: 'ہمارے پاس صرف وہ دستاویز ہے جو آپ نے دی۔' },
  no_authenticated_response: { en: 'We have not had a reply that we could check.', ur: 'ہمیں ایسا جواب نہیں ملا جسے ہم جانچ سکیں۔' },
  unapproved_sender: { en: 'A reply came from an address that is not a checked address for this university, so we did not count it.', ur: 'ایک جواب ایسے پتے سے آیا جو اس یونیورسٹی کا جانچا ہوا پتہ نہیں، اس لیے ہم نے اسے شمار نہیں کیا۔' },
  auth_failed: { en: 'We could not confirm that a reply really came from the university, so a person is looking at it.', ur: 'ہم یہ تصدیق نہیں کر سکے کہ جواب واقعی یونیورسٹی سے آیا، اس لیے ایک فرد اسے دیکھ رہا ہے۔' },
  anomalous_thread: { en: 'Something about a reply looked unusual, so a person is looking at it.', ur: 'ایک جواب میں کوئی بات غیر معمولی لگی، اس لیے ایک فرد اسے دیکھ رہا ہے۔' },
  institution_refused: { en: 'The university chose not to confirm this by email.', ur: 'یونیورسٹی نے ای میل پر اس کی تصدیق نہ کرنے کا فیصلہ کیا۔' },
  vague_statement: { en: 'The reply was not clear enough to count as a yes or a no.', ur: 'جواب اتنا واضح نہیں تھا کہ اسے ہاں یا نہیں مانا جائے۔' },
  contradictory_statements: { en: 'The replies disagreed with each other, so a person is looking at them.', ur: 'جوابات ایک دوسرے سے مختلف تھے، اس لیے ایک فرد انہیں دیکھ رہا ہے۔' },
  applicant_portal_evidence: { en: 'A reviewer saw this on the official applicant portal.', ur: 'ایک جائزہ کار نے اسے سرکاری درخواست گزار پورٹل پر دیکھا۔' },
  excluded_after_security_review: { en: 'A reply was set aside after a safety check and does not count.', ur: 'ایک جواب حفاظتی جانچ کے بعد الگ رکھ دیا گیا اور شمار نہیں ہوتا۔' },
  ai_rules_disagree: { en: 'A person is double checking this result.', ur: 'ایک فرد اس نتیجے کو دوبارہ جانچ رہا ہے۔' },
};

export const EXPLAINED_STATUSES = Object.freeze(Object.keys(T));
export const EXPLAINED_TRACE_KEYS = Object.freeze(Object.keys(TRACE));

const pick = (obj, lang) => obj[lang === 'ur' ? 'ur' : 'en'];
const fill = (s, vars) => s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k]).replace(/[\r\n]+/g, ' ').slice(0, 80)));

/** Translate engine trace keys to plain sentences. Unknown keys are dropped, never shown. */
export function explainTrace(trace, lang = 'en') {
  const out = [];
  for (const k of Array.isArray(trace) ? trace : []) if (Object.prototype.hasOwnProperty.call(TRACE, k) && !out.includes(pick(TRACE[k], lang))) out.push(pick(TRACE[k], lang));
  return out;
}

/**
 * explainClaim({ status, trace, claimType, replyReceived, lang, pendingDays })
 * -> { key, resultClass, headline, claimLabel, meaning, notProof, steps[], traceLines[] }
 * `status` is the PUBLISHED status. Candidate and security statuses (never published) show as "reply received".
 */
export function explainClaim(arg) {
  let { status, trace = [], claimType = null, replyReceived = false, lang = 'en', pendingDays = 30 } = arg && typeof arg === 'object' ? arg : {};
  let key = typeof status === 'string' ? status : '';
  if (HIDDEN_TO_PENDING.has(key)) { key = 'PENDING'; replyReceived = true; }
  if (key === 'PENDING' && replyReceived) key = 'PENDING_REPLY_RECEIVED';
  const tr = Array.isArray(trace) ? trace : [];
  if (key === 'INCONCLUSIVE' && tr.includes('no_authenticated_response') && !replyReceived) key = 'INCONCLUSIVE_NO_REPLY';
  if (!Object.prototype.hasOwnProperty.call(T, key)) key = 'PENDING';
  const block = T[key];
  const labelKey = key === 'INCONCLUSIVE_NO_REPLY' ? 'INCONCLUSIVE' : key;
  const label = STATUS_LABELS[labelKey] || STATUS_LABELS.PENDING;
  const vars = { days: pendingDays };
  const claim = claimType && CLAIM_LABELS[claimType] ? pick(CLAIM_LABELS[claimType], lang) : '';
  return {
    key,
    resultClass: label.resultClass,
    headline: pick(label, lang),
    claimLabel: claim,
    meaning: fill(pick(block.meaning, lang), vars),
    notProof: fill(pick(block.notProof, lang), vars),
    steps: block.steps.map((s) => fill(pick(s, lang), vars)),
    traceLines: explainTrace(tr, lang),
  };
}

/** Every visible string this module can produce (for tests that scan the copy). */
export function allExplainStrings() {
  const out = [];
  for (const b of Object.values(T)) { for (const k of ['meaning', 'notProof']) out.push(b[k].en, b[k].ur); for (const s of b.steps) out.push(s.en, s.ur); }
  for (const t of Object.values(TRACE)) out.push(t.en, t.ur);
  return out;
}
