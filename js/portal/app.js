// TaleemParakh student app, signed-in part (addendum C.0 to C.1, R10.5). One page, hash routes, textContent only.
// The database decides everything; this file only shows what the database returns and asks for permission.
// Screen ids follow C.1.2 (S0 to S10). Every screen has loading, empty, error and offline states (C.0 rule 6).
import { auth, rpc, view, sha256Hex, ApiError, ENV_LABEL } from '../lib/api.js';
import { CONFIG } from '../lib/config.js';
import { S } from './strings.js';
import { CLAIM_LABELS, CLAIM_DETAIL_FIELDS, OFFERED_CLAIMS, statusLabel } from '../core/claims.js';
import { explainClaim } from '../core/explain.js';
import { STRINGS as PUBLIC } from '../i18n.js';
import { icon } from '../ui/icons.js';
import { watchUpdates } from '../ui/update.js';
import { myRequests, requestTimeline, pipelineOf, startIdentityCheck, confirmIdentityCheck, askSecondLook } from '../ui/student-data.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const state = { lang: pref('lang', 'en'), email: '', codeSentAt: 0 };
let wiz = null;

function pref(k, d) { try { return localStorage.getItem(`tp.${k}`) || d; } catch { return d; } }
function setPref(k, v) { try { localStorage.setItem(`tp.${k}`, v); } catch { /* private mode */ } }
function t(key, vars = {}) {
  const get = (lang) => key.split('.').reduce((v, p) => v?.[p], S[lang]);
  const v = get(state.lang) ?? get('en') ?? key;
  return typeof v === 'string' ? v.replace(/\{(\w+)\}/g, (_, n) => (vars[n] ?? '')) : v;
}
function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'class') n.className = v;
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  return n;
}
const ltr = (s) => el('bdi', { dir: 'ltr', class: 'ltr' }, s || '');
const fmtDate = (iso) => {
  if (!iso) return '';
  try { return new Intl.DateTimeFormat(state.lang === 'ur' ? 'ur-PK' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso)); } catch { return String(iso); }
};
const claimName = (c) => CLAIM_LABELS[c]?.[state.lang] || CLAIM_LABELS[c]?.en || c;
const go = (hash) => { location.hash = hash; };
const main = () => $('#main');
function render(...nodes) { main().replaceChildren(...nodes.flat().filter((n) => n !== null && n !== undefined && n !== false)); main().focus({ preventScroll: true }); window.scrollTo(0, 0); }
function head(title, lead, eyebrow) {
  return el('div', { class: 'page-head' }, eyebrow ? el('p', { class: 'eyebrow' }, eyebrow) : null, el('h1', {}, title), lead ? el('p', { class: 'lead' }, lead) : null);
}
function busy(btn, on) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = t('saving'); }
  else if (btn.dataset.label) btn.textContent = btn.dataset.label;
  btn.disabled = on; btn.setAttribute('aria-busy', on ? 'true' : 'false');
}
const submitter = (e) => e.submitter || e.target.querySelector('button.primary');
function errText(e) {
  if (navigator.onLine === false) return t('err.offline');
  const code = e instanceof ApiError ? e.code : 'unexpected';
  const v = t(`err.${code}`);
  return typeof v === 'string' && v !== `err.${code}` ? v : t('err.unexpected');
}
function errorBox(e, retry = route) {
  return el('div', { class: 'result danger state-error', role: 'alert' }, icon('danger'), el('div', {}, el('p', { class: 'headline' }, errText(e)),
    retry ? el('button', { type: 'button', onclick: () => retry() }, t('tryAgain')) : null));
}
const loading = () => el('p', { class: 'skeleton', role: 'status' }, t('loading'));
const btn = (label, attrs = {}, ic) => el('button', { type: 'button', ...attrs }, ic ? icon(ic) : null, label);
const linkBtn = (label, href, cls = 'btn', ic) => el('a', { class: cls, href }, ic ? icon(ic) : null, label);

function helplines() {
  const P = PUBLIC[state.lang] || PUBLIC.en;
  const rows = [['help.emergency', 'phone', true], ['help.mental', 'heart'], ['help.cyber', 'shield'], ['help.sim', 'phone'], ['help.bank', 'money'], ['help.abroad', 'globe'], ['help.rights', 'scales']];
  return el('section', { class: 'helpbox', 'aria-labelledby': 'lines-h' }, el('h2', { id: 'lines-h' }, icon('phone'), t('helplines')),
    el('ul', { class: 'lines' }, rows.filter(([k]) => P[k]).map(([k, ic, urgent]) => el('li', { class: urgent ? 'urgent' : null }, icon(ic), el('span', {}, P[k])))));
}
function offlineScreen() {
  render(head(t('offlineH')), el('div', { class: 'notice' }, icon('offline'), el('p', {}, t('offline'))), helplines());
}

// ---------------- chips and status classes (word + icon + colour) ----------------
function statusClass(status, replyReceived) {
  const l = statusLabel(status, { replyReceived, lang: state.lang });
  if (l.key === 'INSTITUTION_CONFIRMED') return 'confirmed';
  if (l.resultClass === 'danger') return 'danger';
  if (l.resultClass === 'caution') return 'caution';
  if (l.resultClass === 'callout-info') return 'info';
  if (l.key === 'PENDING' || l.key === 'PENDING_REPLY_RECEIVED') return 'wait';
  return 'unknown';
}
const CHIP_ICON = { confirmed: 'tick', danger: 'danger', caution: 'warn', info: 'info', wait: 'clock', unknown: 'question', plain: 'clock' };
function chip(cls, text) { return el('span', { class: `chip ${cls === 'confirmed' ? 'ok' : cls}` }, icon(CHIP_ICON[cls] || 'question', { size: 16 }), text); }
function statusChip(status, replyReceived) {
  const key = statusLabel(status, { replyReceived, lang: state.lang }).key;
  return chip(statusClass(status, replyReceived), t(`chip.${key}`));
}

