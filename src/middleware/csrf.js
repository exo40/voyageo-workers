'use strict';
const crypto = require('node:crypto');
const { AppError } = require('../utils/errors');

/** Jeton anti-CSRF : lié à la session, à renvoyer dans l'en-tête X-CSRF-Token pour toute requête qui modifie des données. */
function tokenFor(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  return req.session.csrf;
}
function protect(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = String(req.get('x-csrf-token') || '');
  const expected = req.session && req.session.csrf ? req.session.csrf : '';
  const a = Buffer.from(sent), b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return next(new AppError(403, 'Session expirée ou requête non autorisée. Rechargez la page et réessayez.', 'CSRF'));
  }
  next();
}
module.exports = { tokenFor, protect };
