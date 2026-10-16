// Home story (scrollytelling, Lane B 2026-10-16): progress rail, flip cards, the "spot the fake" letter, the hero
// tilt, and a fallback for browsers without scroll-driven CSS animations. Everything here is an extra: with
// JavaScript off the story reads as plain sections, and with reduced motion nothing moves. Words come from i18n.js
// and are set with textContent only. Nothing is stored or sent.
const $$ = (sel, root) => [...root.querySelectorAll(sel)];
const UR_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const digits = (n, lang) => (lang === 'ur' ? String(n).replace(/\d/g, (d) => UR_DIGITS[d]) : String(n));

/** Wires up #panel-story. getT() and getLang() return the current translator and language. */
export function mountStory(root, { getT, getLang }) {
  if (!root || root.dataset.mounted) return null;
  root.dataset.mounted = '1';
  const html = document.documentElement;
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sda = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('animation-timeline: view()');

  // The sticky rail sits under the sticky header, whose height changes with the language and font.
  const header = document.querySelector('.top');
  const setTop = () => { if (header) html.style.setProperty('--top-h', `${header.offsetHeight}px`); };
  setTop();
  addEventListener('resize', setTop, { passive: true });

  // ---- progress rail: current step (IntersectionObserver) and the fill (one rAF per scroll frame) ----
  const stages = $$('.stage', root);
  const links = $$('.rail a', root);
  const box = root.querySelector('.stages');
  const fill = root.querySelector('.rail-fill');
  let current = -1;
  const setCurrent = (i) => {
    if (i === current) return;
    current = i;
    links.forEach((a, k) => {
      if (k === i) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current');
      a.parentElement.classList.toggle('done', k < i);
    });
  };
  const visible = new Set();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target);
    }
  }, { rootMargin: '10% 0px 10% 0px' });
  stages.forEach((s) => io.observe(s));
  const parallax = !sda && !calm;

  let ticking = false;
  function frame() {
    ticking = false;
    const vh = innerHeight;
    if (box && fill) {
      const r = box.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (vh * 0.5 - r.top) / Math.max(1, r.height)));
      fill.style.setProperty('--rail-p', p.toFixed(4));
    }
    // Current step: the one crossing the middle of the screen.
    let now = -1;
    stages.forEach((s, i) => { const r = s.getBoundingClientRect(); if (r.top < vh * 0.5 && r.bottom > vh * 0.5) now = i; });
    if (now >= 0) setCurrent(now);
    if (parallax) {
      for (const s of visible) {
        const r = s.getBoundingClientRect();
        s.style.setProperty('--sp', Math.min(1, Math.max(0, (vh - r.top) / (vh + r.height))).toFixed(3));
      }
    }
  }
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
  frame();

  // ---- fallback reveal when CSS cannot tie animation to scroll ----
  if (!sda && !calm && 'IntersectionObserver' in window) {
    html.classList.add('story-io');
    const rio = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); rio.unobserve(e.target); }
    }, { threshold: 0.12 });
    $$('.rv', root).forEach((n) => rio.observe(n));
  }

  // ---- flip cards: front is the warning sign, back is the free check. The hidden face is inert. ----
  for (const card of $$('.flip', root)) {
    const front = card.querySelector('.front');
    const back = card.querySelector('.back');
    const open = card.querySelector('.flip-btn');
    const shut = card.querySelector('.flip-back');
    if (!front || !back || !open || !shut) continue;
    const set = (flipped) => {
      card.classList.toggle('is-flipped', flipped);
      front.inert = flipped;
      back.inert = !flipped;
      open.setAttribute('aria-expanded', String(flipped));
    };
    set(false);
    open.addEventListener('click', () => { set(true); back.focus({ preventScroll: true }); });
    shut.addEventListener('click', () => { set(false); open.focus({ preventScroll: true }); });
  }

  // ---- spot the fake ----
  const spot = root.querySelector('.spot');
  const found = new Set();
  let renderSpot = () => {};
  if (spot) {
    const flags = $$('.flag', spot);
    const items = new Map($$('.spot-list li', spot).map((li) => [li.dataset.flag, li]));
    const pips = $$('.pip', spot);
    const count = spot.querySelector('.spot-count');
    const total = items.size;
    renderSpot = () => {
      const t = getT();
      const lang = getLang();
      count.textContent = found.size === total ? t('story.spot.done') : t('story.spot.count', { n: digits(found.size, lang) });
      pips.forEach((p, i) => p.classList.toggle('on', i < found.size));
      for (const f of flags) f.setAttribute('aria-pressed', String(found.has(f.dataset.flag)));
      for (const [k, li] of items) li.hidden = !found.has(k);
    };
    const mark = (k) => { if (!found.has(k)) { found.add(k); renderSpot(); } };
    // Spans, not <button>: a button can never flow inside a sentence. JavaScript makes each one a keyboard toggle.
    for (const f of flags) {
      f.setAttribute('role', 'button');
      f.tabIndex = 0;
      f.addEventListener('click', () => mark(f.dataset.flag));
      f.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mark(f.dataset.flag); } });
    }
    spot.querySelector('.spot-reveal')?.addEventListener('click', () => { for (const k of items.keys()) found.add(k); renderSpot(); });
    spot.querySelector('.spot-reset')?.addEventListener('click', () => { found.clear(); renderSpot(); flags[0]?.focus(); });
    renderSpot();
  }

  // ---- hero tilt: follows a mouse or trackpad pointer, eased. Not on touch, not with reduced motion. ----
  const art = root.querySelector('.hero-art');
  const tilt = art?.querySelector('.tilt');
  if (tilt && !calm && matchMedia('(pointer: fine)').matches) {
    const hero = art.closest('.hero') || art;
    let tx = 0; let ty = 0; let cx = 0; let cy = 0; let raf = 0;
    const step = () => {
      cx += (tx - cx) * 0.08; cy += (ty - cy) * 0.08;
      tilt.style.transform = `rotateY(${(cx * 26).toFixed(2)}deg) rotateX(${(-cy * 18).toFixed(2)}deg)`;
      raf = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.002 ? requestAnimationFrame(step) : 0;
    };
    hero.addEventListener('pointermove', (e) => {
      const r = art.getBoundingClientRect();
      tx = Math.max(-0.6, Math.min(0.6, (e.clientX - r.left) / r.width - 0.5));
      ty = Math.max(-0.6, Math.min(0.6, (e.clientY - r.top) / r.height - 0.5));
      if (!raf) raf = requestAnimationFrame(step);
    }, { passive: true });
    hero.addEventListener('pointerleave', () => { tx = 0; ty = 0; if (!raf) raf = requestAnimationFrame(step); });
  }

  return { relabel() { setTop(); renderSpot(); } };
}
