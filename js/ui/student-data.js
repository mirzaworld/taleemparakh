// Student portal data adapter (Lane B, M16). Display only: it decides nothing (AGENTS.md mission rule 3).
//
// PENDING LANE A (listed in audits/agent-logs/laneB-ui-2026-10-15.log.md). Each wrapper below calls the RPC named
// in the addendum (C.1.2, C.4). While the RPC does not exist yet (PostgREST answers 404), it falls back to the
// existing views and RPCs so the screens still work on today's database. Remove each fallback when Lane A ships.
//   my_requests()                         fallback: view v_my_cases
//   my_request_timeline(p_case)           exists (0017); case_ref, institution, consent.id, claim ids, evidence ids,
//                                         reply_window_until and reply_at are not in it yet: merged from v_my_cases and read_case
//   start_identity_check(p_identity), confirm_identity_check(p_identity, p_code)   fallback: { unavailable: true }
//   ask_second_look(p_case, p_note)       fallback: request_human(p_case, 'student_requested_human')
//   public/js/core/pipeline.js pipeline(timeline, now)   fallback: pipelineStub below (same table, C.1.3)
import { rpc, view, ApiError } from '../lib/api.js';

const missing = (e) => e instanceof ApiError && e.status === 404;

/** [{ case_id, case_ref, institution, claims[], step, step_key, stopped, status, opened_at }] */
export async function myRequests() {
  try { return await rpc('my_requests'); } catch (e) {
    if (!missing(e)) throw e;
    const rows = await view('v_my_cases', 'select=id,case_ref,institution,state,opened_at,claims_by_status&order=opened_at.desc');
    return rows.map((c) => {
      const statuses = Object.keys(c.claims_by_status || {});
      const done = statuses.length && statuses.every((s) => s !== 'PENDING' && s !== 'BLOCK_EXTERNAL_VERIFICATION');
      return { case_id: c.id, case_ref: c.case_ref, institution: c.institution, claims: [], step: done ? 7 : null, step_key: done ? 'result' : null,
        stopped: null, status: statuses[0] || 'PENDING', opened_at: c.opened_at };
    });
  }
}

/**
 * One request, normalised for the screens: { now, case_ref, institution, raw, consent, outbound, reply, claims[] }.
 * raw is exactly what app.my_request_timeline returned (0017), passed unchanged to core pipeline(). The timeline has
 * no case reference, institution, consent id, claim ids or evidence ids, so those come from v_my_cases and read_case
 * until Lane A adds them (log: stubs list).
 */
export async function requestTimeline(caseId) {
  let raw = null;
  try { raw = await rpc('my_request_timeline', { p_case: caseId }); } catch (e) { if (!missing(e)) throw e; }
  const [bundle, meta] = await Promise.all([
    rpc('read_case', { p_case: caseId }).catch(() => null),
    view('v_my_cases', `select=id,case_ref,institution&id=eq.${encodeURIComponent(caseId)}`).then((r) => r?.[0] || null).catch(() => null),
  ]);
  if (!raw && !bundle) throw new ApiError('not_found');
  raw ||= { now: bundle?.now || null, consent: null, requests: [], reply_received: false, claims: (bundle?.claims || []).map((c) => ({ claim_type: c.claim_type, published_status: c.status })) };
  const initial = (raw.requests || []).filter((r) => r.kind === 'initial');
  const last = initial[initial.length - 1] || {};
  const g = raw.consent;
  const byType = new Map((bundle?.claims || []).map((c) => [c.claim_type, c]));
  const claims = (raw.claims || []).map((c) => {
    const b = byType.get(c.claim_type) || {};
    return { id: c.id || b.id || c.claim_type, claim_type: c.claim_type, status: c.published_status || b.status || 'PENDING',
      evidence_id: c.evidence_id || b.evidence_id || null, reply_received: Boolean(raw.reply_received) };
  });
  return {
    now: raw.now, raw, case_ref: raw.case_ref || meta?.case_ref || bundle?.case?.case_ref || '', institution: raw.institution || meta?.institution || bundle?.case?.institution || '',
    consent: g ? { id: g.id || null, state: g.valid ? 'active' : g.revoked_at ? 'withdrawn' : 'expired', withdrawn_at: g.revoked_at, valid_until: g.expires_at } : null,
    outbound: { state: last.state || 'drafted', to: last.to || null, sent_at: last.sent_at || null, reply_window_until: last.reply_window_until || null, reason_key: last.reason_key || null },
    reply: { received: Boolean(raw.reply_received), at: raw.reply_at || null },
    claims,
  };
}

