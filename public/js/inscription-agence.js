// Inscription d'une agence de transport : compte gestionnaire + compagnie. L'espace s'ouvre après paiement de l'abonnement.
import { api } from './api.js';
import { init, h, $, alertBox, clear, codeField, toast, fmtFCFA, consentBox } from './ui.js';

if (await init({})) {
  const app = $('#app');
  const cfg = await api.get('/api/config').catch(() => ({}));
  const msg = h('div', {});
  const inp = (id, label, attrs = {}, req = true) => { const i = h('input', { class: 'form-control', id, required: req, ...attrs }); return [i, h('div', { class: 'mb-3' }, h('label', { class: `form-label${req ? ' required' : ''}`, for: id }, label), i)]; };
  const [agNom, a1] = inp('ag-nom', "Nom de l'agence / compagnie", { maxlength: 120, autocomplete: 'organization' });
  const [agTel, a2] = inp('ag-tel', "Téléphone de l'agence", { type: 'tel', inputmode: 'tel', maxlength: 25, placeholder: '+229 01 00 00 00 00' });
  const [agAdr, a3] = inp('ag-adr', 'Adresse (ville, quartier)', { maxlength: 255, autocomplete: 'street-address' }, false);
  const [prenom, g1] = inp('prenom', 'Prénom du responsable', { autocomplete: 'given-name', maxlength: 100 });
  const [nom, g2] = inp('nom', 'Nom du responsable', { autocomplete: 'family-name', maxlength: 100 });
  const [email, g3] = inp('email', 'Adresse e-mail (sert à vous connecter)', { type: 'email', autocomplete: 'email', maxlength: 190 });
  const [tel, g4] = inp('tel', 'Téléphone du responsable', { type: 'tel', autocomplete: 'tel', inputmode: 'tel', maxlength: 25, placeholder: '+229 01 00 00 00 00' });
  const [pwd, g5] = inp('pwd', 'Mot de passe (8 caractères minimum)', { type: 'password', autocomplete: 'new-password', minlength: 8 });
  const [pwd2, g6] = inp('pwd2', 'Confirmer le mot de passe', { type: 'password', autocomplete: 'new-password' });
  const consent = consentBox();
  const btn = h('button', { class: 'btn btn-vy w-100', type: 'submit' }, 'Inscrire mon agence');
  const price = fmtFCFA(cfg.abonnement?.prix_fcfa ?? 20000), days = cfg.abonnement?.duree_jours ?? 30;

  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); clear(msg);
    if (pwd.value !== pwd2.value) { msg.append(alertBox('Les deux mots de passe ne sont pas identiques.')); pwd2.focus(); return; }
    if (!consent.input.checked) { msg.append(alertBox('Pour inscrire votre agence, vous devez accepter l’utilisation des données personnelles (politique de confidentialité).')); consent.input.focus(); return; }
    btn.disabled = true;
    try {
      const out = await api.post('/api/auth/inscription', { consentement: true, type: 'agence', compagnie: { nom: agNom.value, telephone: agTel.value, adresse: agAdr.value }, prenom: prenom.value, nom: nom.value, email: email.value, telephone: tel.value, mot_de_passe: pwd.value });
      if (out.verification) { stepCode(out.email, out.validite_minutes); return; }
      location.href = '/admin#/abonnement';
    } catch (err) { btn.disabled = false; msg.append(alertBox(err.message)); }
  } }, h('h2', { class: 'h5 mb-3' }, 'Votre agence'), a1, a2, a3, h('h2', { class: 'h5 mt-4 mb-3' }, 'Le responsable du compte'), h('div', { class: 'row' }, h('div', { class: 'col-sm-6' }, g1), h('div', { class: 'col-sm-6' }, g2)), g3, g4, g5, g6, consent.el, btn);

  app.append(h('div', { class: 'row justify-content-center' }, h('div', { class: 'col-md-9 col-lg-7' },
    h('h1', { class: 'page-title' }, 'Inscrire mon agence de transport'),
    h('p', { class: 'text-muted' }, 'Vendez vos tickets en ligne : vous gérez vos bus, vos trajets et vos voyages, et vos clients vous paient directement sur votre propre compte FedaPay.'),
    h('div', { class: 'alert alert-info' }, h('strong', {}, `Abonnement : ${price} pour ${days} jours.`), ' Il est à régler après l\'inscription pour ouvrir votre espace de gestion. Vous y enregistrerez ensuite vos clés FedaPay pour encaisser les tickets directement chez vous.'),
    msg, form,
    h('p', { class: 'text-center mt-4' }, 'Déjà inscrit ? ', h('a', { href: '/connexion.html' }, 'Se connecter'), ' · Vous voulez voyager ? ', h('a', { href: '/inscription.html' }, 'Créer un compte voyageur')))));

  function stepCode(mail, minutes) {
    const cmsg = h('div', {});
    const cf = codeField({ onResend: async () => { await api.post('/api/auth/inscription/renvoyer', { email: mail }); toast('Un nouveau code vient d’être envoyé.', 'success'); } });
    const ok = h('button', { class: 'btn btn-vy w-100', type: 'submit' }, 'Confirmer et créer mon agence');
    const cform = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); clear(cmsg);
      if (cf.input.value.length !== 6) { cmsg.append(alertBox('Saisissez les 6 chiffres du code.')); cf.input.focus(); return; }
      ok.disabled = true;
      try { await api.post('/api/auth/inscription/verifier', { email: mail, code: cf.input.value }); location.href = '/admin#/abonnement'; }
      catch (err) { ok.disabled = false; cmsg.append(alertBox(err.message)); cf.input.select(); }
    } }, cf.el, ok);
    clear(app).append(h('div', { class: 'row justify-content-center' }, h('div', { class: 'col-md-8 col-lg-5' },
      h('h1', { class: 'page-title' }, 'Confirmez votre e-mail'),
      h('p', {}, 'Nous avons envoyé un code à 6 chiffres à ', h('strong', {}, mail), `. Il est valable ${minutes} minutes.`), cmsg, cform,
      h('p', { class: 'text-center mt-4' }, h('a', { href: location.pathname }, 'Modifier mes informations')))));
    cf.cooldown(); cf.input.focus();
  }
}
