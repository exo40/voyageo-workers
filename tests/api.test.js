'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv, startServer, Client } = require('./helpers');
setupEnv();
const { todayStr, addDays } = require('../src/utils/time');

let srv, date;
const person = (n) => ({ prenom: 'Test', nom: `Voyageur${n}`, email: `voyageur${n}@test.local`, telephone: '+229 01 02 03 04 05', consentement: true, mot_de_passe: 'MotDePasse123' });
const passenger = (id, place) => ({ id_horaire: id, numero_place: place, prenom: 'Awa', nom: 'Test', telephone: '+229 01 02 03 04 05' });

test.before(async () => { srv = await startServer(); date = addDays(todayStr(), 3); });
test.after(async () => { await srv.close(); });

test('configuration publique et villes', async () => {
  const c = await new Client(srv.base).init();
  assert.equal((await c.get('/api/config')).data.paiement.mode, 'off');
  assert.ok((await c.get('/api/villes')).data.villes.includes('Cotonou'));
});

test('sécurité : écriture sans jeton CSRF refusée, sans connexion refusée', async () => {
  const c = new Client(srv.base);
  assert.equal((await c.post('/api/auth/connexion', { email: 'a@b.cd', consentement: true, mot_de_passe: 'x' })).status, 403);
  await c.init();
  assert.equal((await c.post('/api/reservations', passenger(1, 1))).status, 401);
  assert.equal((await c.get('/api/admin/stats')).status, 401);
  assert.equal((await c.get('/api/reservations/moi')).status, 401);
});

test('inscription, connexion, déconnexion, mot de passe', async () => {
  const c = await new Client(srv.base).init();
  const r = await c.post('/api/auth/inscription', person(1));
  assert.equal(r.status, 201); assert.equal(r.data.user.role, 'voyageur'); assert.ok(!('mot_de_passe_hache' in r.data.user));
  assert.equal((await c.get('/api/auth/moi')).data.user.email, 'voyageur1@test.local');
  assert.equal((await c.post('/api/auth/deconnexion')).status, 200);
  assert.equal((await c.get('/api/auth/moi')).data.user, null);
  await c.init();
  assert.equal((await c.post('/api/auth/connexion', { email: 'voyageur1@test.local', consentement: true, mot_de_passe: 'mauvais' })).status, 401);
  assert.equal((await c.post('/api/auth/connexion', { email: 'VOYAGEUR1@test.local', consentement: true, mot_de_passe: 'MotDePasse123' })).status, 200);
  assert.equal((await c.post('/api/auth/mot-de-passe', { actuel: 'faux', nouveau: 'NouveauMdp123' })).status, 400);
  assert.equal((await c.post('/api/auth/mot-de-passe', { actuel: 'MotDePasse123', nouveau: 'NouveauMdp123' })).status, 200);
  assert.equal((await new Client(srv.base).init().then((x) => x.post('/api/auth/inscription', { ...person(1) }))).status, 409);
  assert.equal((await new Client(srv.base).init().then((x) => x.post('/api/auth/inscription', { ...person(9), consentement: true, mot_de_passe: 'court' }))).status, 400);
});

test('recherche de voyages', async () => {
  const c = await new Client(srv.base).init();
  const ok = await c.get(`/api/horaires?depart=cotonou&arrivee=PARAKOU&date=${date}`);
  assert.equal(ok.status, 200); assert.ok(ok.data.horaires.length >= 2);
  assert.ok(ok.data.horaires.every((h) => h.reservable && h.places_restantes > 0));
  assert.equal((await c.get(`/api/horaires?depart=Cotonou&arrivee=Cotonou&date=${date}`)).status, 400);
  assert.equal((await c.get('/api/horaires?depart=Cotonou&arrivee=Parakou&date=2020-01-01')).status, 400);
  assert.equal((await c.get('/api/horaires?depart=Cotonou&arrivee=Parakou&date=pas-une-date')).status, 400);
});

