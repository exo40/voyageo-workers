'use strict';
/** Export CSV compatible Excel français : séparateur « ; », BOM UTF-8, protection contre l'injection de formules. */
function cell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Une cellule qui commence par = + - @ (ou tabulation) peut être exécutée comme formule par Excel : on la neutralise.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[";\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}
/** columns : [{ l: 'Titre', f: (ligne) => valeur }] */
function toCsv(columns, rows) {
  const lines = [columns.map((c) => cell(c.l)).join(';'), ...rows.map((r) => columns.map((c) => cell(c.f(r))).join(';'))];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
module.exports = { toCsv, cell };
