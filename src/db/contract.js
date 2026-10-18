'use strict';
/**
 * CONTRAT DE LA COUCHE BASE DE DONNÉES
 * ------------------------------------
 * Tout adaptateur (json, mysql, custom...) doit exporter TOUTES ces fonctions (async).
 * Le détail des paramètres et des valeurs retournées est dans docs/CONTRAT_BASE_DE_DONNEES.md
 * et dans la fiche technique PDF. La commande "npm run check:db" vérifie ce contrat.
 */
const FUNCTIONS = [
  // Cycle de vie
  'init', 'close', 'ping',
  // Utilisateurs
  'findUserByEmail', 'findUserById', 'createUser', 'updateUser', 'deleteUser', 'listUsers',
  // Compagnies
  'listCompagnies', 'getCompagnie', 'createCompagnie', 'updateCompagnie', 'deleteCompagnie',
  // Bus
  'listBus', 'getBus', 'createBus', 'updateBus', 'deleteBus',
  // Trajets
  'listTrajets', 'getTrajet', 'createTrajet', 'updateTrajet', 'deleteTrajet',
  // Horaires (voyages)
  'searchHoraires', 'listHoraires', 'getHoraire', 'createHoraire', 'updateHoraire', 'deleteHoraire', 'getOccupiedSeats',
  // Réservations
  'createReservation', 'getReservationByTicket', 'getReservationById', 'listReservationsByUser', 'listReservations',
  'cancelReservation', 'updateReservationStatus', 'expirePendingReservations',
  // Paiements
  'createPayment', 'getPaymentByReference', 'getLatestPaymentByReservation', 'updatePayment', 'listPayments', 'listPaymentsByReservation',
  // Abonnement des agences et clés de paiement des compagnies
  'getCompanyPaymentSettings', 'saveCompanyPaymentSettings', 'deleteCompanyPaymentSettings',
  'createSubscriptionPayment', 'getSubscriptionPaymentByReference', 'updateSubscriptionPayment', 'listSubscriptionPayments',
  // Chauffeurs, avis des voyageurs et pourboires
  'listChauffeurs', 'getChauffeur', 'createChauffeur', 'updateChauffeur', 'deleteChauffeur',
  'createAvis', 'getAvisByReservation', 'listAvis', 'createTip', 'getTipByReference', 'updateTip', 'listTips',
  // Journal d'audit (actions sensibles et événements métier)
  'addAuditLog', 'listAuditLog',
  // Statistiques
  'getStats',
];
module.exports = { FUNCTIONS };
