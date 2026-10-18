'use strict';
/**
 * Verrou par clé (dans ce processus Node) : deux opérations sur la même clé s'exécutent l'une après l'autre.
 * Sert à empêcher le double paiement / la double confirmation quand un voyageur clique deux fois ou quand
 * le retour du navigateur et le webhook arrivent en même temps.
 * LIMITE : ne protège que si le site tourne dans UN seul processus. Avec plusieurs serveurs, la base de
 * données doit porter la garantie (voir README, section « Fiabilité des paiements »).
 */
const tails = new Map();
async function withLock(key, fn) {
  const prev = tails.get(key) || Promise.resolve();
  let release;
  const mine = new Promise((resolve) => { release = resolve; });
  const tail = prev.then(() => mine);
  tails.set(key, tail);
  await prev;
  try { return await fn(); } finally { release(); if (tails.get(key) === tail) tails.delete(key); }
}
module.exports = { withLock };
