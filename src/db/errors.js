'use strict';
/**
 * Erreur que l'adaptateur de base de données doit lancer dans les cas "normaux" suivants :
 *   SEAT_TAKEN       : la place est déjà réservée pour ce voyage
 *   DUPLICATE_TICKET : le numéro de ticket existe déjà
 *   DUPLICATE_EMAIL  : l'adresse e-mail est déjà utilisée
 *   IN_USE           : suppression impossible, l'élément est utilisé ailleurs (clé étrangère)
 * Toute autre erreur (connexion perdue, SQL incorrect...) doit simplement remonter telle quelle.
 */
class DbError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'DbError';
    this.code = code;
  }
}
module.exports = { DbError };
