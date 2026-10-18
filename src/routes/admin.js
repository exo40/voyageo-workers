'use strict';
const crypto = require('node:crypto');
const express = require('express');
const config = require('../config');
const db = require('../db');
const { AppError, asyncHandler } = require('../utils/errors');
const v = require('../utils/validate');
const { todayStr, addDays, departureTime } = require('../utils/time');
const { toCsv } = require('../utils/csv');
const { paginate } = require('../utils/paginate');
const { requireRole } = require('../middleware/auth');
const { publicUser } = require('../services/authService');
const { hashPassword } = require('../services/passwords');
const reservations = require('../services/reservationService');
const audit = require('../services/auditService');
const analytics = require('../services/analyticsService');
const subscription = require('../services/subscriptionService');
const companyPayments = require('../services/companyPaymentService');
const { enrichedPayments } = require('../services/paymentReport');
const uploads = require('../services/uploadService');

const router = express.Router();
router.use(requireRole('admin', 'gestionnaire'));
router.use((req, res, next) => {
  if (req.user.role === 'gestionnaire' && req.user.id_compagnie == null) return next(new AppError(403, "Ce compte gestionnaire n'est rattaché à aucune compagnie.", 'FORBIDDEN'));
  next();
});

// ============================================================
//  OUTILS
// ============================================================
const managerOnly = requireRole('gestionnaire');
/** Compagnie imposée pour un gestionnaire (null pour l'administrateur = accès à tout). TOUJOURS appliquée côté serveur. */
const scope = (req) => (req.user.role === 'gestionnaire' ? req.user.id_compagnie : null);
const id = (req) => v.reqInt(req.params.id, "L'identifiant", { min: 1 });
const notFound = (what = 'Élément') => new AppError(404, `${what} introuvable.`, 'NOT_FOUND');
const forbidden = () => new AppError(403, "Vous n'avez pas le droit de modifier cet élément.", 'FORBIDDEN');
const adminOnly = requireRole('admin');
const inScope = (req, companyId) => scope(req) == null || scope(req) === companyId;
/** Un gestionnaire ne voit jamais un élément d'une autre compagnie : on répond « introuvable » (on ne révèle pas son existence). */
const visible = (req, companyId, what) => { if (!inScope(req, companyId)) throw notFound(what); };
/** Filtre « compagnie » : imposé au gestionnaire, facultatif pour l'administrateur. */
const companyFilter = (req) => scope(req) ?? (req.query.id_compagnie ? v.reqInt(req.query.id_compagnie, 'La compagnie', { min: 1 }) : null);
const str = (x, label, max = 60) => (x ? v.reqStr(String(x), label, { max }) : undefined);
const dateQ = (x, label) => (x ? v.reqDate(x, label) : undefined);
const norm = v.normCity;
const who = (u) => `${u.prenom} ${u.nom}`;

/** Avec ?page ou ?limite : liste paginée. Sans : ancien comportement (liste tronquée) pour ne pas casser les clients existants. */
function listing(req, list, legacyMax) {
  if (req.query.page || req.query.limite) { const p = paginate(list, req.query); return { items: p.items, total: p.total, page: p.page, pages: p.pages, limite: p.limite }; }
  return { items: list.slice(0, legacyMax), total: list.length, page: 1, pages: 1, limite: legacyMax };
}
function sendCsv(res, name, columns, rows) {
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}-${todayStr()}.csv"`, 'Cache-Control': 'no-store' });
  res.send(toCsv(columns, rows));
}
async function companyIdFrom(req, value) {
  const cid = scope(req) ?? v.reqInt(value, 'La compagnie', { min: 1 });
  if (!(await db.getCompagnie(cid))) throw new AppError(400, "Cette compagnie n'existe pas.", 'VALIDATION');
  return cid;
}
const durationLabel = (m) => (m == null ? '' : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`);

// ---------- conflits d'horaires d'un bus ----------
const TURNAROUND_MIN = 30;   // temps minimal entre deux voyages du même bus (descente, nettoyage, plein)
const DEFAULT_TRIP_MIN = 240;
function tripWindow(date, depart, arrivee, durationMin) {
  const start = departureTime(date, depart);
  let end;
  if (arrivee) { end = departureTime(date, arrivee); if (end <= start) end += 86400000; }
  else end = start + (durationMin || DEFAULT_TRIP_MIN) * 60000;
  return [start, end + TURNAROUND_MIN * 60000];
}
async function assertBusFree({ id_bus, date_depart, heure_depart, heure_arrivee, duree }, currentId) {
  const [s, e] = tripWindow(date_depart, heure_depart, heure_arrivee, duree);
  const near = await db.listHoraires({ date_min: addDays(date_depart, -1), date_max: addDays(date_depart, 1) });
  for (const h of near) {
    if (h.id_bus !== id_bus || h.statut === 'annule' || h.id_horaire === currentId) continue;
    const [s2, e2] = tripWindow(h.date_depart, h.heure_depart, h.heure_arrivee, h.duree_estimee);
    if (s < e2 && s2 < e) throw new AppError(409, `Ce bus est déjà affecté au voyage ${h.ville_depart} – ${h.ville_arrivee} du ${h.date_depart} (${h.heure_depart}${h.heure_arrivee ? ` à ${h.heure_arrivee}` : ''}). Laissez au moins ${TURNAROUND_MIN} minutes entre deux voyages d'un même bus.`, 'CONFLICT');
  }
}

// ============================================================
//  ABONNEMENT (accessible même quand l'abonnement n'est pas payé : c'est la seule page d'un gestionnaire verrouillé)
// ============================================================
router.get('/abonnement', managerOnly, asyncHandler(async (req, res) => res.json(await subscription.status(req.user.id_compagnie))));
router.post('/abonnement/payer', managerOnly, asyncHandler(async (req, res) => {
  const out = await subscription.pay(req.user);
  res.json(out);
}));

/** VERROU : un gestionnaire dont l'abonnement n'est pas valide n'accède à AUCUNE autre route d'administration. */
router.use(asyncHandler(async (req, res, next) => {
  if (req.user.role !== 'gestionnaire') return next();
  const st = subscription.stateOf(await db.getCompagnie(req.user.id_compagnie));
  if (st.actif) return next();
  throw new AppError(402, st.etat === 'en_attente' ? "Votre abonnement n'est pas encore payé. Réglez-le pour accéder à votre espace." : 'Votre abonnement a expiré. Renouvelez-le pour retrouver votre espace.', 'SUBSCRIPTION_REQUIRED');
}));

// ============================================================
//  TABLEAU DE BORD, ACTIVITÉ, STATISTIQUES
// ============================================================
router.get('/stats', asyncHandler(async (req, res) => {
  res.json(await db.getStats({ today: todayStr(), id_compagnie: scope(req) }));
}));

router.get('/tableau-de-bord', asyncHandler(async (req, res) => {
  const jours = req.query.jours ? v.reqInt(req.query.jours, 'La période', { min: 1, max: 365 }) : 30;
  res.json(await analytics.dashboard({ id_compagnie: scope(req), jours }));
}));

