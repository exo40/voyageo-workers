import { api, qs } from './api.js';
import { init, h, $, clear, params, fmtFCFA, fmtDate, fmtDuree, cap, todayStr, addDays, skeletons, alertBox, boardingLine, busPhoto, driverBlock } from './ui.js';
import { initSearchForm, searchFormHtml } from './search-form.js';

if (await init({ active: 'trajets' })) {
  const app = $('#app');
  const p = params();
  const q = { depart: p.get('depart') || '', arrivee: p.get('arrivee') || '', date: p.get('date') || '' };
  const form = searchFormHtml(true);
  const results = h('div', { id: 'results', 'aria-live': 'polite' });
  app.append(h('h1', { class: 'page-title' }, 'Rechercher un trajet'), form, results);
  await initSearchForm(form, q);

  let list = [];
  let sort = 'heure';
  const dayLink = (label, date, disabled) => h('a', { class: `btn btn-vy-outline btn-sm${disabled ? ' disabled' : ''}`, href: disabled ? null : `/trajets.html${qs({ depart: q.depart, arrivee: q.arrivee, date })}`, 'aria-disabled': disabled ? 'true' : null }, label);

  function card(t) {
    const full = t.places_restantes === 0;
    const places = full ? h('span', { class: 'badge-vy badge-ko' }, 'Complet')
      : h('span', { class: `badge-vy ${t.places_restantes <= 5 ? 'badge-warn' : 'badge-ok'}` }, `${t.places_restantes} place${t.places_restantes > 1 ? 's' : ''} libre${t.places_restantes > 1 ? 's' : ''}`);
    return h('article', { class: `card-trajet${t.reservable ? '' : ' complet'}` },
      h('div', { class: 'row align-items-center g-3' },
        h('div', { class: 'col-md-5' }, h('div', { class: 'd-flex gap-3 flex-wrap flex-sm-nowrap' }, busPhoto(t.photo_bus, `Bus de ${t.compagnie_nom}`, 'bus-thumb'),
          h('div', {}, h('div', { class: 'trajet-company' }, t.compagnie_nom), h('div', { class: 'text-muted small' }, `${t.ville_depart} – ${t.ville_arrivee}`), boardingLine(t), driverBlock(t, 'mt-2')))),
        h('div', { class: 'col-md-3' }, h('div', { class: 'trajet-times' }, `${t.heure_depart}${t.heure_arrivee ? ' – ' + t.heure_arrivee : ''}`),
          t.duree_estimee ? h('div', { class: 'text-muted small' }, `Durée estimée : ${fmtDuree(t.duree_estimee)}`) : null, h('div', { class: 'mt-1' }, places)),
        h('div', { class: 'col-md-4 text-md-end' }, h('div', { class: 'trajet-price mb-2' }, fmtFCFA(t.tarif_fcfa)),
          t.reservable ? h('a', { class: 'btn btn-vy', href: `/reserver.html?id=${t.id_horaire}` }, 'Choisir ce voyage')
            : h('button', { class: 'btn btn-vy', disabled: true, type: 'button' }, full ? 'Complet' : 'Réservations closes'))));
  }
  function render() {
    const sorted = [...list].sort((a, b) => (sort === 'prix' ? a.tarif_fcfa - b.tarif_fcfa || a.heure_depart.localeCompare(b.heure_depart) : a.heure_depart.localeCompare(b.heure_depart)));
    const today = todayStr();
    clear(results).append(
      h('div', { class: 'd-flex flex-wrap justify-content-between align-items-center gap-2 my-3' },
        h('h2', { class: 'h5 mb-0' }, `${q.depart} – ${q.arrivee} · ${cap(fmtDate(q.date))}`),
        h('div', { class: 'd-flex gap-2 align-items-center' },
          dayLink('Jour précédent', addDays(q.date, -1), addDays(q.date, -1) < today), dayLink('Jour suivant', addDays(q.date, 1), false),
          h('label', { class: 'visually-hidden', for: 'sort' }, 'Trier par'),
          h('select', { class: 'form-select form-select-sm w-auto', id: 'sort', onchange: (e) => { sort = e.target.value; render(); } },
            h('option', { value: 'heure', selected: sort === 'heure' }, 'Trier par heure'), h('option', { value: 'prix', selected: sort === 'prix' }, 'Trier par prix')))),
      sorted.length ? h('div', {}, sorted.map(card))
        : h('div', { class: 'alert alert-info' }, 'Aucun voyage trouvé pour cette date. Essayez le jour suivant ou une autre date.'));
  }
  if (!q.depart || !q.arrivee || !q.date) {
    results.append(h('p', { class: 'text-muted mt-4' }, 'Choisissez une ville de départ, une destination et une date, puis lancez la recherche.'));
  } else {
    results.append(...skeletons(3));
    try { list = (await api.get('/api/horaires' + qs(q))).horaires; render(); }
    catch (e) { clear(results).append(alertBox(e.message)); }
  }
}