// ---------------- shell ----------------
function applyLang(page) {
  document.documentElement.lang = state.lang;
  document.documentElement.dir = S[state.lang].dir;
  document.title = t('title');
  $('#lang').textContent = t('toggle');
  $('#env-banner').textContent = CONFIG.backendOn ? t('env', { env: ENV_LABEL }) : '';
  $('#env-banner').hidden = !CONFIG.backendOn;
  $('#tabbar').setAttribute('aria-label', t('nav.main'));
  $('.foot a').textContent = t('footHome');
  $('.foot a').href = state.lang === 'ur' ? '../?lang=ur' : '../';
  $('.skip').textContent = t('skip');
  const current = page === 'help' ? 'help' : 'home';
  for (const a of $$('[data-nav]')) {
    const k = a.dataset.nav;
    a.querySelector('span').textContent = t(`nav.${k}`);
    if (k === 'check' || k === 'news') a.href = `../?tab=${k}${state.lang === 'ur' ? '&lang=ur' : ''}`;
    if (k === current) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  const signed = CONFIG.backendOn && auth.signedIn();
  const menu = $('#acct');
  menu.hidden = !signed;
  menu.open = false;
  $('#acct-label').textContent = t('menu.open');
  $('#acct-list').replaceChildren(...(signed ? [
    el('a', { href: '#/account' }, icon('user'), t('menu.account')),
    el('a', { href: `../${state.lang === 'ur' ? 'ur/' : ''}guides/save-to-home-screen/` }, icon('install'), t('menu.install')),
    el('button', { type: 'button', onclick: async () => { await auth.signOut(); wiz = null; go('#/'); } }, icon('signout'), t('menu.signout')),
  ] : []));
}

// ---------------- S0 and S1: sign in with an email code ----------------
function signIn() {
  const email = el('input', { type: 'email', id: 'email', autocomplete: 'email', required: true, maxlength: 200, inputmode: 'email', dir: 'ltr', 'aria-describedby': 'email-hint' });
  if (state.email) email.value = state.email;
  const out = el('div', { 'aria-live': 'polite' });
  const form = el('form', { class: 'card', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    const v = email.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { email.setAttribute('aria-invalid', 'true'); out.replaceChildren(el('p', { class: 'field-error' }, t('fieldEmail'))); email.focus(); return; }
    const b = submitter(e); busy(b, true);
    try { state.email = v; await auth.sendCode(v); state.codeSentAt = Date.now(); go('#/code'); }
    catch (err) { out.replaceChildren(errorBox(err, null)); } finally { busy(b, false); }
  } },
    el('div', { class: 'field' }, el('label', { for: 'email' }, t('email')), el('p', { class: 'hint', id: 'email-hint' }, t('emailHint')), email),
    out, el('button', { class: 'primary wide' }, t('sendCode')));
  render(head(t('signinH'), t('signinIntro')), form,
    el('details', { class: 'other' }, el('summary', {}, t('whatIsThis')), el('p', {}, t('whatIsThisText')), el('p', {}, el('a', { href: '#/privacy' }, t('privacyLink')))),
    el('p', { class: 'small muted' }, t('neverAsk')));
}

function codeScreen() {
  if (!state.email) { go('#/'); return; }
  const code = el('input', { type: 'text', id: 'code', class: 'code-input', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9]{6}', maxlength: 6, required: true });
  const out = el('div', { 'aria-live': 'polite' });
  const wait = el('p', { class: 'small muted', 'aria-live': 'polite' });
  const resend = btn(t('newCode'), { class: 'quiet', onclick: async () => {
    try { await auth.sendCode(state.email); state.codeSentAt = Date.now(); out.replaceChildren(el('p', { class: 'small' }, t('codeResent'))); tick(); } catch (err) { out.replaceChildren(errorBox(err, null)); }
  } });
  function tick() {
    const left = Math.max(0, 60 - Math.floor((Date.now() - state.codeSentAt) / 1000));
    resend.disabled = left > 0; wait.textContent = left > 0 ? t('newCodeWait', { s: left }) : '';
    if (left > 0 && document.body.contains(resend)) setTimeout(tick, 1000);
  }
  const form = el('form', { class: 'card', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.value.trim())) { code.setAttribute('aria-invalid', 'true'); out.replaceChildren(el('p', { class: 'field-error' }, t('err.code_invalid'))); return; }
    const b = submitter(e); busy(b, true);
    try { await auth.verifyCode(state.email, code.value.trim()); await afterSignIn(); } catch (err) { out.replaceChildren(errorBox(err, null)); } finally { busy(b, false); }
  } }, el('div', { class: 'field' }, el('label', { for: 'code' }, t('code')), code), out, el('button', { class: 'primary wide' }, t('verify')));
  render(head(t('codeH'), null), codeIntroLine(), form,
    el('div', { class: 'row' }, resend, linkBtn(t('changeEmail'), '#/', 'btn quiet')), wait);
  tick(); code.focus();
}
function codeIntroLine() {
  const [before, after] = t('codeIntro', { email: '\u0000' }).split('\u0000');
  return el('p', { class: 'lead' }, before, ltr(state.email), after);
}

async function afterSignIn() {
  const rows = await view('students', 'select=id,declared_under_18,preferred_language').catch(() => []);
  go(rows?.[0] ? '#/home' : '#/welcome');
}

// ---------------- S2 welcome ----------------
function welcome() {
  const name = el('input', { type: 'text', id: 'name', maxlength: 80, autocomplete: 'given-name' });
  const lang = el('select', { id: 'pref-lang' }, el('option', { value: 'en' }, 'English'), el('option', { value: 'ur' }, 'اردو'));
  lang.value = state.lang;
  const radio = (v) => el('label', { class: 'tick-card' }, el('input', { type: 'radio', name: 'adult', value: v, required: true }), el('span', {}, el('b', {}, t(v))));
  const out = el('div', { 'aria-live': 'polite' });
  const form = el('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    if (!form.elements.adult.value) { out.replaceChildren(el('p', { class: 'field-error' }, t('fieldRequired'))); return; }
    const b = submitter(e); busy(b, true);
    const under18 = form.elements.adult.value === 'no';
    try {
      await rpc('register_student', { p_display_name: name.value, p_language: lang.value, p_declared_under_18: under18 });
      state.lang = lang.value; setPref('lang', state.lang); applyLang();
      if (under18) render(head(t('welcomeH')), el('div', { class: 'result caution' }, el('p', {}, t('minorNote'))), el('div', { class: 'actions' }, linkBtn(t('helpSend'), '#/help', 'btn primary')));
      else go('#/home');
    } catch (err) { out.replaceChildren(errorBox(err, null)); } finally { busy(b, false); }
  } },
    el('div', { class: 'field' }, el('label', { for: 'name' }, t('name')), name),
    el('div', { class: 'field' }, el('label', { for: 'pref-lang' }, t('language')), lang),
    el('fieldset', {}, el('legend', {}, t('over18')), el('div', { class: 'tick-cards' }, radio('yes'), radio('no'))),
    out, el('div', { class: 'actions' }, el('button', { class: 'primary' }, t('continue'))));
  render(head(t('welcomeH'), t('welcomeIntro')), form);
}

