'use strict';
const crypto = require('node:crypto');
const config = require('../config');
const db = require('../db');
const { AppError } = require('../utils/errors');
const v = require('../utils/validate');
const { withLock } = require('../utils/lock');
const reservations = require('./reservationService');
const email = require('./emailService');
const audit = require('./auditService');
const companyPayments = require('./companyPaymentService');
const subscription = require('./subscriptionService');

const OPERATEURS = ['MTN MoMo', 'Moov Money', 'Celtiis Cash'];
const provider = () => {
  if (config.payment.mode === 'fedapay') return require('../payments/fedapay');
  if (config.payment.mode === 'kkiapay') return require('../payments/kkiapay');
  return null;
};
const info = () => ({ mode: config.payment.mode, requis: config.payment.mode !== 'off', operateurs: config.payment.mode === 'simulation' ? OPERATEURS : [] });

function assertPayable(r) {
  if (r.statut === 'confirmee') throw new AppError(409, 'Cette réservation est déjà payée et confirmée.', 'ALREADY_PAID');
  if (r.statut === 'annulee') throw new AppError(409, 'Cette réservation a expiré ou a été annulée. Veuillez réserver à nouveau.', 'EXPIRED');
}

/**
 * RÉFÉRENCES : un paiement fait avec les clés d'une compagnie est enregistré « <transaction>@<id_compagnie> »
 * (les numéros de transaction de deux comptes FedaPay différents peuvent être identiques). Un paiement sans « @ »
 * est un paiement historique fait avec le compte de la plateforme.
 */
const tag = (ref, companyId) => `${ref}@${companyId}`;
function untag(ref) { const s = String(ref); const i = s.lastIndexOf('@'); return i > 0 ? { raw: s.slice(0, i), companyId: Number(s.slice(i + 1)) } : { raw: s, companyId: null }; }

/** Clés à utiliser pour encaisser un ticket de cette compagnie. */
async function credsForCompany(companyId) {
  const own = await companyPayments.credsFor(companyId);
  if (own) return { creds: own, tagged: true };
  // Compagnie créée par l'administrateur (sans abonnement) : compte de la plateforme, comme avant.
  if (!subscription.stateOf(await db.getCompagnie(companyId)).requis) return { creds: undefined, tagged: false };
  throw new AppError(409, "Cette compagnie n'accepte pas encore les paiements en ligne.", 'PAY_NOT_CONFIGURED');
}
/** Clés à utiliser pour VÉRIFIER un paiement déjà créé. */
async function credsForPayment(payment) {
  const { raw, companyId } = untag(payment.reference_transaction);
  if (companyId == null) return { raw, creds: undefined };
  const own = await companyPayments.credsFor(companyId);
  if (!own) throw new AppError(409, 'Les clés de paiement de la compagnie sont introuvables : paiement à vérifier manuellement.', 'PAY_NOT_CONFIGURED');
  return { raw, creds: own };
}

/** Interroge le prestataire : { statut, montant } (montant = null si le prestataire ne le fournit pas). */
async function providerStatus(p, reference, creds) {
  if (typeof p.getStatusDetail === 'function') return p.getStatusDetail(reference, creds);
  return { statut: await p.getStatus(reference, creds), montant: null };
}

/**
 * Confirme la réservation après un paiement réussi. IDEMPOTENT et protégé par un verrou :
 * le retour du navigateur, le webhook et un double clic peuvent arriver en même temps sans rien confirmer deux fois.
 *  - paiement déjà traité                 -> rien à refaire
 *  - réservation déjà confirmée (doublon) -> l'argent est reçu : signalé « à rembourser » (la base n'accepte qu'UN paiement réussi par
 *                                            réservation : le second reste « en attente » dans la base et c'est le journal d'audit qui le qualifie)
 *  - paiement déjà « échoué » puis approuvé -> la base interdit de rouvrir un paiement échoué : le ticket est délivré (le prestataire vient de
 *                                            confirmer le paiement), l'écart est tracé dans le journal et signalé « à vérifier »
 *  - place prise entre-temps              -> le paiement RESTE « réussi » (l'argent est reçu) et la réservation « annulée » : signalé « à rembourser »
 */
const alreadyLogged = async (action, id) => (await db.listAuditLog({ action, entite: 'paiement', id_entite: id, limit: 1 })).length > 0;

