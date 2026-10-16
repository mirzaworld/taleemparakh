// "Check before you pay": compares a payment instruction against what the student found
// independently. It never sees money, never stores account numbers, never approves a payment.
import { nameTokens, normalizeName, hasMixedScript, hasFormatChars } from './normalize.js';

const IBAN_LENGTHS = {
  PK: 24, GB: 22, AE: 23, DE: 22, FR: 27, IE: 22, NL: 18, ES: 24, IT: 27, TR: 26, SA: 24, QA: 29,
  BH: 22, KW: 30, CY: 28, MT: 31, PL: 28, SE: 24, FI: 18, DK: 18, NO: 15, BE: 16, AT: 20, CH: 21, HU: 28, CZ: 24,
};

export function validateIban(raw) {
  const iban = String(raw || '').replace(/[\s.\-]+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban)) return { valid: false, country: '', reason: 'format' };
  const country = iban.slice(0, 2);
  if (IBAN_LENGTHS[country] && IBAN_LENGTHS[country] !== iban.length) return { valid: false, country, reason: 'length' };
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1 ? { valid: true, country } : { valid: false, country, reason: 'checksum' };
}

const ORG_WORDS = /\b(university|uni|college|institute|school|academy|trust|limited|ltd|plc|inc|llc|pty|foundation|council|board|corporation|education|polytechnic|tafe)\b/i;

// Words that say what kind of body it is, not which one: "University Ltd" names no institution.
const GENERIC = new Set(['university', 'uni', 'college', 'institute', 'school', 'academy', 'education', 'international',
  'campus', 'centre', 'center', 'polytechnic', 'faculty', 'higher', 'national', 'state']);
// Extra words a university's own account name may carry ("University of Manchester Student Fees").
const ALLOWED_EXTRA = new Set(['student', 'students', 'fee', 'fees', 'tuition', 'account', 'accounts', 'finance', 'income', 'receipts', 'payments', 'payment']);
// Payment services that universities link from their own websites (facts report R5: Flywire, Convera).
const PAYMENT_SERVICES = /\b(flywire|convera)\b/i;
const AGENT_WORDS = /\b(consultants?|consultancy|agency|agents?|visa services?|immigration|overseas|associates|traders?|enterprises?|recruitment|placement)\b/i;
const SERVICE_WORDS = new Set(['flywire', 'convera', 'payment', 'payments', 'services', 'service', 'global', 'uk', 'australia', 'usa', 'us', 'canada', 'europe', 'operations', 'corp', 'corporation']);

const distinctive = (name) => nameTokens(name).filter((t) => !GENERIC.has(t));
const initials = (name) => normalizeName(name).split(' ').filter((t) => t && !['of', 'the', 'and', 'for', 'at', 'in'].includes(t)).map((t) => t[0]).join('');

// Legal-form words a register name may carry that a bank account name often leaves out, and that a genuine
// account name may add ("Coventry University Higher Education Corporation"). Accepted only next to the
// institution's own kind word ("University"), so "Coventry Corporation" or "Manchester Trust" never pass.
const LEGAL_FORM = new Set(['corporation', 'incorporated', 'trust', 'foundation', 'group', 'company', 'higher', 'education']);
const KIND_WORDS = new Set(['university', 'uni', 'college', 'institute', 'school', 'academy', 'polytechnic']);
const kind = (t) => (t === 'uni' ? 'university' : t);
const initialsAll = (name) => normalizeName(name).split(' ').filter(Boolean).map((t) => t[0]).join('');

// "The University of Melbourne (UniMelb)": the bracketed short name is a name of its own; "University of
// Northumbria at Newcastle" is also paid as "University of Northumbria".
export function nameVariants(name) {
  const n = String(name || '');
  const m = n.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  const base = m ? [m[1], m[2]] : [n];
  return [...base, ...base.filter((x) => /\s+at\s+\S+$/i.test(x)).map((x) => x.replace(/\s+at\s+\S+$/i, ''))];
}