// ---------------- S3 home: my requests ----------------
function stepChip(r) {
  if (r.stopped) return chip('caution', t('chip.stopped'));
  if (r.step === 7 || r.step_key === 'result') return statusChip(r.status);
  if (r.step === 1) return chip('caution', t('chip.BLOCK_EXTERNAL_VERIFICATION'));
  if (r.step === 5) return chip('wait', t('chip.PENDING'));
  if (r.step === 6) return chip('wait', t('chip.PENDING_REPLY_RECEIVED'));
  return chip('plain', t('chip.preparing'));
}
async function home() {
  render(head(t('homeH'), t('homeIntro')), loading());
  let rows;
  try { rows = await myRequests(); } catch (err) { render(head(t('homeH')), errorBox(err)); return; }
  const start = el('div', { class: 'actions' }, linkBtn(t('newCase'), '#/new/0', 'btn primary', 'plus'));
  if (!rows.length) {
    render(head(t('homeH')), el('div', { class: 'empty' }, icon('inbox', { size: 40 }), el('h2', {}, t('emptyH')), el('p', {}, t('empty')), start));
    return;
  }
  const keys = ['consent', 'details', 'review', 'sent', 'waiting', 'checking', 'result'];
  const card = (r) => {
    const n = Number(r.step) || null;
    return el('li', {}, el('a', { class: 'card card-link req', href: `#/request/${encodeURIComponent(r.case_id)}` },
      el('p', { class: 'eyebrow' }, ltr(r.case_ref), ' · ', t('openedOn', { date: fmtDate(r.opened_at) })),
      el('h2', {}, r.institution),
      r.claims?.length ? el('p', { class: 'what' }, r.claims.map(claimName).join(', ')) : null,
      n ? el('ol', { class: 'mini-steps', 'aria-hidden': 'true' }, keys.map((k, i) => el('li', { class: i + 1 < n || n === 7 ? 'done' : i + 1 === n ? 'now' : null }))) : null,
      n ? el('p', { class: 'step-line' }, icon(r.stopped ? 'stop' : n === 7 ? 'flag' : 'clock', { size: 18 }), r.stopped ? t(`stopped.title`) : t('stepOf', { n, label: t(`steps.${keys[n - 1]}`) })) : null,
      el('div', { class: 'req-foot' }, stepChip(r), el('span', { class: 'btn quiet', 'aria-hidden': 'true' }, t('open'), icon('chevron', { size: 18 })))));
  };
  render(head(t('homeH'), t('homeIntro')), start, el('ul', { class: 'cards' }, rows.map(card)));
}

// ---------------- S4 the wizard: one question per screen ----------------
function wizSteps() {
  const withFields = (wiz?.claims || []).filter((c) => (CLAIM_DETAIL_FIELDS[c] || []).length);
  return ['inst', 'claims', ...withFields.map((c) => `d:${c}`), 'email', 'pressure', 'review'];
}
function validateField(f, v) {
  if (v.length > 200) return t('fieldLong', { n: 200 });
  if (f === 'account_last4' && v && !/^\d{4}$/.test(v)) return t('fieldDigits');
  return '';
}
function fieldBox(id, label, input, hint) {
  return el('div', { class: 'field' }, el('label', { for: id }, label), hint ? el('p', { class: 'hint', id: `${id}-hint` }, hint) : null, input, el('p', { class: 'field-error', id: `${id}-err`, hidden: true }));
}
function showErr(input, msg) {
  const box = $(`#${input.id}-err`);
  input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  if (msg) input.setAttribute('aria-describedby', `${input.id}-err`); else input.removeAttribute('aria-describedby');
  if (box) { box.hidden = !msg; box.textContent = msg; }
  return !msg;
}

