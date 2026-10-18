'use strict';
const crypto = require('node:crypto');
const config = require('../config');
const db = require('../db');
const { AppError } = require('../utils/errors');
const v = require('../utils/validate');
const { todayStr, departureTime } = require('../utils/time');
const catalog = require('./catalogService');
const email = require('./emailService');
const audit = require('./auditService');

const isStaffOf = (user, r) => user.role === 'admin' || (user.role === 'gestionnaire' && user.id_compagnie != null && user.id_compagnie === r.id_compagnie);
const canSee = (user, r) => r.id_utilisateur === user.id_utilisateur || isStaffOf(user, r);

const newTicketNumber = () => `VYG-${todayStr().slice(0, 4)}-${String(crypto.randomInt(0, 1000000)).padStart(6, '0')}`;

async function reserver(user, input) {
  const id_horaire = v.reqInt(input.id_horaire, 'Le voyage', { min: 1 });
  const numero_place = v.reqInt(input.numero_place, 'La place', { min: 1, max: 200 });
  const nom_passager = v.reqStr(input.nom, 'Le nom du passager', { max: 100 });
  const prenom_passager = v.reqStr(input.prenom, 'Le prénom du passager', { max: 100 });
  const telephone_passager = v.reqPhone(input.telephone, 'Le téléphone du passager');
  const piece_identite = v.optStr(input.piece_identite, "Le numéro de pièce d'identité", { max: 60 });

  await catalog.expirePending();
  const h = await db.getHoraire(id_horaire);
  if (!h) throw new AppError(404, 'Voyage introuvable.', 'NOT_FOUND');
  if (h.statut !== 'programme' || !catalog.isSellable(h)) throw new AppError(409, "Ce voyage n'est plus disponible.", 'UNAVAILABLE');
  if (catalog.closed(h)) throw new AppError(409, 'Les réservations pour ce voyage sont closes.', 'CLOSED');
  if (numero_place > h.nombre_places) throw new AppError(400, "Cette place n'existe pas dans ce bus.", 'VALIDATION');

  const statut = config.payment.mode === 'off' ? 'confirmee' : 'en_attente';
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const r = await db.createReservation({
        numero_ticket: newTicketNumber(), id_utilisateur: user.id_utilisateur, id_horaire, numero_place,
        nom_passager, prenom_passager, telephone_passager, piece_identite, statut,
      });
      if (statut === 'confirmee') email.sendTicketEmail(user.email, r).catch(() => {});
      await audit.log(user, 'reservation.creee', { entite: 'reservation', id_entite: r.id_reservation, id_compagnie: h.id_compagnie, details: `Ticket ${r.numero_ticket}, place ${numero_place}, ${h.ville_depart} – ${h.ville_arrivee} le ${h.date_depart} à ${h.heure_depart} (${statut === 'confirmee' ? 'confirmée' : 'en attente de paiement'}).` });
      return r;
    } catch (e) {
      if (e.code === 'DUPLICATE_TICKET') continue;
      if (e.code === 'SEAT_TAKEN') throw new AppError(409, 'Cette place vient d’être réservée. Veuillez en choisir une autre.', 'SEAT_TAKEN');
      throw e;
    }
  }
  throw new AppError(500, 'Impossible de générer un numéro de ticket. Réessayez.', 'TICKET');
}

/** Retourne la réservation si l'utilisateur a le droit de la voir, sinon 404 (on ne révèle pas son existence). */
async function getForUser(user, numero) {
  const r = await db.getReservationByTicket(String(numero || ''));
  if (!r || !canSee(user, r)) throw new AppError(404, 'Ticket introuvable.', 'NOT_FOUND');
  return r;
}

async function annuler(user, numero) {
  await catalog.expirePending();
  const r = await getForUser(user, numero);
  if (r.statut === 'annulee') throw new AppError(409, 'Cette réservation est déjà annulée.', 'ALREADY');
  if (!isStaffOf(user, r)) {
    const limite = departureTime(r.date_depart, r.heure_depart) - config.reservation.annulationHeures * 3600000;
    if (Date.now() > limite) throw new AppError(409, `L'annulation n'est possible que jusqu'à ${config.reservation.annulationHeures} h avant le départ.`, 'TOO_LATE');
  }
  const pay = await db.getLatestPaymentByReservation(r.id_reservation);
  const updated = await db.cancelReservation(r.id_reservation);
  const refund = !!(pay && pay.statut === 'reussi');
  await audit.log(user, 'reservation.annulee', { entite: 'reservation', id_entite: r.id_reservation, id_compagnie: r.id_compagnie, details: `Ticket ${r.numero_ticket} annulé ${isStaffOf(user, r) ? 'par le personnel' : 'par le voyageur'}${refund ? ' : remboursement à traiter' : ''}.` });
  return { reservation: updated, remboursement_a_traiter: refund };
}

