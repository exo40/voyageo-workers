'use strict';
// Code de confirmation e-mail (inscription) et mot de passe oublié : tests au niveau des services (sans serveur HTTP).
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv } = require('./helpers');
setupEnv({ EMAIL_VERIFICATION: 'true' });
const db = require('../src/db');
const mail = require('../src/services/emailService');
const auth = require('../src/services/authService');
const codes = require('../src/services/codeStore');

const sent = [];
mail.sendCodeEmail = async (to, { code, motif }) => { sent.push({ to, code, motif }); return true; };
const last = () => sent[sent.length - 1];
const input = { nom: 'Test', prenom: 'Awa', email: 'Awa@Exemple.com', telephone: '+229 01 00 00 00 09', mot_de_passe: 'MotDePasse#1', consentement: true };
const age = (purpose, email) => { codes.peek(purpose, email).sentAt -= 61000; }; // saute le délai de renvoi

test.before(async () => { await db.init(); });
test.after(() => db.close());

test('inscription : aucun compte avant le code, puis compte créé avec le bon code', async () => {
  const out = await auth.startRegistration(input);
  assert.equal(out.email, 'awa@exemple.com');
  assert.equal(await db.findUserByEmail('awa@exemple.com'), null, 'pas de compte avant confirmation');
  assert.match(last().code, /^\d{6}$/);
  await assert.rejects(auth.confirmRegistration('awa@exemple.com', '000000'), (e) => e.code === 'BAD_CODE' || last().code === '000000');
  const user = await auth.confirmRegistration('awa@exemple.com', last().code);
  assert.equal(user.role, 'voyageur');
  assert.ok(await db.findUserByEmail('awa@exemple.com'));
  await assert.rejects(auth.confirmRegistration('awa@exemple.com', last().code), (e) => e.code === 'CODE_EXPIRED', 'un code ne sert qu\'une fois');
});

test('inscription : e-mail déjà utilisé refusé, renvoi limité, 5 essais maximum', async () => {
  await assert.rejects(auth.startRegistration(input), (e) => e.status === 409);
  const b = { ...input, email: 'bob@exemple.com' };
  await auth.startRegistration(b);
  await assert.rejects(auth.resendRegistration('bob@exemple.com'), (e) => e.code === 'RESEND_TOO_SOON');
  age('inscription', 'bob@exemple.com');
  await auth.resendRegistration('bob@exemple.com');
  const good = last().code;
  const wrong = good === '123456' ? '654321' : '123456';
  for (let i = 0; i < 4; i++) await assert.rejects(auth.confirmRegistration('bob@exemple.com', wrong), (e) => e.code === 'BAD_CODE');
  await assert.rejects(auth.confirmRegistration('bob@exemple.com', wrong), (e) => e.code === 'CODE_LOCKED');
  await assert.rejects(auth.confirmRegistration('bob@exemple.com', good), (e) => e.code === 'CODE_LOCKED', 'après 5 essais, même le bon code est refusé');
  await assert.rejects(auth.confirmRegistration('bob@exemple.com', good), (e) => e.code === 'CODE_EXPIRED', 'puis le code est détruit');
});

test('un code d\'inscription expiré est refusé', async () => {
  await auth.startRegistration({ ...input, email: 'old@exemple.com' });
  const c = last().code;
  codes.peek('inscription', 'old@exemple.com').expires = Date.now() - 1;
  await assert.rejects(auth.confirmRegistration('old@exemple.com', c), (e) => e.code === 'CODE_EXPIRED');
});

test('mot de passe oublié : même réponse pour un compte inconnu, puis réinitialisation', async () => {
  const before = sent.length;
  assert.deepEqual(await auth.forgotPassword('inconnu@exemple.com'), { ok: true });
  assert.equal(sent.length, before, 'aucun e-mail pour une adresse inconnue');
  assert.deepEqual(await auth.forgotPassword('awa@exemple.com'), { ok: true });
  assert.equal(last().motif, 'reset');
  const code = last().code;
  await assert.rejects(auth.resetPassword('awa@exemple.com', code, 'court'), (e) => e.status === 400, 'mot de passe trop court refusé');
  await auth.resetPassword('awa@exemple.com', code, 'NouveauMdp#2');
  assert.ok(await auth.login('awa@exemple.com', 'NouveauMdp#2', true));
  await assert.rejects(auth.login('awa@exemple.com', 'MotDePasse#1'), (e) => e.status === 401);
  await assert.rejects(auth.resetPassword('awa@exemple.com', code, 'AutreMdp#3'), (e) => e.code === 'CODE_EXPIRED');
});

test('consentement : inscription refusée sans accord, accord demandé une fois à la connexion', async () => {
  await assert.rejects(auth.startRegistration({ ...input, email: 'nc@exemple.com', consentement: false }), (e) => e.code === 'CONSENT_REQUIRED');
  await assert.rejects(auth.register({ ...input, email: 'nc2@exemple.com', consentement: undefined }), (e) => e.code === 'CONSENT_REQUIRED');
  // compte créé sans accord enregistré (ex. par l'administrateur) : l'accord est demandé à la connexion
  await db.createUser({ nom: 'A', prenom: 'B', email: 'sans@exemple.com', telephone: null, mot_de_passe_hache: await require('../src/services/passwords').hashPassword('MotDePasse#1'), role: 'voyageur', statut: 'actif' });
  await assert.rejects(auth.login('sans@exemple.com', 'MotDePasse#1'), (e) => e.status === 428 && e.code === 'CONSENT_REQUIRED');
  const u = await auth.login('sans@exemple.com', 'MotDePasse#1', true);
  assert.ok(u.consentement_date);
  assert.ok(await auth.login('sans@exemple.com', 'MotDePasse#1'), "plus redemandé ensuite");
});