let institutions = null;
async function wizard(index) {
  if (!wiz) wiz = { inst: null, claims: [], details: {}, name: '', appEmail: auth.email(), proven: false, payingSoon: null, pressured: null };
  const steps = wizSteps();
  let i = Number.parseInt(index, 10);
  if (!Number.isInteger(i) || i < 0 || i >= steps.length) i = 0;
  if (i > 0 && !wiz.inst) { go('#/new/0'); return; }
  if (i > 1 && !wiz.claims.length) { go('#/new/1'); return; }
  const step = steps[i];
  const total = steps.length;
  const out = el('div', { 'aria-live': 'polite' });
  const top = el('div', {}, el('div', { class: 'wizard-top' }, el('p', { class: 'eyebrow' }, t('qOf', { n: i + 1, total })), linkBtn(t('saveLeave'), '#/home', 'btn quiet')),
    el('progress', { class: 'steps-bar', max: total, value: i + 1, 'aria-hidden': 'true' }));
  const nav = (nextLabel = t('next')) => el('div', { class: 'actions' }, el('button', { class: 'primary' }, nextLabel, icon('arrow', { size: 20 })),
    i > 0 ? linkBtn(t('back'), `#/new/${i - 1}`, 'btn quiet', 'back') : null);
  const next = () => go(`#/new/${i + 1}`);
  const form = (body, onNext, label) => el('form', { class: 'wizard', novalidate: true, onsubmit: async (e) => { e.preventDefault(); if (await onNext(e)) next(); } }, body, out, nav(label));

  if (step === 'inst') {
    render(top, el('h1', {}, t('q1')), loading());
    try {
      if (!institutions) {
        const [insts, contacts] = await Promise.all([view('v_institutions', 'select=id,canonical_name,country,is_synthetic&order=canonical_name'), view('v_approved_contacts', 'select=institution_id')]);
        const ok = new Set(contacts.map((c) => c.institution_id));
        institutions = insts.filter((x) => ok.has(x.id));
      }
    } catch (err) { render(top, el('h1', {}, t('q1')), errorBox(err)); return; }
    const q = el('input', { type: 'search', id: 'uni-q', autocomplete: 'off', maxlength: 120, 'aria-describedby': 'uni-q-hint', 'aria-controls': 'uni-list' });
    const list = el('ul', { class: 'pick-list', id: 'uni-list' });
    const draw = () => {
      const needle = q.value.trim().toLowerCase();
      const shown = institutions.filter((x) => !needle || x.canonical_name.toLowerCase().includes(needle)).slice(0, 30);
      list.replaceChildren(...(shown.length ? shown.map((x) => el('li', {}, el('button', { type: 'button', 'aria-pressed': String(wiz.inst?.id === x.id), onclick: () => { wiz.inst = x; draw(); out.replaceChildren(); list.querySelector('[aria-pressed="true"]')?.focus(); } },
        icon('building'), el('span', {}, x.canonical_name, ' ', el('span', { class: 'muted small' }, `(${x.country})`))))) : [el('li', { class: 'notice' }, icon('info'), el('p', {}, t('q1None')))]));
    };
    q.addEventListener('input', draw); draw();
    render(top, el('h1', {}, t('q1')), form(el('div', {}, fieldBox('uni-q', t('q1Search'), q, t('q1Hint')), list),
      () => { if (!wiz.inst) { out.replaceChildren(el('p', { class: 'field-error' }, t('q1Pick'))); return false; } return true; }));
    return;
  }
  if (step === 'claims') {
    const cards = OFFERED_CLAIMS.map((c) => el('label', { class: 'tick-card' }, el('input', { type: 'checkbox', name: 'claim', value: c, checked: wiz.claims.includes(c) }),
      el('span', {}, el('b', {}, claimName(c)), el('span', {}, t(`claimHelp.${c}`)))));
    render(top, el('h1', {}, t('q2')), el('p', { class: 'lead' }, t('q2Hint')), form(el('div', { class: 'tick-cards', role: 'group', 'aria-label': t('q2') }, cards), () => {
      wiz.claims = $$('input[name=claim]:checked').map((x) => x.value);
      if (!wiz.claims.length) { out.replaceChildren(el('p', { class: 'field-error' }, t('q2Pick'))); return false; }
      return true;
    }));
    return;
  }
  if (step.startsWith('d:')) {
    const c = step.slice(2);
    wiz.details[c] ||= {};
    const inputs = (CLAIM_DETAIL_FIELDS[c] || []).map((f) => {
      const inp = el('input', { type: 'text', id: `d-${f}`, 'data-field': f, maxlength: f === 'account_last4' ? 4 : 200, inputmode: ['account_last4', 'amount'].includes(f) ? 'numeric' : null, value: wiz.details[c][f] || '', dir: ['application_reference', 'currency', 'amount', 'account_last4'].includes(f) ? 'ltr' : null });
      return [f, inp];
    });
    render(top, el('h1', {}, t('q3', { claim: claimName(c) })), el('p', { class: 'lead' }, t('q3Hint')),
      form(el('div', {}, inputs.map(([f, inp]) => fieldBox(inp.id, t(`detailLabels.${f}`), inp, S[state.lang].detailHints?.[f] ? t(`detailHints.${f}`) : null))), () => {
        let ok = true;
        for (const [f, inp] of inputs) {
          let v = inp.value.trim();
          if (f === 'account_last4') v = v.replace(/\D/g, '').slice(-4);
          ok = showErr(inp, validateField(f, inp.value.trim())) && ok;
          if (v) wiz.details[c][f] = v; else delete wiz.details[c][f];
        }
        return ok;
      }));
    return;
  }
  if (step === 'email') {
    const name = el('input', { type: 'text', id: 'your-name', required: true, maxlength: 200, autocomplete: 'name', value: wiz.name });
    const mail = el('input', { type: 'email', id: 'app-email', required: true, maxlength: 200, dir: 'ltr', value: wiz.appEmail });
    const proofOut = el('div', { 'aria-live': 'polite' });
    const proof = el('div', { class: 'card' }, el('h2', {}, t('proveEmail')), el('p', { class: 'muted' }, t('proveEmailHint')),
      wiz.proven ? el('p', { class: 'chip plain' }, icon('done', { size: 16 }), t('proofDone')) : btn(t('sendProof'), { onclick: async (e) => {
        busy(e.currentTarget, true);
        try {
          const r = await startIdentityCheck({ kind: 'application_email', value: mail.value.trim() });
          if (r?.unavailable) { proofOut.replaceChildren(el('p', { class: 'small muted' }, t('proofUnavailable'))); return; }
          const code = el('input', { type: 'text', id: 'proof-code', class: 'code-input', inputmode: 'numeric', maxlength: 6, autocomplete: 'one-time-code' });
          proofOut.replaceChildren(fieldBox('proof-code', t('proofCode'), code), btn(t('confirmProof'), { onclick: async (ev) => {
            busy(ev.currentTarget, true);
            try { const c = await confirmIdentityCheck(r.identity_id || r.id, code.value.trim()); if (c?.unavailable) { proofOut.replaceChildren(el('p', { class: 'small muted' }, t('proofUnavailable'))); return; } wiz.proven = true; proofOut.replaceChildren(el('p', { class: 'chip plain' }, icon('done', { size: 16 }), t('proofDone'))); }
            catch (err) { proofOut.append(errorBox(err, null)); } finally { busy(ev.currentTarget, false); }
          } }));
        } catch (err) { proofOut.replaceChildren(errorBox(err, null)); } finally { busy(e.currentTarget, false); }
      } }, 'mail'), proofOut);
    render(top, el('h1', {}, t('q4')), el('p', { class: 'lead' }, t('q4Hint')),
      form(el('div', {}, fieldBox('your-name', t('yourName'), name), fieldBox('app-email', t('yourAppEmail'), mail), proof), () => {
        const okName = showErr(name, name.value.trim() ? (name.value.length > 200 ? t('fieldLong', { n: 200 }) : '') : t('fieldRequired'));
        const okMail = showErr(mail, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.value.trim()) ? '' : t('fieldEmail'));
        wiz.name = name.value.trim(); wiz.appEmail = mail.value.trim();
        return okName && okMail;
      }));
    return;
  }
  if (step === 'pressure') {
    const yn = (nameKey, cur) => el('div', { class: 'grid-2' }, ['yes', 'no'].map((v) => el('label', { class: 'tick-card' }, el('input', { type: 'radio', name: nameKey, value: v, checked: cur === (v === 'yes') }), el('span', {}, el('b', {}, t(v))))));
    render(top, el('h1', {}, t('q5')),
      form(el('div', {}, el('fieldset', {}, el('legend', {}, t('payingSoon')), yn('paying', wiz.payingSoon)), el('fieldset', {}, el('legend', {}, t('pressured')), yn('pressed', wiz.pressured)),
        el('div', { class: 'notice' }, icon('info'), el('p', {}, t('pressureNote'), ' ', el('a', { href: '#/help' }, t('askPerson'))))), () => {
        const f = $('form.wizard');
        if (!f.elements.paying.value || !f.elements.pressed.value) { out.replaceChildren(el('p', { class: 'field-error' }, t('fieldRequired'))); return false; }
        wiz.payingSoon = f.elements.paying.value === 'yes'; wiz.pressured = f.elements.pressed.value === 'yes';
        return true;
      }));
    return;
  }
  // review and create
  const row = (label, value, to) => [el('dt', {}, label), el('dd', {}, value, ' ', linkBtn(t('change'), `#/new/${to}`, 'btn quiet'))];
  const detailRows = wiz.claims.flatMap((c) => Object.entries(wiz.details[c] || {}).map(([f, v]) => row(t(`detailLabels.${f}`), v, steps.indexOf(`d:${c}`))));
  const create = el('form', { class: 'wizard', onsubmit: async (e) => {
    e.preventDefault();
    const b = submitter(e); busy(b, true);
    const details = Object.fromEntries(wiz.claims.map((c) => [c, wiz.details[c] || {}]));
    const identities = { name_on_application: wiz.name, application_email: wiz.appEmail };
    const ref = details.application_received?.application_reference || details.admission_granted?.application_reference;
    if (ref) identities.application_reference = ref;
    try {
      const r = await rpc('open_case', { p_institution: wiz.inst.id, p_claims: wiz.claims, p_details: details, p_identities: identities });
      if (wiz.payingSoon || wiz.pressured) await rpc('request_human', { p_case: r.case_id, p_reason: wiz.pressured ? 'threat_or_blackmail' : 'imminent_payment_uncertain' }).catch(() => null);
      wiz = null; go(`#/permission/${encodeURIComponent(r.case_id)}`);
    } catch (err) { out.replaceChildren(errorBox(err, null)); busy(b, false); }
  } }, out, el('div', { class: 'actions' }, el('button', { class: 'primary' }, t('createCase')), linkBtn(t('back'), `#/new/${i - 1}`, 'btn quiet', 'back')));
  render(top, el('h1', {}, t('q6')), el('dl', { class: 'kv card review-list' },
    row(t('q1'), wiz.inst.canonical_name, 0), row(t('q2'), wiz.claims.map(claimName).join(', '), 1), ...detailRows,
    row(t('yourName'), wiz.name, steps.indexOf('email')), row(t('yourAppEmail'), ltr(wiz.appEmail), steps.indexOf('email')),
    row(t('payingSoon'), t(wiz.payingSoon ? 'yes' : 'no'), steps.indexOf('pressure')), row(t('pressured'), t(wiz.pressured ? 'yes' : 'no'), steps.indexOf('pressure'))), create);
}

