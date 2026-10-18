'use strict';
/**
 * ADAPTATEUR "JSON" : base de données dans un simple fichier (data/db.json).
 * Sert au développement et à la démonstration : aucune installation nécessaire.
 * Il montre aussi, sans SQL, le comportement attendu de chaque fonction du contrat.
 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('../../config');
const { DbError } = require('../errors');
const { normCity } = require('../../utils/validate');

let state = null;
let file = null;

const EMPTY = () => ({ seq: {}, users: [], compagnies: [], bus: [], trajets: [], horaires: [], reservations: [], paiements: [], journal: [], paiements_compagnie: [], paiements_abonnement: [], chauffeurs: [], avis: [], pourboires: [] });
const nextId = (t) => (state.seq[t] = (state.seq[t] || 0) + 1);
const clone = (o) => (o == null ? null : structuredClone(o));
const nowIso = () => new Date().toISOString();
const find = (arr, key, id) => arr.find((x) => x[key] === id) || null;
const active = (r) => r.statut !== 'annulee';
const ratingOf = (id) => {
  const l = id == null ? [] : state.avis.filter((a) => a.id_chauffeur === id);
  return { note: l.length ? Math.round((l.reduce((s, a) => s + a.note, 0) / l.length) * 10) / 10 : null, nb: l.length };
};
const eqi = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

function save() {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const data = JSON.stringify(state, null, 2);
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch (e) {
    // Windows : l'antivirus, OneDrive ou un dossier protégé peuvent verrouiller le fichier (EPERM, EBUSY...).
    // On écrit alors directement dans le fichier.
    if (!['EPERM', 'EBUSY', 'EACCES', 'EEXIST'].includes(e.code)) throw e;
    fs.writeFileSync(file, data);
    try { fs.unlinkSync(tmp); } catch { /* sans importance */ }
  }
}
const pick = (src, keys) => Object.fromEntries(keys.filter((k) => k in src).map((k) => [k, src[k]]));
const patchOf = (patch, allowed) => pick(patch, allowed);

// ---------- vues (équivalent des JOIN SQL) ----------
function horaireView(h) {
  const t = find(state.trajets, 'id_trajet', h.id_trajet);
  const b = find(state.bus, 'id_bus', h.id_bus);
  const c = t ? find(state.compagnies, 'id_compagnie', t.id_compagnie) : null;
  const ch = h.id_chauffeur != null ? find(state.chauffeurs, 'id_chauffeur', h.id_chauffeur) : null;
  const rt = ratingOf(ch ? ch.id_chauffeur : null);
  return {
    ...h,
    photo_bus: h.photo_bus ?? null,
    id_chauffeur: h.id_chauffeur ?? null,
    bus_photo: b?.photo ?? null,
    chauffeur_prenom: ch?.prenom ?? null,
    chauffeur_photo: ch?.photo ?? null,
    chauffeur_note: rt.note,
    chauffeur_nb_avis: rt.nb,
    ville_depart: t?.ville_depart ?? null,
    ville_arrivee: t?.ville_arrivee ?? null,
    duree_estimee: t?.duree_estimee ?? null,
    lieu_embarquement: t?.lieu_embarquement ?? null,
    lien_maps: t?.lien_maps ?? null,
    id_compagnie: t?.id_compagnie ?? null,
    compagnie_nom: c?.nom ?? null,
    compagnie_statut: c?.statut ?? null,
    compagnie_abonnement_statut: c ? (c.abonnement_statut || 'non_requis') : null,
    compagnie_abonnement_expire_le: c?.abonnement_expire_le ?? null,
    compagnie_paiement_configure: !!(c && state.paiements_compagnie.some((s) => s.id_compagnie === c.id_compagnie)),
    immatriculation: b?.immatriculation ?? null,
    nombre_places: b?.nombre_places ?? 0,
    places_occupees: state.reservations.filter((r) => r.id_horaire === h.id_horaire && active(r)).length,
  };
}
function reservationView(r) {
  const h = find(state.horaires, 'id_horaire', r.id_horaire);
  const hv = h ? horaireView(h) : {};
  const u = find(state.users, 'id_utilisateur', r.id_utilisateur);
  return {
    ...r,
    ville_depart: hv.ville_depart ?? null,
    ville_arrivee: hv.ville_arrivee ?? null,
    date_depart: hv.date_depart ?? null,
    heure_depart: hv.heure_depart ?? null,
    heure_arrivee: hv.heure_arrivee ?? null,
    lieu_embarquement: hv.lieu_embarquement ?? null,
    lien_maps: hv.lien_maps ?? null,
    photo_bus: hv.photo_bus ?? null,
    bus_photo: hv.bus_photo ?? null,
    id_chauffeur: hv.id_chauffeur ?? null,
    chauffeur_prenom: hv.chauffeur_prenom ?? null,
    chauffeur_photo: hv.chauffeur_photo ?? null,
    chauffeur_note: hv.chauffeur_note ?? null,
    chauffeur_nb_avis: hv.chauffeur_nb_avis ?? 0,
    tarif_fcfa: hv.tarif_fcfa ?? null,
    statut_horaire: hv.statut ?? null,
    id_compagnie: hv.id_compagnie ?? null,
    compagnie_nom: hv.compagnie_nom ?? null,
    utilisateur_email: u?.email ?? null,
    utilisateur_nom: u ? `${u.prenom} ${u.nom}` : null,
  };
}
const byDepart = (a, b) => `${a.date_depart} ${a.heure_depart}`.localeCompare(`${b.date_depart} ${b.heure_depart}`);

