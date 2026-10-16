// UI glue. All user input stays in memory on this device; nothing is sent or stored except
// the language and selected tab (localStorage, best-effort).
import { makeT, STRINGS } from './i18n.js';
import { buildIndex, searchInstitutions, officialDomains } from './core/registry.js';
import { checkDomain } from './core/domain-check.js';
import { scanMessage } from './core/red-flags.js';
import { checkPayment, nameVariants } from './core/payment-check.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const prefs = {
  get(k, d) { try { return localStorage.getItem(`tp.${k}`) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`tp.${k}`, v); } catch { /* private mode */ } },
};

// Four app tabs (Home is the account, in portal/), and inside Check the four tools.
// Guide pages link straight to a tool (?tab=message&lang=ur) or a panel (?tab=help). Only known values are accepted.
const TOOLS = ['institution', 'contact', 'message', 'pay'];
// 'story' is the home page (the scrollytelling story); an address with ?tab= opens that panel instead.
const PANELS = ['story', 'check', 'news', 'help', 'about'];
const LEGACY = { learn: 'help' };
const params = new URLSearchParams(location.search);
const rawTab = LEGACY[params.get('tab')] || params.get('tab');
const linkTool = TOOLS.includes(rawTab) ? rawTab : null;
const linkPanel = linkTool ? 'check' : (PANELS.includes(rawTab) ? rawTab : null);
const linkLang = ['en', 'ur'].includes(params.get('lang')) ? params.get('lang') : null;
const savedTool = prefs.get('tab', 'institution');

const state = {
  lang: linkLang || prefs.get('lang', (navigator.language || '').startsWith('ur') ? 'ur' : 'en'),
  tab: linkTool || (TOOLS.includes(savedTool) ? savedTool : 'institution'),
  panel: linkPanel || 'story',
  index: null,
  domains: null,
  selected: null,
  rerender: {},
};
let t = makeT(state.lang);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c.nodeType ? c : document.createTextNode(String(c)));
  return node;
}