export const STEP_KEYS = ['consent', 'details', 'review', 'sent', 'waiting', 'checking', 'result'];

/** C.1.3 table as a display mapping. Used only until public/js/core/pipeline.js exists. */
export function pipelineStub(t) {
  const o = t?.outbound?.state || 'drafted';
  if (['rejected', 'blocked'].includes(o)) return { steps: STEP_KEYS.map((key, i) => ({ n: i + 1, key, state: i === 0 ? 'done' : 'todo' })), current: 0, complete: false, stopped: o, reason: t.outbound.reason_key };
  let current;
  if (!t?.consent || t.consent.state !== 'active') current = 1;
  else if (t.published || (t.claims || []).some((c) => !['PENDING', 'BLOCK_EXTERNAL_VERIFICATION'].includes(c.status))) current = 8;
  else if (t.reply?.received) current = 6;
  else if (o === 'sent') current = 5;
  else if (['authorized', 'failed'].includes(o)) current = 4;
  else if (['awaiting_review', 'approved', 'deferred'].includes(o)) current = 3;
  else current = 2;
  const steps = STEP_KEYS.map((key, i) => ({ n: i + 1, key, state: i + 1 < current ? 'done' : i + 1 === current ? 'now' : 'todo' }));
  return { steps, current: Math.min(current, 7), complete: current === 8, stopped: t?.stopped || null, sub: o };
}

// core pipeline() (Lane A, C.1.3) returns English sentences and status 'done'|'current'|'todo'. The screens translate
// by key, so only the structure is used here: step states, the current step, and the stopped kind.
const STOP_KIND = { rejected: 'rejected', blocked: 'blocked', cancelled_consent_revoked: 'consent_withdrawn', expired: 'expired_twice', consent_expired: 'consent_expired', cancelled_other: 'blocked' };
let core;
export async function pipelineOf(view, now) {
  if (core === undefined) core = await import('../core/pipeline.js').then((m) => m.pipeline || null).catch(() => null);
  if (core && view?.raw) {
    try {
      // Workaround, reported to Lane A: core pipeline() treats BLOCK_EXTERNAL_VERIFICATION ("needs your permission")
      // as a ready result. It is not a result, so it is passed as PENDING here. Remove when pipeline.js is fixed.
      const raw = { ...view.raw, claims: (view.raw.claims || []).map((c) => (c?.published_status === 'BLOCK_EXTERNAL_VERIFICATION' ? { ...c, published_status: 'PENDING' } : c)) };
      const r = core(raw, now ? new Date(now) : new Date());
      if (r && Array.isArray(r.steps)) {
        const steps = r.steps.map((x) => ({ n: x.n, key: STEP_KEYS[x.n - 1], state: x.status === 'current' ? 'now' : x.status }));
        const complete = r.current === 7 && steps.every((x) => x.state === 'done');
        return { steps, current: r.current || 1, complete, stopped: r.stopped ? (STOP_KIND[r.stopped.kind] || 'blocked') : null, reason: view.outbound?.reason_key || null, late: Boolean(r.late), sub: view.outbound?.state };
      }
    } catch { /* fall back to the stub */ }
  }
  return pipelineStub(view);
}

export async function startIdentityCheck(identity) {
  try { return await rpc('start_identity_check', { p_identity: identity }); } catch (e) { if (missing(e)) return { unavailable: true }; throw e; }
}
export async function confirmIdentityCheck(identity, code) {
  try { return await rpc('confirm_identity_check', { p_identity: identity, p_code: code }); } catch (e) { if (missing(e)) return { unavailable: true }; throw e; }
}
export async function askSecondLook(caseId, note) {
  try { return await rpc('ask_second_look', { p_case: caseId, p_note: note || null }); } catch (e) {
    if (!missing(e)) throw e;
    return rpc('request_human', { p_case: caseId, p_reason: 'student_requested_human' });
  }
}
