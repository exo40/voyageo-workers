'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv, startServer, Client } = require('./helpers');
// Délai d'attente de 0 minute : une réservation non payée expire immédiatement.
setupEnv({ PAYMENT_MODE: 'simulation', RESERVATION_ATTENTE_MINUTES: '0' });
const { todayStr, addDays } = require('../src/utils/time');

let srv;
test.before(async () => { srv = await startServer(); });
test.after(async () => { await srv.close(); });

test('une réservation non payée expire et libère la place', async () => {
  const c = await new Client(srv.base).init();
  await c.post('/api/auth/inscription', { prenom: 'P', nom: 'N', email: 'exp@test.local', telephone: '+229 01 02 03 04 05', consentement: true, mot_de_passe: 'MotDePasse123' });
  const trip = (await c.get(`/api/horaires?depart=Cotonou&arrivee=Bohicon&date=${addDays(todayStr(), 4)}`)).data.horaires[0];
  const r = await c.post('/api/reservations', { id_horaire: trip.id_horaire, numero_place: 7, prenom: 'A', nom: 'B', telephone: '+229 01 02 03 04 05' });
  assert.equal(r.status, 201);
  await new Promise((res) => setTimeout(res, 1100));   // MySQL stocke les dates à la seconde
  assert.deepEqual((await c.get(`/api/horaires/${trip.id_horaire}`)).data.places_occupees, []);
  assert.equal((await c.get(`/api/reservations/${r.data.reservation.numero_ticket}`)).data.reservation.statut, 'annulee');
  assert.equal((await c.post('/api/paiements/simuler', { numero_ticket: r.data.reservation.numero_ticket, operateur: 'MTN MoMo', telephone: '+229 01 02 03 04 05' })).status, 409);
});
