'use strict';
// Pas de ticket tant que le paiement n'est pas confirmé + paiements par compagnie dans l'administration.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv, startServer, Client } = require('./helpers');
setupEnv({ PAYMENT_MODE: 'fedapay', FEDAPAY_SECRET_KEY: 'sk_sandbox_test' });
const fedapay = require('../src/payments/fedapay');
const { todayStr, addDays } = require('../src/utils/time');

let status = 'en_attente';
let paid = null; // montant que « FedaPay » dit avoir reçu (null = montant attendu, défini après la recherche)
fedapay.getStatusDetail = async () => ({ statut: status, montant: paid });
fedapay.resumeCheckout = async () => 'https://sandbox-process.fedapay.com/x';
fedapay.createCheckout = async () => ({ reference: 'REF-1', url: 'https://sandbox-process.fedapay.com/x' });

let srv, user, n, trip;
test.before(async () => { srv = await startServer(); });
test.after(async () => { await srv.close(); });

test('réservation non payée : pas de ticket, pas de QR code', async () => {
  user = await new Client(srv.base).init();
  await user.post('/api/auth/inscription', { prenom: 'P', nom: 'Test', email: 'p@test.local', telephone: '+229 01 02 03 04 05', consentement: true, mot_de_passe: 'MotDePasse123' });
  trip = (await user.get(`/api/horaires?depart=Cotonou&arrivee=Bohicon&date=${addDays(todayStr(), 4)}`)).data.horaires[0];
  const r = await user.post('/api/reservations', { id_horaire: trip.id_horaire, numero_place: 5, prenom: 'A', nom: 'B', telephone: '+229 01 02 03 04 05' });
  assert.equal(r.data.reservation.statut, 'en_attente');
  n = r.data.reservation.numero_ticket;
  paid = trip.tarif_fcfa;
  const t = (await user.get(`/api/reservations/${n}`)).data;
  assert.equal(t.ticket_disponible, false);
  assert.equal(t.qr, null);
  // le QR code public ne valide pas non plus une réservation non payée
  assert.equal((await user.get(`/api/verifier/${n}`)).data.valide, false);
  assert.equal((await user.post('/api/paiements/initier', { numero_ticket: n })).status, 200);
});

test('retour de FedaPay sans paiement : retour à la page de paiement, jamais au ticket', async () => {
  // MySQL ne rouvre jamais un paiement « échoué » : le cas « échec » n'y est pas enchaîné avec le succès de la même transaction.
  for (const [s, flag] of (process.env.APP_TEST_DB === 'mysql' ? [['en_attente', 'attente']] : [['echoue', 'echec'], ['en_attente', 'attente']])) {
    status = s;
    const back = await user.get('/paiement/retour?id=REF-1');
    assert.equal(back.status, 302);
    const loc = back.headers.get('location');
    assert.ok(loc.startsWith('/paiement.html?n='), loc);
    assert.ok(loc.includes(`paiement=${flag}`), loc);
    assert.equal((await user.get(`/api/reservations/${n}`)).data.qr, null);
  }
});

test('paiement confirmé par FedaPay : le ticket et son QR code apparaissent', async () => {
  status = 'reussi';
  const back = await user.get('/paiement/retour?id=REF-1');
  assert.equal(back.status, 302);
  assert.ok(back.headers.get('location').startsWith('/ticket.html?n='));
  const t = (await user.get(`/api/reservations/${n}`)).data;
  assert.equal(t.ticket_disponible, true);
  assert.ok(t.qr.startsWith('data:image/png'));
  assert.equal((await user.get(`/api/verifier/${n}`)).data.valide, true);
});

test('administration : paiements par compagnie', async () => {
  const admin = await new Client(srv.base).init();
  await admin.post('/api/auth/connexion', { email: 'admin@test.local', consentement: true, mot_de_passe: 'MotDePasse#Test1' });
  const d = (await admin.get('/api/admin/paiements')).data;
  const mine = d.resume.find((r) => r.id_compagnie === trip.id_compagnie);
  assert.equal(mine.reussis, 1);
  assert.equal(mine.montant_fcfa, trip.tarif_fcfa);
  assert.equal(d.total.reussis, 1);
  assert.equal(d.total.montant_fcfa, trip.tarif_fcfa);
  assert.ok(d.resume.length >= 2, 'toutes les compagnies sont listées, même sans paiement');
  assert.equal(d.paiements[0].numero_ticket, n);
  assert.equal(d.paiements[0].compagnie_nom, mine.compagnie_nom);

  // un gestionnaire ne voit que sa propre compagnie
  const db = require('../src/db');
  const { hashPassword } = require('../src/services/passwords');
  const other = (await db.listCompagnies()).find((c) => c.id_compagnie !== trip.id_compagnie);
  await db.createUser({ nom: 'G', prenom: 'Gest', email: 'g@test.local', telephone: null, mot_de_passe_hache: await hashPassword('MotDePasse123'), role: 'gestionnaire', statut: 'actif', id_compagnie: other.id_compagnie });
  const g = await new Client(srv.base).init();
  await g.post('/api/auth/connexion', { email: 'g@test.local', consentement: true, mot_de_passe: 'MotDePasse123' });
  const gd = (await g.get('/api/admin/paiements')).data;
  assert.equal(gd.resume.length, 1);
  assert.equal(gd.resume[0].id_compagnie, other.id_compagnie);
  assert.equal(gd.total.montant_fcfa, 0);
  assert.equal(gd.paiements.length, 0);
  // un voyageur n'a pas accès
  assert.equal((await user.get('/api/admin/paiements')).status, 403);
});
