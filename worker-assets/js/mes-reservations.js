import { api } from './api.js';
import { init, h, $, clear, fmtFCFA, fmtDate, cap, badge, departureMs, alertBox, skeletons, toast, state, icon } from './ui.js';

if (await init({ active: 'reservations', requireAuth: true })) {
  const app = $('#app');
  const list = h('div', {}, ...skeletons(2));
  const tabs = h('div', { class: 'd-flex gap-2 flex-wrap mb-3', role: 'tablist' });
  app.append(h('h1', { class: 'page-title' }, 'Mes réservations'), tabs, list);
  let all = [], tab = 'avenir';
  const now = () => Date.now();
  const groups = () => ({
    avenir: all.filter((r) => r.statut !== 'annulee' && departureMs(r.date_depart, r.heure_depart) >= now()).sort((a, b) => departureMs(a.date_depart, a.heure_depart) - departureMs(b.date_depart, b.heure_depart)),
    passees: all.filter((r) => r.statut !== 'annulee' && departureMs(r.date_depart, r.heure_depart) < now()),
    annulees: all.filter((r) => r.statut === 'annulee'),
  });
  function render() {
    const g = groups();
    clear(tabs).append(...[['avenir', 'À venir'], ['passees', 'Passées'], ['annulees', 'Annulées']].map(([k, l]) =>
      h('button', { type: 'button', role: 'tab', 'aria-selected': tab === k ? 'true' : 'false', class: `btn btn-sm ${tab === k ? 'btn-vy' : 'btn-vy-outline'}`, onclick: () => { tab = k; render(); } }, `${l} (${g[k].length})`)));
    const items = g[tab];
    clear(list).append(...(items.length ? items.map(card) : [h('div', { class: 'alert alert-info' }, tab === 'avenir' ? ['Aucun voyage à venir. ', h('a', { href: '/trajets.html' }, 'Rechercher un trajet')] : 'Rien à afficher ici.')]));
  }
  function card(r) {
    const limit = departureMs(r.date_depart, r.heure_depart) - state.config.annulation_heures * 3600000;
    const cancellable = r.statut !== 'annulee' && now() <= limit;
    return h('article', { class: 'card-trajet' }, h('div', { class: 'row align-items-center g-3' },
      h('div', { class: 'col-md-5' }, h('div', { class: 'trajet-company' }, `${r.ville_depart} – ${r.ville_arrivee}`), h('div', { class: 'text-muted small' }, `${cap(fmtDate(r.date_depart, false))} à ${r.heure_depart} · ${r.compagnie_nom}`)),
      h('div', { class: 'col-6 col-md-3' }, h('div', { class: 'small text-muted' }, `Ticket ${r.numero_ticket}`), h('div', { class: 'small' }, `Place ${r.numero_place} · ${fmtFCFA(r.tarif_fcfa)}`), badge(r.statut), r.statut === 'en_attente' ? h('div', { class: 'small text-muted' }, 'Ticket délivré après paiement') : null),
      h('div', { class: 'col-6 col-md-4 text-end d-flex flex-wrap gap-2 justify-content-end' },
        r.statut === 'en_attente' && state.config.paiement.requis ? h('a', { class: 'btn btn-vy btn-sm', href: `/paiement.html?n=${encodeURIComponent(r.numero_ticket)}` }, 'Payer') : null,
        r.statut === 'confirmee' ? h('a', { class: 'btn btn-vy-outline btn-sm', href: `/ticket.html?n=${encodeURIComponent(r.numero_ticket)}` }, 'Voir le ticket') : null,
        r.statut === 'confirmee' && r.chauffeur_prenom && departureMs(r.date_depart, r.heure_depart) + 4 * 3600000 < now() ? h('a', { class: 'btn btn-vy btn-sm', href: `/ticket.html?n=${encodeURIComponent(r.numero_ticket)}#avis` }, icon('star', 15), ' Noter / pourboire') : null,
        cancellable ? h('button', { class: 'btn btn-vy-danger btn-sm', type: 'button', onclick: () => cancel(r) }, 'Annuler') : null)));
  }
  async function cancel(r) {
    if (!confirm(`Annuler la réservation ${r.numero_ticket} ?`)) return;
    try { const out = await api.post(`/api/reservations/${encodeURIComponent(r.numero_ticket)}/annuler`); Object.assign(r, out.reservation); toast(out.remboursement_a_traiter ? 'Réservation annulée. Contactez la compagnie pour le remboursement.' : 'Réservation annulée.', 'success'); render(); }
    catch (e) { toast(e.message, 'error'); }
  }
  try { all = (await api.get('/api/reservations/moi')).reservations; render(); }
  catch (e) { clear(list).append(alertBox(e.message)); }
}