router.get('/activite', asyncHandler(async (req, res) => {
  const entite = req.query.entite ? v.reqEnum(req.query.entite, "L'élément", ['reservation', 'paiement', 'horaire', 'bus', 'trajet', 'compagnie', 'utilisateur', 'export', 'chauffeur', 'avis', 'pourboire']) : undefined;
  const list = await db.listAuditLog({ id_compagnie: scope(req) ?? undefined, entite, limit: 2000 });
  const p = paginate(list, req.query, { defaultLimit: 30 });
  res.json({ evenements: p.items, total: p.total, page: p.page, pages: p.pages, limite: p.limite });
}));

// ============================================================
//  PAIEMENTS (par compagnie)
// ============================================================
const ETATS = ['confirme', 'simule', 'en_attente', 'a_verifier', 'echoue', 'a_rembourser', 'rembourse'];
async function filteredPayments(req) {
  const etat = req.query.etat ? v.reqEnum(req.query.etat, "L'état", ETATS) : undefined;
  const mode = req.query.mode ? v.reqEnum(req.query.mode, 'Le type', ['reel', 'simule']) : undefined;
  const q = str(req.query.q, 'La recherche');
  const dmin = dateQ(req.query.date_min, 'La date de début'), dmax = dateQ(req.query.date_max, 'La date de fin');
  const { rows } = await enrichedPayments({ id_compagnie: companyFilter(req) });
  const local = (iso) => todayStr(Date.parse(iso));
  return rows.filter((p) => (!etat || p.etat === etat) && (!mode || (mode === 'simule') === p.simule)
    && (!dmin || local(p.date_paiement) >= dmin) && (!dmax || local(p.date_paiement) <= dmax)
    && (!q || norm(`${p.numero_ticket} ${p.reference_transaction} ${p.utilisateur_nom} ${p.passager}`).includes(norm(q))));
}

/** Résumé par compagnie + liste détaillée. Les paiements simulés ne sont JAMAIS comptés comme argent encaissé. */
router.get('/paiements', asyncHandler(async (req, res) => {
  const sc = scope(req);
  const [all, companies] = await Promise.all([enrichedPayments({ id_compagnie: sc }), db.listCompagnies()]);
  const empty = () => ({ reussis: 0, montant_fcfa: 0, simules: 0, montant_simule_fcfa: 0, en_attente: 0, montant_en_attente_fcfa: 0, echoues: 0, a_rembourser: 0, montant_a_rembourser_fcfa: 0 });
  const rows = new Map(companies.filter((c) => sc == null || c.id_compagnie === sc).map((c) => [c.id_compagnie, { id_compagnie: c.id_compagnie, compagnie_nom: c.nom, ...empty() }]));
  const total = empty();
  for (const p of all.rows) {
    const row = rows.get(p.id_compagnie);
    if (!row) continue;
    for (const t of [row, total]) {
      if (p.statut === 'reussi' && !p.simule) { t.reussis += 1; t.montant_fcfa += p.montant_fcfa; }
      else if (p.statut === 'reussi') { t.simules += 1; t.montant_simule_fcfa += p.montant_fcfa; }
      else if (p.statut === 'en_attente') { t.en_attente += 1; t.montant_en_attente_fcfa += p.montant_fcfa; }
      else t.echoues += 1;
      if (p.etat === 'a_rembourser') { t.a_rembourser += 1; t.montant_a_rembourser_fcfa += p.montant_fcfa; }
    }
  }
  const page = listing(req, await filteredPayments(req), 200);
  res.json({
    resume: [...rows.values()].sort((a, b) => b.montant_fcfa - a.montant_fcfa || a.compagnie_nom.localeCompare(b.compagnie_nom, 'fr')),
    total, paiements: page.items, total_lignes: page.total, page: page.page, pages: page.pages, limite: page.limite,
  });
}));

/** Marque un remboursement comme EFFECTUÉ (le virement lui-même se fait chez le prestataire ou en espèces). Réservé à l'administrateur. */
router.post('/paiements/:id/rembourse', adminOnly, asyncHandler(async (req, res) => {
  const pid = id(req);
  const note = v.optStr((req.body || {}).note, 'La note', { max: 200 });
  const { rows } = await enrichedPayments({});
  const p = rows.find((x) => x.id_paiement === pid);
  if (!p) throw notFound('Paiement');
  if (p.etat !== 'a_rembourser') throw new AppError(409, p.etat === 'rembourse' ? 'Ce paiement est déjà marqué comme remboursé.' : "Ce paiement n'a pas de remboursement à traiter.", 'NOT_REFUNDABLE');
  await audit.log(req.user, 'paiement.rembourse', { entite: 'paiement', id_entite: pid, id_compagnie: p.id_compagnie, details: `Remboursement de ${p.montant_fcfa} FCFA effectué (ticket ${p.numero_ticket}, réf. ${p.reference_transaction}).${note ? ` Note : ${note}` : ''}` });
  res.json({ ok: true });
}));

// ============================================================
//  PHOTOS (bus, chauffeurs) : le navigateur envoie l'image redimensionnée, le serveur la contrôle et renvoie son adresse
// ============================================================
router.post('/upload', express.json({ limit: '3mb' }), asyncHandler(async (req, res) => {
  res.status(201).json({ url: await uploads.saveImage((req.body || {}).image) });
}));
/** Remplacement d'une photo : l'ancien fichier est supprimé. */
const dropOld = async (before, after) => { if (before && after !== undefined && after !== before) await uploads.removeImage(before); };

