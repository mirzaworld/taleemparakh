// Prompt-injection and hidden-content detector for inbound text (BUILD-SPEC A14, principle 5).
// It only FLAGS. A flagged message goes to MANUAL_SECURITY_REVIEW and is never sent to an AI model; nothing in
// the text is ever obeyed. Patterns are English, Roman Urdu and Urdu script, plus invisible-character tricks.
// Pure, deterministic, never throws.

const norm = (s) => String(s || '').normalize('NFKC');

// Invisible or direction-changing characters. Written with \u{...} so no invisible character sits in this source.
const BIDI = /[\u{202a}-\u{202e}\u{2066}-\u{2069}\u{200e}\u{200f}\u{061c}]/u;
const ZERO_WIDTH = /[\u{200b}\u{2060}-\u{2064}\u{00ad}\u{180e}\u{feff}]/u;
const TAG_CHARS = /[\u{e0000}-\u{e007f}]/u; // invisible "tag" block used to smuggle ASCII
const JOINER_IN_LATIN = /[A-Za-z0-9][\u{200c}\u{200d}][A-Za-z0-9]/u; // ZWNJ/ZWJ between Latin letters is not Persian or Urdu typing

const OBJ = '(?:instructions?|rules?|prompts?|directions?|guidelines?|polic(?:y|ies)|commands?|constraints?|safeguards?|restrictions?|controls?|checks?)';
const PREV = '(?:previous|prior|above|earlier|preceding|all|any|your|the|these|those|system|original|existing)';
const STATUS_WORD = '(?:admitted|verified|confirmed|accepted|genuine|approved|authentic|authori[sz]ed|valid|safe|legit(?:imate)?|true|green|ok(?:ay)?)';

