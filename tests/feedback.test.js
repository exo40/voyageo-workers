'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv } = require('./helpers');
setupEnv({ PAYMENT_MODE: 'simulation', DEMO_DATA: 'false' });
// Le QR code n'est pas l'objet de ce test : on évite d'exiger la bibliothèque « qrcode » (déjà couverte par les autres tests).
const Module = require('node:module'); const origLoad = Module._load;
Module._load = function load(request, ...rest) { return request === 'qrcode' ? { toDataURL: async () => 'data:image/png;base64,AAAA' } : origLoad.call(this, request, ...rest); };
const db = require('../src/db');
const feedback = require('../src/services/feedbackService');
const reservations = require('../src/services/reservationService');
const uploads = require('../src/services/uploadService');
const { todayStr, addDays } = require('../src/utils/time');

let user, other, resPast, resFuture, driver;
test.before(async () => {
  await db.init();
  const c = await db.createCompagnie({ nom: 'Cie Avis' });
  const bus = await db.createBus({ id_compagnie: c.id_compagnie, immatriculation: 'AV-1', nombre_places: 20 });
  const tr = await db.createTrajet({ id_compagnie: c.id_compagnie, ville_depart: 'Cotonou', ville_arrivee: 'Parakou', lieu_embarquement: 'Gare', duree_estimee: 60 });
  driver = await db.createChauffeur({ id_compagnie: c.id_compagnie, prenom: 'Koffi' });
  user = await db.createUser({ nom: 'N', prenom: 'P', email: 'p@a.test', mot_de_passe_hache: 'x' });
  other = await db.createUser({ nom: 'N', prenom: 'Q', email: 'q@a.test', mot_de_passe_hache: 'x' });
  const past = await db.createHoraire({ id_trajet: tr.id_trajet, id_bus: bus.id_bus, id_chauffeur: driver.id_chauffeur, date_depart: addDays(todayStr(), 40), heure_depart: '08:00', heure_arrivee: '10:00', tarif_fcfa: 1000 });   // à venir : MySQL refuse de réserver un voyage déjà parti
  const fut = await db.createHoraire({ id_trajet: tr.id_trajet, id_bus: bus.id_bus, id_chauffeur: driver.id_chauffeur, date_depart: addDays(todayStr(), 3), heure_depart: '08:00', heure_arrivee: '10:00', tarif_fcfa: 1000 });
  const mk = (h, place, n) => db.createReservation({ numero_ticket: n, id_utilisateur: user.id_utilisateur, id_horaire: h.id_horaire, numero_place: place, nom_passager: 'N', prenom_passager: 'P', telephone_passager: '+22901020304', statut: 'confirmee' });
  resPast = await mk(past, 1, 'VYG-2099-000701'); resFuture = await mk(fut, 2, 'VYG-2099-000702');
  await db.updateHoraire(past.id_horaire, { date_depart: addDays(todayStr(), -2) });   // le voyage est maintenant passé
});
test.after(() => db.close());

test('avis : refusé avant la fin du voyage et pour un autre voyageur, accepté une seule fois', async () => {
  await assert.rejects(feedback.noter(user, resFuture.numero_ticket, { note: 5 }), (e) => e.code === 'NOT_ENDED');
  await assert.rejects(feedback.noter(other, resPast.numero_ticket, { note: 5 }), (e) => e.status === 404 || e.status === 403);
  await assert.rejects(feedback.noter(user, resPast.numero_ticket, { note: 6 }), (e) => e.code === 'VALIDATION');
  await feedback.noter(user, resPast.numero_ticket, { note: 4, commentaire: 'Conduite prudente' });
  await assert.rejects(feedback.noter(user, resPast.numero_ticket, { note: 5 }), (e) => e.code === 'ALREADY');
  await feedback.noter(user, resPast.numero_ticket, { note: 5 }).catch(() => {});
  const d = await db.getChauffeur(driver.id_chauffeur);
  assert.equal(d.note, 4); assert.equal(d.nb_avis, 1);
  const h = await db.getHoraire(resPast.id_horaire);
  assert.equal(h.chauffeur_prenom, 'Koffi'); assert.equal(h.chauffeur_note, 4);
});

test('pourboire simulé : montant contrôlé, compté pour le chauffeur', async () => {
  await assert.rejects(feedback.pourboireSimule(user, resPast.numero_ticket, { montant: 10, operateur: 'MTN MoMo', telephone: '+229 01 02 03 04' }), (e) => e.code === 'VALIDATION');
  await assert.rejects(feedback.pourboireSimule(user, resFuture.numero_ticket, { montant: 500, operateur: 'MTN MoMo', telephone: '+229 01 02 03 04' }), (e) => e.code === 'NOT_ENDED');
  await feedback.pourboireSimule(user, resPast.numero_ticket, { montant: 500, operateur: 'MTN MoMo', telephone: '+229 01 02 03 04' });
  const tips = await db.listTips({ id_chauffeur: driver.id_chauffeur });
  assert.equal(tips.length, 1); assert.equal(tips[0].montant_fcfa, 500); assert.equal(tips[0].statut, 'reussi');
});

test('vue du ticket : avis et pourboire proposés seulement après le voyage', async () => {
  const a = await reservations.ticketView(user, resPast.numero_ticket);
  assert.equal(a.retour.possible, true); assert.equal(a.retour.avis.note, 4); assert.equal(a.retour.pourboires_recus_fcfa, 500);
  const b = await reservations.ticketView(user, resFuture.numero_ticket);
  assert.equal(b.retour.possible, false);
});

test('suppression : un chauffeur utilisé par des voyages ne peut pas être supprimé ; un compte avec historique est refusé en base (IN_USE)', async () => {
  await assert.rejects(db.deleteChauffeur(driver.id_chauffeur), (e) => e.code === 'IN_USE');
  await assert.rejects(db.deleteUser(user.id_utilisateur), (e) => e.code === 'IN_USE');
  const lone = await db.createUser({ nom: 'S', prenom: 'S', email: 's@a.test', mot_de_passe_hache: 'x' });
  assert.equal(await db.deleteUser(lone.id_utilisateur), true);
});

test('photos : seuls les vrais JPEG/PNG/WebP sont acceptés, sous un nom aléatoire', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)]).toString('base64');
  const url = await uploads.saveImage(`data:image/png;base64,${png}`);
  assert.match(url, uploads.URL_RE);
  uploads.removeImage(url);
  await assert.rejects(uploads.saveImage(`data:image/png;base64,${Buffer.from('<script>alert(1)</script>0000000').toString('base64')}`), (e) => e.status === 400);
  await assert.rejects(uploads.saveImage('data:text/html;base64,PGI+'), (e) => e.status === 400);
  await assert.rejects(uploads.saveImage(`data:image/jpeg;base64,${Buffer.alloc(2 * 1024 * 1024).toString('base64')}`), (e) => e.status === 413);
  assert.throws(() => require('../src/utils/validate').optPhoto('https://evil.test/x.png'), (e) => e.status === 400);
  assert.equal(require('../src/utils/validate').optPhoto(''), null);
});
