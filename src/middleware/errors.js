'use strict';
const { AppError } = require('../utils/errors');

const DB_MESSAGES = {
  SEAT_TAKEN: [409, 'Cette place vient d’être réservée. Veuillez en choisir une autre.'],
  DUPLICATE_EMAIL: [409, 'Cette adresse e-mail est déjà utilisée.'],
  DUPLICATE_PLATE: [409, 'Cette immatriculation est déjà utilisée.'],
  DUPLICATE_TRAJET: [409, 'Cette compagnie a déjà un trajet entre ces deux villes.'],
  DUPLICATE_PAYMENT: [409, 'Un paiement réussi existe déjà pour cette réservation.'],
  IN_USE: [409, 'Suppression impossible : cet élément est utilisé ailleurs (voyages, réservations...). Vous pouvez le désactiver à la place.'],
};

function notFound(req, res, next) {
  if (req.path.startsWith('/api/')) return next(new AppError(404, 'Ressource introuvable.', 'NOT_FOUND'));

  if (process.env.CLOUDFLARE_WORKERS === '1') {
    const origin = `${req.protocol}://${req.get('host')}`;
    require('../services/cloudflareBindings')
      .getAssetText('/404.html', origin)
      .then((html) => res.status(404).type('html').send(html))
      .catch(next);
    return;
  }

  res.status(404).sendFile(require('node:path').join(__dirname, '..', '..', 'public', '404.html'));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = 500, message = 'Une erreur est survenue sur le serveur. Veuillez réessayer.', code = 'SERVER';
  if (err instanceof AppError) { status = err.status; message = err.message; code = err.code || 'ERROR'; }
  else if (err && err.name === 'DbError' && DB_MESSAGES[err.code]) { [status, message] = DB_MESSAGES[err.code]; code = err.code; }
  // Règle métier appliquée par la base MySQL (triggers, codes 50001 à 50033) : son message est écrit en français pour l'utilisateur.
  else if (err && err.name === 'DbError' && err.code === 'RULE') { status = 409; message = err.message; code = 'RULE'; }
  else if (err && err.type === 'entity.parse.failed') { status = 400; message = 'Requête invalide.'; code = 'BAD_JSON'; }
  else if (err && err.type === 'entity.too.large') { status = 413; message = 'Requête trop volumineuse.'; code = 'TOO_LARGE'; }
  else console.error('[erreur]', req.method, req.originalUrl, err?.stack || err);
  if (res.headersSent) return;
  if (req.path.startsWith('/api/') || req.accepts(['json', 'html']) === 'json') return res.status(status).json({ erreur: message, code });
  res.status(status).type('html').send(`<!doctype html><html lang="fr"><meta charset="utf-8"><title>Erreur</title><body style="font-family:Arial;padding:2rem"><h1>Oups</h1><p>${message.replace(/[<>&]/g, '')}</p><p><a href="/">Retour à l'accueil</a></p></body></html>`);
}
module.exports = { notFound, errorHandler };
