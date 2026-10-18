// Jeu d'icônes SVG (trait, 24 x 24). Créées avec createElementNS : aucun innerHTML, compatible avec la politique de sécurité du site.
const NS = 'http://www.w3.org/2000/svg';
const P = {
  dashboard: ['M3 3h8v9H3z', 'M13 3h8v5h-8z', 'M13 10h8v11h-8z', 'M3 14h8v7H3z'],
  activity: ['M3 12h4l3-8 4 16 3-8h4'],
  bus: ['M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M3 11h18', 'M7 18v2', 'M17 18v2', 'M7 14.5h.01', 'M17 14.5h.01'],
  route: ['M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M8 17h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7'],
  calendar: ['M4 5h16v16H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
  ticket: ['M3 8a2 2 0 0 0 0 8v2a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-2a2 2 0 0 1 0-8V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1z', 'M14 5v14'],
  wallet: ['M4 7h15a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12', 'M16 14h2'],
  building: ['M4 21V5l8-3 8 3v16', 'M2 21h20', 'M9 9h2', 'M13 9h2', 'M9 13h2', 'M13 13h2', 'M10 21v-4h4v4'],
  users: ['M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1', 'M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M21 20v-1a4 4 0 0 0-3-3.9', 'M15 4.2a3.5 3.5 0 0 1 0 6.6'],
  refresh: ['M20 11a8 8 0 0 0-14.9-3', 'M4 4v4h4', 'M4 13a8 8 0 0 0 14.9 3', 'M20 20v-4h-4'],
  bell: ['M6 9a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7', 'M10 20a2 2 0 0 0 4 0'],
  download: ['M12 3v12', 'M7 11l5 5 5-5', 'M4 21h16'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M21 21l-5-5'],
  plus: ['M12 5v14', 'M5 12h14'],
  x: ['M6 6l12 12', 'M18 6L6 18'],
  alert: ['M12 3l10 18H2z', 'M12 10v5', 'M12 18h.01'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  menu: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  logout: ['M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4', 'M16 17l5-5-5-5', 'M21 12H9'],
  home: ['M3 11l9-8 9 8', 'M5 10v10h14V10', 'M10 20v-6h4v6'],
  up: ['M7 14l5-5 5 5'],
  down: ['M7 10l5 5 5-5'],
  pin: ['M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z', 'M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  edit: ['M4 20h4L19 9l-4-4L4 16z', 'M13.5 6.5l4 4'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'],
  ban: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M5.6 5.6l12.8 12.8'],
  key: ['M14 10a4 4 0 1 0-3.9-5 4 4 0 0 0 3.9 5z', 'M11.5 8.5L3 17v4h4v-2h2v-2h2l3.5-3.5'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 8h.01'],
  chevronL: ['M15 6l-6 6 6 6'],
  chevronR: ['M9 6l6 6-6 6'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  undo: ['M9 14L4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
  sun: ['M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M12 2v2', 'M12 20v2', 'M4.9 4.9l1.4 1.4', 'M17.7 17.7l1.4 1.4', 'M2 12h2', 'M20 12h2', 'M4.9 19.1l1.4-1.4', 'M17.7 6.3l1.4-1.4'],
  moon: ['M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z'],
  star: ['M12 2.8l2.8 5.9 6.4.9-4.7 4.5 1.2 6.4L12 17.4l-5.7 3.1 1.2-6.4-4.7-4.5 6.4-.9z'],
  shield: ['M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z', 'M9 12l2 2 4-4'],
  zap: ['M13 2L4 14h7l-1 8 9-12h-7z'],
};
const FILLED = new Set(['star']);
export function icon(name, size = 18, cls = '') {
  const svg = document.createElementNS(NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(k, v);
  svg.setAttribute('class', `vy-icon ${cls}`.trim());
  if (FILLED.has(name)) svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of P[name] || P.info) { const p = document.createElementNS(NS, 'path'); p.setAttribute('d', d); svg.append(p); }
  return svg;
}
