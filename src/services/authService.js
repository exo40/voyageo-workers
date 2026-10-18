'use strict';
const config = require('../config');
const db = require('../db');
const { AppError } = require('../utils/errors');
const v = require('../utils/validate');
const { hashPassword, verifyPassword } = require('./passwords');
const codes = require('./codeStore');
const email = require('./emailService');

const publicUser = (u) => u && ({
  id_utilisateur: u.id_utilisateur, nom: u.nom, prenom: u.prenom, email: u.email, telephone: u.telephone,
  role: u.role, statut: u.statut, id_compagnie: u.id_compagnie ?? null, date_creation: u.date_creation,
  consentement_date: u.consentement_date ?? null,
});

const CONSENT_MSG = "Vous devez accepter la politique de confidentialité et l'utilisation de vos données personnelles pour continuer.";
const consentFields = (input) => {
  if (input.consentement !== true) throw new AppError(400, CONSENT_MSG, 'CONSENT_REQUIRED');
  return { consentement_date: new Date().toISOString(), consentement_version: config.legal.version };
};

let dummyHash = null;

// ---------- Agences de transport (compagnies qui s'inscrivent elles-mêmes) ----------
/** Si l'inscription est celle d'une agence (type = 'agence'), valide les informations de la compagnie. Sinon retourne null. */
async function parseAgence(input) {
  if (input.type !== 'agence') return null;
  const a = input.compagnie || {};
  const agence = {
    nom: v.reqStr(a.nom, "Le nom de l'agence", { max: 120 }),
    telephone: v.reqPhone(a.telephone),
    adresse: v.optStr(a.adresse, "L'adresse de l'agence", { max: 255 }),
  };
  if ((await db.listCompagnies()).some((c) => v.normCity(c.nom) === v.normCity(agence.nom))) throw new AppError(409, 'Une compagnie porte déjà ce nom. Si c\'est la vôtre, connectez-vous ou contactez Voyagéo.', 'DUPLICATE');
  return agence;
}
/** Crée le compte. Pour une agence : la compagnie (abonnement « en attente ») puis son gestionnaire. */
async function createAccount(data, hash, agence) {
  if (!agence) return publicUser(await db.createUser({ ...data, mot_de_passe_hache: hash, role: 'voyageur', statut: 'actif' }));
  let c;
  try { c = await db.createCompagnie({ nom: agence.nom, telephone: agence.telephone, email: data.email, adresse: agence.adresse, statut: 'active', abonnement_statut: 'en_attente' }); }
  catch (e) { if (e.code === 'ER_DUP_ENTRY' || e.code === 'DUPLICATE_NAME' || e.code === 'DUPLICATE') throw new AppError(409, 'Une compagnie porte déjà ce nom.', 'DUPLICATE'); throw e; }
  let user;
  try { user = await db.createUser({ ...data, mot_de_passe_hache: hash, role: 'gestionnaire', statut: 'actif', id_compagnie: c.id_compagnie }); }
  catch (e) { await db.deleteCompagnie(c.id_compagnie).catch(() => {}); throw e; }
  await require('./auditService').log(user, 'compagnie.inscription', { entite: 'compagnie', id_entite: c.id_compagnie, id_compagnie: c.id_compagnie, details: `Nouvelle agence inscrite : « ${c.nom} » (${user.email}). Abonnement en attente de paiement.` });
  return publicUser(user);
}

async function register(input) {
  const data = {
    nom: v.reqStr(input.nom, 'Le nom', { max: 100 }),
    prenom: v.reqStr(input.prenom, 'Le prénom', { max: 100 }),
    email: v.reqEmail(input.email),
    telephone: v.reqPhone(input.telephone),
    ...consentFields(input),
  };
  const pwd = v.reqPassword(input.mot_de_passe);
  if (await db.findUserByEmail(data.email)) throw new AppError(409, 'Cette adresse e-mail est déjà utilisée.', 'DUPLICATE_EMAIL');
  const agence = await parseAgence(input);
  return createAccount(data, await hashPassword(pwd), agence);
}

// ---------- Inscription avec code de confirmation e-mail ----------
function codeError(raison) {
  if (raison === 'invalide') return new AppError(400, 'Code incorrect. Vérifiez les 6 chiffres reçus par e-mail.', 'BAD_CODE');
  if (raison === 'trop_d_essais') return new AppError(429, 'Trop d\'essais. Demandez un nouveau code.', 'CODE_LOCKED');
  return new AppError(400, 'Ce code a expiré ou est introuvable. Demandez un nouveau code.', 'CODE_EXPIRED');
}
function waitError(e) {
  return e.code === 'RESEND_TOO_SOON' ? new AppError(429, `Un code vient d'être envoyé. Patientez ${e.wait} secondes avant d'en demander un autre.`, 'RESEND_TOO_SOON') : e;
}

/** Étape 1 : vérifie les informations, garde l'inscription en attente et envoie le code. Aucun compte n'est créé tant que l'e-mail n'est pas confirmé. */
async function startRegistration(input) {
  const data = {
    nom: v.reqStr(input.nom, 'Le nom', { max: 100 }),
    prenom: v.reqStr(input.prenom, 'Le prénom', { max: 100 }),
    email: v.reqEmail(input.email),
    telephone: v.reqPhone(input.telephone),
    ...consentFields(input),
  };
  const pwd = v.reqPassword(input.mot_de_passe);
  if (await db.findUserByEmail(data.email)) throw new AppError(409, 'Cette adresse e-mail est déjà utilisée.', 'DUPLICATE_EMAIL');
  const agence = await parseAgence(input);
  const payload = { data, mot_de_passe_hache: await hashPassword(pwd), agence };
  let code;
  try { code = codes.issue('inscription', data.email, payload); } catch (e) { throw waitError(e); }
  try { await email.sendCodeEmail(data.email, { code, motif: 'inscription' }); }
  catch (e) { codes.discard('inscription', data.email); throw e; }
  return { email: data.email, validite_minutes: config.codes.ttlMinutes };
}

