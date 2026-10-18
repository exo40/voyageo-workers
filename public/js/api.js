// Communication avec le serveur (API JSON) : gère le jeton anti-CSRF et les erreurs.
let csrf = null;

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}
async function getCsrf() {
  if (!csrf) {
    const res = await fetch('/api/csrf', { credentials: 'same-origin' });
    csrf = (await res.json()).csrf;
  }
  return csrf;
}
async function request(method, path, body, retry = true) {
  const opts = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (method !== 'GET') {
    opts.headers['Content-Type'] = 'application/json';
    opts.headers['X-CSRF-Token'] = await getCsrf();
    if (body !== undefined) opts.body = JSON.stringify(body);
  }
  let res;
  try { res = await fetch(path, opts); }
  catch { throw new ApiError('Connexion au serveur impossible. Vérifiez votre connexion Internet.', 0, 'NETWORK'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 403 && data.code === 'CSRF' && retry) { csrf = null; return request(method, path, body, false); }
    throw new ApiError(data.erreur || 'Une erreur est survenue.', res.status, data.code);
  }
  if (data.csrf) csrf = data.csrf;
  return data;
}
export const qs = (obj) => '?' + new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
export const forgetCsrf = () => { csrf = null; };
export const api = {
  get: (p) => request('GET', p),
  post: (p, b = {}) => request('POST', p, b),
  put: (p, b = {}) => request('PUT', p, b),
  del: (p) => request('DELETE', p),
};