// True only when the payee names this institution and nothing else:
// - every distinctive word of the institution is in the payee (so "London College" is not Imperial College London);
// - every other payee word is from the institution's name, an account word ("Student Fees"), or a legal-form
//   word next to the institution's own kind word;
// - a kind word in the payee ("College") must be the institution's own kind ("Manchester College" fails).
// A token that is the institution's initials ("UCL Student Fees") stands for its distinctive words.
function sameName(payee, institution) {
  let p = nameTokens(payee);
  const written = new Set(p.map(kind)); // words the payee itself contains, before any initials expansion
  const i = nameTokens(institution);
  if (!p.length || !i.length) return false;
  if (normalizeName(payee) === normalizeName(institution)) return true;
  const req = i.filter((t) => !GENERIC.has(t) && !LEGAL_FORM.has(t) && !KIND_WORDS.has(t));
  const ini = initials(institution);
  if (ini.length >= 3 && p.includes(ini)) p = [...p.filter((t) => t !== ini), ...req, ...i.filter((t) => KIND_WORDS.has(t))];
  if (!req.length || !req.every((t) => p.includes(t))) return false;
  const iset = new Set(i.map(kind));
  // Every kind word of the institution must be there: "London College" is not University College London,
  // "Coventry" or "Manchester Company" is not a university.
  const pk = new Set(p.map(kind));
  if ([...iset].some((t) => KIND_WORDS.has(t) && !pk.has(t))) return false;
  // A company suffix the institution does not carry means a different body ("UNSW Pty Ltd" is not UNSW).
  const SUFFIX = /\b(pty|ltd|limited|inc|llc|plc|company|co)\b/i;
  if (SUFFIX.test(payee) && !SUFFIX.test(institution)) return false;
  const hasOwnKind = [...written].some((t) => KIND_WORDS.has(t) && iset.has(t));
  // Legal-form words are accepted only when the institution's own name has them, or as the exact statutory
  // form of an English university ("... University Higher Education Corporation"). "University of Birmingham
  // Trust" or "Deakin University Foundation" is a different body (round 4 F-5).
  const statutory = hasOwnKind && /\bhigher education corporation$/.test(normalizeName(payee));
  return p.every((t) => {
    if (ALLOWED_EXTRA.has(t) || iset.has(kind(t))) return true;
    if (KIND_WORDS.has(t)) return false;
    return statutory && ['higher', 'education', 'corporation'].includes(t);
  });
}

// "LSE", "UOM": one capitalised token that is the start of the institution's initials. We cannot be sure, so
// it is amber ("ask for the full account name"), never grey. "ALI KHAN", "SANA" or "ABC" do not qualify.
function isAbbreviationOf(payee, institutionNames) {
  const raw = String(payee).trim();
  if (!/^[A-Z]{2,6}$/.test(raw)) return false;
  const tok = raw.toLowerCase();
  return institutionNames.flatMap(nameVariants).some((n) => [initials(n), initialsAll(n)].some((x) => x.length >= 2 && x.startsWith(tok)));
}

export function sameInstitutionName(payee, institution, aliases = []) {
  return [...nameVariants(institution), ...aliases.flatMap(nameVariants)].some((n) => n && sameName(payee, n));
}

// Kept for callers that want a score; the verdict uses sameInstitutionName.
export function nameSimilarity(a, b) {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / Math.max(ta.size, tb.size);
}

// English texts and Urdu drafts for the Laiba-gap payment flags and form labels. Lane B copies them into i18n
// (keys `flag.<id>` and `pay.<key>`); the Urdu is a draft until a native-speaking counsellor has reviewed it.
export const PAYMENT_GAP_TEXT = {
  en: {
    'pay.paidBefore': 'I have paid this person before',
    'pay.newFeeAfter': 'A new fee appeared after I paid',
    'pay.receiptOther': 'I have a receipt that did not come from the university\'s own portal or email',
    'flag.paid_before': 'You have already paid this person. Scams often grow in steps: a first payment, then a new fee, then a "last" fee, each one to protect the money already paid. Stop, and do not pay again until you have checked with the university yourself.',
    'flag.new_fee_after_paying': 'A new fee after you paid is a common sign of a scam. The first payment is used to ask for more. Stop, and check with the university through the contact on its own website.',
    'flag.receipt_not_from_university': 'A receipt that did not come from the university can be forged. Only the university can tell you it received your money. Confirm the payment in the university\'s official portal or by writing to its own email address.',
  },
  ur: {
    'pay.paidBefore': 'میں اس شخص کو پہلے بھی رقم دے چکا یا چکی ہوں',
    'pay.newFeeAfter': 'رقم دینے کے بعد ایک نئی فیس مانگی گئی',
    'pay.receiptOther': 'میرے پاس ایسی رسید ہے جو یونیورسٹی کے اپنے پورٹل یا ای میل سے نہیں آئی',
    'flag.paid_before': 'آپ اس شخص کو پہلے ہی رقم دے چکے ہیں۔ فراڈ اکثر قدم بہ قدم بڑھتا ہے: پہلی ادائیگی، پھر نئی فیس، پھر "آخری" فیس، اور ہر بار کہا جاتا ہے کہ پچھلی رقم بچانے کے لیے دیں۔ رکیں، اور یونیورسٹی سے خود پوچھے بغیر دوبارہ ادائیگی نہ کریں۔',
    'flag.new_fee_after_paying': 'رقم دینے کے بعد نئی فیس کا مطالبہ فراڈ کی عام نشانی ہے۔ پہلی ادائیگی کو مزید رقم مانگنے کے لیے استعمال کیا جاتا ہے۔ رکیں، اور یونیورسٹی کی اپنی ویب سائٹ پر دیے گئے رابطے سے خود تصدیق کریں۔',
    'flag.receipt_not_from_university': 'جو رسید یونیورسٹی کی طرف سے نہ آئی ہو وہ جعلی ہو سکتی ہے۔ صرف یونیورسٹی بتا سکتی ہے کہ اسے آپ کی رقم ملی ہے یا نہیں۔ ادائیگی کی تصدیق یونیورسٹی کے سرکاری پورٹل پر یا اس کے اپنے ای میل پتے پر لکھ کر کریں۔',
  },
};

