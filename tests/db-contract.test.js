'use strict';
/**
 * TEST DU CONTRAT BASE DE DONNÉES.
 *  - Par défaut : teste l'adaptateur "json" sur un fichier temporaire.
 *  - Pour tester VOTRE adaptateur (mysql / custom) sur une base de TEST (jamais la vraie !) :
 *        CONTRACT_TEST_USE_ENV=1 npm test
 *    avec DB_DRIVER et les accès à la base de test définis dans .env.
 */
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

if (!process.env.CONTRACT_TEST_USE_ENV) {
  process.env.DB_DRIVER = 'json';
  process.env.JSON_DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'voyageo-')), 'db.json');
}
const db = require('../src/db');
const { FUNCTIONS } = require('../src/db/contract');

const uniq = Date.now().toString(36);
// Numéros de ticket au format du site (VYG-AAAA-NNNNNN) : la base MySQL de production refuse tout autre format (contrainte ck_reservation_ticket).
const ticketBase = require('node:crypto').randomInt(0, 999000);
const ticketIds = new Map();
const ticket = (n) => { if (!ticketIds.has(String(n))) ticketIds.set(String(n), ticketIds.size); return `VYG-2099-${String(ticketBase + ticketIds.get(String(n))).padStart(6, '0')}`; };
let comp, bus, trajet, horaire, user;
const resa = (n, place, extra = {}) => ({ numero_ticket: ticket(n), id_utilisateur: user.id_utilisateur, id_horaire: horaire.id_horaire, numero_place: place,
  nom_passager: 'Test', prenom_passager: 'Contrat', telephone_passager: '+229 01 00 00 00 00', piece_identite: null, statut: 'confirmee', ...extra });

test.before(async () => { await db.init(); });
test.after(async () => { await db.close(); });

test('toutes les fonctions du contrat existent', () => assert.deepEqual(db.missingFunctions(), []));

test('utilisateurs : création, e-mail unique, mise à jour', async () => {
  user = await db.createUser({ nom: 'Doe', prenom: 'Jane', email: `jane-${uniq}@exemple.com`, telephone: '0100000000', mot_de_passe_hache: 'x', role: 'voyageur' });
  assert.ok(user.id_utilisateur);
  await assert.rejects(db.createUser({ nom: 'A', prenom: 'B', email: `JANE-${uniq}@exemple.com`, mot_de_passe_hache: 'x' }), { code: 'DUPLICATE_EMAIL' });
  assert.equal((await db.findUserByEmail(`jane-${uniq}@exemple.com`)).id_utilisateur, user.id_utilisateur);
  assert.equal((await db.updateUser(user.id_utilisateur, { statut: 'bloque' })).statut, 'bloque');
  await db.updateUser(user.id_utilisateur, { statut: 'actif' });
});

test('compagnie, bus, trajet, horaire', async () => {
  comp = await db.createCompagnie({ nom: `Compagnie ${uniq}` });
  bus = await db.createBus({ id_compagnie: comp.id_compagnie, immatriculation: `CT-${uniq}`, nombre_places: 10 });
  trajet = await db.createTrajet({ id_compagnie: comp.id_compagnie, ville_depart: 'Cotonou', ville_arrivee: 'Parakou', duree_estimee: 390 });
  horaire = await db.createHoraire({ id_trajet: trajet.id_trajet, id_bus: bus.id_bus, date_depart: '2099-01-10', heure_depart: '07:00', heure_arrivee: '13:30', tarif_fcfa: 8000 });
  assert.equal(horaire.nombre_places, 10);
  assert.equal(horaire.compagnie_nom, comp.nom);
  assert.equal(horaire.heure_depart, '07:00');
  assert.equal(horaire.places_occupees, 0);
});

test('recherche : insensible à la casse et aux accents', async () => {
  const r = await db.searchHoraires({ ville_depart: 'cotonou', ville_arrivee: 'PARAKOU', date: '2099-01-10' });
  assert.ok(r.some((h) => h.id_horaire === horaire.id_horaire));
  assert.equal((await db.searchHoraires({ ville_depart: 'Cotonou', ville_arrivee: 'Parakou', date: '2099-01-11' })).length, 0);
});

test('réservation : une place ne peut être prise qu\'une seule fois', async () => {
  const a = await db.createReservation(resa(1, 3));
  assert.equal(a.statut, 'confirmee');
  assert.equal(a.ville_depart, 'Cotonou');
  await assert.rejects(db.createReservation(resa(2, 3)), { code: 'SEAT_TAKEN' });
  await assert.rejects(db.createReservation(resa(1, 4)), { code: 'DUPLICATE_TICKET' });
  assert.deepEqual(await db.getOccupiedSeats(horaire.id_horaire), [3]);
  assert.equal((await db.getHoraire(horaire.id_horaire)).places_occupees, 1);
});

test('réservation : 10 demandes simultanées pour la même place = 1 seule réussite', async () => {
  const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => db.createReservation(resa(`c${i}`, 7))));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  for (const r of results.filter((x) => x.status === 'rejected')) assert.equal(r.reason.code, 'SEAT_TAKEN');
});