// [id, regex, note]. All regexes are tested on NFKC-normalised, whitespace-collapsed, lower-case text.
export const INJECTION_RULES = Object.freeze([
  ['override_instructions', new RegExp(`\\b(?:ignore|disregard|forget|override|bypass|skip|drop|discard|overrule)\\b(?:\\s+\\w+){0,3}?\\s+${PREV}(?:\\s+\\w+){0,3}?\\s+${OBJ}\\b`), 'ignore/disregard previous instructions'],
  ['override_instructions_b', new RegExp(`\\b(?:ignore|disregard|forget)\\s+(?:everything|anything|all)\\s+(?:you(?:'ve| have)?\\s+(?:been\\s+)?(?:told|said|given|learned|know)|above|before|else)`), 'forget everything'],
  ['new_instructions', /\b(?:new|updated|revised|additional|real|actual|secret)\s+(?:instructions?|system prompt|rules)\s*(?::|follow|are|for you)/, 'new instructions follow'],
  ['role_reassign', /\byou\s+are\s+now\s+(?:an?|the|in)\s+(?:assistant|ai|admin(?:istrator)?|system|reviewer|developer|unrestricted|jailbroken|dan|evil|helpful assistant|debug|god|root)\b/, 'role reassignment'],
  ['role_reassign_b', /\b(?:developer|debug|admin|god|sudo|jailbreak|dan)\s+mode\b|\bjailbreak\b/, 'mode switch'],
  ['addresses_model', /\b(?:dear|attention|note to|message to|hey|hi|to the)\s+(?:the\s+)?(?:ai|a\.i\.|llm|language model|assistant|model|classifier|chatbot|bot|automated (?:system|reviewer|checker)|gpt|claude|gemini)\b|\bif you are (?:an?\s+)?(?:ai|llm|language model|bot|chatbot|automated)\b|\bas an? (?:ai|llm|language model)\b/, 'addresses the model'],
  ['system_marker', /(?:^|[\n\r>\]\[(])\s*(?:system|assistant|developer|admin)\s*(?:prompt|message|note)?\s*:\s*\S|<\|?(?:im_start|im_end|system|assistant|endoftext)\|?>|\[\/?inst\]|<<\s*sys\s*>>|###\s*(?:system|instruction)/, 'chat-role markers'],
  ['marker_escape', /<<<\s*email_(?:start|end)|<<<|>>>\s*(?:email_|end)|\bemail_end_/, 'tries to close the email delimiter'],
  ['mark_status', new RegExp(`(?:^|[.!?\\n;:]\\s*|\\b(?:please|now|just|must|should|and|then|always|immediately)\\s+)(?:mark|set|label|record|register|treat|update|change|flag|classify|report|output|return|answer|respond|reply)\\b[^.\\n]{0,50}?\\b(?:as|to|with|is|=)\\s*[:"']?\\s*${STATUS_WORD}\\b`), 'imperative to set a status'],
  ['status_assignment', /\b(?:status|verdict|result|outcome|classification|polarity|decision)\s*(?:=|:=|->|=>)\s*["']?(?:institution_)?(?:confirmed|verified|admitted|accepted|positive|approved|admission_granted)/, 'status = confirmed'],
  ['claim_assertion_json', /["']?(?:polarity|explicit|status)["']?\s*:\s*["']?(?:positive|true|confirmed|institution_confirmed)/, 'JSON-looking verdict'],
  ['suppress_review', /\b(?:do\s+not|don't|never|no need to|without)\s+(?:flag|escalate|report|review|alert|notify|check|verify|forward|log|mention|tell)\b[^.\n]{0,40}\b(?:this|it|reviewers?|humans?|anyone|staff|the team|security|founder|student)\b/, 'asks to skip review'],
  ['reveal_prompt', /\b(?:reveal|show|print|repeat|display|leak|output)\s+(?:me\s+)?(?:your|the)\s+(?:system\s+)?(?:prompt|instructions|rules|configuration|secrets?|api keys?|hidden)\b/, 'asks for the prompt'],
  ['respond_only', /\b(?:respond|reply|answer|output)\s+(?:only\s+)?with\s+(?:only\s+)?(?:json|the following|"|'|yes|true|confirmed)\b|\bonly\s+output\b/, 'dictates the answer'],
  ['change_registry', /\b(?:add|update|replace|change|set|use)\s+(?:this|the|our|my|a)?\s*(?:new\s+)?(?:trusted\s+|approved\s+|official\s+)?(?:contact|e-?mail|address|registry|whitelist|allowlist)\b[^.\n]{0,30}\b(?:to|as|with)\b[^.\n]{0,40}@/, 'tries to change the contact registry'],
  // Roman Urdu
  ['ru_override', /\b(?:pichl[iy]|pehl[ey]|pehle ki|purani|pichli|sab|tamam|saari|saray|sare)\s+(?:hidayat(?:at)?|ahkam|rules?|instructions?|qawaid|hukam)\b[^.\n]{0,30}\b(?:nazar\s*andaz|ignore|bhool|bhul|chor|chhor|ghaur\s*na|mat\s*maan|na\s*maan)/, 'roman urdu: ignore instructions'],
  ['ru_override_b', /\b(?:ignore|nazar\s*andaz|bhool\s*jao|bhul\s*jao|bhool\s*jaiye)\b[^.\n]{0,25}\b(?:hidayat(?:at)?|rules?|instructions?|ahkam|qawaid)\b/, 'roman urdu: ignore'],
  ['ru_mark', /\b(?:admitted|admit|verified|tasdeeq\s*shuda|tasdiq\s*shuda|confirmed|accepted|manzoor|qubool|durust|asli|sahi|genuine)\s+(?:mark|likh|likhein|likho|kar|karo|kardo|kar\s*do|kijiye|karen|set)\b|\bmark\s+(?:karo|kar\s*do|kijiye)\b/, 'roman urdu: mark as admitted'],
  ['ru_no_review', /\b(?:review|check|jaanch|jaanchna|escalate|report)\s+(?:mat|na|nahi|nahin)\s+(?:karo|karna|karein|kijiye|karen)\b/, 'roman urdu: do not review'],
  // Urdu script (normalised, plain substring matches)
  ['ur_override', /(?:پچھلی|پہلے کی|تمام|سب|سابقہ)\s*(?:ہدایات|احکامات|قواعد|اصول)[^.\n]{0,30}(?:نظر انداز|بھول|نظرانداز|مت مانو|نہ مانو)/, 'urdu: ignore instructions'],
  ['ur_mark', /(?:داخلہ|طالب علم|درخواست)[^.\n]{0,30}(?:تصدیق شدہ|منظور|قبول)\s*(?:لکھ|کر|درج|نشان)/, 'urdu: mark admitted'],
]);

const BASE64_BLOB = /(?:^|[\s:=])([A-Za-z0-9+/]{80,}={0,2})(?=$|[\s.])/;
const URLISH_BASE64 = /\bdata:[a-z/+.-]+;base64,/i;

function decodeBase64Loose(s) {
  try {
    const bin = atob(s.slice(0, Math.min(s.length, 4096)).replace(/[^A-Za-z0-9+/]/g, '').replace(/(.{4})*?$/, (m) => m));
    return bin;
  } catch { return ''; }
}

function scanText(raw, source, matches, flags) {
  const text = norm(raw);
  if (!text) return;
  if (BIDI.test(text)) { flags.bidi = true; matches.push({ rule: 'bidi_control', source, excerpt: '(direction override characters)' }); }
  if (ZERO_WIDTH.test(text.replace(/^\u{feff}/u, ''))) { flags.zeroWidth = true; matches.push({ rule: 'zero_width', source, excerpt: '(zero-width characters)' }); }
  if (TAG_CHARS.test(text)) { flags.tagChars = true; matches.push({ rule: 'tag_characters', source, excerpt: '(invisible tag characters)' }); }
  if (JOINER_IN_LATIN.test(text)) { flags.zeroWidth = true; matches.push({ rule: 'zero_width', source, excerpt: '(joiner inside Latin word)' }); }
  // Invisible characters are removed before pattern matching, so a zero-width space cannot split a word.
  const visible = text
    .replace(/[\u{200b}-\u{200f}\u{202a}-\u{202e}\u{2060}-\u{2064}\u{2066}-\u{2069}\u{00ad}\u{180e}\u{feff}\u{061c}\u{e0000}-\u{e007f}]/gu, '')
    .replace(/[\u{0370}-\u{03ff}\u{0400}-\u{04ff}]/gu, (c) => LOOK[c] || c) // Cyrillic/Greek lookalikes
    .replace(/[\s]+/g, ' ')
    .toLowerCase();
  const hay = visible;
  for (const [id, re, note] of INJECTION_RULES) {
    const m = re.exec(hay);
    if (m) matches.push({ rule: id, source, excerpt: hay.slice(Math.max(0, m.index), m.index + Math.min(m[0].length, 120)).trim(), note });
  }
  // Encoded payloads: a long base64 run is suspicious on its own; decode and scan it too.
  const b = BASE64_BLOB.exec(text) || URLISH_BASE64.exec(text);
  if (b) {
    flags.base64 = true;
    matches.push({ rule: 'base64_blob', source, excerpt: '(long base64 text)' });
    if (b[1]) {
      const decoded = decodeBase64Loose(b[1]);
      if (decoded && /^[\x09\x0a\x0d\x20-\x7e]+$/.test(decoded)) {
        const inner = [];
        scanText(decoded, `${source}:base64`, inner, {});
        for (const i of inner) if (!['base64_blob'].includes(i.rule)) matches.push({ ...i, rule: `decoded_${i.rule}` });
      }
    }
  }
}

const LOOK = { а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ѕ: 's', ј: 'j', А: 'a', Е: 'e', О: 'o', Р: 'p', С: 'c', Т: 't', Н: 'h', К: 'k', М: 'm', В: 'b', ο: 'o', α: 'a', ε: 'e', ι: 'i', ν: 'v', ρ: 'p' };

/**
 * Scan inbound text. `parts`: { text, hiddenText, subject, filenames[] } (any may be missing).
 * Hidden HTML text is itself a finding when it is non-empty and matches or when it is long.
 * Returns { suspicious, matches:[{rule,source,excerpt}], flags:{bidi,zeroWidth,tagChars,base64,hiddenHtml}, rules:[ids] }.
 */
export function scanInjection(parts = {}) {
  const matches = [];
  const flags = { bidi: false, zeroWidth: false, tagChars: false, base64: false, hiddenHtml: false };
  try {
    const p = typeof parts === 'string' ? { text: parts } : (parts || {});
    scanText(p.text, 'text', matches, flags);
    scanText(p.subject, 'subject', matches, flags);
    for (const f of Array.isArray(p.filenames) ? p.filenames : []) scanText(f, 'filename', matches, flags);
    const hidden = norm(p.hiddenText).trim();
    if (hidden) {
      scanText(hidden, 'hidden_html', matches, flags);
      flags.hiddenHtml = true;
      matches.push({ rule: 'hidden_html_text', source: 'hidden_html', excerpt: hidden.slice(0, 120) });
    }
  } catch {
    matches.push({ rule: 'scan_error', source: 'scanner', excerpt: '' });
  }
  return { suspicious: matches.length > 0, matches, flags, rules: [...new Set(matches.map((m) => m.rule))] };
}

/** Ranges of the original (un-normalised) text worth highlighting for a reviewer: invisible characters. */
export function invisibleCharSpans(text) {
  const s = String(text || '');
  const out = [];
  const re = /[\u{200b}-\u{200f}\u{202a}-\u{202e}\u{2060}-\u{2064}\u{2066}-\u{2069}\u{00ad}\u{180e}\u{061c}\u{e0000}-\u{e007f}]|(?!^)\u{feff}/gu;
  let m;
  while ((m = re.exec(s)) !== null && out.length < 200) out.push([m.index, m.index + m[0].length]);
  return out;
}
