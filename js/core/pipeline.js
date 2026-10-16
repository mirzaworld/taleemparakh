// The student's seven-step pipeline (addendum C.1.3). Pure: facts from app.my_request_timeline and the server clock in,
// steps out. Display only: it decides nothing. Texts are English drafts; the portal owns translation by key.
// Stopped states replace the remaining steps with one box that ends with one next step.

export const STEP_LABELS = Object.freeze({
  1: 'You gave permission',
  2: 'We are checking your details',
  3: 'A person is checking our email before it is sent',
  4: 'Email sent to the university',
  5: 'Waiting for the university',
  6: 'The university answered. A person is checking it',
  7: 'Result ready',
});

const STATE_SENTENCE = Object.freeze({
  drafted: 'We are checking your details.',
  auto_checked: 'We are checking your details.',
  awaiting_review: 'A person is checking our email before it is sent.',
  approved: 'Approved. We will send it soon.',
  deferred: 'Approved. It will go out tomorrow because of daily limits.',
  authorized: 'Sending now.',
  failed: 'We are having trouble sending. A person is looking at it.',
  sent: 'Email sent.',
});
const LATE = 'This is taking longer than usual. You do not need to do anything.';
const EXPIRED_ONCE = 'We could not check this in time. We asked again.';

// Reason sentences (A.5). The student never sees the reviewer's note. "possible_misuse" arrives as the neutral key "cannot_send".
export const REJECT_SENTENCE = Object.freeze({
  details_need_correction: 'Some details look wrong or missing. Please check and send again.',
  wrong_contact: "We need to check the university's address again. You do not need to do anything.",
  duplicate_request: 'You already have a request like this.',
  institution_does_not_accept: 'This university does not answer requests like this. Here is its own way to check.',
  not_a_study_application: 'This service is only for study applications.',
  cannot_send: 'We cannot send this request. If you think this is a mistake, ask for a second look.',
  other: 'We could not send this request. You can ask for a second look or talk to a person.',
});
const BLOCK_SENTENCE = Object.freeze({
  no_valid_consent: 'Your permission has ended or was withdrawn, so we did not send the email.',
  recipient_not_allowlisted: "We need to check the university's address again. You do not need to do anything.",
  institution_opted_out: 'This university asked not to receive requests like this. Here is its own way to check.',
  institution_applicant_portal_only: 'This university answers only through its applicant portal. Log in to it yourself to check.',
  institution_not_in_coverage: 'We do not send requests to this university yet. Here is its own way to check.',
  simulation_blocks_external_email: 'This is a test system. No real email was sent.',
  controlled_blocks_real_institution: 'This is a test system. No real email was sent.',
});
const BLOCK_DEFAULT = 'We could not send this request. You can ask a person to look at it.';

const isTerminalBad = (s) => ['rejected', 'blocked', 'cancelled_consent_revoked', 'cancelled_other'].includes(s);

/**
 * pipeline(timeline, now) -> { steps: [{ n, label, status: 'done'|'current'|'todo' }], current, sentence, stopped, late }
 *   stopped: null or { kind, text, next }   late: the waiting sentence "taking longer than usual" applies
 */
export function pipeline(timeline, now = new Date()) {
  const t = timeline && typeof timeline === 'object' ? timeline : {};
  const at = now instanceof Date ? now : new Date(now);
  const reqs = (Array.isArray(t.requests) ? t.requests : []).filter((r) => r && r.kind === 'initial')
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const last = reqs[reqs.length - 1] || null;
  const claims = Array.isArray(t.claims) ? t.claims : [];
  // BLOCK_EXTERNAL_VERIFICATION means "needs your permission": it is a stopped state, never a finished result.
  const blocked = claims.some((c) => c && c.published_status === 'BLOCK_EXTERNAL_VERIFICATION');
  const resultReady = !blocked && claims.some((c) => c && c.published_status && c.published_status !== 'PENDING');
  const consentOk = !!(t.consent && t.consent.valid);
  const steps = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ n, label: STEP_LABELS[n], status: 'todo' }));
  const mark = (done, cur) => steps.forEach((s) => { s.status = s.n <= done ? 'done' : s.n === cur ? 'current' : 'todo'; });
  const out = { steps, current: 1, sentence: '', stopped: null, late: false };

  if (blocked) {
    mark(0, 0); out.current = 0;
    out.stopped = { kind: 'needs_permission', text: 'We need your permission before we can ask the university.', next: 'Give permission again to continue.' };
    return out;
  }
  if (resultReady) { mark(7, 0); steps[6].status = 'done'; out.current = 7; out.sentence = 'Your result is ready.'; return out; }
  if (!last) {
    if (!consentOk) { mark(0, 1); out.current = 1; out.sentence = 'Give permission so we can ask the university.'; return out; }
    mark(1, 2); out.current = 2; out.sentence = STATE_SENTENCE.drafted; return out;
  }
  const s = String(last.state);
  const expiredCount = reqs.filter((r) => r.state === 'expired').length;
  if (isTerminalBad(s) || (s === 'expired' && expiredCount >= 2)) {
    mark(1, 0);
    let text; let next;
    if (s === 'rejected') { text = REJECT_SENTENCE[last.reason_key] || REJECT_SENTENCE.other; next = 'You can ask for a second look or talk to a person.'; }
    else if (s === 'blocked') { text = BLOCK_SENTENCE[last.reason_key] || BLOCK_DEFAULT; next = "You can check through the university's own website or talk to a person."; }
    else if (s === 'cancelled_consent_revoked') { text = 'You withdrew permission, so we did not send the email.'; next = 'You can give permission again whenever you want.'; }
    else if (s === 'expired') { text = "We are sorry, this is delayed. A person will look at it. You can also check through the university's own website."; next = 'You can talk to a person.'; }
    else { text = 'This request was stopped.'; next = 'You can talk to a person.'; }
    out.stopped = { kind: s, text, next }; out.current = 0; return out;
  }
  if (!consentOk && !['sent'].includes(s)) {
    mark(0, 1); out.current = 1; out.stopped = { kind: 'consent_expired', text: 'Your permission has ended, so we have not sent the email.', next: 'Give permission again to continue.' }; return out;
  }
  if (['drafted', 'auto_checked'].includes(s)) { mark(1, 2); out.current = 2; out.sentence = STATE_SENTENCE[s]; return out; }
  if (['awaiting_review', 'approved', 'deferred', 'expired'].includes(s)) {
    mark(2, 3); out.current = 3;
    out.sentence = s === 'expired' ? EXPIRED_ONCE : STATE_SENTENCE[s];
    if (s === 'awaiting_review' && last.review_due_at && new Date(last.review_due_at).getTime() < at.getTime()) { out.late = true; out.sentence = `${STATE_SENTENCE[s]} ${LATE}`; }
    return out;
  }
  if (['authorized', 'failed'].includes(s)) { mark(3, 4); out.current = 4; out.sentence = STATE_SENTENCE[s]; return out; }
  // sent
  if (t.reply_received) { mark(5, 6); out.current = 6; out.sentence = 'The university answered. A person is checking the answer before you see a result.'; return out; }
  mark(4, 5); out.current = 5;
  const reminders = (Array.isArray(t.requests) ? t.requests : []).filter((r) => r && r.kind === 'reminder' && r.state === 'sent' && r.sent_at).map((r) => String(r.sent_at).slice(0, 10));
  out.sentence = last.sent_at ? `Email sent on ${String(last.sent_at).slice(0, 10)}. We are waiting for the university.` : STATE_SENTENCE.sent;
  out.reminders = reminders;
  return out;
}
