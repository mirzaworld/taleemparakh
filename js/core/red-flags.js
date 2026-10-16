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


// ---- Laiba coverage gaps G4, G5, G9, G14, G16 (docs/plan/LAIBA-COVERAGE-AUDIT.md section 7) -------------------------
// Urdu letters are matched as whole words: no Urdu letter may sit directly before or after, and the word داخلہ
// ("admission") does not count inside the phrases وزارت داخلہ, وزیر داخلہ, امور داخلہ ("Interior Ministry"),
// the same defect the news classifier had. Urdu-script patterns carry the `u` flag and never use `\b`.
// Letters and marks only: the Urdu comma (U+060C), full stop and digits do not count as part of a word.
const UR_L = '\\u0620-\\u065F\\u066E-\\u06D3\\u06D5\\u06FA-\\u06FF';
const uw = (words) => `(?<![${UR_L}])(?:${words})(?![${UR_L}])`;
const UR_HOME = '(?<!(?:وزارت|وزیر|امور|سیکریٹری|سیکرٹری|محکمہ|مشیر|اخبار|ریاست)\\s)';
const UR_ADMISSION = `(?<![${UR_L}])${UR_HOME}داخلہ(?![${UR_L}])|${uw('ایڈمیشن|سیٹ')}`;
const UR_CATEGORY = `${UR_ADMISSION}|${uw('ویزا|ویزہ|ویزے|اسکالرشپ|وظیفہ|نوکری|ملازمت|جاب')}`;
const UR_ORG = '(?:سپریم کورٹ|ہائی کورٹ|ڈسٹرکٹ کورٹ|عدالت|وزارت|سفارت\\s*خانے|سفارتخانے|سفارت\\s*خانہ|ایف آئی اے|سیکرٹریٹ|سیکریٹریٹ|ہائی کمیشن|ایمبیسی|حکومت)';

const ORG_EN = '(?:supreme court|high court|district court|the court|courts?|ministry|secretariat|embassy|high commission|consulate|fia|nccia|nab|home office|ukvi|foreign office|govt|government|hec|immigration|prime minister(?:\'s)? (?:office|house)|president house|parliament|assembly)';
const CATEGORY_EN = '(?:admission|scholarship|visa|job|work permit|seat|offer letter|appointment|sponsorship|dakhla|dakhila|naukri)';
const OFFER_EN = new RegExp(String.raw`\b(?:(?:can|will|'ll|could|able to|going to|shall)\s+(?:\w+\s+){0,3}(?:get|arrange|give|provide|secure|fix|sort|organi[sz]e|manage|guarantee|obtain|process|speed|help)\w*|get(?:ting)?\s+you|help\s+you\s+(?:get|with)|arrange\w*|guarantee\w*)\b[^.!?]{0,60}\b${CATEGORY_EN}\b`, 'i');
const OFFER_EN_REVERSE = new RegExp(String.raw`\b${CATEGORY_EN}\b[^.!?]{0,40}\b(?:dilwa|lagwa|dila|karwa|laga\s+d|arrange|guarantee|pakk[ai])\w*`, 'i');
const OFFER_UR = [new RegExp(`(?:${UR_CATEGORY})[^.۔!?]{0,50}(?:دلوا|لگوا|کروا|دلا\\s*د|انتظام|گارنٹی|پکا|پکی)`, 'u'),
  new RegExp(`(?:دلوا|لگوا|کروا|انتظام|گارنٹی)[^.۔!?]{0,50}(?:${UR_CATEGORY})`, 'u')];

