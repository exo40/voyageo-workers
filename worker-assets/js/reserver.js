import { api, ApiError } from './api.js';
import { init, h, $, clear, params, state, fmtFCFA, fmtDate, fmtDuree, cap, toast, alertBox, showAlert, mapsHref, busPhoto, driverBlock, icon } from './ui.js';

if (await init({ active: 'trajets', requireAuth: true })) {
  const app = $('#app');
  const id = Number(params().get('id'));
  let horaire = null, occupied = new Set(), selected = null, busy = false;

  const seatsBox = h('div', {});
  const summary = h('div', {});
  const msg = h('div', { id: 'form-msg' });
  app.append(h('a', { class: 'd-inline-block mt-3 small', href: '/trajets.html', onclick: (e) => { if (history.length > 1 && document.referrer.startsWith(location.origin)) { e.preventDefault(); history.back(); } } }, '← Retour aux résultats'), h('h1', { class: 'page-title' }, 'Choisissez votre place'), msg,
    h('div', { class: 'row g-4' }, h('div', { class: 'col-lg-6' }, seatsBox), h('div', { class: 'col-lg-6' }, summary)));

  async function load() {
    const d = await api.get(`/api/horaires/${id}`);
    horaire = d.horaire; occupied = new Set(d.places_occupees);
    if (selected && occupied.has(selected)) { toast(`La place ${selected} vient d’être réservée par un autre voyageur.`, 'error'); selected = null; }
  }

  function renderSeats() {
    const open = horaire.reservable;
    const rows = [];
    for (let start = 1; start <= horaire.nombre_places; start += 4) {
      const cells = [];
      for (let i = 0; i < 4; i++) {
        const n = start + i;
        if (i === 2) cells.push(h('div', { 'aria-hidden': 'true' }));
        if (n > horaire.nombre_places) { cells.push(h('div', { 'aria-hidden': 'true' })); continue; }
        const taken = occupied.has(n);
        cells.push(h('button', {
          type: 'button', class: `seat${selected === n ? ' selected' : ''}`, disabled: taken || !open, 'aria-pressed': selected === n ? 'true' : 'false',
          'aria-label': `Place ${n}${taken ? ', occupée' : selected === n ? ', choisie' : ', libre'}`,
          onclick: () => { selected = selected === n ? null : n; renderSeats(); renderSummary(); },
        }, String(n)));
      }
      rows.push(h('div', { class: 'seat-row' }, cells));
    }
    clear(seatsBox).append(
      h('div', { class: 'legend', 'aria-hidden': 'true' }, h('span', {}, h('i'), 'Libre'), h('span', {}, h('i', { class: 'occ' }), 'Occupée'), h('span', {}, h('i', { class: 'sel' }), 'Choisie')),
      h('div', { class: 'bus-body' }, h('div', { class: 'bus-front' }, h('span', {}, 'Avant du bus'), h('span', { class: 'steering', title: 'Conducteur', 'aria-hidden': 'true' })), rows),
      h('p', { class: 'text-center small text-muted mt-2' }, `${horaire.places_restantes} place${horaire.places_restantes > 1 ? 's' : ''} libre${horaire.places_restantes > 1 ? 's' : ''} sur ${horaire.nombre_places}`));
  }

  const fields = {};
  function field(key, label, attrs = {}, required = true) {
    const input = h('input', { class: 'form-control', id: `f-${key}`, name: key, required, ...attrs });
    fields[key] = input;
    return h('div', { class: 'mb-3' }, h('label', { class: `form-label${required ? ' required' : ''}`, for: `f-${key}` }, label), input);
  }
  let formBuilt = false;
  const formEl = h('form', { novalidate: true, onsubmit: submit });
  const me = h('input', { type: 'checkbox', class: 'form-check-input', id: 'self', checked: true, onchange: fillSelf });
  const ack = h('input', { type: 'checkbox', class: 'form-check-input', id: 'ack-embarquement' });
  function fillSelf() {
    const u = state.user;
    if (me.checked) { fields.prenom.value = u.prenom; fields.nom.value = u.nom; fields.telephone.value = u.telephone || ''; }
    else { fields.prenom.value = ''; fields.nom.value = ''; fields.telephone.value = ''; }
  }
  function buildForm() {
    formEl.append(
      h('h3', { class: 'mt-4 mb-3' }, 'Informations du voyageur'),
      h('div', { class: 'form-check mb-3' }, me, h('label', { class: 'form-check-label', for: 'self' }, 'Je voyage moi-même')),
      h('div', { class: 'row' }, h('div', { class: 'col-sm-6' }, field('prenom', 'Prénom', { autocomplete: 'given-name', maxlength: 100 })), h('div', { class: 'col-sm-6' }, field('nom', 'Nom', { autocomplete: 'family-name', maxlength: 100 }))),
      field('telephone', 'Téléphone', { type: 'tel', autocomplete: 'tel', inputmode: 'tel', maxlength: 25, placeholder: '+229 01 00 00 00 00' }),
      field('piece_identite', "N° de pièce d'identité (facultatif)", { maxlength: 60 }, false),
      h('div', { class: 'form-check mb-3' }, ack, h('label', { class: 'form-check-label', for: 'ack-embarquement' }, horaire.lieu_embarquement ? 'J’ai bien noté le lieu d’embarquement et je m’y présenterai avant l’heure de départ.' : 'Je contacterai la compagnie pour connaître le lieu d’embarquement avant le départ.')),
      h('div', { id: 'submit-slot' }));
    fillSelf(); formBuilt = true;
  }

  function renderSummary() {
    const h0 = horaire;
    const rows = [['Compagnie', h0.compagnie_nom], ['Trajet', `${h0.ville_depart} – ${h0.ville_arrivee}`], ['Date', cap(fmtDate(h0.date_depart))],
      ['Départ', h0.heure_depart], ['Arrivée estimée', h0.heure_arrivee || '—'], ['Durée', fmtDuree(h0.duree_estimee) || '—'], ['Place choisie', selected ? `N° ${selected}` : 'Aucune']];
    const btn = h('button', { class: 'btn btn-vy w-100 mt-2', type: 'submit', disabled: !selected || !h0.reservable || busy }, busy ? 'Réservation en cours…' : selected ? `Réserver la place ${selected}` : 'Choisissez une place');
    const boarding = h('div', { class: 'boarding-box my-3' }, h('div', { class: 'small text-uppercase fw-bold text-success' }, icon('pin', 16), ' Lieu d’embarquement'),
      h0.lieu_embarquement
        ? [h('div', { class: 'place' }, h0.lieu_embarquement), h('a', { class: 'btn btn-vy-outline btn-sm mt-2', href: mapsHref(h0.lieu_embarquement, h0.lien_maps, h0.ville_depart), target: '_blank', rel: 'noopener noreferrer' }, 'Voir sur Google Maps')]
        : h('div', {}, 'Le lieu exact n’est pas encore renseigné : contactez la compagnie ou le service client WhatsApp avant de payer.'),
      h('div', { class: 'small text-muted mt-2' }, `Présentez-vous à ce lieu avant ${h0.heure_depart}.`));
    clear(summary);
    summary.append(h('div', { class: 'summary-card' },
      busPhoto(h0.photo_bus, `Bus de ${h0.compagnie_nom}`), h('div', { class: 'my-3' }, driverBlock(h0)),
      rows.map(([k, v]) => h('div', { class: 'summary-row' }, h('span', { class: 'text-muted' }, k), h('strong', {}, v))),
      boarding,
      h('div', { class: 'summary-row' }, h('span', { class: 'text-muted' }, 'Prix'), h('strong', { class: 'trajet-price' }, fmtFCFA(h0.tarif_fcfa))),
      !h0.reservable ? alertBox(h0.places_restantes === 0 ? 'Ce voyage est complet.' : 'Les réservations pour ce voyage sont closes.', 'warning') : null,
      state.config.paiement.requis ? h('p', { class: 'small text-muted mt-2 mb-0' }, `Après cet enregistrement, vous aurez ${state.config.attente_minutes} minutes pour payer. Passé ce délai, la place est libérée. Votre ticket vous sera délivré uniquement après le paiement.`) : null,
      h0.reservable ? [(!formBuilt && buildForm(), formEl)] : null));
    const slot = $('#submit-slot');
    if (slot) clear(slot).append(btn);
  }

  async function submit(e) {
    e.preventDefault();
    if (busy || !selected) return;
    const body = { id_horaire: id, numero_place: selected, prenom: fields.prenom.value, nom: fields.nom.value, telephone: fields.telephone.value, piece_identite: fields.piece_identite.value };
    if (!body.prenom.trim() || !body.nom.trim() || !body.telephone.trim()) { showAlert(msg, 'Veuillez renseigner le prénom, le nom et le téléphone du voyageur.'); return; }
    if (!ack.checked) { showAlert(msg, horaire.lieu_embarquement ? 'Veuillez confirmer que vous avez bien noté le lieu d’embarquement.' : 'Veuillez cocher la case concernant le lieu d’embarquement.'); ack.focus(); return; }
    busy = true; clear(msg); renderSummary();
    try {
      const out = await api.post('/api/reservations', body);
      const n = encodeURIComponent(out.reservation.numero_ticket);
      location.href = out.reservation.statut === 'en_attente' ? `/paiement.html?n=${n}` : `/ticket.html?n=${n}&nouveau=1`;
    } catch (err) {
      busy = false;
      showAlert(msg, err.message);
      if (err instanceof ApiError && err.code === 'SEAT_TAKEN') { selected = null; await load().catch(() => {}); renderSeats(); }
      renderSummary();
    }
  }

  try {
    if (!Number.isInteger(id) || id < 1) throw new Error('Voyage introuvable.');
    await load(); renderSeats(); renderSummary();
    setInterval(async () => { if (!busy && document.visibilityState === 'visible') { try { await load(); renderSeats(); renderSummary(); } catch { /* on réessaiera */ } } }, 20000);
  } catch (e) { clear(app).append(h('div', { class: 'py-5' }, alertBox(e.message), h('a', { class: 'btn btn-vy', href: '/trajets.html' }, 'Rechercher un trajet'))); }
}
