// Rule-based check of an email address or link a student received.
// It can say "this domain matches a website listed on an official register" or "this looks
// dangerous". It can never say "this email really came from the university" or "you are admitted".
import { hostFromInput, registrableDomain, domainLabel, domainSuffix, isAcademicDomain, levenshtein, skeleton, nameTokens, stripFormat, hasFormatChars } from './normalize.js';

export const FREEMAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com', 'live.com',
  'msn.com', 'aol.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.net',
  'mail.com', 'zoho.com', 'yandex.com', 'yandex.ru', 'qq.com', '163.com', '126.com', 'rediffmail.com',
  'tutanota.com', 'hotmail.co.uk', 'yahoo.co.uk',
]);

const LURE_WORDS = ['admission', 'admissions', 'offer', 'visa', 'scholarship', 'enrol', 'enroll', 'apply', 'portal', 'intake', 'cas', 'coe', 'i20'];
const RISKY_TLDS = new Set(['xyz', 'top', 'icu', 'click', 'buzz', 'online', 'site', 'info', 'live', 'shop', 'vip', 'work', 'support', 'today', 'cfd', 'sbs', 'rest']);
const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 'cutt.ly', 't.co', 'rb.gy', 'is.gd', 'ow.ly', 'shorturl.at', 'tiny.cc', 'rebrand.ly']);

// Commercial endings anyone can register in minutes (monash.com, monash.co.uk), as opposed to
// country endings that universities themselves use (mcgill.ca, tum.de).
const COMMERCIAL_TLDS = new Set(['com', 'net', 'org', 'biz', 'info', 'co', 'io', 'me', 'cc', 'ws', 'app', 'site', 'online', 'xyz', 'top', 'live', 'shop', 'world', 'group', 'agency', 'global', 'education', 'study', 'university', 'college', 'academy']);
function isCommercial(domain) {
  const suffix = domainSuffix(domain);
  return COMMERCIAL_TLDS.has(suffix) || /^(com|co|net|org|ltd|biz)\.[a-z]{2}$/.test(suffix);
}

// Lure words. Short ones (cas, coe, visa...) count only as a whole hyphen- or digit-separated part of
// the label, so "lancaster" or "ucas" never match "cas".
const SHORT_LURES = new Set(['cas', 'coe', 'i20', 'visa', 'apply', 'enrol', 'offer', 'intake', 'portal']);
function lureHit(label) {
  const parts = label.split(/[-\d]+/).filter(Boolean);
  return LURE_WORDS.some((w) => (SHORT_LURES.has(w) ? parts.includes(w) : label.includes(w)));
}

// University-style endings faked inside a commercial domain: oxford.ac.uk.com, ox-ac-uk.com,
// manchester-ac.uk, monash-edu-au.net, monashedu.com.
function fakeAcademic(host, domain, label) {
  if (isAcademicDomain(domain)) return null;
  const sub = host.slice(0, -domain.length);
  if (/(^|\.)(ac\.uk|edu\.au|edu\.pk|ac\.nz|edu)\.$/.test(sub)) return 'high';
  if (/\.(ac|edu)\.[a-z]{2}\.[a-z]+$/.test(host)) return 'high';
  if (/(ac-?uk|edu-?au|edu-?pk|ac-?nz)/.test(label) || /-(ac|edu)$/.test(label)) return 'high';
  if (/.{3,}edu$/.test(label)) return 'medium';
  return null;
}

/**
 * @param {string} input email address or URL
 * @param {{ officialDomains: Map<string, object[]>, claimedInstitution?: object|null }} ctx
 */
