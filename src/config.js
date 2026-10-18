'use strict';
const path = require('node:path');

const root = path.resolve(process.cwd());
// En local, charge .env. Sur Cloudflare, utilise les variables du Worker.
if (process.env.CLOUDFLARE_WORKERS !== '1') {
  try {
    process.loadEnvFile(path.join(root, '.env'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

const env = process.env;
const bool = (v, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));
const num = (v, d) => (v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
const isProd = env.NODE_ENV === 'production';
const port = num(env.PORT, 3000);

module.exports = {
  root,
  isProd,
  port,
  appName: 'Voyagéo',
  baseUrl: (env.APP_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
  sessionSecret: env.SESSION_SECRET || (isProd ? null : 'dev-secret-a-changer'),
  trustProxy: bool(env.TRUST_PROXY, false),
  db: {
    driver: (env.DB_DRIVER || 'json').toLowerCase(),
    json: { file: path.resolve(root, env.JSON_DB_FILE || './data/db.json') },
    mysql: {
      host: env.DB_HOST || 'localhost',
      port: num(env.DB_PORT, 3306),
      user: env.DB_USER || 'root',
      password: env.DB_PASSWORD || '',
      database: env.DB_NAME || 'voyageo',
      connectionLimit: num(env.DB_CONNECTION_LIMIT, 10),
    },
  },
  admin: {
    email: (env.ADMIN_EMAIL || '').trim().toLowerCase(),
    password: env.ADMIN_PASSWORD || '',
    nom: env.ADMIN_NOM || 'Administrateur',
    prenom: env.ADMIN_PRENOM || 'Voyagéo',
  },
  // Codes de confirmation par e-mail (inscription, mot de passe oublié)
  codes: {
    verifyEmail: bool(env.EMAIL_VERIFICATION, true),
    ttlMinutes: num(env.CODE_VALIDITE_MINUTES, 15),
  },
  // Service client WhatsApp (numéro au format international, chiffres uniquement : 229 + numéro)
  whatsapp: {
    number: (env.WHATSAPP_NUMBER || '22960315810').replace(/\D/g, ''),
    display: env.WHATSAPP_DISPLAY || '+229 60 31 58 10',
  },
  // Clé de chiffrement des clés FedaPay des compagnies (si vide : dérivée de SESSION_SECRET).
  encryptionKey: env.ENCRYPTION_KEY || '',
  // Abonnement des agences de transport (compagnies qui s'inscrivent elles-mêmes)
  subscription: {
    priceFcfa: num(env.SUBSCRIPTION_PRICE_FCFA, 20000),
    durationDays: num(env.SUBSCRIPTION_DURATION_DAYS, 30),
  },
  // Version de la politique de confidentialité : si elle change, chaque utilisateur doit la réaccepter à sa prochaine connexion.
  legal: { version: '2026-10' },
  tips: { min: 100, max: 50000, suggestions: [200, 500, 1000, 2000] },
  demoData: bool(env.DEMO_DATA, true),
  reservation: {
    annulationHeures: num(env.ANNULATION_HEURES, 24),
    attenteMinutes: num(env.RESERVATION_ATTENTE_MINUTES, 15),
    clotureMinutes: num(env.CLOTURE_RESERVATION_MINUTES, 30),
    utcOffset: env.TIMEZONE_OFFSET || '+01:00',
  },
  payment: {
    mode: (env.PAYMENT_MODE || 'off').toLowerCase(),
    fedapay: {
      env: (env.FEDAPAY_ENV || 'sandbox').toLowerCase(),
      publicKey: env.FEDAPAY_PUBLIC_KEY || '',
      secretKey: env.FEDAPAY_SECRET_KEY || '',
    },
    kkiapay: {
      publicKey: env.KKIAPAY_PUBLIC_KEY || '',
      privateKey: env.KKIAPAY_PRIVATE_KEY || '',
      secret: env.KKIAPAY_SECRET || '',
    },
  },
  smtp: {
    host: env.SMTP_HOST || '',
    port: num(env.SMTP_PORT, 587),
    secure: bool(env.SMTP_SECURE, false),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'Voyagéo <no-reply@localhost>',
  },
};