function markPaid(payment, r) {
  return withLock(`resa:${r.id_reservation}`, async () => {
    const cur = (await db.getPaymentByReference(payment.reference_transaction)) || payment;
    const fresh = await db.getReservationById(r.id_reservation);
    if (cur.statut === 'reussi' && fresh.statut === 'confirmee') return { ok: true, deja: true };
    const ctx = { entite: 'paiement', id_entite: cur.id_paiement, id_compagnie: fresh.id_compagnie };
    let ecart = null;   // 'doublon' | 'statut_final' : le paiement n'a pas pu être enregistré « réussi »
    if (cur.statut !== 'reussi') {
      try { await db.updatePayment(cur.id_paiement, { statut: 'reussi' }); }
      catch (e) {
        if (e.code === 'DUPLICATE_PAYMENT') ecart = 'doublon';
        else if (e.code === 'RULE' && cur.statut === 'echoue') ecart = 'statut_final';
        else throw e;
      }
    }
    if (ecart === 'statut_final') {
      if (!(await alreadyLogged('paiement.statut_final', cur.id_paiement))) {
        await audit.log(null, 'paiement.statut_final', { ...ctx, details: `Ticket ${fresh.numero_ticket} : le prestataire confirme un paiement que le site avait enregistré comme échoué (réf. ${cur.reference_transaction}, ${cur.montant_fcfa} FCFA). Ticket délivré, paiement à vérifier.` });
        console.error(`[paiement] ALERTE : ${cur.reference_transaction} confirmé par le prestataire alors qu'il était échoué (ticket ${fresh.numero_ticket}). À vérifier.`);
      }
    }
    if (fresh.statut === 'confirmee') {
      if (!(await alreadyLogged('paiement.doublon', cur.id_paiement))) {
        await audit.log(null, 'paiement.doublon', { ...ctx, details: `Ticket ${fresh.numero_ticket} : ${cur.montant_fcfa} FCFA reçus alors que la réservation était déjà payée (réf. ${cur.reference_transaction}).` });
        console.error(`[paiement] ALERTE doublon : ${cur.reference_transaction} (ticket ${fresh.numero_ticket}). Remboursement à traiter.`);
      }
      return { ok: true, doublon: true };
    }
    try {
      const confirmed = await db.updateReservationStatus(fresh.id_reservation, 'confirmee');
      await audit.log(null, 'paiement.confirme', { ...ctx, details: `Ticket ${fresh.numero_ticket} : ${cur.montant_fcfa} FCFA (${cur.mode}, réf. ${cur.reference_transaction}).` });
      const user = await db.findUserById(fresh.id_utilisateur);
      if (user) email.sendTicketEmail(user.email, confirmed).catch(() => {});
      return { ok: true };
    } catch (e) {
      // SEAT_TAKEN : la place a été reprise. RULE : la base refuse de réactiver la réservation (voyage annulé ou déjà parti, compagnie suspendue...).
      if (e.code === 'SEAT_TAKEN' || e.code === 'RULE') {
        await audit.log(null, 'paiement.place_prise', { ...ctx, details: `Ticket ${fresh.numero_ticket} : paiement reçu mais la réservation ne peut plus être confirmée (${e.code === 'RULE' ? e.message : 'place déjà prise'}). Remboursement à traiter (réf. ${cur.reference_transaction}).` });
        console.error(`[paiement] ALERTE : paiement ${cur.reference_transaction} reçu mais la réservation ne peut plus être confirmée (ticket ${fresh.numero_ticket}). Remboursement à traiter.`);
        return { ok: false, raison: 'place_prise' };
      }
      throw e;
    }
  });
}

/** Mode "fedapay" / "kkiapay" : crée (ou reprend) la transaction et renvoie l'adresse de la page de paiement. */
function initier(user, numero) {
  return (async () => {
    const p = provider();
    if (!p) throw new AppError(400, 'Le paiement en ligne n\'est pas activé.', 'PAY_OFF');
    const first = await reservations.getForUser(user, numero);
    return withLock(`pay:${first.id_reservation}`, async () => {
      const r = await reservations.getForUser(user, numero);
      assertPayable(r);
      // Une transaction est déjà en cours pour cette réservation : on la reprend au lieu d'en créer une deuxième (évite le double paiement).
      const { creds, tagged } = await credsForCompany(r.id_compagnie);
      const open = (await db.listPaymentsByReservation(r.id_reservation)).reverse().find((x) => x.statut === 'en_attente' && x.mode === p.name && (untag(x.reference_transaction).companyId != null) === tagged);
      if (open && typeof p.resumeCheckout === 'function') {
        try { return { url: await p.resumeCheckout(untag(open.reference_transaction).raw, creds) }; } catch (e) { console.warn('[paiement] reprise impossible, nouvelle transaction :', e.message); }
      }
      const { reference, url } = await p.createCheckout({ reservation: r, user, creds, callbackUrl: `${config.baseUrl}/paiement/retour?t=${encodeURIComponent(r.numero_ticket)}` });
      await db.createPayment({ id_reservation: r.id_reservation, montant_fcfa: r.tarif_fcfa, mode: p.name, reference_transaction: tagged ? tag(reference, r.id_compagnie) : reference, statut: 'en_attente' });
      return { url };
    });
  })();
}

