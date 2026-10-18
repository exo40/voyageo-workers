'use strict';
const express = require('express');
const config = require('../config');
const { asyncHandler } = require('../utils/errors');
const v = require('../utils/validate');
const catalog = require('../services/catalogService');
const reservations = require('../services/reservationService');
const payments = require('../services/paymentService');

const router = express.Router();

router.get('/config', (req, res) => res.json({
  nom: config.appName, paiement: payments.info(), abonnement: { prix_fcfa: config.subscription.priceFcfa, duree_jours: config.subscription.durationDays }, annulation_heures: config.reservation.annulationHeures,
  attente_minutes: config.reservation.attenteMinutes, utc_offset: config.reservation.utcOffset,
  whatsapp: { numero: config.whatsapp.number, affichage: config.whatsapp.display },
}));
router.get('/villes', asyncHandler(async (req, res) => res.json({ villes: await catalog.villes() })));
router.get('/horaires', asyncHandler(async (req, res) => res.json({ horaires: await catalog.search(req.query) })));
router.get('/horaires/:id', asyncHandler(async (req, res) => res.json(await catalog.horaireDetails(v.reqInt(req.params.id, 'Le voyage', { min: 1 })))));
router.get('/verifier/:numero', asyncHandler(async (req, res) => res.json(await reservations.verify(req.params.numero))));

module.exports = router;
