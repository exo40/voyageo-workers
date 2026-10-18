'use strict';
/**
 * Chiffrement des secrets enregistrés en base (clés secrètes FedaPay des compagnies) : AES-256-GCM.
 * La clé de chiffrement vient de ENCRYPTION_KEY (recommandé) ou, à défaut, de SESSION_SECRET.
 * ATTENTION : si cette valeur change, les clés enregistrées deviennent illisibles et chaque compagnie doit les ressaisir.
 */
const crypto = require('node:crypto');
const config = require('../config');
const { AppError } = require('./errors');

const key = () => crypto.createHash('sha256').update(`voyageo/secret-box/v1:${config.encryptionKey || config.sessionSecret || ''}`).digest();
const b64 = (buf) => buf.toString('base64url');

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return `v1.${b64(iv)}.${b64(c.getAuthTag())}.${b64(data)}`;
}
function decrypt(token) {
  try {
    const [v, iv, tag, data] = String(token).split('.');
    if (v !== 'v1') throw new Error('format');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
  } catch {
    throw new AppError(500, 'Les clés de paiement enregistrées sont illisibles (clé de chiffrement modifiée ?). La compagnie doit les saisir à nouveau.', 'SECRET_UNREADABLE');
  }
}
module.exports = { encrypt, decrypt };