const POST_CLAIMS = [
  new RegExp(String.raw`\b(?:i|we)\s*(?:am|'m|are)?\s*(?:work(?:ing|s)?|serv(?:e|es|ing)|employed|posted|based)\s+(?:at|in|inside)\s+(?:the\s+)?(?:\w+\s+){0,2}?${ORG_EN}\b`, 'i'),
  new RegExp(String.raw`\b(?:i am|i'm|my (?:uncle|father|brother|friend|cousin|relative|husband|wife|contact))\s+(?:is\s+)?(?:a\s+|an\s+|the\s+)?(?:senior\s+)?(?:judge|registrar|officer|official|secretary|minister|ambassador|consul|magistrate)\b`, 'i'),
  new RegExp(String.raw`\b(?:i|we)\s+(?:have|got|know)\s+(?:\w+\s+){0,2}(?:contacts?|connections?|links?|people|friends?|relatives?|officers?)\s+(?:in|at|inside|with)\s+(?:the\s+)?(?:\w+\s+){0,2}?${ORG_EN}\b`, 'i'),
  new RegExp(String.raw`\bmy\s+(?:contacts?|connections?)\b[^.!?]{0,15}\b(?:in|at|inside)\s+(?:the\s+)?(?:\w+\s+){0,2}?${ORG_EN}\b`, 'i'),
  // Roman Urdu: "mera taluq supreme court se hai", "meri jaan pehchan embassy mein hai", "wazarat mein meri sifarish".
  /\b(?:mera|meri|mere|humara|hamara)\s+(?:taluq|talluq|rabta|jaan\s*pehchan|pehchan|sifarish)\b[^.!?]{0,40}\b(?:court|adalat|ministry|wazarat|embassy|sefarat|safarat|fia|sarkar|sarkari|secretariat|high commission)\b/i,
  /\b(?:court|adalat|ministry|wazarat|embassy|sefarat|safarat|fia|sarkari|secretariat)\b[^.!?]{0,30}\b(?:mein|main|me)\s+(?:meri|mera|mere)\s+(?:jaan\s*pehchan|sifarish|taluq|pehchan)\b/i,
  /\b(?:main|mai|hum|ham)\s+(?:supreme court|high court|court|adalat|ministry|wazarat|embassy|sefarat|fia|sarkari)\b[^.!?]{0,30}\b(?:mein|main|me)\s+(?:kaam|job|naukri|posted)\b/i,
  // Urdu script: "میں سپریم کورٹ میں کام کرتا ہوں", "عدالت سے میرا تعلق ہے".
  new RegExp(`${UR_ORG}[^.۔!?]{0,30}(?:کام کرتا ہوں|کام کرتی ہوں|ملازم ہوں|ملازمت کرتا|ملازمت کرتی|تعینات ہوں|افسر ہوں|جج ہوں)`, 'u'),
  new RegExp(`${UR_ORG}[^.۔!?]{0,25}(?:میرا|میری|میرے)\\s+(?:تعلق|جان پہچان|واقفیت|رابطہ|رابطے)`, 'u'),
  new RegExp(`(?:میرا|میری|میرے|ہمارا|ہماری)\\s+(?:تعلق|جان پہچان|واقفیت|رابطہ|رابطے)[^.۔!?]{0,40}${UR_ORG}`, 'u'),
];
// A promised government job, for anyone, is its own sign.
const GOV_JOB = [
  /\b(?:dilwa|lagwa|dila|arrange|guarantee|promise|get you|give you|provide)\w*\b[^.!?]{0,30}\b(?:sarkari\s+(?:naukri|job)|government\s+job|govt\.?\s+job)\b/i,
  /\b(?:sarkari\s+(?:naukri|job)|government\s+job|govt\.?\s+job)\b[^.!?]{0,30}\b(?:dilwa|lagwa|dila|pakk[ai]|guarantee|arrange)\w*/i,
  new RegExp(`${uw('سرکاری نوکری|سرکاری ملازمت')}[^.۔!?]{0,30}(?:دلوا|لگوا|پکی|گارنٹی)|(?:دلوا|لگوا|گارنٹی)[^.۔!?]{0,30}${uw('سرکاری نوکری|سرکاری ملازمت')}`, 'u'),
];

