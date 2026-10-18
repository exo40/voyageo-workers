'use strict';
// Tests du bot, du lieu d'embarquement et du lien Maps (sans serveur HTTP).
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv } = require('./helpers');
setupEnv();
const db = require('../src/db');
const v = require('../src/utils/validate');

test.before(async () => { await db.init(); await require('../src/services/demoData').seedIfEmpty({ days: 3 }); });
test.after(() => db.close());

test('le lien Maps accepte Google Maps et refuse le reste', () => {
  assert.equal(v.optMapsUrl(''), null);
  assert.ok(v.optMapsUrl('https://maps.app.goo.gl/abc123'));
  assert.ok(v.optMapsUrl('https://www.google.com/maps/place/Cotonou'));
  for (const bad of ['javascript:alert(1)', 'http://www.google.com/maps', 'https://exemple-pirate.com/maps', 'https://www.google.com/search?q=x', 'pas un lien']) {
    assert.throws(() => v.optMapsUrl(bad), (e) => e.status === 400, bad);
  }
});

test('les voyages exposent le lieu d\'embarquement et le lien Maps', async () => {
  const [h] = await db.listHoraires({});
  assert.ok(h.lieu_embarquement && h.lien_maps.startsWith('https://'));
  const t = await db.getTrajet(h.id_trajet);
  const up = await db.updateTrajet(t.id_trajet, { lieu_embarquement: 'Point test', lien_maps: 'https://maps.app.goo.gl/z' });
  assert.equal(up.lieu_embarquement, 'Point test');
});

test('le bot répond avec les vrais départs, le lieu d\'embarquement et WhatsApp', async () => {
  const bot = require('../src/services/botService');
  const r = await bot.reply('Cotonou Parakou');
  assert.match(r.texte, /Prochains départs de Cotonou vers Parakou/);
  assert.ok(r.liens.some((l) => l.label.startsWith('Embarquement')));
  assert.equal(r.whatsapp, true);
  const b = await bot.reply('Où embarquer à Cotonou ?');
  assert.ok(b.liens.length >= 1 && b.liens.every((l) => l.href.startsWith('https://')));
  const c = await bot.reply('je veux parler au service client');
  assert.ok(c.liens.some((l) => l.href === 'https://wa.me/22960315810'));
  const inconnu = await bot.reply('azerty qsdfgh');
  assert.ok(inconnu.liens.some((l) => l.href.startsWith('https://wa.me/')));
  assert.match((await bot.reply('annuler')).texte, /24 h/);
});
