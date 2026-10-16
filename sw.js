// Offline cache for the public site and the student app shell (BUILD-SPEC-ADDENDUM-R7 F.3).
// ALLOWLIST ONLY: a request is cached only if its path is on the lists below. Everything else, including any
// account, database, login or function call and any request carrying credentials, goes straight to the network and
// is never stored. Cached: the empty app shell, static guides, and the public data files. No personal data is in them.
// Cache keys drop the query string and fragment, so a link with a token in it is never stored.
// Update flow: a new worker waits instead of taking over mid-use. It tells open pages (message TP_UPDATE_READY),
// and the page sends TP_SKIP_WAITING when the student taps "Update now", then reloads on controllerchange.
// HTML is only ever returned for a navigation, never in place of a stylesheet or script (finding B-15).
const VERSION = 'tp-d920d2815e04';
const SHELL = [
  './', 'index.html', 'offline.html', 'styles.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/mark.svg', 'fonts/lora-latin.woff2', 'fonts/nastaliq-urdu.woff2', 'icons/icon-192.png', 'icons/favicon-32.png',
  'js/app.js', 'js/i18n.js', 'js/core/normalize.js', 'js/core/registry.js',
  'js/core/domain-check.js', 'js/core/red-flags.js', 'js/core/payment-check.js',
  'guides/', 'guides/already-paid-what-to-do/', 'guides/blackmail-images-help/', 'data/registry.json',
];
// Saved when present; a page that does not exist yet must not stop the install.
const OPTIONAL = ['portal/', 'about/', 'news/', 'guides/save-to-home-screen/', 'data/news.json', 'data/news-meta.json', 'data/protect-notes.json'];
const DATA = ['data/registry.json', 'data/news.json', 'data/news-meta.json', 'data/protect-notes.json'];
const PAGES = ['offline.html', 'index.html', 'about/', 'guides/', 'ur/', 'news/', 'portal/', 'donate/', 'impact/', 'schools/'];
const ASSETS = /^(styles\.css|manifest\.webmanifest|js\/(app\.js|i18n\.js|outreach\.js|core\/|lib\/|ui\/|portal\/)|fonts\/|icons\/|img\/)/;
const NEVER = /\/(rest|auth|functions|storage|realtime)\//;

const scopePath = () => new URL(self.registration.scope).pathname;
const relPath = (url) => (url.pathname.startsWith(scopePath()) ? url.pathname.slice(scopePath().length) : null);
const keyFor = (url) => new Request(url.origin + url.pathname);

/** 'skip' (network only, never stored), 'data', 'page' or 'asset'. */
function route(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return 'skip';
  if (request.headers.has('authorization') || NEVER.test(url.pathname)) return 'skip';
  const rel = relPath(url);
  if (rel === null || rel === 'version.json' || rel === 'sw.js') return 'skip';
  if (DATA.includes(rel)) return 'data';
  if (request.mode === 'navigate') return rel === '' || PAGES.some((p) => rel === p || rel.startsWith(p)) ? 'page' : 'skip';
  return ASSETS.test(rel) ? 'asset' : 'skip';
}

const storable = (res) => res.ok && res.type === 'basic' && !/no-store|private/i.test(res.headers.get('cache-control') || '') && !res.headers.has('set-cookie');
const save = (request, res) => {
  if (storable(res)) { const copy = res.clone(); const key = keyFor(new URL(request.url)); caches.open(VERSION).then((c) => c.put(key, copy)); }
  return res;
};

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL);
    await Promise.allSettled(OPTIONAL.map((u) => c.add(u)));
    if (!self.registration.active) { await self.skipWaiting(); return; } // first install: nothing to interrupt
    const open = await self.clients.matchAll({ type: 'window' });
    open.forEach((w) => w.postMessage({ type: 'TP_UPDATE_READY', version: VERSION }));
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
    (await self.clients.matchAll({ type: 'window' })).forEach((w) => w.postMessage({ type: 'TP_UPDATED', version: VERSION }));
  })());
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'TP_SKIP_WAITING') self.skipWaiting();
  else if (e.data?.type === 'TP_GET_VERSION') e.source?.postMessage({ type: 'TP_VERSION', version: VERSION });
});

// Mark a cached copy so the app can say the data may be out of date.
async function fromCache(request) {
  const hit = await caches.match(keyFor(new URL(request.url)));
  if (!hit) return Response.error();
  const headers = new Headers(hit.headers);
  headers.set('X-TP-From-Cache', '1');
  return new Response(await hit.blob(), { status: hit.status, statusText: hit.statusText, headers });
}

self.addEventListener('fetch', (e) => {
  const kind = route(e.request);
  if (kind === 'skip') return; // not ours: the browser handles it, nothing is stored
  if (kind === 'data') {
    e.respondWith(fetch(e.request).then((res) => save(e.request, res)).catch(() => fromCache(e.request)));
  } else if (kind === 'page') {
    e.respondWith(fetch(e.request).then((res) => save(e.request, res))
      .catch(() => caches.match(keyFor(new URL(e.request.url))).then((hit) => hit || caches.match('offline.html'))));
  } else {
    e.respondWith(caches.match(keyFor(new URL(e.request.url))).then((hit) => hit || fetch(e.request).then((res) => save(e.request, res))));
  }
});
