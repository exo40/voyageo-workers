'use strict';
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

/**
 * À appeler AVANT de charger le code du site : prépare un environnement de test isolé (fichier JSON temporaire).
 * Pour rejouer TOUTE la suite sur une base MySQL de TEST (jamais la vraie !) : APP_TEST_DB=mysql avec DB_HOST, DB_PORT, DB_USER,
 * DB_PASSWORD, DB_NAME de la base de test dans l'environnement. La base doit être VIDE au début de chaque fichier de test
 * (les fichiers se lancent un par un : node --test --test-concurrency=1).
 */
function setupEnv(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voyageo-test-'));
  const useMysql = process.env.APP_TEST_DB === 'mysql';
  Object.assign(process.env, {
    NODE_ENV: 'test', DB_DRIVER: useMysql ? 'mysql' : 'json', JSON_DB_FILE: path.join(dir, 'db.json'), ADMIN_EMAIL: 'admin@test.local', ADMIN_PASSWORD: 'MotDePasse#Test1',
    SESSION_SECRET: 'secret-de-test', DEMO_DATA: 'true', PAYMENT_MODE: 'off', SMTP_HOST: '', EMAIL_VERIFICATION: 'false', APP_BASE_URL: 'http://localhost:3999', ...extra,
  });
}

async function startServer() {
  const db = require('../src/db');
  await db.init();
  await require('../src/services/authService').ensureAdmin();
  await require('../src/services/demoData').seedIfEmpty();
  const app = require('../src/app').createApp();
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.close(r); server.closeAllConnections?.(); }).then(() => db.close()) };
}

/** Petit navigateur de test : garde les cookies et le jeton CSRF. */
class Client {
  constructor(base) { this.base = base; this.cookies = {}; this.csrf = null; }
  async req(method, url, body) {
    const headers = { Accept: 'application/json' };
    const cookie = Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    if (cookie) headers.Cookie = cookie;
    if (method !== 'GET') { headers['Content-Type'] = 'application/json'; if (this.csrf) headers['X-CSRF-Token'] = this.csrf; }
    const res = await fetch(this.base + url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
    for (const sc of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
      const [pair, ...attrs] = sc.split(';'); const i = pair.indexOf('='); const name = pair.slice(0, i).trim(); const val = pair.slice(i + 1).trim();
      if (!val || attrs.some((a) => /max-age=0/i.test(a))) delete this.cookies[name]; else this.cookies[name] = val;
    }
    const data = await res.json().catch(() => null);
    if (data && data.csrf) this.csrf = data.csrf;
    return { status: res.status, data, headers: res.headers };
  }
  get(u) { return this.req('GET', u); }
  post(u, b = {}) { return this.req('POST', u, b); }
  put(u, b = {}) { return this.req('PUT', u, b); }
  del(u) { return this.req('DELETE', u); }
  async init() { this.csrf = (await this.get('/api/csrf')).data.csrf; return this; }
}
module.exports = { setupEnv, startServer, Client };