// ============================================================
//  COMPAGNIES
// ============================================================
function parseCompagnie(b) {
  return {
    nom: v.reqStr(b.nom, 'Le nom', { max: 120 }),
    telephone: v.optStr(b.telephone, 'Le téléphone', { max: 25 }),
    email: b.email ? v.reqEmail(b.email) : null,
    adresse: v.optStr(b.adresse, "L'adresse", { max: 255 }),
    statut: v.reqEnum(b.statut || 'active', 'Le statut', ['active', 'inactive']),
  };
}
async function assertCompanyNameFree(nom, currentId) {
  if ((await db.listCompagnies()).some((c) => norm(c.nom) === norm(nom) && c.id_compagnie !== currentId)) throw new AppError(409, 'Une compagnie porte déjà ce nom.', 'DUPLICATE');
}
/** Statistiques réelles par compagnie. */
async function companyStats(sc) {
  const today = todayStr();
  const [bus, trajets, horaires, pay] = await Promise.all([db.listBus({ id_compagnie: sc }), db.listTrajets({ id_compagnie: sc }), db.listHoraires({ id_compagnie: sc }), enrichedPayments({ id_compagnie: sc })]);
  const map = new Map();
  const get = (cid) => { if (!map.has(cid)) map.set(cid, { nb_bus: 0, nb_trajets: 0, voyages_a_venir: 0, voyages_total: 0, reservations_actives: 0, recettes_fcfa: 0 }); return map.get(cid); };
  for (const b of bus) get(b.id_compagnie).nb_bus += 1;
  for (const t of trajets) get(t.id_compagnie).nb_trajets += 1;
  for (const h of horaires) { const s = get(h.id_compagnie); s.voyages_total += 1; if (h.statut === 'programme' && h.date_depart >= today) s.voyages_a_venir += 1; if (h.statut !== 'annule') s.reservations_actives += h.places_occupees; }
  for (const p of pay.rows) if (p.statut === 'reussi' && !p.simule) get(p.id_compagnie).recettes_fcfa += p.montant_fcfa;
  return { get: (cid) => map.get(cid) || { nb_bus: 0, nb_trajets: 0, voyages_a_venir: 0, voyages_total: 0, reservations_actives: 0, recettes_fcfa: 0 } };
}
router.get('/compagnies', asyncHandler(async (req, res) => {
  const all = await db.listCompagnies();
  const mine = scope(req) == null ? all : all.filter((c) => c.id_compagnie === scope(req));
  const stats = await companyStats(scope(req));
  const out = await Promise.all(mine.map(async (c) => ({ ...c, ...stats.get(c.id_compagnie), abonnement: subscription.stateOf(c), paiement_configure: !!(await db.getCompanyPaymentSettings(c.id_compagnie)) })));
  res.json({ compagnies: out });
}));
router.get('/compagnies/:id', asyncHandler(async (req, res) => {
  const cid = id(req);
  const c = await db.getCompagnie(cid);
  if (!c) throw notFound('Compagnie');
  visible(req, cid, 'Compagnie');
  const today = todayStr();
  const [stats, bus, trajets, horaires, gestionnaires] = await Promise.all([companyStats(cid), db.listBus({ id_compagnie: cid }), db.listTrajets({ id_compagnie: cid }),
    db.listHoraires({ id_compagnie: cid, date_min: today }), scope(req) == null ? db.listUsers({ role: 'gestionnaire', id_compagnie: cid }) : Promise.resolve([])]);
  const abonnement = { ...subscription.stateOf(c), prix_fcfa: subscription.price(), historique: scope(req) == null ? (await db.listSubscriptionPayments({ id_compagnie: cid })).slice(0, 10) : undefined };
  res.json({ compagnie: { ...c, ...stats.get(cid), abonnement, paiement_configure: !!(await db.getCompanyPaymentSettings(cid)) }, bus, trajets, prochains_voyages: horaires.filter((h) => h.statut === 'programme').slice(0, 10), gestionnaires: gestionnaires.map(publicUser) });
}));
/** Actions de l'administrateur sur l'abonnement d'une agence : activer (paiement hors ligne), suspendre, dispenser. */
router.post('/compagnies/:id/abonnement', adminOnly, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const action = v.reqEnum(b.action, "L'action", ['activer', 'suspendre', 'dispenser']);
  const jours = action === 'activer' && b.jours ? v.reqInt(b.jours, 'La durée (jours)', { min: 1, max: 3650 }) : undefined;
  const out = await subscription.adminSet(req.user, id(req), { action, jours, note: v.optStr(b.note, 'La note', { max: 200 }) });
  res.json(out);
}));

// ---------- Clés FedaPay de la compagnie (gestionnaire uniquement ; l'argent des tickets va sur SON compte) ----------
router.get('/parametres-paiement', managerOnly, asyncHandler(async (req, res) => res.json(await companyPayments.view(req.user.id_compagnie))));
router.put('/parametres-paiement', managerOnly, asyncHandler(async (req, res) => res.json(await companyPayments.save(req.user, req.body || {}))));
router.post('/parametres-paiement/supprimer', managerOnly, asyncHandler(async (req, res) => res.json(await companyPayments.remove(req.user, req.body || {}))));

router.post('/compagnies', adminOnly, asyncHandler(async (req, res) => {
  const data = parseCompagnie(req.body || {});
  await assertCompanyNameFree(data.nom, null);
  const c = await db.createCompagnie(data);
  await audit.log(req.user, 'compagnie.creee', { entite: 'compagnie', id_entite: c.id_compagnie, id_compagnie: c.id_compagnie, details: `Compagnie « ${c.nom} » créée.` });
  res.status(201).json({ compagnie: c });
}));
router.put('/compagnies/:id', adminOnly, asyncHandler(async (req, res) => {
  const cid = id(req);
  const before = await db.getCompagnie(cid);
  if (!before) throw notFound('Compagnie');
  const data = parseCompagnie(req.body || {});
  await assertCompanyNameFree(data.nom, cid);
  const c = await db.updateCompagnie(cid, data);
  const changes = before.statut !== c.statut ? `Statut : ${before.statut} → ${c.statut}. ` : '';
  await audit.log(req.user, before.statut !== c.statut ? (c.statut === 'active' ? 'compagnie.activee' : 'compagnie.desactivee') : 'compagnie.modifiee', { entite: 'compagnie', id_entite: cid, id_compagnie: cid, details: `${changes}Compagnie « ${c.nom} ».` });
  res.json({ compagnie: c });
}));
router.delete('/compagnies/:id', adminOnly, asyncHandler(async (req, res) => {
  const cid = id(req);
  const c = await db.getCompagnie(cid);
  if (!c || !(await db.deleteCompagnie(cid))) throw notFound('Compagnie');
  await audit.log(req.user, 'compagnie.supprimee', { entite: 'compagnie', id_entite: cid, details: `Compagnie « ${c.nom} » supprimée.` });
  res.json({ ok: true });
}));

// ============================================================
//  BUS
// ============================================================
// La base MySQL n'accepte que ces trois types de bus (colonne ENUM).
const BUS_TYPES = ['Standard', 'Climatisé', 'Minibus'];
function busType(t) {
  const s = norm(String(t == null ? '' : t));
  if (!s) return 'Standard';
  if (s.startsWith('clim')) return 'Climatisé';
  if (s.startsWith('mini')) return 'Minibus';
  if (s === 'standard') return 'Standard';
  return String(t);
}
async function parseBus(req) {
  const b = req.body || {};
  return {
    id_compagnie: await companyIdFrom(req, b.id_compagnie),
    immatriculation: v.reqStr(b.immatriculation, "L'immatriculation", { max: 30 }).toUpperCase(),
    nombre_places: v.reqInt(b.nombre_places, 'Le nombre de places', { min: 1, max: 80 }),
    type: v.reqEnum(busType(b.type), 'Le type de bus', BUS_TYPES),
    ...(b.photo !== undefined ? { photo: v.optPhoto(b.photo, 'La photo du bus') } : {}),
  };
}
router.get('/bus', asyncHandler(async (req, res) => res.json({ bus: await db.listBus({ id_compagnie: companyFilter(req) }) })));
/** Fiche d'un bus : historique et prochaines affectations, avec l'occupation de chaque voyage. */
router.get('/bus/:id', asyncHandler(async (req, res) => {
  const bus = await db.getBus(id(req));
  if (!bus) throw notFound('Bus');
  visible(req, bus.id_compagnie, 'Bus');
  const today = todayStr();
  const voyages = (await db.listHoraires({ id_compagnie: bus.id_compagnie })).filter((h) => h.id_bus === bus.id_bus);
  const slim = (h) => ({ id_horaire: h.id_horaire, date_depart: h.date_depart, heure_depart: h.heure_depart, heure_arrivee: h.heure_arrivee, ville_depart: h.ville_depart, ville_arrivee: h.ville_arrivee, statut: h.statut, places_occupees: h.places_occupees, nombre_places: h.nombre_places, tarif_fcfa: h.tarif_fcfa });
  res.json({
    bus,
    prochains: voyages.filter((h) => h.date_depart >= today && h.statut !== 'annule').slice(0, 20).map(slim),
    historique: voyages.filter((h) => h.date_depart < today).slice(-20).reverse().map(slim),
    total_voyages: voyages.length,
  });
}));
router.post('/bus', asyncHandler(async (req, res) => {
  const b = await db.createBus(await parseBus(req));
  await audit.log(req.user, 'bus.cree', { entite: 'bus', id_entite: b.id_bus, id_compagnie: b.id_compagnie, details: `Bus ${b.immatriculation} (${b.nombre_places} places).` });
  res.status(201).json({ bus: b });
}));
router.put('/bus/:id', asyncHandler(async (req, res) => {
  const cur = await db.getBus(id(req));
  if (!cur) throw notFound('Bus');
  if (!inScope(req, cur.id_compagnie)) throw forbidden();
  const data = await parseBus(req);
  const occupied = (await db.listHoraires({ id_compagnie: cur.id_compagnie, date_min: todayStr() })).some((h) => h.id_bus === cur.id_bus && h.places_occupees > 0);
  if (occupied && (data.nombre_places < cur.nombre_places || data.id_compagnie !== cur.id_compagnie)) {
    throw new AppError(409, 'Impossible de réduire les places ou de changer de compagnie : des voyageurs ont déjà réservé sur ce bus.', 'IN_USE');
  }
  const b = await db.updateBus(cur.id_bus, data);
  await dropOld(cur.photo, data.photo);
  await audit.log(req.user, 'bus.modifie', { entite: 'bus', id_entite: b.id_bus, id_compagnie: b.id_compagnie, details: `Bus ${b.immatriculation} (${b.nombre_places} places).` });
  res.json({ bus: b });
}));
router.delete('/bus/:id', asyncHandler(async (req, res) => {
  const cur = await db.getBus(id(req));
  if (!cur) throw notFound('Bus');
  if (!inScope(req, cur.id_compagnie)) throw forbidden();
  await db.deleteBus(cur.id_bus);
  await uploads.removeImage(cur.photo);
  await audit.log(req.user, 'bus.supprime', { entite: 'bus', id_entite: cur.id_bus, id_compagnie: cur.id_compagnie, details: `Bus ${cur.immatriculation} supprimé.` });
  res.json({ ok: true });
}));

