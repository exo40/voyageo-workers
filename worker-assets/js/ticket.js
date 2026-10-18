import { api, ApiError } from './api.js';
import { init, h, $, clear, params, fmtFCFA, fmtDate, cap, alertBox, toast, skeletons, state, mapsHref, busPhoto, driverBlock, icon } from './ui.js';
import { feedbackPanel } from './feedback.js';

/** Ouvre la fenêtre d'impression du navigateur : choisir « Enregistrer au format PDF ». Le fichier porte le numéro du ticket. */
function savePdf(numero) {
  const title = document.title;
  document.title = `Ticket-${numero}`;
  window.print();
  setTimeout(() => { document.title = title; }, 1000);
}

if (await init({ requireAuth: true })) {
  const app = $('#app');
  const n = params().get('n') || '';
  const p = params();
  app.append(h('div', { class: 'no-print' }, h('h1', { class: 'page-title' }, 'Votre ticket')));
  const top = h('div', { class: 'no-print' });
  const body = h('div', {}, ...skeletons(1));
  app.append(top, body);

  async function load() {
    clear(top);
    let d;
    try { d = await api.get(`/api/reservations/${encodeURIComponent(n)}`); }
    catch (e) { clear(body).append(alertBox(e.message), h('a', { class: 'btn btn-vy', href: '/mes-reservations.html' }, 'Mes réservations')); return; }
    const r = d.reservation;
    const confirmed = r.statut === 'confirmee' && d.ticket_disponible !== false;
    // Les messages de succès ne s'affichent que si le serveur confirme réellement le paiement (jamais d'après l'adresse de la page).
    if (confirmed && p.get('paiement') === 'ok') top.append(alertBox('Paiement reçu. Votre réservation est confirmée.', 'success'));
    if (p.get('paiement') === 'place') top.append(alertBox("Paiement reçu, mais la place a été attribuée à un autre voyageur. Contactez la compagnie pour un remboursement.", 'danger'));
    if (p.get('pourboire') === 'ok') top.append(alertBox('Merci ! Votre pourboire a bien été reçu.', 'success'));
    if (p.get('pourboire') === 'echec') top.append(alertBox('Le paiement du pourboire a échoué. Vous pouvez réessayer.', 'warning'));
    if (p.get('pourboire') === 'attente') top.append(alertBox('Votre pourboire est en cours de confirmation. Actualisez la page dans un instant.', 'info'));
    if (confirmed && p.get('nouveau')) top.append(alertBox('Réservation confirmée ! Conservez ce ticket : il vous sera demandé à l’embarquement.', 'success'));

    // Pas de ticket tant que le paiement n'est pas fait : on affiche seulement le récapitulatif de la réservation.
    if (!confirmed) { renderNoTicket(d); return; }

    const cell = (l, v) => h('div', {}, h('div', { class: 'ticket-label' }, l), h('div', { class: 'ticket-value' }, v));
    const ticket = h('article', { class: 'ticket', 'aria-label': `Ticket ${r.numero_ticket}` },
      h('div', { class: 'ticket-main' },
        h('div', { class: 'd-flex justify-content-between align-items-center' }, h('span', { class: 'vy-wordmark' }, 'Voya', h('span', {}, 'géo')), h('span', { class: 'ticket-kind' }, 'TICKET DE BUS')),
        h('div', { class: 'ticket-route' }, h('span', {}, r.ville_depart), h('span', { class: 'ticket-arrow', 'aria-label': 'vers' }), h('span', {}, r.ville_arrivee)),
        h('div', { class: 'ticket-grid' },
          cell('Date', cap(fmtDate(r.date_depart, false))), cell('Départ', r.heure_depart), cell('Arrivée (estimée)', r.heure_arrivee || '—'),
          cell('Compagnie', r.compagnie_nom), cell('Passager', `${r.prenom_passager} ${r.nom_passager}`), cell('Place', String(r.numero_place))),
        r.lieu_embarquement ? h('div', { class: 'mt-3' }, h('div', { class: 'ticket-label' }, 'Lieu d’embarquement'), h('div', { class: 'ticket-value' }, r.lieu_embarquement, ' ', h('a', { class: 'maps-link no-print', href: mapsHref(r.lieu_embarquement, r.lien_maps, r.ville_depart), target: '_blank', rel: 'noopener noreferrer' }, 'Voir sur Maps'))) : null),
      h('div', { class: 'ticket-side' },
        d.qr ? h('img', { src: d.qr, alt: `QR code du ticket ${r.numero_ticket}`, width: 160, height: 160 }) : null,
        h('div', { class: 'ticket-number' }, r.numero_ticket), h('div', { class: 'small text-muted' }, `Tarif : ${fmtFCFA(r.tarif_fcfa)}`),
        h('div', { class: 'small text-muted' }, 'Présentez ce ticket à l’embarquement')));
    const actions = h('div', { class: 'd-flex flex-wrap gap-2 mt-4 no-print' },
      h('button', { class: 'btn btn-vy', type: 'button', onclick: () => savePdf(r.numero_ticket) }, icon('download', 18), ' Télécharger le ticket (PDF)'),
      h('button', { class: 'btn btn-vy-outline', type: 'button', onclick: () => window.print() }, 'Imprimer'),
      d.annulable ? h('button', { class: 'btn btn-vy-danger', type: 'button', onclick: cancel }, 'Annuler la réservation') : null,
      h('a', { class: 'btn btn-vy-outline', href: '/mes-reservations.html' }, 'Mes réservations'));
    const bus = h('div', { class: 'row g-3 align-items-center mt-3 no-print' },
      h('div', { class: 'col-sm-5 col-md-4' }, busPhoto(r.photo_bus, `Bus de ${r.compagnie_nom}`)),
      h('div', { class: 'col-sm-7 col-md-8' }, h('div', { class: 'small text-muted mb-1' }, 'Votre bus et votre chauffeur'), driverBlock(r) || h('div', { class: 'text-muted small' }, 'Chauffeur : à venir')));
    clear(body).append(ticket, bus, feedbackPanel(d, n, load), actions,
      !d.annulable ? h('p', { class: 'small text-muted mt-3 no-print' }, `L’annulation n’est possible que jusqu’à ${d.annulation_heures} h avant le départ.`) : null,
      d.paiement ? h('p', { class: 'small text-muted mt-1 no-print' }, `Paiement : ${d.paiement.statut === 'reussi' ? 'reçu' : d.paiement.statut === 'echoue' ? 'échoué' : 'en attente'} (${d.paiement.mode})`) : null);
  }

  /** Réservation non payée (ou annulée) : aucun ticket, aucun QR code. */
  function renderNoTicket(d) {
    const r = d.reservation;
    const pending = r.statut === 'en_attente';
    const row = (l, v) => h('div', { class: 'summary-row' }, h('span', { class: 'text-muted' }, l), h('strong', {}, v));
    clear(body).append(
      pending
        ? alertBox(state.config.paiement.requis
          ? "Votre ticket n'est pas encore disponible : il sera délivré dès que le paiement sera effectué."
          : "Votre réservation est en attente. Le ticket sera disponible dès sa confirmation.", 'warning')
        : alertBox('Cette réservation a été annulée ou a expiré. Aucun ticket n’est disponible.', 'secondary'),
      h('div', { class: 'summary-card' },
        row('Réservation', r.numero_ticket), row('Trajet', `${r.ville_depart} – ${r.ville_arrivee}`),
        row('Départ', `${cap(fmtDate(r.date_depart, false))} à ${r.heure_depart}`), row('Compagnie', r.compagnie_nom), row('Place', String(r.numero_place)),
        row('Montant', fmtFCFA(r.tarif_fcfa))),
      r.lieu_embarquement ? h('div', { class: 'boarding-box my-3' }, h('div', { class: 'small fw-bold text-success' }, icon('pin', 16), ' Lieu d’embarquement'), h('div', { class: 'place' }, r.lieu_embarquement), h('a', { class: 'maps-link', href: mapsHref(r.lieu_embarquement, r.lien_maps, r.ville_depart), target: '_blank', rel: 'noopener noreferrer' }, 'Voir sur Maps')) : null,
      h('div', { class: 'd-flex flex-wrap gap-2 mt-4 no-print' },
        pending && state.config.paiement.requis ? h('a', { class: 'btn btn-vy', href: `/paiement.html?n=${encodeURIComponent(n)}` }, `Payer ${fmtFCFA(r.tarif_fcfa)}`) : null,
        !pending ? h('a', { class: 'btn btn-vy', href: '/trajets.html' }, 'Rechercher un trajet') : null,
        pending && d.annulable ? h('button', { class: 'btn btn-vy-danger', type: 'button', onclick: cancel }, 'Annuler la réservation') : null,
        h('a', { class: 'btn btn-vy-outline', href: '/mes-reservations.html' }, 'Mes réservations')));
  }
  async function cancel() {
    if (!confirm('Voulez-vous vraiment annuler cette réservation ?')) return;
    try {
      const out = await api.post(`/api/reservations/${encodeURIComponent(n)}/annuler`);
      toast(out.remboursement_a_traiter ? 'Réservation annulée. Contactez la compagnie pour le remboursement.' : 'Réservation annulée.', 'success');
      p.delete('nouveau'); p.delete('paiement'); await load();
    } catch (e) { toast(e.message, 'error'); }
  }
  await load();
  if (location.hash === '#avis') document.getElementById('avis')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
