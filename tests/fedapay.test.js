'use strict';
// FedaPay : le webhook et le retour confirment le ticket UNIQUEMENT si FedaPay confirme le paiement (fournisseur simulé).
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv } = require('./helpers');
setupEnv({ PAYMENT_MODE: 'fedapay', FEDAPAY_SECRET_KEY: 'sk_sandbox_test' });
const db = require('../src/db');
const fedapay = require('../src/payments/fedapay');
const pay = require('../src/services/paymentService');
const reservations = require('../src/services/reservationService');
const mail = require('../src/services/emailService');

let status = 'en_attente', ticketMails = 0;
let paid = null; // montant « reçu » par FedaPay (null = non vérifiable ; défini plus bas avec le vrai tarif)
fedapay.getStatusDetail = async () => ({ statut: status, montant: paid });
fedapay.resumeCheckout = async () => 'https://sandbox-process.fedapay.com/reprise';
fedapay.createCheckout = async () => ({ reference: '777', url: 'https://sandbox-process.fedapay.com/xyz' });
mail.sendTicketEmail = async () => { ticketMails += 1; return true; };

let user, resa;
test.before(async () => {
  await db.init();
  await require('../src/services/demoData').seedIfEmpty({ days: 3 });
  user = await db.createUser({ nom: 'P', prenom: 'Paul', email: 'paul@exemple.com', telephone: '+22901000000', mot_de_passe_hache: 'x', role: 'voyageur', statut: 'actif' });
  const h = (await db.listHoraires({})).find((x) => x.statut === 'programme' && x.nombre_places > x.places_occupees && !require('../src/services/catalogService').closed(x));
  resa = (await reservations.reserver(user, { id_horaire: h.id_horaire, numero_place: 3, nom: 'P', prenom: 'Paul', telephone: '+22901000000' })).reservation || null;
  resa = resa || (await db.listReservationsByUser(user.id_utilisateur))[0];
});
test.after(() => db.close());

test('réservation en attente tant que FedaPay n\'a pas confirmé', async () => {
  const r = await db.getReservationById(resa.id_reservation);
  assert.equal(r.statut, 'en_attente');
  const out = await pay.initier(user, r.numero_ticket);
  assert.match(out.url, /^https:\/\/.*fedapay/);
});

test('webhook : paiement non approuvé => ticket non confirmé', async () => {
  status = 'en_attente';
  await pay.webhook({ name: 'transaction.approved', entity: { id: 777 } });
  assert.equal((await db.getReservationById(resa.id_reservation)).statut, 'en_attente');
});

test('webhook : un faux webhook ne confirme rien si FedaPay dit non', async () => {
  status = 'echoue';
  await pay.webhook({ name: 'transaction.approved', entity: { id: 777 } });
  assert.equal((await db.getReservationById(resa.id_reservation)).statut, 'en_attente');
});

test('webhook : montant payé différent du tarif => ticket NON confirmé', async () => {
  const r = await db.getReservationById(resa.id_reservation);
  status = 'reussi'; paid = r.tarif_fcfa - 500;
  await pay.webhook({ name: 'transaction.approved', entity: { id: 777 } });
  assert.equal((await db.getReservationById(resa.id_reservation)).statut, 'en_attente');
  assert.equal(ticketMails, 0);
});

test('webhook : paiement approuvé => ticket confirmé et e-mail du ticket envoyé, une seule fois', async () => {
  status = 'reussi'; paid = (await db.getReservationById(resa.id_reservation)).tarif_fcfa;
  await pay.webhook({ name: 'transaction.approved', entity: { id: 777 } });
  assert.equal((await db.getReservationById(resa.id_reservation)).statut, 'confirmee');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ticketMails, 1);
  await pay.webhook({ name: 'transaction.approved', entity: { id: 777 } });
  const back = await pay.retour({ id: '777' });
  assert.equal(back.statut, 'reussi');
  assert.equal(ticketMails, 1);
});

test('webhook : contenu inutilisable ignoré', async () => {
  assert.deepEqual(await pay.webhook({}), { ignore: true });
  assert.deepEqual(await pay.webhook({ entity: { id: 999999 } }), { ignore: true });
});
