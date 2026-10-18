import { api } from './api.js';
import { init, h, $, params, fmtDate, cap, alertBox, icon } from './ui.js';

if (await init({})) {
  const app = $('#app');
  const n = params().get('n') || '';
  app.append(h('h1', { class: 'page-title text-center' }, 'Vérification de ticket'));
  try {
    const r = await api.get(`/api/verifier/${encodeURIComponent(n)}`);
    if (!r.valide && !r.numero_ticket) app.append(h('div', { class: 'verify-box' }, h('div', { class: 'verify-icon badge-ko', 'aria-hidden': 'true' }, icon('x', 36)), h('h2', {}, 'Ticket introuvable'), h('p', { class: 'text-muted' }, 'Ce numéro de ticket n’existe pas.')));
    else app.append(h('div', { class: 'verify-box' },
      h('div', { class: `verify-icon ${r.valide ? 'badge-ok' : 'badge-ko'}`, 'aria-hidden': 'true' }, r.valide ? icon('check', 36) : icon('x', 36)),
      h('h2', {}, r.valide ? 'Ticket valide' : r.statut === 'annulee' ? 'Ticket annulé' : 'Ticket non valide'),
      h('div', { class: 'summary-card text-start mt-3' }, [['Ticket', r.numero_ticket], ['Trajet', `${r.ville_depart} – ${r.ville_arrivee}`], ['Départ', `${cap(fmtDate(r.date_depart, false))} à ${r.heure_depart}`],
        ['Compagnie', r.compagnie_nom], ['Place', String(r.numero_place)], ['Passager', r.passager]].map(([k, v]) => h('div', { class: 'summary-row' }, h('span', { class: 'text-muted' }, k), h('strong', {}, v)))),
      r.passe && r.valide ? h('p', { class: 'small text-muted mt-2' }, 'Le départ de ce voyage est déjà passé.') : null));
  } catch (e) { app.append(alertBox(e.message)); }
}
