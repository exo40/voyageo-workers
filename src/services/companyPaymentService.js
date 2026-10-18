'use strict';
/**
 * CLÉS FEDAPAY DES COMPAGNIES : chaque compagnie saisit SES clés dans son espace ; l'argent des tickets va alors
 * directement sur SON compte FedaPay. La clé secrète est chiffrée en base (AES-256-GCM), n'est jamais renvoyée
 * au navigateur (seulement masquée), n'est jamais écrite dans le journal, et toute modification demande le mot de passe.
 */
const config = require('../config');
const db = require('../db');
const { AppError } = require('../utils/errors');
const secretBox = require('../utils/secretBox');
const { verifyPassword } = require('./passwords');
const audit = require('./auditService');

const PK = /^pk_(sandbox|live)_[A-Za-z0-9_-]{8,150}$/;
const SK = /^sk_(sandbox|live)_[A-Za-z0-9_-]{8,150}$/;
const provider = () => require('../payments/fedapay');
const webhookUrl = (cid) => `${config.baseUrl}/paiement/webhook/${cid}`;
const mask = (k) => { const m = /^([a-z]+_[a-z]+_)(.*)$/.exec(k || ''); return m ? `${m[1]}${'•'.repeat(8)}${m[2].slice(-4)}` : '••••••••'; };

// Freine la devinette du mot de passe (5 échecs par 15 minutes et par utilisateur), en mémoire.
const fails = new Map();
function checkRate(uid) { const f = (fails.get(uid) || []).filter((t) => Date.now() - t < 900000); fails.set(uid, f); if (f.length >= 5) throw new AppError(429, 'Trop de tentatives. Réessayez dans quelques minutes.', 'RATE_LIMIT'); }
async function checkPassword(user, password) {
  checkRate(user.id_utilisateur);
  const u = await db.findUserById(user.id_utilisateur);
  if (!password || !u || !(await verifyPassword(String(password), u.mot_de_passe_hache))) {
    fails.set(user.id_utilisateur, [...(fails.get(user.id_utilisateur) || []), Date.now()]);
    throw new AppError(403, 'Mot de passe incorrect.', 'BAD_PASSWORD');
  }
  fails.delete(user.id_utilisateur);
}

function secretMask(s) { try { return mask(secretBox.decrypt(s.secret_key_enc)); } catch { return '(illisible : à saisir à nouveau)'; } }

async function view(companyId) {
  const s = await db.getCompanyPaymentSettings(companyId);
  return {
    configure: !!s, verifie: !!(s && s.verifie), env: s ? s.fedapay_env : null,
    public_key_masquee: s ? mask(s.public_key) : null, secret_key_masquee: s ? secretMask(s) : null,
    date_maj: s ? s.date_maj : null, webhook_url: webhookUrl(companyId), mode_plateforme: config.payment.mode,
  };
}

async function save(user, input) {
  const cid = user.id_compagnie;
  const pub = String(input.public_key || '').trim(), sec = String(input.secret_key || '').trim();
  const mp = PK.exec(pub), ms = SK.exec(sec);
  if (!mp) throw new AppError(400, 'La clé publique FedaPay est invalide (elle commence par pk_sandbox_ ou pk_live_).', 'VALIDATION');
  if (!ms) throw new AppError(400, 'La clé secrète FedaPay est invalide (elle commence par sk_sandbox_ ou sk_live_).', 'VALIDATION');
  if (mp[1] !== ms[1]) throw new AppError(400, 'Les deux clés ne sont pas du même environnement (sandbox / live).', 'VALIDATION');
  await checkPassword(user, input.mot_de_passe);
  const env = ms[1];
  const check = await provider().verifyCredentials({ secretKey: sec, env });
  if (!check.valide) throw new AppError(400, 'FedaPay a refusé ces clés. Vérifiez-les dans FedaPay > Paramètres > Clés API.', 'KEY_REJECTED');
  await db.saveCompanyPaymentSettings(cid, { fedapay_env: env, public_key: pub, secret_key_enc: secretBox.encrypt(sec), verifie: true });
  await audit.log(user, 'paiement_compagnie.configure', { entite: 'compagnie', id_entite: cid, id_compagnie: cid, details: `Clés FedaPay enregistrées (environnement ${env}).` });
  return view(cid);
}

async function remove(user, input) {
  await checkPassword(user, input.mot_de_passe);
  await db.deleteCompanyPaymentSettings(user.id_compagnie);
  await audit.log(user, 'paiement_compagnie.supprime', { entite: 'compagnie', id_entite: user.id_compagnie, id_compagnie: user.id_compagnie, details: 'Clés FedaPay supprimées : les tickets ne peuvent plus être payés en ligne.' });
  return view(user.id_compagnie);
}

/** Identifiants utilisables par le serveur : { secretKey, env } ou null si la compagnie n'a pas configuré ses clés. */
async function credsFor(companyId) {
  const s = await db.getCompanyPaymentSettings(companyId);
  return s ? { secretKey: secretBox.decrypt(s.secret_key_enc), env: s.fedapay_env } : null;
}
module.exports = { view, save, remove, credsFor, webhookUrl };