module.exports = {
  // ---------- cycle de vie ----------
  async init() {
    file = config.db.json.file;
    if (fs.existsSync(file)) state = { ...EMPTY(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    else { state = EMPTY(); save(); }
  },
  async close() {},
  async ping() { return true; },

  // ---------- utilisateurs ----------
  async findUserByEmail(email) { return clone(state.users.find((u) => eqi(u.email, email))); },
  async findUserById(id) { return clone(find(state.users, 'id_utilisateur', id)); },
  async createUser(d) {
    if (state.users.some((u) => eqi(u.email, d.email))) throw new DbError('DUPLICATE_EMAIL');
    const u = {
      id_utilisateur: nextId('users'), nom: d.nom, prenom: d.prenom, email: d.email, telephone: d.telephone ?? null,
      mot_de_passe_hache: d.mot_de_passe_hache, role: d.role || 'voyageur', statut: d.statut || 'actif',
      id_compagnie: d.id_compagnie ?? null, date_creation: nowIso(),
      consentement_date: d.consentement_date ?? null, consentement_version: d.consentement_version ?? null,
    };
    state.users.push(u); save(); return clone(u);
  },
  async updateUser(id, patch) {
    const u = find(state.users, 'id_utilisateur', id);
    if (!u) return null;
    Object.assign(u, patchOf(patch, ['nom', 'prenom', 'email', 'telephone', 'mot_de_passe_hache', 'role', 'statut', 'id_compagnie', 'consentement_date', 'consentement_version']));
    save(); return clone(u);
  },
  /** Supprime définitivement le compte. IN_USE si des réservations lui sont rattachées (on les anonymise alors côté service). */
  async deleteUser(id) {
    if (state.reservations.some((r) => r.id_utilisateur === id) || state.avis.some((a) => a.id_utilisateur === id)) throw new DbError('IN_USE');
    const n = state.users.length; state.users = state.users.filter((u) => u.id_utilisateur !== id); save(); return state.users.length < n;
  },
  async listUsers({ q, role, id_compagnie } = {}) {
    let list = state.users;
    if (role) list = list.filter((u) => u.role === role);
    if (id_compagnie != null) list = list.filter((u) => u.id_compagnie === id_compagnie);
    if (q) { const s = normCity(q); list = list.filter((u) => normCity(`${u.prenom} ${u.nom} ${u.email} ${u.telephone || ''}`).includes(s)); }
    return clone([...list].sort((a, b) => b.id_utilisateur - a.id_utilisateur));
  },

  // ---------- compagnies ----------
  async listCompagnies() { return clone([...state.compagnies].sort((a, b) => a.nom.localeCompare(b.nom))); },
  async getCompagnie(id) { return clone(find(state.compagnies, 'id_compagnie', id)); },
  async createCompagnie(d) {
    const c = { id_compagnie: nextId('compagnies'), nom: d.nom, telephone: d.telephone ?? null, email: d.email ?? null, adresse: d.adresse ?? null, statut: d.statut || 'active', abonnement_statut: d.abonnement_statut || 'non_requis', abonnement_expire_le: d.abonnement_expire_le ?? null };
    state.compagnies.push(c); save(); return clone(c);
  },
  async updateCompagnie(id, patch) {
    const c = find(state.compagnies, 'id_compagnie', id); if (!c) return null;
    Object.assign(c, patchOf(patch, ['nom', 'telephone', 'email', 'adresse', 'statut', 'abonnement_statut', 'abonnement_expire_le'])); save(); return clone(c);
  },
  async deleteCompagnie(id) {
    if (state.bus.some((b) => b.id_compagnie === id) || state.trajets.some((t) => t.id_compagnie === id) || state.users.some((u) => u.id_compagnie === id)) throw new DbError('IN_USE');
    const n = state.compagnies.length; state.compagnies = state.compagnies.filter((c) => c.id_compagnie !== id); save(); return state.compagnies.length < n;
  },

  // ---------- bus ----------
  async listBus({ id_compagnie } = {}) {
    let l = state.bus; if (id_compagnie != null) l = l.filter((b) => b.id_compagnie === id_compagnie);
    return clone(l.map((b) => ({ ...b, compagnie_nom: find(state.compagnies, 'id_compagnie', b.id_compagnie)?.nom ?? null })));
  },
  async getBus(id) { const b = find(state.bus, 'id_bus', id); return b ? clone({ ...b, compagnie_nom: find(state.compagnies, 'id_compagnie', b.id_compagnie)?.nom ?? null }) : null; },
  async createBus(d) {
    if (state.bus.some((b) => eqi(b.immatriculation, d.immatriculation))) throw new DbError('DUPLICATE_PLATE', 'Immatriculation déjà utilisée');
    const b = { id_bus: nextId('bus'), id_compagnie: d.id_compagnie, immatriculation: d.immatriculation, nombre_places: d.nombre_places, type: d.type ?? null, photo: d.photo ?? null };
    state.bus.push(b); save(); return clone(b);
  },
  async updateBus(id, patch) {
    const b = find(state.bus, 'id_bus', id); if (!b) return null;
    if (patch.immatriculation && state.bus.some((x) => x.id_bus !== id && eqi(x.immatriculation, patch.immatriculation))) throw new DbError('DUPLICATE_PLATE', 'Immatriculation déjà utilisée');
    Object.assign(b, patchOf(patch, ['id_compagnie', 'immatriculation', 'nombre_places', 'type', 'photo'])); save(); return clone(b);
  },
  async deleteBus(id) {
    if (state.horaires.some((h) => h.id_bus === id)) throw new DbError('IN_USE');
    const n = state.bus.length; state.bus = state.bus.filter((b) => b.id_bus !== id); save(); return state.bus.length < n;
  },

  // ---------- trajets ----------
  async listTrajets({ id_compagnie } = {}) {
    let l = state.trajets; if (id_compagnie != null) l = l.filter((t) => t.id_compagnie === id_compagnie);
    return clone(l.map((t) => ({ ...t, compagnie_nom: find(state.compagnies, 'id_compagnie', t.id_compagnie)?.nom ?? null })));
  },
  async getTrajet(id) { const t = find(state.trajets, 'id_trajet', id); return t ? clone({ ...t, compagnie_nom: find(state.compagnies, 'id_compagnie', t.id_compagnie)?.nom ?? null }) : null; },
  async createTrajet(d) {
    const t = { id_trajet: nextId('trajets'), id_compagnie: d.id_compagnie, ville_depart: d.ville_depart, ville_arrivee: d.ville_arrivee, duree_estimee: d.duree_estimee ?? null, lieu_embarquement: d.lieu_embarquement ?? null, lien_maps: d.lien_maps ?? null };
    state.trajets.push(t); save(); return clone(t);
  },
  async updateTrajet(id, patch) {
    const t = find(state.trajets, 'id_trajet', id); if (!t) return null;
    Object.assign(t, patchOf(patch, ['id_compagnie', 'ville_depart', 'ville_arrivee', 'duree_estimee', 'lieu_embarquement', 'lien_maps'])); save(); return clone(t);
  },
  async deleteTrajet(id) {
    if (state.horaires.some((h) => h.id_trajet === id)) throw new DbError('IN_USE');
    const n = state.trajets.length; state.trajets = state.trajets.filter((t) => t.id_trajet !== id); save(); return state.trajets.length < n;
  },

  // ---------- horaires ----------
  async searchHoraires({ ville_depart, ville_arrivee, date }) {
    const d = normCity(ville_depart), a = normCity(ville_arrivee);
    return clone(state.horaires.filter((h) => h.date_depart === date && h.statut === 'programme').map(horaireView)
      .filter((h) => normCity(h.ville_depart) === d && normCity(h.ville_arrivee) === a).sort(byDepart));
  },
  async listHoraires({ id_compagnie, date_min, date_max, id_trajet } = {}) {
    let l = state.horaires.map(horaireView);
    if (id_compagnie != null) l = l.filter((h) => h.id_compagnie === id_compagnie);
    if (id_trajet != null) l = l.filter((h) => h.id_trajet === id_trajet);
    if (date_min) l = l.filter((h) => h.date_depart >= date_min);
    if (date_max) l = l.filter((h) => h.date_depart <= date_max);
    return clone(l.sort(byDepart));
  },
  async getHoraire(id) { const h = find(state.horaires, 'id_horaire', id); return h ? clone(horaireView(h)) : null; },
  async createHoraire(d) {
    const h = { id_horaire: nextId('horaires'), id_trajet: d.id_trajet, id_bus: d.id_bus, date_depart: d.date_depart, heure_depart: d.heure_depart, heure_arrivee: d.heure_arrivee ?? null, tarif_fcfa: d.tarif_fcfa, statut: d.statut || 'programme', id_chauffeur: d.id_chauffeur ?? null, photo_bus: d.photo_bus ?? null };
    state.horaires.push(h); save(); return clone(horaireView(h));
  },
  async updateHoraire(id, patch) {
    const h = find(state.horaires, 'id_horaire', id); if (!h) return null;
    Object.assign(h, patchOf(patch, ['id_trajet', 'id_bus', 'date_depart', 'heure_depart', 'heure_arrivee', 'tarif_fcfa', 'statut', 'id_chauffeur', 'photo_bus'])); save(); return clone(horaireView(h));
  },
  async deleteHoraire(id) {
    if (state.reservations.some((r) => r.id_horaire === id)) throw new DbError('IN_USE');
    const n = state.horaires.length; state.horaires = state.horaires.filter((h) => h.id_horaire !== id); save(); return state.horaires.length < n;
  },
  async getOccupiedSeats(id_horaire) {
    return state.reservations.filter((r) => r.id_horaire === id_horaire && active(r)).map((r) => r.numero_place).sort((a, b) => a - b);
  },

  // ---------- réservations ----------
  async createReservation(d) {
    if (state.reservations.some((r) => r.id_horaire === d.id_horaire && r.numero_place === d.numero_place && active(r))) throw new DbError('SEAT_TAKEN');
    if (state.reservations.some((r) => r.numero_ticket === d.numero_ticket)) throw new DbError('DUPLICATE_TICKET');
    const r = {
      id_reservation: nextId('reservations'), numero_ticket: d.numero_ticket, id_utilisateur: d.id_utilisateur, id_horaire: d.id_horaire,
      numero_place: d.numero_place, nom_passager: d.nom_passager, prenom_passager: d.prenom_passager, telephone_passager: d.telephone_passager,
      piece_identite: d.piece_identite ?? null, statut: d.statut || 'confirmee', date_reservation: nowIso(), date_annulation: null,
    };
    state.reservations.push(r); save(); return clone(reservationView(r));
  },
  async getReservationByTicket(numero) { const r = state.reservations.find((x) => x.numero_ticket === numero); return r ? clone(reservationView(r)) : null; },
  async getReservationById(id) { const r = find(state.reservations, 'id_reservation', id); return r ? clone(reservationView(r)) : null; },
  async listReservationsByUser(id_utilisateur) {
    return clone(state.reservations.filter((r) => r.id_utilisateur === id_utilisateur).map(reservationView)
      .sort((a, b) => byDepart(b, a)));
  },
  async listReservations({ id_compagnie, statut, q, id_horaire, limit = 200 } = {}) {
    let l = state.reservations.map(reservationView);
    if (id_compagnie != null) l = l.filter((r) => r.id_compagnie === id_compagnie);
    if (statut) l = l.filter((r) => r.statut === statut);
    if (id_horaire != null) l = l.filter((r) => r.id_horaire === id_horaire);
    if (q) { const s = normCity(q); l = l.filter((r) => normCity(`${r.numero_ticket} ${r.prenom_passager} ${r.nom_passager} ${r.telephone_passager}`).includes(s)); }
    return clone(l.sort((a, b) => b.date_reservation.localeCompare(a.date_reservation)).slice(0, limit));
  },
  async cancelReservation(id) {
    const r = find(state.reservations, 'id_reservation', id); if (!r) return null;
    if (r.statut !== 'annulee') { r.statut = 'annulee'; r.date_annulation = nowIso(); save(); }
    return clone(reservationView(r));
  },
  async updateReservationStatus(id, statut) {
    const r = find(state.reservations, 'id_reservation', id); if (!r) return null;
    if (r.statut === 'annulee' && statut !== 'annulee' &&
        state.reservations.some((x) => x !== r && x.id_horaire === r.id_horaire && x.numero_place === r.numero_place && active(x))) throw new DbError('SEAT_TAKEN');
    r.statut = statut; r.date_annulation = statut === 'annulee' ? nowIso() : null; save(); return clone(reservationView(r));
  },
  async expirePendingReservations(cutoffIso) {
    let n = 0;
    for (const r of state.reservations) if (r.statut === 'en_attente' && r.date_reservation < cutoffIso) { r.statut = 'annulee'; r.date_annulation = nowIso(); n++; }
    if (n) save(); return n;
  },

  // ---------- paiements ----------
  async createPayment(d) {
    const p = { id_paiement: nextId('paiements'), id_reservation: d.id_reservation, montant_fcfa: d.montant_fcfa, mode: d.mode, reference_transaction: d.reference_transaction ?? null, statut: d.statut || 'en_attente', date_paiement: nowIso() };
    state.paiements.push(p); save(); return clone(p);
  },
  async getPaymentByReference(ref) { return clone(state.paiements.find((p) => p.reference_transaction === ref)); },
  async getLatestPaymentByReservation(id) { return clone([...state.paiements].reverse().find((p) => p.id_reservation === id)); },
  async listPayments({ id_compagnie } = {}) {
    const rows = state.paiements.map((p) => {
      const r = find(state.reservations, 'id_reservation', p.id_reservation);
      const v = r ? reservationView(r) : {};
      return { ...p, numero_ticket: v.numero_ticket ?? null, id_compagnie: v.id_compagnie ?? null, compagnie_nom: v.compagnie_nom ?? null,
        ville_depart: v.ville_depart ?? null, ville_arrivee: v.ville_arrivee ?? null, utilisateur_nom: v.utilisateur_nom ?? null };
    }).filter((p) => id_compagnie == null || p.id_compagnie === id_compagnie);
    return clone(rows.sort((a, b) => b.id_paiement - a.id_paiement));
  },
  async listPaymentsByReservation(id) { return clone(state.paiements.filter((p) => p.id_reservation === id).sort((a, b) => a.id_paiement - b.id_paiement)); },
  async updatePayment(id, patch) {
    const p = find(state.paiements, 'id_paiement', id); if (!p) return null;
    Object.assign(p, patchOf(patch, ['statut', 'reference_transaction', 'mode'])); save(); return clone(p);
  },

  // ---------- clés de paiement des compagnies (secret chiffré) et abonnements ----------
  async getCompanyPaymentSettings(id) { return clone(state.paiements_compagnie.find((s) => s.id_compagnie === id)); },
  async saveCompanyPaymentSettings(id, d) {
    const row = { id_compagnie: id, fedapay_env: d.fedapay_env, public_key: d.public_key, secret_key_enc: d.secret_key_enc, verifie: !!d.verifie, date_maj: nowIso() };
    const i = state.paiements_compagnie.findIndex((s) => s.id_compagnie === id);
    if (i >= 0) state.paiements_compagnie[i] = row; else state.paiements_compagnie.push(row);
    save(); return clone(row);
  },
  async deleteCompanyPaymentSettings(id) { const n = state.paiements_compagnie.length; state.paiements_compagnie = state.paiements_compagnie.filter((s) => s.id_compagnie !== id); save(); return state.paiements_compagnie.length < n; },
  async createSubscriptionPayment(d) {
    const p = { id_abonnement: nextId('abonnements'), id_compagnie: d.id_compagnie, montant_fcfa: d.montant_fcfa, mode: d.mode, reference_transaction: d.reference_transaction ?? null, statut: d.statut || 'en_attente', jours: d.jours ?? null, expire_le: null, date_paiement: nowIso() };
    state.paiements_abonnement.push(p); save(); return clone(p);
  },
  async getSubscriptionPaymentByReference(ref) { return clone(state.paiements_abonnement.find((p) => p.reference_transaction === ref)); },
  async updateSubscriptionPayment(id, patch) {
    const p = find(state.paiements_abonnement, 'id_abonnement', id); if (!p) return null;
    Object.assign(p, patchOf(patch, ['statut', 'expire_le', 'jours'])); save(); return clone(p);
  },
  async listSubscriptionPayments({ id_compagnie } = {}) {
    let l = state.paiements_abonnement; if (id_compagnie != null) l = l.filter((p) => p.id_compagnie === id_compagnie);
    return clone([...l].sort((a, b) => b.id_abonnement - a.id_abonnement));
  },

  // ---------- chauffeurs (prénom seul + photo), avis et pourboires ----------
  async listChauffeurs({ id_compagnie } = {}) {
    let l = state.chauffeurs; if (id_compagnie != null) l = l.filter((c) => c.id_compagnie === id_compagnie);
    return clone(l.map((c) => { const r = ratingOf(c.id_chauffeur); return { ...c, compagnie_nom: find(state.compagnies, 'id_compagnie', c.id_compagnie)?.nom ?? null, note: r.note, nb_avis: r.nb }; }));
  },
  async getChauffeur(id) {
    const c = find(state.chauffeurs, 'id_chauffeur', id); if (!c) return null;
    const r = ratingOf(id); return clone({ ...c, compagnie_nom: find(state.compagnies, 'id_compagnie', c.id_compagnie)?.nom ?? null, note: r.note, nb_avis: r.nb });
  },
  async createChauffeur(d) {
    const c = { id_chauffeur: nextId('chauffeurs'), id_compagnie: d.id_compagnie, prenom: d.prenom, photo: d.photo ?? null };
    state.chauffeurs.push(c); save(); return this.getChauffeur(c.id_chauffeur);
  },
  async updateChauffeur(id, patch) {
    const c = find(state.chauffeurs, 'id_chauffeur', id); if (!c) return null;
    Object.assign(c, patchOf(patch, ['prenom', 'photo'])); save(); return this.getChauffeur(id);
  },
  async deleteChauffeur(id) {
    if (state.horaires.some((h) => h.id_chauffeur === id) || state.avis.some((a) => a.id_chauffeur === id) || state.pourboires.some((p) => p.id_chauffeur === id)) throw new DbError('IN_USE');
    const n = state.chauffeurs.length; state.chauffeurs = state.chauffeurs.filter((c) => c.id_chauffeur !== id); save(); return state.chauffeurs.length < n;
  },
  async createAvis(d) {
    if (state.avis.some((a) => a.id_reservation === d.id_reservation)) throw new DbError('DUPLICATE_AVIS');
    const a = { id_avis: nextId('avis'), id_reservation: d.id_reservation, id_horaire: d.id_horaire, id_chauffeur: d.id_chauffeur, id_utilisateur: d.id_utilisateur, note: d.note, commentaire: d.commentaire ?? null, date_avis: nowIso() };
    state.avis.push(a); save(); return clone(a);
  },
  async getAvisByReservation(id) { return clone(state.avis.find((a) => a.id_reservation === id)); },
  async listAvis({ id_compagnie, id_chauffeur, limit = 100 } = {}) {
    let l = state.avis.map((a) => { const c = find(state.chauffeurs, 'id_chauffeur', a.id_chauffeur); return { ...a, chauffeur_prenom: c?.prenom ?? null, id_compagnie: c?.id_compagnie ?? null }; });
    if (id_compagnie != null) l = l.filter((a) => a.id_compagnie === id_compagnie);
    if (id_chauffeur != null) l = l.filter((a) => a.id_chauffeur === id_chauffeur);
    return clone(l.sort((a, b) => b.id_avis - a.id_avis).slice(0, Math.min(Number(limit) || 100, 100000)));
  },
  async createTip(d) {
    const p = { id_pourboire: nextId('pourboires'), id_reservation: d.id_reservation, id_chauffeur: d.id_chauffeur, montant_fcfa: d.montant_fcfa, mode: d.mode, reference_transaction: d.reference_transaction ?? null, statut: d.statut || 'en_attente', date_pourboire: nowIso() };
    state.pourboires.push(p); save(); return clone(p);
  },
  async getTipByReference(ref) { return clone(state.pourboires.find((p) => p.reference_transaction === ref)); },
  async updateTip(id, patch) {
    const p = find(state.pourboires, 'id_pourboire', id); if (!p) return null;
    Object.assign(p, patchOf(patch, ['statut'])); save(); return clone(p);
  },
  async listTips({ id_compagnie, id_chauffeur, id_reservation } = {}) {
    let l = state.pourboires.map((p) => ({ ...p, id_compagnie: find(state.chauffeurs, 'id_chauffeur', p.id_chauffeur)?.id_compagnie ?? null }));
    if (id_compagnie != null) l = l.filter((p) => p.id_compagnie === id_compagnie);
    if (id_chauffeur != null) l = l.filter((p) => p.id_chauffeur === id_chauffeur);
    if (id_reservation != null) l = l.filter((p) => p.id_reservation === id_reservation);
    return clone(l.sort((a, b) => b.id_pourboire - a.id_pourboire));
  },

  // ---------- journal d'audit ----------
  async addAuditLog(d) {
    const e = { id_journal: nextId('journal'), date_evenement: nowIso(), id_utilisateur: d.id_utilisateur ?? null, utilisateur_nom: d.utilisateur_nom ?? null,
      id_compagnie: d.id_compagnie ?? null, action: d.action, entite: d.entite ?? null, id_entite: d.id_entite ?? null, details: d.details ?? null };
    state.journal.push(e);
    if (state.journal.length > 20000) state.journal.splice(0, state.journal.length - 20000);
    save(); return clone(e);
  },
  async listAuditLog({ id_compagnie, entite, id_entite, action, limit = 100 } = {}) {
    let l = state.journal;
    if (id_compagnie != null) l = l.filter((e) => e.id_compagnie === id_compagnie);
    if (entite) l = l.filter((e) => e.entite === entite);
    if (id_entite != null) l = l.filter((e) => e.id_entite === id_entite);
    if (action) l = l.filter((e) => e.action === action);
    return clone([...l].sort((a, b) => b.id_journal - a.id_journal).slice(0, Math.min(Number(limit) || 100, 100000)));
  },

  // ---------- statistiques ----------
  async getStats({ today, id_compagnie } = {}) {
    const hs = state.horaires.map(horaireView).filter((h) => id_compagnie == null || h.id_compagnie === id_compagnie);
    const futurs = hs.filter((h) => h.statut === 'programme' && h.date_depart >= today);
    const places = futurs.reduce((s, h) => s + h.nombre_places, 0);
    const occ = futurs.reduce((s, h) => s + h.places_occupees, 0);
    const ids = new Set(hs.map((h) => h.id_horaire));
    const resaJour = state.reservations.filter((r) => ids.has(r.id_horaire) && active(r) && r.date_reservation.slice(0, 10) === today).length;
    return {
      reservations_du_jour: resaJour,
      trajets_actifs: futurs.length,
      taux_remplissage: places ? Math.round((occ / places) * 100) : 0,
      utilisateurs: id_compagnie == null ? state.users.filter((u) => u.role === 'voyageur').length : null,
    };
  },
};