async function qrDataUrl(numero) {
  const QRCode = require('qrcode');
  const url = `${config.baseUrl}/verifier.html?n=${encodeURIComponent(numero)}`;
  return QRCode.toDataURL(url, { margin: 1, width: 280, errorCorrectionLevel: 'M', color: { dark: '#1F3A5F', light: '#FFFFFF' } });
}

const presentReservation = (r) => ({
  id_reservation: r.id_reservation, id_horaire: r.id_horaire, numero_ticket: r.numero_ticket, statut: r.statut, numero_place: r.numero_place,
  nom_passager: r.nom_passager, prenom_passager: r.prenom_passager, telephone_passager: r.telephone_passager, piece_identite: r.piece_identite,
  ville_depart: r.ville_depart, ville_arrivee: r.ville_arrivee, date_depart: r.date_depart, heure_depart: r.heure_depart, heure_arrivee: r.heure_arrivee,
  lieu_embarquement: r.lieu_embarquement ?? null, lien_maps: r.lien_maps ?? null,
  tarif_fcfa: r.tarif_fcfa, compagnie_nom: r.compagnie_nom, date_reservation: r.date_reservation, statut_horaire: r.statut_horaire,
  photo_bus: r.photo_bus || r.bus_photo || null,
  chauffeur_prenom: r.chauffeur_prenom ?? null, chauffeur_photo: r.chauffeur_photo ?? null, chauffeur_note: r.chauffeur_note ?? null, chauffeur_nb_avis: r.chauffeur_nb_avis ?? 0,
  utilisateur_email: r.utilisateur_email, utilisateur_nom: r.utilisateur_nom,
});

/** Le voyage est-il terminé ? (heure d'arrivée passée ; à défaut 4 h après le départ ; ou voyage marqué « terminé ») */
function tripEnded(r) {
  if (r.statut_horaire === 'termine') return true;
  const start = departureTime(r.date_depart, r.heure_depart);
  let end = start + 4 * 3600000;
  if (r.heure_arrivee) { end = departureTime(r.date_depart, r.heure_arrivee); if (end <= start) end += 86400000; }
  return Date.now() >= end;
}
/** Avis et pourboire : seulement pour une réservation payée (confirmée), d'un voyage terminé et non annulé, qui a un chauffeur. */
const canFeedback = (r) => r.statut === 'confirmee' && r.statut_horaire !== 'annule' && r.id_chauffeur != null && tripEnded(r);

async function ticketView(user, numero) {
  const r = await getForUser(user, numero);
  const pay = await db.getLatestPaymentByReservation(r.id_reservation);
  const limite = departureTime(r.date_depart, r.heure_depart) - config.reservation.annulationHeures * 3600000;
  return {
    reservation: presentReservation(r),
    ticket_disponible: r.statut === 'confirmee',
    qr: r.statut === 'confirmee' ? await qrDataUrl(r.numero_ticket) : null,
    paiement: pay ? { mode: pay.mode, statut: pay.statut } : null,
    annulable: r.statut !== 'annulee' && Date.now() <= limite,
    annulation_heures: config.reservation.annulationHeures,
    retour: await feedbackView(user, r),
  };
}
async function feedbackView(user, r) {
  const mine = r.id_utilisateur === user.id_utilisateur;
  const possible = mine && canFeedback(r);
  if (!possible) return { possible: false, chauffeur_present: r.id_chauffeur != null };
  const [avis, tips] = await Promise.all([db.getAvisByReservation(r.id_reservation), db.listTips({ id_reservation: r.id_reservation })]);
  return {
    possible: true,
    avis: avis ? { note: avis.note, commentaire: avis.commentaire } : null,
    pourboire_disponible: ['simulation', 'fedapay'].includes(config.payment.mode),
    pourboires_recus_fcfa: tips.filter((t) => t.statut === 'reussi').reduce((s, t) => s + t.montant_fcfa, 0),
    montants: config.tips.suggestions, min: config.tips.min, max: config.tips.max,
  };
}

/** Vérification publique (lien du QR code) : aucune donnée personnelle complète. */
async function verify(numero) {
  const r = await db.getReservationByTicket(String(numero || '').trim().toUpperCase());
  if (!r) return { valide: false };
  const initiale = (r.nom_passager || '').slice(0, 1).toUpperCase();
  const depart = departureTime(r.date_depart, r.heure_depart);
  return {
    valide: r.statut === 'confirmee' && r.statut_horaire !== 'annule',
    statut: r.statut, numero_ticket: r.numero_ticket, ville_depart: r.ville_depart, ville_arrivee: r.ville_arrivee,
    date_depart: r.date_depart, heure_depart: r.heure_depart, numero_place: r.numero_place, compagnie_nom: r.compagnie_nom,
    passager: `${r.prenom_passager} ${initiale}.`, passe: depart < Date.now(),
  };
}

module.exports = { canFeedback, tripEnded, reserver, getForUser, annuler, ticketView, verify, presentReservation, isStaffOf, canSee };
