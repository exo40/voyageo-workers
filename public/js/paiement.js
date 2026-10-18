import { api } from './api.js';
import { init, h, $, clear, params, state, fmtFCFA, fmtDate, cap, alertBox, showAlert, boardingLine, icon } from './ui.js';

if (await init({ requireAuth: true })) {
  const app = $('#app');
  const n = params().get('n') || '';
  const msg = h('div', {});
  const mode = state.config.paiement.mode;
  app.append(h('h1', { class: 'page-title' }, 'Paiement de votre réservation'), msg);
  const retour = params().get('paiement');
  if (retour === 'echec') msg.append(alertBox("Le paiement n'a pas abouti. Aucun ticket n'a été délivré : vous pouvez réessayer tant que la réservation n'a pas expiré.", 'warning'));
  if (retour === 'attente') msg.append(alertBox("Votre paiement n'est pas encore confirmé. Votre ticket sera disponible dès que le paiement sera reçu. Si vous venez de payer, patientez un instant puis actualisez cette page.", 'info'));
  try {
    const { reservation: r } = await api.get(`/api/reservations/${encodeURIComponent(n)}`);
    if (r.statut === 'confirmee') { location.replace(`/ticket.html?n=${encodeURIComponent(n)}`); }
    else if (r.statut === 'annulee') { app.append(alertBox('Cette réservation a expiré ou a été annulée. Veuillez réserver à nouveau.', 'warning'), h('a', { class: 'btn btn-vy', href: '/trajets.html' }, 'Rechercher un trajet')); }
    else {
      if (retour === 'attente') { const poll = setInterval(async () => { try { const x = (await api.get(`/api/reservations/${encodeURIComponent(n)}`)).reservation; if (x.statut === 'confirmee') { clearInterval(poll); location.replace(`/ticket.html?n=${encodeURIComponent(n)}&paiement=ok`); } else if (x.statut === 'annulee') { clearInterval(poll); location.reload(); } } catch { /* on réessaiera */ } }, 5000); }
      const deadline = new Date(r.date_reservation).getTime() + state.config.attente_minutes * 60000;
      const timer = h('strong', {});
      const tick = () => { const s = Math.max(0, Math.round((deadline - Date.now()) / 1000)); timer.textContent = `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`; if (!s) { clearInterval(iv); showAlert(msg, 'Le délai de paiement est dépassé : la place a été libérée.', 'warning'); } };
      const iv = setInterval(tick, 1000); tick();
      const pay = h('button', { class: 'btn btn-vy btn-lg w-100 mt-3', type: 'submit' }, `Payer ${fmtFCFA(r.tarif_fcfa)}`);
      let formBody;
      const form = h('form', { novalidate: true });
      if (mode === 'simulation') {
        const ops = state.config.paiement.operateurs;
        const tel = h('input', { class: 'form-control', id: 'tel', type: 'tel', inputmode: 'tel', placeholder: '+229 01 00 00 00 00', required: true, value: state.user.telephone || '' });
        formBody = [
          h('div', { class: 'alert alert-info' }, 'Mode démonstration : le paiement est simulé, aucun argent n’est débité.'),
          h('fieldset', { class: 'mb-3' }, h('legend', { class: 'form-label' }, 'Opérateur Mobile Money'),
            ops.map((o, i) => h('label', { class: 'pay-op mb-2' }, h('input', { type: 'radio', name: 'operateur', value: o, checked: i === 0 }), o))),
          h('div', { class: 'mb-3' }, h('label', { class: 'form-label required', for: 'tel' }, 'Numéro Mobile Money'), tel), pay];
        form.addEventListener('submit', async (e) => {
          e.preventDefault(); pay.disabled = true;
          try { await api.post('/api/paiements/simuler', { numero_ticket: n, operateur: form.querySelector('[name=operateur]:checked').value, telephone: tel.value }); location.href = `/ticket.html?n=${encodeURIComponent(n)}&paiement=ok`; }
          catch (err) { pay.disabled = false; showAlert(msg, err.message); }
        });
      } else {
        formBody = [h('p', {}, 'Vous allez être redirigé vers la page de paiement sécurisée (Mobile Money ou carte).'), pay];
        form.addEventListener('submit', async (e) => {
          e.preventDefault(); pay.disabled = true;
          try { const out = await api.post('/api/paiements/initier', { numero_ticket: n }); location.href = out.url; }
          catch (err) { pay.disabled = false; showAlert(msg, err.message); }
        });
      }
      append2(form, formBody);
      app.append(h('div', { class: 'row g-4' },
        h('div', { class: 'col-md-6' }, h('div', { class: 'summary-card' },
          h('div', { class: 'summary-row' }, h('span', { class: 'text-muted' }, 'Ticket'), h('strong', {}, r.numero_ticket)),
          h('div', { class: 'summary-row' }, h('span', { class: 'text-muted' }, 'Trajet'), h('strong', {}, `${r.ville_depart} – ${r.ville_arrivee}`)),
          h('div', { class: 'summary-row' }, h('span', { class: 'text-muted' }, 'Départ'), h('strong', {}, `${cap(fmtDate(r.date_depart, false))} à ${r.heure_depart}`)),
          h('div', { class: 'summary-row' }, h('span', { class: 'text-muted' }, 'Place'), h('strong', {}, String(r.numero_place))),
          h('div', { class: 'summary-row' }, h('span', { class: 'text-muted' }, 'Montant'), h('strong', { class: 'trajet-price' }, fmtFCFA(r.tarif_fcfa))),
          r.lieu_embarquement ? h('div', { class: 'boarding-box my-3' }, h('div', { class: 'small fw-bold text-success' }, icon('pin', 16), ' Lieu d’embarquement'), h('div', { class: 'place' }, r.lieu_embarquement), boardingLine({ ...r, lieu_embarquement: r.lieu_embarquement }, 'small')) : null,
          h('p', { class: 'small text-muted mt-3 mb-0' }, 'Temps restant pour payer : ', timer), h('p', { class: 'small text-muted mb-0' }, 'Votre ticket vous sera délivré dès que le paiement sera confirmé.'))),
        h('div', { class: 'col-md-6' }, form)));
    }
  } catch (e) { app.append(alertBox(e.message)); }
}
function append2(el, kids) { for (const k of kids.flat()) el.append(k); }