test('annulation : la place est libérée et peut être reprise', async () => {
  const a = await db.getReservationByTicket(ticket(1));
  const c = await db.cancelReservation(a.id_reservation);
  assert.equal(c.statut, 'annulee');
  assert.ok(!(await db.getOccupiedSeats(horaire.id_horaire)).includes(3));
  const b = await db.createReservation(resa(20, 3));
  await assert.rejects(db.updateReservationStatus(a.id_reservation, 'confirmee'), { code: 'SEAT_TAKEN' });
  assert.equal(b.statut, 'confirmee');
});

test('réservations en attente expirées', async () => {
  const p = await db.createReservation(resa(30, 5, { statut: 'en_attente' }));
  assert.equal(await db.expirePendingReservations(new Date(Date.now() - 3600000).toISOString()), 0);
  assert.ok(await db.expirePendingReservations(new Date(Date.now() + 60000).toISOString()) >= 1);
  assert.equal((await db.getReservationById(p.id_reservation)).statut, 'annulee');
});

test('listes : par utilisateur et recherche', async () => {
  assert.ok((await db.listReservationsByUser(user.id_utilisateur)).length >= 3);
  assert.ok((await db.listReservations({ q: ticket(20) })).length === 1);
  assert.ok((await db.listReservations({ id_compagnie: comp.id_compagnie, statut: 'confirmee' })).length >= 1);
});

test('paiement', async () => {
  const r = await db.getReservationByTicket(ticket(20));
  const p = await db.createPayment({ id_reservation: r.id_reservation, montant_fcfa: 8000, mode: 'simulation', reference_transaction: `REF-${uniq}` });
  assert.equal((await db.getPaymentByReference(`REF-${uniq}`)).id_paiement, p.id_paiement);
  assert.equal((await db.updatePayment(p.id_paiement, { statut: 'reussi' })).statut, 'reussi');
  assert.equal((await db.getLatestPaymentByReservation(r.id_reservation)).statut, 'reussi');
});

test('statistiques', async () => {
  const s = await db.getStats({ today: '2098-12-31' });
  assert.ok(s.trajets_actifs >= 1);
  assert.ok(s.taux_remplissage >= 0 && s.taux_remplissage <= 100);
  const sc = await db.getStats({ today: '2098-12-31', id_compagnie: comp.id_compagnie });
  assert.equal(sc.utilisateurs, null);
});

test('suppressions refusées si l\'élément est utilisé (IN_USE)', async () => {
  await assert.rejects(db.deleteHoraire(horaire.id_horaire), { code: 'IN_USE' });
  await assert.rejects(db.deleteBus(bus.id_bus), { code: 'IN_USE' });
  await assert.rejects(db.deleteTrajet(trajet.id_trajet), { code: 'IN_USE' });
  await assert.rejects(db.deleteCompagnie(comp.id_compagnie), { code: 'IN_USE' });
});

test('journal d\'audit : ajout, filtres, ordre récent → ancien', async () => {
  const a = await db.addAuditLog({ id_utilisateur: user.id_utilisateur, utilisateur_nom: 'Jane Doe', id_compagnie: comp.id_compagnie, action: 'test.premier', entite: 'bus', id_entite: bus.id_bus, details: 'un' });
  const b = await db.addAuditLog({ id_utilisateur: null, utilisateur_nom: 'Système', id_compagnie: null, action: 'test.second', entite: 'paiement', id_entite: 7, details: 'deux' });
  assert.ok(a.id_journal && b.id_journal > a.id_journal);
  assert.ok(a.date_evenement);
  const all = await db.listAuditLog({ limit: 100 });
  assert.ok(all.findIndex((e) => e.id_journal === b.id_journal) < all.findIndex((e) => e.id_journal === a.id_journal), 'le plus récent d\'abord');
  assert.ok((await db.listAuditLog({ id_compagnie: comp.id_compagnie })).every((e) => e.id_compagnie === comp.id_compagnie));
  assert.equal((await db.listAuditLog({ entite: 'paiement', id_entite: 7, action: 'test.second' })).length, 1);
  assert.equal((await db.listAuditLog({ limit: 1 })).length, 1);
});

test('paiements d\'une réservation : liste complète dans l\'ordre de création', async () => {
  const r = await db.createReservation(resa(90, 9, { statut: 'en_attente' }));
  const p1 = await db.createPayment({ id_reservation: r.id_reservation, montant_fcfa: 8000, mode: 'fedapay', reference_transaction: `R1-${uniq}`, statut: 'en_attente' });
  const p2 = await db.createPayment({ id_reservation: r.id_reservation, montant_fcfa: 8000, mode: 'fedapay', reference_transaction: `R2-${uniq}`, statut: 'reussi' });
  const list = await db.listPaymentsByReservation(r.id_reservation);
  assert.deepEqual(list.map((p) => p.id_paiement), [p1.id_paiement, p2.id_paiement]);
  assert.equal((await db.listPaymentsByReservation(99999999)).length, 0);
});

test('vue des voyages : statut de la compagnie disponible', async () => {
  const h = await db.getHoraire(horaire.id_horaire);
  assert.equal(h.compagnie_statut, 'active');
});
