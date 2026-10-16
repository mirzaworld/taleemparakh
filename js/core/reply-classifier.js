// Rules-first classifier for university replies (BUILD-SPEC 4.10). It produces SUGGESTED statements only.
// It never sets a status; the deterministic engine and human reviewers decide. Design stance:
//   * silence, refusal, ambiguity, conditions, hedges, contrast, injection text => never an explicit positive;
//   * an uncertain genuine reply becomes amber (unclear or explicit:false), never green;
//   * quoted original text, our own template text and instructions inside the email are data, not answers.
// Pure, deterministic, never throws, no I/O.
import { stripFormat } from './normalize.js';
import { scanInjection } from './injection.js';
import { CLAIM_BY_QUESTION, CLAIM_TYPES_ASKED } from './claims.js';

export const CLASSIFIER_VERSION = 'rules-1';
const MAX_TEXT_CHARS = 100000; // bounded work on hostile input; anything beyond is ignored

const POLARITIES = ['positive', 'negative', 'refusal', 'unclear'];
export { POLARITIES };

// ---------- phrase lists (fixed, English) ----------
const NEG_WORDS = /\b(?:not|no|never|unable|cannot|can't|cant|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't|didn't|don't|doesn't|won't|without|neither|nor|none|nothing|unfortunately|fail(?:ed)?|unlikely)\b/i;
const HEDGES = /\b(?:may|might|could|should|probably|possibly|perhaps|believe|think|appears?|seems?|likely|expected|expects?|will be|would|pending|provisional(?:ly)?|tentative(?:ly)?|subject to|provided|if|unless|once|until|as long as|on condition|conditional(?:ly)?|depends?|depending|in principle|we hope|hopefully|so far|as far as)\b/i;
const CONTRAST = /\b(?:but|however|although|though|except|whereas|while|yet|nevertheless|nonetheless|on the other hand)\b/i;
// Reported or quoted speech: the university may be repeating what the applicant or consultant claimed, not saying it.
const ATTRIBUTION = /\b(?:you|applicant|student|consultant|agent|candidate|he|she|they|someone|somebody|sender|email|message|letter|document)\s+(?:said|says|wrote|writes|stated|states|claim(?:s|ed)?|mention(?:s|ed)?|told|alleges?|alleged)\b|\baccording to\b|\bas (?:stated|claimed|mentioned|per|shown in|written in)\b|\bso[- ]called\b|\bpurports?\b|\bsupposed(?:ly)?\b|\ballegedly\b/i;
const SUBJECT_REQUEST = /^(?:please|kindly|could you|can you|would you|do you|did you|are you|is there|we (?:ask|request|need|require)|you (?:must|should|need|are asked))\b/i;

const POSITIVE = {
  application_received: [
    /\bwe (?:have|hold|can confirm (?:that )?we have|do have) (?:received|a record of|an? record of|on file) (?:an?|your|the|his|her|their|this|that) application\b/i,
    /\b(?:an?|the|your|his|her|their|this) application (?:was|has been|is) (?:received|recorded|on file|on record|logged|registered)\b/i,
    /\bwe (?:have|hold|can see) (?:an?|the) application (?:record|on file|under|for|from|with)\b/i,
    /\bour records (?:show|confirm|indicate|contain) (?:that )?(?:an?|the) application\b/i,
  ],
  admission_granted: [
    /\b(?:an?|the|this) (?:unconditional |conditional )?offer(?: of (?:admission|a place))? (?:was|has been) (?:issued|made|sent|extended|given)\b/i,
    /\bwe (?:issued|made|sent|extended|have issued|have made|have sent) (?:an?|the|this) (?:unconditional |conditional )?offer\b/i,
    /\b(?:the )?(?:applicant|student|he|she|they) (?:was|has been) (?:admitted|offered a place|made an offer)\b/i,
    /\b(?:this|the) (?:offer|admission|admission letter|offer letter|letter) (?:is|was) (?:genuine|authentic|issued by us|valid)\b/i,
    /\bwe (?:confirm|can confirm) (?:that )?(?:an? |the )?(?:offer|admission)\b/i,
  ],
  scholarship_awarded: [
    /\b(?:the |this |a )?(?:scholarship|bursary|award) (?:was|has been|is) (?:awarded|granted|approved|offered|confirmed)\b/i,
    /\b(?:was|has been|were) (?:awarded|granted|offered) (?:an?|the) (?:\w+ ){0,3}(?:scholarship|bursary)\b/i,
    /\bwe (?:awarded|granted|have awarded|have granted) (?:an?|the|this) (?:\w+ ){0,3}(?:scholarship|bursary)\b/i,
  ],
  agent_authorized: [
    /\b(?:is|are) (?:an? |our )?(?:authori[sz]ed|official|approved|appointed|accredited|registered) (?:representative|agent|recruitment partner|partner|consultant)s?\b/i,
    /\b(?:is|are) (?:one of )?our (?:authori[sz]ed|official|approved|appointed) (?:representative|agent|partner)s?\b/i,
  ],
  deposit_instruction_authentic: [
    /\b(?:these|the|those) (?:payment|bank|account) details(?: \w+){0,4} (?:are|is) (?:ours|correct|genuine|official|authentic|valid)\b/i,
    /\b(?:this|the) (?:bank )?account (?:is|belongs to) (?:ours|our|the university|the college|official)\b/i,
    /\b(?:are|is) our (?:official|genuine|authentic|correct) (?:bank|account|payment)\b/i,
  ],
};