// ============================================================
//  TRAJETS
// ============================================================
async function parseTrajet(req) {
  const b = req.body || {};
  const data = {
    id_compagnie: await companyIdFrom(req, b.id_compagnie),
    ville_depart: v.reqStr(b.ville_depart, 'La ville de départ', { max: 80 }),
    ville_arrivee: v.reqStr(b.ville_arrivee, "La ville d'arrivée", { max: 80 }),
    lieu_embarquement: v.reqStr(b.lieu_embarquement, "Le lieu d'embarquement", { max: 160 }),
    lien_maps: v.optMapsUrl(b.lien_maps, 'Le lien Google Maps du lieu d\'embarquement'),
    duree_estimee: v.reqInt(b.duree_estimee, 'La durée estimée (en minutes)', { min: 5, max: 1440 }),   // obligatoire : la base en déduit l'heure d'arrivée
  };
  if (norm(data.ville_depart) === norm(data.ville_arrivee)) throw new AppError(400, 'Le départ et l\'arrivée doivent être différents.', 'VALIDATION');
  return data;
}
async function assertTrajetFree(data, currentId) {
  // Règle de la base : une compagnie n'a qu'UN trajet par paire de villes (clé unique ux_trajet_liaison). Pour une autre gare, modifiez le lieu d'embarquement du trajet existant.
  const dup = (await db.listTrajets({ id_compagnie: data.id_compagnie })).find((t) => t.id_trajet !== currentId && norm(t.ville_depart) === norm(data.ville_depart) && norm(t.ville_arrivee) === norm(data.ville_arrivee));
  if (dup) throw new AppError(409, 'Cette compagnie a déjà un trajet entre ces deux villes. Modifiez ce trajet (lieu d\'embarquement, durée) au lieu d\'en créer un second.', 'DUPLICATE');
}
router.get('/trajets', asyncHandler(async (req, res) => res.json({ trajets: await db.listTrajets({ id_compagnie: companyFilter(req) }) })));
router.post('/trajets', asyncHandler(async (req, res) => {
  const data = await parseTrajet(req);
  await assertTrajetFree(data, null);
  const t = await db.createTrajet(data);
  await audit.log(req.user, 'trajet.cree', { entite: 'trajet', id_entite: t.id_trajet, id_compagnie: t.id_compagnie, details: `Trajet ${t.ville_depart} – ${t.ville_arrivee}.` });
  res.status(201).json({ trajet: t });
}));
router.put('/trajets/:id', asyncHandler(async (req, res) => {
  const cur = await db.getTrajet(id(req));
  if (!cur) throw notFound('Trajet');
  if (!inScope(req, cur.id_compagnie)) throw forbidden();
  const data = await parseTrajet(req);
  await assertTrajetFree(data, cur.id_trajet);
  if (data.id_compagnie !== cur.id_compagnie && (await db.listHoraires({ id_trajet: cur.id_trajet })).length) throw new AppError(409, 'Impossible de changer de compagnie : ce trajet a déjà des voyages programmés.', 'IN_USE');
  const t = await db.updateTrajet(cur.id_trajet, data);
  await audit.log(req.user, 'trajet.modifie', { entite: 'trajet', id_entite: t.id_trajet, id_compagnie: t.id_compagnie, details: `Trajet ${t.ville_depart} – ${t.ville_arrivee}.` });
  res.json({ trajet: t });
}));
router.delete('/trajets/:id', asyncHandler(async (req, res) => {
  const cur = await db.getTrajet(id(req));
  if (!cur) throw notFound('Trajet');
  if (!inScope(req, cur.id_compagnie)) throw forbidden();
  await db.deleteTrajet(cur.id_trajet);
  await audit.log(req.user, 'trajet.supprime', { entite: 'trajet', id_entite: cur.id_trajet, id_compagnie: cur.id_compagnie, details: `Trajet ${cur.ville_depart} – ${cur.ville_arrivee} supprimé.` });
  res.json({ ok: true });
}));

