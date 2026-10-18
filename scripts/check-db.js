'use strict';
/** Vérifie que l'adaptateur choisi dans .env respecte le contrat. Lecture seule : ne modifie aucune donnée. */
const config = require('../src/config');
const db = require('../src/db');
const { FUNCTIONS } = require('../src/db/contract');

(async () => {
  console.log(`Adaptateur testé : ${config.db.driver}`);
  const missing = db.missingFunctions();
  if (missing.length) { console.error(`\nFONCTIONS MANQUANTES (${missing.length}/${FUNCTIONS.length}) :\n - ${missing.join('\n - ')}`); process.exit(1); }
  console.log(`OK : les ${FUNCTIONS.length} fonctions du contrat sont présentes.`);
  try {
    await db.init();
    console.log('OK : connexion à la base (init).');
    await db.ping(); console.log('OK : ping.');
    console.log(`OK : lecture compagnies (${(await db.listCompagnies()).length}), trajets (${(await db.listTrajets({})).length}), utilisateurs (${(await db.listUsers({})).length}).`);
    console.log('\nPour tester aussi les écritures et la double réservation : lancez  npm test  (voir docs/CONTRAT_BASE_DE_DONNEES.md).');
    await db.close();
  } catch (e) { console.error('\nERREUR :', e.message); process.exit(1); }
})();
