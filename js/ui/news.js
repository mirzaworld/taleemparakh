// News tab (Lane B shell, M16; data published by Lane C, BUILD-SPEC addendum D.7).
// Reads data/news.json: [{ id, title, outlet, url, published_at, lang, tags, protect_note_id, also_reported_by? }],
// data/news-meta.json: { generated_at (null until the first clean run), item_count, active_sources } and
// data/protect-notes.json: { generated_at, notes: [{ id, topic, text_en, text_ur, guide_slug }] } (an array or an
// object keyed by id are accepted too). Every value is untrusted: rendered with textContent only, links must be https, and nothing from an
// item is ever used as an instruction. A missing file shows the empty state, a network failure the offline state.
import { icon } from './icons.js';

const L = {
  en: {
    disclaimer: 'These are headlines from other news sites, picked by rules and checked by a person when the rules are not sure. We do not check every story. Each headline is news from the outlet named on it. It is not a finding by TaleemParakh.',
    updated: 'Last updated {date}.', stale: 'News may be out of date.', loading: 'Loading...',
    from: 'News from {outlet}', open: 'Read it on {host}', protect: 'How to protect yourself', guide: 'Read our guide',
    emptyH: 'No news yet', empty: 'When there is news about scams that affect students, it will appear here. Until then, our guides explain the common tricks.',
    guides: 'Open the guides', offlineH: 'You are offline', offline: 'News needs the internet. The checks and the guides you opened before still work.',
    errorH: 'News could not load', error: 'Something went wrong while loading the news. Nothing was sent. Please try again.', retry: 'Try again',
    more: 'Show more',
  },
  ur: {
    disclaimer: 'یہ دوسری خبروں کی ویب سائٹس کی سرخیاں ہیں۔ انہیں اصولوں کے مطابق چنا جاتا ہے، اور جب اصول یقینی نہ ہوں تو ایک شخص انہیں جانچتا ہے۔ ہم ہر خبر کی جانچ نہیں کرتے۔ ہر سرخی اسی ویب سائٹ کی خبر ہے جس کا نام اس پر لکھا ہے۔ یہ تعلیم پرکھ کا کوئی نتیجہ نہیں۔',
    updated: 'آخری بار تازہ کیا گیا: {date}۔', stale: 'ہو سکتا ہے یہ خبریں پرانی ہوں۔', loading: 'لوڈ ہو رہا ہے...',
    from: '{outlet} کی خبر', open: '{host} پر پڑھیں', protect: 'اپنی حفاظت کیسے کریں', guide: 'ہماری رہنمائی پڑھیں',
    emptyH: 'ابھی کوئی خبر نہیں', empty: 'جب طلبہ کو متاثر کرنے والے فراڈ کی کوئی خبر ہو گی تو وہ یہاں نظر آئے گی۔ تب تک ہماری رہنمائی عام چالوں کے بارے میں بتاتی ہے۔',
    guides: 'رہنمائی کھولیں', offlineH: 'آپ آف لائن ہیں', offline: 'خبروں کے لیے انٹرنیٹ درکار ہے۔ جانچ اور وہ رہنمائی جو آپ پہلے کھول چکے ہیں، اب بھی کام کرتی ہے۔',
    errorH: 'خبریں لوڈ نہیں ہو سکیں', error: 'خبریں لوڈ کرتے وقت کچھ غلط ہو گیا۔ کچھ بھی نہیں بھیجا گیا۔ دوبارہ کوشش کریں۔', retry: 'دوبارہ کوشش کریں',
    more: 'مزید دکھائیں',
  },
};
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'class') n.className = v;
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
}

const str = (v, max = 400) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ').trim().slice(0, max) : '');
function safeUrl(v) {
  try { const u = new URL(String(v)); return u.protocol === 'https:' && !u.username && !u.password ? u : null; } catch { return null; }
}
/** Keeps only well-formed items; anything odd is dropped, never repaired. */
export function cleanItems(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : [];
  return list.map((x) => ({ id: str(x?.id, 80), title: str(x?.title, 300), outlet: str(x?.outlet, 80), url: safeUrl(x?.url),
    published: Number.isNaN(Date.parse(x?.published_at)) ? null : new Date(x.published_at), lang: x?.lang === 'ur' ? 'ur' : 'en',
    note: str(x?.protect_note_id, 80) }))
    .filter((x) => x.id && x.title && x.outlet && x.url && x.published)
    .sort((a, b) => b.published - a.published);
}

