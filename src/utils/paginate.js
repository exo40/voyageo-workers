'use strict';
const v = require('./validate');
/** Découpe une liste en pages. Paramètres de la requête : page (1...), limite (1 à 100, défaut 25). */
function paginate(list, query = {}, { defaultLimit = 25 } = {}) {
  const limite = query.limite ? v.reqInt(query.limite, 'La taille de page', { min: 1, max: 100 }) : defaultLimit;
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / limite));
  const page = Math.min(query.page ? v.reqInt(query.page, 'La page', { min: 1 }) : 1, pages);
  return { items: list.slice((page - 1) * limite, page * limite), page, pages, limite, total };
}
module.exports = { paginate };
