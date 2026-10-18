import { api } from './api.js';
import { init, h, $, params, safeNext, alertBox, clear, consentBox } from './ui.js';

if (await init({})) {
  const app = $('#app');
  const msg = h('div', {});
  const email = h('input', { class: 'form-control', id: 'email', type: 'email', autocomplete: 'username', required: true });
  const pwd = h('input', { class: 'form-control', id: 'pwd', type: 'password', autocomplete: 'current-password', required: true });
  const btn = h('button', { class: 'btn btn-vy w-100', type: 'submit' }, 'Se connecter');
  // L'accord n'est demandé que si le compte n'a pas encore accepté la politique de confidentialité (comptes créés avant, ou nouvelle version).
  const consent = consentBox('consentement', true);
  const consentSlot = h('div', {});
  const suite = safeNext(params().get('suite'));
  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); clear(msg);
    if (consentSlot.firstChild && !consent.input.checked) { msg.append(alertBox('Cochez la case pour accepter l’utilisation de vos données personnelles, puis réessayez.')); consent.input.focus(); return; }
    btn.disabled = true;
    try {
      const { user } = await api.post('/api/auth/connexion', { email: email.value, mot_de_passe: pwd.value, consentement: !!consentSlot.firstChild && consent.input.checked });
      location.href = suite || (user.role === 'admin' || user.role === 'gestionnaire' ? '/admin' : '/mes-reservations.html');
    } catch (err) {
      btn.disabled = false;
      if (err.code === 'CONSENT_REQUIRED') { if (!consentSlot.firstChild) consentSlot.append(consent.el); msg.append(alertBox('Avant de continuer, merci d’accepter l’utilisation de vos données personnelles.', 'warning')); consent.input.focus(); return; }
      msg.append(alertBox(err.message)); pwd.value = ''; pwd.focus();
    }
  } },
    h('div', { class: 'mb-3' }, h('label', { class: 'form-label', for: 'email' }, 'Adresse e-mail'), email),
    h('div', { class: 'mb-2' }, h('label', { class: 'form-label', for: 'pwd' }, 'Mot de passe'), pwd),
    h('p', { class: 'text-end small mb-3' }, h('a', { href: '/mot-de-passe-oublie.html' }, 'Mot de passe oublié ?')), consentSlot, btn,
    h('p', { class: 'small text-muted text-center mt-3 mb-0' }, 'Vos données sont traitées selon notre ', h('a', { href: '/confidentialite.html' }, 'politique de confidentialité'), '.'));
  app.append(h('div', { class: 'row justify-content-center' }, h('div', { class: 'col-md-6 col-lg-5' },
    h('h1', { class: 'page-title' }, 'Connexion'), h('p', { class: 'text-muted' }, 'Accédez à vos réservations et à vos tickets.'), msg, form,
    h('p', { class: 'text-center mt-4' }, 'Pas encore de compte ? ', h('a', { href: `/inscription.html${suite ? '?suite=' + encodeURIComponent(suite) : ''}` }, 'Créer un compte')))));
  email.focus();
}
