// Side summary panel sentences (addendum R.5). Pure: fact codes in, sentences out. Every sentence comes from a template keyed by the kind of
// queue item; nothing here reads data or decides anything. An AI summary, when present, sits in its own box with a fixed label and is never
// shown for safeguarding items or for student free text. Facts arrive from the database (staff panel facts); text is plain strings for textContent.
import { tierLabel, reasonText } from './tiers.js';

export const AI_BOX_LABEL = 'Suggestion from AI. It can be wrong. It decides nothing.';
export const QUEUE_KINDS = Object.freeze(['send', 'replies', 'contacts', 'news', 'appeals', 'safeguarding', 'student', 'messages']);

const CLAIM_WORDS = {
  application_received: 'that an application was received', admission_granted: 'an offer of admission', scholarship_awarded: 'a scholarship',
  agent_authorized: 'that a named agent is authorised', deposit_instruction_authentic: 'payment details',
};
const STATUS_WORDS = {
  INSTITUTION_CONFIRMED: 'Verified', INSTITUTION_CONTRADICTED: 'The university said no', INSTITUTION_DECLINED: 'The university declined to say',
  INCONCLUSIVE: 'Inconclusive', PENDING: 'Awaiting the university', OFFICIAL_PORTAL_REVIEWED: 'Seen on the official portal',
};
const POLARITY = { positive: 'yes', negative: 'no', refusal: 'a refusal', none: 'nothing clear' };
const REASON_WORDS = {
  distress_disclosed: 'the student described distress', threat_or_blackmail: 'a threat or blackmail', imminent_high_value_payment: 'a large payment is close',
  imminent_payment_uncertain: 'a payment is close', minor_involved: 'the student may be under 18', student_requested_human: 'the student asked for a person', suspected_fraud: 'possible fraud',
};
const GUARD1 = { a: 'a reply linked to a request that was sent', b: 'sent from the checked address', c: 'signatures passed and it arrived in time', d: 'the reply text is stored unchanged', e: 'an explicit statement with the right meaning and a quote', f: 'the shown text only removes parts of the reply' };

