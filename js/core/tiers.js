// Display copy of the tier rules for university emails (addendum R.4 "Send approvals"). Pure. The DATABASE computes the tier
// (app.record_outbound_checks in 0017) from facts; this file only explains it and mirrors the lists so a screen can say why.
// tests/tiers.test.js proves these lists equal the ones in the SQL (app.careful_reasons, app.check_reasons) and that a tier
// computed here from the same facts equals the SQL rule. AI never sets a tier, and a tier can only be raised, never lowered.

/** First matching row wins: urgent, then careful, then check, then routine. */
export const TIERS = Object.freeze(['urgent', 'careful', 'check', 'routine']);
export const CAREFUL_REASONS = Object.freeze(['first_send_to_contact', 'sponsor_flag', 'soft_check', 'third_party_or_payment_claim',
  'recent_rejection', 'source_page_changed', 'reminder_body_drift', 'no_proven_identifier', 'ai_draft_fallback', 'large_amount']);
export const CHECK_REASONS = Object.freeze(['new_account', 'contact_recent_failure', 'spot_check']);
export const BATCH_MAX = 20;
export const BATCH_MIN_ITEMS = 2;
export const BATCH_SECONDS_PER_ITEM = 3;

/** facts: { urgent: boolean, reasons: string[] } -> 'urgent' | 'careful' | 'check' | 'routine'. Unknown reason codes are ignored. */
export function tierOf(facts) {
  const f = facts && typeof facts === 'object' ? facts : {};
  if (f.urgent === true) return 'urgent';
  const r = Array.isArray(f.reasons) ? f.reasons : [];
  if (r.some((x) => CAREFUL_REASONS.includes(x))) return 'careful';
  if (r.some((x) => CHECK_REASONS.includes(x))) return 'check';
  return 'routine';
}

/** Only routine items may be approved in a batch (R.4). */
export const isBatchable = (item) => !!item && item.tier === 'routine' && (item.state === undefined || item.state === 'awaiting_review');

/** Seconds a batch must stay open before it can be decided: at least the single-item dwell, and 3 seconds per item. */
export const batchMinSeconds = (n, dwellSeconds = 20) => Math.max(Number(dwellSeconds) || 0, BATCH_SECONDS_PER_ITEM * Math.max(0, Number(n) || 0));
export const batchSizeOk = (n) => Number.isInteger(n) && n >= BATCH_MIN_ITEMS && n <= BATCH_MAX;

/** Whether the reviewer must write a short note to approve (careful tier, FD-R9-9). */
export const needsApprovalNote = (tier) => tier === 'careful';

const TIER_LABEL = {
  urgent: { en: 'Urgent', ur: 'فوری' },
  careful: { en: 'Careful', ur: 'احتیاط' },
  check: { en: 'Check', ur: 'جانچ' },
  routine: { en: 'Routine', ur: 'معمول' },
};
const REASON = {
  safeguarding_open: 'The student has an open request for help. Look at this one first.',
  first_send_to_contact: 'This is the first email to this address.',
  sponsor_flag: 'This university has a sponsor flag.',
  soft_check: 'An automatic check raised a flag. Read the flagged checks first.',
  third_party_or_payment_claim: 'The email asks about a named agent or about payment details.',
  recent_rejection: 'An earlier email from this student was rejected in the last 30 days.',
  source_page_changed: 'The page that listed this address no longer shows it.',
  reminder_body_drift: 'This reminder differs from the first email by more than the reminder line.',
  no_proven_identifier: 'The student did not share an application email that we have proven is theirs.',
  ai_draft_fallback: 'The AI wording failed a check, so the fixed template was used.',
  large_amount: 'An amount in the request is at least half of the highest amount we allow.',
  new_account: 'The student account is less than 7 days old.',
  contact_recent_failure: 'A send to this address failed in the last 30 days.',
  spot_check: 'A random spot check. Read this one on its own.',
};
export const tierLabel = (tier, lang = 'en') => (TIER_LABEL[tier] || TIER_LABEL.check)[lang === 'ur' ? 'ur' : 'en'];
/** Plain English for a reason code; unknown codes give a neutral sentence (never the raw code). */
export const reasonText = (code) => REASON[code] || 'A rule asked for a closer look.';
export const allReasonCodes = () => Object.keys(REASON);
