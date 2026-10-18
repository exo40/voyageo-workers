'use strict';
/**
 * TESTS DE LA LOGIQUE ADMIN + PAIEMENTS (sans démarrer Express : voir tests/support/fake-express.js).
 * Ils exécutent le vrai code des routes et des services, avec la vraie couche base de données (adaptateur JSON temporaire).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv } = require('./helpers');
setupEnv({ PAYMENT_MODE: 'fedapay', FEDAPAY_SECRET_KEY: 'sk_sandbox_test' });
const { call } = require('./support/fake-express');
const config = require('../src/config');
const db = require('../src/db');
const { todayStr, addDays } = require('../src/utils/time');
const { hashPassword, verifyPassword } = require('../src/services/passwords');
const { publicUser, ensureAdmin } = require('../src/services/authService');
const { seedIfEmpty } = require('../src/services/demoData');
const reservations = require('../src/services/reservationService');
const payments = require('../src/services/paymentService');
const catalog = require('../src/services/catalogService');
const fedapay = require('../src/payments/fedapay');
const router = require('../src/routes/admin');

// ---------- faux prestataire de paiement ----------
let providerStatus = 'en_attente', providerAmount = null, checkouts = 0, resumes = 0;
fedapay.createCheckout = async () => { checkouts += 1; return { reference: `REF-${checkouts}`, url: 'https://sandbox-process.fedapay.com/x' }; };
fedapay.resumeCheckout = async () => { resumes += 1; return 'https://sandbox-process.fedapay.com/reprise'; };
fedapay.getStatusDetail = async () => ({ statut: providerStatus, montant: providerAmount });

let admin, gestA, gestB, voyageur, compA, compB;
const as = (user) => (method, url, body) => call(router, method, url, { user, body });
const A = (m, u, b) => as(admin)(m, u, b);
const mkUser = async (data) => publicUser(await db.createUser({ telephone: null, mot_de_passe_hache: await hashPassword('MotDePasse123'), statut: 'actif', ...data }));
const resa = (id_horaire, place, extra = {}) => ({ id_horaire, numero_place: place, nom: 'Test', prenom: 'Client', telephone: '+229 01 02 03 04 05', ...extra });
async function freeTrip(companyId, dayOffset = 3) {
  const d = addDays(todayStr(), dayOffset);
  return (await db.listHoraires({ id_compagnie: companyId, date_min: d, date_max: d })).find((h) => h.statut === 'programme');
}
async function payedReservation(user, trip, place, ref) {
  providerStatus = 'reussi'; providerAmount = trip.tarif_fcfa;
  const r = await reservations.reserver(user, resa(trip.id_horaire, place));
  await payments.initier(user, r.numero_ticket);
  const out = await payments.retour({ id: ref || `REF-${checkouts}` });
  return { r, out };
}

test.before(async () => {
  await db.init(); await ensureAdmin(); await seedIfEmpty();
  admin = publicUser(await db.findUserByEmail('admin@test.local'));
  [compA, compB] = await db.listCompagnies();
  gestA = await mkUser({ nom: 'A', prenom: 'Gest', email: 'ga@test.local', role: 'gestionnaire', id_compagnie: compA.id_compagnie });
  gestB = await mkUser({ nom: 'B', prenom: 'Gest', email: 'gb@test.local', role: 'gestionnaire', id_compagnie: compB.id_compagnie });
  voyageur = await mkUser({ nom: 'V', prenom: 'Voy', email: 'v@test.local', role: 'voyageur' });
});
test.after(async () => { await db.close(); });

// ============================================================
test('tableau de bord : chiffres réels, rien d\'inventé', async () => {
  let d = (await A('GET', '/tableau-de-bord?jours=30')).body;
  assert.equal(d.kpis.chiffre_affaires.valeur, 0, 'aucun paiement : 0 FCFA, pas de chiffre fictif');
  assert.equal(d.kpis.reservations.valeur, 0);
  assert.equal(d.kpis.bus, (await db.listBus({})).length);
  assert.deepEqual(d.kpis.compagnies_actives, { actives: 2, total: 2 });
  assert.ok(d.kpis.voyages_programmes > 100);
  assert.equal(d.graphiques.evolution.length, 30);
  assert.equal(d.kpis.utilisateurs.total, 1);
  assert.deepEqual(d.alertes.map((a) => a.code).filter((c) => c === 'remboursements'), []);

  const trip = await freeTrip(compA.id_compagnie);
  await payedReservation(voyageur, trip, 1);
  d = (await A('GET', '/tableau-de-bord?jours=7')).body;
  assert.equal(d.kpis.chiffre_affaires.valeur, trip.tarif_fcfa);
  assert.equal(d.kpis.reservations.valeur, 1);
  assert.equal(d.graphiques.evolution.length, 7);
  assert.equal(d.graphiques.evolution.at(-1).recettes, trip.tarif_fcfa);
  assert.equal(d.graphiques.par_statut.confirmee, 1);
  assert.equal(d.graphiques.trajets_populaires[0].nombre, 1);
  assert.ok(d.activite.some((e) => e.action === 'paiement.confirme'), 'le paiement confirmé est dans l\'activité récente');
  // Un gestionnaire de l'autre compagnie ne voit rien de ce paiement
  const b = (await as(gestB)('GET', '/tableau-de-bord')).body;
  assert.equal(b.kpis.chiffre_affaires.valeur, 0);
  assert.equal(b.kpis.utilisateurs, null, 'les utilisateurs globaux ne sont pas exposés à un gestionnaire');
  assert.equal(b.activite.length, 0);
  const a = (await as(gestA)('GET', '/tableau-de-bord')).body;
  assert.equal(a.kpis.chiffre_affaires.valeur, trip.tarif_fcfa);
});

test('isolation des compagnies : lecture, modification, création, listes et exports', async () => {
  const tripA = await freeTrip(compA.id_compagnie, 5);
  const busA = (await db.listBus({ id_compagnie: compA.id_compagnie }))[0];
  const trajetA = (await db.listTrajets({ id_compagnie: compA.id_compagnie }))[0];
  const rA = await reservations.reserver(voyageur, resa(tripA.id_horaire, 9, { nom: 'Secret' }));
  const gB = as(gestB);
  // fiches détaillées : introuvable (on ne révèle pas l'existence)
  assert.equal((await gB('GET', `/horaires/${tripA.id_horaire}`)).status, 404);
  assert.equal((await gB('GET', `/bus/${busA.id_bus}`)).status, 404);
  assert.equal((await gB('GET', `/reservations/${rA.id_reservation}`)).status, 404);
  assert.equal((await gB('GET', `/compagnies/${compA.id_compagnie}`)).status, 404);
  // modifications
  assert.equal((await gB('PUT', `/bus/${busA.id_bus}`, { immatriculation: 'X-1', nombre_places: 20 })).status, 403);
  assert.equal((await gB('DELETE', `/trajets/${trajetA.id_trajet}`)).status, 403);
  assert.equal((await gB('POST', `/reservations/${rA.id_reservation}/annuler`)).status, 403);
  assert.equal((await gB('PUT', `/horaires/${tripA.id_horaire}`, { id_trajet: tripA.id_trajet, id_bus: tripA.id_bus, date_depart: tripA.date_depart, heure_depart: tripA.heure_depart, tarif_fcfa: 1, statut: 'programme' })).status, 403);
  // création forcée dans sa propre compagnie, même si le corps de la requête vise une autre compagnie
  const made = await gB('POST', '/bus', { id_compagnie: compA.id_compagnie, immatriculation: 'ISO-TEST-1', nombre_places: 20 });
  assert.equal(made.status, 201); assert.equal(made.body.bus.id_compagnie, compB.id_compagnie);
  // listes et filtres : id_compagnie de l'URL ignoré pour un gestionnaire
  const list = (await gB('GET', `/reservations?id_compagnie=${compA.id_compagnie}`)).body.reservations;
  assert.ok(list.every((r) => r.compagnie_nom === compB.nom));
  assert.ok((await gB('GET', `/horaires?id_compagnie=${compA.id_compagnie}&date_max=${addDays(todayStr(), 2)}`)).body.horaires.every((h) => h.id_compagnie === compB.id_compagnie));
  assert.equal((await gB('GET', '/compagnies')).body.compagnies.length, 1);
  // exports CSV
  const csv = (await gB('GET', '/export/reservations.csv')).body;
  assert.ok(!csv.includes('Secret') && !csv.includes(rA.numero_ticket));
  assert.ok((await A('GET', '/export/reservations.csv')).body.includes(rA.numero_ticket));
  // fonctions réservées à l'administrateur
  for (const [m, u, b] of [['GET', '/utilisateurs'], ['POST', '/utilisateurs', { role: 'admin' }], ['POST', '/compagnies', { nom: 'Z' }], ['PUT', `/utilisateurs/${gestB.id_utilisateur}`, { role: 'admin' }], ['POST', '/paiements/1/rembourse', {}], ['POST', `/utilisateurs/${voyageur.id_utilisateur}/reinitialiser-mot-de-passe`, {}]]) {
    assert.equal((await gB(m, u, b)).status, 403, `${m} ${u}`);
  }
  assert.equal((await as(voyageur)('GET', '/stats')).status, 403);
  assert.equal((await as(null)('GET', '/stats')).status, 401);
  // journal : un gestionnaire ne voit que les événements de sa compagnie
  const ev = (await gB('GET', '/activite')).body.evenements;
  assert.ok(ev.every((e) => e.id_compagnie === compB.id_compagnie));
  await db.cancelReservation(rA.id_reservation);
});

test('paiement réel : pas de double transaction, montant vérifié, confirmation unique', async () => {
  const trip = await freeTrip(compB.id_compagnie, 4);
  providerStatus = 'en_attente'; providerAmount = null;
  const r = await reservations.reserver(voyageur, resa(trip.id_horaire, 2));
  const before = checkouts;
  await payments.initier(voyageur, r.numero_ticket);
  await payments.initier(voyageur, r.numero_ticket);   // deuxième clic : on reprend la même transaction
  assert.equal(checkouts, before + 1, 'une seule transaction créée');
  assert.ok(resumes >= 1);
  assert.equal((await db.listPaymentsByReservation(r.id_reservation)).length, 1);
  const ref = `REF-${checkouts}`;

  // montant différent : NON confirmé, signalé
  providerStatus = 'reussi'; providerAmount = trip.tarif_fcfa - 100;
  assert.equal((await payments.retour({ id: ref })).statut, 'en_attente');
  assert.equal((await db.getReservationById(r.id_reservation)).statut, 'en_attente');
  assert.ok((await db.listAuditLog({ action: 'paiement.anomalie_montant' })).length >= 1);

  // bon montant, retour navigateur + webhook en même temps : une seule confirmation
  providerAmount = trip.tarif_fcfa;
  const [x, y] = await Promise.all([payments.retour({ id: ref }), payments.webhook({ entity: { id: ref } })]);
  assert.equal(x.statut, 'reussi'); assert.ok(y.ok || y.ignore);
  assert.equal((await db.getReservationById(r.id_reservation)).statut, 'confirmee');
  const confirmed = (await db.listAuditLog({ action: 'paiement.confirme', limit: 100 })).filter((e) => e.details.includes(r.numero_ticket));
  assert.equal(confirmed.length, 1, 'confirmé une seule fois');
  assert.deepEqual((await payments.webhook({ entity: { id: ref } })), { ignore: true });
  assert.equal((await payments.retour({ id: ref })).statut, 'reussi');
});

test('double paiement et place déjà prise : l\'argent reçu est signalé « à rembourser »', async () => {
  const trip = await freeTrip(compB.id_compagnie, 6);
  const { r } = await payedReservation(voyageur, trip, 3);
  // le client paie une 2e fois la même réservation (2e transaction chez le prestataire)
  const dup = await db.createPayment({ id_reservation: r.id_reservation, montant_fcfa: trip.tarif_fcfa, mode: 'fedapay', reference_transaction: 'REF-DUP', statut: 'en_attente' });
  providerStatus = 'reussi'; providerAmount = trip.tarif_fcfa;
  const out = await payments.retour({ id: 'REF-DUP' });
  assert.equal(out.statut, 'reussi');
  let list = (await A('GET', '/paiements')).body;
  const row = list.paiements.find((p) => p.id_paiement === dup.id_paiement);
  assert.equal(row.etat, 'a_rembourser'); assert.equal(row.motif_remboursement, 'doublon');
  assert.ok(list.total.a_rembourser >= 1);
  assert.ok((await A('GET', '/tableau-de-bord')).body.alertes.some((a) => a.code === 'remboursements'));

  // seul l'administrateur marque un remboursement, une seule fois
  assert.equal((await as(gestB)('POST', `/paiements/${dup.id_paiement}/rembourse`, {})).status, 403);
  assert.equal((await A('POST', `/paiements/${dup.id_paiement}/rembourse`, { note: 'Remboursé par MoMo' })).status, 200);
  assert.equal((await A('POST', `/paiements/${dup.id_paiement}/rembourse`, {})).status, 409);
  list = (await A('GET', `/paiements?etat=rembourse`)).body;
  assert.ok(list.paiements.some((p) => p.id_paiement === dup.id_paiement));

  // place prise : réservation expirée, la place est réservée par quelqu'un d'autre, puis le paiement arrive
  const trip2 = await freeTrip(compB.id_compagnie, 7);
  providerStatus = 'en_attente';
  const r2 = await reservations.reserver(voyageur, resa(trip2.id_horaire, 4));
  await payments.initier(voyageur, r2.numero_ticket);
  const ref2 = `REF-${checkouts}`;
  await db.cancelReservation(r2.id_reservation);
  await db.createReservation({ numero_ticket: 'VYG-2099-000501', id_utilisateur: voyageur.id_utilisateur, id_horaire: trip2.id_horaire, numero_place: 4, nom_passager: 'Autre', prenom_passager: 'Client', telephone_passager: '+229 01 02 03 04 06', statut: 'confirmee' });
  providerStatus = 'reussi'; providerAmount = trip2.tarif_fcfa;
  assert.equal((await payments.retour({ id: ref2 })).statut, 'place_prise');
  const p2 = (await A('GET', '/paiements?q=' + r2.numero_ticket)).body.paiements[0];
  assert.equal(p2.statut, 'reussi', 'argent reçu : jamais « échoué »');
  assert.equal(p2.etat, 'a_rembourser'); assert.equal(p2.motif_remboursement, 'reservation_annulee');
});

test('paiement simulé : double clic = un seul paiement, jamais compté comme argent encaissé', async () => {
  config.payment.mode = 'simulation';
  try {
    const trip = await freeTrip(compA.id_compagnie, 8);
    const r = await reservations.reserver(voyageur, resa(trip.id_horaire, 6));
    const input = { operateur: 'MTN MoMo', telephone: '+229 01 02 03 04 05' };
    const res = await Promise.allSettled([payments.simuler(voyageur, r.numero_ticket, input), payments.simuler(voyageur, r.numero_ticket, input)]);
    assert.equal(res.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(res.find((x) => x.status === 'rejected').reason.code, 'ALREADY_PAID');
    assert.equal((await db.listPaymentsByReservation(r.id_reservation)).length, 1);
    const row = (await A('GET', '/paiements?q=' + r.numero_ticket)).body.paiements[0];
    assert.equal(row.etat, 'simule'); assert.equal(row.simule, true);
    assert.equal((await A('GET', '/paiements?mode=simule')).body.paiements.every((p) => p.simule), true);
    const dash = (await A('GET', '/tableau-de-bord')).body;
    assert.equal(dash.kpis.chiffre_affaires_simule >= trip.tarif_fcfa, true);
    assert.ok(!dash.alertes.some((a) => a.code === 'remboursements' && /simul/i.test(a.detail || '')));
  } finally { config.payment.mode = 'fedapay'; }
});

test('paiements en attente anciens : « à vérifier »', { skip: process.env.APP_TEST_DB === 'mysql' && 'vieillit la transaction dans le fichier JSON (la base MySQL refuse de modifier la date d\'un paiement)' }, async () => {
  const trip = await freeTrip(compA.id_compagnie, 9);
  const r = await reservations.reserver(voyageur, resa(trip.id_horaire, 8));
  const p = await db.createPayment({ id_reservation: r.id_reservation, montant_fcfa: trip.tarif_fcfa, mode: 'fedapay', reference_transaction: 'REF-OLD', statut: 'en_attente' });
  const state = require('node:fs').readFileSync(config.db.json.file, 'utf8'); // le fichier JSON est la base : on vieillit la transaction
  assert.ok(state.includes('REF-OLD'));
  const { enrichedPayments } = require('../src/services/paymentReport');
  const realNow = Date.now; Date.now = () => realNow() + 2 * 3600000;
  try { const row = (await enrichedPayments({})).rows.find((x) => x.id_paiement === p.id_paiement); assert.equal(row.etat, 'a_verifier'); } finally { Date.now = realNow; }
  await db.cancelReservation(r.id_reservation);
});

test('conflits de bus : chevauchement refusé, correction du tarif toujours possible', async () => {
  const bus = await db.createBus({ id_compagnie: compA.id_compagnie, immatriculation: 'CONF-1', nombre_places: 20 });
  const trajet = (await db.listTrajets({ id_compagnie: compA.id_compagnie })).find((t) => t.ville_depart === 'Cotonou' && t.ville_arrivee === 'Parakou');
  const date = addDays(todayStr(), 11);
  const body = (heure, arr, extra = {}) => ({ id_trajet: trajet.id_trajet, id_bus: bus.id_bus, date_depart: date, heure_depart: heure, heure_arrivee: arr, tarif_fcfa: 8000, statut: 'programme', ...extra });
  const first = await A('POST', '/horaires', body('07:00', '13:30'));
  assert.equal(first.status, 201);
  const overlap = await A('POST', '/horaires', body('10:00', '16:00'));
  assert.equal(overlap.status, 409); assert.equal(overlap.body.code, 'CONFLICT');
  assert.equal((await A('POST', '/horaires', body('13:45', '20:00'))).status, 409, 'moins de 30 min entre deux voyages');
  assert.equal((await A('POST', '/horaires', body('14:00', '20:00'))).status, 201);
  const id = first.body.horaire.id_horaire;
  const edit = await A('PUT', `/horaires/${id}`, body('07:00', '13:30', { tarif_fcfa: 8500 }));
  assert.equal(edit.status, 200); assert.equal(edit.body.horaire.tarif_fcfa, 8500);
  assert.equal((await A('PUT', `/horaires/${id}`, body('12:00', '15:00'))).status, 409, 'déplacer le voyage sur un autre voyage du bus');
  // annulation : réservations annulées, pas de réactivation
  const sold = await reservations.reserver(voyageur, resa(id, 1));
  await db.updateReservationStatus(sold.id_reservation, 'confirmee');
  const cancelled = await A('PUT', `/horaires/${id}`, body('07:00', '13:30', { statut: 'annule' }));
  assert.equal(cancelled.body.reservations_annulees, 1);
  assert.equal((await db.getReservationById(sold.id_reservation)).statut, 'annulee');
  assert.equal((await A('PUT', `/horaires/${id}`, body('07:00', '13:30'))).status, 409);
});

test('trajets et compagnies : doublons refusés, compagnie inactive = plus de vente', async () => {
  const t = (await db.listTrajets({ id_compagnie: compA.id_compagnie }))[0];
  const dup = await A('POST', '/trajets', { id_compagnie: compA.id_compagnie, ville_depart: t.ville_depart.toUpperCase(), ville_arrivee: t.ville_arrivee, lieu_embarquement: t.lieu_embarquement, duree_estimee: 60 });
  assert.equal(dup.status, 409);
  assert.equal((await A('POST', '/compagnies', { nom: ' compagnie TEST a ' })).status, 409);

  const trip = await freeTrip(compA.id_compagnie, 2);
  const d = addDays(todayStr(), 2);
  assert.ok((await catalog.search({ depart: trip.ville_depart, arrivee: trip.ville_arrivee, date: d })).some((h) => h.id_compagnie === compA.id_compagnie));
  const off = await A('PUT', `/compagnies/${compA.id_compagnie}`, { nom: compA.nom, statut: 'inactive' });
  assert.equal(off.status, 200);
  assert.ok(!(await catalog.search({ depart: trip.ville_depart, arrivee: trip.ville_arrivee, date: d })).some((h) => h.id_compagnie === compA.id_compagnie));
  await assert.rejects(reservations.reserver(voyageur, resa(trip.id_horaire, 20)), { code: 'UNAVAILABLE' });
  await A('PUT', `/compagnies/${compA.id_compagnie}`, { nom: compA.nom, statut: 'active' });
  assert.ok((await db.listAuditLog({ action: 'compagnie.desactivee' })).length === 1);
  const fiche = (await A('GET', `/compagnies/${compA.id_compagnie}`)).body;
  assert.equal(fiche.compagnie.nb_bus >= 2, true); assert.ok(fiche.bus.length >= 2); assert.ok(fiche.prochains_voyages.length > 0);
});

test('utilisateurs : comptes administrateurs protégés, mot de passe temporaire', async () => {
  const primary = await db.findUserByEmail('admin@test.local');
  const second = await mkUser({ nom: 'Second', prenom: 'Admin', email: 'admin2@test.local', role: 'admin' });
  // un autre administrateur ne peut ni bloquer ni rétrograder le compte principal
  assert.equal((await as(second)('PUT', `/utilisateurs/${primary.id_utilisateur}`, { statut: 'bloque' })).status, 403);
  // ni changer le mot de passe d'un autre administrateur
  assert.equal((await A('PUT', `/utilisateurs/${second.id_utilisateur}`, { mot_de_passe: 'NouveauMdp123' })).status, 403);
  assert.equal((await A('POST', `/utilisateurs/${second.id_utilisateur}/reinitialiser-mot-de-passe`)).status, 403);
  // dernier administrateur actif
  const solo = await mkUser({ nom: 'Solo', prenom: 'Admin', email: 'solo@test.local', role: 'admin' });
  await db.updateUser(primary.id_utilisateur, { statut: 'bloque' }); await db.updateUser(second.id_utilisateur, { statut: 'bloque' });
  assert.equal((await as(solo)('PUT', `/utilisateurs/${solo.id_utilisateur}`, { role: 'voyageur' })).status, 400, 'pas de rétrogradation de soi-même');
  // « solo » est le seul administrateur actif : un autre compte (même bloqué) ne peut pas le retirer
  const last = await as(second)('PUT', `/utilisateurs/${solo.id_utilisateur}`, { statut: 'bloque' });
  assert.equal(last.status, 409); assert.equal(last.body.code, 'LAST_ADMIN');
  for (const u of [primary, second]) await db.updateUser(u.id_utilisateur, { statut: 'actif' });

  // suspension / réactivation d'un voyageur + journal
  assert.equal((await A('PUT', `/utilisateurs/${voyageur.id_utilisateur}`, { statut: 'bloque' })).body.utilisateur.statut, 'bloque');
  assert.equal((await A('PUT', `/utilisateurs/${voyageur.id_utilisateur}`, { statut: 'actif' })).body.utilisateur.statut, 'actif');
  assert.ok((await db.listAuditLog({ action: 'utilisateur.suspendu' })).length >= 1);
  // mot de passe temporaire : utilisable, jamais écrit dans le journal
  const temp = (await A('POST', `/utilisateurs/${voyageur.id_utilisateur}/reinitialiser-mot-de-passe`)).body.mot_de_passe_temporaire;
  assert.ok(temp.length >= 12);
  assert.ok(await verifyPassword(temp, (await db.findUserById(voyageur.id_utilisateur)).mot_de_passe_hache));
  assert.ok(!JSON.stringify(await db.listAuditLog({ limit: 1000 })).includes(temp));
  // recherche, filtre et pagination
  const found = (await A('GET', '/utilisateurs?q=solo&page=1&limite=5')).body;
  assert.equal(found.utilisateurs.length, 1); assert.equal(found.total, 1);
  assert.ok((await A('GET', '/utilisateurs?role=gestionnaire&statut=actif')).body.utilisateurs.every((u) => u.role === 'gestionnaire'));
  const profil = (await A('GET', `/utilisateurs/${voyageur.id_utilisateur}`)).body;
  assert.ok(profil.reservations.total >= 1); assert.equal(profil.utilisateur.mot_de_passe_hache, undefined);
});

test('réservations : filtres, pagination, fiche détaillée, exports CSV sûrs', async () => {
  const trip = await freeTrip(compB.id_compagnie, 10);
  const r = await reservations.reserver(voyageur, resa(trip.id_horaire, 11, { nom: '=HYPERLINK("http://x")', prenom: '=1+1' }));
  const p1 = (await A('GET', '/reservations?page=1&limite=2')).body;
  assert.ok(p1.reservations.length <= 2 && p1.total >= 1 && p1.pages >= 1);
  assert.equal((await A('GET', `/reservations?q=${r.numero_ticket}`)).body.reservations.length, 1);
  assert.equal((await A('GET', `/reservations?depart=${trip.ville_depart}&arrivee=${trip.ville_arrivee}&date_min=${trip.date_depart}&date_max=${trip.date_depart}&statut=en_attente`)).body.reservations.every((x) => x.statut === 'en_attente'), true);
  assert.equal((await A('GET', '/reservations?statut=nimporte')).status, 400);
  assert.equal((await A('GET', '/reservations?date_min=pas-une-date')).status, 400);
  const f = (await A('GET', `/reservations/${r.id_reservation}`)).body;
  assert.equal(f.reservation.numero_ticket, r.numero_ticket);
  assert.ok(f.historique.some((e) => e.action === 'reservation.creee'));
  const csv = (await A('GET', '/export/reservations.csv')).body;
  assert.ok(csv.startsWith('\uFEFFTicket;'));
  assert.ok(csv.includes(`'=1+1 =HYPERLINK`), 'formules neutralisées');
  assert.ok(!/(^|;|")=/m.test(csv.split('\r\n').slice(1).join('\n')), 'aucune cellule ne commence par =');
  assert.ok(!csv.includes('piece_identite'));
  assert.ok((await db.listAuditLog({ action: 'export.reservations' })).length >= 1);
  const out = await A('POST', `/reservations/${r.id_reservation}/annuler`);
  assert.equal(out.status, 200); assert.equal(out.body.remboursement_a_traiter, false);
  assert.equal((await A('POST', `/reservations/${r.id_reservation}/annuler`)).status, 409);
  const fiche = (await A('GET', `/horaires/${trip.id_horaire}`)).body;
  assert.equal(fiche.horaire.id_horaire, trip.id_horaire); assert.ok(Array.isArray(fiche.places_occupees));
  assert.ok(typeof (await A('GET', '/export/voyages.csv?date_max=' + addDays(todayStr(), 1))).body === 'string');
  assert.ok((await A('GET', '/export/paiements.csv')).body.includes('Montant (FCFA)'));
});

test('annuler un voyage payé : remboursement à traiter signalé', async () => {
  const bus = await db.createBus({ id_compagnie: compB.id_compagnie, immatriculation: 'REMB-1', nombre_places: 10 });
  const trajet = (await db.listTrajets({ id_compagnie: compB.id_compagnie }))[0];
  const h = (await A('POST', '/horaires', { id_trajet: trajet.id_trajet, id_bus: bus.id_bus, date_depart: addDays(todayStr(), 13), heure_depart: '08:00', heure_arrivee: '10:00', tarif_fcfa: 5000, statut: 'programme' })).body.horaire;
  const { r } = await payedReservation(voyageur, h, 1);
  assert.equal((await db.getReservationById(r.id_reservation)).statut, 'confirmee');
  const out = await A('PUT', `/horaires/${h.id_horaire}`, { id_trajet: trajet.id_trajet, id_bus: bus.id_bus, date_depart: h.date_depart, heure_depart: '08:00', heure_arrivee: '10:00', tarif_fcfa: 5000, statut: 'annule' });
  assert.equal(out.body.remboursements_a_traiter, 1);
  const row = (await A('GET', '/paiements?q=' + r.numero_ticket)).body.paiements[0];
  assert.equal(row.etat, 'a_rembourser');
  const dash = (await A('GET', '/tableau-de-bord')).body;
  assert.ok(dash.alertes.some((a) => a.code === 'remboursements' && a.niveau === 'danger'));
  assert.ok(dash.alertes.every((a, i, all) => all.findIndex((b) => b.code === a.code) === i), 'alertes non répétitives');
});

test('chauffeurs : prénom seul, isolation par compagnie, rattachement à un voyage, photo contrôlée', async () => {
  const cA = (await as(gestA)('POST', '/chauffeurs', { prenom: 'Armand' })).body.chauffeur;
  assert.equal(cA.id_compagnie, compA.id_compagnie);
  assert.equal((await as(gestA)('POST', '/chauffeurs', { prenom: 'Armand Dupont' })).status, 400, 'le nom de famille est refusé');
  assert.equal((await as(gestA)('POST', '/chauffeurs', { prenom: 'Zoé', photo: 'https://evil.test/x.png' })).status, 400, 'photo externe refusée');
  // un gestionnaire ne voit ni ne modifie les chauffeurs d'une autre compagnie
  assert.equal((await as(gestB)('PUT', `/chauffeurs/${cA.id_chauffeur}`, { prenom: 'Pirate' })).status, 403);
  assert.equal((await as(gestB)('GET', `/chauffeurs/${cA.id_chauffeur}`)).status, 404);
  assert.ok((await as(gestB)('GET', '/chauffeurs')).body.chauffeurs.every((c) => c.id_compagnie === compB.id_compagnie));
  // un voyage n'accepte qu'un chauffeur de SA compagnie
  const trajet = (await db.listTrajets({ id_compagnie: compA.id_compagnie }))[0];
  const bus = await db.createBus({ id_compagnie: compA.id_compagnie, immatriculation: 'CH-1', nombre_places: 10 });
  const hv = { id_trajet: trajet.id_trajet, id_bus: bus.id_bus, date_depart: addDays(todayStr(), 20), heure_depart: '06:00', heure_arrivee: '08:00', tarif_fcfa: 2000 };
  const cB = (await as(gestB)('POST', '/chauffeurs', { prenom: 'Basile' })).body.chauffeur;
  assert.equal((await as(gestA)('POST', '/horaires', { ...hv, id_chauffeur: cB.id_chauffeur })).status, 400);
  const h = (await as(gestA)('POST', '/horaires', { ...hv, id_chauffeur: cA.id_chauffeur })).body.horaire;
  assert.equal(h.chauffeur_prenom, 'Armand');
  // modifier sans renvoyer le chauffeur (ex. annulation) ne le retire pas
  const put = await as(gestA)('PUT', `/horaires/${h.id_horaire}`, { ...hv, tarif_fcfa: 2500 });
  assert.equal(put.body.horaire.chauffeur_prenom, 'Armand');
  assert.equal((await as(gestA)('DELETE', `/chauffeurs/${cA.id_chauffeur}`)).status, 409, 'chauffeur utilisé : suppression refusée');
  assert.equal((await db.getChauffeur(cA.id_chauffeur)).id_chauffeur, cA.id_chauffeur, 'un chauffeur utilisé par un voyage est conservé');
});

test('lieu d\'embarquement obligatoire pour un trajet', async () => {
  assert.equal((await A('POST', '/trajets', { id_compagnie: compA.id_compagnie, ville_depart: 'Ouidah', ville_arrivee: 'Lomé' })).status, 400);
});

test('suppression de compte : sans historique = supprimé ; avec historique = anonymisé ; protections', async () => {
  const tmp = await mkUser({ nom: 'Tmp', prenom: 'Un', email: 'tmp@test.local', role: 'voyageur' });
  assert.equal((await A('DELETE', `/utilisateurs/${tmp.id_utilisateur}`)).body.mode, 'supprime');
  assert.equal(await db.findUserById(tmp.id_utilisateur), null);
  // avec historique (voyage passé) : données personnelles effacées, compte inutilisable
  const old = await mkUser({ nom: 'Hist', prenom: 'Ancien', email: 'hist@test.local', role: 'voyageur' });
  const trajet = (await db.listTrajets({ id_compagnie: compA.id_compagnie }))[0];
  const bus = await db.createBus({ id_compagnie: compA.id_compagnie, immatriculation: 'DEL-1', nombre_places: 5 });
  // MySQL refuse de réserver un voyage déjà parti : on réserve sur un voyage à venir, puis on recule sa date.
  const hp = await db.createHoraire({ id_trajet: trajet.id_trajet, id_bus: bus.id_bus, date_depart: addDays(todayStr(), 40), heure_depart: '08:00', heure_arrivee: '09:00', tarif_fcfa: 1000 });
  await db.createReservation({ numero_ticket: 'VYG-2099-000601', id_utilisateur: old.id_utilisateur, id_horaire: hp.id_horaire, numero_place: 1, nom_passager: 'Hist', prenom_passager: 'Ancien', telephone_passager: '+22901020304', statut: 'confirmee' });
  await db.updateHoraire(hp.id_horaire, { date_depart: addDays(todayStr(), -5) });
  const out = await A('DELETE', `/utilisateurs/${old.id_utilisateur}`);
  assert.equal(out.body.mode, 'anonymise');
  const after = await db.findUserById(old.id_utilisateur);
  assert.equal(after.statut, 'bloque'); assert.ok(after.email.endsWith('@voyageo.invalid')); assert.equal(after.prenom, 'Supprimé'); assert.equal(after.telephone, null);
  assert.equal(await db.findUserByEmail('hist@test.local'), null);
  // voyage à venir : refusé
  const live = await mkUser({ nom: 'Live', prenom: 'Futur', email: 'live@test.local', role: 'voyageur' });
  const hf = await db.createHoraire({ id_trajet: trajet.id_trajet, id_bus: bus.id_bus, date_depart: addDays(todayStr(), 7), heure_depart: '08:00', heure_arrivee: '09:00', tarif_fcfa: 1000 });
  await db.createReservation({ numero_ticket: 'VYG-2099-000602', id_utilisateur: live.id_utilisateur, id_horaire: hf.id_horaire, numero_place: 1, nom_passager: 'L', prenom_passager: 'F', telephone_passager: '+22901020304', statut: 'confirmee' });
  assert.equal((await A('DELETE', `/utilisateurs/${live.id_utilisateur}`)).status, 409);
  // protections
  assert.equal((await A('DELETE', `/utilisateurs/${admin.id_utilisateur}`)).status, 400, 'pas son propre compte');
  assert.equal((await as(gestA)('DELETE', `/utilisateurs/${voyageur.id_utilisateur}`)).status, 403, 'réservé à l\'administrateur');
});