function fmtDate(iso) {
  if (!iso) return '?';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString(state.lang === 'ur' ? 'ur-PK' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
}

function applyLanguage() {
  t = makeT(state.lang);
  document.documentElement.lang = state.lang;
  document.documentElement.dir = STRINGS[state.lang].dir;
  for (const n of $$('[data-i18n]')) n.textContent = t(n.dataset.i18n);
  for (const n of $$('[data-i18n-placeholder]')) n.placeholder = t(n.dataset.i18nPlaceholder);
  for (const n of $$('[data-i18n-aria-label]')) n.setAttribute('aria-label', t(n.dataset.i18nAriaLabel));
  for (const n of $$('[data-lang]')) n.hidden = n.dataset.lang !== state.lang;
  for (const n of $$('.ur-draft')) n.hidden = state.lang !== 'ur';
  renderFooter();
  renderStale();
  renderSelected();
  for (const fn of Object.values(state.rerender)) fn();
  if (state.panel === 'news' && newsLoaded) loadNews(true);
}

function showTab(name) {
  state.tab = name;
  prefs.set('tab', name);
  for (const b of $$('[data-tab]')) {
    const on = b.dataset.tab === name;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  for (const p of $$('[role=tabpanel]')) p.hidden = p.id !== `tab-${name}`;
  if (state.panel !== 'check') showPanel('check');
}

// The four app tabs: filled, bold and marked aria-current="page" when chosen (C.0 rule 3).
function showPanel(name, { focus = false, push = false } = {}) {
  state.panel = name;
  for (const p of $$('[data-panel]')) p.hidden = p.dataset.panel !== name;
  for (const a of $$('[data-nav]')) {
    if (a.dataset.nav === name || (name === 'about' && a.dataset.nav === 'help')) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (push) {
    const u = new URL(location.href);
    u.searchParams.set('tab', name);
    history.pushState({ panel: name }, '', u);
  }
  if (name === 'news') loadNews();
  if (name === 'story') loadStory();
  if (focus) ($(`[data-panel="${name}"] h1`) || $('#main')).focus({ preventScroll: false });
}

// The story's moving parts are a separate module too: the story itself is plain HTML and reads without it.
let story = null;
let storyLoading = false;
async function loadStory() {
  if (story || storyLoading) return;
  storyLoading = true;
  try {
    const { mountStory } = await import('./ui/story.js');
    story = mountStory($('#panel-story'), { getT: () => t, getLang: () => state.lang });
  } catch { /* the story still reads as plain sections */ }
  storyLoading = false;
}

// News is a separate module, loaded only when the tab opens, so the checks keep working offline without it.
let newsLoaded = false;
async function loadNews(force = false) {
  if (newsLoaded && !force) return;
  newsLoaded = true;
  const out = $('#news-out');
  try {
    const { renderNews } = await import('./ui/news.js');
    await renderNews(out, { lang: state.lang, base: '' });
  } catch {
    newsLoaded = false;
    out.replaceChildren(el('div', { class: 'empty' }, el('h2', {}, t('news.offlineH')), el('p', {}, t('news.offline'))));
  }
}

function tOr(key, fallback) {
  const v = t(key);
  return v === key ? fallback : v;
}

function levelBox(level, title, items, extra = []) {
  const cls = { danger: 'danger', caution: 'caution', ok: 'ok', unknown: 'unknown' }[level] || 'unknown';
  // Status icon so the level is never colour alone (lesson V3). Decorative: the level text says it.
  // Shapes: danger octagon "!", caution triangle "!", ok magnifier ("we looked, nothing obvious",
  // deliberately not a tick), unknown circle "?". Same shapes as the CSS masks in styles.css.
  const SHAPES = {
    danger: [['path', { d: 'M8.2 2.8h7.6l5.4 5.4v7.6l-5.4 5.4H8.2l-5.4-5.4V8.2z' }], ['path', { d: 'M12 7.5v5.5' }], ['circle', { cx: 12, cy: 16.6, r: 0.6, fill: 'currentColor' }]],
    caution: [['path', { d: 'M10.3 3.6 2.4 17.4a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z' }], ['path', { d: 'M12 9v4.5' }], ['circle', { cx: 12, cy: 17, r: 0.6, fill: 'currentColor' }]],
    ok: [['circle', { cx: 10.5, cy: 10.5, r: 6.5 }], ['path', { d: 'm15.3 15.3 5.2 5.2' }]],
    unknown: [['circle', { cx: 12, cy: 12, r: 9.2 }], ['path', { d: 'M9.4 9.3a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.4-2.6 4' }], ['circle', { cx: 12, cy: 17.3, r: 0.6, fill: 'currentColor' }]],
  };
  const NS = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ class: 'level-icon', viewBox: '0 0 24 24', width: 22, height: 22, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) icon.setAttribute(k, String(v));
  for (const [tag, attrs] of SHAPES[cls]) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    icon.append(node);
  }
  return el('div', { class: `result ${cls}`, role: 'status' },
    el('p', { class: 'level' }, icon, el('span', {}, t(`level.${cls}`))),
    title ? el('p', { class: 'headline' }, title) : null,
    items.length ? el('ul', { class: 'flags' }, items) : null,
    extra);
}

function flagItem(f) {
  const vars = { ...f };
  return el('li', { class: `sev-${f.severity}` }, t(`flag.${f.msg || f.id}`, vars),
    f.excerpt ? el('q', { class: 'excerpt' }, f.excerpt) : null);
}

// Every danger result also says where to go if it already happened, and the help lines (audit gap G8).
function dangerHelp() {
  const guide = `${state.lang === 'ur' ? 'ur/' : ''}guides/already-paid-what-to-do/`;
  return el('div', { class: 'safe danger-help' },
    el('p', {}, el('strong', {}, t('res.alreadyH')), ' ', el('a', { href: guide }, t('tribute.nextLink'))),
    el('p', {}, t('res.lines'), ' ', el('a', { href: '?tab=help', onclick: (e) => { e.preventDefault(); showPanel('help', { focus: true, push: true }); } }, t('res.linesLink'))));
}

function safeSteps() {
  const frag = $('#safe-steps').content.cloneNode(true);
  for (const n of $$('[data-i18n]', frag)) n.textContent = t(n.dataset.i18n);
  return frag;
}

// ---------- institution search ----------
function renderInstitutionResults() {
  const q = $('#inst-q').value;
  const list = $('#inst-results');
  const status = $('#inst-status');
  list.replaceChildren();
  if (!state.index) { status.textContent = t('loading'); return; }
  status.textContent = '';
  if (q.trim().length < 2) return;
  const results = searchInstitutions(state.index, q, { limit: 8 });
  if (!results.length) {
    list.append(el('li', { class: 'result unknown' }, el('p', { class: 'headline' }, t('inst.none')), el('p', {}, t('inst.noneExplain'))));
    $('details.other').open = true;
    return;
  }
  for (const { record: r, source: s } of results) {
    const probationary = /probation/i.test(r.st || '');
    list.append(el('li', { class: 'card' },
      el('h2', {}, r.n),
      el('p', { class: 'meta' }, [r.c, r.t, r.id ? `CRICOS ${r.id}` : null].filter(Boolean).join(' · ')),
      el('p', { class: 'badge' }, t('inst.listedOn', { source: s.name })),
      r.a?.length ? el('p', { class: 'meta' }, t('inst.alsoListed', { names: r.a.join(' / ') })) : null,
      r.st ? el('p', {}, t('inst.status', { status: r.st })) : null,
      r.r?.length ? el('p', {}, t('inst.routes', { routes: r.r.join(', ') })) : null,
      probationary ? el('p', { class: 'warn' }, t('inst.probationary')) : null,
      r.ic ? el('p', { class: 'warn' }, /action plan/i.test(r.ic) ? t('inst.actionPlan') : t('inst.compliance', { note: r.ic })) : null,
      r.w ? el('p', {}, t('inst.website', { domain: r.w })) : null,
      el('details', {},
        el('summary', {}, `${t('inst.means')} / ${t('inst.notMeans')}`),
        // Translated copy when it exists; the register's own English wording otherwise (review C-5).
        el('p', {}, el('strong', {}, `${t('inst.means')}: `), tOr(`register.${s.id}.meaning`, s.meaning)),
        el('p', {}, el('strong', {}, `${t('inst.notMeans')}: `), tOr(`register.${s.id}.notMeaning`, s.notMeaning))),
      el('p', { class: 'muted small' }, t(s.dateKind === 'uploaded' ? 'inst.snapshotUploaded' : 'inst.snapshot', { published: fmtDate(s.publishedAt), fetched: fmtDate(s.fetchedAt) }), ' ',
        el('a', { href: s.pageUrl, target: '_blank', rel: 'noopener noreferrer' }, t('inst.sourceLink'))),
      el('button', { type: 'button', class: 'secondary', onclick: () => selectInstitution(r) }, t('inst.useForChecks'))));
  }
}

function selectInstitution(r) {
  state.selected = r;
  $('#pay-inst').value = r.n;
  const country = { ukvi: 'GB', cricos: 'AU' }[r.s];
  if (country) $('#pay-country').value = country;
  renderSelected();
  showTab('contact');
  $('#contact-q').focus();
}

function renderSelected() {
  const n = $('#contact-inst');
  n.textContent = state.selected ? t('contact.forInst', { name: state.selected.n }) : t('contact.noInst');
  $('#clear-inst').hidden = !state.selected;
}

function clearInstitution() {
  if (state.selected && $('#pay-inst').value === state.selected.n) {
    $('#pay-inst').value = '';
    $('#pay-country').value = '';
  }
  state.selected = null;
  renderSelected();
  renderContact();
  $('#contact-q').focus();
}

// ---------- email / link ----------
function renderContact() {
  const out = $('#contact-result');
  const input = $('#contact-q').value.trim();
  if (!input) { out.replaceChildren(); return; }
  if (!state.domains) { out.replaceChildren(el('p', {}, t('loading'))); return; }
  const r = checkDomain(input, { officialDomains: state.domains, claimedInstitution: state.selected });
  let box;
  if (r.level === 'invalid') box = levelBox('unknown', t('contact.invalid'), []);
  else if (r.level === 'match') box = levelBox('ok', t('contact.match', { name: state.selected.n }), r.flags.map(flagItem), el('p', {}, t('contact.matchCaveat')));
  else if (r.level === 'listed') box = levelBox('ok', t('contact.listed', { names: r.matches.slice(0, 3).map((m) => m.n).join('; ') }), [], el('p', {}, t('contact.matchCaveat')));
  else if (r.level === 'unknown') box = levelBox('unknown', t('contact.unknown'), [], el('p', {}, t('contact.unknownExplain')));
  else box = levelBox(r.level, r.domain, r.flags.map(flagItem));
  out.replaceChildren(box, safeSteps());
}

// ---------- message ----------
function renderMessage() {
  const out = $('#msg-result');
  const text = $('#msg-q').value;
  if (!text.trim()) { out.replaceChildren(); return; }
  const r = scanMessage(text);
  const box = r.level === 'none_found'
    ? levelBox('unknown', t('msg.none'), [], el('p', {}, t('msg.noneExplain')))
    : levelBox(r.level, null, r.flags.map(flagItem));
  // Threats, extortion and money-mule offers need people, not only a warning list.
  const help = r.needsHelp
    ? el('p', { class: 'warn' }, t('msg.needsHelp'), ' ', el('a', { href: '?tab=help', onclick: (e) => { e.preventDefault(); showPanel('help', { focus: true, push: true }); } }, t('msg.needsHelpLink')))
    : null;
  out.replaceChildren(...[help, box, r.level === 'danger' ? dangerHelp() : null, safeSteps()].filter(Boolean));
}

// ---------- payment ----------
let paymentChecked = false;
function renderPayment(scroll = false) {
  if (!paymentChecked) return;
  const out = $('#pay-result');
  const form = $('#pay-form');
  // When the student picked the institution in search, its other register names (brands, short names, the
  // name with its city) also count as its own name, so "RMIT University" or "UNSW Sydney" match (review R-1).
  const sel = state.selected && $('#pay-inst').value === state.selected.n ? state.selected : null;
  const city = (sel?.c || '').split(',')[0].trim();
  const aliases = sel ? [...(sel.a || []), ...nameVariants(sel.n).map((n) => (city ? `${n} ${city}` : n))] : [];
  const r = checkPayment({
    institutionName: $('#pay-inst').value,
    institutionAliases: aliases,
    institutionCountry: $('#pay-country').value,
    payeeName: $('#pay-payee').value,
    officialPayeeName: $('#pay-official').value,
    iban: $('#pay-iban').value,
    instructionSource: form.elements.source.value,
    method: form.elements.method.value,
    payingAgent: $('#pay-agent').checked,
    pressure: $('#pay-pressure').checked,
    largeAmount: $('#pay-large').checked,
    paidBefore: $('#pay-paid-before').checked,
    newFeeAfterPaying: $('#pay-new-fee').checked,
    receiptNotFromUniversity: $('#pay-receipt-other').checked,
  });
  const extra = [];
  if (r.ibanCheck?.valid) extra.push(el('p', {}, t('pay.ibanValid', { country: r.ibanCheck.country })));
  const box = r.level === 'no_obvious_issue'
    ? levelBox('ok', t('pay.noIssue'), [], [...extra, el('p', {}, t('pay.noIssueExplain'))])
    : levelBox(r.level, null, r.flags.map(flagItem), extra);
  out.replaceChildren(...[box, r.level === 'danger' || r.escalate ? dangerHelp() : null, safeSteps()].filter(Boolean));
  if (scroll) out.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

const STALE_DAYS = 21;
function renderStale() {
  const n = $('#data-stale');
  n.hidden = !state.dataStale;
  if (state.dataStale) n.textContent = t('data.stale', { date: fmtDate(state.index.generatedAt) });
}

function renderFooter() {
  const n = $('#foot-data');
  if (!state.index) { n.textContent = ''; return; }
  const names = Object.values(state.index.sources).map((s) => s.name.split(': ')[0]).join(', ');
  n.textContent = t('footer.data', { sources: names, date: fmtDate(state.index.generatedAt) });
}

async function loadRegistry() {
  try {
    const res = await fetch('data/registry.json');
    if (!res.ok) throw new Error(String(res.status));
    state.index = buildIndex(await res.json());
    state.domains = officialDomains(state.index);
    // Offline or old data must say so: a sponsor can lose its licence between editions (review B-18).
    const ageDays = (Date.now() - Date.parse(state.index.generatedAt)) / 86400000;
    state.dataStale = res.headers.get('X-TP-From-Cache') === '1' || ageDays > STALE_DAYS;
    renderStale();
    renderFooter();
    renderInstitutionResults();
    renderContact();
  } catch {
    $('#inst-status').textContent = t('loadError');
  }
}

function init() {
  for (const b of $$('[data-tab]')) {
    b.id = `tabbtn-${b.dataset.tab}`;
    b.setAttribute('aria-controls', `tab-${b.dataset.tab}`);
    $(`#tab-${b.dataset.tab}`)?.setAttribute('aria-labelledby', b.id);
    b.addEventListener('click', () => showTab(b.dataset.tab));
  }
  for (const a of $$('[data-nav]:not([data-nav="home"]), [data-goto]')) {
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      showPanel(a.dataset.nav || a.dataset.goto, { focus: true, push: true });
    });
  }
  // Links straight to one check (the story's buttons): open Check on that tool, one tap.
  for (const a of $$('[data-tool]')) {
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || !TOOLS.includes(a.dataset.tool)) return;
      e.preventDefault();
      showTab(a.dataset.tool);
      showPanel('check', { focus: true });
      const u = new URL(location.href);
      u.searchParams.set('tab', a.dataset.tool);
      u.hash = '';
      history.pushState({ panel: 'check' }, '', u);
    });
  }
  window.addEventListener('popstate', () => {
    const raw = new URLSearchParams(location.search).get('tab');
    const p = LEGACY[raw] || raw;
    if (TOOLS.includes(p)) showTab(p);
    else showPanel(PANELS.includes(p) ? p : 'story');
  });
  $('.seg[role=tablist]').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const tabs = $$('[data-tab]');
    const i = tabs.findIndex((b) => b.dataset.tab === state.tab);
    const step = (e.key === 'ArrowRight') === (document.dir !== 'rtl') ? 1 : -1;
    const next = e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs.at(-1) : tabs[(i + step + tabs.length) % tabs.length];
    showTab(next.dataset.tab);
    next.focus();
  });
  $('#clear-inst').addEventListener('click', clearInstitution);
  $('#lang').addEventListener('click', () => {
    state.lang = state.lang === 'en' ? 'ur' : 'en';
    prefs.set('lang', state.lang);
    applyLanguage();
  });

  let timer;
  $('#inst-q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(renderInstitutionResults, 150); });
  $('#inst-form').addEventListener('submit', (e) => { e.preventDefault(); renderInstitutionResults(); });
  $('#contact-form').addEventListener('submit', (e) => { e.preventDefault(); renderContact(); });
  $('#msg-form').addEventListener('submit', (e) => { e.preventDefault(); renderMessage(); });
  $('#msg-clear').addEventListener('click', () => { $('#msg-q').value = ''; renderMessage(); });
  $('#pay-form').addEventListener('submit', (e) => { e.preventDefault(); paymentChecked = true; renderPayment(true); });

  state.rerender = { inst: renderInstitutionResults, contact: renderContact, msg: renderMessage, pay: () => renderPayment(), story: () => story?.relabel() };
  if (!$(`#tab-${state.tab}`)) state.tab = 'institution';
  const wanted = state.panel;
  showTab(state.tab);
  showPanel(wanted);
  // boot.js held the first paint on the right panel; from here the hidden attributes decide.
  delete document.documentElement.dataset.boot;
  applyLanguage();
  loadRegistry();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  import('./ui/update.js').then((m) => m.watchUpdates({ text: t('update.ready'), button: t('update.now') })).catch(() => {});
}

init();