// ---------------- S5 permission ----------------
async function permission(caseId) {
  render(head(t('consentH'), t('consentIntro')), loading());
  let bundle, texts, contacts, caseInst;
  try {
    bundle = await rpc('read_case', { p_case: caseId });
    if (!bundle?.case) throw new ApiError('not_found');
    [texts, contacts, caseInst] = await Promise.all([
      view('v_consent_texts', `select=version,language,body,sha256&language=eq.${state.lang}&order=version.desc&limit=1`),
      view('v_approved_contacts', 'select=institution_id,value,purpose'),
      view('cases', `select=institution_id&id=eq.${encodeURIComponent(caseId)}`).then((r) => r[0]?.institution_id).catch(() => null),
    ]);
  } catch (err) { render(head(t('consentH')), errorBox(err)); return; }
  const text = texts[0];
  const rank = { verification: 1, admissions: 2, international_office: 3 };
  const contact = contacts.filter((c) => c.institution_id === caseInst && rank[c.purpose]).sort((a, b) => rank[a.purpose] - rank[b.purpose])[0];
  if (!contact || !text) { render(head(t('consentH')), el('div', { class: 'result caution' }, el('p', {}, t('noContact'))), el('div', { class: 'actions' }, linkBtn(t('askPerson'), '#/help', 'btn'))); return; }
  const claims = bundle.claims.map((c) => c.claim_type);
  const hasDetail = (f) => bundle.claims.some((c) => c.details?.[f]);
  const fields = ['name_on_application', 'application_email', 'application_reference', 'programme', 'intake'].filter((f) => ['name_on_application', 'application_email'].includes(f) || hasDetail(f));
  const days = 90;
  const ends = new Date((Date.parse(bundle.now || '') || Date.now()) + days * 86400000).toISOString();
  const typed = el('input', { type: 'text', id: 'typed', required: true, maxlength: 200, autocomplete: 'name' });
  const out = el('div', { 'aria-live': 'polite' });
  const form = el('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    if (!showErr(typed, typed.value.trim() ? '' : t('fieldRequired'))) return;
    const b = submitter(e); busy(b, true);
    try {
      const sha = await sha256Hex(text.body);
      if (sha !== text.sha256) throw new ApiError('consent_text_not_approved');
      await rpc('give_consent', { p_case: caseId, p_claims: claims, p_allowed_fields: fields, p_text_version: text.version, p_language: text.language, p_text_sha256: sha, p_days: days });
      go(`#/request/${encodeURIComponent(caseId)}`);
    } catch (err) { out.replaceChildren(errorBox(err, null)); busy(b, false); }
  } }, fieldBox('typed', t('typeName'), typed), out,
    el('div', { class: 'actions' }, el('button', { class: 'primary' }, t('agree')), linkBtn(t('notNow'), `#/request/${encodeURIComponent(caseId)}`, 'btn quiet')));
  render(head(t('consentH'), t('consentIntro'), bundle.case.institution),
    el('dl', { class: 'kv card' },
      el('dt', {}, t('consentTo')), el('dd', {}, ltr(contact.value)),
      el('dt', {}, t('consentAsk')), el('dd', {}, el('ul', {}, claims.map((c) => el('li', {}, t(`claimHelp.${c}`))))),
      el('dt', {}, t('consentShare')), el('dd', {}, fields.map((f) => t(`fields.${f}`)).join(', ')),
      el('dt', {}, t('consentUntil')), el('dd', {}, fmtDate(ends)),
      el('dt', {}, t('consentStop')), el('dd', {}, t('consentStopText'))),
    el('p', { class: 'small muted' }, t('consentNoReply')),
    el('div', { class: 'notice' }, icon('lock'), el('p', {}, t('privacyShort'), ' ', el('a', { href: '#/privacy' }, t('privacyLink')))),
    el('details', { class: 'other' }, el('summary', {}, t('readFull')), el('div', { lang: text.language, dir: text.language === 'ur' ? 'rtl' : 'ltr' }, text.body.split(/\n{2,}/).map((p) => el('p', {}, p)))),
    form);
}

