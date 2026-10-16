// Searches the public-register snapshot. A match only ever means "this name appears on
// this official register as of this snapshot date". Never admission, never agent authority.
import { nameTokens, normalizeName, registrableDomain } from './normalize.js';

export function buildIndex(registry) {
  const records = registry.institutions.map((r, i) => {
    // "The University of Melbourne (UniMelb)": the bracketed short name is the institution's own, so it
    // ranks like the main name, and it no longer costs the main name a penalty for an "unrelated" word.
    const paren = r.n.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
    const main = paren ? [paren[1], paren[2]] : [r.n];
    const names = [...main.map((n) => ({ n, main: true })), ...(r.a || []).map((n) => ({ n, main: false }))];
    return {
      ...r,
      i,
      _names: names.map(({ n, main: isMain }) => ({ text: n, isMain, org: ORG.test(n), norm: normalizeName(n), tokens: new Set(nameTokens(n)) })),
      _domain: r.w ? registrableDomain(r.w) : '',
    };
  });
  const sources = Object.fromEntries(registry.sources.map((s) => [s.id, s]));
  return { records, sources, generatedAt: registry.generatedAt };
}

const ORG = /\b(university|college|institute|school|academy|polytechnic)\b/i;

const GENERIC = new Set(['university', 'college', 'international', 'embedded', 'institute', 'school', 'academy',
  'campus', 'centre', 'center', 'education', 'group', 'sydney', 'london']);

// Score one name of a record against the query; a record scores as its best-matching name.
// Aliases (embedded colleges, branch locations) never get the exact-match bonus, so a bare
// location alias like "Oxford" cannot outrank the University of Oxford itself.
function scoreName(name, q, qTokens, isMain) {
  const exact = isMain && name.norm === q;
  let hits = 0;
  for (const t of qTokens) {
    if (name.tokens.has(t)) hits += 1;
    else if (t.length >= 4 && [...name.tokens].some((rt) => rt.startsWith(t))) hits += 0.6;
  }
  if (!exact && hits === 0) return null;
  const coverage = hits / qTokens.length;
  if (!exact && coverage < 0.6) return null;
  // Fewer unrelated words ranks higher; generic words cost little because students rarely type them.
  const penalty = [...name.tokens].filter((t) => !qTokens.includes(t))
    .reduce((p, t) => p + (GENERIC.has(t) ? 0.5 : 3), 0);
  return (exact ? 100 : 0) + coverage * 60 + (name.norm.startsWith(q) ? 1 : 0)
    // A branch or brand alias that names an institution ("University of Greenwich" listed under a group)
    // costs little; a bare location alias ("Oxford") costs a lot, so it cannot outrank the real university.
    + (name.tokens.has('university') ? 2 : 0) + (isMain ? 0 : name.org ? -1 : -5) - penalty;
}

export function searchInstitutions(index, query, { limit = 10 } = {}) {
  const q = normalizeName(query);
  const qTokens = nameTokens(query);
  if (q.length < 2 || !qTokens.length) return [];
  const scored = [];
  for (const r of index.records) {
    let best = null;
    let matchedName = null;
    for (const name of r._names) {
      const sc = scoreName(name, q, qTokens, name.isMain);
      if (sc !== null && (best === null || sc > best)) { best = sc; matchedName = name.isMain ? null : name.text; }
    }
    // UK higher-education sponsors outrank private colleges with the same place name on a near tie.
    if (best !== null && /higher education/i.test(r.t || '')) best += 2;
    if (best !== null) scored.push({ record: r, score: best, exact: best >= 100, matchedName });
  }
  scored.sort((a, b) => b.score - a.score || a.record.n.localeCompare(b.record.n));
  return scored.slice(0, limit).map((s) => ({
    ...s,
    source: index.sources[s.record.s],
  }));
}

export function officialDomains(index) {
  const map = new Map();
  for (const r of index.records) {
    if (!r._domain) continue;
    if (!map.has(r._domain)) map.set(r._domain, []);
    map.get(r._domain).push(r);
  }
  return map;
}