/**
 * @param {object} p
 * @param {string} p.institutionName   institution the student believes they are paying
 * @param {string[]} [p.institutionAliases] other names of that institution on the register (brands, short names)
 * @param {string} p.institutionCountry ISO-2 country of the institution, if known
 * @param {string} p.payeeName         beneficiary name on the instruction they received
 * @param {string} p.officialPayeeName beneficiary name the student found on the institution's own site (optional)
 * @param {string} p.iban              optional; validated locally then discarded
 * @param {'official_portal'|'official_site_typed'|'agent'|'email_unknown'|'other'} p.instructionSource
 * @param {boolean} p.payingAgent      student is paying an agent rather than the institution
 * @param {boolean} p.pressure         told to pay urgently
 * @param {boolean} p.largeAmount      amount is large relative to family means / property sale
 * @param {boolean} [p.paidBefore]            "Have you paid this person before?" (G5)
 * @param {boolean} [p.newFeeAfterPaying]     "Did a new fee appear after you paid?" (G5)
 * @param {boolean} [p.receiptNotFromUniversity] "Do you have a receipt that did not come from the university's own portal or email?" (G3)
 * @param {string} p.method            'bank' | 'card_portal' | 'mobile_wallet' | 'cash' | 'crypto' | 'other'
 */
export function checkPayment(p) {
  const flags = [];
  const payee = String(p.payeeName || '').trim();

  if (['crypto', 'cash'].includes(p.method)) flags.push({ id: 'method_unsafe', severity: 'high' });
  if (p.method === 'mobile_wallet') flags.push({ id: 'method_wallet', severity: 'high' });
  if (p.method === 'other') flags.push({ id: 'method_other', severity: 'medium' });
  if (p.instructionSource === 'agent' || p.instructionSource === 'email_unknown' || p.instructionSource === 'other') {
    flags.push({ id: 'source_unverified', severity: 'medium' });
  }
  if (p.payingAgent) flags.push({ id: 'paying_agent', severity: 'medium' });
  if (p.pressure) flags.push({ id: 'pressure', severity: 'medium' });

  if (payee) {
    const latin = /[a-z]/i.test(payee.normalize('NFKC'));
    const otherScript = /[\u0600-\u06ff\u0750-\u077f\uff00-\uffef]/.test(payee); // Urdu/Arabic letters, full-width forms
    if (hasMixedScript(payee) || hasFormatChars(payee) || (latin && otherScript)) {
      // "Маnchester" with Cyrillic letters, or a hidden zero-width space: made to pass a quick look.
      flags.push({ id: 'payee_unusual_characters', severity: 'high' });
    } else if (!latin) {
      // Bank names abroad are in Latin letters; we cannot compare a name written in Urdu or another script.
      flags.push({ id: 'payee_script', severity: 'medium' });
    } else {
      // Only a payee that is the payment service itself ("Flywire Payments Ltd") counts as one;
      // "Flywire Ali Khan" is a person borrowing the name (review R-4).
      const service = PAYMENT_SERVICES.test(payee) && nameTokens(payee).every((t) => SERVICE_WORDS.has(t));
      const names = [p.institutionName, ...(p.institutionAliases || [])].filter(Boolean);
      const matches = p.institutionName ? sameInstitutionName(payee, p.institutionName, p.institutionAliases || []) : false;
      // A legal account name can differ from the register name ("Imperial College of Science, Technology and
      // Medicine"). Typed identically into the "name on the institution's own payment page" field, starting with
      // the institution's own first word and carrying its kind word, it is amber, never grey: a student may have
      // copied the agent's name into both fields (review N-2).
      const first = (n) => nameTokens(n)[0];
      const legalName = !matches && p.officialPayeeName && normalizeName(payee) === normalizeName(p.officialPayeeName) &&
        names.some((n) => first(payee) === first(n) && nameTokens(payee).some((t) => KIND_WORDS.has(t) && nameTokens(n).map(kind).includes(kind(t))));
      if (/\b(t\/a|trading as)\b/i.test(payee)) flags.push({ id: 'payee_trading_as', severity: 'high' });
      // Agents and service firms, whatever is typed as the institution (round 4 F-7).
      if (AGENT_WORDS.test(payee)) flags.push({ id: 'payee_agent', severity: 'high' });
      // "Who are you paying" itself holds a person's name: matching it proves nothing.
      if (p.institutionName && !ORG_WORDS.test(p.institutionName) && !(p.institutionAliases || []).length && !AGENT_WORDS.test(payee) &&
        !/^[A-Z]{2,6}$/.test(String(p.institutionName).trim()) && nameTokens(p.institutionName).length <= 4) {
        flags.push({ id: 'institution_not_institution', severity: 'high' });
      }
      if (service) flags.push({ id: 'payment_service', severity: 'medium' });
      else if (legalName) flags.push({ id: 'payee_legal_name', severity: 'medium' });
      else if (!matches && names.length && isAbbreviationOf(payee, names)) flags.push({ id: 'payee_abbreviation', severity: 'medium' });
      // "London School of Economics" for "London School of Economics and Political Science": the start of the
      // institution's own name, with its kind word. Amber: ask for the exact account name.
      else if (!matches && names.some((n) => nameVariants(n).some((v) => nameTokens(payee).length >= 2 &&
        normalizeName(v).startsWith(`${normalizeName(payee)} `) && nameTokens(payee).some((t) => KIND_WORDS.has(t))))) {
        flags.push({ id: 'payee_short_name', msg: 'payee_abbreviation', severity: 'medium' });
      }
      else {
        if (!matches && !ORG_WORDS.test(payee) && nameTokens(payee).length <= 4) flags.push({ id: 'payee_individual', severity: 'high' });
        if (p.institutionName && !matches) flags.push({ id: 'payee_mismatch_institution', severity: 'high' });
      }
      if (p.officialPayeeName && !service && normalizeName(payee) !== normalizeName(p.officialPayeeName) &&
        !sameName(payee, p.officialPayeeName)) {
        flags.push({ id: 'payee_mismatch_official', severity: 'high' });
      }
    }
  } else {
    flags.push({ id: 'payee_missing', severity: 'medium' });
  }

  let iban = null;
  if (p.iban && String(p.iban).trim()) {
    iban = validateIban(p.iban);
    if (!iban.valid) flags.push({ id: 'iban_invalid', severity: 'high', reason: iban.reason });
    else if (p.institutionCountry && iban.country !== p.institutionCountry.toUpperCase()) {
      flags.push({ id: 'iban_country', severity: iban.country === 'PK' ? 'high' : 'medium', country: iban.country });
    } else if (!p.institutionCountry && iban.country === 'PK') {
      // Fees for study abroad go to an account in that country; a Pakistani account usually means a person or agent.
      flags.push({ id: 'iban_pakistan', severity: 'medium' });
    } else if (!p.institutionCountry) {
      flags.push({ id: 'iban_country_unchecked', severity: 'medium', country: iban.country });
    }
  }

  // G5: each extra payment is a decision point. Either "yes" is danger and always asks the student to stop and talk
  // to someone, whatever the amount. G3: a receipt from anyone but the university proves nothing.
  if (p.paidBefore === true) flags.push({ id: 'paid_before', severity: 'high' });
  if (p.newFeeAfterPaying === true) flags.push({ id: 'new_fee_after_paying', severity: 'high' });
  if (p.receiptNotFromUniversity === true) flags.push({ id: 'receipt_not_from_university', severity: 'medium' });

  const highCount = flags.filter((f) => f.severity === 'high').length;
  const escalate = (p.largeAmount && (highCount > 0 || p.pressure || p.payingAgent)) || p.paidBefore === true || p.newFeeAfterPaying === true;
  if (escalate) flags.push({ id: 'escalate_human', severity: 'high' });

  const level = highCount ? 'danger' : flags.length ? 'caution' : 'no_obvious_issue';
  // Only return the validity outcome for the IBAN, never the number itself.
  return { level, flags, ibanCheck: iban ? { valid: iban.valid, country: iban.country } : null, escalate };
}
