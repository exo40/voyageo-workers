'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { asyncHandler } = require('../utils/errors');
const bot = require('../services/botService');

const router = express.Router();
const limiter = config.isProd
  ? rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { erreur: 'Vous écrivez trop vite. Patientez une minute.', code: 'RATE_LIMIT' } })
  : (req, res, next) => next();

router.post('/', limiter, asyncHandler(async (req, res) => {
  res.json(await bot.reply((req.body || {}).message));
}));

module.exports = router;
