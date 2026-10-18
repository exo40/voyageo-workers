'use strict';
/**
 * GABARIT D'ADAPTATEUR : copiez ce fichier en "custom.js" puis mettez DB_DRIVER=custom dans .env.
 * Remplacez chaque "throw" par votre code (SQL, ORM, MongoDB...).
 * Le comportement attendu de chaque fonction est décrit dans docs/CONTRAT_BASE_DE_DONNEES.md.
 * Le fichier json.js est un exemple complet et fonctionnel.
 */
const { DbError } = require('../errors');
const todo = (name) => async () => { throw new Error(`À implémenter : ${name}`); };

module.exports = {
  // cycle de vie
  init: todo('init'), close: todo('close'), ping: todo('ping'),
  // utilisateurs
  findUserByEmail: todo('findUserByEmail'), findUserById: todo('findUserById'), createUser: todo('createUser'),
  updateUser: todo('updateUser'), listUsers: todo('listUsers'),
  // compagnies
  listCompagnies: todo('listCompagnies'), getCompagnie: todo('getCompagnie'), createCompagnie: todo('createCompagnie'),
  updateCompagnie: todo('updateCompagnie'), deleteCompagnie: todo('deleteCompagnie'),
  // bus
  listBus: todo('listBus'), getBus: todo('getBus'), createBus: todo('createBus'), updateBus: todo('updateBus'), deleteBus: todo('deleteBus'),
  // trajets
  listTrajets: todo('listTrajets'), getTrajet: todo('getTrajet'), createTrajet: todo('createTrajet'),
  updateTrajet: todo('updateTrajet'), deleteTrajet: todo('deleteTrajet'),
  // horaires
  searchHoraires: todo('searchHoraires'), listHoraires: todo('listHoraires'), getHoraire: todo('getHoraire'),
  createHoraire: todo('createHoraire'), updateHoraire: todo('updateHoraire'), deleteHoraire: todo('deleteHoraire'),
  getOccupiedSeats: todo('getOccupiedSeats'),
  // réservations (createReservation doit être ATOMIQUE : voir le contrat)
  createReservation: todo('createReservation'), getReservationByTicket: todo('getReservationByTicket'),
  getReservationById: todo('getReservationById'), listReservationsByUser: todo('listReservationsByUser'),
  listReservations: todo('listReservations'), cancelReservation: todo('cancelReservation'),
  updateReservationStatus: todo('updateReservationStatus'), expirePendingReservations: todo('expirePendingReservations'),
  // paiements
  createPayment: todo('createPayment'), getPaymentByReference: todo('getPaymentByReference'),
  getLatestPaymentByReservation: todo('getLatestPaymentByReservation'), updatePayment: todo('updatePayment'), listPayments: todo('listPayments'),
  // statistiques
  getStats: todo('getStats'),
  DbError, // exemple : throw new DbError('SEAT_TAKEN')
};
