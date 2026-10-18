// Après le voyage : note du chauffeur (étoiles) et pourboire.
import { api } from './api.js';
import { h, state, fmtFCFA, toast, alertBox, clear, stars, photoImg, icon } from './ui.js';

export function feedbackPanel(d, numero, reload) {
  const r = d.reservation, f = d.retour;
  if (!f || !f.possible) {
    return r.statut === 'confirmee' && r.chauffeur_prenom
      ? h('p', { class: 'small text-muted mt-3 no-print' }, `Une fois le voyage terminé, vous pourrez noter ${r.chauffeur_prenom} et lui laisser un pourboire ici.`) : null;
  }
  const n = encodeURIComponent(numero);
  const box = h('section', { class: 'feedback-card mt-4 no-print', id: 'avis', 'aria-labelledby': 'avis-t' });
  const head = h('div', { class: 'd-flex align-items-center gap-3 mb-3' },
    photoImg(r.chauffeur_photo, '/img/chauffeur-defaut.svg', `Photo du chauffeur ${r.chauffeur_prenom}`, '', { width: 56, height: 56 }),
    h('div', {}, h('h2', { id: 'avis-t', class: 'h5 mb-0' }, `Comment s’est passé le voyage avec ${r.chauffeur_prenom} ?`), h('div', { class: 'small text-muted' }, 'Votre avis aide les autres voyageurs.')));
  head.firstChild.style.cssText = 'width:56px;height:56px;border-radius:50%;object-fit:cover';

  // ---------- étoiles ----------
  const rating = h('div', { class: 'mb-4' });
  if (f.avis) {
    rating.append(h('div', { class: 'fw-bold mb-1' }, 'Votre note'), stars(f.avis.note, 26), f.avis.commentaire ? h('p', { class: 'mt-2 mb-0 fst-italic' }, `« ${f.avis.commentaire} »`) : null, h('p', { class: 'small text-success mb-0 mt-1' }, 'Merci pour votre avis !'));
  } else {
    let value = 0;
    const msg = h('div', {});
    const buttons = [1, 2, 3, 4, 5].map((i) => h('button', { type: 'button', 'aria-label': `${i} étoile${i > 1 ? 's' : ''}`, 'aria-pressed': 'false', onclick: () => { value = i; paint(); } }, icon('star', 34)));
    const paint = () => buttons.forEach((b, k) => { b.classList.toggle('on', k < value); b.setAttribute('aria-pressed', String(k + 1 === value)); });
    const comment = h('textarea', { class: 'form-control', id: 'avis-com', rows: 2, maxlength: 300, placeholder: 'Un mot sur la conduite, l’accueil, la ponctualité… (facultatif)' });
    const send = h('button', { class: 'btn btn-vy', type: 'button' }, 'Envoyer mon avis');
    send.addEventListener('click', async () => {
      clear(msg);
      if (!value) { msg.append(alertBox('Choisissez une note de 1 à 5 étoiles.', 'warning')); return; }
      send.disabled = true;
      try { await api.post(`/api/reservations/${n}/avis`, { note: value, commentaire: comment.value }); toast('Merci pour votre avis !', 'success'); await reload(); }
      catch (e) { send.disabled = false; msg.append(alertBox(e.message)); }
    });
    rating.append(h('div', { class: 'fw-bold mb-1' }, 'Notez votre chauffeur'), h('div', { class: 'star-input', role: 'group', 'aria-label': 'Note de 1 à 5 étoiles' }, buttons),
      h('label', { class: 'visually-hidden', for: 'avis-com' }, 'Commentaire'), comment, h('div', { class: 'mt-2' }, send), msg);
  }
  box.append(head, rating);

  // ---------- pourboire ----------
  if (f.pourboire_disponible) {
    const mode = state.config.paiement.mode;
    let amount = f.montants[1] || f.montants[0];
    const custom = h('input', { class: 'form-control', id: 'tip-custom', type: 'number', min: f.min, max: f.max, step: 50, placeholder: 'Autre montant (FCFA)', 'aria-label': 'Autre montant en FCFA' });
    const pills = f.montants.map((m) => h('button', { type: 'button', class: 'btn btn-vy-outline', onclick: () => { amount = m; custom.value = ''; paintAmounts(); } }, fmtFCFA(m)));
    const paintAmounts = () => pills.forEach((b, i) => b.classList.toggle('active', f.montants[i] === amount && !custom.value));
    custom.addEventListener('input', () => { amount = Number(custom.value) || 0; paintAmounts(); });
    paintAmounts();
    const msg = h('div', { class: 'mt-2' });
    const pay = h('button', { class: 'btn btn-vy', type: 'submit' }, `Donner un pourboire à ${r.chauffeur_prenom}`);
    const ops = state.config.paiement.operateurs || [];
    const tel = h('input', { class: 'form-control', id: 'tip-tel', type: 'tel', inputmode: 'tel', placeholder: '+229 01 00 00 00 00', value: state.user.telephone || '' });
    const form = h('form', { novalidate: true, onsubmit: async (e) => {
      e.preventDefault(); clear(msg);
      if (!Number.isInteger(amount) || amount < f.min || amount > f.max) { msg.append(alertBox(`Le pourboire doit être compris entre ${fmtFCFA(f.min)} et ${fmtFCFA(f.max)}.`, 'warning')); return; }
      pay.disabled = true;
      try {
        if (mode === 'simulation') {
          await api.post(`/api/reservations/${n}/pourboire/simuler`, { montant: amount, operateur: form.querySelector('[name=op]:checked').value, telephone: tel.value });
          toast('Merci ! Pourboire envoyé (démonstration).', 'success'); await reload();
        } else { const out = await api.post(`/api/reservations/${n}/pourboire/initier`, { montant: amount }); location.href = out.url; }
      } catch (err) { pay.disabled = false; msg.append(alertBox(err.message)); }
    } },
      h('div', { class: 'tip-amounts mb-2', role: 'group', 'aria-label': 'Montant du pourboire' }, pills), h('div', { class: 'mb-2' }, custom),
      mode === 'simulation' ? h('div', { class: 'mb-2' }, h('div', { class: 'alert alert-info py-2 small' }, 'Mode démonstration : aucun argent n’est débité.'),
        ops.map((o, i) => h('label', { class: 'pay-op me-3' }, h('input', { type: 'radio', name: 'op', value: o, checked: i === 0 }), ` ${o}`)), h('div', { class: 'mt-2' }, h('label', { class: 'form-label', for: 'tip-tel' }, 'Numéro Mobile Money'), tel)) : null,
      pay, msg);
    box.append(h('hr'), h('div', { class: 'fw-bold mb-1' }, `Un petit geste pour ${r.chauffeur_prenom} ? (facultatif)`),
      h('p', { class: 'small text-muted' }, 'Le pourboire est entièrement facultatif et s’ajoute au prix du ticket. Il est payé sur le compte de la compagnie, qui le remet au chauffeur.'),
      f.pourboires_recus_fcfa ? h('p', { class: 'small text-success' }, `Vous avez déjà laissé ${fmtFCFA(f.pourboires_recus_fcfa)}. Merci !`) : null, form);
  }
  return box;
}