const claimList = (claims) => {
  const w = (Array.isArray(claims) ? claims : []).map((c) => CLAIM_WORDS[c] || 'a claim');
  return w.length <= 1 ? (w[0] || 'a claim') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`;
};
const clip = (s, n) => String(s ?? '').replace(/[–—]/g, '-').slice(0, n);
const nodash = (s) => String(s).replace(/[–—]/g, ', ');
const writtenBy = (w) => (w === 'ai' ? 'AI draft' : w === 'fixed' ? 'fixed text' : 'template');

/**
 * summarize(kind, facts) -> { line, decision, tier, tierLabel, why[], passed, flagged[], actions[], aiBox }
 * kind: one of QUEUE_KINDS. facts: { tier, tier_reasons[], institution, claims[], case_ref, written_by, ...per kind, checks_passed[], checks_flagged[], ai }
 */
export function summarize(kind, facts) {
  const f = facts && typeof facts === 'object' ? facts : {};
  const tier = ['urgent', 'careful', 'check', 'routine'].includes(f.tier) ? f.tier : 'check';
  const inst = clip(f.institution || 'the institution', 120);
  const ref = clip(f.case_ref || '', 20);
  let line; let decision; let actions;
  switch (kind) {
    case 'send':
      line = `Email to ${inst} admissions asking whether ${claimList(f.claims)} for request ${ref}. Written by ${writtenBy(f.written_by)}.`;
      decision = 'Is this email correct and safe to send?';
      actions = [tier === 'careful' ? 'approve_with_note' : 'approve', 'reject', 'hold_case', 'open_message'];
      break;
    case 'replies': {
      const when = clip(f.reply_date || '', 20);
      const rules = (Array.isArray(f.rules) ? f.rules : []).map((r) => `${CLAIM_WORDS[r.claim] ? r.claim.replace(/_/g, ' ') : 'claim'} ${POLARITY[r.polarity] || 'unclear'}`).join(', ') || 'nothing clear';
      const ai = f.ai_agrees === true ? 'agrees' : f.ai_agrees === false ? 'disagrees' : 'off';
      line = `${inst} replied from the checked address on ${when}. Signatures: ${f.signatures_passed ? 'passed' : 'not passed'}. Rules read: ${rules}. AI: ${ai}.`;
      decision = `Publish ${STATUS_WORDS[f.candidate] || 'a result'}, or ask the university again, or mark Inconclusive?`;
      actions = [f.guard1 && Object.values(f.guard1).every(Boolean) ? 'publish' : 'publish_disabled', 'ask_again', 'inconclusive', 'open_reply'];
      break;
    }
    case 'contacts':
      line = `${clip(f.address, 120)} proposed for ${inst}, found on ${clip(f.source1, 80)} and ${clip(f.source2, 80)}, proposed ${clip(f.proposed_ago, 30)} ago.`;
      decision = 'Are both pages official and do they show this exact address?';
      actions = ['approve_after_wait', 'retire', 'open_sources'];
      break;
    case 'news':
      line = `${clip(f.outlet, 80)}, ${clip(f.date, 20)}: ${clip(f.headline, 200)}. Rules matched: ${(f.rules || []).join(', ') || 'none'}. Not sure because: ${clip(f.unsure_because || 'no clear match', 120)}.`;
      decision = 'Is this about scams that affect students?';
      actions = ['publish_with_note', 'do_not_publish', 'hide_source'];
      break;
    case 'appeals':
      line = `Student disagrees with ${STATUS_WORDS[f.status] || 'a result'} for ${claimList([f.claim_type])}, filed ${clip(f.filed, 20)}. Grounds: ${clip(f.grounds, 200)}`;
      decision = 'Does the evidence support the result?';
      actions = ['uphold', 'change'];
      break;
    case 'safeguarding':
      line = `Help request: ${REASON_WORDS[f.reason] || 'a student asked for help'}, raised ${clip(f.raised_ago, 30)} ago. Helplines were shown to the student.`;
      decision = 'Contact the student or refer?';
      actions = ['acknowledge', 'refer', 'resolve'];
      break;
    case 'student':
      line = `Account opened ${clip(f.opened, 20)}, ${Number(f.requests) || 0} requests, ${Number(f.open) || 0} open, language ${f.language === 'ur' ? 'Urdu' : 'English'}, permission valid until ${clip(f.permission_until, 20)}, open help requests ${Number(f.help_open) || 0}.`;
      decision = 'What do you need to do for this student?';
      actions = ['open_request', 'correct_detail', 'withdraw_permission', 'hold_account'];
      break;
    case 'messages':
      line = `Message to the student about ${STATUS_WORDS[f.status] || 'their request'}. Status sentence from the rules. Wording by ${f.written_by === 'ai' ? 'AI' : 'fixed text'}. Validator: ${f.validator_passed ? 'passed' : 'not passed'}.`;
      decision = 'Send this message?';
      actions = ['send', 'send_fixed', 'cancel'];
      break;
    default:
      line = 'This item needs a person.'; decision = 'What do you need to decide?'; actions = [];
  }
  const reasons = Array.isArray(f.tier_reasons) ? f.tier_reasons : [];
  const aiAllowed = f.ai && typeof f.ai.text === 'string' && kind !== 'safeguarding' && kind !== 'appeals' && !f.student_text;
  return {
    line: nodash(line), decision, tier, tierLabel: tierLabel(tier), why: reasons.map(reasonText),
    passed: Array.isArray(f.checks_passed) ? f.checks_passed.length : 0, flagged: (Array.isArray(f.checks_flagged) ? f.checks_flagged : []).map(reasonText),
    guard1: f.guard1 ? Object.entries(GUARD1).map(([k, label]) => ({ id: k, label, ok: f.guard1[k] === true })) : null,
    actions, aiBox: aiAllowed ? { label: AI_BOX_LABEL, text: nodash(clip(f.ai.text, 600)) } : null,
  };
}