// ---------------- S6 request: the pipeline ----------------
async function request(caseId) {
  render(loading());
  let tl, pl;
  try { tl = await requestTimeline(caseId); pl = await pipelineOf(tl, tl.now); } catch (err) { render(head(t('requestH', { ref: '' })), errorBox(err)); return; }
  const id = encodeURIComponent(caseId);
  const claims = tl.claims || [];
  const nowSentence = () => {
    const o = tl.outbound || {};
    switch (pl.steps[pl.current - 1]?.key) {
      case 'consent': return [t('now.consent'), linkBtn(t('givePermission'), `#/permission/${id}`, 'btn primary')];
      case 'details': return [t('now.details')];
      case 'review': return [t(o.state === 'deferred' ? 'now.review_deferred' : 'now.review'), pl.late ? el('p', { class: 'small muted' }, t('lateNote')) : null];
      case 'sent': return [t(o.state === 'failed' ? 'now.sent_failed' : 'now.sent')];
      case 'waiting': return [t('now.waiting', { date: fmtDate(o.sent_at) }), o.reply_window_until ? el('p', { class: 'small muted' }, t('now.waitingUntil', { date: fmtDate(o.reply_window_until) })) : null];
      case 'checking': return [t('now.checking', { date: fmtDate(tl.reply?.at) })];
      default: return [t('now.result')];
    }
  };
  let steps;
  if (pl.stopped) {
    const reason = String(pl.stopped);
    const nextKind = (pl.reason === 'details_need_correction' || pl.reason === 'cannot_send') ? 'secondLook' : S.en.stoppedNext[reason] || 'help';
    const action = nextKind === 'newCase' ? linkBtn(t('newCase'), '#/new/0', 'btn primary', 'plus') : nextKind === 'secondLook' ? linkBtn(t('secondLook'), `#/second-look/${id}`, 'btn primary') : linkBtn(t('askPerson'), '#/help', 'btn primary');
    const done = pl.steps.filter((s) => s.state === 'done');
    steps = [el('ol', { class: 'pipeline' }, done.map((s) => stepLi(s))),
      el('div', { class: 'stopped', role: 'status' }, el('h3', {}, icon('stop'), t('stopped.title')),
        el('p', {}, pl.reason && S.en.stoppedReason[pl.reason] ? t(`stoppedReason.${pl.reason}`) : S.en.stopped[reason] ? t(`stopped.${reason}`, { date: fmtDate(tl.consent?.withdrawn_at || tl.consent?.valid_until) }) : t('stopped.blocked')),
        el('p', { class: 'small muted' }, t('stopped.next')), el('div', { class: 'actions' }, action))];
  } else {
    steps = [el('ol', { class: 'pipeline' }, pl.steps.map((s) => stepLi(s, s.state === 'now' && !pl.complete ? el('div', { class: 'now-box' }, ...nowSentence().map((x) => (typeof x === 'string' ? el('p', {}, x) : x))) : null)))];
  }
  const results = !pl.stopped && (pl.complete || claims.some((c) => !['PENDING', 'BLOCK_EXTERNAL_VERIFICATION'].includes(c.status))) ? [el('h2', {}, t('resultH')), ...claims.map((c) => resultCard(c))] : [];
  const o = tl.outbound || {};
  render(head(tl.institution, null, `${t('requestH', { ref: tl.case_ref })}`),
    el('div', { class: 'row chips' }, claims.map((c) => el('span', { class: 'badge' }, claimName(c.claim_type)))),
    ...results, ...steps,
    el('dl', { class: 'kv card' }, el('dt', {}, t('consentTo')), el('dd', {}, o.to ? ltr(o.to) : t('toChecked')),
      el('dt', {}, t('claimsH')), el('dd', {}, el('ul', {}, claims.map((c) => el('li', {}, t(`claimHelp.${c.claim_type}`)))))),
    el('div', { class: 'actions' },
      tl.consent?.state === 'active' && !pl.complete ? linkBtn(t('withdraw'), `#/account/withdraw/${id}`, 'btn quiet') : null,
      linkBtn(t('askPerson'), '#/help', 'btn quiet')));
}
function stepLi(s, extra) {
  const label = t(`steps.${s.key}`);
  return el('li', { class: s.state, 'aria-current': s.state === 'now' ? 'step' : null },
    el('span', { class: 'dot', 'aria-hidden': 'true' }, s.state === 'done' ? icon('done', { size: 18 }) : String(s.n)),
    el('p', { class: 'label' }, label, el('span', { class: 'state' }, t(`stepState.${s.state}`))), extra);
}
function resultCard(c) {
  const x = explainClaim({ status: c.status, claimType: c.claim_type, replyReceived: c.reply_received, lang: state.lang });
  const cls = statusClass(c.status, c.reply_received);
  const appealable = ['INSTITUTION_CONFIRMED', 'INSTITUTION_CONTRADICTED', 'INSTITUTION_DECLINED', 'INCONCLUSIVE'].includes(c.status);
  return el('section', { class: `result ${cls}`, 'aria-labelledby': `h-${c.id}` },
    el('p', { class: 'level', id: `h-${c.id}` }, icon(CHIP_ICON[cls], { size: 22, cls: 'level-icon' }), x.claimLabel),
    el('p', { class: 'headline' }, x.headline),
    el('details', {}, el('summary', {}, t('whatMeans')), el('p', {}, x.meaning), el('p', {}, el('strong', {}, t('whatNot'))), el('p', {}, x.notProof)),
    el('p', {}, el('strong', {}, t('nextSteps'))), el('ol', {}, x.steps.map((s) => el('li', {}, s))),
    el('div', { class: 'actions' }, c.evidence_id ? linkBtn(t('seeAnswer'), `#/answer/${encodeURIComponent(c.evidence_id)}`, 'btn primary') : null,
      appealable ? linkBtn(t('appeal'), `#/appeal/${encodeURIComponent(c.id)}`, 'btn quiet') : null));
}