const NEGATIVE = {
  application_received: [
    /\b(?:no record of|(?:do not|don't|did not|didn't|have not|haven't|cannot|can't) (?:have|hold|find|see|locate|received?) (?:any |an? |the )?(?:record|application|trace))/i,
    /\bapplication (?:has not|hasn't|was not|wasn't|had not) (?:been )?(?:received|recorded|logged|found)\b/i,
    /\bwe (?:have|hold) no (?:record|application|trace)\b/i,
  ],
  admission_granted: [
    /\b(?:no|not) (?:such )?(?:an? )?(?:offer|admission)(?: (?:was|has been|exists?|issued))?\b/i,
    /\b(?:did not|didn't|have not|haven't|has not|hasn't|do not|don't) (?:issue|make|send|extend|give|offer)(?:d)? (?:an?|any|the|this|that)? ?(?:\w+ ){0,2}(?:offer|admission|letter)\b/i,
    /\b(?:offer|letter|admission)(?: letter)? (?:was not|wasn't|has not been|hasn't been|is not|isn't) (?:issued|made|sent|genuine|authentic|valid|ours|from us)\b/i,
    /\b(?:forged|forgery|fake|fraudulent|counterfeit|not genuine|not authentic|did not originate)\b/i,
  ],
  scholarship_awarded: [
    /\b(?:no|not) (?:such )?(?:a )?(?:scholarship|bursary|award)(?: (?:was|has been|exists?|awarded))?\b/i,
    /\b(?:did not|didn't|have not|haven't|has not|hasn't|do not|don't) (?:award|grant|offer)(?:ed)? (?:an?|any|the|this|that)? ?(?:\w+ ){0,2}(?:scholarship|bursary)\b/i,
    /\b(?:scholarship|bursary) (?:was not|wasn't|has not been|hasn't been|is not|isn't) (?:awarded|granted|approved|offered|genuine)\b/i,
  ],
  agent_authorized: [
    /\b(?:is|are) not (?:an? |our )?(?:authori[sz]ed|official|approved|appointed|accredited|registered)(?: (?:representative|agent|partner))?s?\b/i,
    /\b(?:not|never) (?:one of )?our (?:authori[sz]ed |official |approved )?(?:representative|agent|partner)s?\b/i,
    /\bno (?:agent|representative|partnership|relationship)\b[^.]{0,30}\b(?:with|of|for) (?:us|our|the university)\b/i,
  ],
  deposit_instruction_authentic: [
    /\bnot our (?:account|bank|payment|official|details)\b/i,
    /\b(?:these|the|those) (?:payment|bank|account) details(?: \w+){0,4} (?:are|is) not (?:ours|correct|genuine|official|authentic|valid)\b/i,
    /\b(?:this|the) (?:bank )?account (?:is not|does not belong to|doesn't belong to) (?:ours|our|the university|us)\b/i,
    /\b(?:never|do not|don't|does not) (?:ask|request|accept|require)s? (?:payments?|fees?|deposits?)\b[^.]{0,40}\b(?:personal|third|individual|private|this) (?:account|party|bank)/i,
  ],
};

const TOPIC = {
  application_received: /\b(?:applications?|applied)\b/i,
  admission_granted: /\b(?:offer|admission|admitted|place|letter|cas|i-?20|coe|enrol?lment)\b/i,
  scholarship_awarded: /\b(?:scholarship|bursary|funding|award(?:ed)?|stipend|fee waiver)\b/i,
  agent_authorized: /\b(?:agent|representative|consultant|recruitment|partner|authori[sz]ed|company)\b/i,
  deposit_instruction_authentic: /\b(?:payment|bank|account|iban|deposit|fee|fees|beneficiary|transfer)\b/i,
};

const DECLINE_PHRASE = /\bwe (?:are |is )?(?:unable|not able|not permitted|not allowed|not in a position|not authori[sz]ed|prohibited|restricted|cannot|can not|can't|cant|do not|don't|will not|won't|are unable|decline|must decline|regret that we cannot|are not able)(?: to)? (?:share|disclose|confirm|verify|release|provide|comment(?: on)?|discuss|give|supply|answer|respond|validate|authenticate)\b|\b(?:policy|rules?|regulations?|ferpa|gdpr|data protection)\b[^.\n]{0,50}\b(?:prevents?|prohibits?|does not allow|do not allow|forbids?|restricts?)\b[^.\n]{0,30}\b(?:us|disclos|shar|confirm)/i;
const DECLINE_LINE = /^[\s*_"'(\[]*decline[d]?[\s*_"')\].!]*$/i;

// our own template lines, blanked out if a mail client echoes them without quote markers
const TEMPLATE_LINES = [
  /^\s*dear admissions team\b/i, /an applicant has asked taleemparakh/i, /the applicant authori[sz]ed this request/i,
  /^\s*please answer each question\b/i, /^\s*if you cannot share this with us\b/i, /^\s*we will not treat a refusal\b/i,
  /^\s*we will never ask for passwords\b/i, /^\s*(?:applicant name|email used to apply|application reference|programme and intake|our case reference)\b.*:/i,
  /taleemparakh test system/i, /^\s*\[?(?:simulation|controlled test)\]?\b/i, /^\s*you can see their authori[sz]ation here\b/i,
  /^\s*https?:\/\/\S*consent-view\S*\s*(?:\(.*\))?\s*$/i, /\(shows the consent text\b/i, /^\s*this is a reminder of our request\b/i,
  /^\s*q[1-5]\b[^:\n]{0,80}:\s*$/i,
];

const ANSWER_LINE = /^[ \t]*q[ \t]*([1-5])\b[^:\n]{0,80}:[ \t]*(yes|no|cannot say|can not say|can't say|decline)\b(.*)$/gim;

const norm = (s) => stripFormat(String(s == null ? '' : s)).normalize('NFKC').replace(/\r\n?/g, '\n').replace(/[ \t\u{a0}]+/gu, ' ');

/** Cut at our marker line, the first quoted line, "On ... wrote:", Outlook headers or "Original Message". Returns the kept text. */
export function cutReply(text) {
  const lines = String(text).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*-{2,}\s*taleemparakh request\b/i.test(l)) break;
    if (/^\s*>/.test(l)) break;
    if (/^\s*on\b.{3,200}\bwrote\s*:\s*$/i.test(l)) break;
    if (/^\s*on\b.{3,120}$/i.test(l) && /\bwrote\s*:\s*$/i.test(lines[i + 1] || '')) break;
    if (/^\s*-{2,}\s*(?:original message|forwarded message|reply above)/i.test(l)) break;
    if (/^\s*_{10,}\s*$/.test(l) && /^\s*from\s*:/i.test(lines[i + 1] || '')) break;
    if (/^\s*from\s*:/i.test(l) && /^\s*(?:sent|date)\s*:/i.test(lines[i + 1] || '')) break;
    out.push(l);
  }
  return out.join('\n');
}

function headerLookup(headers) {
  const map = {};
  if (Array.isArray(headers)) for (const h of headers) { if (h && h.lname && !(h.lname in map)) map[h.lname] = String(h.value || ''); }
  else if (headers && typeof headers === 'object') for (const [k, v] of Object.entries(headers)) map[k.toLowerCase()] = String(v ?? '');
  return map;
}

function sentencesOf(text) {
  const out = [];
  const re = /[^.!?\n]+(?:[.!?]+|(?=\n)|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    const trimmed = raw.trim();
    if (trimmed.length < 3) { if (m[0] === '') re.lastIndex++; continue; }
    const start = m.index + raw.indexOf(trimmed[0]);
    out.push({ text: trimmed, span: [start, start + trimmed.length] });
    if (m[0] === '') re.lastIndex++;
  }
  return out;
}

const wordsAround = (sentence, mStart, mEnd, n = 6) => {
  const before = sentence.slice(0, mStart).split(/\s+/).filter(Boolean).slice(-n).join(' ');
  const after = sentence.slice(mEnd).split(/\s+/).filter(Boolean).slice(0, n).join(' ');
  const inside = sentence.slice(mStart, mEnd);
  return { before, after, inside };
};

const ADDRESS = /[a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

function scanFlags(text, { from, pinnedAddress }) {
  const flags = { contact_change: false, payment_request: false, links: [], urgency: false, injection: false };
  const low = text.toLowerCase();
  const pinned = String(pinnedAddress || from || '').toLowerCase();
  const verbs = /\b(?:write|reply|respond|contact|email|e-mail|send|forward|direct)\b[^.\n]{0,20}\b(?:us |me |them |your \w+ )?(?:at|to|on|via)\b[^.\n]{0,15}?([a-z0-9._%+'-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;
  let m;
  while ((m = verbs.exec(low)) !== null) if (m[1] !== pinned) flags.contact_change = true;
  // Any address on a domain other than the checked contact's is a possible redirection (amber, never a statement).
  const pinnedDomain = pinned.split('@')[1] || '';
  if (pinnedDomain) {
    for (const a of low.matchAll(/[a-z0-9._%+'-]+@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/g)) {
      const d = a[1];
      if (d !== pinnedDomain && !d.endsWith(`.${pinnedDomain}`) && !pinnedDomain.endsWith(`.${d}`)) flags.contact_change = true;
    }
  }
  if (/\bnew (?:[a-z-]+ ){0,2}(?:e-?mail|email|contact|reply)(?: address)?\b|\bnew (?:[a-z-]+ ){0,2}address\b|\baddress (?:has been |was |is )?(?:updated|changed)\b|\b(?:e-?mail|address|contact) (?:has|have) (?:changed|moved)\b|\bfrom now on\b[^.\n]{0,30}\b(?:use|write|contact|send|email)\b|\bplease use\b[^.\n]{0,40}@[^.\n]{0,40}\binstead\b|\bupdated? (?:our )?(?:e-?mail|contact) (?:address|details)\b|\bmoved to (?:a )?new (?:e-?mail|address|domain)\b/i.test(low)) flags.contact_change = true;
  if (/\b(?:please )?(?:transfer|pay|send|deposit|wire|remit)\b[^.\n]{0,60}\b(?:fee|fees|deposit|amount|payment|money|usd|gbp|pkr|eur|aud|cad|dollars?|pounds?|rupees?)\b|\b(?:bank|account|wire) (?:details|number|transfer)\b|\biban\b|\baccount (?:no|number)\b|\bswift\b|\bwestern union\b|\bmoneygram\b|\beasypaisa\b|\bjazzcash\b|\bcrypto|\bbitcoin\b|\bgift cards?\b|\bsort code\b/i.test(low)
    || /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/.test(text) || /\b(?:\$|£|€|usd|gbp|pkr)\s?\d[\d,]{2,}/i.test(low) && /\b(?:pay|transfer|deposit|send)\b/i.test(low)) flags.payment_request = true;
  if (/\b(?:urgent(?:ly)?|immediately|asap|right away|within \d+ (?:hours?|days?)|today only|last chance|final notice|act now|deadline (?:is )?(?:today|tomorrow)|expires? (?:today|tomorrow)|time[- ]sensitive|before it'?s too late)\b/i.test(low)) flags.urgency = true;
  const links = new Set();
  const urls = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]{3,300}/gi;
  while ((m = urls.exec(text)) !== null && links.size < 20) links.add(m[0].replace(/[.,;:!?]+$/, ''));
  flags.links = [...links];
  return flags;
}

function hasNegationNear(sentence, mStart, mEnd) {
  const { before, after, inside } = wordsAround(sentence, mStart, mEnd, 6);
  return NEG_WORDS.test(before) || NEG_WORDS.test(after) || NEG_WORDS.test(inside);
}

/**
 * classifyReply({ text, askedClaims, headers, from, subject, isReport, pinnedAddress })
 *  -> { version, kind, statements[{claim,polarity,explicit,rule,span,conditional?,note?}], conditions[], flags, analysedText, notes[] }
 * `headers` may be mime.js headers (array of {lname,value}) or a plain object. `askedClaims` are claim_type values.
 */
export function classifyReply({ text = '', askedClaims = [], headers = null, from = '', subject = '', isReport = false, pinnedAddress = '', hiddenText = '' } = {}) {
  const result = { version: CLASSIFIER_VERSION, kind: 'answer', statements: [], conditions: [], flags: { contact_change: false, payment_request: false, links: [], urgency: false, injection: false }, analysedText: '', notes: [] };
  try {
    const asked = [...new Set((Array.isArray(askedClaims) ? askedClaims : []).filter((c) => CLAIM_TYPES_ASKED.includes(c)))];
    const h = headerLookup(headers);
    const fromAddr = String(from || h.from || '').toLowerCase();
    const subj = String(subject || h.subject || '');
    const ct = (h['content-type'] || '').toLowerCase();

    // R-BOUNCE
    if (isReport || /^\s*multipart\/report\b/.test(ct) || /(?:^|[<\s])(?:mailer-daemon|postmaster)@/i.test(fromAddr)) { result.kind = 'bounce'; result.notes.push('R-BOUNCE'); return result; }
    // R-OOO: any auto-reply marker wins; an auto-reply never produces statements
    const auto = (h['auto-submitted'] || '').trim().toLowerCase();
    if ((auto && auto !== 'no') || 'x-autoreply' in h || 'x-autorespond' in h || /^(?:auto_reply|auto-reply|bulk)$/i.test((h.precedence || '').trim()) || /\b(?:out of (?:the )?office|automatic reply|auto-?reply|autoreply|away from (?:the )?office|undeliverable|delivery (?:status )?(?:notification|failure))\b/i.test(subj)) {
      result.kind = /undeliverable|delivery (?:status )?(?:notification|failure)/i.test(subj) ? 'bounce' : 'out_of_office';
      result.notes.push(result.kind === 'bounce' ? 'R-BOUNCE' : 'R-OOO');
      return result;
    }

    let body = cutReply(norm(String(text == null ? '' : text).slice(0, MAX_TEXT_CHARS)));
    // blank our own template lines if a client echoed them without quote markers (same length, spans stay valid)
    body = body.split('\n').map((l) => (TEMPLATE_LINES.some((re) => re.test(l)) && !/^\s*q\s*[1-5]\b[^:\n]{0,80}:\s*(?:yes|no|cannot say|decline)\b/i.test(l) ? ' '.repeat(l.length) : l)).join('\n');
    result.analysedText = body;

    result.flags = scanFlags(body, { from: fromAddr, pinnedAddress });
    const inj = scanInjection({ text: `${String(text == null ? '' : text)}\n${body}`, subject: subj, hiddenText });
    result.flags.injection = inj.suspicious;

    const found = []; // { claim, polarity, explicit, rule, span, conditional }
    const answered = new Set();

    // R-ANSWER-LINE
    ANSWER_LINE.lastIndex = 0;
    let m;
    while ((m = ANSWER_LINE.exec(body)) !== null) {
      const claim = CLAIM_BY_QUESTION[Number(m[1])];
      if (!asked.includes(claim)) { result.notes.push(`unasked_question_Q${m[1]}`); continue; }
      const word = m[2].toLowerCase().replace(/\s+/g, ' ');
      const rest = (m[3] || '').trim();
      const restHead = rest.slice(0, 120);
      const span = [m.index + m[0].indexOf(m[2]), m.index + m[0].length];
      let polarity = word === 'yes' ? 'positive' : word === 'no' ? 'negative' : word === 'decline' ? 'refusal' : 'unclear';
      let explicit = polarity === 'positive' || polarity === 'negative';
      let conditional = false;
      // echoed option list ("YES / NO", "YES, NO or CANNOT SAY") is an unanswered question, not an answer
      if (/^\s*(?:[/,|]|or\b|and\b|\\)\s*(?:yes|no|cannot say|can't say|decline)\b\s*(?:[/,|.)]|or\b|and\b|$)/i.test(rest) || /^\s*(?:yes|no|cannot say|can't say)\b/i.test(rest)) { polarity = 'unclear'; explicit = false; result.notes.push('echoed_options'); }
      else if (explicit) {
        if (HEDGES.test(restHead) || CONTRAST.test(restHead)) { explicit = false; conditional = /\b(?:subject to|provided|if|unless|once|until|as long as|on condition|conditional(?:ly)?|pending|depends?|depending)\b/i.test(restHead); result.notes.push('qualified_answer'); }
        else if (polarity === 'positive' && NEG_WORDS.test(restHead) && !/\b(?:no|not|without) (?:further |other |additional )?(?:conditions?|fees?|deposit|charges?|issues?|problems?|concerns?)\b/i.test(restHead)) { explicit = false; result.notes.push('qualified_answer'); }
        if (conditional) result.conditions.push(restHead);
      }
      if (inj.suspicious) explicit = false;
      found.push({ claim, polarity, explicit, rule: 'R-ANSWER-LINE', span, ...(conditional ? { conditional: true } : {}) });
      answered.add(claim);
    }

    // stand-alone DECLINE line: refusal for every asked claim that has no answer line
    const bodyLines = body.split('\n');
    let offset = 0;
    let declineLine = false;
    for (const l of bodyLines) { if (DECLINE_LINE.test(l)) { declineLine = true; for (const c of asked) if (!answered.has(c)) { found.push({ claim: c, polarity: 'refusal', explicit: false, rule: 'R-DECLINE', span: [offset, offset + l.length] }); answered.add(c); } } offset += l.length + 1; }

    // phrase rules, sentence by sentence
    const sents = sentencesOf(body);
    const phrase = { positive: {}, negative: {} };
    const sentenceClaims = (s) => asked.filter((c) => TOPIC[c].test(s.text));
    for (const s of sents) {
      if (/\?\s*$/.test(s.text) || SUBJECT_REQUEST.test(s.text) || /^\s*q\s*[1-5]\b/i.test(s.text)) continue; // questions, requests, answer lines
      for (const claim of asked) {
        for (const [pol, table] of [['positive', POSITIVE], ['negative', NEGATIVE]]) {
          for (const re of table[claim]) {
            const mm = re.exec(s.text);
            if (!mm) continue;
            const ms = mm.index; const me = mm.index + mm[0].length;
            const negated = pol === 'positive' && hasNegationNear(s.text, ms, me);
            // deny phrases are themselves negations; for them only a "not ... not" double negative is suspicious
            const doubleNeg = pol === 'negative' && /\b(?:cannot|can't|unable to)\s+(?:say|confirm|verify)\b/i.test(s.text);
            const topics = sentenceClaims(s);
            if (negated) { result.notes.push(`negated_positive_dropped:${claim}`); continue; }
            const quoted = (s.text.slice(0, ms).match(/["\u{201c}\u{201d}]/gu) || []).length % 2 === 1;
            const record = { sentence: s, span: [s.span[0] + ms, s.span[0] + me], negated: negated || doubleNeg, hedged: HEDGES.test(s.text) || ATTRIBUTION.test(s.text) || quoted, contrast: CONTRAST.test(s.text), multiTopic: topics.length > 1 };
            ((phrase[pol][claim] = phrase[pol][claim] || [])).push(record);
            break; // one match per sentence per polarity per claim
          }
        }
      }
    }

    // decline phrases scoped to the topic of their own sentence
    const declineBySentence = [];
    {
      const hasLines = found.some((f) => f.rule === 'R-ANSWER-LINE');
      for (const s of sents) {
        if (/\?\s*$/.test(s.text) || SUBJECT_REQUEST.test(s.text)) continue;
        const mm = DECLINE_PHRASE.exec(s.text);
        if (!mm) continue;
        const topics = sentenceClaims(s);
        declineBySentence.push({ s, claims: topics.length ? topics : (hasLines ? [] : asked.filter((c) => !answered.has(c))), span: [s.span[0] + mm.index, s.span[0] + mm.index + mm[0].length] });
      }
    }

    for (const claim of asked) {
      const pos = phrase.positive[claim] || [];
      const neg = phrase.negative[claim] || [];
      const lineFound = found.filter((f) => f.claim === claim && f.rule === 'R-ANSWER-LINE');
      const declined = declineBySentence.filter((d) => d.claims.includes(claim));
      const lineHas = (p) => lineFound.some((f) => f.polarity === p);
      for (const [pol, list, rule] of [['positive', pos, 'R-PHRASE-CONFIRM'], ['negative', neg, 'R-PHRASE-DENY']]) {
        if (!list.length) continue;
        if (lineFound.length && lineHas(pol)) continue; // already counted from the answer line (the line has its own checks)
        const only = list.length === 1;
        const r = list[0];
        let explicit = only && !r.negated && !r.hedged && !r.contrast && !r.multiTopic && !inj.suspicious;
        if (pol === 'negative' && r.negated) explicit = false;
        found.push({ claim, polarity: pol, explicit, rule, span: r.span });
        if (!explicit) result.notes.push(`${rule}_not_explicit:${claim}`);
      }
      for (const d of declined) {
        found.push({ claim, polarity: 'refusal', explicit: false, rule: 'R-DECLINE', span: d.span });
      }
    }

    // collapse duplicates, then fallback for every asked claim without a statement
    const seen = new Set();
    for (const f of found) { const k = `${f.claim}|${f.polarity}|${f.rule}`; if (!seen.has(k)) { seen.add(k); result.statements.push(f); } }
    for (const c of asked) if (!result.statements.some((s) => s.claim === c)) result.statements.push({ claim: c, polarity: 'unclear', explicit: false, rule: 'R-FALLBACK', span: [0, 0] });
    // conflicts per claim: positive with negative => both kept explicit so the engine returns INCONCLUSIVE with
    // contradictory_statements and a reviewer looks; anything with a refusal on the same claim goes amber.
    for (const c of asked) {
      const mine = result.statements.filter((x) => x.claim === c);
      const hasPos = mine.some((x) => x.polarity === 'positive');
      const hasNeg = mine.some((x) => x.polarity === 'negative');
      const hasRef = mine.some((x) => x.polarity === 'refusal');
      if (hasPos && hasNeg) { for (const x of mine) if (x.polarity === 'positive' || x.polarity === 'negative') x.explicit = true; result.notes.push(`contradictory:${c}`); }
      if (hasRef && (hasPos || hasNeg)) { for (const x of mine) x.explicit = false; result.notes.push(`refusal_conflict:${c}`); }
    }
    // hard safety: a refusal or unclear statement is never explicit; injection text never yields explicit anything
    for (const s of result.statements) { if (s.polarity === 'refusal' || s.polarity === 'unclear') s.explicit = false; if (inj.suspicious) s.explicit = false; }
    result.conditions = [...new Set(result.conditions)];
    if (result.flags.contact_change) result.notes.push('R-CONTACT-CHANGE');
    return result;
  } catch {
    return { version: CLASSIFIER_VERSION, kind: 'unrelated', statements: [], conditions: [], flags: { contact_change: false, payment_request: false, links: [], urgency: false, injection: true }, analysedText: '', notes: ['classifier_error'] };
  }
}