// The same clause must not hold a plain disclaimer ("cannot guarantee", "never promise", "visit visa holders may not work").
const DISCLAIM = /\b(no|not|never|cannot|can't|can not|won't|doesn't|don't|isn't|aren't|unable|nobody|without|nahi|nahin|mat)\b|n't\b|(?<![؀-ۿ])(?:نہیں|مت|کبھی نہیں)(?![؀-ۿ])/iu;
// Urdu puts the negative after the verb: "کام کرنے کی اجازت نہیں ہے" (work is not allowed).
const URDU_NEG_AFTER = /^[^.۔!?]{0,40}?(?<![\u0620-\u065F\u066E-\u06D3\u06D5\u06FA-\u06FF])(?:نہیں|منع|ممنوع)(?![\u0620-\u065F\u066E-\u06D3\u06D5\u06FA-\u06FF])/u;
function clauseBefore(src, index) {
  const cut = Math.max(src.lastIndexOf('.', index), src.lastIndexOf('!', index), src.lastIndexOf('?', index), src.lastIndexOf('۔', index),
    src.lastIndexOf(',', index), src.lastIndexOf(';', index), src.lastIndexOf('\n', index), src.lastIndexOf('،', index));
  let before = src.slice(cut + 1, index);
  const but = [...before.matchAll(/\b(but|however|lekin|magar)\b/gi)].pop();
  if (but) before = before.slice(but.index + but[0].length);
  return before;
}

function benefactorMatch(src) {
  for (const re of POST_CLAIMS) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of src.matchAll(g)) {
      const from = Math.max(0, m.index - 250);
      const win = src.slice(from, m.index + m[0].length + 250);
      const nearby = win.slice(0, m.index - from) + ' ' + win.slice(m.index - from + m[0].length);
      if (OFFER_EN.test(win) || OFFER_EN_REVERSE.test(win) || OFFER_UR.some((o) => o.test(win)) || OFFER_EN.test(nearby)) {
        // "I never claim to work at a court": a disclaimer in the clause before the claim is not a boast.
        if (DISCLAIM.test(clauseBefore(src, m.index))) continue;
        return m;
      }
    }
  }
  for (const re of GOV_JOB) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    for (const m of src.matchAll(g)) if (!DISCLAIM.test(clauseBefore(src, m.index) + m[0])) return m;
  }
  return null;
}

// Admission, scholarship, visa and job sold as one package. Job plus two others, or the first three with a
// strong "I will arrange" verb. A sentence that says guidance, advice or information is a service description.
const CATS = {
  admission: new RegExp(String.raw`\b(?:admissions?|dakhl?a|dakhila|seats?|offer letters?)\b|${UR_ADMISSION}`, 'iu'),
  scholarship: new RegExp(String.raw`\b(?:scholarships?|wazifa|funding|stipend)\b|${uw('اسکالرشپ|وظیفہ')}`, 'iu'),
  visa: new RegExp(String.raw`\b(?:visas?|visa)\b|${uw('ویزا|ویزہ|ویزے')}`, 'iu'),
  job: new RegExp(String.raw`\b(?:jobs?|naukri|employment|work permits?)\b|${uw('نوکری|ملازمت|جاب')}`, 'iu'),
};
const BUNDLE_VERB = /\b(?:get|arrange|give|provide|secure|organi[sz]e|dilwa|lagwa|dila|karwa|package|deal|everything|all[- ]in[- ]one|complete)\w*|(?<![؀-ۿ])(?:دلوا|لگوا|کروا|انتظام|پیکج)\w*/iu;
const BUNDLE_STRONG = /\b(?:arrange|guarantee|dilwa|lagwa|dila|karwa|get you|give you|will get|will give|package|everything|all[- ]in[- ]one)\w*|(?<![؀-ۿ])(?:دلوا|لگوا|کروا|انتظام|گارنٹی|پیکج)\w*/iu;
const BUNDLE_SERVICE = /\b(?:guidance|advice|advising|advis[eo]rs?|information|support service|workshops?|fairs?|events?|webinars?|seminars?|careers? service|resources?|news|updates|rules|requirements)\b/i;
function bundleMatch(src) {
  for (const sm of src.matchAll(/[^.!?۔\n]+/gu)) {
    const sentence = sm[0];
    if (BUNDLE_SERVICE.test(sentence) || DISCLAIM.test(sentence)) continue;
    const has = Object.fromEntries(Object.entries(CATS).map(([k, re]) => [k, re.test(sentence)]));
    const count = Object.values(has).filter(Boolean).length;
    const strongTrio = has.admission && has.scholarship && has.visa && BUNDLE_STRONG.test(sentence);
    if ((has.job && count >= 3 && BUNDLE_VERB.test(sentence)) || strongTrio) return { index: sm.index, 0: sentence.trim() };
  }
  return null;
}

