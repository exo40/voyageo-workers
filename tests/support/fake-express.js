'use strict';
/**
 * MINI « FAUX EXPRESS » pour tester la LOGIQUE des routes sans installer Express.
 * Il remplace require('express') dans le processus de test, enregistre les routes et permet de les appeler
 * avec une fausse requête / fausse réponse. Il ne remplace PAS les tests de bout en bout (tests/api.test.js, etc.),
 * qui démarrent le vrai serveur Express après « npm install ».
 */
const Module = require('node:module');

function compile(path) {
  const keys = [];
  const re = new RegExp(`^${path.replace(/:([A-Za-z_]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }).replace(/\./g, '\\.')}/?$`);
  return { re, keys };
}
function Router() {
  const r = { chain: [] };
  r.use = (...fns) => { r.chain.push({ kind: 'use', fns }); return r; };
  for (const m of ['get', 'post', 'put', 'delete']) {
    r[m] = (path, ...fns) => { r.chain.push({ kind: 'route', method: m.toUpperCase(), ...compile(path), fns }); return r; };
  }
  return r;
}
function fakeExpress() { return { disable() {}, set() {}, use() {}, get() {}, post() {} }; }
fakeExpress.Router = Router;
fakeExpress.json = () => (req, res, next) => next();
fakeExpress.static = () => (req, res, next) => next();

const orig = Module._load;
Module._load = function (request, ...rest) { return request === 'express' ? fakeExpress : orig.call(this, request, ...rest); };

/** Appelle une route : retourne { status, body, headers }. Les erreurs (AppError, DbError) sont converties comme le ferait errorHandler. */
async function call(router, method, url, { user = null, body = {}, } = {}) {
  const [path, queryString] = url.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryString || ''));
  const req = { method, path, query, body, params: {}, user, get: () => '', session: {} };
  const out = { status: 200, body: undefined, headers: {} };
  const res = {
    status(c) { out.status = c; return this; }, json(b) { out.body = b; return this; }, send(b) { out.body = b; return this; },
    set(k, v) { if (typeof k === 'object') Object.assign(out.headers, k); else out.headers[k] = v; return this; },
  };
  // Fonctions à exécuter : les « use » puis la route correspondante, dans l'ordre d'enregistrement.
  const fns = [];
  let matched = false;
  for (const e of router.chain) {
    if (e.kind === 'use') fns.push(...e.fns);
    else if (!matched && e.method === method) {
      const m = e.re.exec(path);
      if (m) { matched = true; e.keys.forEach((k, i) => { req.params[k] = decodeURIComponent(m[i + 1]); }); fns.push(...e.fns); }
    }
  }
  if (!matched) return { status: 404, body: { erreur: 'route inconnue' }, headers: {} };
  let error = null;
  for (const fn of fns) {
    let nextCalled = false;
    await new Promise((resolve) => {
      const next = (err) => { nextCalled = true; if (err) error = err; resolve(); };
      Promise.resolve(fn(req, res, next)).then(() => { if (!nextCalled) resolve(); }, (e) => { error = e; resolve(); });
    });
    if (error) break;
    if (!nextCalled) break;   // la route a répondu
  }
  if (error) {
    const dbMsg = { SEAT_TAKEN: 409, DUPLICATE_EMAIL: 409, DUPLICATE_PLATE: 409, IN_USE: 409 };
    if (error.status) { out.status = error.status; out.body = { erreur: error.message, code: error.code }; }
    else if (error.name === 'DbError' && dbMsg[error.code]) { out.status = dbMsg[error.code]; out.body = { erreur: error.message, code: error.code }; }
    else throw error;
  }
  return out;
}
module.exports = { call, Router };