/** Mode "simulation" : faux paiement Mobile Money pour la démonstration. AUCUNE vraie transaction : ces paiements ne sont jamais comptés comme argent encaissé. */
function simuler(user, numero, input) {
  return (async () => {
    if (config.payment.mode !== 'simulation') throw new AppError(400, 'Le paiement simulé n\'est pas activé.', 'PAY_OFF');
    const first = await reservations.getForUser(user, numero);
    const operateur = v.reqEnum(input.operateur, "L'opérateur", OPERATEURS);
    v.reqPhone(input.telephone, 'Le numéro Mobile Money');
    return withLock(`pay:${first.id_reservation}`, async () => {
      const r = await reservations.getForUser(user, numero);   // relu sous verrou : un deuxième clic voit « déjà payée »
      assertPayable(r);
      const payment = await db.createPayment({
        id_reservation: r.id_reservation, montant_fcfa: r.tarif_fcfa, mode: `simulation (${operateur})`,
        reference_transaction: `SIM-${crypto.randomBytes(6).toString('hex').toUpperCase()}`, statut: 'en_attente',
      });
      const res = await markPaid(payment, r);
      if (!res.ok) throw new AppError(409, 'Cette place a été attribuée à un autre voyageur. Veuillez réserver à nouveau.', 'SEAT_TAKEN');
      return { numero_ticket: r.numero_ticket };
    });
  })();
}

/**
 * Vérifie TOUJOURS auprès du prestataire (jamais sur la foi du navigateur ni du contenu du webhook) :
 *  - le statut réel de la transaction ;
 *  - le montant réellement payé (un montant différent n'est PAS confirmé : « à vérifier » dans l'administration).
 */
async function settle(p, payment, r) {
  const { raw, creds } = await credsForPayment(payment);
  const d = await providerStatus(p, raw, creds);
  if (d.statut === 'reussi') {
    if (d.montant != null && d.montant !== payment.montant_fcfa) {
      await audit.log(null, 'paiement.anomalie_montant', { entite: 'paiement', id_entite: payment.id_paiement, id_compagnie: r.id_compagnie,
        details: `Ticket ${r.numero_ticket} : montant attendu ${payment.montant_fcfa} FCFA, montant payé ${d.montant} (réf. ${payment.reference_transaction}). Non confirmé : vérification manuelle.` });
      console.error(`[paiement] ALERTE montant : réf. ${payment.reference_transaction} attendu ${payment.montant_fcfa}, payé ${d.montant}. Non confirmé.`);
      return { statut: 'en_attente' };
    }
    const res = await markPaid(payment, r);
    return { statut: res.ok ? 'reussi' : 'place_prise' };
  }
  if (d.statut === 'echoue' && payment.statut === 'en_attente') await db.updatePayment(payment.id_paiement, { statut: 'echoue' });
  return { statut: d.statut };
}

/** Retour du prestataire (redirection du navigateur). */
async function retour(query) {
  const p = provider();
  const reference = String(query.id || '').slice(0, 100);
  if (!p || !reference) throw new AppError(400, 'Retour de paiement invalide.', 'PAY_RETURN');
  let payment, r;
  if (query.t) {
    // Retour d'un paiement récent : le ticket indique la compagnie, donc le bon compte FedaPay et la bonne référence.
    r = await db.getReservationByTicket(String(query.t).slice(0, 40));
    if (!r) throw new AppError(404, 'Transaction inconnue.', 'PAY_RETURN');
    payment = (await db.getPaymentByReference(tag(reference, r.id_compagnie))) || (await db.getPaymentByReference(reference));
    if (!payment || payment.id_reservation !== r.id_reservation) throw new AppError(404, 'Transaction inconnue.', 'PAY_RETURN');
  } else {
    payment = await db.getPaymentByReference(reference);
    if (!payment) throw new AppError(404, 'Transaction inconnue.', 'PAY_RETURN');
    r = await db.getReservationById(payment.id_reservation);
  }
  // Déjà réussi ET ticket délivré : rien à vérifier. Réussi mais ticket non délivré : on termine la confirmation.
  if (payment.statut === 'reussi' && r.statut === 'confirmee') return { numero_ticket: r.numero_ticket, statut: 'reussi' };
  const out = await settle(p, payment, r);
  return { numero_ticket: r.numero_ticket, statut: out.statut };
}

/**
 * Notification serveur à serveur du prestataire (webhook) : confirme le ticket même si le voyageur ferme la page après avoir payé.
 * On ne fait JAMAIS confiance au contenu reçu : on en retire seulement la référence de la transaction, puis on interroge le prestataire.
 */
async function webhook(body, companyId = null) {
  const p = provider();
  const ref = body && (body.entity?.id ?? body['v1/transaction']?.id ?? body.transaction?.id);
  if (!p || ref == null) return { ignore: true };
  const raw = String(ref).slice(0, 100);
  // /paiement/webhook/<id_compagnie> : notification du compte FedaPay d'une compagnie. /paiement/webhook : compte de la plateforme.
  const payment = await db.getPaymentByReference(companyId != null ? tag(raw, companyId) : raw);
  if (!payment) return companyId != null ? { ignore: true } : subscription.webhook(body);
  const r = await db.getReservationById(payment.id_reservation);
  if (payment.statut === 'reussi' && r.statut === 'confirmee') return { ignore: true };
  const out = await settle(p, payment, r);
  return { ok: true, statut: out.statut };
}

module.exports = { info, initier, simuler, retour, webhook, markPaid, OPERATEURS, tag, untag, credsForCompany, credsForPayment };
