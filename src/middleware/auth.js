'use strict';
const db = require('../db');
const { AppError } = require('../utils/errors');
const { publicUser } = require('../services/authService');

/** Charge l'utilisateur connecté (à partir de la session) dans req.user. Vérifie à chaque requête que le compte est toujours actif. */
async function loadUser(req, res, next) {
  try {
    req.user = null;
    const uid = req.session && req.session.uid;
    if (uid) {
      const u = await db.findUserById(uid);
      if (u && u.statut === 'actif') req.user = publicUser(u);
      else delete req.session.uid;
    }
    next();
  } catch (e) { next(e); }
}
const requireAuth = (req, res, next) => (req.user ? next() : next(new AppError(401, 'Veuillez vous connecter pour continuer.', 'AUTH_REQUIRED')));
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return next(new AppError(401, 'Veuillez vous connecter pour continuer.', 'AUTH_REQUIRED'));
  if (!roles.includes(req.user.role)) return next(new AppError(403, "Vous n'avez pas le droit d'effectuer cette action.", 'FORBIDDEN'));
  next();
};
/** Pour les pages HTML protégées : redirige vers la connexion. */
const requirePageRole = (...roles) => (req, res, next) => {
  if (req.user && roles.includes(req.user.role)) return next();
  res.redirect(`/connexion.html?suite=${encodeURIComponent(req.originalUrl)}`);
};
/** Démarre une session sûre après connexion (nouvel identifiant de session). */
function startSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.uid = user.id_utilisateur;
      resolve();
    });
  });
}
module.exports = { loadUser, requireAuth, requireRole, requirePageRole, startSession };
