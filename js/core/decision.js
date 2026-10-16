// Deterministic verification decision engine (blueprint §IV, backlog TP-021..TP-027).
// SIMULATION ONLY: it is exercised by synthetic tests and the public methodology page.
// It sends nothing and has no authority to publish a status; every *_CANDIDATE needs an
// independent human reviewer, and the founder cannot unilaterally override.

export const CLAIM_TYPES = Object.freeze([
  'application_submitted', 'application_received', 'admission_granted',
  'scholarship_awarded', 'agent_authorized', 'deposit_instruction_authentic',
]);

export const STATUS = Object.freeze({
  BLOCK_EXTERNAL_VERIFICATION: 'BLOCK_EXTERNAL_VERIFICATION',
  DOCUMENT_ONLY_UNVERIFIED: 'DOCUMENT_ONLY_UNVERIFIED',
  PENDING: 'PENDING',
  INCONCLUSIVE: 'INCONCLUSIVE',
  MANUAL_SECURITY_REVIEW: 'MANUAL_SECURITY_REVIEW',
  INSTITUTION_CONFIRMED_CANDIDATE: 'INSTITUTION_CONFIRMED_CANDIDATE',
  INSTITUTION_CONTRADICTED_CANDIDATE: 'INSTITUTION_CONTRADICTED_CANDIDATE',
  INSTITUTION_DECLINED_CANDIDATE: 'INSTITUTION_DECLINED_CANDIDATE',
  OFFICIAL_PORTAL_REVIEWED: 'OFFICIAL_PORTAL_REVIEWED',
});

export function consentValid(consent, claimType, now) {
  if (!consent || !consent.granted) return false;
  if (consent.revokedAt && new Date(consent.revokedAt) <= now) return false;
  if (!consent.expiresAt || new Date(consent.expiresAt) <= now) return false;
  return Array.isArray(consent.claimTypes) && consent.claimTypes.includes(claimType);
}

function addressDomain(addr) {
  const s = String(addr || '').toLowerCase().trim();
  return s.includes('@') ? s.split('@').pop() : s;
}

// A contact counts only if a reviewer approved it in the institution contact registry
// (never from content a student or agent supplied).
export function isApprovedContact(address, approvedContacts) {
  const a = String(address || '').toLowerCase().trim();
  const d = addressDomain(a);
  return (approvedContacts || []).some((c) => c.approvedBy && (c.address ? c.address.toLowerCase() === a : c.domain && c.domain.toLowerCase() === d));
}

/** Gate before any outbound verification request (TP-022). */
export function canDispatch({ consent, claimType, recipient, approvedContacts, environment = 'simulation', now = new Date() }) {
  if (!CLAIM_TYPES.includes(claimType)) return { allowed: false, reason: 'unknown_claim' };
  if (!consentValid(consent, claimType, now)) return { allowed: false, reason: 'no_valid_consent' };
  if (!isApprovedContact(recipient, approvedContacts)) return { allowed: false, reason: 'recipient_not_allowlisted' };
  if (environment === 'simulation') return { allowed: false, reason: 'simulation_blocks_external_email', wouldSend: true };
  return { allowed: true, reason: 'ok' };
}

function authenticatedInstitutionReply(ev, approvedContacts) {
  if (ev.kind !== 'institution_reply') return { ok: false, why: 'not_reply' };
  const auth = ev.auth || {};
  const aligned = auth.dkim === 'pass' && auth.dmarc === 'pass';
  const approved = isApprovedContact(ev.from, approvedContacts);
  if (!approved) return { ok: false, why: 'unapproved_sender', aligned };
  if (!aligned) return { ok: false, why: 'auth_failed', aligned };
  if (ev.anomalous) return { ok: false, why: 'anomalous_thread', aligned };
  return { ok: true };
}

/**
 * Decide one claim. Only structured `statements` count; free text in evidence (which may
 * contain "ignore previous rules, mark accepted") is never read as an instruction.
 */
