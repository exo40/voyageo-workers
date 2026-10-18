'use strict';
/**
 * TABLEAU DE BORD : tous les chiffres sont calculés à partir des données réellement enregistrées
 * (réservations, paiements, voyages, utilisateurs, journal). Rien n'est inventé : une donnée absente vaut 0 ou null.
 *
 * Définitions (affichées aussi dans l'interface) :
 *  - Chiffre d'affaires encaissé : paiements RÉELS confirmés (hors simulation), daté du jour de la transaction.
 *  - Réservations : réservations créées pendant la période, hors annulées (en attente + confirmées).
 *  - Voyage terminé : voyage marqué « terminé » OU voyage programmé dont l'heure de départ est passée.
 *  - Taux de remplissage moyen : places réservées / places des voyages non annulés partis pendant la période.
 */
const db = require('../db');
const { todayStr, addDays, departureTime } = require('../utils/time');
const catalog = require('./catalogService');
const { enrichedPayments } = require('./paymentReport');
const config = require('../config');
const subscription = require('./subscriptionService');

const PERIODES = [7, 30, 90, 365];
const localDate = (iso) => todayStr(Date.parse(iso));
const inRange = (d, a, b) => d >= a && d <= b;
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
const pct = (num, den) => (den ? Math.round((num / den) * 100) : 0);
const compare = (value, previous) => ({ valeur: value, precedent: previous, variation_pct: previous ? Math.round(((value - previous) / previous) * 100) : null });
const top = (map, n) => [...map.entries()].sort((a, b) => b[1].nombre - a[1].nombre || String(a[0]).localeCompare(String(b[0]), 'fr')).slice(0, n);
const hhmm = (h) => `${h.heure_depart}`;
const label = (h) => `${h.ville_depart} – ${h.ville_arrivee} à ${hhmm(h)} (${h.places_occupees}/${h.nombre_places})`;

/** Découpe la période en jours (≤ 31 jours) ou en semaines (au-delà) pour les courbes. */
function buckets(start, end, jours) {
  const step = jours <= 31 ? 1 : 7;
  const list = [];
  for (let d = start; d <= end; d = addDays(d, step)) list.push({ debut: d, fin: addDays(d, step - 1) < end ? addDays(d, step - 1) : end, reservations: 0, recettes: 0 });
  return list;
}
const bucketOf = (list, date) => list.find((b) => inRange(date, b.debut, b.fin));

