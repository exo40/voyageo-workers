'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv, startServer, Client } = require('./helpers');
setupEnv({ PAYMENT_MODE: 'simulation' });
const { todayStr, addDays } = require('../src/utils/time');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(async () => { await srv.close(); });

async function newUser(n) {
  const c = await new Client(srv.base).init();
  await c.post('/api/auth/inscription', { prenom: 'P', nom: `N${n}`, email: `p${n}@test.local`, telephone: '+229 01 02 03 04 05', consentement: true, mot_de_passe: 'MotDePasse123' });
  return c;
}
async function firstTrip(c) {
  return (await c.get(`/api/horaires?depart=Cotonou&arrivee=Bohicon&date=${addDays(todayStr(), 4)}`)).data.horaires[0];
}

test('paiement simulé : réservation en attente, paiement, confirmation', async () => {
  const a = await newUser(1), b = await newUser(2);
  assert.equal((await a.get('/api/config')).data.paiement.mode, 'simulation');
  const trip = await firstTrip(a);
  const r = await a.post('/api/reservations', { id_horaire: trip.id_horaire, numero_place: 3, prenom: 'A', nom: 'B', telephone: '+229 01 02 03 04 05' });
  assert.equal(r.status, 201); assert.equal(r.data.reservation.statut, 'en_attente'); assert.equal(r.data.paiement.requis, true);
  const n = r.data.reservation.numero_ticket;
  // la place est bloquée pendant l'attente
  assert.equal((await b.post('/api/reservations', { id_horaire: trip.id_horaire, numero_place: 3, prenom: 'C', nom: 'D', telephone: '+229 01 02 03 04 06' })).status, 409);
  assert.equal((await b.post('/api/paiements/simuler', { numero_ticket: n, operateur: 'MTN MoMo', telephone: '+229 01 02 03 04 05' })).status, 404);
  assert.equal((await a.post('/api/paiements/simuler', { numero_ticket: n, operateur: 'Inconnu', telephone: '+229 01 02 03 04 05' })).status, 400);
  assert.equal((await a.post('/api/paiements/simuler', { numero_ticket: n, operateur: 'MTN MoMo', telephone: 'xx' })).status, 400);
  assert.equal((await a.post('/api/paiements/initier', { numero_ticket: n })).status, 400);
  const pay = await a.post('/api/paiements/simuler', { numero_ticket: n, operateur: 'MTN MoMo', telephone: '+229 01 02 03 04 05' });
  assert.equal(pay.status, 200);
  const t = (await a.get(`/api/reservations/${n}`)).data;
  assert.equal(t.reservation.statut, 'confirmee'); assert.equal(t.paiement.statut, 'reussi');
  assert.equal((await a.post('/api/paiements/simuler', { numero_ticket: n, operateur: 'MTN MoMo', telephone: '+229 01 02 03 04 05' })).status, 409);
  const cancel = await a.post(`/api/reservations/${n}/annuler`);
  assert.equal(cancel.status, 200); assert.equal(cancel.data.remboursement_a_traiter, true);
});

test('retour de paiement invalide refusé', async () => {
  const res = await fetch(`${srv.base}/paiement/retour?id=inconnu`, { redirect: 'manual', headers: { Accept: 'text/html' } });
  assert.equal(res.status, 400);
});
