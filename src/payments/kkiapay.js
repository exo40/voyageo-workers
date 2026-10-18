'use strict';
/**
 * KKIAPAY : non implémenté dans cette version (emplacement réservé).
 * OÙ METTRE LES CLÉS (dans .env) : KKIAPAY_PUBLIC_KEY, KKIAPAY_PRIVATE_KEY, KKIAPAY_SECRET
 * KkiaPay fonctionne avec un "widget" affiché dans la page : il faudrait (1) ajouter son script dans la page
 * reserver/paiement, (2) autoriser son adresse dans la politique CSP de src/app.js, (3) vérifier la transaction
 * côté serveur avec la clé privée. Voir https://docs.kkiapay.me
 */
const { AppError } = require('../utils/errors');
const notReady = () => { throw new AppError(501, "KkiaPay n'est pas encore intégré dans cette version.", 'PAY_NOT_IMPLEMENTED'); };
module.exports = { name: 'kkiapay', createCheckout: notReady, getStatus: notReady };
