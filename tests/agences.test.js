'use strict';
/**
 * AGENCES DE TRANSPORT : inscription, abonnement de 20 000 FCFA, verrouillage de l'espace, clés FedaPay propres à chaque compagnie.
 * (Logique des routes via tests/support/fake-express.js : aucune installation nécessaire.)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setupEnv } = require('./helpers');
setupEnv({ PAYMENT_MODE: 'fedapay', FEDAPAY_SECRET_KEY: 'sk_sandbox_PLATEFORME_0000' });
const { call } = require('./support/fake-express');
const config = require('../src/config');
const db = require('../src/db');
const { todayStr, addDays } = require('../src/utils/time');
const auth = require('../src/services/authService');
const { seedIfEmpty } = require('../src/services/demoData');
const reservations = require('../src/services/reservationService');
const payments = require('../src/services/paymentService');
const catalog = require('../src/services/catalogService');
const subscription = require('../src/services/subscriptionService');
const fedapay = require('../src/payments/fedapay');
const router = require('../src/routes/admin');

// ---------- faux FedaPay : mémorise les clés utilisées pour chaque appel ----------
const seen = { checkouts: [], status: [], resumes: 0 };
let txCounter = 1000, providerStatus = 'reussi', providerAmount = null;
fedapay.createCheckout = async (a) => { seen.checkouts.push(a); return { reference: String(++txCounter), url: 'https://sandbox-process.fedapay.com/x' }; };
fedapay.resumeCheckout = async () => { seen.resumes += 1; return 'https://sandbox-process.fedapay.com/reprise'; };
fedapay.getStatusDetail = async (ref, creds) => { seen.status.push({ ref, creds }); return { statut: providerStatus, montant: providerAmount }; };
fedapay.verifyCredentials = async (creds) => ({ valide: !creds.secretKey.includes('REFUSEE') });

const SK = 'sk_sandbox_AGENCE_SECRETE_9f3a7c21', PK = 'pk_sandbox_AGENCE_PUBLIQUE_55d1';
const PW = 'MotDePasse123';
const as = (user) => (m, u, b) => call(router, m, u, { user, body: b });
let admin, A;     // administrateur
const reg = async (n, extra = {}) => auth.register({ type: 'agence', nom: 'Gest', prenom: n, email: `${n.toLowerCase()}@agence.test`, telephone: '+229 01 02 03 04 05', mot_de_passe: PW, consentement: true, compagnie: { nom: `Agence ${n}`, telephone: '+229 01 99 99 99 99', adresse: 'Cotonou' }, ...extra });
async function fresh(user) { return auth.publicUser(await db.findUserById(user.id_utilisateur)); }

test.before(async () => {
  await db.init(); await auth.ensureAdmin(); await seedIfEmpty();
  admin = auth.publicUser(await db.findUserByEmail('admin@test.local')); A = as(admin);
});
test.after(async () => { await db.close(); });

test('inscription d\'une agence : compagnie + gestionnaire, abonnement en attente ; un client reste un client', async () => {
  const u = await reg('Alpha');
  assert.equal(u.role, 'gestionnaire'); assert.ok(u.id_compagnie);
  const c = await db.getCompagnie(u.id_compagnie);
  assert.equal(c.nom, 'Agence Alpha'); assert.equal(c.abonnement_statut, 'en_attente'); assert.equal(c.statut, 'active');
  assert.equal(subscription.stateOf(c).actif, false);
  assert.ok((await db.listAuditLog({ action: 'compagnie.inscription' })).length >= 1);
  // nom déjà pris (casse et accents ignorés), champs manquants
  await assert.rejects(reg('Beta', { compagnie: { nom: ' agence ALPHA ', telephone: '+229 01 99 99 99 99' } }), { code: 'DUPLICATE' });
  await assert.rejects(reg('Gamma', { compagnie: { nom: '', telephone: '+229 01 99 99 99 99' } }), { code: 'VALIDATION' });
  await assert.rejects(reg('Alpha'), { code: 'DUPLICATE_EMAIL' });
  assert.equal((await db.listCompagnies()).filter((x) => x.nom.includes('Gamma')).length, 0, 'aucune compagnie orpheline');
  // inscription normale : aucun lien avec une compagnie
  const client = await auth.register({ nom: 'Client', prenom: 'Simple', email: 'client@test.local', telephone: '+229 01 02 03 04 05', mot_de_passe: PW, consentement: true, type: 'agence' === 'x' ? 'agence' : undefined });
  assert.equal(client.role, 'voyageur'); assert.equal(client.id_compagnie, null);
});

test('espace verrouillé tant que l\'abonnement n\'est pas payé ; seule la page abonnement reste ouverte', async () => {
  const u = await reg('Verrou'); const M = as(u);
  const st = (await M('GET', '/abonnement')).body;
  assert.equal(st.etat, 'en_attente'); assert.equal(st.prix_fcfa, 20000); assert.equal(st.actif, false);
  for (const [m, url, b] of [['GET', '/tableau-de-bord'], ['GET', '/horaires'], ['GET', '/reservations'], ['POST', '/bus', { immatriculation: 'X', nombre_places: 20 }], ['GET', '/parametres-paiement'], ['GET', '/export/reservations.csv'], ['GET', '/paiements']]) {
    const r = await M(m, url, b); assert.equal(r.status, 402, `${m} ${url}`); assert.equal(r.body.code, 'SUBSCRIPTION_REQUIRED');
  }
  // l'administrateur et les gestionnaires normaux ne sont pas touchés
  assert.equal((await A('GET', '/horaires')).status, 200);
  assert.equal((await as(admin)('POST', '/abonnement/payer')).status, 403, 'réservé aux gestionnaires');
  assert.equal((await as(admin)('GET', '/abonnement')).status, 403);
});

test('paiement de l\'abonnement (FedaPay de la plateforme) : 20 000 FCFA vérifiés, une seule activation', async () => {
  const u = await reg('Abo'); const M = as(u); const cid = u.id_compagnie;
  providerStatus = 'en_attente'; providerAmount = null;
  const n0 = seen.checkouts.length;
  assert.ok((await M('POST', '/abonnement/payer')).body.url);
  assert.ok((await M('POST', '/abonnement/payer')).body.url);
  assert.equal(seen.checkouts.length, n0 + 1, 'double clic : une seule transaction');
  const co = seen.checkouts.at(-1);
  assert.equal(co.amount, 20000); assert.equal(co.creds, undefined, 'compte de la PLATEFORME');
  assert.match(co.callbackUrl, new RegExp(`/abonnement/retour\\?c=${cid}$`));
  const ref = String(txCounter);
  // mauvaise compagnie dans l'adresse de retour : refusé
  await assert.rejects(subscription.retour({ id: ref, c: String(cid + 99) }), { code: 'PAY_RETURN' });
  // montant différent : pas d'activation
  providerStatus = 'reussi'; providerAmount = 5000;
  assert.equal((await subscription.retour({ id: ref, c: String(cid) })).statut, 'en_attente');
  assert.equal(subscription.stateOf(await db.getCompagnie(cid)).actif, false);
  assert.ok((await db.listAuditLog({ action: 'abonnement.anomalie_montant' })).length >= 1);
  // bon montant, retour + webhook en même temps
  providerAmount = 20000;
  const [r1, r2] = await Promise.all([subscription.retour({ id: ref, c: String(cid) }), payments.webhook({ entity: { id: ref } })]);
  assert.equal(r1.statut, 'reussi'); assert.ok(r2.ok || r2.ignore);
  const c = await db.getCompagnie(cid);
  assert.equal(c.abonnement_statut, 'actif'); assert.equal(c.abonnement_expire_le, addDays(todayStr(), 30));
  assert.equal((await subscription.retour({ id: ref, c: String(cid) })).statut, 'reussi');
  assert.equal((await db.getCompagnie(cid)).abonnement_expire_le, addDays(todayStr(), 30), 'jamais deux fois');
  assert.equal((await M('GET', '/tableau-de-bord')).status, 200, 'espace déverrouillé');
  assert.equal((await M('GET', '/abonnement')).body.historique[0].statut, 'reussi');
  // renouvellement : s'ajoute à la période en cours
  providerStatus = 'en_attente'; await M('POST', '/abonnement/payer'); providerStatus = 'reussi'; providerAmount = 20000;
  await subscription.retour({ id: String(txCounter), c: String(cid) });
  assert.equal((await db.getCompagnie(cid)).abonnement_expire_le, addDays(todayStr(), 60));
});

test('abonnement échu : espace et voyages de nouveau verrouillés ; l\'administrateur peut activer, suspendre, dispenser', async () => {
  const u = await reg('Echu'); const M = as(u); const cid = u.id_compagnie;
  assert.ok([402, 403].includes((await as(u)('POST', `/compagnies/${cid}/abonnement`, { action: 'activer' })).status), 'un gestionnaire ne s\'active pas lui-même');
  assert.equal((await db.getCompagnie(cid)).abonnement_statut, 'en_attente');
  assert.equal((await A('POST', `/compagnies/${cid}/abonnement`, { action: 'activer', jours: 10, note: 'Espèces' })).status, 200);
  assert.equal((await db.getCompagnie(cid)).abonnement_expire_le, addDays(todayStr(), 10));
  assert.equal((await M('GET', '/horaires')).status, 200);
  await db.updateCompagnie(cid, { abonnement_expire_le: addDays(todayStr(), -1) });
  const r = await M('GET', '/horaires'); assert.equal(r.status, 402); assert.match(r.body.erreur, /expiré/);
  assert.equal((await M('GET', '/abonnement')).body.etat, 'expire');
  await A('POST', `/compagnies/${cid}/abonnement`, { action: 'activer' });
  assert.equal((await M('GET', '/horaires')).status, 200);
  await A('POST', `/compagnies/${cid}/abonnement`, { action: 'suspendre' });
  assert.equal((await M('GET', '/horaires')).status, 402);
  await A('POST', `/compagnies/${cid}/abonnement`, { action: 'dispenser' });
  assert.equal((await M('GET', '/horaires')).status, 200);
  assert.ok((await db.listAuditLog({ action: 'abonnement.active_manuellement' })).length >= 2);
  assert.equal((await A('POST', `/compagnies/${cid}/abonnement`, { action: 'nimporte' })).status, 400);
  const list = (await A('GET', '/compagnies')).body.compagnies.find((c) => c.id_compagnie === cid);
  assert.equal(list.abonnement.etat, 'non_requis');
});

test('clés FedaPay de la compagnie : validées, chiffrées en base, jamais renvoyées', { skip: process.env.APP_TEST_DB === 'mysql' && 'lit le fichier JSON de la base (à vérifier à la main sur MySQL : colonne secret_key_enc)' }, async () => {
  const u = await reg('Cles'); const M = as(u);
  await A('POST', `/compagnies/${u.id_compagnie}/abonnement`, { action: 'activer' });
  const ok = { public_key: PK, secret_key: SK, mot_de_passe: PW };
  assert.equal((await M('PUT', '/parametres-paiement', { ...ok, public_key: 'abc' })).status, 400);
  assert.equal((await M('PUT', '/parametres-paiement', { ...ok, secret_key: 'sk_live_AAAAAAAAAAAA' })).status, 400, 'sandbox / live mélangés');
  assert.equal((await M('PUT', '/parametres-paiement', { ...ok, mot_de_passe: 'mauvais' })).status, 403);
  assert.equal((await M('PUT', '/parametres-paiement', { ...ok, secret_key: 'sk_sandbox_REFUSEE_00000000' })).status, 400, 'clé refusée par FedaPay');
  assert.equal((await M('GET', '/parametres-paiement')).body.configure, false);
  const saved = await M('PUT', '/parametres-paiement', ok);
  assert.equal(saved.status, 200); assert.equal(saved.body.configure, true); assert.equal(saved.body.env, 'sandbox');
  const shown = JSON.stringify((await M('GET', '/parametres-paiement')).body);
  assert.ok(!shown.includes(SK) && !shown.includes('AGENCE_SECRETE'), 'clé secrète jamais renvoyée');
  assert.ok(!shown.includes(PK), 'clé publique masquée');
  assert.match(shown, /9f3a7c21|7c21/); assert.ok(shown.includes(`/paiement/webhook/${u.id_compagnie}`));
  // en base : chiffrée
  const file = fs.readFileSync(config.db.json.file, 'utf8');
  assert.ok(!file.includes(SK), 'clé secrète illisible dans la base');
  assert.match((await db.getCompanyPaymentSettings(u.id_compagnie)).secret_key_enc, /^v1\./);
  assert.deepEqual(await require('../src/services/companyPaymentService').credsFor(u.id_compagnie), { secretKey: SK, env: 'sandbox' });
  // jamais dans les listes de l'administration ni dans le journal
  const everything = JSON.stringify([(await A('GET', '/compagnies')).body, (await A('GET', `/compagnies/${u.id_compagnie}`)).body, (await A('GET', '/activite?limite=100')).body, await db.listAuditLog({ limit: 1000 })]);
  assert.ok(!everything.includes(SK) && !everything.includes('AGENCE_SECRETE'));
  assert.equal((await A('GET', `/compagnies/${u.id_compagnie}`)).body.compagnie.paiement_configure, true);
  assert.equal((await A('GET', '/parametres-paiement')).status, 403, 'même l\'administrateur ne lit pas les clés d\'une agence');
  // suppression : mot de passe exigé
  assert.equal((await M('POST', '/parametres-paiement/supprimer', { mot_de_passe: 'non' })).status, 403);
  assert.equal((await M('POST', '/parametres-paiement/supprimer', { mot_de_passe: PW })).body.configure, false);
  // 5 mauvais mots de passe : blocage
  for (let i = 0; i < 5; i++) await M('PUT', '/parametres-paiement', { ...ok, mot_de_passe: `non${i}` });
  assert.equal((await M('PUT', '/parametres-paiement', ok)).status, 429);
});

test('l\'argent des tickets va sur le compte de la compagnie (clés propres, références distinctes, webhook dédié)', async () => {
  const mk = async (name) => {
    const u = await reg(name); const M = as(u);
    await A('POST', `/compagnies/${u.id_compagnie}/abonnement`, { action: 'activer' });
    const tr = (await M('POST', '/trajets', { ville_depart: 'Cotonou', ville_arrivee: 'Parakou', lieu_embarquement: 'Gare', duree_estimee: 120 })).body.trajet;
    const bus = (await M('POST', '/bus', { immatriculation: `BUS-${name}`, nombre_places: 30 })).body.bus;
    const h = (await M('POST', '/horaires', { id_trajet: tr.id_trajet, id_bus: bus.id_bus, date_depart: addDays(todayStr(), 4), heure_depart: '07:00', heure_arrivee: '13:00', tarif_fcfa: 9000, statut: 'programme' })).body.horaire;
    return { u, M, h };
  };
  const X = await mk('Pay1'), Y = await mk('Pay2');
  const search = async () => (await catalog.search({ depart: 'Cotonou', arrivee: 'Parakou', date: addDays(todayStr(), 4) })).filter((h) => [X.h.id_horaire, Y.h.id_horaire].includes(h.id_horaire));
  // sans clés : voyages non proposés, réservation et paiement impossibles
  assert.equal((await search()).length, 0);
  await assert.rejects(reservations.reserver(await fresh(X.u), { id_horaire: X.h.id_horaire, numero_place: 1, nom: 'A', prenom: 'B', telephone: '+229 01 02 03 04 05' }), { code: 'UNAVAILABLE' });
  assert.equal((await X.M('GET', '/tableau-de-bord')).body.alertes[0].code, 'paiement_non_configure');
  // avec clés : voyages proposés
  const SKX = 'sk_sandbox_CLE_DE_X_000000001', SKY = 'sk_sandbox_CLE_DE_Y_000000002';
  await X.M('PUT', '/parametres-paiement', { public_key: 'pk_sandbox_CLE_DE_X_000001', secret_key: SKX, mot_de_passe: PW });
  await Y.M('PUT', '/parametres-paiement', { public_key: 'pk_sandbox_CLE_DE_Y_000002', secret_key: SKY, mot_de_passe: PW });
  assert.equal((await search()).length, 2);
  const client = await auth.register({ nom: 'Cl', prenom: 'Ient', email: 'cl@test.local', telephone: '+229 01 02 03 04 05', mot_de_passe: PW, consentement: true });
  const rx = await reservations.reserver(client, { id_horaire: X.h.id_horaire, numero_place: 3, nom: 'A', prenom: 'B', telephone: '+229 01 02 03 04 05' });
  const ry = await reservations.reserver(client, { id_horaire: Y.h.id_horaire, numero_place: 3, nom: 'A', prenom: 'B', telephone: '+229 01 02 03 04 05' });
  providerStatus = 'en_attente';
  const n = seen.checkouts.length;
  await payments.initier(client, rx.numero_ticket); await payments.initier(client, ry.numero_ticket);
  const [cx, cy] = seen.checkouts.slice(n);
  assert.deepEqual(cx.creds, { secretKey: SKX, env: 'sandbox' }); assert.deepEqual(cy.creds, { secretKey: SKY, env: 'sandbox' });
  assert.match(cx.callbackUrl, /\/paiement\/retour\?t=VYG-/);
  // les deux comptes FedaPay ont répondu par le MÊME numéro de transaction : pas de confusion
  const rxPay = (await db.listPaymentsByReservation(rx.id_reservation))[0], ryPay = (await db.listPaymentsByReservation(ry.id_reservation))[0];
  assert.equal(rxPay.reference_transaction, `${txCounter - 1}@${X.u.id_compagnie}`); assert.equal(ryPay.reference_transaction, `${txCounter}@${Y.u.id_compagnie}`);
  assert.notEqual(`${txCounter - 1}@${Y.u.id_compagnie}`, rxPay.reference_transaction, 'même numéro de transaction, compagnies différentes : références différentes');
  // retour du voyageur : vérifié avec les clés de LA compagnie
  providerStatus = 'reussi'; providerAmount = 9000;
  const s0 = seen.status.length;
  assert.equal((await payments.retour({ id: String(txCounter - 1), t: rx.numero_ticket })).statut, 'reussi');
  assert.deepEqual(seen.status[s0].creds, { secretKey: SKX, env: 'sandbox' }); assert.equal(seen.status[s0].ref, String(txCounter - 1));
  // un retour qui mélange ticket de Y et transaction de X est refusé
  await assert.rejects(payments.retour({ id: String(txCounter - 1), t: ry.numero_ticket }), { code: 'PAY_RETURN' });
  assert.equal((await db.getReservationById(ry.id_reservation)).statut, 'en_attente');
  // webhook dédié à la compagnie Y
  assert.deepEqual(await payments.webhook({ entity: { id: txCounter } }, X.u.id_compagnie), { ignore: true }, 'mauvaise compagnie : ignoré');
  assert.deepEqual(await payments.webhook({ entity: { id: txCounter } }, null), { ignore: true }, 'webhook plateforme : ne connaît pas ce paiement');
  assert.equal((await payments.webhook({ entity: { id: txCounter } }, Y.u.id_compagnie)).ok, true);
  assert.equal((await db.getReservationById(ry.id_reservation)).statut, 'confirmee');
  assert.deepEqual(seen.status.at(-1).creds, { secretKey: SKY, env: 'sandbox' });
  // chaque gestionnaire ne voit que SES recettes
  assert.equal((await X.M('GET', '/paiements')).body.total.montant_fcfa, 9000);
  assert.equal((await Y.M('GET', '/paiements')).body.total.montant_fcfa, 9000);
  // si la compagnie retire ses clés, ses voyages disparaissent et un paiement en cours ne peut plus être créé
  await Y.M('POST', '/parametres-paiement/supprimer', { mot_de_passe: PW });
  assert.equal((await search()).filter((h) => h.id_horaire === Y.h.id_horaire).length, 0);
});

test('alertes de l\'agence : abonnement bientôt échu', async () => {
  const u = await reg('Alerte'); const M = as(u);
  await A('POST', `/compagnies/${u.id_compagnie}/abonnement`, { action: 'activer', jours: 3 });
  const codes = (await M('GET', '/tableau-de-bord')).body.alertes.map((a) => a.code);
  assert.ok(codes.includes('abonnement_expire'));
});

test('compagnies créées par l\'administrateur : comportement historique inchangé (compte de la plateforme, sans abonnement)', async () => {
  const A1 = (await db.listCompagnies()).find((c) => c.nom === 'Compagnie Test A');
  assert.equal(A1.abonnement_statut || 'non_requis', 'non_requis');
  const trip = (await db.listHoraires({ id_compagnie: A1.id_compagnie, date_min: addDays(todayStr(), 3), date_max: addDays(todayStr(), 3) })).find((h) => h.statut === 'programme');
  assert.equal(catalog.isSellable(trip), true);
  const client = await auth.findUser?.call?.(null) || (await db.findUserByEmail('client@test.local'));
  const r = await reservations.reserver(auth.publicUser(client), { id_horaire: trip.id_horaire, numero_place: 12, nom: 'A', prenom: 'B', telephone: '+229 01 02 03 04 05' });
  const n = seen.checkouts.length; providerStatus = 'en_attente';
  await payments.initier(auth.publicUser(client), r.numero_ticket);
  assert.equal(seen.checkouts[n].creds, undefined);
  assert.ok(!(await db.listPaymentsByReservation(r.id_reservation))[0].reference_transaction.includes('@'));
});