// ---------------- S7 the university's answer ----------------
async function answer(id) {
  render(head(t('evH')), loading());
  let v;
  try { v = await rpc('get_evidence_view', { p_evidence: id }); } catch (err) { render(head(t('evH')), errorBox(err)); return; }
  if (!v) { render(head(t('evH')), el('div', { class: 'empty' }, icon('clock', { size: 40 }), el('h2', {}, t('notReady')), el('div', { class: 'actions' }, linkBtn(t('askPerson'), '#/help', 'btn')))); return; }
  const authOk = v.auth?.dkim === 'pass' && v.auth?.dmarc === 'pass';
  const x = v.status && v.claim_type ? explainClaim({ status: v.status, claimType: v.claim_type, lang: state.lang }) : null;
  const text = v.redaction_approved && v.redacted_text ? v.redacted_text : '';
  const download = text ? btn(t('download'), { class: 'primary', onclick: () => {
    const body = `${t('evFrom')}: ${v.from}\n${t('evDate', { sent: fmtDate(v.date_header), received: fmtDate(v.received_at) })}\n${t('evHash')}: ${v.raw_sha256}\n\n${text}\n`;
    const a = el('a', { href: URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' })), download: 'taleemparakh-university-answer.txt' });
    document.body.append(a); a.click(); a.remove();
  } }, 'download') : null;
  render(head(t('evH')),
    v.anomalous ? el('div', { class: 'result caution' }, el('p', {}, t('evAnomalous'))) : null,
    el('dl', { class: 'kv card' },
      el('dt', {}, t('evFrom')), el('dd', {}, ltr(v.from), el('br'), el('span', { class: 'small muted' }, v.checked_sender ? t('evChecked') : t('evUnchecked'))),
      el('dt', {}, t('evAuth')), el('dd', {}, authOk ? t('evAuthPass', { domain: v.auth.dkim_domain || '' }) : t('evAuthFail')),
      el('dt', {}, t('evDates')), el('dd', {}, t('evDate', { sent: fmtDate(v.date_header), received: fmtDate(v.received_at) })),
      v.asked?.length ? el('dt', {}, t('evAsked')) : null, v.asked?.length ? el('dd', {}, el('ul', {}, v.asked.map((c) => el('li', {}, t(`claimHelp.${c}`))))) : null,
      el('dt', {}, t('evHash')), el('dd', {}, el('code', { class: 'mono', dir: 'ltr' }, v.raw_sha256 || ''), el('br'), el('span', { class: 'small muted' }, t('evHashNote')))),
    el('h2', {}, t('evText')),
    text ? el('pre', { class: 'mono', dir: 'auto' }, text) : el('p', { class: 'muted' }, t('evTextWaiting')),
    v.reviewed_on ? el('p', { class: 'small muted' }, t('evChecked2', { date: fmtDate(v.reviewed_on) })) : null,
    x ? el('div', { class: 'grid-2' }, el('div', { class: 'card' }, el('h3', {}, t('evProves')), el('p', {}, x.meaning)), el('div', { class: 'card' }, el('h3', {}, t('evNotProves')), el('p', {}, x.notProof))) : null,
    el('div', { class: 'actions' }, download, v.claim_id ? linkBtn(t('appeal'), `#/appeal/${encodeURIComponent(v.claim_id)}`, 'btn quiet') : null, linkBtn(t('askPerson'), '#/help', 'btn quiet')));
}

// ---------------- S8 appeal, second look ----------------
function appeal(claimId) {
  const g = el('textarea', { id: 'grounds', rows: 7, maxlength: 4000, required: true, 'aria-describedby': 'grounds-hint' });
  const hint = el('p', { class: 'hint', id: 'grounds-hint' }, t('appealHint', { n: 0 }));
  g.addEventListener('input', () => { hint.textContent = t('appealHint', { n: g.value.length }); });
  const out = el('div', { 'aria-live': 'polite' });
  const form = el('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    if (!showErr(g, g.value.trim().length >= 10 ? '' : t('fieldRequired'))) return;
    const b = submitter(e); busy(b, true);
    try { await rpc('file_appeal', { p_claim: claimId, p_grounds: g.value.trim() }); form.replaceWith(el('div', { class: 'notice' }, icon('done'), el('p', {}, t('appealSent')))); }
    catch (err) { out.replaceChildren(errorBox(err, null)); busy(b, false); }
  } }, el('div', { class: 'field' }, el('label', { for: 'grounds' }, t('appealGrounds')), hint, g, el('p', { class: 'field-error', id: 'grounds-err', hidden: true })), out,
    el('div', { class: 'actions' }, el('button', { class: 'primary' }, t('appealSend')), linkBtn(t('cancel'), '#/home', 'btn quiet')));
  render(head(t('appealH'), t('appealIntro')), form);
}
function secondLook(caseId) {
  const note = el('textarea', { id: 'sl-note', rows: 4, maxlength: 1000 });
  const out = el('div', { 'aria-live': 'polite' });
  const form = el('form', { onsubmit: async (e) => {
    e.preventDefault(); const b = submitter(e); busy(b, true);
    try { await askSecondLook(caseId, note.value.trim()); form.replaceWith(el('div', { class: 'notice' }, icon('done'), el('p', {}, t('secondLookSent')))); }
    catch (err) { out.replaceChildren(errorBox(err, null)); busy(b, false); }
  } }, fieldBox('sl-note', t('secondLookNote'), note), out, el('div', { class: 'actions' }, el('button', { class: 'primary' }, t('secondLookSend')), linkBtn(t('cancel'), `#/request/${encodeURIComponent(caseId)}`, 'btn quiet')));
  render(head(t('secondLookH'), t('secondLookIntro')), form);
}

// ---------------- S9 help ----------------
function help() {
  const reasons = S[state.lang].reasons;
  const out = el('div', { 'aria-live': 'polite' });
  const form = el('form', { onsubmit: async (e) => {
    e.preventDefault();
    if (!form.elements.reason.value) { out.replaceChildren(el('p', { class: 'field-error' }, t('fieldRequired'))); return; }
    const b = submitter(e); busy(b, true);
    try { await rpc('request_human', { p_case: null, p_reason: form.elements.reason.value }); out.replaceChildren(el('div', { class: 'notice' }, icon('done'), el('p', {}, t('helpSent')))); }
    catch (err) { out.replaceChildren(errorBox(err, null)); } finally { busy(b, false); }
  } }, el('fieldset', {}, el('legend', {}, t('helpReason')), el('div', { class: 'tick-cards' },
    Object.entries(reasons).map(([k, v]) => el('label', { class: 'tick-card' }, el('input', { type: 'radio', name: 'reason', value: k }), el('span', {}, el('b', {}, v)))))),
  out, el('div', { class: 'actions' }, el('button', { class: 'primary' }, t('helpSend'))));
  render(head(t('helpH'), auth.signedIn() ? t('helpIntro') : null),
    el('div', { class: 'notice' }, icon('info'), el('p', {}, ENV_LABEL === 'LIVE' ? t('helpLive') : t('helpTest'))),
    helplines(),
    el('h2', {}, t('askPerson')),
    auth.signedIn() ? form : el('div', { class: 'actions' }, linkBtn(t('helpSignIn'), '#/', 'btn primary')));
}

