// Graphiques SVG / HTML sans bibliothèque externe (la politique de sécurité du site n'autorise que ses propres scripts).
// Responsive : les graphiques se redessinent quand la largeur disponible change. Aucune donnée fictive : un graphique vide affiche un message.
import { h, clear } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k) el.append(k);
  return el;
};
const nf = new Intl.NumberFormat('fr-FR');
export const fmtNum = (n) => nf.format(Math.round(n));
export const fmtShortDate = (d) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
export const fmtCompact = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.0', '')} M` : n >= 1e3 ? `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace('.0', '')} k` : String(Math.round(n)));

function empty(message = 'Aucune donnée sur cette période.') { return h('div', { class: 'chart-empty' }, message); }

/** Exécute draw(largeur) maintenant et à chaque changement de largeur (rotation du téléphone, redimensionnement...). */
function responsive(box, draw) {
  let last = 0, raf = 0;
  const run = () => { const w = Math.floor(box.clientWidth); if (w && w !== last) { last = w; draw(w); } };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(run); }).observe(box);
  requestAnimationFrame(run);
}

function tooltip(box) {
  const tip = h('div', { class: 'vy-tip', role: 'status', hidden: true });
  box.append(tip);
  return {
    show(x, y, lines) {
      clear(tip).append(...lines.map((l, i) => h(i ? 'div' : 'strong', {}, l)));
      tip.hidden = false;
      const w = tip.offsetWidth, bw = box.clientWidth;
      tip.style.left = `${Math.max(4, Math.min(bw - w - 4, x - w / 2))}px`;
      tip.style.top = `${Math.max(0, y - tip.offsetHeight - 10)}px`;
    },
    hide() { tip.hidden = true; },
  };
}

/**
 * Courbe ou barres dans le temps.
 * data : [{ label, sublabel?, value, tip: ['Titre', 'ligne 2'] }]
 */
