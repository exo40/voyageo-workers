'use strict';
const config = require('../config');
const db = require('../db');
const { AppError } = require('../utils/errors');
const v = require('../utils/validate');
const { todayStr, departureTime } = require('../utils/time');
const subscription = require('./subscriptionService');

const DEFAULT_VILLES = ['Abomey-Calavi', 'Bohicon', 'Cotonou', 'Parakou', 'Porto-Novo'];

async function villes() {
  const set = new Map();
  for (const name of DEFAULT_VILLES) set.set(v.normCity(name), name);
  for (const t of await db.listTrajets({})) {
    for (const name of [t.ville_depart, t.ville_arrivee]) if (!set.has(v.normCity(name))) set.set(v.normCity(name), name);
  }
  return [...set.values()].sort((a, b) => a.localeCompare(b, 'fr'));
}
async function canonicalCity(input, label) {
  const raw = v.reqStr(input, label, { max: 80 });
  const key = v.normCity(raw);
  for (const name of await villes()) if (v.normCity(name) === key) return name;
  return raw;
}

const closed = (h) => departureTime(h.date_depart, h.heure_depart) - config.reservation.clotureMinutes * 60000 < Date.now();

/**
 * Une compagnie ne vend des tickets que si : elle est active, son abonnement est valide (agences inscrites),
 * et, pour le paiement en ligne FedaPay, elle a enregistré ses propres clés (pour que l'argent aille chez elle).
 */
function isSellable(h) {
  if (h.compagnie_statut === 'inactive') return false;
  const st = subscription.stateOfView(h);
  if (!st.actif) return false;
  if (config.payment.mode === 'fedapay' && st.requis && !h.compagnie_paiement_configure) return false;
  return true;
}

function present(h) {
  return {
    id_horaire: h.id_horaire, id_trajet: h.id_trajet, ville_depart: h.ville_depart, ville_arrivee: h.ville_arrivee,
    date_depart: h.date_depart, heure_depart: h.heure_depart, heure_arrivee: h.heure_arrivee, duree_estimee: h.duree_estimee,
    lieu_embarquement: h.lieu_embarquement ?? null, lien_maps: h.lien_maps ?? null,
    tarif_fcfa: h.tarif_fcfa, statut: h.statut, id_compagnie: h.id_compagnie, compagnie_nom: h.compagnie_nom,
    photo_bus: h.photo_bus || h.bus_photo || null,
    chauffeur_prenom: h.chauffeur_prenom ?? null, chauffeur_photo: h.chauffeur_photo ?? null,
    chauffeur_note: h.chauffeur_note ?? null, chauffeur_nb_avis: h.chauffeur_nb_avis ?? 0,
    nombre_places: h.nombre_places, places_restantes: Math.max(0, h.nombre_places - h.places_occupees),
    reservable: h.statut === 'programme' && isSellable(h) && !closed(h) && h.nombre_places - h.places_occupees > 0,
  };
}

async function expirePending() {
  const cutoff = new Date(Date.now() - config.reservation.attenteMinutes * 60000).toISOString();
  return db.expirePendingReservations(cutoff);
}

async function search(query) {
  const ville_depart = await canonicalCity(query.depart, 'La ville de départ');
  const ville_arrivee = await canonicalCity(query.arrivee, 'La destination');
  if (v.normCity(ville_depart) === v.normCity(ville_arrivee)) throw new AppError(400, 'Choisissez deux villes différentes.', 'VALIDATION');
  const date = v.reqDate(query.date, 'La date');
  if (date < todayStr()) throw new AppError(400, 'Cette date est déjà passée.', 'VALIDATION');
  await expirePending();
  const list = await db.searchHoraires({ ville_depart, ville_arrivee, date });
  // Une compagnie désactivée par l'administration ne vend plus de tickets : ses voyages n'apparaissent plus.
  return list.filter(isSellable).map(present);
}

async function horaireDetails(id) {
  await expirePending();
  const h = await db.getHoraire(id);
  if (!h) throw new AppError(404, 'Voyage introuvable.', 'NOT_FOUND');
  return { horaire: present(h), places_occupees: await db.getOccupiedSeats(id) };
}

module.exports = { isSellable, villes, search, horaireDetails, present, expirePending, closed, DEFAULT_VILLES };
