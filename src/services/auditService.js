'use strict';
/**
 * JOURNAL D'AUDIT : trace les actions sensibles (annulations, suppressions, changements de rôle, paiements...).
 * N'interrompt JAMAIS l'action principale : si l'écriture du journal échoue, l'erreur est seulement affichée dans la console.
 */
const db = require('../db');

/** user : l'utilisateur connecté (ou null = action automatique du système : paiement, webhook...). */
async function log(user, action, { entite = null, id_entite = null, id_compagnie = null, details = null } = {}) {
  try {
    await db.addAuditLog({
      id_utilisateur: user ? user.id_utilisateur : null,
      utilisateur_nom: user ? `${user.prenom} ${user.nom}`.trim() : 'Système',
      id_compagnie: id_compagnie ?? null,
      action, entite, id_entite,
      details: details == null ? null : String(details).slice(0, 500),
    });
  } catch (e) {
    console.error('[audit] écriture impossible :', e.message);
  }
}
module.exports = { log };
