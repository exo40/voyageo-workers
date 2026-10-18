import { api } from './api.js';
import { init, h, $, params, safeNext, alertBox, clear, codeField, toast, consentBox } from './ui.js';

if (await init({})) {
  const app = $('#app');
  const msg = h('div', {});
  const inp = (id, label, attrs = {}) => { const i = h('input', { class: 'form-control', id, required: true, ...attrs }); return [i, h('div', { class: 'mb-3' }, h('label', { class: 'form-label required', for: id }, label), i)]; };
  const [prenom, g1] = inp('prenom', 'Prénom', { autocomplete: 'given-name', maxlength: 100 });
  const [nom, g2] = inp('nom', 'Nom', { autocomplete: 'family-name', maxlength: 100 });
  const [email, g3] = inp('email', 'Adresse e-mail', { type: 'email', autocomplete: 'email', maxlength: 190 });
  const [tel, g4] = inp('tel', 'Téléphone', { type: 'tel', autocomplete: 'tel', inputmode: 'tel', maxlength: 25, placeholder: '+229 01 00 00 00 00' });
  const [pwd, g5] = inp('pwd', 'Mot de passe (8 caractères minimum)', { type: 'password', autocomplete: 'new-password', minlength: 8 });
  const [pwd2, g6] = inp('pwd2', 'Confirmer le mot de passe', { type: 'password', autocomplete: 'new-password' });
  const consent = consentBox();
  const btn = h('button', { class: 'btn btn-vy w-100', type: 'submit' }, 'Créer mon compte');
  const suite = safeNext(params().get('suite'));
  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); clear(msg);
    if (pwd.value !== pwd2.value) { msg.append(alertBox('Les deux mots de passe ne sont pas identiques.')); pwd2.focus(); return; }
    if (!consent.input.checked) { msg.append(alertBox('Pour créer un compte, vous devez accepter l’utilisation de vos données personnelles (politique de confidentialité).')); consent.input.focus(); return; }
    btn.disabled = true;
    try {
      const out = await api.post('/api/auth/inscription', { consentement: true, prenom: prenom.value, nom: nom.value, email: email.value, telephone: tel.value, mot_de_passe: pwd.value });
      if (out.verification) { stepCode(out.email, out.validite_minutes); return; }
      location.href = suite || '/';
    } catch (err) { btn.disabled = false; msg.append(alertBox(err.message)); }
  } }, h('div', { class: 'row' }, h('div', { class: 'col-sm-6' }, g1), h('div', { class: 'col-sm-6' }, g2)), g3, g4, g5, g6, consent.el, btn);
  app.append(h('div', { class: 'row justify-content-center' }, h('div', { class: 'col-md-8 col-lg-6' },
    h('h1', { class: 'page-title' }, 'Créer un compte'), h('p', { class: 'text-muted' }, 'Un compte est nécessaire pour réserver une place et retrouver vos tickets.'), msg, form,
    h('p', { class: 'text-center mt-4' }, 'Déjà inscrit ? ', h('a', { href: `/connexion.html${suite ? '?suite=' + encodeURIComponent(suite) : ''}` }, 'Se connecter')),
    h('p', { class: 'text-center small text-muted' }, 'Vous représentez une agence de transport ? ', h('a', { href: '/inscription-agence.html' }, 'Inscrivez votre agence')))));

  /** Étape 2 : saisie du code reçu par e-mail. */
  function stepCode(mail, minutes) {
    const cmsg = h('div', {});
    const cf = codeField({ onResend: async () => { await api.post('/api/auth/inscription/renvoyer', { email: mail }); toast('Un nouveau code vient d’être envoyé.', 'success'); } });
    const ok = h('button', { class: 'btn btn-vy w-100', type: 'submit' }, 'Confirmer et créer mon compte');
    const cform = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); clear(cmsg);
      if (cf.input.value.length !== 6) { cmsg.append(alertBox('Saisissez les 6 chiffres du code.')); cf.input.focus(); return; }
      ok.disabled = true;
      try { await api.post('/api/auth/inscription/verifier', { email: mail, code: cf.input.value }); location.href = suite || '/'; }
      catch (err) { ok.disabled = false; cmsg.append(alertBox(err.message)); cf.input.select(); }
    } }, cf.el, ok);
    clear(app).append(h('div', { class: 'row justify-content-center' }, h('div', { class: 'col-md-8 col-lg-5' },
      h('h1', { class: 'page-title' }, 'Confirmez votre e-mail'),
      h('p', {}, 'Nous avons envoyé un code à 6 chiffres à ', h('strong', {}, mail), `. Il est valable ${minutes} minutes.`), cmsg, cform,
      h('p', { class: 'text-center mt-4' }, h('a', { href: location.pathname + location.search }, 'Modifier mon adresse e-mail')))));
    cf.cooldown(); cf.input.focus();
  }
}
