'use strict';
const express = require('express');
const { asyncHandler } = require('../utils/errors');
const { requireAuth } = require('../middleware/auth');
const payments = require('../services/paymentService');
const subscription = require('../services/subscriptionService');

const router = express.Router();
router.post('/initier', requireAuth, asyncHandler(async (req, res) => res.json(await payments.initier(req.user, (req.body || {}).numero_ticket))));
router.post('/simuler', requireAuth, asyncHandler(async (req, res) => res.json(await payments.simuler(req.user, (req.body || {}).numero_ticket, req.body || {}))));

/** Page de retour (redirection du prestataire de paiement). Montée dans app.js sur /paiement/retour. */
const retour = asyncHandler(async (req, res) => {
  const out = await payments.retour(req.query);
  const n = encodeURIComponent(out.numero_ticket);
  if (out.statut === 'reussi') return res.redirect(`/ticket.html?n=${n}&paiement=ok`);
  if (out.statut === 'place_prise') return res.redirect(`/ticket.html?n=${n}&paiement=place`);
  // Paiement non effectué ou non confirmé : pas de ticket, retour à la page de paiement.
  res.redirect(`/paiement.html?n=${n}&paiement=${out.statut === 'echoue' ? 'echec' : 'attente'}`);
});

/** Webhook FedaPay (POST /paiement/webhook). Hors de /api : pas de jeton CSRF, mais le statut est TOUJOURS revérifié auprès de FedaPay. */
const webhook = asyncHandler(async (req, res) => {
  try { await payments.webhook(req.body || {}); } catch (e) { console.error('[webhook] erreur :', e.message); return res.status(500).json({ ok: false }); }
  res.json({ ok: true });
});

/** Webhook du compte FedaPay d'une compagnie : POST /paiement/webhook/:cid */
const webhookCompany = asyncHandler(async (req, res) => {
  const cid = Number(req.params.cid);
  if (!Number.isInteger(cid) || cid < 1) return res.status(404).json({ ok: false });
  try { await payments.webhook(req.body || {}, cid); } catch (e) { console.error('[webhook compagnie] erreur :', e.message); return res.status(500).json({ ok: false }); }
  res.json({ ok: true });
});

/** Retour après paiement de l'abonnement : GET /abonnement/retour?c=<compagnie>&id=<transaction> */
const abonnementRetour = asyncHandler(async (req, res) => {
  let statut = 'attente';
  try { statut = (await subscription.retour(req.query)).statut; } catch (e) { console.error('[abonnement] retour :', e.message); statut = 'erreur'; }
  const flag = statut === 'reussi' ? 'ok' : statut === 'echoue' ? 'echec' : 'attente';
  res.redirect(`/admin#/abonnement?paiement=${flag}`);
});

/** Retour après paiement d'un pourboire : GET /pourboire/retour?t=<ticket>&id=<transaction> */
const pourboireRetour = asyncHandler(async (req, res) => {
  let out = { numero_ticket: String(req.query.t || ''), statut: 'attente' };
  try { out = await require('../services/feedbackService').pourboireRetour(req.query); } catch (e) { console.error('[pourboire] retour :', e.message); out.statut = 'erreur'; }
  const flag = out.statut === 'reussi' ? 'ok' : out.statut === 'echoue' ? 'echec' : 'attente';
  res.redirect(`/ticket.html?n=${encodeURIComponent(out.numero_ticket)}&pourboire=${flag}`);
});

module.exports = { router, retour, webhook, webhookCompany, abonnementRetour, pourboireRetour };