export function checkDomain(input, { officialDomains, claimedInstitution = null }) {
  const raw = stripFormat(input);
  const host = hostFromInput(input);
  const flags = [];
  if (!host || !host.includes('.')) {
    return { level: 'invalid', host, domain: '', flags: [{ id: 'invalid', severity: 'info' }] };
  }
  const domain = registrableDomain(host);
  const label = domainLabel(domain);
  const tld = domain.split('.').pop();
  const academic = isAcademicDomain(domain);

  if (/^xn--|\.xn--/.test(host) || /[^\x00-\x7f]/.test(host) || hasFormatChars(input)) flags.push({ id: 'punycode', severity: 'high' });
  // https://monash.edu@evil.com goes to evil.com: everything before "@" in a link is decoration.
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(raw.trim())) flags.push({ id: 'url_userinfo', severity: 'high', host });
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) flags.push({ id: 'ip_address', severity: 'high' });
  if (FREEMAIL.has(domain)) flags.push({ id: 'freemail', severity: 'high' });
  if (SHORTENERS.has(domain)) flags.push({ id: 'shortener', severity: 'medium' });
  if (RISKY_TLDS.has(tld)) flags.push({ id: 'risky_tld', severity: 'medium' });
  const fake = fakeAcademic(host, domain, label);
  if (fake) flags.push({ id: 'fake_academic_suffix', severity: fake });

  const listed = officialDomains.get(domain) || [];
  const claimedDomain = claimedInstitution?.w ? registrableDomain(claimedInstitution.w) : '';
  const hasHigh = () => flags.some((f) => f.severity === 'high');

  if (claimedInstitution && claimedDomain && domain === claimedDomain && !hasHigh()) {
    return { level: 'match', host, domain, flags, matches: listed };
  }
  if (claimedInstitution && listed.length && !listed.some((r) => r.i === claimedInstitution.i)) {
    flags.push({ id: 'other_institution', severity: 'high' });
    return { level: 'danger', host, domain, flags, matches: listed };
  }
  if (!claimedInstitution && listed.length && !hasHigh()) {
    return { level: 'listed', host, domain, flags, matches: listed };
  }

  // Lookalike detection against the claimed institution first, then against every listed domain.
  const candidates = claimedDomain ? [[claimedDomain, [claimedInstitution]]] : [...officialDomains.entries()];
  const sk = skeleton(label);
  for (const [official, recs] of candidates) {
    if (official === domain) continue;
    const ol = domainLabel(official);
    if (ol.length < 3) continue;
    if (label === ol) {
      // Same name, different ending (monash.edu vs monash.edu.au). Genuine institutions often own several
      // domains, so on a university-style ending this is "check first"; on a commercial ending it is how
      // impostors work (monash.com). Without a selected institution, any non-commercial ending is most
      // likely a different institution with a similar name (kent.ac.uk, mcgill.ca), so skip it.
      if (claimedDomain) {
        flags.push({ id: 'same_name_other_suffix', severity: isCommercial(domain) ? 'high' : 'medium', of: official, institution: recs[0]?.n });
        break;
      }
      if (isCommercial(domain)) {
        flags.push({ id: 'same_name_other_suffix', severity: 'high', of: official, institution: recs[0]?.n });
        break;
      }
      continue;
    }
    const embedded =
      (ol.length >= 4 && label.includes(ol) && lureHit(label)) ||
      (ol.length >= 4 && (label.startsWith(`${ol}-`) || label.endsWith(`-${ol}`))) ||
      (ol.length >= 4 && host.split('.').slice(0, -2).includes(ol));
    let typo;
    if (claimedDomain) {
      const dist = levenshtein(label, ol);
      typo = (dist > 0 && dist <= (ol.length >= 6 ? 2 : 1)) || sk === skeleton(ol);
    } else {
      // Against about 1,500 domains, only near-identical spellings with the same ending count, or the
      // classic letter swaps (rn for m, 0 for o). salford.ac.uk is not an imitation of walford.net.au.
      typo = (ol.length >= 5 && sk === skeleton(ol)) ||
        (ol.length >= 6 && domainSuffix(domain) === domainSuffix(official) && levenshtein(label, ol) === 1);
    }
    if (embedded || typo) {
      flags.push({ id: 'lookalike', severity: 'high', of: official, institution: recs[0]?.n });
      break;
    }
  }

  if (claimedInstitution && !flags.some((f) => f.id === 'lookalike' || f.id === 'same_name_other_suffix')) {
    const tokens = nameTokens(claimedInstitution.n).filter((t) => t.length >= 4 && !['university', 'college', 'institute', 'school', 'london'].includes(t));
    const named = tokens.some((t) => label.includes(t));
    // No website on the register (UK entries): compare the label with the name itself, so a one-letter
    // slip or a letter swap of the selected name (mancheste.ac.uk, oxf0rd.ac.uk) is caught.
    const nearName = !claimedDomain && tokens.some((t) => t.length >= 5 && label.length >= 4 && label !== t &&
      (skeleton(label) === skeleton(t) || levenshtein(label, t) <= (t.length >= 8 ? 2 : 1)));
    if (nearName) flags.push({ id: 'lookalike_name', severity: 'high', institution: claimedInstitution.n });
    if (nearName) {
      // already flagged above
    } else if (named && academic && !claimedDomain) {
      // UK register entries carry no website, so "manchester.ac.uk" cannot be matched. A university-style
      // ending with the institution's name is plausible, never confirmed.
      flags.push({ id: 'academic_domain_unconfirmed', severity: 'info', institution: claimedInstitution.n });
    } else if (named && !academic) {
      flags.push({ id: 'name_in_domain', severity: 'high', institution: claimedInstitution.n });
    }
  }
  if (claimedDomain && domain !== claimedDomain && !flags.some((f) => f.severity !== 'info')) {
    flags.push({ id: 'not_listed_website', severity: 'medium', website: claimedDomain, institution: claimedInstitution.n });
  }
  if (lureHit(label) && !listed.length && !academic) flags.push({ id: 'lure_word', severity: 'medium' });

  const real = flags.filter((f) => f.severity !== 'info');
  const level = real.some((f) => f.severity === 'high') ? 'danger' : real.length ? 'caution' : 'unknown';
  return { level, host, domain, flags, matches: listed };
}