// ============================================================
//  VOYAGES (horaires)
// ============================================================
async function parseHoraire(req, current) {
  const b = req.body || {};
  const trajet = await db.getTrajet(v.reqInt(b.id_trajet, 'Le trajet', { min: 1 }));
  const bus = await db.getBus(v.reqInt(b.id_bus, 'Le bus', { min: 1 }));
  if (!trajet || !bus) throw new AppError(400, 'Trajet ou bus introuvable.', 'VALIDATION');
  if (!inScope(req, trajet.id_compagnie)) throw forbidden();
  if (trajet.id_compagnie !== bus.id_compagnie) throw new AppError(400, 'Le bus et le trajet doivent appartenir à la même compagnie.', 'VALIDATION');
  const data = {
    id_trajet: trajet.id_trajet, id_bus: bus.id_bus,
    date_depart: v.reqDate(b.date_depart, 'La date de départ'),
    heure_depart: v.reqTime(b.heure_depart, "L'heure de départ"),
    heure_arrivee: b.heure_arrivee ? v.reqTime(b.heure_arrivee, "L'heure d'arrivée") : null,
    tarif_fcfa: v.reqInt(b.tarif_fcfa, 'Le tarif (FCFA)', { min: 100, max: 1000000 }),
    statut: v.reqEnum(b.statut || 'programme', 'Le statut', ['programme', 'annule', 'termine']),
  };
  if (b.id_chauffeur !== undefined) {
    if (b.id_chauffeur === '' || b.id_chauffeur === null) data.id_chauffeur = null;
    else {
      const ch = await db.getChauffeur(v.reqInt(b.id_chauffeur, 'Le chauffeur', { min: 1 }));
      if (!ch || ch.id_compagnie !== trajet.id_compagnie) throw new AppError(400, 'Ce chauffeur est introuvable ou appartient à une autre compagnie.', 'VALIDATION');
      data.id_chauffeur = ch.id_chauffeur;
    }
  }
  if (b.photo_bus !== undefined) data.photo_bus = v.optPhoto(b.photo_bus, 'La photo du bus');
  if (current && current.statut === 'annule' && data.statut === 'programme') throw new AppError(409, 'Un voyage annulé ne peut pas être réactivé (ses réservations ont été annulées). Créez un nouveau voyage.', 'ALREADY');
  // Conflit de bus : vérifié à la création, ou quand le bus, la date, l'heure ou le statut changent (on peut toujours corriger un tarif).
  const moved = !current || current.id_bus !== data.id_bus || current.date_depart !== data.date_depart || current.heure_depart !== data.heure_depart || (current.heure_arrivee || null) !== data.heure_arrivee || current.statut !== data.statut;
  if (data.statut === 'programme' && moved) await assertBusFree({ id_bus: data.id_bus, date_depart: data.date_depart, heure_depart: data.heure_depart, heure_arrivee: data.heure_arrivee, duree: trajet.duree_estimee }, current ? current.id_horaire : null);
  return data;
}
async function filteredHoraires(req) {
  const date_min = req.query.date_min ? v.reqDate(req.query.date_min, 'La date de début') : (req.query.tous ? undefined : todayStr());
  const date_max = dateQ(req.query.date_max, 'La date de fin');
  const id_trajet = req.query.id_trajet ? v.reqInt(req.query.id_trajet, 'Le trajet', { min: 1 }) : undefined;
  const statut = req.query.statut ? v.reqEnum(req.query.statut, 'Le statut', ['programme', 'annule', 'termine']) : undefined;
  const q = str(req.query.q, 'La recherche');
  let list = await db.listHoraires({ id_compagnie: companyFilter(req), date_min, date_max, id_trajet });
  if (statut) list = list.filter((h) => h.statut === statut);
  if (q) list = list.filter((h) => norm(`${h.ville_depart} ${h.ville_arrivee} ${h.immatriculation} ${h.compagnie_nom}`).includes(norm(q)));
  return list;
}
router.get('/horaires', asyncHandler(async (req, res) => {
  const page = listing(req, await filteredHoraires(req), 500);
  res.json({ horaires: page.items, total: page.total, page: page.page, pages: page.pages, limite: page.limite });
}));
/** Fiche d'un voyage : occupation (plan des places), liste des passagers et situation financière. */
router.get('/horaires/:id', asyncHandler(async (req, res) => {
  const h = await db.getHoraire(id(req));
  if (!h) throw notFound('Voyage');
  visible(req, h.id_compagnie, 'Voyage');
  const resas = (await db.listReservations({ id_horaire: h.id_horaire, limit: 1000 })).filter((r) => r.statut !== 'annulee').sort((a, b) => a.numero_place - b.numero_place);
  const { rows } = await enrichedPayments({ id_compagnie: h.id_compagnie });
  const tickets = new Set(resas.map((r) => r.numero_ticket));
  const encaisse = rows.filter((p) => tickets.has(p.numero_ticket) && p.statut === 'reussi' && !p.simule).reduce((s, p) => s + p.montant_fcfa, 0);
  res.json({
    horaire: h, taux_remplissage: h.nombre_places ? Math.round((h.places_occupees / h.nombre_places) * 100) : 0,
    places_occupees: resas.map((r) => ({ numero_place: r.numero_place, statut: r.statut })),
    passagers: resas.map(reservations.presentReservation), encaisse_fcfa: encaisse,
  });
}));
router.post('/horaires', asyncHandler(async (req, res) => {
  const h = await db.createHoraire(await parseHoraire(req, null));
  await audit.log(req.user, 'horaire.cree', { entite: 'horaire', id_entite: h.id_horaire, id_compagnie: h.id_compagnie, details: `Voyage ${h.ville_depart} – ${h.ville_arrivee} le ${h.date_depart} à ${h.heure_depart}, ${h.tarif_fcfa} FCFA, bus ${h.immatriculation}.` });
  res.status(201).json({ horaire: h });
}));
router.put('/horaires/:id', asyncHandler(async (req, res) => {
  const cur = await db.getHoraire(id(req));
  if (!cur) throw notFound('Voyage');
  if (!inScope(req, cur.id_compagnie)) throw forbidden();
  const data = await parseHoraire(req, cur);
  if (cur.places_occupees > 0 && (data.id_bus !== cur.id_bus || data.id_trajet !== cur.id_trajet)) {
    throw new AppError(409, 'Impossible de changer le bus ou le trajet : des places sont déjà réservées. Annulez le voyage ou créez-en un nouveau.', 'IN_USE');
  }
  // La base refuse d'annuler un voyage qui a encore des réservations actives : on annule donc les réservations D'ABORD, puis le voyage.
  let annulees = 0, remboursements = 0;
  if (data.statut === 'annule' && cur.statut !== 'annule') {
    for (const r of await db.listReservations({ id_horaire: cur.id_horaire, limit: 1000 })) {
      if (r.statut === 'annulee') continue;
      const pay = await db.getLatestPaymentByReservation(r.id_reservation);
      await db.cancelReservation(r.id_reservation);
      annulees++;
      if (pay && pay.statut === 'reussi' && !String(pay.mode).startsWith('simulation')) remboursements++;
    }
  }
  const updated = await db.updateHoraire(cur.id_horaire, data);
  await dropOld(cur.photo_bus, data.photo_bus);
  const changes = [cur.statut !== updated.statut ? `statut ${cur.statut} → ${updated.statut}` : null, cur.tarif_fcfa !== updated.tarif_fcfa ? `tarif ${cur.tarif_fcfa} → ${updated.tarif_fcfa} FCFA` : null,
    cur.date_depart !== updated.date_depart || cur.heure_depart !== updated.heure_depart ? `départ ${cur.date_depart} ${cur.heure_depart} → ${updated.date_depart} ${updated.heure_depart}` : null,
    annulees ? `${annulees} réservation(s) annulée(s), ${remboursements} remboursement(s) à traiter` : null].filter(Boolean).join(' ; ');
  await audit.log(req.user, updated.statut === 'annule' && cur.statut !== 'annule' ? 'horaire.annule' : 'horaire.modifie', { entite: 'horaire', id_entite: cur.id_horaire, id_compagnie: cur.id_compagnie, details: `Voyage ${updated.ville_depart} – ${updated.ville_arrivee}${changes ? ` : ${changes}` : ''}.` });
  res.json({ horaire: updated, reservations_annulees: annulees, remboursements_a_traiter: remboursements });
}));
router.delete('/horaires/:id', asyncHandler(async (req, res) => {
  const cur = await db.getHoraire(id(req));
  if (!cur) throw notFound('Voyage');
  if (!inScope(req, cur.id_compagnie)) throw forbidden();
  await db.deleteHoraire(cur.id_horaire);
  await uploads.removeImage(cur.photo_bus);
  await audit.log(req.user, 'horaire.supprime', { entite: 'horaire', id_entite: cur.id_horaire, id_compagnie: cur.id_compagnie, details: `Voyage ${cur.ville_depart} – ${cur.ville_arrivee} du ${cur.date_depart} à ${cur.heure_depart} supprimé.` });
  res.json({ ok: true });
}));