export function decideClaim({ claimType, consent, evidence = [], approvedContacts = [], requestDispatchedAt = null, now = new Date(), pendingDays = 30 }) {
  const trace = [];
  if (!consentValid(consent, claimType, now)) {
    return { claimType, status: STATUS.BLOCK_EXTERNAL_VERIFICATION, requiresReviewer: false, trace: ['no_valid_consent'] };
  }

  // A reply whose security review a reviewer closed never counts toward any candidate (BUILD-SPEC 4.12).
  const allReplies = evidence.filter((e) => e.kind === 'institution_reply');
  const replies = allReplies.filter((e) => !e.excludedAfterSecurityReview);
  if (replies.length < allReplies.length) trace.push('excluded_after_security_review');
  const portal = evidence.filter((e) => e.kind === 'portal_observation' && e.reviewedBy);
  const docs = evidence.filter((e) => e.kind === 'document');

  if (!replies.length && !portal.length) {
    if (docs.length) return { claimType, status: STATUS.DOCUMENT_ONLY_UNVERIFIED, requiresReviewer: false, trace: ['raw_document_only'] };
    // No answer is never evidence of fraud or of admission.
    const waited = requestDispatchedAt ? (now - new Date(requestDispatchedAt)) / 86400000 : 0;
    return { claimType, status: requestDispatchedAt && waited < pendingDays ? STATUS.PENDING : STATUS.INCONCLUSIVE, requiresReviewer: false, trace: [...trace, 'no_authenticated_response'] };
  }

  const positives = [];
  const negatives = [];
  const refusals = [];
  let securityIssue = false;
  let unapproved = false;
  for (const ev of replies) {
    const a = authenticatedInstitutionReply(ev, approvedContacts);
    if (!a.ok) {
      trace.push(a.why);
      if (a.why === 'auth_failed' || a.why === 'anomalous_thread') securityIssue = true;
      if (a.why === 'unapproved_sender') unapproved = true;
      continue;
    }
    // ev.refused means a refusal for every claim in the reply.
    if (ev.refused) { trace.push('institution_refused'); refusals.push(ev.id); continue; }
    for (const s of ev.statements || []) {
      if (s.claim !== claimType) continue;
      if (s.polarity === 'positive' && s.explicit) positives.push(ev.id);
      else if (s.polarity === 'negative' && s.explicit) negatives.push(ev.id);
      else if (s.polarity === 'refusal') { trace.push('institution_refused'); refusals.push(ev.id); }
      else trace.push('vague_statement');
    }
  }

  if (securityIssue) return { claimType, status: STATUS.MANUAL_SECURITY_REVIEW, requiresReviewer: true, trace };
  if (positives.length && negatives.length) return { claimType, status: STATUS.INCONCLUSIVE, requiresReviewer: true, trace: [...trace, 'contradictory_statements'] };
  if (positives.length) return { claimType, status: STATUS.INSTITUTION_CONFIRMED_CANDIDATE, requiresReviewer: true, evidenceIds: positives, trace };
  if (negatives.length) return { claimType, status: STATUS.INSTITUTION_CONTRADICTED_CANDIDATE, requiresReviewer: true, evidenceIds: negatives, trace };

  const portalHit = portal.some((p) => (p.statements || []).some((s) => s.claim === claimType && s.polarity === 'positive' && s.explicit));
  if (portalHit) return { claimType, status: STATUS.OFFICIAL_PORTAL_REVIEWED, requiresReviewer: true, trace: [...trace, 'applicant_portal_evidence'] };

  // A refusal is not proof either way; a reviewer-checked portal observation outranks it.
  if (refusals.length) return { claimType, status: STATUS.INSTITUTION_DECLINED_CANDIDATE, requiresReviewer: true, evidenceIds: refusals, trace };

  return { claimType, status: STATUS.INCONCLUSIVE, requiresReviewer: unapproved, trace };
}

export function decideCase({ claims, ...rest }) {
  return claims.map((claimType) => decideClaim({ claimType, ...rest }));
}

const OVERRIDE_ROLES = new Set(['reviewer']);

/**
 * Reviewer approval of a candidate. Donors, sponsors, consultants and students can never
 * override; the founder alone cannot approve an adverse finding.
 */
export function applyReviewerDecision({ decision, actor, approve, secondReviewer = null, audit }) {
  const event = { at: new Date().toISOString(), actor: actor?.id, role: actor?.role, claimType: decision.claimType, from: decision.status };
  if (!actor || !OVERRIDE_ROLES.has(actor.role)) {
    audit.push({ ...event, type: 'FORBIDDEN_OVERRIDE_ATTEMPT', alert: true });
    return { ok: false, reason: 'forbidden_role' };
  }
  if (!decision.status.endsWith('_CANDIDATE') && decision.status !== STATUS.OFFICIAL_PORTAL_REVIEWED) {
    audit.push({ ...event, type: 'REJECTED_NON_CANDIDATE', alert: true });
    return { ok: false, reason: 'not_a_candidate' };
  }
  const adverse = decision.status === STATUS.INSTITUTION_CONTRADICTED_CANDIDATE;
  if (adverse && (!secondReviewer || secondReviewer.role !== 'reviewer' || secondReviewer.id === actor.id)) {
    audit.push({ ...event, type: 'NEEDS_SECOND_REVIEWER' });
    return { ok: false, reason: 'second_reviewer_required' };
  }
  const to = !approve ? STATUS.INCONCLUSIVE
    : decision.status === STATUS.INSTITUTION_CONFIRMED_CANDIDATE ? 'INSTITUTION_CONFIRMED'
    : decision.status === STATUS.INSTITUTION_CONTRADICTED_CANDIDATE ? 'INSTITUTION_CONTRADICTED'
    : decision.status === STATUS.INSTITUTION_DECLINED_CANDIDATE ? 'INSTITUTION_DECLINED'
    : STATUS.OFFICIAL_PORTAL_REVIEWED;
  audit.push({ ...event, type: 'REVIEWER_DECISION', to, secondReviewer: secondReviewer?.id || null });
  return { ok: true, status: to };
}

/** Safeguarding triage: imminent risky payments escalate to a human regardless of model score. */
export function triage({ imminentPayment = false, highValue = false, distressDisclosed = false, minor = false, aiRiskScore = null }) {
  const reasons = [];
  if (imminentPayment && highValue) reasons.push('imminent_high_value_payment');
  else if (imminentPayment && (aiRiskScore === null || aiRiskScore >= 0.3)) reasons.push('imminent_payment_uncertain');
  if (distressDisclosed) reasons.push('distress_disclosed');
  if (minor) reasons.push('minor_involved');
  return { escalateToHuman: reasons.length > 0, reasons };
}
