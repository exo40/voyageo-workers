'use strict';
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

const N = 16384, r = 8, p = 1, KEYLEN = 64;

/** Hache un mot de passe (scrypt, intégré à Node.js). Format : scrypt$N$r$p$sel$hash */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(password, stored) {
  try {
    const [alg, n, rr, pp, saltB64, keyB64] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(keyB64, 'base64');
    const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: Number(rr), p: Number(pp) });
    return crypto.timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}
module.exports = { hashPassword, verifyPassword };
