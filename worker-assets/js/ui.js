// Éléments d'interface communs : en-tête, pied de page, messages, formatage.
import { api, forgetCsrf } from './api.js';
import { icon } from './icons.js';
export { icon };

// Rend Element.append() plus tolérant : accepte les tableaux et ignore null / undefined / false
// (sans cela, le navigateur écrirait le texte "null" ou "[object HTMLElement]" dans la page).
const nativeAppend = Element.prototype.append;
Element.prototype.append = function append(...kids) {
  return nativeAppend.apply(this, kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false));
};

export const state = { user: null, config: { paiement: { mode: 'off' }, annulation_heures: 24, utc_offset: '+01:00', whatsapp: { numero: '22960315810', affichage: '+229 60 31 58 10' } } };

/** Crée un élément HTML sans jamais utiliser innerHTML (protection contre les injections XSS). */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}
export function append(el, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);

// ---------- Formatage ----------
export const fmtFCFA = (n) => new Intl.NumberFormat('fr-FR').format(n).replace(/[\u202f\u00a0]/g, '\u00a0') + '\u00a0FCFA';
export const fmtDate = (d, long = true) => new Intl.DateTimeFormat('fr-FR', { weekday: long ? 'long' : 'short', day: 'numeric', month: long ? 'long' : 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`));
export const fmtDuree = (m) => (m == null ? '' : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`);
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
function offsetMs() {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(state.config.utc_offset || '+01:00');
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) * 60000 : 3600000;
}
export const todayStr = () => new Date(Date.now() + offsetMs()).toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
export const departureMs = (date, heure) => new Date(`${date}T${heure}:00${state.config.utc_offset || '+01:00'}`).getTime();