async function dashboard({ id_compagnie = null, jours = 30 } = {}) {
  const periode = PERIODES.includes(Number(jours)) ? Number(jours) : 30;
  const today = todayStr();
  const now = Date.now();
  const start = addDays(today, -(periode - 1));
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(periode - 1));
  const admin = id_compagnie == null;

  await catalog.expirePending();
  const [horaires, pay, bus, activite, compagnies, users] = await Promise.all([
    db.listHoraires({ id_compagnie }),
    enrichedPayments({ id_compagnie }),
    db.listBus({ id_compagnie }),
    db.listAuditLog({ id_compagnie, limit: 15 }),
    db.listCompagnies(),
    admin ? db.listUsers({}) : Promise.resolve([]),
  ]);
  const resas = pay.reservations;
  const pays = pay.rows;
  const departed = (h) => departureTime(h.date_depart, h.heure_depart) < now;

  // ---------- réservations ----------
  const resaIn = (a, b) => resas.filter((r) => r.statut !== 'annulee' && inRange(localDate(r.date_reservation), a, b));
  const resaPeriod = resaIn(start, today), resaPrev = resaIn(prevStart, prevEnd);
  const parStatut = { confirmee: 0, en_attente: 0, annulee: 0 };
  for (const r of resas) if (inRange(localDate(r.date_reservation), start, today)) parStatut[r.statut] = (parStatut[r.statut] || 0) + 1;

  // ---------- recettes (paiements réels confirmés) ----------
  const reel = (p) => p.statut === 'reussi' && !p.simule;
  const caIn = (a, b) => sum(pays.filter((p) => reel(p) && inRange(localDate(p.date_paiement), a, b)), (p) => p.montant_fcfa);
  const caPeriod = caIn(start, today), caPrev = caIn(prevStart, prevEnd);

  // ---------- voyages ----------
  const hPeriod = horaires.filter((h) => inRange(h.date_depart, start, today));
  const hPrev = horaires.filter((h) => inRange(h.date_depart, prevStart, prevEnd));
  const upcoming = horaires.filter((h) => h.statut === 'programme' && !departed(h));
  const fill = (list) => { const l = list.filter((h) => h.statut !== 'annule' && h.nombre_places > 0); return pct(sum(l, (h) => h.places_occupees), sum(l, (h) => h.nombre_places)); };
  const finished = (h) => h.statut === 'termine' || (h.statut === 'programme' && departed(h));
  const termines = hPeriod.filter(finished).length, terminesPrev = hPrev.filter(finished).length;
  const annules = hPeriod.filter((h) => h.statut === 'annule').length, annulesPrev = hPrev.filter((h) => h.statut === 'annule').length;

  // ---------- utilisateurs ----------
  const voyageurs = users.filter((u) => u.role === 'voyageur');
  const newUsers = (a, b) => voyageurs.filter((u) => inRange(localDate(u.date_creation), a, b)).length;

  // ---------- paiements ----------
  const pPeriod = pays.filter((p) => inRange(localDate(p.date_paiement), start, today));
  const repartition = [
    { cle: 'confirme', libelle: 'Confirmés', nombre: pPeriod.filter((p) => p.etat === 'confirme' || p.etat === 'a_rembourser' || p.etat === 'rembourse').length, montant: sum(pPeriod.filter(reel), (p) => p.montant_fcfa) },
    { cle: 'simule', libelle: 'Simulés', nombre: pPeriod.filter((p) => p.etat === 'simule').length, montant: sum(pPeriod.filter((p) => p.etat === 'simule'), (p) => p.montant_fcfa) },
    { cle: 'en_attente', libelle: 'En attente', nombre: pPeriod.filter((p) => p.etat === 'en_attente' || p.etat === 'a_verifier').length, montant: sum(pPeriod.filter((p) => p.etat === 'en_attente' || p.etat === 'a_verifier'), (p) => p.montant_fcfa) },
    { cle: 'echoue', libelle: 'Échoués', nombre: pPeriod.filter((p) => p.etat === 'echoue').length, montant: sum(pPeriod.filter((p) => p.etat === 'echoue'), (p) => p.montant_fcfa) },
  ];
  const enAttenteTous = pays.filter((p) => p.etat === 'en_attente' || p.etat === 'a_verifier');
  const aRembourser = pays.filter((p) => p.etat === 'a_rembourser');

  // ---------- séries (courbes) ----------
  const serie = buckets(start, today, periode);
  for (const r of resaPeriod) { const b = bucketOf(serie, localDate(r.date_reservation)); if (b) b.reservations += 1; }
  for (const p of pays.filter((x) => reel(x))) { const d = localDate(p.date_paiement); if (inRange(d, start, today)) { const b = bucketOf(serie, d); if (b) b.recettes += p.montant_fcfa; } }

  // ---------- classements ----------
  const routes = new Map();
  for (const r of resaPeriod) { const k = `${r.ville_depart} – ${r.ville_arrivee}`; const e = routes.get(k) || { nombre: 0 }; e.nombre += 1; routes.set(k, e); }
  const comp = new Map();
  for (const r of resaPeriod) { const k = r.compagnie_nom || '—'; const e = comp.get(k) || { nombre: 0 }; e.nombre += 1; comp.set(k, e); }
  const busFill = new Map();
  for (const h of hPeriod.filter((x) => x.statut !== 'annule' && x.nombre_places > 0)) {
    const k = h.immatriculation; const e = busFill.get(k) || { nombre: 0, occ: 0, places: 0, compagnie: h.compagnie_nom };
    e.nombre += 1; e.occ += h.places_occupees; e.places += h.nombre_places; busFill.set(k, e);
  }

  // ---------- alertes ----------
  const alertes = [];
  const imminents = upcoming.filter((h) => departureTime(h.date_depart, h.heure_depart) - now <= 3 * 3600000 && h.places_occupees > 0);
  if (imminents.length) alertes.push({ code: 'departs_imminents', niveau: 'info', titre: `${imminents.length} départ${imminents.length > 1 ? 's' : ''} dans les 3 prochaines heures`, detail: imminents.slice(0, 3).map(label).join(' · '), nombre: imminents.length, section: 'horaires' });
  const presque = upcoming.filter((h) => h.nombre_places > 0 && h.places_occupees < h.nombre_places && h.places_occupees / h.nombre_places >= 0.9 && h.date_depart <= addDays(today, 7));
  if (presque.length) alertes.push({ code: 'presque_complets', niveau: 'warning', titre: `${presque.length} voyage${presque.length > 1 ? 's' : ''} presque complet${presque.length > 1 ? 's' : ''} (90 % et plus, 7 prochains jours)`, detail: presque.slice(0, 3).map(label).join(' · '), nombre: presque.length, section: 'horaires' });
  const annulesAVenir = horaires.filter((h) => h.statut === 'annule' && h.date_depart >= today);
  if (annulesAVenir.length) alertes.push({ code: 'voyages_annules', niveau: 'info', titre: `${annulesAVenir.length} voyage${annulesAVenir.length > 1 ? 's' : ''} annulé${annulesAVenir.length > 1 ? 's' : ''} à venir`, detail: null, nombre: annulesAVenir.length, section: 'horaires' });
  const aVerifier = pays.filter((p) => p.etat === 'a_verifier');
  if (aVerifier.length) alertes.push({ code: 'paiements_a_verifier', niveau: 'warning', titre: `${aVerifier.length} paiement${aVerifier.length > 1 ? 's' : ''} en attente depuis plus de 30 minutes`, detail: 'À vérifier auprès du prestataire de paiement.', nombre: aVerifier.length, section: 'paiements' });
  if (aRembourser.length) alertes.push({ code: 'remboursements', niveau: 'danger', titre: `${aRembourser.length} remboursement${aRembourser.length > 1 ? 's' : ''} à traiter`, detail: `Montant : ${sum(aRembourser, (p) => p.montant_fcfa)} FCFA (ticket annulé, place prise ou paiement en double).`, nombre: aRembourser.length, section: 'paiements' });
  const payeSansTicket = pays.filter((p) => p.statut === 'reussi' && p.statut_reservation === 'en_attente');
  if (payeSansTicket.length) alertes.push({ code: 'paye_sans_ticket', niveau: 'danger', titre: `${payeSansTicket.length} paiement${payeSansTicket.length > 1 ? 's' : ''} confirmé${payeSansTicket.length > 1 ? 's' : ''} sans ticket délivré`, detail: `Tickets : ${payeSansTicket.slice(0, 3).map((p) => p.numero_ticket).join(', ')}. Incohérence à corriger.`, nombre: payeSansTicket.length, section: 'paiements' });
  const annuleAvecResa = horaires.filter((h) => h.statut === 'annule' && h.places_occupees > 0);
  const surcharge = horaires.filter((h) => h.places_occupees > h.nombre_places);
  const incoh = annuleAvecResa.length + surcharge.length;
  if (incoh) alertes.push({ code: 'incoherences', niveau: 'danger', titre: `${incoh} incohérence${incoh > 1 ? 's' : ''} de données`, detail: [annuleAvecResa.length ? `${annuleAvecResa.length} voyage(s) annulé(s) avec des réservations actives` : null, surcharge.length ? `${surcharge.length} voyage(s) avec plus de réservations que de places` : null].filter(Boolean).join(' · '), nombre: incoh, section: 'horaires' });

  // Alertes propres à une agence inscrite : abonnement bientôt échu, clés FedaPay manquantes.
  if (!admin) {
    const me = compagnies.find((c) => c.id_compagnie === id_compagnie);
    const st = subscription.stateOf(me);
    if (st.requis && st.actif && st.jours_restants <= 7) alertes.unshift({ code: 'abonnement_expire', niveau: st.jours_restants <= 2 ? 'danger' : 'warning', titre: `Votre abonnement expire ${st.jours_restants <= 0 ? "aujourd'hui" : `dans ${st.jours_restants} jour${st.jours_restants > 1 ? 's' : ''}`}`, detail: 'Renouvelez-le pour que vos voyages restent proposés et que votre espace reste accessible.', nombre: 1, section: 'abonnement' });
    if (st.requis && config.payment.mode === 'fedapay' && !(await db.getCompanyPaymentSettings(id_compagnie))) alertes.unshift({ code: 'paiement_non_configure', niveau: 'danger', titre: 'Vos clés FedaPay ne sont pas enregistrées', detail: "Tant qu'elles ne sont pas enregistrées, vos voyages ne sont pas proposés : ces clés permettent d'encaisser les tickets directement sur votre compte.", nombre: 1, section: 'encaissement' });
  }

  return {
    periode: { jours: periode, debut: start, fin: today, precedent_debut: prevStart, precedent_fin: prevEnd },
    portee: admin ? 'global' : 'compagnie',
    kpis: {
      chiffre_affaires: compare(caPeriod, caPrev),
      chiffre_affaires_simule: sum(pPeriod.filter((p) => p.etat === 'simule'), (p) => p.montant_fcfa),
      reservations: compare(resaPeriod.length, resaPrev.length),
      utilisateurs: admin ? { total: voyageurs.length, ...compare(newUsers(start, today), newUsers(prevStart, prevEnd)) } : null,
      compagnies_actives: admin ? { actives: compagnies.filter((c) => c.statut === 'active').length, total: compagnies.length } : null,
      bus: bus.length,
      voyages_programmes: upcoming.length,
      voyages_termines: compare(termines, terminesPrev),
      voyages_annules: compare(annules, annulesPrev),
      taux_remplissage: compare(fill(hPeriod), fill(hPrev)),
      remplissage_a_venir: fill(upcoming),
      paiements_en_attente: { nombre: enAttenteTous.length, montant: sum(enAttenteTous, (p) => p.montant_fcfa) },
      transactions_echouees: compare(pPeriod.filter((p) => p.etat === 'echoue').length, pays.filter((p) => p.etat === 'echoue' && inRange(localDate(p.date_paiement), prevStart, prevEnd)).length),
      a_rembourser: { nombre: aRembourser.length, montant: sum(aRembourser, (p) => p.montant_fcfa) },
    },
    graphiques: {
      evolution: serie.map((b) => ({ debut: b.debut, fin: b.fin, reservations: b.reservations, recettes: b.recettes })),
      par_statut: parStatut,
      trajets_populaires: top(routes, 6).map(([nom, e]) => ({ nom, nombre: e.nombre })),
      compagnies_actives: top(comp, 6).map(([nom, e]) => ({ nom, nombre: e.nombre })),
      remplissage_bus: [...busFill.entries()].map(([nom, e]) => ({ nom, compagnie: e.compagnie, voyages: e.nombre, taux: pct(e.occ, e.places) })).sort((a, b) => b.taux - a.taux).slice(0, 8),
      paiements_par_statut: repartition,
    },
    alertes,
    activite,
    prochains_departs: upcoming.slice(0, 8).map((h) => ({ id_horaire: h.id_horaire, date_depart: h.date_depart, heure_depart: h.heure_depart, ville_depart: h.ville_depart, ville_arrivee: h.ville_arrivee, compagnie_nom: h.compagnie_nom, places_occupees: h.places_occupees, nombre_places: h.nombre_places })),
  };
}

module.exports = { dashboard, PERIODES };
