'use strict';
/**
 * APRÈS LE VOYAGE : le voyageur peut noter le chauffeur (1 à 5 étoiles, un seul avis par réservation)
 * et lui laisser un pourboire. Les pourboires sont payés comme les tickets : avec le compte FedaPay de la compagnie
 * (ou en simulation en mode démonstration) ; le statut est toujours revérifié auprès du prestataire.
 */
const crypto = require('node:crypto');
const config = require('../config');
const db = require('../db');
const { AppError } = require('../utils/errors');
const v = require('../utils/validate');
const reservations = require('./reservationService');
const payments = require('./paymentService');
const audit = require('./auditService');

/** Réservation du voyageur connecté (le personnel de la compagnie ne note pas à la place des voyageurs). */
async function eligible(user, numero) {
  const r = await reservations.getForUser(user, numero);
  if (r.id_utilisateur !== user.id_utilisateur) throw new AppError(403, 'Seul le voyageur peut noter ce voyage.', 'FORBIDDEN');
  if (r.statut !== 'confirmee') throw new AppError(409, 'Seule une réservation payée et confirmée peut être notée.', 'NOT_ELIGIBLE');
  if (r.id_chauffeur == null) throw new AppError(409, "Aucun chauffeur n'est renseigné pour ce voyage.", 'NOT_ELIGIBLE');
  if (!reservations.canFeedback(r)) throw new AppError(409, 'Vous pourrez noter le chauffeur et laisser un pourboire une fois le voyage terminé.', 'NOT_ENDED');
  return r;
}

async function noter(user, numero, input) {
  const r = await eligible(user, numero);
  const note = v.reqInt(input.note, 'La note', { min: 1, max: 5 });
  const commentaire = v.optStr(input.commentaire, 'Le commentaire', { max: 300 });
  try {
    const a = await db.createAvis({ id_reservation: r.id_reservation, id_horaire: r.id_horaire, id_chauffeur: r.id_chauffeur, id_utilisateur: user.id_utilisateur, note, commentaire });
    await audit.log(user, 'avis.cree', { entite: 'avis', id_entite: a.id_avis, id_compagnie: r.id_compagnie, details: `Chauffeur ${r.chauffeur_prenom} noté ${note}/5 (ticket ${r.numero_ticket}).` });
    return { avis: { note: a.note, commentaire: a.commentaire } };
  } catch (e) {
    if (e.code === 'DUPLICATE_AVIS') throw new AppError(409, 'Vous avez déjà noté ce voyage.', 'ALREADY');
    throw e;
  }
}

function amountOf(input) { return v.reqInt(input.montant, 'Le montant du pourboire', { min: config.tips.min, max: config.tips.max }); }

/** Simulation (démonstration) : aucun argent n'est débité. */
async function pourboireSimule(user, numero, input) {
  if (config.payment.mode !== 'simulation') throw new AppError(400, "Le paiement simulé n'est pas activé.", 'PAY_OFF');
  const r = await eligible(user, numero);
  const montant = amountOf(input);
  v.reqEnum(input.operateur, "L'opérateur", payments.OPERATEURS);
  v.reqPhone(input.telephone, 'Le numéro Mobile Money');
  const tip = await db.createTip({ id_reservation: r.id_reservation, id_chauffeur: r.id_chauffeur, montant_fcfa: montant, mode: 'simulation', reference_transaction: `SIM-TIP-${crypto.randomBytes(6).toString('hex').toUpperCase()}`, statut: 'reussi' });
  await audit.log(user, 'pourboire.recu', { entite: 'pourboire', id_entite: tip.id_pourboire, id_compagnie: r.id_compagnie, details: `Pourboire simulé de ${montant} FCFA pour ${r.chauffeur_prenom} (ticket ${r.numero_ticket}).` });
  return { ok: true };
}

/** FedaPay : crée la transaction (sur le compte de la compagnie) et renvoie l'adresse de la page de paiement. */
async function pourboireInitier(user, numero, input) {
  if (config.payment.mode !== 'fedapay') throw new AppError(400, "Le pourboire en ligne n'est pas activé.", 'PAY_OFF');
  const r = await eligible(user, numero);
  const montant = amountOf(input);
  const p = require('../payments/fedapay');
  const { creds, tagged } = await payments.credsForCompany(r.id_compagnie);
  const { reference, url } = await p.createCheckout({
    reservation: r, user, creds, amount: montant, description: `Pourboire chauffeur ${r.chauffeur_prenom} (ticket ${r.numero_ticket})`,
    callbackUrl: `${config.baseUrl}/pourboire/retour?t=${encodeURIComponent(r.numero_ticket)}`,
  });
  await db.createTip({ id_reservation: r.id_reservation, id_chauffeur: r.id_chauffeur, montant_fcfa: montant, mode: p.name, reference_transaction: tagged ? payments.tag(reference, r.id_compagnie) : reference, statut: 'en_attente' });
  return { url };
}

/** Retour de FedaPay : on interroge TOUJOURS le prestataire (statut et montant) avant de compter le pourboire. */
async function pourboireRetour(query) {
  const reference = String(query.id || '').slice(0, 100);
  if (config.payment.mode !== 'fedapay' || !reference || !query.t) throw new AppError(400, 'Retour de paiement invalide.', 'PAY_RETURN');
  const r = await db.getReservationByTicket(String(query.t).slice(0, 40));
  if (!r) throw new AppError(404, 'Transaction inconnue.', 'PAY_RETURN');
  const tip = (await db.getTipByReference(payments.tag(reference, r.id_compagnie))) || (await db.getTipByReference(reference));
  if (!tip || tip.id_reservation !== r.id_reservation) throw new AppError(404, 'Transaction inconnue.', 'PAY_RETURN');
  if (tip.statut === 'reussi') return { numero_ticket: r.numero_ticket, statut: 'reussi' };
  const p = require('../payments/fedapay');
  const { raw, creds } = await payments.credsForPayment(tip);
  const d = await p.getStatusDetail(raw, creds);
  if (d.statut === 'reussi' && (d.montant == null || d.montant === tip.montant_fcfa)) {
    await db.updateTip(tip.id_pourboire, { statut: 'reussi' });
    await audit.log(null, 'pourboire.recu', { entite: 'pourboire', id_entite: tip.id_pourboire, id_compagnie: r.id_compagnie, details: `Pourboire de ${tip.montant_fcfa} FCFA pour le chauffeur (ticket ${r.numero_ticket}, réf. ${tip.reference_transaction}).` });
    return { numero_ticket: r.numero_ticket, statut: 'reussi' };
  }
  if (d.statut === 'echoue') await db.updateTip(tip.id_pourboire, { statut: 'echoue' });
  return { numero_ticket: r.numero_ticket, statut: d.statut === 'echoue' ? 'echoue' : 'en_attente' };
}

module.exports = { noter, pourboireSimule, pourboireInitier, pourboireRetour };
