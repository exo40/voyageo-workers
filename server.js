'use strict';
require('dotenv').config();
require('dotenv').config();
const config = require('./src/config');
const db = require('./src/db');
const { createApp } = require('./src/app');
const { ensureAdmin } = require('./src/services/authService');
const { seedIfEmpty } = require('./src/services/demoData');

async function main() {
  if (!config.sessionSecret) throw new Error('SESSION_SECRET est obligatoire en production (voir .env).');
  await db.init();
  const missing = db.missingFunctions();
  if (missing.length) throw new Error(`L'adaptateur "${config.db.driver}" est incomplet. Fonctions manquantes : ${missing.join(', ')}`);
  await ensureAdmin();
  if (config.demoData) await seedIfEmpty();
  if (config.isProd) console.warn('[session] Les sessions sont gardées en mémoire : elles disparaissent au redémarrage. Voir la fiche technique pour utiliser un "session store".');

  const server = createApp().listen(config.port, () => {
    console.log(`\n  ${config.appName} est en ligne : ${config.baseUrl}`);
    console.log(`  Base de données : ${config.db.driver} | Paiement : ${config.payment.mode} | E-mail : ${config.smtp.host ? 'activé' : 'désactivé'}\n`);
  });
  const stop = async () => { server.close(); await db.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
main().catch((e) => { console.error('\nERREUR AU DÉMARRAGE :', e.message); process.exit(1); });
