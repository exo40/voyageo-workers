'use strict';
/** Crée les données fictives de démonstration si la base ne contient aucune compagnie. */
const db = require('../src/db');
const { seedIfEmpty } = require('../src/services/demoData');
(async () => {
  await db.init();
  const done = await seedIfEmpty();
  if (!done) console.log('La base contient déjà des compagnies : rien n\'a été ajouté.');
  await db.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
