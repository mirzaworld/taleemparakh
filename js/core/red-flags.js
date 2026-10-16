import { foldLookalikes, stripFormat } from './normalize.js';

// Rule-based scam-pattern scanner for messages from agents/consultants.
// Runs entirely in the browser; the pasted text is never sent or stored.
// A message with no flags is NOT proof that it is genuine.
//
// Rules and fixtures come from audits/research/scams-search-guides-2026-10-13.md and
// facts-contacts-registers-2026-10-13.md (R2). Genuine university wording is part of the test set:
// a rule that frightens a student away from a real deposit is a defect, not caution.
//
// Rule options:
//   negatable  skip a match that is negated ("no application fee", "never share your password",
//              "UKVI will never call you to ask for a fine"), which is protective advice, not a scam.
//   unless     skip a match when this pattern appears in the 40 characters after it.
//   help       the situation needs people, not just a warning: the app opens the help contacts.
// Urdu-script rules use the `u` flag and no `\b`, because `\b` does not work next to Urdu letters.

const RULES = [
  {
    id: 'guarantee', severity: 'high',
    // "A CAS does not guarantee a visa", "No agent can guarantee you a visa" are warnings, not promises (R-2).
    // Only a plain disclaimer right before the word counts, and never when the sentence or the next words
    // speak for the sender or a comparison ("No other agency can guarantee your visa. We can.", round 3 N-4).
    negateBefore: /(\bdoes not|\bdoesn't|\bdo not|\bdon't|\bdid not|\bcannot|\bcan't|\bcan not|\bwill not|\bwon't|\bcould not|^\s*nobody can|^\s*no one can|^\s*no (agent|agency|consultant|person|website|honest \w+|genuine \w+|real \w+) can)\s+((ever|really|always)\s+)?$/i,
    negateUnless: /\b(we|us|our|ours|i|me|my|else|other|others|like|but|why|if|only|except|apart|than|can|does|lekin|magar|hum)\b/i,
    patterns: [/\b(100\s*%|guarantee[ds]?|guaranteed)\s+(admission|visa|seat|offer|acceptance|scholarship)/i,
      /\b(admission|visa|seat|scholarship)\s+(is\s+)?(100\s*%|guaranteed|pakk[ai])/i, /\bpakk[ai]\s+(admission|visa|seat)/i,
      // Misspellings, up to two words in between ("guaranteed student visa"), and Roman Urdu word order.
      /\b(gu?[ae]?ran?t[ei]e?d?|gauranteed?|garanteed?)\s+(\w+\s+){0,2}(admission|visa|seat|offer|acceptance|scholarship)/i,
      /\b(admission|visa|seat|scholarship)\s+(ki|ka|ke)?\s*(gu?[ae]?ran?t[ei]e|garantee)\b/i,
      /\b(visa|admission|seat|offer)\s+((approval|approved|success|grant)\s+)?(is\s+)?(100\s*%\s+)?(gu?[ae]?ran?t[ei]ed?|garanteed?)\b/i,
      /\b100\s*(%|percent|per cent)\s+(visa|admission|seat|success|approval)/i, /\b(visa|admission|file)\b.{0,25}\b100\s*(%|percent|per cent)/i,
      /\b(approved|granted|lag jaye ga|lagega) for sure\b|\bfor sure (approved|visa)\b/i,
      // Roman Urdu: "visa lagna pakka", "sau fisad visa", "hum visa dilwa dete hain", "visa ki zimmedari hamari"
      /\b(visa|admission|dakhla|dakhila)\s+((lagna|lagne|milna|milne|lag|mil)\s+)?(pakka|pakki|confirm)\b/i, /\bsau\s+fis[ae]d\b/i,
      /\b(hum|ham|main)\b.{0,25}\b(visa|admission)\b.{0,15}\b(dilwa|lagwa|dila)\w*/i, /\b100\s*%?\s*(visa|admission)\s+(lagwa|dilwa)\w*/i,
      /\bvisa ki zimm?ed?ari\s+(hamari|meri|humari)\b/i],
  },
  {
    id: 'guarantee_ur', msg: 'guarantee', severity: 'high',
    patterns: [/(گارنٹی|گارنٹیڈ|ضمانت|سو فیصد|۱۰۰ فیصد|100 فیصد|پکا|پکی|یقینی)[^.۔]{0,30}(ویزا|ویزہ|ویزے|داخلہ|ایڈمیشن|سیٹ|اسکالرشپ|وظیفہ)/u,
      /(ویزا|ویزہ|ویزے|داخلہ|ایڈمیشن|سیٹ|اسکالرشپ)[^.۔]{0,30}(گارنٹی|گارنٹیڈ|ضمانت|سو فیصد|پکا|پکی|یقینی)/u],
  },
  {
    id: 'urgency', severity: 'medium',
    patterns: [/\b(today only|within\s+\d+\s*(hours?|hrs?)|last chance|deadline (is )?(today|tonight)|seats? (are )?(limited|filling)|expires? (today|tonight)|urgent(ly)?)\b/i,
      /\b(aaj hi|jaldi|foran|fori)\b/i, /\babhi\b.{0,20}\b(payment|paise|paisay|bhej\w*|jama)\b/i],
  },
  {
    id: 'personal_account', severity: 'high', negatable: true,
    // "The University will never ask you to pay fees into a personal bank account" is advice; "my account" never is.
    negateUnlessMatch: /\b(my|our|me|us|his|her)\b/i,
    patterns: [/\b(send|transfer|deposit|pay|bhej\w*|jama)\b.{0,40}\b(my|his|her|director'?s?|agent'?s?|personal)\s+((brother|sister|wife|husband|friend|cousin|uncle|father|son|mother)'?s?\s+)?(bank\s+)?(account|a\/c|easypaisa|jazz\s*cash|wallet)\b/i,
      /\b(mere|meray|mera|meri|hamare|humare|hamara)\s+(bank\s+)?(account|khata|easypaisa|jazz\s*cash)\b.{0,30}\b(bhej|jama|transfer|daal|dal|dalwa)\w*/i,
      /\b(bhai|bhaiya|behen|cousin|uncle|chacha|mamu|dost|abbu)\s+(ke|ki|ka)\s+(bank\s+)?(account|khata)\b/i,
      /(میرے|ہمارے|بھائی کے)\s*(بینک\s*)?(اکاؤنٹ|کھاتے)/u,
      /\b(send|transfer|deposit)\b.{0,40}\b(to me|to us|our account)\b/i],
  },
  {
    // Wallet names alone are a question to ask, not proof: universities abroad rarely take them.
    // Raast is the State Bank's own payment system and is deliberately not listed.
    id: 'method_wallet', severity: 'medium',
    patterns: [/\b(easypaisa|jazz\s*cash|sadapay|nayapay)\b/i],
  },
  {
    id: 'unusual_payment', severity: 'high', negatable: true,
    patterns: [/\b(crypto|b[i1!]tco[i1]n|btc|usdt|tether|binance|western union|moneygram|hawala|hundi|cash only|in cash)\b/i,
      /\bbank se (mat|na|nahi)\s+(bhej|bhejo|bhejein|karo|karein|do)\w*/i],
  },
  {
    id: 'gift_card_or_code', severity: 'high',
    // "The Home Office will never ask you to pay ... by gift card" is advice; "We do not accept transfers, send
    // voucher codes instead" or "If you don't pay with gift cards" is a demand (round 3 N-4).
    negateBefore: /\b(never|will not|won't|do not|does not|doesn't|don't)\s+(ask|request|accept|take|need|buy|pay)\b[^.!?۔,;]{0,80}$/i,
    negateUnless: /\b(if|only|instead|now|today|within|hours?|or else|cancel\w*|warna|so|as|because|blocked|and we|we accept)\b|,\s*(send|buy|use|get|purchase)\b/i,
    guardWholeClause: true,
    patterns: [/\b(gift ?cards?|itunes|google play|steam|voucher)\b.{0,40}\b(codes?|numbers?|pin)\b/i, /\bgift ?cards?\b/i,
      /\b(itunes|google play|steam|apple|amazon|razer)\s+(gift\s+)?cards?\b/i, /\bphotos? of the back\b/i, /\bscratch (numbers?|codes?)\b/i,
      /(گفٹ کارڈ|گوگل پلے|آئی ٹیونز|اسٹیم کارڈ)/u],
  },
  {
    // Money before an offer exists: high. A deposit before a CAS, CoE or I-20 is normal when paid to the
    // university itself, so that case is only a reminder of where to pay (fee_for_cas, medium).
    id: 'fee_for_offer', severity: 'high',
    patterns: [/\b(pay|fee|charges?|payment)\b.{0,40}\b(offer letter|admission letter|acceptance letter|seat confirmation)\b/i,
      /\b(offer letter|admission letter)\b.{0,40}\b(after|once|on)\s+(payment|you pay)/i],
  },
  {
    id: 'fee_for_cas', severity: 'medium',
    patterns: [/\b(pay|fee|charges?|payment|deposit)\b.{0,40}\b(cas|coe|i-?20)\b/i,
      /\b(cas|coe|i-?20)\b.{0,40}\b(after|once|on)\s+(payment|you pay)/i],
  },
  {
    id: 'fee_discount_third_party', severity: 'high',
    patterns: [/\b(discount|cheaper|better (exchange )?rate|lower rate|kam rate|sasta)\b.{0,80}\b(through|via|with|from)\s+(us|me|our (service|company|agency|agent))\b/i,
      /\b(pay|paying|send|transfer)\b.{0,40}\b(through|via|to)\s+(us|me)\b.{0,60}\b(discount|better (exchange )?rate|cheaper)\b/i,
      /\b(i|we)\s+(will|can|'ll)\s+pay\b.{0,40}\b(on your behalf|for you)\b/i,
      /\bmost (international )?students pay (this|that) way\b/i],
  },
  {
    id: 'secrecy', severity: 'high',
    // "Do not tell anyone your OTP" is protective advice, not secrecy.
    unless: /\b(password|otp|pin|passcode|code|login)\b/i,
    // "contact" is left out: "do not contact the embassy while your application is processed" is genuine advice.
    patterns: [/\b(don'?t|do not|never)\s+(tell|share|inform)\b.{0,40}\b(anyone|parents?|family|university|embassy|anybody)\b/i,
      /\b(keep (it|this) (secret|confidential|between us))\b/i,
      /\b(kisi|ghar\s*wal\w*|family|parents|walid\w*|abbu|ammi)\s+ko\s+((b|bhi)\s+)?(mat|na|nahi)\s+(batana|batao|bataen|bataein|bataye|bataiye|bataiyega)\b/i],
  },
  {
    id: 'secrecy_ur', msg: 'secrecy', severity: 'high',
    patterns: [/کسی\s*کو\s*(مت|نہ)\s*(بتا|بتانا|بتائیں)/u, /(یونیورسٹی|سفارت خانے|ایمبیسی)[^.۔]{0,20}(رابطہ\s*(نہ|مت))/u],
  },
  {
    id: 'no_direct_contact', severity: 'high',
    patterns: [/\b(don'?t|do not|no need to)\s+(contact|email|call|check with|apply (directly|yourself) (to|on))\b.{0,30}\b(university|college|institution|portal)\b/i,
      /\b(we|i) (will )?(handle|manage|do) (all|everything)\b.{0,30}\b(portal|login|password)\b/i,
      /\b(university|college|embassy|admissions?)\s+(ko|se)\s+(call|rabta|contact|email|baat)\s+(mat|na|nahi)\b/i],
  },
  {
    id: 'portal_withheld', severity: 'high',
    patterns: [/\b(no need|don'?t need|do not need)\b.{0,20}\b(to see|the login|login|password|access)\b/i,
      /\b(we|i) (will )?(keep|hold|manage)\b.{0,20}\b(your )?(login|password|immiaccount)\b/i],
  },
  {
    id: 'credentials', severity: 'high', negatable: true,
    patterns: [/\b(send|share|give)\b.{0,30}\b(password|otp|one[- ]time (code|password)|verification code|login( details)?|code you (got|received))\b/i,
      /\b(otp|password|pin|passcode|login|code)\b.{0,20}\b(bhej|bhejo|bhejein|bata|batao|bataen|de do|dedo|share kar)\w*/i],
  },
  {
    id: 'credentials_ur', msg: 'credentials', severity: 'high',
    patterns: [/(او ?ٹی ?پی|پاس ?ورڈ|کوڈ)[^.۔]{0,25}(بھیج|بتا|دے)/u],
  },
  {
    id: 'gov_impersonation_ur', msg: 'gov_impersonation', severity: 'high', help: true,
    patterns: [/(گرفتار|گرفتاری|مقدمہ|ایف آئی آر|ڈی پورٹ|ملک بدر)[^.۔]{0,60}(ورنہ|جرمانہ|ادا|رقم|پیسے)|(ورنہ|جرمانہ)[^.۔]{0,60}(گرفتار|گرفتاری|مقدمہ|ڈی پورٹ)/u],
  },
  {
    id: 'property_sale', severity: 'high',
    // A university advising students who are selling property to talk to its advisers is not pressure.
    unless: /\b(speak|speaking|talk|talking) to (our|an|a|your) (advis|counsel)/i,
    patterns: [/\b(sell|selling|mortgage|pawn)\b.{0,30}\b(house|home|land|plot|property|gold|jewel(le)?ry|car)\b/i, /\b(zameen|ghar|sona)\s+(bech|bechna|bechein|bech do)\b/i],
  },
  {
    id: 'visa_fixer', severity: 'high',
    patterns: [/\b(embassy|visa officer|consulate)\b.{0,40}\b(connection|setting|inside|link|arrange)\b/i, /\b(no interview|without interview|skip (the )?interview)\b/i,
      /\b(fake|arranged|edited)\s+(bank statement|documents?|ielts|transcripts?)\b/i],
  },
  {
    id: 'funds_arranged', severity: 'high',
    patterns: [/\b(we|i)\s*(will|can|'ll)\s+(show|arrange|provide|manage|put|maintain)\b.{0,30}\b(funds?|bank statement|balance|money)\b/i,
      /\b(funds?|statement|balance)\b.{0,30}\b(show|arrange|banwa|lagwa)\w*\s+(kar\s+)?(denge|dein ge|dain ge|dunga)\b/i],
  },
  {
    id: 'fake_test_score', severity: 'high',
    patterns: [/\b(buy|purchase|get)\b.{0,30}\b(ielts|pte|toefl|duolingo|oet)\b.{0,40}\b(without (giving |taking |sitting )?(the |an )?(exam|test)|certificate|trf|bands? guaranteed)\b/i,
      /\b(ielts|pte|toefl|duolingo)\b.{0,20}\b(without (exam|test)|bina (exam|paper|test))\b/i],
  },
  {
    id: 'gov_impersonation', severity: 'high', negatable: true, help: true,
    patterns: [/\b(ukvi|home office|immigration|border (force|agency)|embassy|high commission|consulate|fia|nccia|cyber ?crime|police|sevp|ircc|home affairs)\b.{0,80}\b(deport(ed|ation)?|arrest(ed)?|warrant|fine|penalt(y|ies)|case (is |has been )?(against|registered|darj|filed)|blacklist(ed)?|giraftar|parcha|fir)\b/i,
      /\b(deport(ed|ation)?|arrest(ed)?|warrant|giraftar)\b.{0,60}\b(unless|until|if you don'?t|warna|nahi to)\b.{0,40}\b(pay|send|transfer|payment|paise|raqam|jama)\b/i],
  },
  {
    id: 'withdrawal_threat', severity: 'medium',
    patterns: [/\b(cas|coe|i-?20|offer|admission|visa|seat)\b.{0,40}\b(will be|is being|gets?|may be)\s+(withdrawn|cancel+ed|revoked|rejected)\b.{0,60}\b(unless|if you (do not|don'?t)|until you)\b.{0,30}\b(pay|send|transfer)\b/i],
  },
  {
    id: 'money_mule', severity: 'high', help: true,
    patterns: [/\b(receive|accept|get)\b.{0,40}\b(money|payment|funds|transfer)\b.{0,40}\b(in|into)\s+your\s+(bank\s+)?account\b.{0,80}\b(transfer|send|forward|pass)\b/i,
      /\b(let (me|us|him|them) use|lend( me| us)?|rent( out)?|sell)\s+(your\s+)?(bank\s+)?account\b/i,
      /\b(keep|rakh(o|lo|na)?)\b.{0,20}\b\d{1,2}\s*%/i,
      /\b(account|khata)\b.{0,30}\b(use karne|istemal karne|de do|kiraye)\b/i,
      /\b(paise|raqam|paisay)\b.{0,40}\b(aage bhej|forward kar)\w*/i],
  },
  {
    id: 'sextortion', severity: 'high', help: true,
    patterns: [/\b(video|photos?|pictures?|pics|images?|tasveer\w*)\b.{0,40}\b(send|share|post|leak|upload|viral|bhej)\w*\b.{0,40}\b(family|parents|friends|university|everyone|contacts|followers|social media|sab ko|ghar wal\w*)\b/i,
      /\b(video|photos?|pictures?|pics|images?|tasveer\w*)\b.{0,30}\b(sab ko|ghar wal\w*|family ko)\b.{0,20}\b(bhej|dikha|viral)\w*/i,
      /\b(pay|send money|paise bhejo|paisay bhejo)\b.{0,40}\b(or|warna|otherwise|else)\b.{0,60}\b(video|photos?|pictures?|pics|images?)\b/i],
  },
  {
    id: 'document_retention', severity: 'medium',
    patterns: [/\b(we|i)\s+(will\s+)?(keep|hold)\b.{0,30}\b(your\s+)?(original\s+)?(passport|documents?|degree|certificates?)\b/i,
      /\b(passport|documents?)\b.{0,30}\b(hamare|humare|mere)\s+(paas|pas)\b/i,
      /\b(original|asli)\s+(passport|documents?)\b.{0,60}\b(we|i)\s+(will\s+)?(keep|hold)\b/i],
  },
  {
    id: 'visa_switch', severity: 'medium',
    patterns: [/\b(visit|visitor|tourist)\s+visa\b.{0,60}\b(switch|change|convert)\w*\b.{0,30}\b(student|study|work)\b/i,
      /\bwork\b.{0,20}\bon (a )?(visit|visitor|tourist) visa\b/i],
  },
  {
    id: 'appointment_sale', severity: 'medium',
    patterns: [/\b(embassy|consulate|high commission)\b.{0,40}\b(appointment|slot)\b.{0,60}(\d[\d,]*\s*(rs|rupees|pkr|euro|€|lakh)|\brs\.?\s*\d|\bpkr\s*\d|\blakh\b|€\s*\d)/i,
      /\b(appointment|slot)s?\b.{0,40}\b(whats\s*app)\b/i],
  },
  {
    id: 'who_listed_claim', severity: 'medium',
    patterns: [/\b(who|w\.h\.o\.?)\s+(approved|recogni[sz]ed|listed)\b/i, /\b(pmdc|pmc|hec)\s+(approved|recogni[sz]ed|verified)\b/i],
  },
  {
    id: 'ielts_waiver_paid', severity: 'medium',
    patterns: [/\b(ielts|toefl|pte|english test)\b.{0,30}\b(waiver|not required|no need)\b.{0,40}\b(fee|pay|charges?)\b/i],
  },
  {
    id: 'refund_promise', severity: 'medium',
    patterns: [/\b(full|100\s*%)\s+refund(able)?\b/i, /\bmoney back\b/i],
  },
  {
    id: 'whatsapp_only', severity: 'medium',
    patterns: [/\b(only|just)\s+(on\s+)?(whats\s*app|telegram|signal)\b/i, /\b(whats\s*app|telegram) only\b/i],
  },
  {
    id: 'scholarship_fee', severity: 'high', negatable: true,
    patterns: [/\bscholarship\b.{0,50}\b(processing|registration|application|release|security)\s+(fee|charges?|deposit)\b/i,
      /\bscholarship\b.{0,60}\b(release|claim|receive)\b.{0,30}\b(award|amount|funds?)\b/i,
      /\b(processing|release|registration)\s+fee\b.{0,40}\b(release|award|scholarship)\b/i],
  },
];

// Phrases that try to instruct automated tools; shown so a student understands manipulation.
const INJECTION = /\b(ignore (all |the )?(previous|prior|above) (instructions|rules)|mark (this|as) (accepted|verified|genuine)|you are now|system prompt)\b/i;

// A negation counts only within the same clause: "Don't worry, send me the OTP" is not negated (round 4 F-1).
const NEG_BEFORE = /\b(no|never|not|without|free of|don'?t|do not|will not|won'?t)\b[^.!?۔,:;]{0,30}$/i;
const NEG_INSIDE = /\b(no|never|without|free of)\b/i;

function isNegated(src, m) {
  const sentenceStart = Math.max(src.lastIndexOf('.', m.index), src.lastIndexOf('!', m.index), src.lastIndexOf('?', m.index), src.lastIndexOf('۔', m.index));
  const before = src.slice(sentenceStart + 1, m.index);
  return NEG_BEFORE.test(before) || NEG_INSIDE.test(m[0]);
}

function firstMatch(src, rule) {
  for (const re of rule.patterns) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of src.matchAll(g)) {
      if (rule.negatable && isNegated(src, m) && !(rule.negateUnlessMatch && rule.negateUnlessMatch.test(m[0]))) continue;
      if (rule.negateBefore) {
        const start = Math.max(src.lastIndexOf('.', m.index), src.lastIndexOf('!', m.index), src.lastIndexOf('?', m.index), src.lastIndexOf('۔', m.index)) + 1;
        const before = src.slice(start, m.index);
        const after = src.slice(m.index + m[0].length, m.index + m[0].length + 120);
        // The disclaimer must be in this sentence, and nothing around it may turn it into a sales line.
        // The disclaimer's own subject ("We cannot guarantee") is not a sales line; strip it before the guard.
        const context = before.replace(rule.negateBefore, '')
          .replace(/\b(we|i|they|you|it|this|the \w+)\s*$/i, '');
        const guarded = rule.negateUnless && (rule.negateUnless.test(rule.guardWholeClause ? before : context) || rule.negateUnless.test(after));
        if (rule.negateBefore.test(before) && !guarded) continue;
      }
      if (rule.unless && rule.unless.test(src.slice(m.index, m.index + m[0].length + 80))) continue;
      return m;
    }
  }
  return null;
}

// Undo the usual evasions before matching: hidden characters, lookalike letters, full-width forms and
// spaced-out words ("G u a r a n t e e d"). The excerpt shown to the student comes from this cleaned text.
function clean(text) {
  return foldLookalikes(stripFormat(String(text || '').slice(0, 20000))).normalize('NFKC')
    .replace(/\u{1F4AF}/gu, ' 100% ')
    .replace(/\b(?:[A-Za-z] ){3,}[A-Za-z]\b/g, (m) => m.replace(/ /g, ''))
    // "g.u.a.r.a.n.t.e.e.d", "Guar-anteed": letters split by dots or hyphens inside one word.
    .replace(/\b(?:[A-Za-z][.\-]){3,}[A-Za-z]\b/g, (m) => m.replace(/[.\-]/g, ''))
    .replace(/\b(guar|gaur|gua)-(anteed?|antee)\b/gi, '$1$2')
    // Spaced capitals run words together ("GUARANTEEDVISA"); split the words we look for back out.
    .replace(/(GUARANTEED)(VISA|ADMISSION|SEAT)/gi, '$1 $2');
}

export function scanMessage(text) {
  const src = clean(text);
  const flags = [];
  for (const rule of RULES) {
    const m = firstMatch(src, rule);
    if (m) flags.push({ id: rule.id, msg: rule.msg || rule.id, severity: rule.severity, excerpt: excerptAround(src, m.index, m[0].length) });
  }
  if (INJECTION.test(src)) flags.push({ id: 'injection', msg: 'injection', severity: 'medium', excerpt: '' });
  const high = flags.filter((f) => f.severity === 'high').length;
  const level = high >= 1 ? 'danger' : flags.length ? 'caution' : 'none_found';
  const needsHelp = flags.some((f) => RULES.find((r) => r.id === f.id)?.help);
  return { level, flags, needsHelp };
}

export const RULE_MESSAGES = [...new Set(RULES.map((r) => r.msg || r.id))];

function excerptAround(src, index, len) {
  const start = Math.max(0, index - 30);
  const end = Math.min(src.length, index + len + 30);
  return (start > 0 ? '…' : '') + src.slice(start, end).replace(/\s+/g, ' ').trim() + (end < src.length ? '…' : '');
}
