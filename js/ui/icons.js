// TaleemParakh icon set (Lane B, M15). Hand-drawn on a 24 px grid, one stroke weight (1.75), round caps and
// joins, no fills except small dots. Drawn with currentColor so every icon follows the text colour in light and
// dark. Icons are decorative (aria-hidden): every icon is always next to a visible text label.
// Directional icons (arrow, chevron, back, send) are mirrored in RTL by CSS ([dir=rtl] .i-dir).
// Each entry is a list of [tag, attributes]. No HTML strings: the browser builds nodes with createElementNS,
// the page builder serialises the same data at build time.
export const ICONS = Object.freeze({
  home: [['path', { d: 'M4 10.5 12 4l8 6.5' }], ['path', { d: 'M6 9.2V20h4.5v-5.5h3V20H18V9.2' }]],
  check: [['circle', { cx: 10.5, cy: 10.5, r: 6 }], ['path', { d: 'm15 15 5 5' }], ['path', { d: 'M8 10.5h5' }]],
  news: [['path', { d: 'M5 5h11v14H6.5A1.5 1.5 0 0 1 5 17.5z' }], ['path', { d: 'M16 9h3v8.5a1.5 1.5 0 0 1-3 0' }], ['path', { d: 'M8 8.5h5M8 12h5M8 15.5h3' }]],
  help: [['circle', { cx: 12, cy: 12, r: 8.25 }], ['circle', { cx: 12, cy: 12, r: 3.5 }], ['path', { d: 'm6.2 6.2 3.3 3.3M14.5 14.5l3.3 3.3M17.8 6.2l-3.3 3.3M9.5 14.5l-3.3 3.3' }]],
  user: [['circle', { cx: 12, cy: 8.5, r: 3.5 }], ['path', { d: 'M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5' }]],
  building: [['path', { d: 'M3.5 9.5 12 5l8.5 4.5' }], ['path', { d: 'M5.5 10v7M9.8 10v7M14.2 10v7M18.5 10v7' }], ['path', { d: 'M3.5 19.5h17' }]],
  mail: [['rect', { x: 3.5, y: 6, width: 17, height: 12, rx: 1.5 }], ['path', { d: 'm4 7 8 6 8-6' }]],
  link: [['path', { d: 'M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1' }], ['path', { d: 'M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1' }]],
  chat: [['path', { d: 'M5 5.5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-4 3v-3H5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z' }], ['path', { d: 'M8 10h8M8 13h5' }]],
  money: [['rect', { x: 3.5, y: 6.5, width: 17, height: 11, rx: 1.5 }], ['circle', { cx: 12, cy: 12, r: 2.5 }], ['path', { d: 'M6.5 9.5v5M17.5 9.5v5' }]],
  book: [['path', { d: 'M12 7c-1.8-1.3-4.3-1.8-7.5-1.5v12.5c3.2-.3 5.7.2 7.5 1.5 1.8-1.3 4.3-1.8 7.5-1.5V5.5C16.3 5.2 13.8 5.7 12 7z' }], ['path', { d: 'M12 7v12.5' }]],
  phone: [['path', { d: 'M7 4h3l1.5 4-2 1.3a10 10 0 0 0 5.2 5.2l1.3-2 4 1.5v3a2 2 0 0 1-2.1 2A15.5 15.5 0 0 1 5 6.1 2 2 0 0 1 7 4z' }]],
  clock: [['circle', { cx: 12, cy: 12, r: 8.25 }], ['path', { d: 'M12 7.5V12l3 2' }]],
  tick: [['circle', { cx: 12, cy: 12, r: 8.25 }], ['path', { d: 'm8.3 12.2 2.6 2.6 4.9-5.4' }]],
  done: [['path', { d: 'm6.5 12.5 3.6 3.5 7.4-8' }]],
  warn: [['path', { d: 'M10.3 4.2 3 17.2A2 2 0 0 0 4.7 20h14.6a2 2 0 0 0 1.7-2.8L13.7 4.2a2 2 0 0 0-3.4 0z' }], ['path', { d: 'M12 9.5v4' }], ['circle', { cx: 12, cy: 16.7, r: 0.9, fill: 'currentColor', stroke: 'none' }]],
  danger: [['path', { d: 'M8.4 3.5h7.2l4.9 4.9v7.2l-4.9 4.9H8.4l-4.9-4.9V8.4z' }], ['path', { d: 'M12 8v5' }], ['circle', { cx: 12, cy: 16.2, r: 0.9, fill: 'currentColor', stroke: 'none' }]],
  info: [['circle', { cx: 12, cy: 12, r: 8.25 }], ['path', { d: 'M12 11v5.5' }], ['circle', { cx: 12, cy: 7.8, r: 0.9, fill: 'currentColor', stroke: 'none' }]],
  question: [['circle', { cx: 12, cy: 12, r: 8.25 }], ['path', { d: 'M9.6 9.6a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2.2-2.4 3.8' }], ['circle', { cx: 12, cy: 17, r: 0.9, fill: 'currentColor', stroke: 'none' }]],
  stop: [['circle', { cx: 12, cy: 12, r: 8.25 }], ['rect', { x: 9, y: 9, width: 6, height: 6, rx: 0.8 }]],
  pause: [['circle', { cx: 12, cy: 12, r: 8.25 }], ['path', { d: 'M10 9v6M14 9v6' }]],
  play: [['circle', { cx: 12, cy: 12, r: 8.25 }], ['path', { d: 'm10.2 8.8 5 3.2-5 3.2z' }]],
  arrow: [['path', { d: 'M5 12h13M13 7l5 5-5 5' }]],
  back: [['path', { d: 'M19 12H6M11 7l-5 5 5 5' }]],
  chevron: [['path', { d: 'm9.5 6 6 6-6 6' }]],
  down: [['path', { d: 'm6 9.5 6 6 6-6' }]],
  plus: [['path', { d: 'M12 5.5v13M5.5 12h13' }]],
  close: [['path', { d: 'm6.5 6.5 11 11M17.5 6.5l-11 11' }]],
  lock: [['rect', { x: 5, y: 10.5, width: 14, height: 9.5, rx: 1.5 }], ['path', { d: 'M8 10.5V8a4 4 0 0 1 8 0v2.5' }]],
  key: [['circle', { cx: 8, cy: 14, r: 3.5 }], ['path', { d: 'm10.5 11.5 8-8M15.5 6.5l2.5 2.5M13.5 8.5l2 2' }]],
  shield: [['path', { d: 'M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6z' }]],
  download: [['path', { d: 'M12 4.5v10M7.5 10.5 12 15l4.5-4.5' }], ['path', { d: 'M5 19.5h14' }]],
  trash: [['path', { d: 'M4.5 7h15M9.5 7V5h5v2' }], ['path', { d: 'M6.5 7 7.5 20h9l1-13' }]],
  undo: [['path', { d: 'M8 8H5V5' }], ['path', { d: 'M5.4 8A7.5 7.5 0 1 1 5 13' }]],
  send: [['path', { d: 'M4 12 20 4.5 15.5 20l-3.3-6.3z' }], ['path', { d: 'm12.2 13.7 3.3-3.3' }]],
  reply: [['path', { d: 'M9.5 7.5 5 12l4.5 4.5' }], ['path', { d: 'M5 12h9a5 5 0 0 1 5 5v1.5' }]],
  contact: [['rect', { x: 3.5, y: 5, width: 17, height: 14, rx: 1.5 }], ['circle', { cx: 9, cy: 11, r: 2.25 }], ['path', { d: 'M5.8 16.2c.5-1.8 1.7-2.7 3.2-2.7s2.7.9 3.2 2.7M14.5 10h3.5M14.5 13.5h3.5' }]],
  scales: [['path', { d: 'M12 4.5v15M8 19.5h8M5.5 7.5h13' }], ['path', { d: 'm5.5 7.5-2.5 6a2.8 2.8 0 0 0 5 0zM18.5 7.5l-2.5 6a2.8 2.8 0 0 0 5 0z' }]],
  heart: [['path', { d: 'M12 19.5s-7.5-4.4-7.5-10a4.2 4.2 0 0 1 7.5-2.6 4.2 4.2 0 0 1 7.5 2.6c0 5.6-7.5 10-7.5 10z' }]],
  inbox: [['path', { d: 'M4 13.5 6.5 5.5h11l2.5 8v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z' }], ['path', { d: 'M4 13.5h4.5l1 2h5l1-2H20' }]],
  activity: [['path', { d: 'M3.5 12h4l2.5-6 4 12 2.5-6h4' }]],
  sliders: [['path', { d: 'M5 7h9M18 7h1M5 17h3M12 17h7' }], ['circle', { cx: 16, cy: 7, r: 2 }], ['circle', { cx: 10, cy: 17, r: 2 }]],
  gauge: [['path', { d: 'M4.5 16.5a7.5 7.5 0 1 1 15 0' }], ['path', { d: 'm12 16.5 3.5-4.5' }]],
  spark: [['path', { d: 'M12 4.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z' }]],
  globe: [['circle', { cx: 12, cy: 12, r: 8.25 }], ['path', { d: 'M3.8 12h16.4M12 3.8c2.2 2.3 3.2 5 3.2 8.2s-1 5.9-3.2 8.2c-2.2-2.3-3.2-5-3.2-8.2s1-5.9 3.2-8.2z' }]],
  people: [['circle', { cx: 9, cy: 9, r: 3 }], ['path', { d: 'M3.5 19c.6-3 2.7-4.5 5.5-4.5s4.9 1.5 5.5 4.5' }], ['path', { d: 'M15.5 6.3a3 3 0 0 1 0 5.4M17 14.6c1.8.5 3 1.9 3.5 4.4' }]],
  database: [['ellipse', { cx: 12, cy: 6.5, rx: 7, ry: 2.5 }], ['path', { d: 'M5 6.5v11c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-11M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5' }]],
  rss: [['path', { d: 'M5.5 5.5a13 13 0 0 1 13 13M5.5 10.5a8 8 0 0 1 8 8' }], ['circle', { cx: 6.5, cy: 17.5, r: 1.2, fill: 'currentColor', stroke: 'none' }]],
  doc: [['path', { d: 'M6.5 3.5h7.5L18 7.5v13H6.5z' }], ['path', { d: 'M13.5 3.5V8H18M9 12h6M9 15.5h6' }]],
  palette: [['path', { d: 'M12 4a8 8 0 0 0 0 16c1.1 0 1.7-.8 1.4-1.7-.4-1.2.3-2.3 1.6-2.3h1.5A3.5 3.5 0 0 0 20 12.5 8.3 8.3 0 0 0 12 4z' }], ['circle', { cx: 8, cy: 11, r: 1, fill: 'currentColor', stroke: 'none' }], ['circle', { cx: 11.5, cy: 7.8, r: 1, fill: 'currentColor', stroke: 'none' }], ['circle', { cx: 15.5, cy: 9, r: 1, fill: 'currentColor', stroke: 'none' }]],
  flag: [['path', { d: 'M6 20.5V4.5' }], ['path', { d: 'M6 5h11l-2.5 4L17 13H6' }]],
  list: [['path', { d: 'M9 7h10M9 12h10M9 17h10' }], ['circle', { cx: 5, cy: 7, r: 0.9, fill: 'currentColor', stroke: 'none' }], ['circle', { cx: 5, cy: 12, r: 0.9, fill: 'currentColor', stroke: 'none' }], ['circle', { cx: 5, cy: 17, r: 0.9, fill: 'currentColor', stroke: 'none' }]],
  eye: [['path', { d: 'M3 12c2-4 5-6 9-6s7 2 9 6c-2 4-5 6-9 6s-7-2-9-6z' }], ['circle', { cx: 12, cy: 12, r: 2.75 }]],
  external: [['path', { d: 'M13.5 4.5h6v6M19.5 4.5 11 13' }], ['path', { d: 'M17.5 14v4.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1H10' }]],
  menu: [['path', { d: 'M4.5 7h15M4.5 12h15M4.5 17h15' }]],
  offline: [['path', { d: 'M4 9a12 12 0 0 1 4.3-2.5M12 6.2a12 12 0 0 1 8 2.8M7 12.3a7.5 7.5 0 0 1 3.4-1.7M14.7 11a7.5 7.5 0 0 1 2.3 1.3M10 15.6a3 3 0 0 1 4 0' }], ['path', { d: 'm4 4 16 16' }], ['circle', { cx: 12, cy: 18.5, r: 0.9, fill: 'currentColor', stroke: 'none' }]],
  install: [['rect', { x: 6.5, y: 2.5, width: 11, height: 19, rx: 2 }], ['path', { d: 'M12 7v7M9.5 11.5 12 14l2.5-2.5M10.5 18.5h3' }]],
  signout: [['path', { d: 'M10 4.5H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h4' }], ['path', { d: 'M15 8l4 4-4 4M19 12H9.5' }]],
});

/** Icons that point in a reading direction and must mirror in right-to-left pages. */
export const DIRECTIONAL = Object.freeze(new Set(['arrow', 'back', 'chevron', 'send', 'reply', 'signout', 'external']));

const NS = 'http://www.w3.org/2000/svg';
/** Builds an icon node (browser only). size in CSS px. */
export function icon(name, { size = 24, cls = '' } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  const attrs = { class: `i${DIRECTIONAL.has(name) ? ' i-dir' : ''}${cls ? ` ${cls}` : ''}`, viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
    stroke: 'currentColor', 'stroke-width': 1.75, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, String(v));
  for (const [tag, a] of ICONS[name] || ICONS.question) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(a)) n.setAttribute(k, String(v));
    svg.append(n);
  }
  return svg;
}

/** The same icon as an SVG string, for the page builder (Node only; values are constants, never user data). */
export function iconMarkup(name, { size = 24, cls = '' } = {}) {
  const inner = (ICONS[name] || ICONS.question).map(([tag, a]) => `<${tag} ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
  return `<svg class="i${DIRECTIONAL.has(name) ? ' i-dir' : ''}${cls ? ` ${cls}` : ''}" data-icon="${name}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
}
