'use strict';
const express = require('express');
const { asyncHandler } = require('../utils/errors');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const reservations = require('../services/reservationService');
const catalog = require('../services/catalogService');
const payments = require('../services/paymentService');

const router = express.Router();
router.use(requireAuth);

router.post('/', asyncHandler(async (req, res) => {
  const r = await reservations.reserver(req.user, req.body || {});
  res.status(201).json({ reservation: reservations.presentReservation(r), paiement: payments.info() });
}));

router.get('/moi', asyncHandler(async (req, res) => {
  await catalog.expirePending();
  const list = await db.listReservationsByUser(req.user.id_utilisateur);
  res.json({ reservations: list.map(reservations.presentReservation) });
}));

router.get('/:numero', asyncHandler(async (req, res) => res.json(await reservations.ticketView(req.user, req.params.numero))));

const feedback = require('../services/feedbackService');
router.post('/:numero/avis', asyncHandler(async (req, res) => res.status(201).json(await feedback.noter(req.user, req.params.numero, req.body || {}))));
router.post('/:numero/pourboire/simuler', asyncHandler(async (req, res) => res.json(await feedback.pourboireSimule(req.user, req.params.numero, req.body || {}))));
router.post('/:numero/pourboire/initier', asyncHandler(async (req, res) => res.json(await feedback.pourboireInitier(req.user, req.params.numero, req.body || {}))));

router.post('/:numero/annuler', asyncHandler(async (req, res) => {
  const out = await reservations.annuler(req.user, req.params.numero);
  res.json({ reservation: reservations.presentReservation(out.reservation), remboursement_a_traiter: out.remboursement_a_traiter });
}));

module.exports = router;