// ============================================================
//  CHAUFFEURS (prénom seul + photo) : affichés aux voyageurs, notés et récompensés après le voyage
// ============================================================
async function parseChauffeur(req) {
  const b = req.body || {};
  const prenom = v.reqStr(b.prenom, 'Le prénom du chauffeur', { max: 60 });
  if (!/^[\p{L}][\p{L}'’-]*$/u.test(prenom)) throw new AppError(400, 'Saisissez uniquement le prénom du chauffeur (sans nom de famille, sans espace).', 'VALIDATION');
  return { id_compagnie: await companyIdFrom(req, b.id_compagnie), prenom, ...(b.photo !== undefined ? { photo: v.optPhoto(b.photo, 'La photo du chauffeur') } : {}) };
}
router.get('/chauffeurs', asyncHandler(async (req, res) => {
  const cid = companyFilter(req);
  const [list, tips] = await Promise.all([db.listChauffeurs({ id_compagnie: cid }), db.listTips({ id_compagnie: cid })]);
  res.json({ chauffeurs: list.map((c) => ({ ...c, pourboires_fcfa: tips.filter((t) => t.id_chauffeur === c.id_chauffeur && t.statut === 'reussi').reduce((s, t) => s + t.montant_fcfa, 0) })) });
}));
/** Fiche : derniers avis (note et commentaire seulement, jamais l'identité du voyageur). */
router.get('/chauffeurs/:id', asyncHandler(async (req, res) => {
  const c = await db.getChauffeur(id(req));
  if (!c) throw notFound('Chauffeur');
  visible(req, c.id_compagnie, 'Chauffeur');
  const avis = (await db.listAvis({ id_chauffeur: c.id_chauffeur, limit: 20 })).map((a) => ({ note: a.note, commentaire: a.commentaire, date_avis: a.date_avis }));
  res.json({ chauffeur: c, avis });
}));
router.post('/chauffeurs', asyncHandler(async (req, res) => {
  const c = await db.createChauffeur(await parseChauffeur(req));
  await audit.log(req.user, 'chauffeur.cree', { entite: 'chauffeur', id_entite: c.id_chauffeur, id_compagnie: c.id_compagnie, details: `Chauffeur ${c.prenom} ajouté.` });
  res.status(201).json({ chauffeur: c });
}));
router.put('/chauffeurs/:id', asyncHandler(async (req, res) => {
  const cur = await db.getChauffeur(id(req));
  if (!cur) throw notFound('Chauffeur');
  if (!inScope(req, cur.id_compagnie)) throw forbidden();
  const data = await parseChauffeur(req);
  delete data.id_compagnie;
  const c = await db.updateChauffeur(cur.id_chauffeur, data);
  await dropOld(cur.photo, data.photo);
  await audit.log(req.user, 'chauffeur.modifie', { entite: 'chauffeur', id_entite: c.id_chauffeur, id_compagnie: c.id_compagnie, details: `Chauffeur ${c.prenom} modifié.` });
  res.json({ chauffeur: c });
}));
router.delete('/chauffeurs/:id', asyncHandler(async (req, res) => {
  const cur = await db.getChauffeur(id(req));
  if (!cur) throw notFound('Chauffeur');
  if (!inScope(req, cur.id_compagnie)) throw forbidden();
  await db.deleteChauffeur(cur.id_chauffeur);
  await uploads.removeImage(cur.photo);
  await audit.log(req.user, 'chauffeur.supprime', { entite: 'chauffeur', id_entite: cur.id_chauffeur, id_compagnie: cur.id_compagnie, details: `Chauffeur ${cur.prenom} supprimé.` });
  res.json({ ok: true });
}));

// ============================================================
//  RÉSERVATIONS
// ============================================================
async function filteredReservations(req) {
  const statut = req.query.statut ? v.reqEnum(req.query.statut, 'Le statut', ['en_attente', 'confirmee', 'annulee']) : undefined;
  const id_horaire = req.query.id_horaire ? v.reqInt(req.query.id_horaire, 'Le voyage', { min: 1 }) : undefined;
  const q = str(req.query.q, 'La recherche');
  const dmin = dateQ(req.query.date_min, 'La date de début'), dmax = dateQ(req.query.date_max, 'La date de fin');
  const dep = str(req.query.depart, 'La ville de départ', 80), arr = str(req.query.arrivee, "La ville d'arrivée", 80);
  let list = await db.listReservations({ id_compagnie: companyFilter(req), statut, id_horaire, q, limit: 100000 });
  if (dmin) list = list.filter((r) => r.date_depart >= dmin);
  if (dmax) list = list.filter((r) => r.date_depart <= dmax);
  if (dep) list = list.filter((r) => norm(r.ville_depart) === norm(dep));
  if (arr) list = list.filter((r) => norm(r.ville_arrivee) === norm(arr));
  return list;
}
router.get('/reservations', asyncHandler(async (req, res) => {
  const page = listing(req, await filteredReservations(req), 300);
  res.json({ reservations: page.items.map(reservations.presentReservation), total: page.total, page: page.page, pages: page.pages, limite: page.limite });
}));
/** Fiche détaillée : passager, voyage, montant, paiements et historique des événements. */
router.get('/reservations/:id', asyncHandler(async (req, res) => {
  const r = await db.getReservationById(id(req));
  if (!r) throw notFound('Réservation');
  visible(req, r.id_compagnie, 'Réservation');
  const pays = await db.listPaymentsByReservation(r.id_reservation);
  const { rows } = await enrichedPayments({ id_compagnie: r.id_compagnie });
  const etat = new Map(rows.map((p) => [p.id_paiement, p]));
  const events = [...await db.listAuditLog({ entite: 'reservation', id_entite: r.id_reservation, limit: 50 })];
  for (const p of pays) events.push(...await db.listAuditLog({ entite: 'paiement', id_entite: p.id_paiement, limit: 20 }));
  events.sort((a, b) => b.id_journal - a.id_journal);
  res.json({
    reservation: reservations.presentReservation(r), date_annulation: r.date_annulation ?? null,
    paiements: pays.map((p) => ({ id_paiement: p.id_paiement, montant_fcfa: p.montant_fcfa, mode: p.mode, reference_transaction: p.reference_transaction, statut: p.statut, date_paiement: p.date_paiement, etat: etat.get(p.id_paiement)?.etat ?? p.statut, simule: String(p.mode).startsWith('simulation') })),
    historique: events.slice(0, 50),
  });
}));
router.post('/reservations/:id/annuler', asyncHandler(async (req, res) => {
  const r = await db.getReservationById(id(req));
  if (!r) throw notFound('Réservation');
  if (!inScope(req, r.id_compagnie)) throw forbidden();
  if (r.statut === 'annulee') throw new AppError(409, 'Cette réservation est déjà annulée.', 'ALREADY');
  const pay = await db.getLatestPaymentByReservation(r.id_reservation);
  const out = await db.cancelReservation(r.id_reservation);
  const refund = !!(pay && pay.statut === 'reussi' && !String(pay.mode).startsWith('simulation'));
  await audit.log(req.user, 'reservation.annulee', { entite: 'reservation', id_entite: r.id_reservation, id_compagnie: r.id_compagnie, details: `Ticket ${r.numero_ticket} annulé par ${who(req.user)} (${req.user.role})${refund ? ' : remboursement à traiter' : ''}.` });
  res.json({ reservation: reservations.presentReservation(out), remboursement_a_traiter: refund });
}));

// ============================================================
//  UTILISATEURS (administrateur uniquement)
// ============================================================
const ROLES = ['voyageur', 'gestionnaire', 'admin'];
const isPrimaryAdmin = (u) => !!config.admin.email && u.email === config.admin.email;
async function otherActiveAdmins(exceptId) { return (await db.listUsers({ role: 'admin' })).filter((u) => u.statut === 'actif' && u.id_utilisateur !== exceptId).length; }

router.get('/utilisateurs', adminOnly, asyncHandler(async (req, res) => {
  const role = req.query.role ? v.reqEnum(req.query.role, 'Le rôle', ROLES) : undefined;
  const statut = req.query.statut ? v.reqEnum(req.query.statut, 'Le statut', ['actif', 'bloque']) : undefined;
  const q = str(req.query.q, 'La recherche');
  let list = await db.listUsers({ q, role });
  if (statut) list = list.filter((u) => u.statut === statut);
  const page = listing(req, list, 300);
  res.json({ utilisateurs: page.items.map(publicUser), total: page.total, page: page.page, pages: page.pages, limite: page.limite });
}));
router.get('/utilisateurs/:id', adminOnly, asyncHandler(async (req, res) => {
  const u = await db.findUserById(id(req));
  if (!u) throw notFound('Utilisateur');
  const resas = await db.listReservationsByUser(u.id_utilisateur);
  const compagnie = u.id_compagnie ? await db.getCompagnie(u.id_compagnie) : null;
  res.json({
    utilisateur: publicUser(u), compagnie_nom: compagnie ? compagnie.nom : null, principal: isPrimaryAdmin(u),
    reservations: { total: resas.length, confirmees: resas.filter((r) => r.statut === 'confirmee').length, annulees: resas.filter((r) => r.statut === 'annulee').length, recentes: resas.slice(0, 5).map(reservations.presentReservation) },
    historique: (await db.listAuditLog({ entite: 'utilisateur', id_entite: u.id_utilisateur, limit: 20 })),
  });
}));
router.post('/utilisateurs', adminOnly, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const role = v.reqEnum(b.role, 'Le rôle', ROLES);
  const email = v.reqEmail(b.email);
  if (await db.findUserByEmail(email)) throw new AppError(409, 'Cette adresse e-mail est déjà utilisée.', 'DUPLICATE_EMAIL');
  let id_compagnie = null;
  if (role === 'gestionnaire') {
    id_compagnie = v.reqInt(b.id_compagnie, 'La compagnie', { min: 1 });
    if (!(await db.getCompagnie(id_compagnie))) throw new AppError(400, "Cette compagnie n'existe pas.", 'VALIDATION');
  }
  const u = await db.createUser({
    nom: v.reqStr(b.nom, 'Le nom', { max: 100 }), prenom: v.reqStr(b.prenom, 'Le prénom', { max: 100 }), email,
    telephone: v.optStr(b.telephone, 'Le téléphone', { max: 25 }), mot_de_passe_hache: await hashPassword(v.reqPassword(b.mot_de_passe)),
    role, statut: 'actif', id_compagnie,
  });
  await audit.log(req.user, 'utilisateur.cree', { entite: 'utilisateur', id_entite: u.id_utilisateur, id_compagnie, details: `Compte ${role} créé : ${u.prenom} ${u.nom} (${u.email}).` });
  res.status(201).json({ utilisateur: publicUser(u) });
}));
router.put('/utilisateurs/:id', adminOnly, asyncHandler(async (req, res) => {
  const uid = id(req);
  const b = req.body || {};
  const cur = await db.findUserById(uid);
  if (!cur) throw notFound('Utilisateur');
  const patch = {};
  if (b.nom !== undefined) patch.nom = v.reqStr(b.nom, 'Le nom', { max: 100 });
  if (b.prenom !== undefined) patch.prenom = v.reqStr(b.prenom, 'Le prénom', { max: 100 });
  if (b.telephone !== undefined) patch.telephone = v.optStr(b.telephone, 'Le téléphone', { max: 25 });
  if (b.role !== undefined) patch.role = v.reqEnum(b.role, 'Le rôle', ROLES);
  if (b.statut !== undefined) patch.statut = v.reqEnum(b.statut, 'Le statut', ['actif', 'bloque']);
  const role = patch.role || cur.role;
  if (role === 'gestionnaire') {
    const cid = b.id_compagnie !== undefined && b.id_compagnie !== '' ? v.reqInt(b.id_compagnie, 'La compagnie', { min: 1 }) : cur.id_compagnie;
    if (cid == null || !(await db.getCompagnie(cid))) throw new AppError(400, 'Un gestionnaire doit être rattaché à une compagnie existante.', 'VALIDATION');
    patch.id_compagnie = cid;
  } else patch.id_compagnie = null;
  const demoting = cur.role === 'admin' && ((patch.role && patch.role !== 'admin') || (patch.statut && patch.statut !== 'actif'));
  if (uid === req.user.id_utilisateur && ((patch.statut && patch.statut !== 'actif') || (patch.role && patch.role !== 'admin'))) {
    throw new AppError(400, 'Vous ne pouvez pas bloquer ou rétrograder votre propre compte.', 'VALIDATION');
  }
  // Protection des comptes administrateurs
  if (demoting && isPrimaryAdmin(cur)) throw new AppError(403, "Le compte administrateur principal (défini dans le fichier .env) ne peut être ni bloqué ni rétrogradé.", 'PROTECTED');
  if (demoting && cur.statut === 'actif' && (await otherActiveAdmins(uid)) === 0) throw new AppError(409, 'Impossible : il doit rester au moins un administrateur actif.', 'LAST_ADMIN');
  if (b.mot_de_passe) {
    if (cur.role === 'admin' && uid !== req.user.id_utilisateur) throw new AppError(403, "Le mot de passe d'un autre administrateur ne peut pas être modifié ici. Il doit utiliser « Mot de passe oublié ».", 'PROTECTED');
    patch.mot_de_passe_hache = await hashPassword(v.reqPassword(b.mot_de_passe, 'Le nouveau mot de passe'));
  }
  const updated = await db.updateUser(uid, patch);
  const changes = [patch.role && patch.role !== cur.role ? `rôle ${cur.role} → ${patch.role}` : null, patch.statut && patch.statut !== cur.statut ? `statut ${cur.statut} → ${patch.statut}` : null,
    patch.id_compagnie !== undefined && patch.id_compagnie !== cur.id_compagnie ? 'compagnie modifiée' : null, patch.mot_de_passe_hache ? 'mot de passe modifié' : null].filter(Boolean).join(' ; ');
  await audit.log(req.user, patch.statut && patch.statut !== cur.statut ? (patch.statut === 'bloque' ? 'utilisateur.suspendu' : 'utilisateur.reactive') : 'utilisateur.modifie', { entite: 'utilisateur', id_entite: uid, details: `${cur.prenom} ${cur.nom} (${cur.email})${changes ? ` : ${changes}` : ''}.` });
  res.json({ utilisateur: publicUser(updated) });
}));
/**
 * SUPPRESSION DÉFINITIVE d'un compte (en plus de la suspension).
 *  - sans historique de réservation : le compte est supprimé de la base ;
 *  - avec historique : les données personnelles du compte (nom, e-mail, téléphone, mot de passe) sont effacées et le compte
 *    est rendu inutilisable ; les réservations passées restent pour la comptabilité des compagnies, sans lien avec une personne.
 * Refusé si le voyageur a encore un voyage à venir, pour ne pas laisser un passager sans ticket.
 */