test('réservation complète : place unique, ticket, droits, annulation', async () => {
  const a = await new Client(srv.base).init(); await a.post('/api/auth/inscription', person(2));
  const b = await new Client(srv.base).init(); await b.post('/api/auth/inscription', person(3));
  const list = (await a.get(`/api/horaires?depart=Cotonou&arrivee=Parakou&date=${date}`)).data.horaires;
  const id = list[0].id_horaire;
  const before = (await a.get(`/api/horaires/${id}`)).data;
  assert.deepEqual(before.places_occupees, []);

  const r1 = await a.post('/api/reservations', passenger(id, 5));
  assert.equal(r1.status, 201); assert.equal(r1.data.reservation.statut, 'confirmee'); assert.match(r1.data.reservation.numero_ticket, /^VYG-\d{4}-\d{6}$/);
  const ticket = r1.data.reservation.numero_ticket;

  const dup = await b.post('/api/reservations', passenger(id, 5));
  assert.equal(dup.status, 409); assert.equal(dup.data.code, 'SEAT_TAKEN');
  assert.equal((await b.post('/api/reservations', passenger(id, 999))).status, 400);
  assert.equal((await b.post('/api/reservations', { ...passenger(id, 6), telephone: 'abc' })).status, 400);
  assert.deepEqual((await a.get(`/api/horaires/${id}`)).data.places_occupees, [5]);

  const t = await a.get(`/api/reservations/${ticket}`);
  assert.equal(t.status, 200); assert.ok(t.data.qr.startsWith('data:image/png')); assert.equal(t.data.annulable, true);
  assert.equal((await b.get(`/api/reservations/${ticket}`)).status, 404);
  assert.equal((await b.post(`/api/reservations/${ticket}/annuler`)).status, 404);
  const v = await new Client(srv.base).get(`/api/verifier/${ticket}`);
  assert.equal(v.data.valide, true); assert.ok(!JSON.stringify(v.data).includes('Test Voyageur')); assert.match(v.data.passager, /^Awa T\.$/);

  assert.equal((await a.get('/api/reservations/moi')).data.reservations.length, 1);
  const cancel = await a.post(`/api/reservations/${ticket}/annuler`);
  assert.equal(cancel.status, 200); assert.equal(cancel.data.reservation.statut, 'annulee');
  assert.equal((await a.post(`/api/reservations/${ticket}/annuler`)).status, 409);
  assert.deepEqual((await a.get(`/api/horaires/${id}`)).data.places_occupees, []);
  assert.equal((await b.post('/api/reservations', passenger(id, 5))).status, 201);
});

test('annulation refusée trop tard (moins de 24 h avant le départ)', async () => {
  const c = await new Client(srv.base).init(); await c.post('/api/auth/inscription', person(4));
  const today = todayStr();
  const list = (await c.get(`/api/horaires?depart=Cotonou&arrivee=Porto-Novo&date=${addDays(today, 1)}`)).data.horaires;
  const h = list[list.length - 1];
  const r = await c.post('/api/reservations', passenger(h.id_horaire, 1));
  assert.equal(r.status, 201);
  const out = await c.post(`/api/reservations/${r.data.reservation.numero_ticket}/annuler`);
  const departMs = new Date(`${h.date_depart}T${h.heure_depart}:00+01:00`).getTime();
  assert.equal(out.status, departMs - Date.now() < 24 * 3600000 ? 409 : 200);
});