export function timeChart(container, { data, type = 'bar', format = fmtNum, ariaLabel = 'Graphique', height = 220, tone = 'teal' }) {
  clear(container);
  if (!data.length || data.every((d) => !d.value)) { container.append(empty()); return; }
  const box = h('div', { class: 'chart-box' });
  container.append(box);
  const tip = tooltip(box);
  responsive(box, (W) => {
    box.querySelector('svg')?.remove();
    const m = { t: 10, r: 8, b: 26, l: Math.max(34, String(fmtCompact(Math.max(...data.map((d) => d.value)))).length * 7 + 10) };
    const iw = W - m.l - m.r, ih = height - m.t - m.b;
    const max = niceMax(Math.max(...data.map((d) => d.value)));
    const x = (i) => m.l + (data.length === 1 ? iw / 2 : (type === 'bar' ? (iw / data.length) * (i + 0.5) : (iw * i) / (data.length - 1)));
    const y = (v) => m.t + ih - (v / max) * ih;
    const svg = svgEl('svg', { width: W, height, viewBox: `0 0 ${W} ${height}`, role: 'img', 'aria-label': ariaLabel, class: `chart-svg ctone-${tone}` });
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i, yy = y(v);
      svg.append(svgEl('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: 'grid' }), svgEl('text', { x: m.l - 6, y: yy + 4, class: 'axis', 'text-anchor': 'end' }, document.createTextNode(fmtCompact(v))));
    }
    const every = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(iw / 64))));
    data.forEach((d, i) => { if (i % every === 0 || i === data.length - 1) svg.append(svgEl('text', { x: x(i), y: height - 7, class: 'axis', 'text-anchor': i === 0 && type !== 'bar' ? 'start' : i === data.length - 1 && type !== 'bar' ? 'end' : 'middle' }, document.createTextNode(d.label))); });
    const hit = (i) => { const b = box.getBoundingClientRect(); const s = svg.getBoundingClientRect(); tip.show(x(i) + (s.left - b.left), y(data[i].value) + (s.top - b.top), data[i].tip || [data[i].label, format(data[i].value)]); };
    if (type === 'bar') {
      const bw = Math.max(2, Math.min(28, (iw / data.length) * 0.66));
      data.forEach((d, i) => svg.append(svgEl('rect', { x: x(i) - bw / 2, y: y(d.value), width: bw, height: Math.max(0, m.t + ih - y(d.value)), rx: Math.min(3, bw / 2), class: 'bar' })));
    } else {
      const pts = data.map((d, i) => [x(i), y(d.value)]);
      const line = pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)} ${b.toFixed(1)}`).join('');
      svg.append(svgEl('path', { d: `${line}L${pts.at(-1)[0].toFixed(1)} ${m.t + ih}L${pts[0][0].toFixed(1)} ${m.t + ih}Z`, class: 'area' }), svgEl('path', { d: line, class: 'line' }));
      if (data.length <= 45) pts.forEach(([a, b]) => svg.append(svgEl('circle', { cx: a, cy: b, r: 2.5, class: 'dot' })));
    }
    // zones de survol / de toucher, une par point (accessibles au clavier via le tableau de la page)
    const col = iw / data.length;
    data.forEach((d, i) => {
      const r = svgEl('rect', { x: type === 'bar' ? m.l + col * i : x(i) - Math.max(8, iw / data.length / 2), y: m.t, width: type === 'bar' ? col : Math.max(16, iw / data.length), height: ih, class: 'hit' });
      r.addEventListener('pointerenter', () => hit(i)); r.addEventListener('pointermove', () => hit(i)); r.addEventListener('pointerleave', () => tip.hide());
      svg.append(r);
    });
    box.prepend(svg);
  });
}
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** Barres horizontales HTML (classements). items : [{ label, value, display?, sub? }] */
export function rankChart(container, { items, format = fmtNum, max = null, unit = '' }) {
  clear(container);
  if (!items.length) { container.append(empty()); return; }
  const top = max ?? Math.max(...items.map((i) => i.value), 1);
  container.append(h('ol', { class: 'rank' }, items.map((it) => {
    const fill = h('span', { class: 'rank-fill' });
    fill.style.width = `${Math.max(2, Math.round((it.value / top) * 100))}%`;
    return h('li', {}, h('div', { class: 'rank-head' }, h('span', { class: 'rank-label', title: it.label }, it.label), h('span', { class: 'rank-value' }, it.display ?? `${format(it.value)}${unit}`)),
      h('span', { class: 'rank-track' }, fill), it.sub ? h('span', { class: 'rank-sub' }, it.sub) : null);
  })));
}

/** Anneau + légende. items : [{ label, value, tone: 'ok'|'warn'|'bad'|'info'|'muted', display? }] */
export function donutChart(container, { items, centerLabel = '', format = fmtNum }) {
  clear(container);
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total) { container.append(empty()); return; }
  const size = 132, r = 52, c = 2 * Math.PI * r;
  let offset = 0;
  const svg = svgEl('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': `${centerLabel} : ${items.map((i) => `${i.label} ${i.value}`).join(', ')}`, class: 'donut' },
    svgEl('circle', { cx: size / 2, cy: size / 2, r, class: 'donut-bg' }),
    items.filter((i) => i.value > 0).map((i) => {
      const len = (i.value / total) * c;
      const seg = svgEl('circle', { cx: size / 2, cy: size / 2, r, class: `donut-seg tone-${i.tone}`, 'stroke-dasharray': `${Math.max(0, len - 1.5)} ${c - Math.max(0, len - 1.5)}`, 'stroke-dashoffset': -offset, transform: `rotate(-90 ${size / 2} ${size / 2})` }, svgEl('title', {}, document.createTextNode(`${i.label} : ${format(i.value)}`)));
      offset += len; return seg;
    }),
    svgEl('text', { x: size / 2, y: size / 2 - 1, class: 'donut-total', 'text-anchor': 'middle' }, document.createTextNode(fmtNum(total))),
    svgEl('text', { x: size / 2, y: size / 2 + 16, class: 'donut-cap', 'text-anchor': 'middle' }, document.createTextNode(centerLabel)));
  container.append(h('div', { class: 'donut-wrap' }, svg, h('ul', { class: 'legend' }, items.map((i) => h('li', {}, h('span', { class: `swatch tone-${i.tone}` }), h('span', { class: 'legend-label' }, i.label), h('span', { class: 'legend-value' }, i.display ?? `${format(i.value)}${total ? ` · ${Math.round((i.value / total) * 100)} %` : ''}`))))));
}

/** Petite courbe sans axes (cartes de synthèse). */
export function sparkline(values, { width = 120, height = 34 } = {}) {
  if (!values.length || values.every((v) => !v)) return null;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [(width * i) / Math.max(1, values.length - 1), height - 3 - (v / max) * (height - 6)]);
  return svgEl('svg', { width, height, viewBox: `0 0 ${width} ${height}`, class: 'spark', 'aria-hidden': 'true' }, svgEl('path', { d: pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)} ${b.toFixed(1)}`).join(''), class: 'line' }));
}
