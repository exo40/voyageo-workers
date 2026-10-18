// Formulaire de recherche (accueil et page des trajets).
import { api } from './api.js';
import { h, clear, todayStr, state } from './ui.js';

export async function initSearchForm(form, defaults = {}) {
  const depart = form.querySelector('[name=depart]');
  const arrivee = form.querySelector('[name=arrivee]');
  const date = form.querySelector('[name=date]');
  const err = form.querySelector('.field-error');
  let villes = [];
  try { villes = (await api.get('/api/villes')).villes; } catch { villes = ['Abomey-Calavi', 'Bohicon', 'Cotonou', 'Parakou', 'Porto-Novo']; }
  const fill = (sel, placeholder, value) => {
    clear(sel).append(h('option', { value: '' }, placeholder), villes.map((v) => h('option', { value: v, selected: v === value }, v)));
  };
  fill(depart, 'Choisir une ville', defaults.depart);
  fill(arrivee, 'Choisir une ville', defaults.arrivee);
  const today = todayStr();
  date.min = today;
  date.value = defaults.date && defaults.date >= today ? defaults.date : today;
  form.querySelector('.swap-btn')?.addEventListener('click', () => { const t = depart.value; depart.value = arrivee.value; arrivee.value = t; });
  form.addEventListener('submit', (e) => {
    if (!depart.value || !arrivee.value || depart.value === arrivee.value) {
      e.preventDefault();
      err.textContent = !depart.value || !arrivee.value ? 'Veuillez choisir la ville de départ et la destination.' : 'Choisissez deux villes différentes.';
      (depart.value ? arrivee : depart).focus();
    }
  });
  return { villes, depart, arrivee, date };
}
export const searchFormHtml = (flat = false) => h('form', { class: `search-card${flat ? ' flat' : ''}`, action: '/trajets.html', method: 'get', novalidate: true, 'aria-label': 'Rechercher un trajet' },
  h('div', { class: 'row g-3 align-items-end' },
    h('div', { class: 'col-md' }, h('label', { class: 'form-label', for: 'sf-depart' }, 'Ville de départ'), h('select', { class: 'form-select', id: 'sf-depart', name: 'depart' })),
    h('div', { class: 'col-auto d-none d-md-block' }, h('button', { type: 'button', class: 'btn btn-vy-outline swap-btn', 'aria-label': 'Inverser départ et destination' }, '⇄')),
    h('div', { class: 'col-md' }, h('label', { class: 'form-label', for: 'sf-arrivee' }, 'Destination'), h('select', { class: 'form-select', id: 'sf-arrivee', name: 'arrivee' })),
    h('div', { class: 'col-md' }, h('label', { class: 'form-label', for: 'sf-date' }, 'Date du voyage'), h('input', { class: 'form-control', id: 'sf-date', name: 'date', type: 'date', required: true })),
    h('div', { class: 'col-md-auto' }, h('button', { class: 'btn btn-vy w-100', type: 'submit' }, 'Rechercher'))),
  h('div', { class: 'field-error', role: 'alert' }));
export { state };