// ---------------- S10 account and its second screens ----------------
function privacyScreen() {
  const parts = S[state.lang].privacyNotice;
  render(el('article', { class: 'privacy' }, el('h1', {}, parts[0][1]), parts.slice(1).map(([, p]) => el('p', {}, p))),
    el('div', { class: 'actions' }, linkBtn(t('back'), auth.signedIn() ? '#/account' : '#/', 'btn', 'back')));
}
function account() {
  const lang = el('select', { id: 'acc-lang' }, el('option', { value: 'en' }, 'English'), el('option', { value: 'ur' }, 'اردو'));
  lang.value = state.lang;
  lang.addEventListener('change', () => { state.lang = lang.value; setPref('lang', state.lang); route(); });
  const status = el('p', { class: 'small muted', 'aria-live': 'polite' });
  const notify = el('input', { type: 'checkbox', id: 'notify', onchange: async () => {
    notify.disabled = true; status.textContent = t('saving');
    try { await rpc('set_notify_opt_in', { p_on: notify.checked }); status.textContent = t('saved'); } catch (err) { notify.checked = !notify.checked; status.replaceChildren(errorBox(err, null)); } finally { notify.disabled = false; }
  } });
  const row = (href, ic, label, danger) => el('li', {}, el('a', { href, class: `btn${danger ? ' danger-row' : ''}` }, icon(ic), label));
  render(head(t('accountH')),
    el('div', { class: 'card' }, el('p', { class: 'eyebrow' }, t('signedInAs')), el('p', { class: 'headline' }, ltr(auth.email()))),
    el('h2', { class: 'section-title' }, t('prefsH')),
    el('div', { class: 'card' }, el('div', { class: 'field' }, el('label', { for: 'acc-lang' }, t('language')), lang),
      el('label', {}, notify, el('span', {}, el('b', {}, t('notify')), el('br'), el('span', { class: 'small muted' }, t('notifyHint')))), status),
    el('section', { class: 'card privacy', 'aria-labelledby': 'privacy-h' }, el('h2', { id: 'privacy-h' }, S[state.lang].privacyNotice[0][1]),
      S[state.lang].privacyNotice.slice(1).map(([, p]) => el('p', {}, p))),
    el('h2', { class: 'section-title' }, t('dataH')),
    el('ul', { class: 'action-list' },
      row('#/account/export', 'download', t('exportData')),
      row('#/account/withdraw', 'undo', t('withdrawAll')),
      row(`../${state.lang === 'ur' ? 'ur/' : ''}guides/save-to-home-screen/`, 'install', t('install')),
      row('#/account/delete', 'trash', t('deleteAccount'), true)),
    el('div', { class: 'actions' }, btn(t('menu.signout'), { onclick: async () => { await auth.signOut(); wiz = null; go('#/'); } }, 'signout')));
}
function exportScreen() {
  const out = el('div', { 'aria-live': 'polite' });
  const b = btn(t('exportBtn'), { class: 'primary', onclick: async () => {
    busy(b, true);
    try {
      const d = await rpc('export_my_data');
      const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })), download: 'taleemparakh-my-data.json' });
      document.body.append(a); a.click(); a.remove();
      out.replaceChildren(el('div', { class: 'notice' }, icon('done'), el('p', {}, t('exportDone'))));
    } catch (err) { out.replaceChildren(errorBox(err, null)); } finally { busy(b, false); }
  } }, 'download');
  render(head(t('exportH'), t('exportText')), out, el('div', { class: 'actions' }, b, linkBtn(t('back'), '#/account', 'btn quiet', 'back')));
}
async function withdrawScreen(onlyCase) {
  render(head(t('withdrawH'), t('withdrawText')), loading());
  let rows;
  try {
    const all = await myRequests();
    const list = all.filter((r) => !r.stopped && (!onlyCase || r.case_id === onlyCase));
    rows = (await Promise.all(list.map(async (r) => ({ r, tl: await requestTimeline(r.case_id) })))).filter(({ tl }) => tl.consent?.state === 'active');
  } catch (err) { render(head(t('withdrawH')), errorBox(err)); return; }
  if (!rows.length) { render(head(t('withdrawH'), t('withdrawText')), el('div', { class: 'empty' }, icon('undo', { size: 40 }), el('p', {}, t('withdrawNone'))), el('div', { class: 'actions' }, linkBtn(t('back'), '#/account', 'btn quiet', 'back'))); return; }
  render(head(t('withdrawH'), t('withdrawText')), el('ul', { class: 'cards' }, rows.map(({ r, tl }) => {
    const out = el('div', { 'aria-live': 'polite' });
    const b = btn(t('withdrawBtn'), { class: 'danger', onclick: async () => {
      busy(b, true);
      try { await rpc('revoke_consent', { p_consent: tl.consent.id, p_reason: 'student withdrew in the portal' }); b.replaceWith(el('p', { class: 'chip plain' }, icon('done', { size: 16 }), t('withdrawDone'))); }
      catch (err) { out.replaceChildren(errorBox(err, null)); busy(b, false); }
    } }, 'undo');
    return el('li', { class: 'card' }, el('p', { class: 'eyebrow' }, ltr(r.case_ref)), el('h2', {}, r.institution), el('p', { class: 'muted' }, (r.claims || []).map(claimName).join(', ')), b, out);
  })), el('div', { class: 'actions' }, linkBtn(t('back'), '#/account', 'btn quiet', 'back')));
}
function deleteScreen() {
  const sure = el('input', { type: 'checkbox', id: 'sure' });
  const out = el('div', { 'aria-live': 'polite' });
  const b = btn(t('deleteBtn'), { class: 'danger solid', disabled: true, onclick: async () => {
    busy(b, true);
    try { await rpc('request_account_deletion'); render(head(t('deleteH')), el('div', { class: 'notice' }, icon('done'), el('p', {}, t('deleteDone')))); }
    catch (err) { out.replaceChildren(errorBox(err, null)); busy(b, false); }
  } }, 'trash');
  sure.addEventListener('change', () => { b.disabled = !sure.checked; });
  render(head(t('deleteH')), el('div', { class: 'result caution' }, el('p', {}, t('deleteText'))),
    el('p', {}, el('a', { href: '#/account/export' }, t('exportData'))),
    el('label', {}, sure, el('span', {}, t('deleteSure'))), out,
    el('div', { class: 'actions' }, b, linkBtn(t('cancel'), '#/account', 'btn quiet')));
}

// ---------------- router ----------------
const OPEN = new Set(['', 'code', 'help', 'privacy']);
const NEEDS_NET = new Set(['home', 'new', 'permission', 'request', 'answer', 'account', 'welcome']);
// Public launch mode: with no student backend, every screen here is one calm notice. Nothing below this guard runs,
// so no call to the API is ever made (site.config.json "backend": "off").
function launchNotice() {
  const q = state.lang === 'ur' ? '&lang=ur' : '';
  render(head(t('launchH')),
    el('div', { class: 'notice' }, icon('done'), el('p', {}, t('launchText'))),
    el('div', { class: 'actions' }, linkBtn(t('launchCheck'), `../?tab=check${q}`, 'btn primary', 'check'), linkBtn(t('launchNews'), `../?tab=news${q}`, 'btn', 'news')),
    helplines());
}
async function route() {
  const [, page = '', arg = '', arg2 = ''] = (location.hash || '#/').split('/');
  applyLang(page);
  if (!CONFIG.backendOn) { launchNotice(); return; }
  if (!auth.signedIn() && !OPEN.has(page)) { signIn(); return; }
  if (navigator.onLine === false && NEEDS_NET.has(page) && !(page === 'account' && !arg)) { offlineScreen(); return; }
  const a = decodeURIComponent(arg);
  switch (page) {
    case '': if (auth.signedIn()) { go('#/home'); return; } signIn(); return;
    case 'code': codeScreen(); return;
    case 'welcome': welcome(); return;
    case 'home': home(); return;
    case 'new': wizard(a); return;
    case 'permission': permission(a); return;
    case 'request': request(a); return;
    case 'case': go(`#/request/${arg}`); return;
    case 'answer': case 'evidence': answer(a); return;
    case 'appeal': appeal(a); return;
    case 'second-look': secondLook(a); return;
    case 'help': help(); return;
    case 'privacy': privacyScreen(); return;
    case 'account':
      if (a === 'privacy') privacyScreen();
      else if (a === 'export') exportScreen();
      else if (a === 'withdraw') withdrawScreen(arg2 ? decodeURIComponent(arg2) : null);
      else if (a === 'delete') deleteScreen();
      else account();
      return;
    default: go('#/home');
  }
}

$('#lang').addEventListener('click', () => { state.lang = state.lang === 'en' ? 'ur' : 'en'; setPref('lang', state.lang); route(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('#acct').open) { $('#acct').open = false; $('#acct summary').focus(); } });
window.addEventListener('hashchange', route);
window.addEventListener('online', route);
window.addEventListener('offline', route);
route();
watchUpdates({ text: t('update.ready'), button: t('update.now') });
