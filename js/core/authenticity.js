// Authenticity facts for an inbound university reply (BUILD-SPEC 4.9, checks A1 to A15).
// This module computes FACTS and FLAGS only. It never sets a status, never marks anything verified, and the database
// recomputes every fact that grants trust (BUILD-SPEC principle 1). Anything unauthenticated, ambiguous or odd is an
// anomaly, and anomalies only ever push a claim toward manual review, never toward "confirmed".
// Pure and deterministic: time comes in as `receivedAt`, nothing is read from a clock. Never throws.
import { getHeaders } from './mime.js';
import { readTrustedAuthResults, summariseAuth } from './auth-results.js';
import { scanInjection } from './injection.js';
import { classifyReply } from './reply-classifier.js';
import { levenshtein, skeleton, domainLabel, registrableDomain, hasMixedScript, hasFormatChars } from './normalize.js';

export const SOFT_REASONS = Object.freeze(['sender_not_pinned', 'thread_reference_missing', 'dkim_relaxed_only']);
const FIVE_MIN = 5 * 60 * 1000;

/** SHA-256 hex of a string or bytes (Web Crypto). Used for reply-token and body hashes. */
export async function sha256Hex(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hash of a reply token as stored in outbound_requests.reply_token_hash. */
export const hashReplyToken = (token) => sha256Hex(String(token || ''));

const TOKEN_RE = /\bverify\+([0-9a-hjkmnp-tv-z]{20,64})@([a-z0-9.-]+)\b/gi;

/** Find reply tokens in an address string, returning [{ token, domain }]. Case-insensitive; the token is lower-cased. */
export function extractReplyTokens(value, replyDomain) {
  const out = [];
  const rd = String(replyDomain || '').toLowerCase();
  const s = String(value || '');
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(s)) !== null) if (!rd || m[2].toLowerCase() === rd) out.push({ token: m[1].toLowerCase(), domain: m[2].toLowerCase() });
  return out;
}

const domainOf = (addr) => String(addr || '').toLowerCase().split('@').pop();
const sameOrSub = (host, base) => host === base || host.endsWith(`.${base}`);

