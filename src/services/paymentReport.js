'use strict';
/**
 * RAPPORT DES PAIEMENTS : qualifie chaque transaction à partir des données réelles.
 *
 *  etat        signification
 *  ----------  ------------------------------------------------------------------------------
 *  confirme    paiement réel confirmé par le prestataire (argent encaissé)
 *  simule      paiement de démonstration (aucune vraie transaction)
 *  en_attente  transaction récente, le prestataire n'a pas encore confirmé
 *  a_verifier  transaction en attente depuis trop longtemps : à vérifier chez le prestataire
 *  echoue      refusée, annulée ou expirée
 *  a_rembourser  argent reçu mais ticket non délivré (réservation annulée, place prise, doublon)
 *  rembourse   remboursement déjà effectué (marqué par un administrateur)
 *
 * Avec MySQL, la base n'accepte qu'UN paiement « réussi » par réservation et ne rouvre jamais un paiement « échoué » :
 * un doublon reste « en attente » et un paiement confirmé après un échec reste « échoué ». C'est le journal d'audit
 * (paiement.doublon, paiement.statut_final) qui les qualifie ici, de la même façon quel que soit le moteur de base.
 */
const db = require('../db');

const STALE_MINUTES = 30;
const isSimulated = (p) => String(p.mode || '').startsWith('simulation');

async function enrichedPayments({ id_compagnie = null } = {}) {
  const [pays, resas, refunds, dupLog, finalLog] = await Promise.all([
    db.listPayments({ id_compagnie }),
    db.listReservations({ id_compagnie, limit: 100000 }),
    db.listAuditLog({ action: 'paiement.rembourse', id_compagnie, limit: 100000 }),
    db.listAuditLog({ action: 'paiement.doublon', id_compagnie, limit: 100000 }),
    db.listAuditLog({ action: 'paiement.statut_final', id_compagnie, limit: 100000 }),
  ]);
  const dupes = new Set(dupLog.map((e) => e.id_entite));
  const finals = new Set(finalLog.map((e) => e.id_entite));
  const byTicket = new Map(resas.map((r) => [r.numero_ticket, r]));
  const refunded = new Set(refunds.map((e) => e.id_entite));
  // Premier paiement réussi de chaque réservation : les suivants sont des doublons (le client a payé deux fois).
  const firstOk = new Map();
  for (const p of [...pays].sort((a, b) => a.id_paiement - b.id_paiement)) if (p.statut === 'reussi' && !firstOk.has(p.id_reservation)) firstOk.set(p.id_reservation, p.id_paiement);
  const now = Date.now();
  const rows = pays.map((p) => {
    const r = byTicket.get(p.numero_ticket) || null;
    const simule = isSimulated(p);
    const doublon = (p.statut === 'reussi' && firstOk.get(p.id_reservation) !== p.id_paiement) || (p.statut !== 'reussi' && dupes.has(p.id_paiement));
    const motif = doublon ? 'doublon' : (p.statut === 'reussi' && r && r.statut === 'annulee' ? 'reservation_annulee' : null);
    const rembourse = refunded.has(p.id_paiement);
    let etat;
    if (p.statut === 'echoue' && finals.has(p.id_paiement)) etat = 'a_verifier';   // confirmé par le prestataire après un échec : ticket délivré, paiement à vérifier
    else if (p.statut === 'echoue') etat = 'echoue';
    else if (p.statut === 'en_attente' && dupes.has(p.id_paiement)) etat = rembourse ? 'rembourse' : (simule ? 'simule' : 'a_rembourser');
    else if (p.statut === 'en_attente') etat = now - Date.parse(p.date_paiement) > STALE_MINUTES * 60000 ? 'a_verifier' : 'en_attente';
    else if (rembourse) etat = 'rembourse';
    else if (motif && !simule) etat = 'a_rembourser';
    else etat = simule ? 'simule' : 'confirme';
    return { ...p, simule, etat, motif_remboursement: motif, statut_reservation: r ? r.statut : null, passager: r ? `${r.prenom_passager} ${r.nom_passager}` : null };
  });
  return { rows, reservations: resas };
}

module.exports = { enrichedPayments, isSimulated, STALE_MINUTES };
