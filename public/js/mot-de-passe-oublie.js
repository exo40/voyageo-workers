import { api } from './api.js';
import { init, h, $, alertBox, clear, codeField, toast } from './ui.js';

if (await init({})) {
  const app = $('#app');
  const wrap = (...kids) => h('div', { class: 'row justify-content-center' }, h('div', { class: 'col-md-6 col-lg-5' }, ...kids));

  /** Étape 1 : adresse e-mail. */
  function stepEmail() {
    const msg = h('div', {});
    const email = h('input', { class: 'form-control', id: 'email', type: 'email', autocomplete: 'username', required: true, maxlength: 190 });
    const btn = h('button', { class: 'btn btn-vy w-100', type: 'submit' }, 'Recevoir un code');
    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); clear(msg); btn.disabled = true;
      try { await api.post('/api/auth/mot-de-passe-oublie', { email: email.value }); stepReset(email.value.trim().toLowerCase()); }
      catch (err) { btn.disabled = false; msg.append(alertBox(err.message)); }
    } }, h('div', { class: 'mb-3' }, h('label', { class: 'form-label required', for: 'email' }, 'Adresse e-mail de votre compte'), email), btn);
    clear(app).append(wrap(h('h1', { class: 'page-title' }, 'Mot de passe oublié'),
      h('p', { class: 'text-muted' }, 'Entrez votre adresse e-mail : nous vous enverrons un code à 6 chiffres pour choisir un nouveau mot de passe.'), msg, form,
      h('p', { class: 'text-center mt-4' }, h('a', { href: '/connexion.html' }, 'Retour à la connexion'))));
    email.focus();
  }

  /** Étape 2 : code + nouveau mot de passe. */
  function stepReset(mail) {
    const msg = h('div', {});
    const cf = codeField({ onResend: async () => { await api.post('/api/auth/mot-de-passe-oublie', { email: mail }); toast('Si un compte existe, un nouveau code vient d’être envoyé.', 'success'); } });
    const p1 = h('input', { class: 'form-control', id: 'p1', type: 'password', autocomplete: 'new-password', minlength: 8, required: true });
    const p2 = h('input', { class: 'form-control', id: 'p2', type: 'password', autocomplete: 'new-password', required: true });
    const btn = h('button', { class: 'btn btn-vy w-100', type: 'submit' }, 'Changer mon mot de passe');
    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); clear(msg);
      if (cf.input.value.length !== 6) { msg.append(alertBox('Saisissez les 6 chiffres du code.')); cf.input.focus(); return; }
      if (p1.value !== p2.value) { msg.append(alertBox('Les deux mots de passe ne sont pas identiques.')); p2.focus(); return; }
      btn.disabled = true;
      try { await api.post('/api/auth/mot-de-passe-oublie/reinitialiser', { email: mail, code: cf.input.value, nouveau: p1.value }); done(); }
      catch (err) { btn.disabled = false; msg.append(alertBox(err.message)); }
    } }, cf.el,
      h('div', { class: 'mb-3' }, h('label', { class: 'form-label required', for: 'p1' }, 'Nouveau mot de passe (8 caractères minimum)'), p1),
      h('div', { class: 'mb-3' }, h('label', { class: 'form-label required', for: 'p2' }, 'Confirmer le nouveau mot de passe'), p2), btn);
    clear(app).append(wrap(h('h1', { class: 'page-title' }, 'Nouveau mot de passe'),
      h('p', {}, 'Si un compte existe pour ', h('strong', {}, mail), ', un code vient de lui être envoyé.'), msg, form,
      h('p', { class: 'text-center mt-4' }, h('a', { href: '/mot-de-passe-oublie.html' }, 'Utiliser une autre adresse'))));
    cf.cooldown(); cf.input.focus();
  }

  function done() {
    clear(app).append(wrap(h('h1', { class: 'page-title' }, 'Mot de passe modifié'), alertBox('Votre mot de passe a été changé. Vous pouvez maintenant vous connecter.', 'success'),
      h('a', { class: 'btn btn-vy w-100', href: '/connexion.html' }, 'Se connecter')));
  }
  stepEmail();
}