/** Étape 2 : le code est bon, on crée le compte. */
async function confirmRegistration(emailInput, code) {
  const mail = v.reqEmail(emailInput);
  const res = codes.check('inscription', mail, code);
  if (!res.ok) throw codeError(res.raison);
  if (await db.findUserByEmail(mail)) throw new AppError(409, 'Cette adresse e-mail est déjà utilisée.', 'DUPLICATE_EMAIL');
  return createAccount(res.payload.data, res.payload.mot_de_passe_hache, res.payload.agence || null);
}

async function resendRegistration(emailInput) {
  const mail = v.reqEmail(emailInput);
  const pending = codes.peek('inscription', mail);
  if (!pending) throw new AppError(400, 'Aucune inscription en cours pour cette adresse. Recommencez l\'inscription.', 'NO_PENDING');
  let code;
  try { code = codes.issue('inscription', mail, pending.payload); } catch (e) { throw waitError(e); }
  try { await email.sendCodeEmail(mail, { code, motif: 'inscription' }); } catch (e) { codes.discard('inscription', mail); throw e; }
  return { email: mail, validite_minutes: config.codes.ttlMinutes };
}

// ---------- Mot de passe oublié ----------
/** Répond toujours de la même façon, que le compte existe ou non (ne révèle pas quelles adresses sont inscrites). */
async function forgotPassword(emailInput) {
  const mail = v.reqEmail(emailInput);
  const user = await db.findUserByEmail(mail);
  if (user && user.statut === 'actif') {
    try {
      const code = codes.issue('reset', mail);
      await email.sendCodeEmail(mail, { code, motif: 'reset' });
    } catch (e) {
      if (e.code === 'RESEND_TOO_SOON') throw waitError(e);
      codes.discard('reset', mail);
      console.error('[mot de passe oublié] envoi impossible :', e.message);
    }
  }
  return { ok: true };
}

async function resetPassword(emailInput, code, nouveau) {
  const mail = v.reqEmail(emailInput);
  const pwd = v.reqPassword(nouveau, 'Le nouveau mot de passe');
  const res = codes.check('reset', mail, code);
  if (!res.ok) throw codeError(res.raison);
  const user = await db.findUserByEmail(mail);
  if (!user || user.statut !== 'actif') throw codeError('expire');
  await db.updateUser(user.id_utilisateur, { mot_de_passe_hache: await hashPassword(pwd) });
  return { ok: true };
}

/** consent : true si la personne a coché « J'accepte » sur la page de connexion (demandé une fois, ou après une nouvelle version de la politique). */
async function login(emailInput, password, consent = false) {
  const email = String(emailInput || '').trim().toLowerCase();
  const user = email ? await db.findUserByEmail(email) : null;
  if (!dummyHash) dummyHash = await hashPassword('mot-de-passe-factice');
  const ok = await verifyPassword(String(password || ''), user ? user.mot_de_passe_hache : dummyHash);
  if (!user || !ok) throw new AppError(401, 'Adresse e-mail ou mot de passe incorrect.', 'BAD_CREDENTIALS');
  if (user.statut !== 'actif') throw new AppError(403, 'Ce compte est bloqué. Contactez l\'administrateur.', 'BLOCKED');
  if (user.consentement_version !== config.legal.version) {
    if (consent !== true) throw new AppError(428, CONSENT_MSG, 'CONSENT_REQUIRED');
    return publicUser(await db.updateUser(user.id_utilisateur, { consentement_date: new Date().toISOString(), consentement_version: config.legal.version }));
  }
  return publicUser(user);
}

async function changePassword(userId, actuel, nouveau) {
  const user = await db.findUserById(userId);
  if (!user || !(await verifyPassword(String(actuel || ''), user.mot_de_passe_hache))) throw new AppError(400, 'Le mot de passe actuel est incorrect.', 'BAD_PASSWORD');
  const pwd = v.reqPassword(nouveau, 'Le nouveau mot de passe');
  await db.updateUser(userId, { mot_de_passe_hache: await hashPassword(pwd) });
}

/** Crée le compte administrateur défini dans .env s'il n'existe pas. Ne modifie JAMAIS un compte existant. */
async function ensureAdmin() {
  const { email, password, nom, prenom } = config.admin;
  if (!email || !password) { console.warn('[admin] ADMIN_EMAIL / ADMIN_PASSWORD absents du .env : aucun compte administrateur créé.'); return null; }
  const existing = await db.findUserByEmail(email);
  if (existing) return existing;
  const u = await db.createUser({ nom, prenom, email, telephone: null, mot_de_passe_hache: await hashPassword(password), role: 'admin', statut: 'actif' });
  console.log(`[admin] compte administrateur créé : ${email}`);
  return u;
}

module.exports = { publicUser, register, startRegistration, confirmRegistration, resendRegistration, forgotPassword, resetPassword, login, changePassword, ensureAdmin };
