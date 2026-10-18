'use strict';
/** Remet le compte administrateur du .env à zéro (mot de passe = ADMIN_PASSWORD du .env). À utiliser si le mot de passe est oublié. */
const config = require('../src/config');
const db = require('../src/db');
const { hashPassword } = require('../src/services/passwords');
(async () => {
  const { email, password, nom, prenom } = config.admin;
  if (!email || !password) throw new Error('ADMIN_EMAIL et ADMIN_PASSWORD doivent être renseignés dans .env');
  await db.init();
  const u = await db.findUserByEmail(email);
  const hash = await hashPassword(password);
  if (u) { await db.updateUser(u.id_utilisateur, { mot_de_passe_hache: hash, role: 'admin', statut: 'actif', id_compagnie: null }); console.log(`Mot de passe réinitialisé pour ${email}.`); }
  else { await db.createUser({ nom, prenom, email, telephone: null, mot_de_passe_hache: hash, role: 'admin', statut: 'actif' }); console.log(`Compte administrateur créé : ${email}.`); }
  await db.close();
})().catch((e) => { console.error('ERREUR :', e.message); process.exit(1); });
