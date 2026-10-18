'use strict';
/**
 * Codes de confirmation à usage unique (inscription, mot de passe oublié).
 * Stockés EN MÉMOIRE avec une durée de vie courte : aucune table à ajouter dans la base de données.
 * Limites assumées : les codes disparaissent au redémarrage du serveur (l'utilisateur redemande un code) et ne sont pas
 * partagés entre plusieurs serveurs. Pour un déploiement sur plusieurs instances, remplacer ce fichier par une table SQL.
 * Un code n'est JAMAIS gardé en clair : on ne conserve qu'une empreinte (HMAC).
 */
const crypto = require('node:crypto');
const config = require('../config');

const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 60;
const store = new Map(); // clé "objet:email" -> { hash, expires, attempts, sentAt, payload }

const ttlMs = () => config.codes.ttlMinutes * 60000;
const keyOf = (purpose, email) => `${purpose}:${String(email).trim().toLowerCase()}`;
const digest = (purpose, email, code) => crypto.createHmac('sha256', config.sessionSecret || 'dev').update(`${purpose}|${String(email).toLowerCase()}|${code}`).digest();

function sweep() { const now = Date.now(); for (const [k, v] of store) if (v.expires <= now) store.delete(k); }
setInterval(sweep, 10 * 60000).unref();

/** Crée (ou remplace) un code à 6 chiffres. Lève RESEND_TOO_SOON si un code vient d'être envoyé. Retourne le code en clair (à envoyer par e-mail). */
function issue(purpose, email, payload = null) {
  sweep();
  const key = keyOf(purpose, email);
  const old = store.get(key);
  if (old && Date.now() - old.sentAt < RESEND_SECONDS * 1000) {
    const e = new Error('RESEND_TOO_SOON'); e.code = 'RESEND_TOO_SOON'; e.wait = Math.ceil((RESEND_SECONDS * 1000 - (Date.now() - old.sentAt)) / 1000); throw e;
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  store.set(key, { hash: digest(purpose, email, code), expires: Date.now() + ttlMs(), attempts: 0, sentAt: Date.now(), payload });
  return code;
}

/** Vérifie un code. Retourne { ok: true, payload } et le supprime, ou { ok: false, raison: 'invalide' | 'expire' | 'trop_d_essais' }. */
function check(purpose, email, code) {
  const key = keyOf(purpose, email);
  const e = store.get(key);
  if (!e || e.expires <= Date.now()) { store.delete(key); return { ok: false, raison: 'expire' }; }
  if (e.attempts >= MAX_ATTEMPTS) { store.delete(key); return { ok: false, raison: 'trop_d_essais' }; }
  e.attempts += 1;
  const given = digest(purpose, email, String(code || '').replace(/\D/g, '').padStart(6, '0'));
  if (!crypto.timingSafeEqual(given, e.hash)) return { ok: false, raison: e.attempts >= MAX_ATTEMPTS ? 'trop_d_essais' : 'invalide' };
  store.delete(key);
  return { ok: true, payload: e.payload };
}
const discard = (purpose, email) => store.delete(keyOf(purpose, email));
const peek = (purpose, email) => { const e = store.get(keyOf(purpose, email)); return e && e.expires > Date.now() ? e : null; };

module.exports = { issue, check, discard, peek, MAX_ATTEMPTS, RESEND_SECONDS, _store: store };
