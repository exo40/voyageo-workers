'use strict';
/**
 * ABONNEMENT DES AGENCES : une agence qui s'inscrit elle-même doit payer l'abonnement à Voyagéo
 * (compte FedaPay de la PLATEFORME, défini dans .env) pour accéder à son espace et vendre des tickets.
 *
 * États d'une compagnie :
 *  non_requis  compagnie créée par l'administrateur : pas d'abonnement (comportement historique)
 *  en_attente  agence inscrite, abonnement jamais payé : espace verrouillé, voyages non proposés
 *  actif       abonnement payé et non échu
 *  expire      abonnement échu (ou suspendu par l'administrateur) : à renouveler
 */
const crypto = require('node:crypto');
const config = require('../config');
const db = require('../db');
const { AppError } = require('../utils/errors');
const { todayStr, addDays } = require('../utils/time');
const { withLock } = require('../utils/lock');
const audit = require('./auditService');

const provider = () => require('../payments/fedapay');
const price = () => config.subscription.priceFcfa;
const duration = () => config.subscription.durationDays;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** État calculé à partir de la compagnie (ou de la vue d'un voyage : mêmes noms de champs). */
function stateOf(c) {
  const statut = (c && c.abonnement_statut) || 'non_requis';
  const expire = (c && c.abonnement_expire_le) || null;
  if (statut === 'non_requis') return { etat: 'non_requis', requis: false, actif: true, expire_le: null, jours_restants: null };
  const today = todayStr();
  if (statut === 'actif' && expire && expire >= today) return { etat: 'actif', requis: true, actif: true, expire_le: expire, jours_restants: daysBetween(today, expire) };
  if (statut === 'en_attente') return { etat: 'en_attente', requis: true, actif: false, expire_le: null, jours_restants: null };
  return { etat: 'expire', requis: true, actif: false, expire_le: expire, jours_restants: 0 };
}
const stateOfView = (h) => stateOf({ abonnement_statut: h.compagnie_abonnement_statut, abonnement_expire_le: h.compagnie_abonnement_expire_le });

const paymentPossible = () => config.payment.mode === 'simulation' || (config.payment.mode === 'fedapay' && !!config.payment.fedapay.secretKey);

async function status(companyId) {
  const c = await db.getCompagnie(companyId);
  const history = await db.listSubscriptionPayments({ id_compagnie: companyId });
  return {
    compagnie: { id_compagnie: c.id_compagnie, nom: c.nom },
    ...stateOf(c), prix_fcfa: price(), duree_jours: duration(), mode_paiement: config.payment.mode, paiement_possible: paymentPossible(),
    historique: history.map((p) => ({ id: p.id_abonnement, date: p.date_paiement, montant_fcfa: p.montant_fcfa, mode: p.mode, statut: p.statut, expire_le: p.expire_le, jours: p.jours, reference: p.reference_transaction })),
  };
}

/** Accorde la période d'abonnement. IDEMPOTENT : un même paiement ne prolonge jamais deux fois. Un renouvellement s'ajoute à la fin de la période en cours. */
function activate(companyId, payment, { jours = duration() } = {}) {
  return withLock(`subact:${companyId}`, async () => {
    if (payment) {
      const cur = (await db.getSubscriptionPaymentByReference(payment.reference_transaction)) || payment;
      if (cur.statut === 'reussi' && cur.expire_le) return { ok: true, deja: true, expire_le: cur.expire_le };
    }
    const c = await db.getCompagnie(companyId);
    const st = stateOf(c);
    const base = st.requis && st.actif && st.expire_le ? st.expire_le : todayStr();
    const expire = addDays(base, jours);
    await db.updateCompagnie(companyId, { abonnement_statut: 'actif', abonnement_expire_le: expire });
    if (payment) await db.updateSubscriptionPayment(payment.id_abonnement, { statut: 'reussi', expire_le: expire, jours });
    return { ok: true, expire_le: expire };
  });
}

/** Le gestionnaire clique sur « Payer l'abonnement ». */
function pay(user) {
  const cid = user.id_compagnie;
  return withLock(`sub:${cid}`, async () => {
    const c = await db.getCompagnie(cid);
    if (!c) throw new AppError(404, 'Compagnie introuvable.', 'NOT_FOUND');
    const mode = config.payment.mode;
    if (mode === 'simulation') {
      const p = await db.createSubscriptionPayment({ id_compagnie: cid, montant_fcfa: price(), mode: 'simulation', reference_transaction: `SIM-ABO-${crypto.randomBytes(6).toString('hex').toUpperCase()}`, statut: 'en_attente', jours: duration() });
      const out = await activate(cid, p);
      await audit.log(null, 'abonnement.paye', { entite: 'compagnie', id_entite: cid, id_compagnie: cid, details: `Abonnement de « ${c.nom} » payé (SIMULATION, ${price()} FCFA) jusqu'au ${out.expire_le}.` });
      return { simule: true, expire_le: out.expire_le };
    }
    if (mode !== 'fedapay') throw new AppError(400, "Le paiement en ligne n'est pas activé sur Voyagéo pour le moment. Contactez l'administrateur pour activer votre abonnement.", 'SUB_PAY_OFF');
    if (!config.payment.fedapay.secretKey) throw new AppError(500, "Le paiement des abonnements n'est pas configuré (FEDAPAY_SECRET_KEY de la plateforme).", 'PAY_CONFIG');
    const p = provider();
    const open = (await db.listSubscriptionPayments({ id_compagnie: cid })).find((x) => x.statut === 'en_attente' && x.mode === 'fedapay');
    if (open && typeof p.resumeCheckout === 'function') {
      try { return { url: await p.resumeCheckout(open.reference_transaction) }; } catch (e) { console.warn('[abonnement] reprise impossible, nouvelle transaction :', e.message); }
    }
    const { reference, url } = await p.createCheckout({ user, amount: price(), description: `Abonnement Voyagéo : ${c.nom}`, callbackUrl: `${config.baseUrl}/abonnement/retour?c=${cid}` });
    await db.createSubscriptionPayment({ id_compagnie: cid, montant_fcfa: price(), mode: 'fedapay', reference_transaction: reference, statut: 'en_attente', jours: duration() });
    return { url };
  });
}

/** Vérifie TOUJOURS chez FedaPay (statut ET montant) avant d'accorder l'abonnement. */
async function settle(payment) {
  const p = provider();
  const d = typeof p.getStatusDetail === 'function' ? await p.getStatusDetail(payment.reference_transaction) : { statut: await p.getStatus(payment.reference_transaction), montant: null };
  if (d.statut === 'reussi') {
    if (d.montant != null && d.montant !== payment.montant_fcfa) {
      await audit.log(null, 'abonnement.anomalie_montant', { entite: 'compagnie', id_entite: payment.id_compagnie, id_compagnie: payment.id_compagnie, details: `Abonnement : montant attendu ${payment.montant_fcfa} FCFA, payé ${d.montant} (réf. ${payment.reference_transaction}). Non activé : vérification manuelle.` });
      return { statut: 'en_attente' };
    }
    const out = await activate(payment.id_compagnie, payment);
    if (!out.deja) await audit.log(null, 'abonnement.paye', { entite: 'compagnie', id_entite: payment.id_compagnie, id_compagnie: payment.id_compagnie, details: `Abonnement payé (${payment.montant_fcfa} FCFA, réf. ${payment.reference_transaction}) jusqu'au ${out.expire_le}.` });
    return { statut: 'reussi' };
  }
  if (d.statut === 'echoue' && payment.statut === 'en_attente') await db.updateSubscriptionPayment(payment.id_abonnement, { statut: 'echoue' });
  return { statut: d.statut };
}

/** Retour du navigateur après paiement : /abonnement/retour?c=<compagnie>&id=<transaction>. */
async function retour(query) {
  const id = String(query.id || '').slice(0, 100), cid = Number(query.c);
  const payment = id ? await db.getSubscriptionPaymentByReference(id) : null;
  if (!payment || payment.id_compagnie !== cid) throw new AppError(404, 'Transaction inconnue.', 'PAY_RETURN');
  if (payment.statut === 'reussi') return { statut: 'reussi' };
  return settle(payment);
}
/** Webhook de la plateforme : renvoie { ignore: true } si la transaction n'est pas un abonnement. */
async function webhook(body) {
  const ref = body && (body.entity?.id ?? body['v1/transaction']?.id ?? body.transaction?.id);
  if (ref == null) return { ignore: true };
  const payment = await db.getSubscriptionPaymentByReference(String(ref).slice(0, 100));
  if (!payment || payment.statut === 'reussi') return { ignore: true };
  return { ok: true, ...(await settle(payment)) };
}

/** Actions de l'administrateur : activer à la main (paiement hors ligne), suspendre, dispenser d'abonnement. */
async function adminSet(user, companyId, { action, jours, note }) {
  const c = await db.getCompagnie(companyId);
  if (!c) throw new AppError(404, 'Compagnie introuvable.', 'NOT_FOUND');
  const ctx = { entite: 'compagnie', id_entite: companyId, id_compagnie: companyId };
  if (action === 'activer') {
    const days = jours || duration();
    const p = await db.createSubscriptionPayment({ id_compagnie: companyId, montant_fcfa: price(), mode: 'manuel', reference_transaction: `MAN-${crypto.randomBytes(5).toString('hex').toUpperCase()}`, statut: 'en_attente', jours: days });
    const out = await activate(companyId, p, { jours: days });
    await audit.log(user, 'abonnement.active_manuellement', { ...ctx, details: `Abonnement de « ${c.nom} » activé manuellement pour ${days} jours (jusqu'au ${out.expire_le}).${note ? ` Note : ${note}` : ''}` });
    return out;
  }
  if (action === 'suspendre') {
    await db.updateCompagnie(companyId, { abonnement_statut: 'expire', abonnement_expire_le: todayStr() });
    await audit.log(user, 'abonnement.suspendu', { ...ctx, details: `Abonnement de « ${c.nom} » suspendu.${note ? ` Note : ${note}` : ''}` });
    return { ok: true };
  }
  if (action === 'dispenser') {
    await db.updateCompagnie(companyId, { abonnement_statut: 'non_requis', abonnement_expire_le: null });
    await audit.log(user, 'abonnement.dispense', { ...ctx, details: `« ${c.nom} » dispensée d'abonnement.${note ? ` Note : ${note}` : ''}` });
    return { ok: true };
  }
  throw new AppError(400, 'Action inconnue.', 'VALIDATION');
}

module.exports = { stateOf, stateOfView, status, pay, activate, retour, webhook, adminSet, price, duration, paymentPossible };