router.delete('/utilisateurs/:id', adminOnly, asyncHandler(async (req, res) => {
  const uid = id(req);
  const cur = await db.findUserById(uid);
  if (!cur) throw notFound('Utilisateur');
  if (uid === req.user.id_utilisateur) throw new AppError(400, 'Vous ne pouvez pas supprimer votre propre compte.', 'VALIDATION');
  if (cur.role === 'admin') {
    if (isPrimaryAdmin(cur)) throw new AppError(403, 'Le compte administrateur principal (défini dans le fichier .env) ne peut pas être supprimé.', 'PROTECTED');
    if (cur.statut === 'actif' && (await otherActiveAdmins(uid)) === 0) throw new AppError(409, 'Impossible : il doit rester au moins un administrateur actif.', 'LAST_ADMIN');
  }
  const upcoming = (await db.listReservationsByUser(uid)).filter((r) => r.statut !== 'annulee' && departureTime(r.date_depart, r.heure_depart) > Date.now());
  if (upcoming.length) throw new AppError(409, `Ce compte a ${upcoming.length} réservation(s) à venir. Annulez-les d'abord, ou suspendez le compte.`, 'HAS_UPCOMING');
  let mode = 'supprime';
  try { await db.deleteUser(uid); }
  catch (e) {
    if (e.code !== 'IN_USE') throw e;
    mode = 'anonymise';
    await db.updateUser(uid, { nom: 'Utilisateur', prenom: 'Supprimé', email: `supprime-${uid}@voyageo.invalid`, telephone: null, mot_de_passe_hache: await hashPassword(crypto.randomBytes(24).toString('hex')),
      role: 'voyageur', id_compagnie: null, statut: 'bloque', consentement_date: null, consentement_version: null });
  }
  await audit.log(req.user, 'utilisateur.supprime', { entite: 'utilisateur', id_entite: uid, id_compagnie: cur.id_compagnie ?? null,
    details: `Compte ${cur.role} n° ${uid} ${mode === 'supprime' ? 'supprimé définitivement' : 'supprimé : données personnelles effacées, historique des réservations conservé sans nom'}.` });
  res.json({ ok: true, mode });
}));