test('administration : droits, CRUD, annulation en cascade, blocage', async () => {
  const anon = await new Client(srv.base).init();
  const user = await new Client(srv.base).init(); await user.post('/api/auth/inscription', person(5));
  assert.equal((await user.get('/api/admin/stats')).status, 403);
  assert.equal((await anon.post('/api/auth/connexion', { email: 'admin@test.local', consentement: true, mot_de_passe: 'faux' })).status, 401);

  const admin = await new Client(srv.base).init();
  const login = await admin.post('/api/auth/connexion', { email: 'admin@test.local', consentement: true, mot_de_passe: 'MotDePasse#Test1' });
  assert.equal(login.status, 200); assert.equal(login.data.user.role, 'admin');
  const stats = (await admin.get('/api/admin/stats')).data;
  assert.ok(stats.trajets_actifs > 0 && stats.utilisateurs >= 4);

  const comp = (await admin.post('/api/admin/compagnies', { nom: 'Compagnie Admin Test', email: 'a@test.local' })).data.compagnie;
  assert.equal((await admin.post('/api/admin/compagnies', { nom: '', statut: 'active' })).status, 400);
  const bus = (await admin.post('/api/admin/bus', { id_compagnie: comp.id_compagnie, immatriculation: 'zz-100', nombre_places: 12 })).data.bus;
  assert.equal(bus.immatriculation, 'ZZ-100');
  assert.equal((await admin.post('/api/admin/bus', { id_compagnie: comp.id_compagnie, immatriculation: 'ZZ-100', nombre_places: 12 })).status, 409);
  assert.equal((await admin.post('/api/admin/bus', { id_compagnie: comp.id_compagnie, immatriculation: 'ZZ-101', nombre_places: 500 })).status, 400);
  const tr = (await admin.post('/api/admin/trajets', { id_compagnie: comp.id_compagnie, ville_depart: 'Cotonou', ville_arrivee: 'Ouidah', lieu_embarquement: 'Gare de Cotonou', duree_estimee: 60 })).data.trajet;
  assert.equal((await admin.post('/api/admin/trajets', { id_compagnie: comp.id_compagnie, ville_depart: 'Cotonou', ville_arrivee: 'cotonou' })).status, 400);
  const d = addDays(todayStr(), 5);
  const hor = { id_trajet: tr.id_trajet, id_bus: bus.id_bus, date_depart: d, heure_depart: '10:00', heure_arrivee: '11:00', tarif_fcfa: 1000 };
  const h1 = (await admin.post('/api/admin/horaires', hor)).data.horaire;
  assert.equal((await admin.post('/api/admin/horaires', hor)).status, 409);
  assert.equal((await admin.post('/api/admin/horaires', { ...hor, tarif_fcfa: 5 })).status, 400);

  const found = (await user.get(`/api/horaires?depart=Cotonou&arrivee=Ouidah&date=${d}`)).data.horaires;
  assert.equal(found.length, 1);
  const resa = (await user.post('/api/reservations', passenger(h1.id_horaire, 2))).data.reservation;
  assert.equal((await admin.get(`/api/admin/reservations?id_horaire=${h1.id_horaire}`)).data.reservations.length, 1);
  assert.equal((await admin.del(`/api/admin/horaires/${h1.id_horaire}`)).status, 409);
  assert.equal((await admin.del(`/api/admin/bus/${bus.id_bus}`)).status, 409);

  const upd = await admin.put(`/api/admin/horaires/${h1.id_horaire}`, { ...hor, statut: 'annule' });
  assert.equal(upd.status, 200); assert.equal(upd.data.reservations_annulees, 1);
  assert.equal((await user.get(`/api/reservations/${resa.numero_ticket}`)).data.reservation.statut, 'annulee');
  assert.equal((await user.get(`/api/horaires?depart=Cotonou&arrivee=Ouidah&date=${d}`)).data.horaires.length, 0);

  // gestionnaire limité à sa compagnie
  const gp = { nom: 'Gest', prenom: 'Ionnaire', email: 'gest@test.local', mot_de_passe: 'MotDePasse123', role: 'gestionnaire', id_compagnie: comp.id_compagnie };
  assert.equal((await admin.post('/api/admin/utilisateurs', { ...gp, id_compagnie: '' })).status, 400);
  assert.equal((await admin.post('/api/admin/utilisateurs', gp)).status, 201);
  const gest = await new Client(srv.base).init();
  assert.equal((await gest.post('/api/auth/connexion', { email: 'gest@test.local', consentement: true, mot_de_passe: 'MotDePasse123' })).status, 200);
  assert.equal((await gest.get('/api/admin/bus')).data.bus.length, 1);
  assert.equal((await gest.get('/api/admin/compagnies')).data.compagnies.length, 1);
  assert.equal((await gest.get('/api/admin/utilisateurs')).status, 403);
  assert.equal((await gest.post('/api/admin/compagnies', { nom: 'Pirate' })).status, 403);
  const other = (await admin.get('/api/admin/bus')).data.bus.find((x) => x.id_compagnie !== comp.id_compagnie);
  assert.equal((await gest.put(`/api/admin/bus/${other.id_bus}`, { immatriculation: 'HACK-1', nombre_places: 10 })).status, 403);
  assert.equal((await gest.del(`/api/admin/bus/${other.id_bus}`)).status, 403);
  assert.equal((await gest.post('/api/admin/bus', { id_compagnie: other.id_compagnie, immatriculation: 'MINE-1', nombre_places: 20 })).data.bus.id_compagnie, comp.id_compagnie);

  // blocage d'un compte : il est déconnecté immédiatement et ne peut plus se connecter
  const uid = (await user.get('/api/auth/moi')).data.user.id_utilisateur;
  assert.equal((await admin.put(`/api/admin/utilisateurs/${uid}`, { statut: 'bloque' })).status, 200);
  assert.equal((await user.get('/api/auth/moi')).data.user, null);
  assert.equal((await new Client(srv.base).init().then((x) => x.post('/api/auth/connexion', { email: 'voyageur5@test.local', consentement: true, mot_de_passe: 'MotDePasse123' }))).status, 403);
  // l'administrateur ne peut pas se bloquer lui-même
  const aid = login.data.user.id_utilisateur;
  assert.equal((await admin.put(`/api/admin/utilisateurs/${aid}`, { statut: 'bloque' })).status, 400);
});

test('pages : accueil, ressources, page admin protégée, 404', async () => {
  const get = (p) => fetch(srv.base + p, { redirect: 'manual' });
  assert.equal((await get('/')).status, 200);
  assert.equal((await get('/js/ui.js')).status, 200);
  const adm = await get('/admin'); assert.equal(adm.status, 302); assert.match(adm.headers.get('location'), /^\/connexion\.html\?suite=/);
  assert.equal((await get('/private/admin.html')).status, 404);
  assert.equal((await get('/api/inexistant')).status, 404);
});
