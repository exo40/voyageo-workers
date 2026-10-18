import { api } from './api.js';
import { init, h, $, state, toast, alertBox, clear, badge } from './ui.js';

if (await init({ requireAuth: true })) {
  const app = $('#app'), u = state.user;
  const msg = h('div', {});
  const inp = (id, label, auto) => { const i = h('input', { class: 'form-control', id, type: 'password', autocomplete: auto, required: true }); return [i, h('div', { class: 'mb-3' }, h('label', { class: 'form-label', for: id }, label), i)]; };
  const [cur, g1] = inp('cur', 'Mot de passe actuel', 'current-password');
  const [nw, g2] = inp('nw', 'Nouveau mot de passe (8 caractères minimum)', 'new-password');
  const [nw2, g3] = inp('nw2', 'Confirmer le nouveau mot de passe', 'new-password');
  const roleLabel = { voyageur: 'Voyageur', admin: 'Administrateur', gestionnaire: 'Gestionnaire de compagnie' }[u.role];
  const form = h('form', { novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); clear(msg);
    if (nw.value !== nw2.value) { msg.append(alertBox('Les deux nouveaux mots de passe ne sont pas identiques.')); return; }
    try { await api.post('/api/auth/mot-de-passe', { actuel: cur.value, nouveau: nw.value }); form.reset(); toast('Mot de passe modifié.', 'success'); }
    catch (err) { msg.append(alertBox(err.message)); }
  } }, g1, g2, g3, h('button', { class: 'btn btn-vy', type: 'submit' }, 'Changer le mot de passe'));
  app.append(h('h1', { class: 'page-title' }, 'Mon compte'), h('div', { class: 'row g-4' },
    h('div', { class: 'col-md-6' }, h('div', { class: 'summary-card' }, h('h2', { class: 'h5 mb-3' }, 'Mes informations'),
      [['Nom', `${u.prenom} ${u.nom}`], ['E-mail', u.email], ['Téléphone', u.telephone || '—'], ['Profil', roleLabel]].map(([k, v]) => h('div', { class: 'summary-row' }, h('span', { class: 'text-muted' }, k), h('strong', {}, v))))),
    h('div', { class: 'col-md-6' }, h('div', { class: 'summary-card' }, h('h2', { class: 'h5 mb-3' }, 'Sécurité'), msg, form))));
}