const STATUTS = {
  confirmee: ['Confirmée', 'confirmee'], en_attente: ['En attente', 'en_attente'], annulee: ['Annulée', 'annulee'],
  programme: ['Programmé', 'programme'], annule: ['Annulé', 'annule'], termine: ['Terminé', 'termine'],
  actif: ['Actif', 'actif'], bloque: ['Bloqué', 'bloque'], active: ['Active', 'active'], inactive: ['Inactive', 'inactive'],
};
export function badge(statut) {
  const [label, cls] = STATUTS[statut] || [statut, 'info'];
  return h('span', { class: `badge-vy badge-${cls}`, text: label });
}
/** Lien WhatsApp du service client (message pré-rempli facultatif). */
export const waHref = (text = '') => `https://wa.me/${state.config.whatsapp?.numero || '22960315810'}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
/** Lien Google Maps d'un lieu d'embarquement : le lien renseigné par l'administrateur, sinon une recherche Maps sur le nom du lieu. */
export const mapsHref = (lieu, lien, ville = '') => lien || (lieu ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lieu} ${ville}`.trim())}` : null);
/** Bloc « Lieu d'embarquement » avec bouton Maps (null si aucun lieu renseigné). */
export function boardingLine(t, cls = 'small') {
  if (!t.lieu_embarquement) return null;
  return h('div', { class: `${cls} boarding` }, h('span', { class: 'text-muted' }, 'Embarquement : '), h('strong', {}, t.lieu_embarquement), ' ',
    h('a', { class: 'maps-link', href: mapsHref(t.lieu_embarquement, t.lien_maps, t.ville_depart), target: '_blank', rel: 'noopener noreferrer' }, 'Voir sur Maps'));
}

// ---------- Photos, chauffeur, étoiles ----------
export const slug = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Image avec image de remplacement si la photo est absente ou illisible. */
export function photoImg(url, fallback, alt, cls = '', extra = {}) {
  const img = h('img', { src: url || fallback, alt, class: cls, loading: 'lazy', decoding: 'async', ...extra });
  img.addEventListener('error', () => { if (!img.src.endsWith(fallback)) img.src = fallback; }, { once: true });
  return img;
}
export const busPhoto = (url, alt = 'Photo du bus', cls = 'bus-photo') => photoImg(url, '/img/bus-defaut.svg', alt, cls);
/** Étoiles en lecture seule (note de 0 à 5, arrondie à l'entier le plus proche). */
export function stars(note, size = 16) {
  const n = Math.round(Number(note) || 0);
  const el = h('span', { class: 'stars', role: 'img', 'aria-label': `${note ?? 0} sur 5` });
  for (let i = 1; i <= 5; i++) el.append(h('span', { class: i <= n ? '' : 'off', 'aria-hidden': 'true' }, icon('star', size)));
  return el;
}
/** Chauffeur : photo, prénom seul et note moyenne (rien si aucun chauffeur n'est renseigné). */
export function driverBlock(t, cls = '') {
  if (!t || !t.chauffeur_prenom) return null;
  return h('div', { class: `driver ${cls}`.trim() },
    photoImg(t.chauffeur_photo, '/img/chauffeur-defaut.svg', `Photo du chauffeur ${t.chauffeur_prenom}`),
    h('div', {}, h('div', { class: 'name' }, t.chauffeur_prenom, h('span', { class: 'small text-muted fw-normal' }, ' · chauffeur')),
      t.chauffeur_nb_avis ? h('div', { class: 'small' }, stars(t.chauffeur_note), ' ', h('strong', {}, String(t.chauffeur_note).replace('.', ',')), h('span', { class: 'text-muted' }, ` (${t.chauffeur_nb_avis} avis)`))
        : h('div', { class: 'small text-muted' }, 'Pas encore noté')));
}
/** Case d'accord sur l'utilisation des données personnelles (obligatoire) avec liens vers la politique de confidentialité. */
export function consentBox(id = 'consentement', needed = false) {
  const input = h('input', { class: 'form-check-input', type: 'checkbox', id, required: true });
  const el = h('div', { class: `consent-box mb-3${needed ? ' needed' : ''}` }, h('div', { class: 'form-check' }, input,
    h('label', { class: 'form-check-label', for: id }, 'J’accepte que Voyagéo utilise mes données personnelles (identité, contact, réservations, paiements) pour gérer mon compte, mes tickets et mes voyages, comme expliqué dans la ',
      h('a', { href: '/confidentialite.html', target: '_blank', rel: 'noopener' }, 'politique de confidentialité'), ' et les ', h('a', { href: '/conditions.html', target: '_blank', rel: 'noopener' }, 'conditions d’utilisation'), '.')));
  return { el, input };
}

/** Bouton clair / sombre (le choix est mémorisé sur l'appareil). */
export function themeToggle(cls = 'btn btn-vy-outline px-2') {
  const b = h('button', { type: 'button', class: cls });
  const paint = () => {
    const dark = window.vyTheme?.current() === 'dark';
    clear(b).append(icon(dark ? 'sun' : 'moon', 20));
    b.title = dark ? 'Passer au thème clair' : 'Passer au thème sombre';
    b.setAttribute('aria-label', b.title);
  };
  b.addEventListener('click', () => { window.vyTheme?.toggle(); paint(); });
  paint();
  return b;
}

/** Fait apparaître les éléments .reveal quand ils entrent à l'écran (sans animation si l'utilisateur la désactive). */
export function revealOnScroll(root = document) {
  const items = [...root.querySelectorAll('.reveal')];
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) { items.forEach((e) => e.classList.add('in')); return; }
  const io = new IntersectionObserver((entries) => { for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, { threshold: 0.12 });
  items.forEach((e) => io.observe(e));
}

/** Champ « code à 6 chiffres » + bouton « Renvoyer le code » (délai de 60 s). Utilisé par l'inscription et le mot de passe oublié. */
export function codeField({ onResend }) {
  const input = h('input', { class: 'form-control form-control-lg text-center code-input', id: 'code', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 6, autocomplete: 'one-time-code', required: true, placeholder: '000000', 'aria-describedby': 'code-help' });
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); });
  const resend = h('button', { class: 'btn btn-link p-0', type: 'button' }, 'Renvoyer le code');
  const note = h('span', { class: 'small text-muted ms-2' });
  let timer = null;
  function cooldown(sec = 60) {
    clearInterval(timer); resend.disabled = true;
    let left = sec; note.textContent = `Nouveau code possible dans ${left} s`;
    timer = setInterval(() => { left -= 1; if (left <= 0) { clearInterval(timer); resend.disabled = false; note.textContent = ''; } else note.textContent = `Nouveau code possible dans ${left} s`; }, 1000);
  }
  resend.addEventListener('click', async () => { resend.disabled = true; try { await onResend(); cooldown(); } catch (e) { resend.disabled = false; toast(e.message, 'error'); } });
  const el = h('div', { class: 'mb-3' }, h('label', { class: 'form-label required', for: 'code' }, 'Code à 6 chiffres'), input,
    h('div', { class: 'form-text', id: 'code-help' }, 'Regardez dans votre boîte de réception, et dans les courriers indésirables (spam).'), h('div', { class: 'mt-2' }, resend, note));
  return { el, input, cooldown };
}

/** N'accepte qu'une adresse interne au site (évite les redirections vers un site extérieur). */
export const safeNext = (v) => (typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.includes('\\') ? v : null);

// ---------- Messages ----------
export function toast(message, type = 'info') {
  let box = $('.vy-toasts');
  if (!box) { box = h('div', { class: 'vy-toasts', role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div', { class: `vy-toast ${type}`, text: message });
  box.append(t);
  setTimeout(() => t.remove(), 5000);
}
export function alertBox(message, type = 'danger') { return h('div', { class: `alert alert-${type}`, role: 'alert', text: message }); }
export function showAlert(container, message, type = 'danger') {
  clear(container).append(alertBox(message, type));
  container.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
export const skeletons = (n = 3) => Array.from({ length: n }, () => h('div', { class: 'skeleton', 'aria-hidden': 'true' }));

// ---------- En-tête et pied de page ----------
function brand(extra = '') {
  return h('a', { class: `vy-brand ${extra}`, href: '/', 'aria-label': 'Voyagéo, accueil' },
    h('img', { src: '/img/logo-icon.svg', alt: '', width: 42, height: 32 }),
    h('span', { class: 'vy-wordmark' }, 'Voya', h('span', {}, 'géo')));
}
export async function logout() {
  try { await api.post('/api/auth/deconnexion'); } catch { /* on quitte quand même */ }
  forgetCsrf();
  location.href = '/';
}
function renderHeader(active) {
  const u = state.user;
  const link = (href, label, key) => h('li', { class: 'nav-item' }, h('a', { class: `nav-link${active === key ? ' active' : ''}`, href, 'aria-current': active === key ? 'page' : null }, label));
  const items = [link('/', 'Accueil', 'accueil'), link('/trajets.html', 'Rechercher un trajet', 'trajets')];
  if (u) items.push(link('/mes-reservations.html', 'Mes réservations', 'reservations'));
  if (u && (u.role === 'admin' || u.role === 'gestionnaire')) items.push(link('/admin', 'Administration', 'admin'));
  const right = u
    ? h('div', { class: 'dropdown' },
        h('button', { class: 'btn btn-vy-outline', type: 'button', 'data-bs-toggle': 'dropdown', 'aria-expanded': 'false' }, `${u.prenom}`),
        h('ul', { class: 'dropdown-menu dropdown-menu-end' },
          h('li', {}, h('a', { class: 'dropdown-item', href: '/compte.html' }, 'Mon compte')),
          h('li', {}, h('a', { class: 'dropdown-item', href: '/mes-reservations.html' }, 'Mes réservations')),
          h('li', {}, h('hr', { class: 'dropdown-divider' })),
          h('li', {}, h('button', { class: 'dropdown-item', type: 'button', onclick: logout }, 'Se déconnecter'))))
    : h('div', { class: 'd-flex gap-2' },
        h('a', { class: 'btn btn-vy-outline', href: `/connexion.html${location.pathname === '/connexion.html' ? '' : '?suite=' + encodeURIComponent(location.pathname + location.search)}` }, 'Connexion'),
        h('a', { class: 'btn btn-vy', href: '/inscription.html' }, 'Inscription'));
  const rightWithTheme = h('div', { class: 'd-flex align-items-center gap-2' }, themeToggle(), right);
  const nav = h('nav', { class: 'navbar navbar-expand-md vy-navbar', 'aria-label': 'Navigation principale' },
    h('div', { class: 'container' },
      brand(),
      h('button', { class: 'navbar-toggler', type: 'button', 'data-bs-toggle': 'collapse', 'data-bs-target': '#mainNav', 'aria-controls': 'mainNav', 'aria-expanded': 'false', 'aria-label': 'Ouvrir le menu' }, h('span', { class: 'navbar-toggler-icon' })),
      h('div', { class: 'collapse navbar-collapse', id: 'mainNav' },
        h('ul', { class: 'navbar-nav me-auto mb-2 mb-md-0 ms-md-3' }, items), rightWithTheme)));
  const slot = $('#site-header');
  if (slot) clear(slot).append(nav);
}
function renderFooter() {
  const slot = $('#site-footer');
  if (!slot) return;
  const li = (href, label, ext = false) => h('li', {}, h('a', ext ? { href, target: '_blank', rel: 'noopener noreferrer' } : { href }, label));
  const wa = state.config.whatsapp?.affichage || '+229 60 31 58 10';
  clear(slot).append(h('div', { class: 'vy-footer' }, h('div', { class: 'container' },
    h('div', { class: 'row g-4' },
      h('div', { class: 'col-lg-5' }, h('div', { class: 'vy-wordmark mb-2' }, 'Voya', h('span', {}, 'géo')),
        h('p', { class: 'foot-text mb-0' }, 'Réservez vos billets de bus en ligne, choisissez votre place et recevez votre ticket numérique, simplement et en toute confiance.')),
      h('div', { class: 'col-6 col-lg-3' }, h('h2', { class: 'foot-title' }, 'Voyager'),
        h('ul', {}, li('/trajets.html', 'Rechercher un trajet'), li('/mes-reservations.html', 'Mes réservations'), li('/inscription.html', 'Créer un compte'), li('/inscription-agence.html', 'Espace agences'))),
      h('div', { class: 'col-6 col-lg-4' }, h('h2', { class: 'foot-title' }, 'Informations'),
        h('ul', {}, li('/confidentialite.html', 'Politique de confidentialité'), li('/conditions.html', 'Conditions d’utilisation'),
          li(waHref('Bonjour Voyagéo, j’ai besoin d’aide.'), `Service client WhatsApp : ${wa}`, true)))),
    h('div', { class: 'foot-bottom small d-flex justify-content-between flex-wrap gap-2' }, h('span', {}, `© ${new Date().getFullYear()} Voyagéo. Tous droits réservés.`), h('span', {}, 'Réservez. Voyagez.')))));
}

/** À appeler au début de chaque page. Retourne false si la page doit s'arrêter (redirection en cours). */
export async function init({ active = '', requireAuth = false, roles = null, chat = true } = {}) {
  try {
    const [me, cfg] = await Promise.all([api.get('/api/auth/moi'), api.get('/api/config')]);
    state.user = me.user; state.config = cfg;
  } catch (e) {
    const main = $('#app');
    if (main) main.prepend(alertBox(e.message));
  }
  renderHeader(active); renderFooter();
  if (chat) import('./chatbot.js').then((m) => m.initChat()).catch(() => { /* le site fonctionne sans le bot */ });
  if (requireAuth && !state.user) { location.replace(`/connexion.html?suite=${encodeURIComponent(location.pathname + location.search)}`); return false; }
  if (roles && state.user && !roles.includes(state.user.role)) { location.replace('/'); return false; }
  return true;
}
export const params = () => new URLSearchParams(location.search);
export { brand };
