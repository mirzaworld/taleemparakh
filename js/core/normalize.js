// Pure helpers shared by the browser app, the data build script and the tests.
// No network access, no storage, no side effects.

const STOP_WORDS = new Set([
  'the', 'of', 'and', 'for', 'at', 'in', 'ltd', 'limited', 'plc', 'inc', 'llc',
  'pty', 'co', 'company', 'trading', 'as', 't/a',
]);

// Invisible format characters (zero-width space, joiners, direction marks) are used to split words so
// filters miss them. They never belong in a name, domain or payment instruction.
const FORMAT_CHARS = /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g;
export const stripFormat = (s) => String(s || '').replace(FORMAT_CHARS, '');
export const hasFormatChars = (s) => /[\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/.test(String(s || ''));

// Cyrillic and Greek letters that look like Latin ones ("Маnchester" with a Cyrillic М and а).
const LOOKALIKE_LETTERS = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', һ: 'h', ԁ: 'd', ɡ: 'g', ո: 'n',
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y', І: 'I',
  α: 'a', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', Α: 'A', Β: 'B', Ε: 'E', Ι: 'I', Κ: 'K',
  Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Χ: 'X', Υ: 'Y',
};
export function foldLookalikes(s) {
  return String(s || '').replace(/[\u0370-\u03ff\u0400-\u04ff\u0500-\u052f\u0261]/g, (c) => LOOKALIKE_LETTERS[c] || c);
}
// True when one word mixes Latin letters with Cyrillic or Greek ones: real names do not do that.
export function hasMixedScript(s) {
  return String(s || '').split(/\s+/).some((w) => /[a-z]/i.test(w) && /[\u0370-\u03ff\u0400-\u052f]/.test(w));
}

export function normalizeName(name) {
  return stripFormat(name)
    .replace(/['\u2019\u2018`]/g, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function nameTokens(name) {
  return normalizeName(name).split(' ').filter((t) => t && !STOP_WORDS.has(t));
}

// Multi-part public suffixes that matter for education domains. This is a deliberately
// small list, not the full Public Suffix List; unknown suffixes fall back to last-two-labels.
const MULTI_PART_SUFFIXES = new Set([
  'ac.uk', 'co.uk', 'org.uk', 'gov.uk', 'sch.uk', 'ltd.uk', 'nhs.uk',
  'edu.au', 'com.au', 'org.au', 'net.au', 'gov.au',
  'edu.pk', 'com.pk', 'org.pk', 'gov.pk', 'net.pk',
  'ac.nz', 'co.nz', 'org.nz',
  'edu.cn', 'com.cn', 'ac.cn',
  'ac.in', 'edu.in', 'co.in',
  'edu.my', 'com.my', 'edu.sg', 'com.sg',
  'ac.ae', 'co.ae', 'edu.tr', 'com.tr', 'ac.jp', 'co.jp', 'ac.kr', 'co.kr',
  'edu.hk', 'com.hk', 'ac.za', 'co.za',
]);
// Australian state and sector namespaces: every school under vic.edu.au is a different owner, so the
// registrable domain is one label deeper (school.vic.edu.au, not vic.edu.au).
const THREE_PART_SUFFIXES = new Set([
  'vic.edu.au', 'nsw.edu.au', 'qld.edu.au', 'wa.edu.au', 'sa.edu.au', 'tas.edu.au', 'act.edu.au', 'nt.edu.au',
  'catholic.edu.au', 'vic.gov.au', 'nsw.gov.au', 'qld.gov.au', 'wa.gov.au', 'sa.gov.au', 'tas.gov.au', 'act.gov.au', 'nt.gov.au',
]);

// Endings used only by education institutions (or by many of them). Used to tell a university-style
// address from a commercial one, never as proof of who owns it.
export function isAcademicDomain(domain) {
  const labels = String(domain || '').split('.');
  const suffix = labels.slice(1).join('.');
  return suffix === 'edu' || /^(ac|edu)\.[a-z]{2}$/.test(suffix) || THREE_PART_SUFFIXES.has(suffix) && suffix.includes('.edu.');
}
export const domainSuffix = (domain) => String(domain || '').split('.').slice(1).join('.');

export function hostFromInput(input) {
  let s = stripFormat(input).trim();
  // "Admissions Office <admissions@monash.edu.au>" as Gmail and Outlook copy it.
  const angle = s.match(/<([^<>]+)>/);
  if (angle) s = angle[1];
  s = s.replace(/[\u3002\uff0e\uff61]/g, '.').toLowerCase()
    .replace(/^[\s"'(\[{<,;:]+|[\s"')\]}>,;:]+$/g, '');
  if (!s) return '';
  const at = s.lastIndexOf('@');
  if (at !== -1 && !s.includes('/')) s = s.slice(at + 1);
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.split(/[/?#]/)[0];
  s = s.replace(/^[^@]*@/, '');
  s = s.replace(/:\d+$/, '');
  s = s.replace(/\.$/, '');
  return s;
}

export function registrableDomain(host) {
  const h = hostFromInput(host).replace(/^www\d*\./, '');
  const labels = h.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  if (labels.length >= 4 && THREE_PART_SUFFIXES.has(labels.slice(-3).join('.'))) return labels.slice(-4).join('.');
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

export function domainLabel(domain) {
  // "monash.edu" -> "monash", "ox.ac.uk" -> "ox"
  return registrableDomain(domain).split('.')[0] || '';
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Characters commonly swapped in lookalike domains, folded to a canonical skeleton.
const CONFUSABLES = [
  [/rn/g, 'm'], [/vv/g, 'w'], [/0/g, 'o'], [/1/g, 'l'], [/i/g, 'l'], [/5/g, 's'], [/3/g, 'e'],
];

export function skeleton(label) {
  let s = String(label || '').toLowerCase().replace(/-/g, '');
  for (const [re, rep] of CONFUSABLES) s = s.replace(re, rep);
  return s;
}

// Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF, BOM).
export function parseCsv(text) {
  const src = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}