async function getJson(url) {
  const res = await fetch(url, { cache: 'no-cache', credentials: 'omit' });
  if (res.status === 404) return { missing: true };
  if (!res.ok) throw new Error(`http ${res.status}`);
  return { data: await res.json() };
}

/** Renders the News tab into `out`. base is the path to the site root ('' on the home page, '../' in portal). */
export async function renderNews(out, { lang = 'en', base = '' } = {}) {
  const T = L[lang] || L.en;
  const loc = lang === 'ur' ? 'ur-PK' : 'en-GB';
  const fmt = (d) => new Intl.DateTimeFormat(loc, { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
  const emptyBox = (h, p, action) => el('div', { class: 'empty' }, icon('news', { size: 40 }), el('h2', {}, h), el('p', {}, p), action ? el('div', { class: 'actions' }, action) : null);
  out.replaceChildren(el('p', { class: 'skeleton', role: 'status' }, T.loading));
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    out.replaceChildren(emptyBox(T.offlineH, T.offline, el('a', { class: 'btn', href: `${base}guides/` }, T.guides)));
    return;
  }
  let news; let notes; let meta;
  try {
    [news, notes, meta] = await Promise.all([getJson(`${base}data/news.json`), getJson(`${base}data/protect-notes.json`).catch(() => ({ missing: true })),
      getJson(`${base}data/news-meta.json`).catch(() => ({ missing: true }))]);
  } catch {
    const retry = el('button', { type: 'button', onclick: () => renderNews(out, { lang, base }) }, T.retry);
    out.replaceChildren(navigator.onLine === false ? emptyBox(T.offlineH, T.offline) : emptyBox(T.errorH, T.error, retry));
    return;
  }
  const items = news.missing ? [] : cleanItems(news.data);
  const nd = notes?.data;
  const noteList = Array.isArray(nd) ? nd : Array.isArray(nd?.notes) ? nd.notes : nd && typeof nd === 'object' ? Object.entries(nd).filter(([k]) => k !== 'generated_at').map(([k, v]) => ({ id: k, ...v })) : [];
  const noteMap = new Map(noteList.map((n) => [str(n?.id, 80), n]));
  const generated = Date.parse(meta?.data?.generated_at || news.data?.generated_at || '');
  const head = el('p', { class: 'muted small' }, T.disclaimer, ' ', Number.isNaN(generated) ? '' : fill(T.updated, { date: fmt(new Date(generated)) }));
  if (!items.length) {
    out.replaceChildren(head, emptyBox(T.emptyH, T.empty, el('a', { class: 'btn primary', href: `${base}guides/` }, T.guides)));
    return;
  }
  const stale = !Number.isNaN(generated) && Date.now() - generated > 24 * 3600 * 1000;
  const card = (x) => {
    const n = x.note ? noteMap.get(x.note) : null;
    const noteText = n ? str(lang === 'ur' ? (n.text_ur || n.text_en) : n.text_en, 600) : '';
    const slug = n && /^[a-z0-9-]{3,80}$/.test(n.guide_slug || '') ? n.guide_slug : null;
    return el('li', { class: 'card news-item' },
      el('p', { class: 'outlet' }, fill(T.from, { outlet: x.outlet }), ' · ', el('time', { datetime: x.published.toISOString().slice(0, 10) }, fmt(x.published))),
      el('h2', { dir: 'auto', lang: x.lang }, x.title),
      el('a', { href: x.url.href, rel: 'noopener noreferrer nofollow', referrerpolicy: 'no-referrer', target: '_blank' }, fill(T.open, { host: x.url.hostname }), ' ', icon('external', { size: 16 })),
      noteText ? el('div', { class: 'protect' }, el('b', {}, T.protect), noteText,
        slug ? el('span', {}, ' ', el('a', { href: `${base}${lang === 'ur' ? 'ur/' : ''}guides/${slug}/` }, T.guide)) : null) : null);
  };
  const PAGE = 12;
  const list = el('ul', { class: 'news-list' }, items.slice(0, PAGE).map(card));
  let shown = PAGE;
  const more = items.length > PAGE ? el('button', { type: 'button', class: 'wide', onclick: () => {
    list.append(...items.slice(shown, shown + PAGE).map(card)); shown += PAGE; if (shown >= items.length) more.remove();
  } }, T.more) : null;
  out.replaceChildren(...[head, stale ? el('p', { class: 'warn', role: 'status' }, T.stale) : null, list, more].filter(Boolean));
}
