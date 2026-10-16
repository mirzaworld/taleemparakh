// Hand-written validator for AI classifier output (BUILD-SPEC 4.11). AI output is a SUGGESTION: it is validated, stored
// next to the rules output, compared with it, and never feeds the engine or a status. Anything off, even slightly,
// makes the whole answer invalid ("AI output rejected"): extra keys, unknown claims, quotes that are not in the input,
// oversize, non-JSON, JSON wrapped in prose. Pure, deterministic, never throws.

export const AI_LIMITS = Object.freeze({ maxRawChars: 20000, maxStatements: 20, maxQuote: 300, maxConditions: 10, maxCondition: 200, maxNotes: 500 });
const POLARITIES = ['positive', 'negative', 'refusal', 'unclear'];
const TOP_KEYS = ['statements', 'conditions', 'injection_suspected', 'notes'];
const STATEMENT_KEYS = ['claim', 'polarity', 'quote'];
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const collapse = (s) => s.replace(/\s+/g, ' ').trim();

/**
 * validateAiOutput(raw, { askedClaims, inputText })
 * -> { valid, errors[], value: { statements[], conditions[], injection_suspected, notes } | null }
 * The caller shows only "AI output rejected" when valid is false.
 */
export function validateAiOutput(raw, { askedClaims = [], inputText = '' } = {}) {
  const errors = [];
  const reject = () => ({ valid: false, errors, value: null });
  try {
    if (typeof raw !== 'string') { errors.push('not_a_string'); return reject(); }
    if (raw.length > AI_LIMITS.maxRawChars) { errors.push('oversize'); return reject(); }
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) { errors.push('not_json_object_only'); return reject(); }
    let data;
    try { data = JSON.parse(trimmed); } catch { errors.push('invalid_json'); return reject(); }
    if (!isPlainObject(data)) { errors.push('not_an_object'); return reject(); }
    for (const k of Object.keys(data)) if (!TOP_KEYS.includes(k)) errors.push(`extra_key:${k.slice(0, 40)}`);
    for (const k of TOP_KEYS) if (!(k in data)) errors.push(`missing_key:${k}`);
    if (errors.length) return reject();

    const asked = new Set(Array.isArray(askedClaims) ? askedClaims : []);
    const hay = collapse(String(inputText || ''));
    if (!Array.isArray(data.statements)) errors.push('statements_not_array');
    else if (data.statements.length > AI_LIMITS.maxStatements) errors.push('too_many_statements');
    if (!Array.isArray(data.conditions)) errors.push('conditions_not_array');
    else if (data.conditions.length > AI_LIMITS.maxConditions) errors.push('too_many_conditions');
    if (typeof data.injection_suspected !== 'boolean') errors.push('injection_suspected_not_boolean');
    if (typeof data.notes !== 'string') errors.push('notes_not_string');
    else if (data.notes.length > AI_LIMITS.maxNotes) errors.push('notes_too_long');
    else if (CONTROL.test(data.notes)) errors.push('notes_control_characters');
    if (errors.length) return reject();

    const statements = [];
    data.statements.forEach((s, i) => {
      if (!isPlainObject(s)) { errors.push(`statement_${i}_not_object`); return; }
      for (const k of Object.keys(s)) if (!STATEMENT_KEYS.includes(k)) errors.push(`statement_${i}_extra_key:${k.slice(0, 40)}`);
      for (const k of STATEMENT_KEYS) if (!(k in s)) errors.push(`statement_${i}_missing_key:${k}`);
      if (typeof s.claim !== 'string' || !asked.has(s.claim)) errors.push(`statement_${i}_claim_not_asked`);
      if (typeof s.polarity !== 'string' || !POLARITIES.includes(s.polarity)) errors.push(`statement_${i}_bad_polarity`);
      if (typeof s.quote !== 'string') errors.push(`statement_${i}_quote_not_string`);
      else if (!s.quote.trim()) errors.push(`statement_${i}_quote_empty`);
      else if (s.quote.length > AI_LIMITS.maxQuote) errors.push(`statement_${i}_quote_too_long`);
      else if (CONTROL.test(s.quote)) errors.push(`statement_${i}_quote_control_characters`);
      else if (!hay.includes(collapse(s.quote))) errors.push(`statement_${i}_quote_not_in_input`);
      if (!errors.some((e) => e.startsWith(`statement_${i}_`))) statements.push({ claim: s.claim, polarity: s.polarity, quote: s.quote });
    });
    const conditions = [];
    data.conditions.forEach((c, i) => {
      if (typeof c !== 'string' || !c.trim() || c.length > AI_LIMITS.maxCondition || CONTROL.test(c)) errors.push(`condition_${i}_invalid`);
      else conditions.push(c);
    });
    if (errors.length) return reject();
    return { valid: true, errors: [], value: { statements, conditions, injection_suspected: data.injection_suspected, notes: data.notes } };
  } catch {
    errors.push('validator_error');
    return reject();
  }
}

/**
 * disagreesWithRules(aiStatements, ruleStatements): true if, for any claim either side mentions, the sets of
 * polarities differ. A disagreement only ever sends the claim to a reviewer (engine trace ai_rules_disagree).
 */
export function disagreesWithRules(aiStatements, ruleStatements) {
  const by = (list) => {
    const m = new Map();
    for (const s of Array.isArray(list) ? list : []) { if (!s || typeof s.claim !== 'string') continue; if (!m.has(s.claim)) m.set(s.claim, new Set()); m.get(s.claim).add(s.polarity); }
    return m;
  };
  const a = by(aiStatements);
  const r = by(ruleStatements);
  for (const claim of new Set([...a.keys(), ...r.keys()])) {
    const x = [...(a.get(claim) || [])].sort().join(',');
    const y = [...(r.get(claim) || [])].sort().join(',');
    if (x !== y) return true;
  }
  return false;
}

/** Wrap untrusted text between nonce markers. Returns null if the text already contains a marker lookalike. */
export function wrapUntrusted(text, nonce) {
  const t = String(text == null ? '' : text);
  const n = String(nonce || '');
  if (!/^[A-Za-z0-9]{8,64}$/.test(n)) return null;
  if (/<<<\s*EMAIL_(?:START|END)/i.test(t) || t.includes(n)) return null;
  return `<<<EMAIL_START_${n}>>>\n${t}\n<<<EMAIL_END_${n}>>>`;
}
