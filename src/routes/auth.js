'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { asyncHandler } = require('../utils/errors');
const auth = require('../services/authService');
const { requireAuth, startSession } = require('../middleware/auth');
const { tokenFor } = require('../middleware/csrf');

const router = express.Router();
const limiter = config.isProd
  ? rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { erreur: 'Trop de tentatives. Réessayez dans quelques minutes.', code: 'RATE_LIMIT' } })
  : (req, res, next) => next();

router.get('/moi', (req, res) => res.json({ user: req.user || null }));

router.post('/inscription', limiter, asyncHandler(async (req, res) => {
  if (config.codes.verifyEmail) {
    const out = await auth.startRegistration(req.body || {});
    return res.status(202).json({ verification: true, ...out });
  }
  const user = await auth.register(req.body || {});
  await startSession(req, user);
  res.status(201).json({ user, csrf: tokenFor(req) });
}));

router.post('/inscription/verifier', limiter, asyncHandler(async (req, res) => {
  const user = await auth.confirmRegistration((req.body || {}).email, (req.body || {}).code);
  await startSession(req, user);
  res.status(201).json({ user, csrf: tokenFor(req) });
}));
router.post('/inscription/renvoyer', limiter, asyncHandler(async (req, res) => res.json(await auth.resendRegistration((req.body || {}).email))));
router.post('/mot-de-passe-oublie', limiter, asyncHandler(async (req, res) => res.json(await auth.forgotPassword((req.body || {}).email))));
router.post('/mot-de-passe-oublie/reinitialiser', limiter, asyncHandler(async (req, res) => {
  const b = req.body || {};
  res.json(await auth.resetPassword(b.email, b.code, b.nouveau));
}));

router.post('/connexion', limiter, asyncHandler(async (req, res) => {
  const user = await auth.login((req.body || {}).email, (req.body || {}).mot_de_passe, (req.body || {}).consentement === true);
  await startSession(req, user);
  res.json({ user, csrf: tokenFor(req) });
}));

router.post('/deconnexion', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('voyageo.sid');
    res.json({ ok: true });
  });
});

router.post('/mot-de-passe', requireAuth, asyncHandler(async (req, res) => {
  await auth.changePassword(req.user.id_utilisateur, (req.body || {}).actuel, (req.body || {}).nouveau);
  res.json({ ok: true });
}));

module.exports = router;
