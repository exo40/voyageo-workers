'use strict';
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const MySQLSessionStore = require('./services/mysqlSessionStore');
const config = require('./config');
const { loadUser, requirePageRole } = require('./middleware/auth');
const csrf = require('./middleware/csrf');
const { notFound, errorHandler } = require('./middleware/errors');
const payments = require('./routes/payments');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  // En-têtes de sécurité + Content-Security-Policy (aucun script ni style "inline" autorisé)
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
  }));

  // Corps JSON limité à 50 Ko, sauf l'envoi de photos (route qui fixe sa propre limite).
  const smallJson = express.json({ limit: '50kb' });
  app.use((req, res, next) => (req.path === '/api/admin/upload' ? next() : smallJson(req, res, next)));
  const sessionStore = config.db.driver === 'mysql' ? new MySQLSessionStore() : undefined;
  app.use(session({
    name: 'voyageo.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    ...(sessionStore ? { store: sessionStore } : {}),
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd ? 'auto' : false, maxAge: 7 * 24 * 3600 * 1000 },
  }));
  app.use(loadUser);

  // En local, Express sert les fichiers depuis le disque.
  // Sur Cloudflare, les assets publics sont servis par le Worker et les photos par R2.
  if (process.env.CLOUDFLARE_WORKERS !== '1') {
    app.use('/vendor/bootstrap', express.static(path.join(config.root, 'node_modules', 'bootstrap', 'dist'), { maxAge: config.isProd ? '7d' : 0 }));
    app.use(express.static(path.join(config.root, 'public'), { maxAge: config.isProd ? '1h' : 0, extensions: ['html'] }));
    app.use('/uploads', express.static(require('./services/uploadService').DIR, { maxAge: config.isProd ? '7d' : 0, index: false }));
  }

  // API
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/api/csrf', (req, res) => res.json({ csrf: csrf.tokenFor(req) }));
  app.use('/api', csrf.protect);
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/reservations', require('./routes/reservations'));
  app.use('/api/paiements', payments.router);
  app.use('/api/bot', require('./routes/bot'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api', require('./routes/public'));

  // Pages spéciales
  app.get('/paiement/retour', payments.retour);
  app.post('/paiement/webhook', payments.webhook);
  app.post('/paiement/webhook/:cid', payments.webhookCompany);
  app.get('/abonnement/retour', payments.abonnementRetour);
  app.get('/pourboire/retour', payments.pourboireRetour);
  app.get(['/admin', '/admin.html'], requirePageRole('admin', 'gestionnaire'), (req, res, next) => {
    res.set('Cache-Control', 'no-store');

    if (process.env.CLOUDFLARE_WORKERS === '1') {
      const origin = `${req.protocol}://${req.get('host')}`;
      require('./services/cloudflareBindings')
        .getAssetText('/_internal/admin.html', origin)
        .then((html) => res.status(200).type('html').send(html))
        .catch(next);
      return;
    }

    res.sendFile(path.join(config.root, 'private', 'admin.html'));
  });

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
module.exports = { createApp };
