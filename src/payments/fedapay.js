'use strict';
/**
 * FEDAPAY : paiement Mobile Money / carte au Bénin (https://fedapay.com).
 * OÙ METTRE LES CLÉS : dans le fichier .env
 *     PAYMENT_MODE=fedapay
 *     FEDAPAY_ENV=sandbox            (puis "live" quand le compte est validé)
 *     FEDAPAY_PUBLIC_KEY=pk_sandbox_...
 *     FEDAPAY_SECRET_KEY=sk_sandbox_...
 * Les clés se trouvent dans le tableau de bord FedaPay > Paramètres > Clés API.
 * La clé SECRÈTE ne doit JAMAIS apparaître dans le code, dans GitHub ni dans une page web.
 *
 * Fonctionnement : 1) le serveur crée une transaction  2) il demande l'adresse de la page de paiement
 * 3) le voyageur paie chez FedaPay  4) FedaPay le renvoie sur /paiement/retour  5) le serveur INTERROGE FedaPay
 * pour connaître le vrai statut (on ne fait jamais confiance au navigateur).
 * Cette intégration est écrite d'après la documentation publique de FedaPay : à tester en mode "sandbox"
 * et à comparer avec la documentation officielle avant toute mise en production.
 */
const config = require('../config');
const { AppError } = require('../utils/errors');

/**
 * Identifiants : par défaut ceux de la plateforme (.env). Une compagnie peut fournir les siens : { secretKey, env }.
 * Ainsi l'argent des tickets va directement sur le compte FedaPay de la compagnie.
 */
const credsOrDefault = (creds) => creds || { secretKey: config.payment.fedapay.secretKey, env: config.payment.fedapay.env };
const base = (creds) => (credsOrDefault(creds).env === 'live' ? 'https://api.fedapay.com/v1' : 'https://sandbox-api.fedapay.com/v1');

async function call(method, path, body, creds) {
  const key = credsOrDefault(creds).secretKey;
  if (!key) throw new AppError(500, 'Paiement non configuré : FEDAPAY_SECRET_KEY manque dans le fichier .env.', 'PAY_CONFIG');
  let res;
  try {
    res = await fetch(base(creds) + path, {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    throw new AppError(502, 'Le service de paiement est injoignable. Réessayez dans un instant.', 'PAY_NETWORK');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[fedapay] erreur', res.status, JSON.stringify(data).slice(0, 300));
    const err = new AppError(502, 'Le service de paiement a refusé la demande.', 'PAY_REFUSED');
    err.httpStatus = res.status;
    throw err;
  }
  return data;
}
const unwrap = (data) => data['v1/transaction'] || data.transaction || data;

module.exports = {
  name: 'fedapay',
  async createCheckout({ reservation, user, callbackUrl, creds, amount, description }) {
    const data = await call('POST', '/transactions', {
      description: description || `Ticket de bus ${reservation.numero_ticket}`,
      amount: amount ?? reservation.tarif_fcfa,
      currency: { iso: 'XOF' },
      callback_url: callbackUrl,
      customer: { firstname: user.prenom, lastname: user.nom, email: user.email },
    }, creds);
    const tx = unwrap(data);
    if (!tx || !tx.id) throw new AppError(502, 'Réponse inattendue du service de paiement.', 'PAY_RESPONSE');
    const tokenData = await call('POST', `/transactions/${tx.id}/token`, undefined, creds);
    if (!tokenData.url) throw new AppError(502, 'Réponse inattendue du service de paiement.', 'PAY_RESPONSE');
    return { reference: String(tx.id), url: tokenData.url };
  },
  /** Statut + montant confirmés par FedaPay : { statut: 'reussi'|'echoue'|'en_attente', montant, devise }. */
  async getStatusDetail(reference, creds) {
    const tx = unwrap(await call('GET', `/transactions/${encodeURIComponent(reference)}`, undefined, creds));
    const statut = ['approved', 'transferred'].includes(tx.status) ? 'reussi'
      : ['declined', 'canceled', 'cancelled', 'refunded', 'expired'].includes(tx.status) ? 'echoue' : 'en_attente';
    const montant = tx.amount == null || tx.amount === '' ? null : Number(tx.amount);
    return { statut, montant: Number.isFinite(montant) ? montant : null, devise: tx.currency?.iso || null };
  },
  /** Retourne 'reussi', 'echoue' ou 'en_attente'. */
  async getStatus(reference, creds) { return (await module.exports.getStatusDetail(reference, creds)).statut; },
  /** Nouveau lien de paiement pour une transaction déjà créée (évite de créer une deuxième transaction si le voyageur revient). */
  async resumeCheckout(reference, creds) {
    const tokenData = await call('POST', `/transactions/${encodeURIComponent(reference)}/token`, undefined, creds);
    if (!tokenData.url) throw new AppError(502, 'Réponse inattendue du service de paiement.', 'PAY_RESPONSE');
    return tokenData.url;
  },
  /**
   * Vérifie qu'une clé secrète est acceptée par FedaPay (appel de lecture sans effet).
   * Seuls 401/403 prouvent que la clé est mauvaise ; une panne réseau est signalée à part.
   */
  async verifyCredentials(creds) {
    try { await call('GET', '/transactions?per_page=1', undefined, creds); return { valide: true }; }
    catch (e) {
      if (e.code === 'PAY_NETWORK') throw e;
      if (e.httpStatus === 401 || e.httpStatus === 403) return { valide: false };
      return { valide: true };   // FedaPay a répondu et n'a pas contesté l'authentification
    }
  },
};