function hostOfLink(l) {
  const m = /^(?:https?:\/\/)?([^/:?#\s]+)/i.exec(l);
  return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
}

/** Is `senderDomain` a lookalike of any of the `known` domains (and not equal to or a legitimate subdomain)? */
export function lookalikeOf(senderDomain, known) {
  const sd = String(senderDomain || '').toLowerCase();
  const reasons = [];
  if (!sd) return reasons;
  if (sd.split('.').some((l) => l.startsWith('xn--'))) reasons.push('punycode_domain');
  if (hasMixedScript(sd) || /[^\u0000-\u007f]/.test(sd)) reasons.push('non_ascii_domain');
  for (const k0 of known) {
    const k = String(k0 || '').toLowerCase();
    if (!k || sameOrSub(sd, registrableDomain(k)) && registrableDomain(sd) === registrableDomain(k)) continue;
    const sreg = registrableDomain(sd);
    const kreg = registrableDomain(k);
    if (sd.includes(`${k}.`) || sd.includes(`${kreg}.`) || sd.startsWith(`${kreg.split('.')[0]}.`) && sreg !== kreg && domainLabel(sd) === domainLabel(k)) { reasons.push(`embeds_or_shares_name_with:${kreg}`); continue; }
    const a = domainLabel(sd); const b = domainLabel(k);
    if (a && b && a !== b && (skeleton(a) === skeleton(b) || (b.length >= 5 && levenshtein(a, b) <= 2))) reasons.push(`close_to:${kreg}`);
    else if (a && a === b && sreg !== kreg) reasons.push(`same_name_other_suffix:${kreg}`);
  }
  return [...new Set(reasons)];
}

/**
 * checkAuthenticity({ message, request, contacts, config, receivedAt, tokenHash, replay, classification, envelope })
 *
 *  message        mime.js parseMessage() result
 *  request        { state, messageIdHeader, sentAt (ms), replyWindowUntil (ms|null), contactPointId, caseRef, replyTokenHash } or null
 *  contacts       approved email contacts of the case's institution: [{ id, address }]
 *  config         { trustedAuthservId, replyDomain, officialDomains[], ownDomains[], consentRevokedAt (ms|null) }
 *  receivedAt     ms
 *  tokenHash      hashReplyToken() of the token taken from the envelope recipient (caller computes; may be '')
 *  replay         { rawSha256Seen, messageIdSeenForCase, bodySeenOnOtherCase } booleans from the database
 *  classification optional classifyReply() output (computed here if absent)
 *  envelope       { from, to } SMTP envelope strings
 *
 * Returns { checks, anomalies[], softFlags[], riskFlags[], anomalous, facts, aiAllowed, analysisAllowed, evidence }.
 * `evidence` is shaped for decideClaim: { from, auth: { dkim, dmarc }, anomalous }.
 */
export function checkAuthenticity(input = {}) {
  const anomalies = new Set();
  const soft = new Set();
  const risk = new Set();
  const checks = {};
  const set = (id, pass, detail = '') => { checks[id] = { pass: !!pass, detail }; };
  try {
    const { message = {}, request = null, contacts = [], config = {}, receivedAt = null, tokenHash = '', replay = {}, envelope = {} } = input;
    const fromList = Array.isArray(message.from) ? message.from : [];
    const flags = new Set(message.flags || []);
    const fromAddr = fromList.length === 1 ? fromList[0].address : '';
    const fromDomain = fromAddr ? domainOf(fromAddr) : '';

    // A1 single From address, no different Sender
    const senderDiff = (message.sender || []).some((s) => s.address !== fromAddr);
    const a1 = fromList.length === 1 && !(message.fromInvalid || []).length && !flags.has('duplicate_from') && !senderDiff;
    set('A1', a1, a1 ? '' : `from_count=${fromList.length};invalid=${(message.fromInvalid || []).length};sender_mismatch=${senderDiff};duplicate_from=${flags.has('duplicate_from')}`);
    if (!a1) anomalies.add('multiple_or_sender_mismatch');
    if (flags.has('header_injection')) anomalies.add('header_injection');
    for (const f of ['duplicate_date', 'duplicate_message-id', 'duplicate_reply-to', 'duplicate_subject']) if (flags.has(f)) anomalies.add('duplicate_singleton_header');
    if (flags.has('space_before_colon')) soft.add('space_before_colon');
    if (/[^\u0000-\u007f]/.test(fromAddr) || fromDomain.split('.').some((l) => l.startsWith('xn--'))) { anomalies.add('idn_sender'); }

    // A2 exact pinned address; A3 same contact as the request
    const approved = (Array.isArray(contacts) ? contacts : []).filter((c) => c && c.address);
    const matched = fromAddr ? approved.find((c) => String(c.address).toLowerCase() === fromAddr) : null;
    set('A2', !!matched, matched ? '' : 'sender_not_pinned');
    if (!matched) soft.add('sender_not_pinned');
    if (matched && request && request.contactPointId != null) {
      const same = String(matched.id) === String(request.contactPointId);
      set('A3', same, same ? '' : 'different_pinned_contact');
      if (!same) anomalies.add('different_pinned_contact');
    } else set('A3', !matched ? false : !request ? false : true, matched ? '' : 'no_pinned_match');
    if (fromAddr) {
      const known = [...approved.map((c) => domainOf(c.address)), ...(config.officialDomains || [])];
      const look = lookalikeOf(fromDomain, known);
      if (look.length && !matched) { anomalies.add('lookalike_sender_domain'); risk.add('impersonation'); checks.lookalike = { pass: false, detail: look.join(',') }; }
      else if (!matched && approved.some((c) => registrableDomain(domainOf(c.address)) === registrableDomain(fromDomain))) soft.add('same_domain_different_mailbox');
      if ((config.ownDomains || []).some((d) => sameOrSub(fromDomain, String(d).toLowerCase()))) { anomalies.add('from_our_own_domain'); }
    }

    // A4 trusted A-R, A5 DKIM alignment, A6 DMARC
    const trustedRes = readTrustedAuthResults(message.headers || [], { trustedAuthservId: config.trustedAuthservId });
    const auth = summariseAuth(trustedRes, fromDomain);
    set('A4', trustedRes.trusted, trustedRes.reason);
    set('A5', auth.dkim === 'pass', auth.dkim === 'pass' ? '' : auth.dkimRelaxedOnly ? 'dkim_relaxed_only' : auth.dkimOtherDomainPass ? 'dkim_pass_for_other_domain' : `dkim_${auth.dkim}`);
    set('A6', auth.dmarc === 'pass', `dmarc_${auth.dmarc}`);
    if (auth.dkimRelaxedOnly) soft.add('dkim_relaxed_only');
    if (auth.dkimOtherDomainPass) { soft.add('dkim_pass_for_other_domain'); risk.add('impersonation'); }
    // DKIM pass proves a domain signed the message, nothing more: pinning needs the aligned pass too.
    const pinnedByDkim = !!matched && auth.dkim === 'pass';

    // A7 case token, A8 request state
    const toTokens = [...extractReplyTokens(envelope.to, config.replyDomain), ...(message.to || []).flatMap((a) => extractReplyTokens(a.address, config.replyDomain))];
    const distinct = new Set(toTokens.map((t) => t.token));
    const envTokens = new Set(extractReplyTokens(envelope.to, config.replyDomain).map((t) => t.token));
    const hdrTokens = new Set((message.to || []).flatMap((a) => extractReplyTokens(a.address, config.replyDomain)).map((t) => t.token));
    const tokenOk = !!request && !!tokenHash && tokenHash === request.replyTokenHash && envTokens.size === 1 && (hdrTokens.size === 0 || (hdrTokens.size === 1 && [...hdrTokens][0] === [...envTokens][0]));
    set('A7', tokenOk, tokenOk ? '' : !request ? 'no_case_link' : distinct.size > 1 ? 'multiple_tokens' : 'token_hash_mismatch');
    if (!request) anomalies.add('no_matching_request');
    else if (!tokenOk) anomalies.add(distinct.size > 1 || (envTokens.size === 1 && hdrTokens.size === 1 && [...envTokens][0] !== [...hdrTokens][0]) ? 'token_mismatch' : 'no_matching_request');
    set('A8', !!request && request.state === 'sent', request ? `state=${request.state}` : 'no_request');
    if (request && request.state !== 'sent') anomalies.add('no_matching_request');

    // A9 thread reference (soft)
    const refs = new Set([...(message.references || []), message.inReplyTo].filter(Boolean));
    const threadOk = !!request && !!request.messageIdHeader && refs.has(request.messageIdHeader);
    set('A9', threadOk, threadOk ? '' : 'thread_reference_missing');
    if (!threadOk) soft.add('thread_reference_missing');
    if (request && request.messageIdHeader && message.messageId === request.messageIdHeader) anomalies.add('reflected_own_message');

    // A10 freshness
    let fresh = true;
    if (message.dateMs == null) { fresh = false; anomalies.add('date_missing_or_invalid'); }
    else {
      if (request && request.sentAt != null && message.dateMs < request.sentAt - FIVE_MIN) { fresh = false; anomalies.add('reply_predates_request'); }
      if (receivedAt != null && message.dateMs > receivedAt + FIVE_MIN) { fresh = false; anomalies.add('future_dated'); }
    }
    if (request && request.replyWindowUntil != null && receivedAt != null && receivedAt > request.replyWindowUntil) { fresh = false; anomalies.add('reply_after_window'); }
    set('A10', fresh, fresh ? '' : 'freshness_failed');

    // A11 replay
    const rp = replay || {};
    const replayed = !!(rp.rawSha256Seen || rp.messageIdSeenForCase || rp.bodySeenOnOtherCase);
    set('A11', !replayed, replayed ? Object.keys(rp).filter((k) => rp[k]).join(',') : '');
    if (rp.rawSha256Seen || rp.messageIdSeenForCase) anomalies.add('duplicate_message');
    if (rp.bodySeenOnOtherCase) anomalies.add('replayed_content');

    // A12 Reply-To and display name
    const rt = message.replyTo || [];
    const rtOk = rt.length === 0 || (rt.length === 1 && rt[0].address === fromAddr);
    if (!rtOk) anomalies.add('reply_to_mismatch');
    const nameBad = fromList.some((a) => {
      const emails = String(a.name || '').match(/[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi) || [];
      return emails.some((e) => e.toLowerCase() !== a.address) || hasFormatChars(a.name) || /\b(?:[a-z0-9-]+\.)+(?:com|org|net|edu|ac\.[a-z]{2}|co\.[a-z]{2}|[a-z]{2})\b/i.test(a.name) && !new RegExp(`\\b${fromDomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(a.name);
    });
    if (nameBad) anomalies.add('display_name_spoof');
    set('A12', rtOk && !nameBad, `${rtOk ? '' : 'reply_to_mismatch;'}${nameBad ? 'display_name_spoof' : ''}`);
    if (envelope.from && fromDomain && domainOf(envelope.from.replace(/[<>]/g, '')) !== fromDomain) soft.add('envelope_from_mismatch');

    // A13 compromise indicators, A14 injection (computed on text and hidden HTML text)
    const cls = input.classification || classifyReply({ text: message.text || '', askedClaims: input.askedClaims || [], headers: message.headers || [], from: fromAddr, subject: message.subject || '', isReport: !!message.isReport, pinnedAddress: matched ? matched.address : '', hiddenText: message.hiddenText || '' });
    const official = [...(config.officialDomains || []), ...(config.ownDomains || []), ...approved.map((c) => domainOf(c.address))].map((d) => String(d).toLowerCase()).filter(Boolean);
    const badLinks = (cls.flags.links || []).filter((l) => { const h = hostOfLink(l); return !h || !official.some((d) => sameOrSub(h, d)); });
    const badAttach = (message.attachments || []).filter((a) => !(a.kind === 'pdf' || a.kind === 'image') || /^(?:exe|scr|js|jar|bat|cmd|com|vbs|msi|apk|html?|zip|rar|iso|lnk|docm|xlsm|svg)$/i.test(a.extension || '') || (a.kind === 'pdf' && a.extension && a.extension !== 'pdf') || (a.kind === 'image' && a.extension && !/^(png|jpe?g|gif|webp|heic)$/.test(a.extension)));
    const compromise = [cls.flags.payment_request && 'payment_request', cls.flags.urgency && 'urgency', badLinks.length && 'external_link', badAttach.length && 'attachment_type'].filter(Boolean);
    set('A13', compromise.length === 0, compromise.join(','));
    if (compromise.length) { anomalies.add('compromise_indicators'); risk.add('compromise_indicators'); }
    if (cls.flags.payment_request) risk.add('payment_request');
    if (cls.flags.contact_change) risk.add('contact_change');
    // reply to a different case: any case reference other than ours in the subject or the unquoted text
    const refsSeen = new Set((`${message.subject || ''}\n${cls.analysedText || ''}`.match(/\bTP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}\b/gi) || []).map((x) => x.toUpperCase()));
    if (request && request.caseRef && [...refsSeen].some((x) => x !== String(request.caseRef).toUpperCase())) anomalies.add('different_case_reference');
    const inj = scanInjection({ text: message.text || '', hiddenText: message.hiddenText || '', subject: message.subject || '', filenames: (message.attachments || []).map((a) => a.filename) });
    set('A14', !inj.suspicious, inj.rules.join(','));
    if (inj.suspicious) { anomalies.add('injection_pattern'); risk.add('injection'); }

    // A15 after revocation
    const revoked = config.consentRevokedAt != null && receivedAt != null && config.consentRevokedAt <= receivedAt;
    set('A15', !revoked, revoked ? 'after_consent_revoked' : '');
    if (revoked) soft.add('after_consent_revoked');

    // A message that cannot be parsed or is flagged unsafe by the parser is an anomaly in its own right.
    if (message.ok === false) anomalies.add('unparseable_message');
    if (flags.has('too_many_parts') || flags.has('too_deep') || flags.has('multipart_boundary_missing')) anomalies.add('malformed_mime');

    const anomalyList = [...anomalies].sort();
    const anomalous = anomalyList.some((r) => !SOFT_REASONS.includes(r));
    return {
      checks, anomalies: anomalyList, softFlags: [...soft].sort(), riskFlags: [...risk].sort(), anomalous,
      facts: {
        fromAddress: fromAddr, fromDomain, matchedContactId: matched ? matched.id : null, pinnedByDkim,
        auth: { trusted: trustedRes.trusted, trustReason: trustedRes.reason, spf: auth.spf, dkim: auth.dkim, dmarc: auth.dmarc, dkimDomains: (trustedRes.dkim || []).map((d) => d.d) },
        tokenOk, threadOk, classification: { kind: cls.kind, flags: cls.flags },
      },
      aiAllowed: !inj.suspicious && !revoked && !anomalous && cls.kind === 'answer',
      analysisAllowed: !revoked,
      // for decideClaim: `dkim`/`dmarc` are "pass" ONLY for an aligned pass from the trusted server
      evidence: { from: fromAddr, auth: { dkim: auth.dkim, dmarc: auth.dmarc }, anomalous },
    };
  } catch {
    return { checks, anomalies: ['checker_error'], softFlags: [], riskFlags: [], anomalous: true, facts: { fromAddress: '', fromDomain: '', matchedContactId: null, pinnedByDkim: false, auth: { trusted: false, trustReason: 'error', spf: 'unknown', dkim: 'unknown', dmarc: 'unknown', dkimDomains: [] }, tokenOk: false, threadOk: false, classification: { kind: 'unrelated', flags: {} } }, aiAllowed: false, analysisAllowed: false, evidence: { from: '', auth: { dkim: 'unknown', dmarc: 'unknown' }, anomalous: true } };
  }
}