/** Génère un mot de passe temporaire (affiché UNE seule fois à l'administrateur, jamais enregistré en clair ni écrit dans le journal). */
router.post('/utilisateurs/:id/reinitialiser-mot-de-passe', adminOnly, asyncHandler(async (req, res) => {
  const uid = id(req);
  const u = await db.findUserById(uid);
  if (!u) throw notFound('Utilisateur');
  if (u.role === 'admin') throw new AppError(403, "Le mot de passe d'un administrateur ne peut pas être réinitialisé par un autre. Utilisez « Mot de passe oublié » ou « Mon compte ».", 'PROTECTED');
  const temp = crypto.randomBytes(9).toString('base64url');
  await db.updateUser(uid, { mot_de_passe_hache: await hashPassword(temp) });
  await audit.log(req.user, 'utilisateur.mot_de_passe_reinitialise', { entite: 'utilisateur', id_entite: uid, details: `Mot de passe temporaire généré pour ${u.prenom} ${u.nom} (${u.email}).` });
  res.json({ mot_de_passe_temporaire: temp });
}));

// ============================================================
//  EXPORTS CSV (respectent le périmètre de l'utilisateur connecté)
// ============================================================
const frDate = (iso) => (iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Porto-Novo' }) : '');
router.get('/export/reservations.csv', asyncHandler(async (req, res) => {
  const list = await filteredReservations(req);
  await audit.log(req.user, 'export.reservations', { entite: 'export', id_compagnie: scope(req), details: `${list.length} réservation(s) exportée(s).` });
  sendCsv(res, 'reservations', [
    { l: 'Ticket', f: (r) => r.numero_ticket }, { l: 'Statut', f: (r) => r.statut }, { l: 'Date de réservation', f: (r) => frDate(r.date_reservation) },
    { l: 'Passager', f: (r) => `${r.prenom_passager} ${r.nom_passager}` }, { l: 'Téléphone', f: (r) => r.telephone_passager }, { l: 'Compagnie', f: (r) => r.compagnie_nom },
    { l: 'Départ', f: (r) => r.ville_depart }, { l: 'Arrivée', f: (r) => r.ville_arrivee }, { l: 'Date du voyage', f: (r) => r.date_depart }, { l: 'Heure', f: (r) => r.heure_depart },
    { l: 'Place', f: (r) => r.numero_place }, { l: 'Tarif (FCFA)', f: (r) => r.tarif_fcfa },
  ], list);
}));
router.get('/export/voyages.csv', asyncHandler(async (req, res) => {
  const list = await filteredHoraires(req);
  await audit.log(req.user, 'export.voyages', { entite: 'export', id_compagnie: scope(req), details: `${list.length} voyage(s) exporté(s).` });
  sendCsv(res, 'voyages', [
    { l: 'Date', f: (h) => h.date_depart }, { l: 'Heure de départ', f: (h) => h.heure_depart }, { l: "Heure d'arrivée", f: (h) => h.heure_arrivee }, { l: 'Compagnie', f: (h) => h.compagnie_nom },
    { l: 'Départ', f: (h) => h.ville_depart }, { l: 'Arrivée', f: (h) => h.ville_arrivee }, { l: 'Durée', f: (h) => durationLabel(h.duree_estimee) }, { l: 'Bus', f: (h) => h.immatriculation },
    { l: 'Places', f: (h) => h.nombre_places }, { l: 'Réservées', f: (h) => h.places_occupees }, { l: 'Remplissage (%)', f: (h) => (h.nombre_places ? Math.round((h.places_occupees / h.nombre_places) * 100) : 0) },
    { l: 'Tarif (FCFA)', f: (h) => h.tarif_fcfa }, { l: 'Statut', f: (h) => h.statut },
  ], list);
}));
router.get('/export/paiements.csv', asyncHandler(async (req, res) => {
  const list = await filteredPayments(req);
  await audit.log(req.user, 'export.paiements', { entite: 'export', id_compagnie: scope(req), details: `${list.length} paiement(s) exporté(s).` });
  sendCsv(res, 'paiements', [
    { l: 'Date', f: (p) => frDate(p.date_paiement) }, { l: 'Ticket', f: (p) => p.numero_ticket }, { l: 'Compagnie', f: (p) => p.compagnie_nom }, { l: 'Trajet', f: (p) => `${p.ville_depart} – ${p.ville_arrivee}` },
    { l: 'Client', f: (p) => p.utilisateur_nom }, { l: 'Mode', f: (p) => p.mode }, { l: 'Type', f: (p) => (p.simule ? 'Simulé' : 'Réel') }, { l: 'Référence', f: (p) => p.reference_transaction },
    { l: 'Montant (FCFA)', f: (p) => p.montant_fcfa }, { l: 'État', f: (p) => p.etat }, { l: 'Motif de remboursement', f: (p) => p.motif_remboursement },
  ], list);
}));

module.exports = router;
