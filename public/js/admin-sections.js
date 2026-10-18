// Sections de gestion de l'administration. Chaque section reçoit un contexte { api, isAdmin, user, go, content, ... } (voir admin.js).
import { qs } from './api.js';
import { h, clear, toast, alertBox, todayStr, photoImg, busPhoto, stars } from './ui.js';
import { icon } from './icons.js';
import { pill, btnA, busy, kpiCard, confirmDialog, openForm, openDrawer, dl, listView, localLoader, remoteLoader, norm, fmtDateTime, fmtDay, fmtMoney, fmtDuree } from './admin-kit.js';
import { EVENT_LABEL, feedList } from './admin-activity.js';

export function makeSections(ctx) {
  const { api, isAdmin, content, go } = ctx;
  const trip = (r) => `${r.ville_depart} – ${r.ville_arrivee}`;
  const mono = (t) => h('span', { class: 'num', text: t });
  const sub = (a, b) => h('div', {}, a, h('span', { class: 'sub' }, b ?? ''));
  const act = async (fn) => { try { return await fn(); } catch (e) { if (e.status === 401) { location.replace(`/connexion.html?suite=${encodeURIComponent('/admin')}`); return null; } toast(e.message, 'error'); return null; } };
  const section = (...nodes) => { clear(content).append(...nodes); };
  const actions = (...nodes) => h('div', { class: 'page-actions' }, h('div', { class: 'grow' }), ...nodes);
  const companyOptions = async () => (await ctx.companies()).map((c) => [c.id_compagnie, c.nom]);
  const companyFilter = () => (isAdmin ? [{ k: 'id_compagnie', label: 'Compagnie', type: 'select', options: [['', 'Toutes'], ...ctx.companyList.map((c) => [c.id_compagnie, c.nom])] }] : []);
  const forCompany = (extra) => (isAdmin ? [{ k: 'id_compagnie', l: 'Compagnie', t: 'select', req: true, options: companyOptions, placeholder: 'Choisir…' }, ...extra] : extra);
  const occupancy = (occ, total) => {
    const pct = total ? Math.round((occ / total) * 100) : 0;
    const bar = h('span', { class: pct >= 100 ? 'full' : pct >= 85 ? 'high' : '' }); bar.style.width = `${pct}%`;
    return h('div', { class: 'num' }, `${occ}/${total}`, h('div', { class: 'meter' }, bar));
  };
  const mapsLink = (t) => (t.lieu_embarquement ? h('span', {}, t.lieu_embarquement, ' ', t.lien_maps ? h('a', { href: t.lien_maps, target: '_blank', rel: 'noopener noreferrer' }, 'Voir sur Maps') : null) : '—');

  // ============================================================ VOYAGES
  const horaireFields = () => [
    { k: 'id_trajet', l: 'Trajet', t: 'select', req: true, placeholder: 'Choisir…', options: async () => (await api.get('/api/admin/trajets')).trajets.map((t) => [t.id_trajet, `${trip(t)} (${t.compagnie_nom})`, t.id_compagnie]) },
    { k: 'id_bus', l: 'Bus', t: 'select', req: true, placeholder: 'Choisir…', options: async () => (await api.get('/api/admin/bus')).bus.map((b) => [b.id_bus, `${b.immatriculation} · ${b.nombre_places} places (${b.compagnie_nom})`, b.id_compagnie]) },
    { k: 'date_depart', l: 'Date de départ', t: 'date', req: true }, { k: 'heure_depart', l: 'Heure de départ', t: 'time', req: true },
    { k: 'heure_arrivee', l: "Heure d'arrivée estimée", t: 'time', hint: "Facultative : si vous ne la donnez pas, elle est calculée avec la durée du trajet. Sert à vérifier que le bus n'est pas déjà pris par un autre voyage." },
    { k: 'tarif_fcfa', l: 'Tarif par place (FCFA)', t: 'number', req: true, min: 100 },
    { k: 'id_chauffeur', l: 'Chauffeur', t: 'select', options: async () => [['', '— aucun —'], ...(await api.get('/api/admin/chauffeurs')).chauffeurs.map((c) => [c.id_chauffeur, c.prenom, c.id_compagnie])], hint: 'Son prénom et sa photo sont montrés aux voyageurs, qui pourront le noter après le voyage. Ajoutez vos chauffeurs dans « Chauffeurs ».' },
    { k: 'photo_bus', l: 'Photo du bus pour ce voyage', t: 'image', hint: 'Facultatif. Sans photo ici, la photo enregistrée sur le bus est utilisée.' },
  ];
  async function voyageDrawer(id) {
    const d = openDrawer('Voyage');
    try {
      const r = await api.get(`/api/admin/horaires/${id}`);
      const x = r.horaire, taken = new Map(r.places_occupees.map((p) => [p.numero_place, p.statut]));
      d.setTitle(trip(x));
      const seats = Array.from({ length: x.nombre_places }, (_, i) => i + 1).map((n) => h('div', { class: `seat${taken.get(n) === 'confirmee' ? ' taken' : taken.has(n) ? ' pending' : ''}`, title: taken.has(n) ? `Place ${n} : ${taken.get(n) === 'confirmee' ? 'réservée' : 'en attente de paiement'}` : `Place ${n} : libre` }, String(n)));
      const bar = h('span', { class: r.taux_remplissage >= 100 ? 'full' : r.taux_remplissage >= 85 ? 'high' : '' }); bar.style.width = `${r.taux_remplissage}%`;
      d.fill(
        h('div', { class: 'd-flex gap-2 flex-wrap mb-3' }, pill(x.statut), x.compagnie_statut === 'inactive' ? pill('inactive') : null),
        h('div', { class: 'mb-3' }, busPhoto(x.photo_bus || x.bus_photo, `Bus ${x.immatriculation}`)),
        dl([['Chauffeur', x.chauffeur_prenom ? `${x.chauffeur_prenom}${x.chauffeur_nb_avis ? ` · ${String(x.chauffeur_note).replace('.', ',')}/5 (${x.chauffeur_nb_avis} avis)` : ''}` : 'Non renseigné'], ['Départ', `${fmtDay(x.date_depart)} à ${x.heure_depart}`], ['Arrivée estimée', x.heure_arrivee || '—'], ['Durée du trajet', fmtDuree(x.duree_estimee)], ['Compagnie', x.compagnie_nom], ['Bus', `${x.immatriculation} (${x.nombre_places} places)`], ['Tarif', fmtMoney(x.tarif_fcfa)], ['Embarquement', mapsLink(x)], ['Encaissé sur ce voyage', fmtMoney(r.encaisse_fcfa)]]),
        h('div', { class: 'sec-t' }, `Remplissage : ${x.places_occupees}/${x.nombre_places} places (${r.taux_remplissage} %)`), h('div', { class: 'meter mb-3' }, bar),
        h('div', { class: 'seat-legend' }, h('span', {}, h('i'), 'Libre'), h('span', {}, h('i', { class: 't' }), 'Réservée'), h('span', {}, h('i', { class: 'p' }), 'En attente de paiement')),
        h('div', { class: 'seatmap' }, seats),
        h('div', { class: 'sec-t' }, `Passagers (${r.passagers.length})`),
        r.passagers.length ? h('div', { class: 'tbl-card' }, h('div', { class: 'tbl-scroll' }, h('table', { class: 'tbl' }, h('thead', {}, h('tr', {}, ['Place', 'Passager', 'Téléphone', 'Ticket', 'Statut'].map((t) => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, r.passagers.map((p) => h('tr', { class: 'click', onclick: () => reservationDrawer(p.id_reservation) }, h('td', {}, String(p.numero_place)), h('td', {}, `${p.prenom_passager} ${p.nom_passager}`), h('td', { class: 'nowrap' }, p.telephone_passager), h('td', { class: 'nowrap' }, mono(p.numero_ticket)), h('td', {}, pill(p.statut)))))))) : h('div', { class: 'chart-empty' }, 'Aucun passager pour le moment.'));
    } catch (e) { d.error(e); }
  }
  async function voyages(p = {}) {
    const edit = (r) => openForm({ title: 'Modifier le voyage', fields: [...horaireFields(), { k: 'statut', l: 'Statut', t: 'select', options: [['programme', 'Programmé'], ['termine', 'Terminé']] }], values: r,
      onSubmit: async (d) => { const out = await api.put(`/api/admin/horaires/${r.id_horaire}`, d); toast('Voyage modifié.', 'success'); view.reload(); return out; } });
    const add = () => openForm({ title: 'Nouveau voyage', fields: horaireFields(), onSubmit: async (d) => { await api.post('/api/admin/horaires', d); toast('Voyage créé.', 'success'); view.reload(); } });
    const cancel = (r) => act(async () => {
      const msg = r.places_occupees ? `Ce voyage compte ${r.places_occupees} réservation(s) active(s). Elles seront toutes annulées. Les paiements déjà confirmés devront être remboursés (ils apparaîtront dans « Paiements »). Cette action est définitive.` : 'Ce voyage ne compte aucune réservation. Il sera marqué comme annulé et n\'apparaîtra plus dans les recherches.';
      if (!(await confirmDialog({ title: `Annuler le voyage ${trip(r)} ?`, message: msg, confirmLabel: 'Annuler le voyage', danger: true }))) return;
      const out = await api.put(`/api/admin/horaires/${r.id_horaire}`, { id_trajet: r.id_trajet, id_bus: r.id_bus, date_depart: r.date_depart, heure_depart: r.heure_depart, heure_arrivee: r.heure_arrivee || '', tarif_fcfa: r.tarif_fcfa, statut: 'annule' });
      toast(`Voyage annulé. ${out.reservations_annulees} réservation(s) annulée(s)${out.remboursements_a_traiter ? `, ${out.remboursements_a_traiter} remboursement(s) à traiter` : ''}.`, 'success'); view.reload();
    });
    const remove = (r) => act(async () => {
      if (!(await confirmDialog({ title: 'Supprimer ce voyage ?', message: `${trip(r)} du ${fmtDay(r.date_depart)} à ${r.heure_depart}. Suppression impossible s'il existe des réservations (annulez-le dans ce cas).`, confirmLabel: 'Supprimer', danger: true }))) return;
      await api.del(`/api/admin/horaires/${r.id_horaire}`); toast('Voyage supprimé.', 'success'); view.reload();
    });
    const view = listView({
      initial: { date_min: p.date_min || todayStr(), statut: p.statut, q: p.q },
      filters: [{ k: 'q', label: 'Recherche', type: 'search', placeholder: 'Ville, bus, compagnie' }, { k: 'statut', label: 'Statut', type: 'select', options: [['', 'Tous'], ['programme', 'Programmés'], ['termine', 'Terminés'], ['annule', 'Annulés']] },
        { k: 'date_min', label: 'À partir du', type: 'date' }, { k: 'date_max', label: "Jusqu'au", type: 'date' }, ...companyFilter()],
      load: remoteLoader(api, '/api/admin/horaires', 'horaires'), exportPath: '/api/admin/export/voyages.csv', onRow: (r) => voyageDrawer(r.id_horaire),
      emptyTitle: 'Aucun voyage trouvé', emptyText: 'Élargissez la période ou créez un nouveau voyage.',
      columns: [{ l: 'Départ', f: (r) => sub(fmtDay(r.date_depart), r.heure_depart), cls: 'nowrap' }, { l: 'Trajet', f: (r) => sub(trip(r), r.compagnie_nom) }, { l: 'Bus', f: (r) => r.immatriculation }, { l: 'Places', f: (r) => occupancy(r.places_occupees, r.nombre_places) }, { l: 'Tarif', f: (r) => fmtMoney(r.tarif_fcfa), cls: 'nowrap' }, { l: 'Statut', f: (r) => pill(r.statut) }],
      actions: (r) => [r.statut === 'annule' ? null : btnA('Modifier', { ic: 'edit', onclick: () => edit(r) }), r.statut === 'programme' ? btnA('Annuler', { ic: 'ban', danger: true, onclick: () => cancel(r) }) : null, btnA('', { ic: 'trash', danger: true, title: 'Supprimer', onclick: () => remove(r) })],
    });
    section(actions(h('button', { class: 'btn btn-vy btn-ic', type: 'button', onclick: add }, icon('plus', 16), 'Nouveau voyage')), view.el);
    if (p.add) add();
  }

  // ============================================================ RÉSERVATIONS
  async function reservationDrawer(id, onChange) {
    const d = openDrawer('Réservation');
    try {
      const r = await api.get(`/api/admin/reservations/${id}`);
      const x = r.reservation;
      d.setTitle(`Ticket ${x.numero_ticket}`);
      const cancel = btnA('Annuler la réservation', { ic: 'ban', danger: true, onclick: (e, b) => busy(b, () => act(async () => {
        const paid = r.paiements.some((p) => p.statut === 'reussi' && !p.simule);
        if (!(await confirmDialog({ title: `Annuler le ticket ${x.numero_ticket} ?`, message: paid ? 'Un paiement réel a été reçu : le remboursement devra être traité dans « Paiements ». La place sera libérée.' : 'La place sera libérée. Cette action est définitive.', confirmLabel: 'Annuler la réservation', danger: true }))) return;
        const out = await api.post(`/api/admin/reservations/${x.id_reservation}/annuler`);
        toast(out.remboursement_a_traiter ? 'Annulée. Un remboursement est à traiter.' : 'Réservation annulée.', 'success'); d.close(); (onChange || (() => go('reservations')))();
      })) });
      d.fill(
        h('div', { class: 'd-flex gap-2 flex-wrap mb-3' }, pill(x.statut), x.statut_horaire === 'annule' ? pill('annule') : null),
        h('div', { class: 'sec-t mt-0' }, 'Passager'), dl([['Nom', `${x.prenom_passager} ${x.nom_passager}`], ['Téléphone', x.telephone_passager], ["Pièce d'identité", x.piece_identite], ['Compte client', `${x.utilisateur_nom} (${x.utilisateur_email})`]]),
        h('div', { class: 'sec-t' }, 'Voyage'), dl([['Trajet', trip(x)], ['Compagnie', x.compagnie_nom], ['Départ', `${fmtDay(x.date_depart)} à ${x.heure_depart}`], ['Embarquement', mapsLink(x)], ['Place', String(x.numero_place)], ['Montant', fmtMoney(x.tarif_fcfa)], ['Réservée le', fmtDateTime(x.date_reservation)], x.statut === 'annulee' ? ['Annulée le', fmtDateTime(r.date_annulation)] : null]),
        h('div', { class: 'sec-t' }, 'Paiements'),
        r.paiements.length ? h('ul', { class: 'feed' }, r.paiements.map((p) => h('li', {}, h('span', { class: `pip ${p.etat === 'confirme' ? 'ok' : ['echoue', 'a_rembourser'].includes(p.etat) ? 'bad' : 'warn'}` }), h('div', {}, h('div', { class: 't' }, fmtMoney(p.montant_fcfa), ' ', pill(p.etat)), h('div', { class: 'm' }, `${p.mode} · réf. ${p.reference_transaction || '—'} · ${fmtDateTime(p.date_paiement)}`))))) : h('div', { class: 'chart-empty' }, 'Aucun paiement enregistré pour cette réservation.'),
        h('div', { class: 'sec-t' }, 'Historique'), r.historique.length ? feedList(r.historique) : h('div', { class: 'chart-empty' }, "Aucun événement enregistré (réservation antérieure au journal)."),
        x.statut !== 'annulee' ? h('div', { class: 'mt d-flex gap-2' }, cancel) : null);
    } catch (e) { d.error(e); }
  }
  async function reservations(p = {}) {
    const view = listView({
      initial: { id_horaire: p.id_horaire, statut: p.statut, q: p.q, date_min: p.date_min, date_max: p.date_max },
      filters: [{ k: 'q', label: 'Recherche', type: 'search', placeholder: 'Ticket, nom ou téléphone' }, { k: 'statut', label: 'Statut', type: 'select', options: [['', 'Tous'], ['confirmee', 'Confirmées'], ['en_attente', 'En attente'], ['annulee', 'Annulées']] },
        { k: 'date_min', label: 'Voyage à partir du', type: 'date' }, { k: 'date_max', label: "Voyage jusqu'au", type: 'date' }, { k: 'depart', label: 'Départ', type: 'text', placeholder: 'Ville', datalist: 'villes-dl' }, { k: 'arrivee', label: 'Arrivée', type: 'text', placeholder: 'Ville', datalist: 'villes-dl' }, ...companyFilter()],
      load: remoteLoader(api, '/api/admin/reservations', 'reservations'), exportPath: '/api/admin/export/reservations.csv', onRow: (r) => reservationDrawer(r.id_reservation, () => view.reload()),
      emptyTitle: 'Aucune réservation trouvée', emptyText: 'Essayez un autre numéro de ticket, un autre nom ou une période plus large.',
      columns: [{ l: 'Ticket', f: (r) => sub(mono(r.numero_ticket), fmtDateTime(r.date_reservation)), cls: 'nowrap' }, { l: 'Passager', f: (r) => sub(`${r.prenom_passager} ${r.nom_passager}`, r.telephone_passager) }, { l: 'Voyage', f: (r) => sub(trip(r), `${fmtDay(r.date_depart)} ${r.heure_depart} · ${r.compagnie_nom}`) },
        { l: 'Place', f: (r) => String(r.numero_place) }, { l: 'Montant', f: (r) => fmtMoney(r.tarif_fcfa), cls: 'nowrap' }, { l: 'Statut', f: (r) => pill(r.statut) }],
      actions: (r) => (r.statut === 'annulee' ? null : [btnA('Annuler', { ic: 'ban', danger: true, onclick: (e, b) => busy(b, () => act(async () => {
        if (!(await confirmDialog({ title: `Annuler le ticket ${r.numero_ticket} ?`, message: "La place sera libérée. Si un paiement réel a été reçu, le remboursement apparaîtra dans « Paiements ». Cette action est définitive.", confirmLabel: 'Annuler la réservation', danger: true }))) return;
        const out = await api.post(`/api/admin/reservations/${r.id_reservation}/annuler`);
        toast(out.remboursement_a_traiter ? 'Annulée. Un remboursement est à traiter.' : 'Réservation annulée.', 'success'); view.reload();
      })) })]),
    });
    section(p.id_horaire ? h('div', { class: 'note-box mb-3' }, `Filtre actif : passagers du voyage n° ${p.id_horaire}. Utilisez « Réinitialiser » pour tout afficher.`) : null, view.el);
  }

  // ============================================================ PAIEMENTS
  async function paiements() {
    clear(content).append(h('div', { class: 'loading-row' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })));
    const sum = await api.get('/api/admin/paiements?limite=1');
    const t = sum.total;
    const markRefund = (r) => openForm({ title: 'Marquer comme remboursé', submitLabel: 'Confirmer le remboursement', intro: `Confirmez que ${fmtMoney(r.montant_fcfa)} ont bien été remboursés au client (ticket ${r.numero_ticket}). Voyagéo n'envoie pas l'argent : faites d'abord le remboursement chez votre prestataire (ex. FedaPay) ou par Mobile Money, puis confirmez ici.`,
      fields: [{ k: 'note', l: 'Note (facultatif)', t: 'textarea', max: 200, hint: 'Ex. : remboursé par MTN MoMo le 12/10.' }], onSubmit: async (d) => { await api.post(`/api/admin/paiements/${r.id_paiement}/rembourse`, d); toast('Remboursement enregistré.', 'success'); paiements(); } });
    const view = listView({
      filters: [{ k: 'q', label: 'Recherche', type: 'search', placeholder: 'Ticket, référence ou client' }, { k: 'etat', label: 'État', type: 'select', options: [['', 'Tous'], ['confirme', 'Confirmés'], ['en_attente', 'En attente'], ['a_verifier', 'À vérifier'], ['echoue', 'Échoués'], ['a_rembourser', 'À rembourser'], ['rembourse', 'Remboursés'], ['simule', 'Simulés']] },
        { k: 'mode', label: 'Type', type: 'select', options: [['', 'Réels et simulés'], ['reel', 'Réels'], ['simule', 'Simulés']] }, { k: 'date_min', label: 'Du', type: 'date' }, { k: 'date_max', label: 'Au', type: 'date' }, ...companyFilter()],
      load: remoteLoader(api, '/api/admin/paiements', 'paiements'), exportPath: '/api/admin/export/paiements.csv',
      emptyTitle: 'Aucune transaction', emptyText: 'Aucun paiement ne correspond à ces filtres.',
      columns: [{ l: 'Date', f: (r) => fmtDateTime(r.date_paiement), cls: 'nowrap' }, { l: 'Ticket', f: (r) => sub(mono(r.numero_ticket), r.reference_transaction || '—'), cls: 'nowrap' }, { l: 'Trajet', f: (r) => sub(trip(r), r.compagnie_nom) }, { l: 'Client', f: (r) => r.utilisateur_nom },
        { l: 'Mode', f: (r) => sub(String(r.mode).replace(/^simulation/, 'Simulation').replace(/^fedapay$/, 'FedaPay'), r.simule ? 'Aucune vraie transaction' : 'Paiement réel') }, { l: 'Montant', f: (r) => fmtMoney(r.montant_fcfa), cls: 'nowrap' },
        { l: 'État', f: (r) => sub(pill(r.etat), r.motif_remboursement === 'doublon' ? 'Payé en double' : r.motif_remboursement === 'reservation_annulee' ? 'Ticket annulé' : '') }],
      actions: isAdmin ? (r) => (r.etat === 'a_rembourser' ? [btnA('Marquer remboursé', { ic: 'check', onclick: () => markRefund(r) })] : null) : null,
    });
    section(
      h('div', { class: 'grid g-kpi five mb-3' }, kpiCard({ label: 'Encaissé (paiements réels)', value: fmtMoney(t.montant_fcfa), note: `${t.reussis} paiement(s) confirmé(s)`, ic: 'wallet', small: true }), kpiCard({ label: 'Simulés (démonstration)', value: fmtMoney(t.montant_simule_fcfa), note: `${t.simules} paiement(s), non comptés`, small: true }),
        kpiCard({ label: 'En attente', value: String(t.en_attente), note: fmtMoney(t.montant_en_attente_fcfa) }), kpiCard({ label: 'Échoués', value: String(t.echoues) }),
        kpiCard({ label: 'À rembourser', value: String(t.a_rembourser), note: fmtMoney(t.montant_a_rembourser_fcfa), warn: t.a_rembourser > 0 })),
      sum.resume.length > 1 || !isAdmin ? h('div', { class: 'card-a mb-3' }, h('div', { class: 'card-h' }, h('h2', {}, isAdmin ? 'Par compagnie' : 'Votre compagnie'), h('span', { class: 'hint' }, 'Montants réellement encaissés, hors simulation')),
        h('div', { class: 'tbl-scroll' }, h('table', { class: 'tbl stack' }, h('thead', {}, h('tr', {}, ['Compagnie', 'Encaissé', 'Paiements', 'En attente', 'Échoués', 'À rembourser'].map((c) => h('th', { scope: 'col' }, c)))),
          h('tbody', {}, sum.resume.map((r) => h('tr', {}, h('td', { 'data-label': 'Compagnie' }, r.compagnie_nom), h('td', { 'data-label': 'Encaissé', class: 'nowrap' }, h('strong', {}, fmtMoney(r.montant_fcfa))), h('td', { 'data-label': 'Paiements' }, String(r.reussis)), h('td', { 'data-label': 'En attente' }, r.en_attente ? `${r.en_attente} (${fmtMoney(r.montant_en_attente_fcfa)})` : '0'), h('td', { 'data-label': 'Échoués' }, String(r.echoues)), h('td', { 'data-label': 'À rembourser' }, r.a_rembourser ? `${r.a_rembourser} (${fmtMoney(r.montant_a_rembourser_fcfa)})` : '0'))))))) : null,
      h('div', { class: 'note-box mb-3' }, h('strong', {}, 'Comment lire cette page : '), 'Confirmé = argent encaissé (vérifié auprès du prestataire). Simulé = démonstration, aucune vraie transaction. En attente = le prestataire n\'a pas encore confirmé. À vérifier = en attente depuis plus de 30 minutes. À rembourser = argent reçu mais ticket non délivré (ticket annulé, place prise ou paiement en double).'), view.el);
  }

  // ============================================================ COMPAGNIES
  function companyDetail(c, bus, trajets, prochains, gestionnaires) {
    return [
      h('div', { class: 'd-flex gap-2 flex-wrap mb-3' }, pill(c.statut)),
      h('div', { class: 'stat-row' }, kpiCard({ label: 'Bus', value: String(c.nb_bus) }), kpiCard({ label: 'Trajets', value: String(c.nb_trajets) }), kpiCard({ label: 'Voyages à venir', value: String(c.voyages_a_venir) }), kpiCard({ label: 'Places réservées', value: String(c.reservations_actives) }), kpiCard({ label: 'Voyages (total)', value: String(c.voyages_total) }), kpiCard({ label: 'Encaissé', value: fmtMoney(c.recettes_fcfa), small: true })),
      h('div', { class: 'sec-t' }, 'Coordonnées'), dl([['Téléphone', c.telephone], ['E-mail', c.email], ['Adresse', c.adresse]]),
      c.abonnement ? [h('div', { class: 'sec-t' }, 'Abonnement et encaissement'), dl([['Abonnement', h('span', {}, pill(c.abonnement.etat), c.abonnement.expire_le ? ` jusqu'au ${fmtDay(c.abonnement.expire_le)}` : '')], ['Clés FedaPay de la compagnie', c.paiement_configure ? 'Enregistrées' : (c.abonnement.requis ? 'Non enregistrées : voyages non proposés' : 'Non requises : compte de la plateforme')]]),
        c.abonnement.historique?.length ? h('ul', { class: 'feed mt' }, c.abonnement.historique.map((p) => h('li', {}, h('span', { class: `pip ${p.statut === 'reussi' ? 'ok' : p.statut === 'echoue' ? 'bad' : 'warn'}` }), h('div', {}, h('div', { class: 't' }, fmtMoney(p.montant_fcfa), ' ', pill(p.statut)), h('div', { class: 'm' }, `${p.mode} · ${fmtDateTime(p.date_paiement)}${p.expire_le ? ` · valable jusqu'au ${fmtDay(p.expire_le)}` : ''}`))))) : null] : null,
      gestionnaires.length ? [h('div', { class: 'sec-t' }, 'Gestionnaires'), h('ul', { class: 'feed' }, gestionnaires.map((g) => h('li', {}, h('span', { class: 'pip' }), h('div', {}, h('div', { class: 't' }, `${g.prenom} ${g.nom}`, ' ', pill(g.statut)), h('div', { class: 'm' }, g.email)))))] : null,
      h('div', { class: 'sec-t' }, `Bus (${bus.length})`), bus.length ? h('ul', { class: 'feed' }, bus.map((b) => h('li', {}, h('span', { class: 'pip' }), h('div', {}, h('div', { class: 't' }, b.immatriculation), h('div', { class: 'm' }, `${b.nombre_places} places${b.type ? ` · ${b.type}` : ''}`))))) : h('div', { class: 'chart-empty' }, 'Aucun bus enregistré.'),
      h('div', { class: 'sec-t' }, `Trajets (${trajets.length})`), trajets.length ? h('ul', { class: 'feed' }, trajets.map((t) => h('li', {}, h('span', { class: 'pip' }), h('div', {}, h('div', { class: 't' }, trip(t)), h('div', { class: 'm' }, `${fmtDuree(t.duree_estimee)}${t.lieu_embarquement ? ` · ${t.lieu_embarquement}` : ''}`))))) : h('div', { class: 'chart-empty' }, 'Aucun trajet enregistré.'),
      h('div', { class: 'sec-t' }, 'Prochains voyages'), prochains.length ? h('ul', { class: 'feed' }, prochains.map((v) => h('li', {}, h('span', { class: 'pip' }), h('div', {}, h('div', { class: 't' }, `${trip(v)} · ${fmtDay(v.date_depart)} ${v.heure_depart}`), h('div', { class: 'm' }, `${v.places_occupees}/${v.nombre_places} places · ${fmtMoney(v.tarif_fcfa)}`))))) : h('div', { class: 'chart-empty' }, 'Aucun voyage programmé.')];
  }
  async function companyDrawer(id) {
    const d = openDrawer('Compagnie');
    try { const r = await api.get(`/api/admin/compagnies/${id}`); d.setTitle(r.compagnie.nom); d.fill(...companyDetail(r.compagnie, r.bus, r.trajets, r.prochains_voyages, r.gestionnaires)); } catch (e) { d.error(e); }
  }
  async function maCompagnie() {
    clear(content).append(h('div', { class: 'loading-row' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })));
    const c = (await api.get('/api/admin/compagnies')).compagnies[0];
    const r = await api.get(`/api/admin/compagnies/${c.id_compagnie}`);
    section(h('div', { class: 'card-a' }, h('div', { class: 'card-h' }, h('h2', {}, r.compagnie.nom), h('span', { class: 'hint' }, 'Lecture seule : contactez l\'administrateur pour modifier ces informations.')), ...companyDetail(r.compagnie, r.bus, r.trajets, r.prochains_voyages, r.gestionnaires)));
  }
  const abonnementForm = (r) => openForm({
    title: `Abonnement de ${r.nom}`, submitLabel: 'Appliquer', values: { action: 'activer', jours: 30 },
    intro: `Abonnement actuel : ${r.abonnement.etat.replace('_', ' ')}${r.abonnement.expire_le ? ` (jusqu'au ${r.abonnement.expire_le})` : ''}. « Activer » sert, par exemple, quand l'agence a payé en espèces : la période s'ajoute à celle en cours.`,
    fields: [{ k: 'action', l: 'Action', t: 'select', options: [['activer', 'Activer / prolonger'], ['suspendre', 'Suspendre (espace et voyages bloqués)'], ['dispenser', 'Dispenser d\'abonnement (compagnie partenaire)']] }, { k: 'jours', l: 'Durée en jours (pour « Activer »)', t: 'number', min: 1, max: 3650 }, { k: 'note', l: 'Note (facultatif)', t: 'textarea', max: 200 }],
    onSubmit: async (d) => { await api.post(`/api/admin/compagnies/${r.id_compagnie}/abonnement`, d); toast('Abonnement mis à jour.', 'success'); await ctx.refreshCompanies(); compView.reload(); },
  });
  let compView = null;
  async function compagnies() {
    const form = (r = {}) => [{ k: 'nom', l: 'Nom', req: true }, { k: 'telephone', l: 'Téléphone', t: 'tel' }, { k: 'email', l: 'E-mail', t: 'email' }, { k: 'adresse', l: 'Adresse' }, { k: 'statut', l: 'Statut', t: 'select', options: [['active', 'Active : vend des tickets'], ['inactive', 'Désactivée : ses voyages ne sont plus proposés']] }];
    const body = (r, over = {}) => ({ nom: r.nom, telephone: r.telephone || '', email: r.email || '', adresse: r.adresse || '', statut: r.statut, ...over });
    const toggle = (r) => act(async () => {
      const off = r.statut === 'active';
      if (off && !(await confirmDialog({ title: `Désactiver ${r.nom} ?`, message: 'Ses voyages ne seront plus proposés aux voyageurs et plus aucune réservation ne sera possible. Les réservations existantes restent valables.', confirmLabel: 'Désactiver', danger: true }))) return;
      await api.put(`/api/admin/compagnies/${r.id_compagnie}`, body(r, { statut: off ? 'inactive' : 'active' })); toast(off ? 'Compagnie désactivée.' : 'Compagnie réactivée.', 'success'); await ctx.refreshCompanies(); view.reload();
    });
    const remove = (r) => act(async () => {
      if (!(await confirmDialog({ title: `Supprimer ${r.nom} ?`, message: 'Suppression impossible si la compagnie a des bus, des trajets ou des gestionnaires : désactivez-la plutôt.', confirmLabel: 'Supprimer', danger: true }))) return;
      await api.del(`/api/admin/compagnies/${r.id_compagnie}`); toast('Compagnie supprimée.', 'success'); await ctx.refreshCompanies(); view.reload();
    });
    const view = listView({
      filters: [{ k: 'q', label: 'Recherche', type: 'search', placeholder: 'Nom, e-mail, téléphone' }, { k: 'statut', label: 'Statut', type: 'select', options: [['', 'Toutes'], ['active', 'Actives'], ['inactive', 'Désactivées']] }],
      load: localLoader(async () => (await api.get('/api/admin/compagnies')).compagnies, (r, p) => (!p.statut || r.statut === p.statut) && (!p.q || norm(`${r.nom} ${r.email} ${r.telephone}`).includes(norm(p.q)))),
      onRow: (r) => companyDrawer(r.id_compagnie), emptyTitle: 'Aucune compagnie', emptyText: 'Créez la première compagnie pour commencer.',
      columns: [{ l: 'Compagnie', f: (r) => sub(r.nom, r.email || r.telephone || '') }, { l: 'Bus', f: (r) => String(r.nb_bus) }, { l: 'Trajets', f: (r) => String(r.nb_trajets) }, { l: 'Voyages à venir', f: (r) => String(r.voyages_a_venir) }, { l: 'Encaissé', f: (r) => fmtMoney(r.recettes_fcfa), cls: 'nowrap' }, { l: 'Abonnement', f: (r) => sub(pill(r.abonnement.etat), r.abonnement.expire_le ? `jusqu'au ${r.abonnement.expire_le.split('-').reverse().join('/')}` : (r.abonnement.requis && !r.paiement_configure ? 'Clés FedaPay manquantes' : '')) }, { l: 'Statut', f: (r) => pill(r.statut) }],
      actions: (r) => [btnA('Abonnement', { ic: 'wallet', onclick: () => abonnementForm(r) }), btnA('Modifier', { ic: 'edit', onclick: () => openForm({ title: `Modifier ${r.nom}`, fields: form(), values: r, onSubmit: async (d) => { await api.put(`/api/admin/compagnies/${r.id_compagnie}`, d); toast('Compagnie modifiée.', 'success'); await ctx.refreshCompanies(); view.reload(); } })}),
        btnA(r.statut === 'active' ? 'Désactiver' : 'Réactiver', { ic: r.statut === 'active' ? 'ban' : 'check', danger: r.statut === 'active', onclick: () => toggle(r) }), btnA('', { ic: 'trash', danger: true, title: 'Supprimer', onclick: () => remove(r) })],
    });
    compView = view;
    section(actions(h('button', { class: 'btn btn-vy btn-ic', type: 'button', onclick: () => openForm({ title: 'Nouvelle compagnie', fields: form(), values: { statut: 'active' }, onSubmit: async (d) => { await api.post('/api/admin/compagnies', d); toast('Compagnie créée.', 'success'); await ctx.refreshCompanies(); view.reload(); } }) }, icon('plus', 16), 'Nouvelle compagnie')), view.el);
  }

  // ============================================================ BUS
  async function busDrawer(id) {
    const d = openDrawer('Bus');
    try {
      const r = await api.get(`/api/admin/bus/${id}`);
      const row = (v) => h('li', {}, h('span', { class: 'pip' }), h('div', {}, h('div', { class: 't' }, `${trip(v)} · ${fmtDay(v.date_depart)} ${v.heure_depart}`), h('div', { class: 'm' }, `${v.places_occupees}/${v.nombre_places} places · ${v.statut === 'annule' ? 'annulé' : v.statut === 'termine' ? 'terminé' : 'programmé'}`)));
      d.setTitle(r.bus.immatriculation);
      d.fill(h('div', { class: 'mb-3' }, busPhoto(r.bus.photo, `Bus ${r.bus.immatriculation}`)), dl([['Compagnie', r.bus.compagnie_nom], ['Capacité', `${r.bus.nombre_places} places`], ['Type', r.bus.type], ['Voyages affectés (total)', String(r.total_voyages)]]),
        h('div', { class: 'sec-t' }, 'Prochaines affectations'), r.prochains.length ? h('ul', { class: 'feed' }, r.prochains.map(row)) : h('div', { class: 'chart-empty' }, 'Aucune affectation à venir.'),
        h('div', { class: 'sec-t' }, 'Historique récent'), r.historique.length ? h('ul', { class: 'feed' }, r.historique.map(row)) : h('div', { class: 'chart-empty' }, 'Aucun voyage passé.'));
    } catch (e) { d.error(e); }
  }
  async function bus() {
    const fields = () => forCompany([{ k: 'immatriculation', l: 'Immatriculation', req: true, hint: 'Unique : deux bus ne peuvent pas avoir la même plaque.' }, { k: 'nombre_places', l: 'Nombre de places (1 à 80)', t: 'number', req: true, min: 1, max: 80 }, { k: 'type', l: 'Type', t: 'select', options: [['Standard', 'Standard'], ['Climatisé', 'Climatisé'], ['Minibus', 'Minibus']] },
      { k: 'photo', l: 'Photo du bus', t: 'image', hint: 'Montrée aux voyageurs avec le voyage. Une photo de profil du bus, bien éclairée (JPEG, PNG ou WebP).' }]);
    const remove = (r) => act(async () => { if (!(await confirmDialog({ title: `Supprimer le bus ${r.immatriculation} ?`, message: 'Suppression impossible si le bus est affecté à un voyage.', confirmLabel: 'Supprimer', danger: true }))) return; await api.del(`/api/admin/bus/${r.id_bus}`); toast('Bus supprimé.', 'success'); view.reload(); });
    const view = listView({
      filters: [{ k: 'q', label: 'Recherche', type: 'search', placeholder: 'Immatriculation ou type' }, ...companyFilter()],
      load: localLoader(async () => (await api.get('/api/admin/bus')).bus, (r, p) => (!p.id_compagnie || String(r.id_compagnie) === String(p.id_compagnie)) && (!p.q || norm(`${r.immatriculation} ${r.type}`).includes(norm(p.q)))),
      onRow: (r) => busDrawer(r.id_bus), emptyTitle: 'Aucun bus', emptyText: 'Ajoutez un bus pour pouvoir programmer des voyages.',
      columns: [{ l: 'Immatriculation', f: (r) => h('div', { class: 'driver' }, photoImg(r.photo, '/img/bus-defaut.svg', `Bus ${r.immatriculation}`), h('strong', {}, r.immatriculation)) }, { l: 'Compagnie', f: (r) => r.compagnie_nom }, { l: 'Capacité', f: (r) => `${r.nombre_places} places` }, { l: 'Type', f: (r) => r.type || '—' }],
      actions: (r) => [btnA('Modifier', { ic: 'edit', onclick: () => openForm({ title: 'Modifier le bus', fields: fields(), values: r, onSubmit: async (d) => { await api.put(`/api/admin/bus/${r.id_bus}`, d); toast('Bus modifié.', 'success'); view.reload(); } }) }), btnA('', { ic: 'trash', danger: true, title: 'Supprimer', onclick: () => remove(r) })],
    });
    section(actions(h('button', { class: 'btn btn-vy btn-ic', type: 'button', onclick: () => openForm({ title: 'Nouveau bus', fields: fields(), onSubmit: async (d) => { await api.post('/api/admin/bus', d); toast('Bus ajouté.', 'success'); view.reload(); } }) }, icon('plus', 16), 'Nouveau bus')), view.el);
  }

  // ============================================================ CHAUFFEURS
  async function chauffeurDrawer(id) {
    const d = openDrawer('Chauffeur');
    try {
      const r = await api.get(`/api/admin/chauffeurs/${id}`), c = r.chauffeur;
      d.setTitle(c.prenom);
      d.fill(h('div', { class: 'mb-3' }, h('div', { class: 'driver' }, photoImg(c.photo, '/img/chauffeur-defaut.svg', `Photo du chauffeur ${c.prenom}`), h('div', {}, h('div', { class: 'name' }, c.prenom), c.nb_avis ? h('div', {}, stars(c.note), ` ${String(c.note).replace('.', ',')}/5 · ${c.nb_avis} avis`) : h('div', { class: 'small text-muted' }, 'Pas encore noté')))),
        dl([['Compagnie', c.compagnie_nom]]), h('div', { class: 'sec-t' }, 'Derniers avis (anonymes)'),
        r.avis.length ? h('ul', { class: 'feed' }, r.avis.map((a) => h('li', {}, h('span', { class: 'pip' }), h('div', {}, h('div', { class: 't' }, stars(a.note)), a.commentaire ? h('div', {}, `« ${a.commentaire} »`) : null, h('div', { class: 'm' }, fmtDateTime(a.date_avis)))))) : h('div', { class: 'chart-empty' }, 'Aucun avis pour le moment.'));
    } catch (e) { d.error(e); }
  }
  async function chauffeurs() {
    const fields = () => forCompany([{ k: 'prenom', l: 'Prénom du chauffeur', req: true, hint: 'Prénom seulement (sans nom de famille) : c’est ce que voient les voyageurs.' },
      { k: 'photo', l: 'Photo du chauffeur', t: 'image', round: true, hint: 'Avec l’accord du chauffeur. Une photo de visage, de face, bien éclairée.' }]);
    const remove = (r) => act(async () => { if (!(await confirmDialog({ title: `Supprimer ${r.prenom} ?`, message: 'Suppression impossible si ce chauffeur est affecté à un voyage ou a reçu des avis.', confirmLabel: 'Supprimer', danger: true }))) return; await api.del(`/api/admin/chauffeurs/${r.id_chauffeur}`); toast('Chauffeur supprimé.', 'success'); view.reload(); });
    const view = listView({
      filters: [{ k: 'q', label: 'Recherche', type: 'search', placeholder: 'Prénom' }, ...companyFilter()],
      load: localLoader(async () => (await api.get('/api/admin/chauffeurs')).chauffeurs, (r, p) => (!p.id_compagnie || String(r.id_compagnie) === String(p.id_compagnie)) && (!p.q || norm(r.prenom).includes(norm(p.q)))),
      onRow: (r) => chauffeurDrawer(r.id_chauffeur), emptyTitle: 'Aucun chauffeur', emptyText: 'Ajoutez vos chauffeurs (prénom et photo) puis choisissez-en un pour chaque voyage.',
      columns: [{ l: 'Chauffeur', f: (r) => h('div', { class: 'driver' }, photoImg(r.photo, '/img/chauffeur-defaut.svg', `Photo du chauffeur ${r.prenom}`), h('strong', {}, r.prenom)) }, { l: 'Compagnie', f: (r) => r.compagnie_nom },
        { l: 'Note', f: (r) => (r.nb_avis ? h('span', {}, stars(r.note), ` ${String(r.note).replace('.', ',')} (${r.nb_avis})`) : '—'), cls: 'nowrap' }, { l: 'Pourboires reçus', f: (r) => fmtMoney(r.pourboires_fcfa), cls: 'nowrap' }],
      actions: (r) => [btnA('Modifier', { ic: 'edit', onclick: () => openForm({ title: `Modifier ${r.prenom}`, fields: fields().filter((f) => f.k !== 'id_compagnie'), values: r, onSubmit: async (d) => { await api.put(`/api/admin/chauffeurs/${r.id_chauffeur}`, d); toast('Chauffeur modifié.', 'success'); view.reload(); } }) }), btnA('', { ic: 'trash', danger: true, title: 'Supprimer', onclick: () => remove(r) })],
    });
    section(actions(h('button', { class: 'btn btn-vy btn-ic', type: 'button', onclick: () => openForm({ title: 'Nouveau chauffeur', fields: fields(), onSubmit: async (d) => { await api.post('/api/admin/chauffeurs', d); toast('Chauffeur ajouté.', 'success'); view.reload(); } }) }, icon('plus', 16), 'Nouveau chauffeur')), view.el);
  }

  // ============================================================ TRAJETS
  async function trajets() {
    const fields = () => forCompany([{ k: 'ville_depart', l: 'Ville de départ', req: true }, { k: 'ville_arrivee', l: "Ville d'arrivée", req: true }, { k: 'duree_estimee', l: 'Durée estimée (minutes)', t: 'number', req: true, min: 5, max: 1440, hint: "Sert à calculer l'heure d'arrivée des voyages." },
      { k: 'lieu_embarquement', l: "Lieu d'embarquement", hint: 'Ex. : Gare routière de Jonquet, Cotonou. Affiché aux voyageurs et sur le ticket.' },
      { k: 'lien_maps', l: "Lien Google Maps du lieu d'embarquement", t: 'url', hint: 'Dans Google Maps : ouvrez le lieu, touchez « Partager », « Copier le lien », puis collez-le ici. Facultatif.' }]);
    const remove = (r) => act(async () => { if (!(await confirmDialog({ title: `Supprimer le trajet ${trip(r)} ?`, message: 'Suppression impossible si des voyages utilisent ce trajet.', confirmLabel: 'Supprimer', danger: true }))) return; await api.del(`/api/admin/trajets/${r.id_trajet}`); toast('Trajet supprimé.', 'success'); view.reload(); });
    const view = listView({
      filters: [{ k: 'q', label: 'Recherche', type: 'search', placeholder: 'Ville ou lieu' }, ...companyFilter()],
      load: localLoader(async () => (await api.get('/api/admin/trajets')).trajets, (r, p) => (!p.id_compagnie || String(r.id_compagnie) === String(p.id_compagnie)) && (!p.q || norm(`${r.ville_depart} ${r.ville_arrivee} ${r.lieu_embarquement}`).includes(norm(p.q)))),
      emptyTitle: 'Aucun trajet', emptyText: 'Créez un trajet (deux villes) pour programmer des voyages.',
      columns: [{ l: 'Trajet', f: (r) => h('strong', {}, trip(r)) }, { l: 'Compagnie', f: (r) => r.compagnie_nom }, { l: "Lieu d'embarquement", f: mapsLink }, { l: 'Durée estimée', f: (r) => fmtDuree(r.duree_estimee) }],
      actions: (r) => [btnA('Modifier', { ic: 'edit', onclick: () => openForm({ title: 'Modifier le trajet', fields: fields(), values: r, onSubmit: async (d) => { await api.put(`/api/admin/trajets/${r.id_trajet}`, d); toast('Trajet modifié.', 'success'); view.reload(); } }) }), btnA('', { ic: 'trash', danger: true, title: 'Supprimer', onclick: () => remove(r) })],
    });
    section(actions(h('button', { class: 'btn btn-vy btn-ic', type: 'button', onclick: () => openForm({ title: 'Nouveau trajet', fields: fields(), onSubmit: async (d) => { await api.post('/api/admin/trajets', d); toast('Trajet créé.', 'success'); view.reload(); } }) }, icon('plus', 16), 'Nouveau trajet')), view.el);
  }

  // ============================================================ UTILISATEURS
  async function userDrawer(id, reload) {
    const d = openDrawer('Utilisateur');
    try {
      const r = await api.get(`/api/admin/utilisateurs/${id}`), u = r.utilisateur;
      d.setTitle(`${u.prenom} ${u.nom}`);
      d.fill(h('div', { class: 'd-flex gap-2 flex-wrap mb-3' }, pill(u.role), pill(u.statut), r.principal ? h('span', { class: 'pill info' }, 'Compte principal') : null),
        dl([['E-mail', u.email], ['Téléphone', u.telephone], ['Compagnie', r.compagnie_nom], ['Inscrit le', fmtDateTime(u.date_creation)], ['Accord données personnelles', u.consentement_date ? `Accepté le ${fmtDateTime(u.consentement_date)}` : 'Pas encore accepté (demandé à la prochaine connexion)']]),
        h('div', { class: 'sec-t' }, 'Réservations'), h('div', { class: 'stat-row' }, kpiCard({ label: 'Total', value: String(r.reservations.total) }), kpiCard({ label: 'Confirmées', value: String(r.reservations.confirmees) }), kpiCard({ label: 'Annulées', value: String(r.reservations.annulees) })),
        r.reservations.recentes.length ? h('ul', { class: 'feed mt' }, r.reservations.recentes.map((x) => h('li', {}, h('span', { class: 'pip' }), h('div', {}, h('div', { class: 't' }, `${trip(x)} · ${fmtDay(x.date_depart)}`), h('div', { class: 'm' }, `${x.numero_ticket} · `, pill(x.statut)))))) : null,
        h('div', { class: 'sec-t' }, 'Historique du compte'), r.historique.length ? feedList(r.historique) : h('div', { class: 'chart-empty' }, 'Aucune modification enregistrée.'),
        u.role !== 'admin' ? h('div', { class: 'mt' }, btnA('Réinitialiser le mot de passe', { ic: 'key', onclick: (e, b) => resetPassword(u, b) })) : null);
    } catch (e) { d.error(e); }
  }
  const resetPassword = (u, button) => busy(button, () => act(async () => {
    if (!(await confirmDialog({ title: `Réinitialiser le mot de passe de ${u.prenom} ${u.nom} ?`, message: "Un mot de passe temporaire sera généré. L'ancien mot de passe ne fonctionnera plus.", confirmLabel: 'Générer le mot de passe' }))) return;
    const out = await api.post(`/api/admin/utilisateurs/${u.id_utilisateur}/reinitialiser-mot-de-passe`);
    await confirmDialog({ title: 'Mot de passe temporaire', confirmLabel: "J'ai noté le mot de passe", message: h('div', {}, h('div', { class: 'pw-box mb-3' }, out.mot_de_passe_temporaire), h('p', { class: 'small text-muted mb-0' }, "Il n'est affiché qu'une seule fois et n'est enregistré nulle part en clair. Transmettez-le à l'utilisateur par un canal sûr et demandez-lui de le changer dans « Mon compte ». Une session déjà ouverte reste active jusqu'à sa déconnexion.")) });
  }));
  async function utilisateurs() {
    const fields = (creating) => [{ k: 'prenom', l: 'Prénom', req: true }, { k: 'nom', l: 'Nom', req: true }, ...(creating ? [{ k: 'email', l: 'E-mail', t: 'email', req: true }] : []), { k: 'telephone', l: 'Téléphone', t: 'tel' },
      { k: 'role', l: 'Profil', t: 'select', options: [['voyageur', 'Voyageur'], ['gestionnaire', 'Gestionnaire de compagnie'], ['admin', 'Administrateur']] },
      { k: 'id_compagnie', l: 'Compagnie (obligatoire pour un gestionnaire)', t: 'select', options: async () => [['', '— aucune —'], ...(await companyOptions())] },
      ...(creating ? [{ k: 'mot_de_passe', l: 'Mot de passe (8 caractères minimum)', t: 'password', req: true }] : [{ k: 'statut', l: 'Statut', t: 'select', options: [['actif', 'Actif'], ['bloque', 'Suspendu']] }])];
    const toggle = (r) => act(async () => {
      const suspend = r.statut === 'actif';
      if (!(await confirmDialog({ title: `${suspend ? 'Suspendre' : 'Réactiver'} ${r.prenom} ${r.nom} ?`, message: suspend ? 'Cette personne ne pourra plus se connecter ni réserver. Ses réservations existantes ne sont pas modifiées.' : 'Cette personne pourra de nouveau se connecter.', confirmLabel: suspend ? 'Suspendre' : 'Réactiver', danger: suspend }))) return;
      await api.put(`/api/admin/utilisateurs/${r.id_utilisateur}`, { statut: suspend ? 'bloque' : 'actif' }); toast(suspend ? 'Compte suspendu.' : 'Compte réactivé.', 'success'); view.reload();
    });
    const removeUser = (r) => act(async () => {
      if (!(await confirmDialog({ title: `Supprimer définitivement le compte de ${r.prenom} ${r.nom} ?`, danger: true, confirmLabel: 'Supprimer le compte',
        message: 'Cette action est définitive. Le compte disparaît et ses données personnelles (nom, e-mail, téléphone) sont effacées. Si la personne a déjà voyagé, l’historique de ses réservations est conservé sans son nom. Pour seulement empêcher la connexion, utilisez plutôt « Suspendre ».' }))) return;
      const out = await api.del(`/api/admin/utilisateurs/${r.id_utilisateur}`);
      toast(out.mode === 'anonymise' ? 'Compte supprimé : données personnelles effacées, historique conservé sans nom.' : 'Compte supprimé.', 'success'); view.reload();
    });
    const view = listView({
      filters: [{ k: 'q', label: 'Recherche', type: 'search', placeholder: 'Nom, e-mail ou téléphone' }, { k: 'role', label: 'Profil', type: 'select', options: [['', 'Tous'], ['voyageur', 'Voyageurs'], ['gestionnaire', 'Gestionnaires'], ['admin', 'Administrateurs']] }, { k: 'statut', label: 'Statut', type: 'select', options: [['', 'Tous'], ['actif', 'Actifs'], ['bloque', 'Suspendus']] }],
      load: remoteLoader(api, '/api/admin/utilisateurs', 'utilisateurs'), onRow: (r) => userDrawer(r.id_utilisateur, () => view.reload()), emptyTitle: 'Aucun utilisateur', emptyText: 'Aucun compte ne correspond à cette recherche.',
      columns: [{ l: 'Nom', f: (r) => sub(`${r.prenom} ${r.nom}`, r.email) }, { l: 'Téléphone', f: (r) => r.telephone || '—', cls: 'nowrap' }, { l: 'Profil', f: (r) => pill(r.role) }, { l: 'Statut', f: (r) => pill(r.statut) }, { l: 'Inscrit le', f: (r) => fmtDateTime(r.date_creation), cls: 'nowrap' }],
      actions: (r) => [btnA('Modifier', { ic: 'edit', onclick: () => openForm({ title: `Modifier ${r.prenom} ${r.nom}`, fields: fields(false), values: r, onSubmit: async (d) => { await api.put(`/api/admin/utilisateurs/${r.id_utilisateur}`, d); toast('Compte modifié.', 'success'); view.reload(); } }) }),
        r.id_utilisateur === ctx.user.id_utilisateur ? null : btnA(r.statut === 'actif' ? 'Suspendre' : 'Réactiver', { ic: r.statut === 'actif' ? 'ban' : 'check', danger: r.statut === 'actif', onclick: () => toggle(r) }),
        r.id_utilisateur === ctx.user.id_utilisateur ? null : btnA('', { ic: 'trash', danger: true, title: 'Supprimer le compte', onclick: () => removeUser(r) })],
    });
    section(actions(h('button', { class: 'btn btn-vy btn-ic', type: 'button', onclick: () => openForm({ title: 'Nouveau compte', fields: fields(true), values: { role: 'gestionnaire' }, onSubmit: async (d) => { await api.post('/api/admin/utilisateurs', d); toast('Compte créé.', 'success'); view.reload(); } }) }, icon('plus', 16), 'Nouveau compte')), view.el);
  }

  // ============================================================ ACTIVITÉ
  async function activite() {
    const view = listView({
      pageSize: 30, filters: [{ k: 'entite', label: 'Type d\'événement', type: 'select', options: [['', 'Tous'], ['reservation', 'Réservations'], ['paiement', 'Paiements'], ['horaire', 'Voyages'], ['bus', 'Bus'], ['trajet', 'Trajets'], ['compagnie', 'Compagnies'], ['utilisateur', 'Utilisateurs'], ['chauffeur', 'Chauffeurs'], ['avis', 'Avis'], ['pourboire', 'Pourboires'], ['export', 'Exports']] }],
      load: remoteLoader(api, '/api/admin/activite', 'evenements'), emptyTitle: 'Aucun événement', emptyText: "Le journal se remplit au fil des réservations, paiements et modifications.",
      columns: [{ l: 'Date', f: (r) => fmtDateTime(r.date_evenement), cls: 'nowrap' }, { l: 'Événement', f: (r) => h('strong', {}, (EVENT_LABEL[r.action] || [r.action])[0]) }, { l: 'Détails', f: (r) => r.details || '—' }, { l: 'Auteur', f: (r) => r.utilisateur_nom || 'Système' }],
    });
    section(h('div', { class: 'note-box mb-3' }, "Le journal conserve les actions sensibles : annulations, paiements, modifications, suspensions de comptes et exports de données. Il ne peut pas être modifié."), view.el);
  }

  // ============================================================ ABONNEMENT (gestionnaire)
  async function abonnement() {
    const s = await api.get('/api/admin/abonnement');
    const flag = new URLSearchParams(location.hash.split('?')[1] || '').get('paiement');
    if (flag === 'ok') toast('Paiement reçu : votre abonnement est actif.', 'success');
    else if (flag === 'echec') toast("Le paiement n'a pas abouti. Vous pouvez réessayer.", 'error');
    else if (flag === 'attente') toast("Paiement en cours de confirmation. Actualisez dans un instant.", 'info');
    const tone = { actif: 'ok', en_attente: 'warn', expire: 'bad', non_requis: '' }[s.etat];
    const payBtn = h('button', { class: 'btn btn-vy btn-lg', type: 'button', disabled: !s.paiement_possible, onclick: (e) => busy(payBtn, () => act(async () => {
      const out = await api.post('/api/admin/abonnement/payer');
      if (out.url) { location.assign(out.url); return; }
      toast('Abonnement activé (paiement de démonstration).', 'success'); await ctx.reloadSubscription(); go('dashboard');
    })) }, s.etat === 'actif' ? `Renouveler (${fmtMoney(s.prix_fcfa)})` : `Payer l'abonnement (${fmtMoney(s.prix_fcfa)})`);
    section(
      s.actif ? null : h('div', { class: 'note-box mb-3' }, h('strong', {}, s.etat === 'expire' ? 'Votre abonnement a expiré. ' : 'Votre espace est verrouillé. '), 'Réglez l\'abonnement pour accéder à vos voyages, réservations et paiements, et pour que vos voyages soient proposés aux voyageurs.'),
      h('div', { class: 'grid g-main' },
        h('div', { class: 'card-a' }, h('div', { class: 'card-h' }, h('h2', {}, `Abonnement ${s.compagnie.nom}`), pill(s.etat)),
          dl([['Prix', `${fmtMoney(s.prix_fcfa)} pour ${s.duree_jours} jours`], ['Valable jusqu\'au', s.expire_le ? fmtDay(s.expire_le) : '—'], s.jours_restants != null && s.actif ? ['Jours restants', String(s.jours_restants)] : null]),
          h('div', { class: 'mt d-flex gap-2 flex-wrap align-items-center' }, s.etat === 'non_requis' ? h('span', { class: 'hint' }, 'Votre compagnie est dispensée d\'abonnement.') : payBtn),
          !s.paiement_possible && s.etat !== 'non_requis' ? h('p', { class: 'hint mt-3 mb-0' }, "Le paiement en ligne de l'abonnement n'est pas activé pour le moment. Contactez Voyagéo pour activer votre abonnement.") : null,
          s.mode_paiement === 'simulation' ? h('p', { class: 'hint mt-3 mb-0' }, 'Mode démonstration : le paiement est simulé, aucune vraie transaction.') : null),
        h('div', { class: 'card-a' }, h('div', { class: 'card-h' }, h('h2', {}, 'Comment ça marche')), h('ol', { class: 'ps-3 mb-0' }, h('li', {}, "Vous réglez l'abonnement à Voyagéo."), h('li', {}, 'Votre espace de gestion s\'ouvre.'), h('li', {}, 'Vous enregistrez vos clés FedaPay dans « Encaissement des tickets ».'), h('li', {}, 'Vos voyages sont proposés : les clients vous paient directement sur votre compte.')))),
      h('div', { class: 'card-a mt' }, h('div', { class: 'card-h' }, h('h2', {}, 'Historique des paiements')),
        s.historique.length ? h('div', { class: 'tbl-scroll' }, h('table', { class: 'tbl stack' }, h('thead', {}, h('tr', {}, ['Date', 'Montant', 'Mode', 'Statut', "Valable jusqu'au"].map((c) => h('th', { scope: 'col' }, c)))),
          h('tbody', {}, s.historique.map((p) => h('tr', {}, h('td', { 'data-label': 'Date' }, fmtDateTime(p.date)), h('td', { 'data-label': 'Montant', class: 'nowrap' }, fmtMoney(p.montant_fcfa)), h('td', { 'data-label': 'Mode' }, p.mode === 'manuel' ? 'Activation par Voyagéo' : p.mode === 'simulation' ? 'Simulation' : 'FedaPay'), h('td', { 'data-label': 'Statut' }, pill(p.statut)), h('td', { 'data-label': "Valable jusqu'au" }, p.expire_le ? fmtDay(p.expire_le) : '—')))))) : h('div', { class: 'chart-empty' }, 'Aucun paiement pour le moment.')));
  }

  // ============================================================ ENCAISSEMENT DES TICKETS : clés FedaPay de la compagnie (gestionnaire)
  async function encaissement() {
    const s = await api.get('/api/admin/parametres-paiement');
    const field = (id, label, attrs = {}) => { const i = h('input', { class: 'form-control', id, required: true, autocomplete: 'off', spellcheck: 'false', ...attrs }); return [i, h('div', { class: 'mb-3' }, h('label', { class: 'form-label required', for: id }, label), i)]; };
    const [pk, g1] = field('k-pub', 'Clé publique FedaPay', { placeholder: 'pk_live_…  ou  pk_sandbox_…' });
    const [sk, g2] = field('k-sec', 'Clé secrète FedaPay', { type: 'password', placeholder: 'sk_live_…  ou  sk_sandbox_…' });
    const [pw, g3] = field('k-pw', 'Votre mot de passe Voyagéo (confirmation)', { type: 'password', autocomplete: 'current-password' });
    const err = h('div', { class: 'text-danger small mb-2', role: 'alert' });
    const save = h('button', { class: 'btn btn-vy', type: 'submit' }, s.configure ? 'Remplacer mes clés' : 'Enregistrer mes clés');
    const form = h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); clear(err); busy(save, async () => {
      try { await api.put('/api/admin/parametres-paiement', { public_key: pk.value, secret_key: sk.value, mot_de_passe: pw.value }); toast('Clés enregistrées et vérifiées.', 'success'); await ctx.reloadSubscription(); encaissement(); }
      catch (x) { err.textContent = x.message; }
    }); } }, g1, g2, g3, err, save);
    const copy = h('button', { class: 'btn-a', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(s.webhook_url); toast('Adresse copiée.', 'success'); } catch { toast('Copiez l\'adresse manuellement.', 'info'); } } }, icon('check', 15), 'Copier');
    section(
      s.mode_plateforme !== 'fedapay' ? h('div', { class: 'note-box mb-3' }, `Le paiement en ligne de Voyagéo est actuellement en mode « ${s.mode_plateforme} » : vos clés FedaPay ne serviront que lorsque le mode FedaPay sera activé.`) : null,
      !s.configure ? h('div', { class: 'note-box mb-3' }, h('strong', {}, 'Vos voyages ne sont pas encore proposés aux voyageurs. '), 'Enregistrez vos clés FedaPay : c\'est ce qui permet que l\'argent des tickets arrive directement sur votre compte.') : null,
      h('div', { class: 'grid g-2' },
        h('div', { class: 'card-a' }, h('div', { class: 'card-h' }, h('h2', {}, 'Vos clés FedaPay'), s.configure ? pill('actif') : pill('en_attente')),
          s.configure ? h('div', {}, dl([['Environnement', s.env === 'live' ? 'Production (live)' : 'Test (sandbox)'], ['Clé publique', s.public_key_masquee], ['Clé secrète', s.secret_key_masquee], ['Enregistrées le', fmtDateTime(s.date_maj)]]),
            s.env === 'sandbox' ? h('p', { class: 'hint mt-2' }, 'Environnement de TEST : aucun vrai paiement. Passez aux clés « live » de votre compte FedaPay validé pour encaisser de l\'argent réel.') : null,
            h('div', { class: 'mt' }, btnA('Supprimer mes clés', { ic: 'trash', danger: true, onclick: () => openForm({ title: 'Supprimer mes clés FedaPay', submitLabel: 'Supprimer', intro: 'Vos voyages ne seront plus proposés et plus aucun ticket ne pourra être payé en ligne chez vous.', fields: [{ k: 'mot_de_passe', l: 'Votre mot de passe', t: 'password', req: true }], onSubmit: async (d) => { await api.post('/api/admin/parametres-paiement/supprimer', d); toast('Clés supprimées.', 'success'); await ctx.reloadSubscription(); encaissement(); } }) })), h('hr'), h('div', { class: 'sec-t mt-0' }, 'Remplacer mes clés')) : null,
          form, h('p', { class: 'hint mt-3 mb-0' }, 'La clé secrète est chiffrée avant d\'être enregistrée et n\'est plus jamais affichée. Ne la communiquez à personne.')),
        h('div', { class: 'card-a' }, h('div', { class: 'card-h' }, h('h2', {}, 'Où trouver mes clés ?')),
          h('ol', { class: 'ps-3' }, h('li', {}, 'Connectez-vous sur ', h('a', { href: 'https://fedapay.com', target: '_blank', rel: 'noopener noreferrer' }, 'fedapay.com'), '.'), h('li', {}, 'Ouvrez « Paramètres », puis « Clés API ».'), h('li', {}, 'Copiez la clé publique (pk_…) et la clé secrète (sk_…) du même environnement.')),
          h('div', { class: 'sec-t' }, 'Confirmer les paiements même si le client ferme la page'), h('p', { class: 'small' }, 'Dans FedaPay, ouvrez « Développeurs », puis « Webhooks », ajoutez cette adresse et cochez l\'événement « transaction.approved » :'),
          h('div', { class: 'pw-box' }, s.webhook_url), h('div', { class: 'mt' }, copy)))
    );
  }

  return { chauffeurs, voyages, reservations, paiements, compagnies, maCompagnie, bus, trajets, utilisateurs, activite, abonnement, encaissement, voyageDrawer, reservationDrawer };
}