const rx = (src, flags = 'i') => new RegExp(src, flags);
const JOBW = String.raw`(?:jobs?|employment|naukri)`;
const RECOVER_FEE = String.raw`(?:fees?|charges?|commission|advance|deposit|up-?front|\d+\s*%|percent|service charge|processing)`;

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
  // ---- Laiba coverage gaps (G4, G14, G16, G5, G9): see the helper block above RULES. ----
  {
    id: 'benefactor_official', severity: 'high', test: benefactorMatch,
  },
  {
    id: 'bundle_offer', severity: 'high', test: bundleMatch,
  },
  {
    id: 'job_guarantee', severity: 'high', disclaim: true,
    patterns: [rx(String.raw`\b(?:guarantee[ds]?|guaranteed|assured|confirmed?|100\s*%)\s+(?:\w+\s+){0,2}${JOBW}\b`),
      rx(String.raw`\b${JOBW}\s+(?:is\s+|are\s+)?(?:100\s*%\s+)?(?:guarantee[ds]?|guaranteed|assured|pakk[ai]|confirm\w*)\b`),
      rx(String.raw`\b(?:we|i)\s*(?:will|can|'ll|shall)\s+(?:also\s+)?(?:get|give|arrange|provide|find|offer)\s+(?:you|your\s+\w+|him|her)\s+(?:a\s+|an\s+)?(?:\w+\s+)?(?:job|naukri)\b`),
      /\b(?:naukri|job)\s+(?:bhi\s+)?(?:dilwa|lagwa|dila|pakk[ai]|confirm)\w*/i, /\bpakk[ai]\s+(?:naukri|job)\b/i, /\b(?:job|naukri)\s+(?:ki\s+)?(?:gu?[ae]?ran?t[ei]e|garantee)\b/i,
      rx(`${uw('نوکری|ملازمت|جاب')}[^.۔!?]{0,25}(?:گارنٹی|پکی|یقینی|دلوا|لگوا)`, 'u'),
      rx(`(?:گارنٹی|گارنٹیڈ|پکی|یقینی)[^.۔!?]{0,20}${uw('نوکری|ملازمت|جاب')}`, 'u')],
  },
  {
    // A visit visa is not a work visa; a work permit does not come with a place at a university.
    id: 'work_route_promise', severity: 'high', disclaim: true,
    patterns: [/\b(?:visit(?:or)?|tourist|visiting)\s+visa\b[^.!?]{0,60}\b(?:work|working|jobs?|employment|naukri|kaam)\b/i,
      /\b(?:work|working|jobs?|naukri|kaam)\b[^.!?]{0,40}\b(?:on|with|through|using|par|pe|per|se)\s+(?:a\s+|an\s+)?(?:visit(?:or)?|tourist)\s+visa\b/i,
      /\bwork\s*permits?\b[^.!?]{0,40}\b(?:with|along with|plus|free|included|together with|ke saath|bhi milega)\b[^.!?]{0,30}\b(?:admission|study|studies|course|offer|dakhla|dakhila|seat)\b/i,
      /\b(?:admission|study|course|offer|dakhla|dakhila|seat)\b[^.!?]{0,30}\b(?:with|plus|and|free|ke saath)\b[^.!?]{0,15}\b(?:a\s+)?(?:free\s+)?work\s*permits?\b/i, /\bfree work\s*permits?\b/i,
      rx(`(?:وزٹ|وزیٹ|ٹورسٹ)\\s*ویزا?[^.۔!?]{0,40}${uw('نوکری|کام|جاب|ملازمت')}`, 'u'),
      rx(`${uw('ورک پرمٹ')}[^.۔!?]{0,40}(?:ساتھ|مفت)[^.۔!?]{0,30}(?:${UR_ADMISSION})`, 'u')],
  },
  {
    // Joining a group to "get" a scholarship or appointment. A real university's group for updates is not this.
    id: 'group_scholarship', severity: 'high', disclaim: true,
    unless: /\b(?:updates?|news|alerts?|announcements?|tips|advice|guidance|information|reminders?|help)\b|اپ ڈیٹ|خبر|اطلاع/iu,
    patterns: [rx(String.raw`\bjoin\b[^.!?]{0,40}\b(?:groups?|channels?|whats\s*app|telegram|page|community)\b[^.!?]{0,60}\b(?:to|for)\s+(?:get|receive|claim|secure|win|obtain|apply|book|confirm|avail)\w*\b[^.!?]{0,40}\b(?:scholarships?|appointments?|slots?|visa|admission|funding|stipend)\b`),
      rx(String.raw`\b(?:to|for)\s+(?:get|receive|claim|secure|win|obtain|apply|book|confirm|avail)\w*\b[^.!?]{0,40}\b(?:scholarships?|appointments?|slots?|funding|stipend)\b[^.!?]{0,40}\bjoin\b[^.!?]{0,40}\b(?:groups?|channels?|whats\s*app|telegram|page)\b`),
      /\b(?:group|channel)\s+(?:ko\s+)?join\s+(?:kar\w*)\b[^.!?]{0,60}\b(?:scholarship|appointment|slot|visa|admission)/i,
      /\b(?:scholarship|appointment|slot|visa)\b[^.!?]{0,60}\b(?:group|channel)\s+(?:ko\s+)?join\b/i,
      rx(`${uw('گروپ|چینل|واٹس ایپ|ٹیلی گرام')}[^.۔!?]{0,40}(?:جوائن|شامل)[^.۔!?]{0,60}${uw('اسکالرشپ|وظیفہ|اپوائنٹمنٹ|اپائنٹمنٹ|ویزا')}`, 'u'),
      rx(`${uw('اسکالرشپ|وظیفہ|اپوائنٹمنٹ|اپائنٹمنٹ|ویزا')}[^.۔!?]{0,60}${uw('گروپ|چینل')}[^.۔!?]{0,30}(?:جوائن|شامل)`, 'u')],
  },
  {
    // Money keeps moving for a "last" step: release, clearance, "one last payment" (the escalation in Laiba's case).
    id: 'escalating_fee', severity: 'high', disclaim: true,
    patterns: [/\b(?:release|clearance|unlock|unfreez\w*)\s+(?:fees?|charges?|payments?)\b/i,
      /\b(?:one|just one)\s+(?:last|final|more)\s+(?:payment|fee|charge|transfer|time)\b/i,
      rx(String.raw`\b(?:last|final)\s+(?:payment|fees?|charges?)\b(?![^.!?]{0,40}\b(?:instal?ments?|portal|tuition)\b)[^.!?]{0,60}\b(?:visa|release[ds]?|clearance|file|scholarship|funds?)\b`),
      /\b(?:akhri|aakhri|akhiri)\s+(?:payment|fee|baar|charges?|raqam)\b/i, /\b(?:ek aur|aur ek)\s+(?:payment|fee|charge)\b/i,
      rx(`(?:آخری)\\s+(?:ادائیگی|فیس|چارجز|بار|رقم)|${uw('ریلیز فیس|کلیئرنس چارجز|کلیئرنس فیس')}`, 'u')],
  },
  {
    // Plain "last payment" or "final fee" is also what a real instalment letter says, so it is only a reminder.
    id: 'escalating_fee_soft', msg: 'escalating_fee', severity: 'medium', disclaim: true, dedupe: true,
    unless: /\b(?:instal?ments?|portal|tuition|semester|term|date|deadline|deposit|student account)\b/i,
    patterns: [/\b(?:last|final)\s+(?:payment|fee|charges?)\b/i],
  },
  {
    // Recovery scams target people who already lost money. A real service for victims does not charge a fee.
    id: 'recovery_scam', severity: 'high', disclaim: true, help: true,
    patterns: [rx(String.raw`\b(?:recover|retrieve|get back|claw back|trace)\w*\b[^.!?]{0,40}\b(?:money|funds?|payments?|amounts?|rupees|savings|losses|crypto)\b[^.!?]{0,80}\b${RECOVER_FEE}\b`),
      rx(String.raw`\b${RECOVER_FEE}\b[^.!?]{0,60}\b(?:recover|retrieve|get back)\w*\b[^.!?]{0,30}\b(?:money|funds?|payments?|amounts?|rupees|losses)\b`),
      /\b(?:fund|scam|money|asset)\s+recovery\s+(?:agent|service|company|expert|specialist|team|lawyer|firm|agency)s?\b/i,
      /\b(?:paise|paisay|raqam|rupay|funds?|money)\b[^.!?]{0,30}\b(?:wapis|wapas)\b[^.!?]{0,40}\b(?:dilwa|dila|karwa|nikalw)\w*[^.!?]{0,60}\b(?:fee|charges?|commission|percent|%|advance)/i,
      /\b(?:fee|charges?|commission|percent|%|advance)\b[^.!?]{0,60}\b(?:paise|paisay|raqam|rupay|funds?|money)\b[^.!?]{0,30}\b(?:wapis|wapas)\b/i,
      rx(`${uw('رقم|پیسے|پیسوں')}[^.۔!?]{0,40}واپس[^.۔!?]{0,40}(?:دلوا|کروا|نکلوا|دلا)[^.۔!?]{0,80}${uw('فیس|چارجز|کمیشن|فیصد|ایڈوانس')}`, 'u'),
      rx(`${uw('فیس|چارجز|کمیشن|ایڈوانس')}[^.۔!?]{0,60}${uw('رقم|پیسے|پیسوں')}[^.۔!?]{0,30}واپس`, 'u')],
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
  if (rule.test) return rule.test(src);
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
      if (rule.disclaim && (DISCLAIM.test(clauseBefore(src, m.index) + m[0]) || URDU_NEG_AFTER.test(src.slice(m.index + m[0].length, m.index + m[0].length + 40)))) continue;
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
    if (rule.dedupe && flags.some((f) => f.msg === (rule.msg || rule.id))) continue;
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

// English texts and Urdu drafts for the Laiba-gap scanner flags (keys `flag.<id>`). Lane B copies them into i18n.
// The Urdu is a draft until a native-speaking counsellor has reviewed it (docs/plan/GATES.md).
export const GAP_FLAG_TEXT = {
  en: {
    'flag.benefactor_official': 'Someone says they work in a court, ministry, embassy or government office, or have contacts there, and offers admission, a scholarship, a visa or a job. Real universities and embassies do not sell favours through people they know. Check the offer with the university yourself, using the contact on its own website.',
    'flag.bundle_offer': 'One person offers admission, a scholarship, a visa and a job together. No agent or private person can arrange all of these. Each one is decided by a different official body. Ask each body yourself.',
    'flag.job_guarantee': 'Promises a job, often together with study. No one can guarantee a job abroad. A visa for study is not a work contract. Check a job offer with the official employment service, never with the person selling it.',
    'flag.work_route_promise': 'Suggests you can work on a visit visa, or that a work permit comes with admission. A visit visa does not allow work, and a place at a university is separate from a work permit. This is how people are trapped in illegal work.',
    'flag.group_scholarship': 'Asks you to join a group or channel to get a scholarship or an appointment. Scholarships and embassy appointments are not given out in chat groups. Use only the official website of the scholarship or the embassy.',
    'flag.escalating_fee': 'Asks for a "last", "release" or "clearance" payment. A new fee after you have paid is how scams grow. Stop, and check with the university or the official body yourself before you pay again.',
    'flag.recovery_scam': 'Offers to get your lost money back for a fee. This is a second scam aimed at people who have already lost money. Do not pay. Report to the FIA (the Federal Investigation Agency) and your bank, and read the guide for people who have already paid.',
  },
  ur: {
    'flag.benefactor_official': 'کوئی کہتا ہے کہ وہ عدالت، وزارت، سفارت خانے یا کسی سرکاری دفتر میں کام کرتا ہے یا وہاں اس کے جاننے والے ہیں، اور داخلے، اسکالرشپ، ویزے یا نوکری کی پیشکش کرتا ہے۔ اصلی یونیورسٹیاں اور سفارت خانے جان پہچان کے ذریعے مہربانیاں نہیں بیچتے۔ پیشکش کی تصدیق یونیورسٹی کی اپنی ویب سائٹ پر دیے گئے رابطے سے خود کریں۔',
    'flag.bundle_offer': 'ایک ہی شخص داخلہ، اسکالرشپ، ویزا اور نوکری سب ایک ساتھ دینے کی بات کر رہا ہے۔ کوئی ایجنٹ یا عام شخص یہ سب طے نہیں کر سکتا۔ ہر چیز کا فیصلہ الگ سرکاری ادارہ کرتا ہے۔ ہر ادارے سے خود پوچھیں۔',
    'flag.job_guarantee': 'نوکری کا وعدہ کیا گیا ہے، اکثر پڑھائی کے ساتھ۔ بیرونِ ملک نوکری کی گارنٹی کوئی نہیں دے سکتا۔ تعلیمی ویزا نوکری کا معاہدہ نہیں ہوتا۔ نوکری کی پیشکش کی تصدیق سرکاری روزگار کے ادارے سے کریں، بیچنے والے سے نہیں۔',
    'flag.work_route_promise': 'کہا جا رہا ہے کہ وزٹ ویزے پر کام ہو سکتا ہے، یا داخلے کے ساتھ ورک پرمٹ مل جائے گا۔ وزٹ ویزا کام کی اجازت نہیں دیتا، اور یونیورسٹی میں جگہ ورک پرمٹ سے الگ چیز ہے۔ لوگ اسی طرح غیر قانونی کام کے جال میں پھنستے ہیں۔',
    'flag.group_scholarship': 'اسکالرشپ یا اپائنٹمنٹ لینے کے لیے کسی گروپ یا چینل میں شامل ہونے کو کہا گیا ہے۔ اسکالرشپ اور سفارت خانے کی اپائنٹمنٹ چیٹ گروپوں میں نہیں بانٹی جاتیں۔ صرف اسکالرشپ یا سفارت خانے کی سرکاری ویب سائٹ استعمال کریں۔',
    'flag.escalating_fee': '"آخری"، "ریلیز" یا "کلیئرنس" ادائیگی مانگی جا رہی ہے۔ رقم دینے کے بعد نئی فیس آ جانا ہی فراڈ کے بڑھنے کا طریقہ ہے۔ دوبارہ ادائیگی سے پہلے رکیں اور یونیورسٹی یا متعلقہ سرکاری ادارے سے خود پوچھیں۔',
    'flag.recovery_scam': 'فیس کے بدلے آپ کی کھوئی ہوئی رقم واپس دلانے کی پیشکش کی گئی ہے۔ یہ ان لوگوں کو نشانہ بنانے والا دوسرا فراڈ ہے جو پہلے ہی رقم کھو چکے ہیں۔ پیسے نہ دیں۔ ایف آئی اے اور اپنے بینک کو اطلاع دیں، اور رقم دے چکے لوگوں کے لیے گائیڈ پڑھیں۔',
  },
};
