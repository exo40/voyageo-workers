'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
/**
 * ADAPTATEUR MYSQL 8 : parle le schéma de PRODUCTION (database/voyageo_mysql_production.sql)
 * complété par database/voyageo_extensions_site.sql.
 *
 * Prérequis : npm install (mysql2) + les deux scripts SQL exécutés + DB_DRIVER=mysql dans .env.
 * MySQL 8.0.16 ou plus récent obligatoire (MariaDB / XAMPP non compatibles : le schéma utilise FOR SHARE OF...).
 * Testé sur MySQL 8.0.46 avec le compte à droits minimum de voyageo_compte_applicatif.sql.
 *
 * TRADUCTION entre le vocabulaire du site (contrat db) et celui de la base (le site et l'adaptateur JSON restent inchangés) :
 *   utilisateur.role         'admin'            <-> 'administrateur'
 *   compagnie.statut         'inactive'         <-> 'suspendue'
 *   paiement.statut          'en_attente'       <-> 'initie'   ('rembourse' n'existe que côté base)
 *   paiement.mode            'simulation (X)'   ->  mode de l'opérateur X ; au retour, la référence « SIM-... » restitue « simulation (X) »
 *   bus.type                 texte libre        <-> 'standard' | 'climatise' | 'minibus'
 *   reservation.tarif_fcfa   = prix_fcfa (prix convenu, figé à la réservation)
 *   horaire.heure_arrivee    facultative côté site ; la base exige date + heure d'arrivée : déduites de la durée du trajet
 * Les règles métier de la base (codes 50001 à 50033, voir l'en-tête du script de production) remontent en
 * DbError('RULE') avec le message en français de la base ; les autres cas « normaux » gardent les codes du contrat.
 */
const config = require('../../config');
const { DbError } = require('../errors');

let pool = null;
let mysqlModule = null;
let hyperdriveConfig = null;
const requestStorage = new AsyncLocalStorage();

function currentQueryExecutor() {
  const connection = requestStorage.getStore();
  const executor = connection || pool;
  if (!executor) throw new Error('La connexion MySQL n’est pas initialisée.');
  return executor;
}

function query(sql, params = []) {
  return currentQueryExecutor().query(sql, params);
}
const iso = (col) => `DATE_FORMAT(${col}, '%Y-%m-%dT%H:%i:%sZ')`;
const utcNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const toSqlDate = (v) => String(v).slice(0, 19).replace('T', ' ');

const isDup = (e) => e && e.code === 'ER_DUP_ENTRY';
const isFk = (e) => e && (e.code === 'ER_ROW_IS_REFERENCED_2' || e.code === 'ER_ROW_IS_REFERENCED');
const isRule = (e) => e && Number.isInteger(e.errno) && e.errno >= 50000 && e.errno < 60000;
const isDeadlock = (e) => e && e.errno === 1213;
const keyOf = (e) => String((e && e.sqlMessage) || '');

/** Règle métier de la base (SIGNAL) -> DbError('RULE'), message français de la base conservé. */
function asDbError(e) {
  if (isRule(e)) { const x = new DbError('RULE', e.sqlMessage || e.message); x.errno = e.errno; return x; }
  return e;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Interblocage détecté par InnoDB (1213) : la base a annulé l'opération, on la rejoue (comme le prévoit le script de production). */
async function retryDeadlock(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) { if (!isDeadlock(e) || i >= 4) throw e; await sleep(20 * (i + 1) + Math.random() * 30); }
  }
}

async function run(sql, params = []) {
  return retryDeadlock(async () => { try { const [rows] = await query(sql, params); return rows; } catch (e) { throw asDbError(e); } });
}
const q = run;
async function one(sql, params = []) { const rows = await run(sql, params); return rows[0] || null; }
async function insert(table, data) {
  const keys = Object.keys(data);
  const res = await run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map((k) => data[k]));
  return res.insertId;
}
async function update(table, idCol, id, patch, allowed) {
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (keys.length) await run(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE ${idCol}=?`, [...keys.map((k) => patch[k]), id]);
}
async function del(table, idCol, id) {
  try { const res = await run(`DELETE FROM ${table} WHERE ${idCol}=?`, [id]); return res.affectedRows > 0; }
  catch (e) { if (isFk(e)) throw new DbError('IN_USE'); throw e; }
}

// ---------- traductions site <-> base ----------
const ROLE_IN = { admin: 'administrateur' };
const roleIn = (r) => ROLE_IN[r] || r;
const roleOut = (col) => `IF(${col} = 'administrateur', 'admin', ${col})`;
const compStatutIn = (s) => (s === 'inactive' ? 'suspendue' : s);
const compStatutOut = (col) => `IF(${col} = 'suspendue', 'inactive', ${col})`;
const payStatutIn = (s) => (s === 'en_attente' ? 'initie' : s);
const payStatutOut = (col) => `IF(${col} = 'initie', 'en_attente', ${col})`;
const OPERATEURS = { 'mtn momo': 'mtn_momo', mtn: 'mtn_momo', 'moov money': 'moov_money', moov: 'moov_money', 'celtiis cash': 'celtiis_cash', celtiis: 'celtiis_cash' };
const PAY_MODES = ['mtn_momo', 'moov_money', 'celtiis_cash', 'especes', 'fedapay'];
function payModeIn(mode) {
  const m = String(mode || '').trim().toLowerCase();
  if (PAY_MODES.includes(m)) return m;
  const sim = /^simulation(?:\s*\((.*)\))?$/.exec(m);
  if (sim) return OPERATEURS[(sim[1] || '').trim()] || 'mtn_momo';
  throw new Error(`Mode de paiement non pris en charge par la base : "${mode}" (valeurs : ${PAY_MODES.join(', ')} ou simulation)`);
}
const payModeOut = (mode, ref) => `CASE WHEN ${ref} LIKE 'SIM-%' THEN CONCAT('simulation (', CASE ${mode} WHEN 'mtn_momo' THEN 'MTN MoMo' WHEN 'moov_money' THEN 'Moov Money' WHEN 'celtiis_cash' THEN 'Celtiis Cash' ELSE ${mode} END, ')') ELSE ${mode} END`;
const BUS_TYPES = { standard: 'standard', climatise: 'climatise', minibus: 'minibus' };
function busTypeIn(t) {
  const s = String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  if (!s) return 'standard';
  if (s.startsWith('clim')) return 'climatise';
  if (s.startsWith('mini')) return 'minibus';
  return BUS_TYPES[s] || 'standard';
}
const busTypeOut = (col) => `CASE ${col} WHEN 'climatise' THEN 'Climatisé' WHEN 'minibus' THEN 'Minibus' ELSE 'Standard' END`;

// ---------- heures d'arrivée ----------
const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const addDaysStr = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
/** La base exige date ET heure d'arrivée ; le site peut n'en donner aucune (déduite de la durée du trajet) ou seulement l'heure. */
function arrival({ date_depart, heure_depart, heure_arrivee, date_arrivee }, dureeMin) {
  const dep = String(heure_depart).slice(0, 5);
  if (heure_arrivee) {
    const arr = String(heure_arrivee).slice(0, 5);
    return { heure_arrivee: arr, date_arrivee: date_arrivee || (arr > dep ? date_depart : addDaysStr(date_depart, 1)) };   // arrivée <= départ : le lendemain
  }
  if (!dureeMin) throw new DbError('RULE', 'Heure d\'arrivée ou durée du trajet obligatoire.');
  const [h, m] = dep.split(':').map(Number);
  const total = h * 60 + m + Number(dureeMin);
  return { heure_arrivee: hhmm(total % 1440), date_arrivee: addDaysStr(date_depart, Math.floor(total / 1440)) };
}

// ---------- requêtes de lecture ----------
const COMP_COLS = `id_compagnie, nom, telephone, email, adresse, ${compStatutOut('statut')} AS statut, abonnement_statut, DATE_FORMAT(abonnement_expire_le, '%Y-%m-%d') AS abonnement_expire_le`;
const SUB_COLS = `id_abonnement, id_compagnie, montant_fcfa, mode, reference_transaction, statut, jours, DATE_FORMAT(expire_le, '%Y-%m-%d') AS expire_le, ${iso('date_paiement')} AS date_paiement`;
const USER_COLS = `id_utilisateur, nom, prenom, email, telephone, mot_de_passe_hache, ${roleOut('role')} AS role, statut, id_compagnie, ${iso('date_creation')} AS date_creation, ${iso('consentement_date')} AS consentement_date, consentement_version`;
const BUS_COLS = (a = 'b') => `${a}.id_bus, ${a}.id_compagnie, ${a}.immatriculation, ${a}.nombre_places, ${busTypeOut(`${a}.type`)} AS type, ${a}.photo`;
const TRAJET_COLS = 't.id_trajet, t.id_compagnie, t.ville_depart, t.ville_arrivee, t.duree_estimee, t.lieu_embarquement, t.lien_maps';
const PAY_COLS = (a = '') => { const p = a ? `${a}.` : ''; return `${p}id_paiement, ${p}id_reservation, ${p}montant_fcfa, ${payModeOut(`${p}mode`, `${p}reference_transaction`)} AS mode, ${p}reference_transaction, ${payStatutOut(`${p}statut`)} AS statut, ${iso(`${p}date_paiement`)} AS date_paiement`; };
const PAY_SQL = `SELECT ${PAY_COLS()} FROM paiement`;
const HORAIRE_SQL = `SELECT h.id_horaire, h.id_trajet, h.id_bus, DATE_FORMAT(h.date_depart,'%Y-%m-%d') AS date_depart,
  TIME_FORMAT(h.heure_depart,'%H:%i') AS heure_depart, TIME_FORMAT(h.heure_arrivee,'%H:%i') AS heure_arrivee, DATE_FORMAT(h.date_arrivee,'%Y-%m-%d') AS date_arrivee,
  h.tarif_fcfa, h.statut, h.photo_bus, h.id_chauffeur, b.photo AS bus_photo,
  ch.prenom AS chauffeur_prenom, ch.photo AS chauffeur_photo,
  (SELECT CAST(ROUND(AVG(a.note), 1) AS DOUBLE) FROM avis a WHERE a.id_chauffeur = h.id_chauffeur) AS chauffeur_note,
  (SELECT COUNT(*) FROM avis a WHERE a.id_chauffeur = h.id_chauffeur) AS chauffeur_nb_avis,
  t.ville_depart, t.ville_arrivee, t.duree_estimee, t.lieu_embarquement, t.lien_maps, t.id_compagnie, c.nom AS compagnie_nom, ${compStatutOut('c.statut')} AS compagnie_statut, c.abonnement_statut AS compagnie_abonnement_statut, DATE_FORMAT(c.abonnement_expire_le, '%Y-%m-%d') AS compagnie_abonnement_expire_le, EXISTS(SELECT 1 FROM compagnie_paiement cp WHERE cp.id_compagnie = c.id_compagnie) AS compagnie_paiement_configure, b.immatriculation, b.nombre_places,
  (SELECT COUNT(*) FROM reservation r WHERE r.id_horaire = h.id_horaire AND r.statut <> 'annulee') AS places_occupees
  FROM horaire h JOIN trajet t ON t.id_trajet = h.id_trajet JOIN bus b ON b.id_bus = h.id_bus JOIN compagnie c ON c.id_compagnie = t.id_compagnie LEFT JOIN chauffeur ch ON ch.id_chauffeur = h.id_chauffeur`;
const RESA_SQL = `SELECT r.id_reservation, r.numero_ticket, r.id_utilisateur, r.id_horaire, r.numero_place, r.nom_passager, r.prenom_passager,
  r.telephone_passager, r.piece_identite, r.statut, ${iso('r.date_reservation')} AS date_reservation, ${iso('r.date_annulation')} AS date_annulation,
  t.ville_depart, t.ville_arrivee, t.lieu_embarquement, t.lien_maps, DATE_FORMAT(h.date_depart,'%Y-%m-%d') AS date_depart, TIME_FORMAT(h.heure_depart,'%H:%i') AS heure_depart,
  TIME_FORMAT(h.heure_arrivee,'%H:%i') AS heure_arrivee, DATE_FORMAT(h.date_arrivee,'%Y-%m-%d') AS date_arrivee,
  r.prix_fcfa AS tarif_fcfa, h.statut AS statut_horaire, t.id_compagnie, c.nom AS compagnie_nom,
  h.photo_bus, b.photo AS bus_photo, h.id_chauffeur, ch.prenom AS chauffeur_prenom, ch.photo AS chauffeur_photo,
  (SELECT CAST(ROUND(AVG(a.note), 1) AS DOUBLE) FROM avis a WHERE a.id_chauffeur = h.id_chauffeur) AS chauffeur_note,
  (SELECT COUNT(*) FROM avis a WHERE a.id_chauffeur = h.id_chauffeur) AS chauffeur_nb_avis,
  u.email AS utilisateur_email, CONCAT(u.prenom, ' ', u.nom) AS utilisateur_nom
  FROM reservation r JOIN horaire h ON h.id_horaire = r.id_horaire JOIN trajet t ON t.id_trajet = h.id_trajet
  JOIN bus b ON b.id_bus = h.id_bus LEFT JOIN chauffeur ch ON ch.id_chauffeur = h.id_chauffeur
  JOIN compagnie c ON c.id_compagnie = t.id_compagnie JOIN utilisateur u ON u.id_utilisateur = r.id_utilisateur`;
const AVIS_COLS = `id_avis, id_reservation, id_horaire, id_chauffeur, id_utilisateur, note, commentaire, ${iso('date_avis')} AS date_avis`;
const TIP_COLS = `id_pourboire, id_reservation, id_chauffeur, montant_fcfa, mode, reference_transaction, statut, ${iso('date_pourboire')} AS date_pourboire`;

/** Tables que le site attend (script de production + complément). */
const REQUIRED_TABLES = ['compagnie', 'utilisateur', 'bus', 'trajet', 'horaire', 'bus_occupation', 'reservation', 'paiement', 'remboursement',
  'chauffeur', 'avis', 'pourboire', 'journal_audit', 'compagnie_paiement', 'abonnement_paiement'];

module.exports = {
  async withRequest(fn) {
    if (!hyperdriveConfig) return fn();

    const connection = await mysqlModule.createConnection(hyperdriveConfig);
    return requestStorage.run(connection, async () => {
      try {
        return await fn();
      } finally {
        await connection.end();
      }
    });
  },

  async init(hyperdrive = null) {
    mysqlModule = require('mysql2/promise');
    const c = config.db.mysql;

    const connectionConfig = hyperdrive
      ? {
          host: hyperdrive.host,
          port: hyperdrive.port,
          user: hyperdrive.user,
          password: hyperdrive.password,
          database: hyperdrive.database,
        }
      : {
          host: c.host,
          port: c.port,
          user: c.user,
          password: c.password,
          database: c.database,
        };

    const driverOptions = {
      ...connectionConfig,
      charset: 'utf8mb4',
      timezone: 'Z',
      dateStrings: true,
      disableEval: true,
    };

    hyperdriveConfig = hyperdrive ? driverOptions : null;

    if (!hyperdrive) {
      pool = mysqlModule.createPool({
        ...driverOptions,
        connectionLimit: c.connectionLimit,
        waitForConnections: true,
      });

      pool.pool.on('connection', (conn) => {
        conn.query("SET time_zone = '+00:00'");
      });
    }

    // Validation avec une connexion temporaire sur Cloudflare.
    // Le pool local reste disponible pour le développement.
    const validationConnection = hyperdrive
      ? await mysqlModule.createConnection(driverOptions)
      : null;
    const executor = validationConnection || pool;

    try {
      const [[v]] = await executor.query('SELECT VERSION() AS version');
      const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.version);

      if (
        /mariadb/i.test(v.version) ||
        !m ||
        Number(m[1]) < 8 ||
        (Number(m[1]) === 8 &&
          Number(m[2]) === 0 &&
          Number(m[3]) < 16)
      ) {
        throw new Error(
          `MySQL 8.0.16 ou plus récent est obligatoire (serveur détecté : ${v.version}).`
        );
      }

      const [rows] = await executor.query(
        'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()'
      );
      const have = new Set(rows.map((r) => String(r.t).toLowerCase()));
      const missing = REQUIRED_TABLES.filter((t) => !have.has(t));

      if (missing.length) {
        throw new Error(
          `Tables absentes de la base « ${c.database} » : ${missing.join(', ')}.`
        );
      }
    } finally {
      if (validationConnection) await validationConnection.end();
    }
  },
  async close() {
    if (pool) await pool.end();
    pool = null;
    hyperdriveConfig = null;
    mysqlModule = null;
  },
  async ping() { await query('SELECT 1'); return true; },

  // ----- sessions persistantes pour express-session -----
  async getSession(sid) {
    const row = await one(
      'SELECT data, expires FROM voyageo_sessions WHERE session_id = ?',
      [sid]
    );
    if (!row) return null;
    if (Number(row.expires) <= Date.now()) {
      await query(
        'DELETE FROM voyageo_sessions WHERE session_id = ?',
        [sid]
      );
      return null;
    }
    try {
      return JSON.parse(row.data);
    } catch {
      await query(
        'DELETE FROM voyageo_sessions WHERE session_id = ?',
        [sid]
      );
      return null;
    }
  },
  async setSession(sid, data, expires) {
    await query(
      `INSERT INTO voyageo_sessions (session_id, expires, data)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE expires = VALUES(expires), data = VALUES(data)`,
      [sid, expires, JSON.stringify(data)]
    );
  },
  async deleteSession(sid) {
    await query(
      'DELETE FROM voyageo_sessions WHERE session_id = ?',
      [sid]
    );
  },
  async touchSession(sid, expires) {
    await query(
      'UPDATE voyageo_sessions SET expires = ? WHERE session_id = ?',
      [expires, sid]
    );
  },


  // ----- utilisateurs -----
  async findUserByEmail(email) { return one(`SELECT ${USER_COLS} FROM utilisateur WHERE email = ?`, [email]); },
  async findUserById(id) { return one(`SELECT ${USER_COLS} FROM utilisateur WHERE id_utilisateur = ?`, [id]); },
  async createUser(d) {
    try {
      const id = await insert('utilisateur', { nom: d.nom, prenom: d.prenom, email: d.email, telephone: d.telephone ?? null, mot_de_passe_hache: d.mot_de_passe_hache,
        role: roleIn(d.role || 'voyageur'), statut: d.statut || 'actif', id_compagnie: d.id_compagnie ?? null, date_creation: utcNow(),
        consentement_date: d.consentement_date ? toSqlDate(d.consentement_date) : null, consentement_version: d.consentement_version ?? null });
      return this.findUserById(id);
    } catch (e) { if (isDup(e)) throw new DbError('DUPLICATE_EMAIL'); throw e; }
  },
  async updateUser(id, patch) {
    const p = { ...patch };
    if (p.role) p.role = roleIn(p.role);
    if (p.consentement_date) p.consentement_date = toSqlDate(p.consentement_date);
    try { await update('utilisateur', 'id_utilisateur', id, p, ['nom', 'prenom', 'email', 'telephone', 'mot_de_passe_hache', 'role', 'statut', 'id_compagnie', 'consentement_date', 'consentement_version']); }
    catch (e) { if (isDup(e)) throw new DbError('DUPLICATE_EMAIL'); throw e; }
    return this.findUserById(id);
  },
  /** Supprime définitivement le compte. IN_USE (clé étrangère) si des réservations ou avis lui sont rattachés : on les anonymise alors côté service. */
  async deleteUser(id) { return del('utilisateur', 'id_utilisateur', id); },
  async listUsers({ q: search, role, id_compagnie } = {}) {
    const w = [], p = [];
    if (role) { w.push('role = ?'); p.push(roleIn(role)); }
    if (id_compagnie != null) { w.push('id_compagnie = ?'); p.push(id_compagnie); }
    if (search) { w.push("CONCAT_WS(' ', prenom, nom, email, telephone) LIKE ?"); p.push(`%${search}%`); }
    return q(`SELECT ${USER_COLS} FROM utilisateur ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY id_utilisateur DESC`, p);
  },

  // ----- compagnies -----
  async listCompagnies() { return q(`SELECT ${COMP_COLS} FROM compagnie ORDER BY nom`); },
  async getCompagnie(id) { return one(`SELECT ${COMP_COLS} FROM compagnie WHERE id_compagnie = ?`, [id]); },
  async createCompagnie(d) {
    const id = await insert('compagnie', { nom: d.nom, telephone: d.telephone ?? null, email: d.email ?? null, adresse: d.adresse ?? null, statut: compStatutIn(d.statut || 'active'), abonnement_statut: d.abonnement_statut || 'non_requis', abonnement_expire_le: d.abonnement_expire_le ?? null });
    return this.getCompagnie(id);
  },
  async updateCompagnie(id, patch) {
    const p = { ...patch };
    if (p.statut) p.statut = compStatutIn(p.statut);
    await update('compagnie', 'id_compagnie', id, p, ['nom', 'telephone', 'email', 'adresse', 'statut', 'abonnement_statut', 'abonnement_expire_le']);
    return this.getCompagnie(id);
  },
  async deleteCompagnie(id) { return del('compagnie', 'id_compagnie', id); },

  // ----- bus -----
  async listBus({ id_compagnie } = {}) {
    return q(`SELECT ${BUS_COLS()}, c.nom AS compagnie_nom FROM bus b JOIN compagnie c ON c.id_compagnie = b.id_compagnie ${id_compagnie != null ? 'WHERE b.id_compagnie = ?' : ''} ORDER BY b.id_bus`, id_compagnie != null ? [id_compagnie] : []);
  },
  async getBus(id) { return one(`SELECT ${BUS_COLS()}, c.nom AS compagnie_nom FROM bus b JOIN compagnie c ON c.id_compagnie = b.id_compagnie WHERE b.id_bus = ?`, [id]); },
  async createBus(d) {
    try { const id = await insert('bus', { id_compagnie: d.id_compagnie, immatriculation: d.immatriculation, nombre_places: d.nombre_places, type: busTypeIn(d.type), photo: d.photo ?? null }); return this.getBus(id); }
    catch (e) { if (isDup(e)) throw new DbError('DUPLICATE_PLATE', 'Immatriculation déjà utilisée'); throw e; }
  },
  async updateBus(id, patch) {
    const p = { ...patch };
    if ('type' in p) p.type = busTypeIn(p.type);
    try { await update('bus', 'id_bus', id, p, ['id_compagnie', 'immatriculation', 'nombre_places', 'type', 'photo']); }
    catch (e) { if (isDup(e)) throw new DbError('DUPLICATE_PLATE', 'Immatriculation déjà utilisée'); throw e; }
    return this.getBus(id);
  },
  async deleteBus(id) { return del('bus', 'id_bus', id); },

  // ----- trajets -----
  async listTrajets({ id_compagnie } = {}) {
    return q(`SELECT ${TRAJET_COLS}, c.nom AS compagnie_nom FROM trajet t JOIN compagnie c ON c.id_compagnie = t.id_compagnie ${id_compagnie != null ? 'WHERE t.id_compagnie = ?' : ''} ORDER BY t.id_trajet`, id_compagnie != null ? [id_compagnie] : []);
  },
  async getTrajet(id) { return one(`SELECT ${TRAJET_COLS}, c.nom AS compagnie_nom FROM trajet t JOIN compagnie c ON c.id_compagnie = t.id_compagnie WHERE t.id_trajet = ?`, [id]); },
  async createTrajet(d) {
    try { const id = await insert('trajet', { id_compagnie: d.id_compagnie, ville_depart: d.ville_depart, ville_arrivee: d.ville_arrivee, duree_estimee: d.duree_estimee ?? null, lieu_embarquement: d.lieu_embarquement ?? null, lien_maps: d.lien_maps ?? null }); return this.getTrajet(id); }
    catch (e) { if (isDup(e)) throw new DbError('DUPLICATE_TRAJET', 'Cette compagnie a déjà un trajet entre ces deux villes'); throw e; }
  },
  async updateTrajet(id, patch) {
    try { await update('trajet', 'id_trajet', id, patch, ['id_compagnie', 'ville_depart', 'ville_arrivee', 'duree_estimee', 'lieu_embarquement', 'lien_maps']); }
    catch (e) { if (isDup(e)) throw new DbError('DUPLICATE_TRAJET', 'Cette compagnie a déjà un trajet entre ces deux villes'); throw e; }
    return this.getTrajet(id);
  },
  async deleteTrajet(id) { return del('trajet', 'id_trajet', id); },

  // ----- horaires -----
  // Comparaison des villes insensible à la casse et aux accents : collation utf8mb4_unicode_ci.
  async searchHoraires({ ville_depart, ville_arrivee, date }) {
    return q(`${HORAIRE_SQL} WHERE h.date_depart = ? AND h.statut = 'programme' AND t.ville_depart = ? AND t.ville_arrivee = ? ORDER BY h.heure_depart`, [date, ville_depart, ville_arrivee]);
  },
  async listHoraires({ id_compagnie, date_min, date_max, id_trajet } = {}) {
    const w = [], p = [];
    if (id_compagnie != null) { w.push('t.id_compagnie = ?'); p.push(id_compagnie); }
    if (id_trajet != null) { w.push('h.id_trajet = ?'); p.push(id_trajet); }
    if (date_min) { w.push('h.date_depart >= ?'); p.push(date_min); }
    if (date_max) { w.push('h.date_depart <= ?'); p.push(date_max); }
    return q(`${HORAIRE_SQL} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY h.date_depart, h.heure_depart`, p);
  },
  async getHoraire(id) { return one(`${HORAIRE_SQL} WHERE h.id_horaire = ?`, [id]); },
  async createHoraire(d) {
    const tr = await one('SELECT duree_estimee FROM trajet WHERE id_trajet = ?', [d.id_trajet]);
    const arr = arrival(d, tr && tr.duree_estimee);
    const id = await insert('horaire', { id_trajet: d.id_trajet, id_bus: d.id_bus, date_depart: d.date_depart, heure_depart: d.heure_depart, date_arrivee: arr.date_arrivee, heure_arrivee: arr.heure_arrivee,
      tarif_fcfa: d.tarif_fcfa, statut: d.statut || 'programme', id_chauffeur: d.id_chauffeur ?? null, photo_bus: d.photo_bus ?? null });
    return this.getHoraire(id);
  },
  async updateHoraire(id, patch) {
    const cur = await one(`SELECT id_trajet, DATE_FORMAT(date_depart,'%Y-%m-%d') AS date_depart, TIME_FORMAT(heure_depart,'%H:%i') AS heure_depart, TIME_FORMAT(heure_arrivee,'%H:%i') AS heure_arrivee FROM horaire WHERE id_horaire = ?`, [id]);
    if (!cur) return null;
    const p = { ...patch };
    // date et heure d'arrivée sont recalculées dès que le départ ou l'arrivée change
    if (['date_depart', 'heure_depart', 'heure_arrivee', 'id_trajet'].some((k) => k in p)) {
      const m = { ...cur, ...p };
      if ('heure_arrivee' in p && !p.heure_arrivee) m.heure_arrivee = null;
      const tr = await one('SELECT duree_estimee FROM trajet WHERE id_trajet = ?', [m.id_trajet]);
      const arr = arrival({ date_depart: m.date_depart, heure_depart: m.heure_depart, heure_arrivee: m.heure_arrivee }, tr && tr.duree_estimee);
      p.date_arrivee = arr.date_arrivee; p.heure_arrivee = arr.heure_arrivee;
    }
    await update('horaire', 'id_horaire', id, p, ['id_trajet', 'id_bus', 'date_depart', 'heure_depart', 'date_arrivee', 'heure_arrivee', 'tarif_fcfa', 'statut', 'id_chauffeur', 'photo_bus']);
    return this.getHoraire(id);
  },
  async deleteHoraire(id) { return del('horaire', 'id_horaire', id); },
  async getOccupiedSeats(id_horaire) {
    const rows = await q("SELECT numero_place FROM reservation WHERE id_horaire = ? AND statut <> 'annulee' ORDER BY numero_place", [id_horaire]);
    return rows.map((r) => r.numero_place);
  },

  // ----- réservations -----
  /**
   * ATOMIQUE : transaction + verrou du voyage + clé unique (id_horaire, numero_place_active).
   * Les triggers de la base contrôlent en plus : voyageur actif, voyage programmé et non parti, compagnie active, capacité du bus.
   * Le prix convenu est figé à la valeur du tarif au moment de la réservation.
   */
  async createReservation(d) {
    return retryDeadlock(async () => {
      const requestConn = requestStorage.getStore();
      const conn = requestConn || await pool.getConnection();
      try {
        await conn.beginTransaction();
        const [h] = await conn.query('SELECT tarif_fcfa FROM horaire WHERE id_horaire = ? FOR UPDATE', [d.id_horaire]);
        if (!h.length) throw new Error('Horaire introuvable');
        const statut = d.statut || 'confirmee';
        let id;
        try {
          const [res] = await conn.query(
            `INSERT INTO reservation (numero_ticket, id_utilisateur, id_horaire, numero_place, nom_passager, prenom_passager,
              telephone_passager, piece_identite, prix_fcfa, statut, date_reservation) VALUES (?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP())`,
            [d.numero_ticket, d.id_utilisateur, d.id_horaire, d.numero_place, d.nom_passager,
              d.prenom_passager, d.telephone_passager, d.piece_identite ?? null, h[0].tarif_fcfa, statut]);
          id = res.insertId;
        } catch (e) {
          if (isDup(e)) throw new DbError(/ticket/i.test(keyOf(e)) ? 'DUPLICATE_TICKET' : 'SEAT_TAKEN');
          throw asDbError(e);
        }
        await conn.commit();
        return this.getReservationById(id);
      } catch (e) { try { await conn.rollback(); } catch { /* connexion déjà fermée */ } throw e; } finally { if (!requestConn) conn.release(); }
    });
  },
  async getReservationByTicket(numero) { return one(`${RESA_SQL} WHERE r.numero_ticket = ?`, [numero]); },
  async getReservationById(id) { return one(`${RESA_SQL} WHERE r.id_reservation = ?`, [id]); },
  async listReservationsByUser(id) { return q(`${RESA_SQL} WHERE r.id_utilisateur = ? ORDER BY h.date_depart DESC, h.heure_depart DESC`, [id]); },
  async listReservations({ id_compagnie, statut, q: search, id_horaire, limit = 200 } = {}) {
    const w = [], p = [];
    if (id_compagnie != null) { w.push('t.id_compagnie = ?'); p.push(id_compagnie); }
    if (statut) { w.push('r.statut = ?'); p.push(statut); }
    if (id_horaire != null) { w.push('r.id_horaire = ?'); p.push(id_horaire); }
    if (search) { w.push("CONCAT_WS(' ', r.numero_ticket, r.prenom_passager, r.nom_passager, r.telephone_passager) LIKE ?"); p.push(`%${search}%`); }
    return q(`${RESA_SQL} ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY r.date_reservation DESC, r.id_reservation DESC LIMIT ?`, [...p, Math.min(Number(limit) || 200, 100000)]);
  },
  /** date_annulation et place_active sont gérées par la base (trigger et colonne calculée) : on ne change que le statut. */
  async setStatus(id, statut) {
    try { await run('UPDATE reservation SET statut = ? WHERE id_reservation = ?', [statut, id]); }
    catch (e) { if (isDup(e)) throw new DbError('SEAT_TAKEN'); throw e; }
    return this.getReservationById(id);
  },
  async cancelReservation(id) { return this.setStatus(id, 'annulee'); },
  async updateReservationStatus(id, statut) { return this.setStatus(id, statut); },
  async expirePendingReservations(cutoffIso) {
    const res = await run("UPDATE reservation SET statut = 'annulee' WHERE statut = 'en_attente' AND date_reservation < ?", [toSqlDate(cutoffIso)]);
    return res.affectedRows;
  },

  // ----- paiements -----
  // Règles de la base : montant = prix convenu de la réservation ; au plus UN paiement « reussi » par réservation
  // (DbError DUPLICATE_PAYMENT) ; référence obligatoire pour réussir (sauf espèces) ; mode et référence figés une fois le paiement terminé.
  async createPayment(d) {
    try {
      const id = await insert('paiement', { id_reservation: d.id_reservation, montant_fcfa: d.montant_fcfa, mode: payModeIn(d.mode), reference_transaction: d.reference_transaction ?? null,
        statut: payStatutIn(d.statut || 'en_attente'), date_paiement: utcNow() });
      return one(`${PAY_SQL} WHERE id_paiement = ?`, [id]);
    } catch (e) { if (isDup(e)) throw new DbError('DUPLICATE_PAYMENT'); throw e; }
  },
  async getPaymentByReference(ref) { return one(`${PAY_SQL} WHERE reference_transaction = ? ORDER BY id_paiement DESC LIMIT 1`, [ref]); },
  async getLatestPaymentByReservation(id) { return one(`${PAY_SQL} WHERE id_reservation = ? ORDER BY id_paiement DESC LIMIT 1`, [id]); },
  async listPayments({ id_compagnie } = {}) {
    return q(`SELECT ${PAY_COLS('p')}, r.numero_ticket, t.id_compagnie, c.nom AS compagnie_nom, t.ville_depart, t.ville_arrivee, CONCAT(u.prenom, ' ', u.nom) AS utilisateur_nom
      FROM paiement p JOIN reservation r ON r.id_reservation = p.id_reservation JOIN horaire h ON h.id_horaire = r.id_horaire
      JOIN trajet t ON t.id_trajet = h.id_trajet JOIN compagnie c ON c.id_compagnie = t.id_compagnie JOIN utilisateur u ON u.id_utilisateur = r.id_utilisateur
      ${id_compagnie != null ? 'WHERE t.id_compagnie = ?' : ''} ORDER BY p.id_paiement DESC`, id_compagnie != null ? [id_compagnie] : []);
  },
  async listPaymentsByReservation(id) { return q(`${PAY_SQL} WHERE id_reservation = ? ORDER BY id_paiement`, [id]); },
  async updatePayment(id, patch) {
    const p = { ...patch };
    if (p.statut) p.statut = payStatutIn(p.statut);
    if (p.mode) p.mode = payModeIn(p.mode);
    try { await update('paiement', 'id_paiement', id, p, ['statut', 'reference_transaction', 'mode']); }
    catch (e) { if (isDup(e)) throw new DbError('DUPLICATE_PAYMENT'); throw e; }
    return one(`${PAY_SQL} WHERE id_paiement = ?`, [id]);
  },

  // ----- clés de paiement des compagnies (secret chiffré) et abonnements -----
  async getCompanyPaymentSettings(id) { return one(`SELECT id_compagnie, fedapay_env, public_key, secret_key_enc, verifie, ${iso('date_maj')} AS date_maj FROM compagnie_paiement WHERE id_compagnie = ?`, [id]).then((r) => r && { ...r, verifie: !!r.verifie }); },
  async saveCompanyPaymentSettings(id, d) {
    await run('INSERT INTO compagnie_paiement (id_compagnie, fedapay_env, public_key, secret_key_enc, verifie, date_maj) VALUES (?,?,?,?,?,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE fedapay_env=VALUES(fedapay_env), public_key=VALUES(public_key), secret_key_enc=VALUES(secret_key_enc), verifie=VALUES(verifie), date_maj=UTC_TIMESTAMP()', [id, d.fedapay_env, d.public_key, d.secret_key_enc, d.verifie ? 1 : 0]);
    return this.getCompanyPaymentSettings(id);
  },
  async deleteCompanyPaymentSettings(id) { return del('compagnie_paiement', 'id_compagnie', id); },
  async createSubscriptionPayment(d) {
    const id = await insert('abonnement_paiement', { id_compagnie: d.id_compagnie, montant_fcfa: d.montant_fcfa, mode: d.mode, reference_transaction: d.reference_transaction ?? null, statut: d.statut || 'en_attente', jours: d.jours ?? null, date_paiement: utcNow() });
    return one(`SELECT ${SUB_COLS} FROM abonnement_paiement WHERE id_abonnement = ?`, [id]);
  },
  async getSubscriptionPaymentByReference(ref) { return one(`SELECT ${SUB_COLS} FROM abonnement_paiement WHERE reference_transaction = ?`, [ref]); },
  async updateSubscriptionPayment(id, patch) { await update('abonnement_paiement', 'id_abonnement', id, patch, ['statut', 'expire_le', 'jours']); return one(`SELECT ${SUB_COLS} FROM abonnement_paiement WHERE id_abonnement = ?`, [id]); },
  async listSubscriptionPayments({ id_compagnie } = {}) {
    return q(`SELECT ${SUB_COLS} FROM abonnement_paiement ${id_compagnie != null ? 'WHERE id_compagnie = ?' : ''} ORDER BY id_abonnement DESC`, id_compagnie != null ? [id_compagnie] : []);
  },

  // ----- chauffeurs (prénom seul + photo), avis et pourboires -----
  async listChauffeurs({ id_compagnie, id_chauffeur } = {}) {
    const w = [], p = [];
    if (id_compagnie != null) { w.push('ch.id_compagnie = ?'); p.push(id_compagnie); }
    if (id_chauffeur != null) { w.push('ch.id_chauffeur = ?'); p.push(id_chauffeur); }
    return q(`SELECT ch.id_chauffeur, ch.id_compagnie, ch.prenom, ch.photo, c.nom AS compagnie_nom,
      (SELECT CAST(ROUND(AVG(a.note), 1) AS DOUBLE) FROM avis a WHERE a.id_chauffeur = ch.id_chauffeur) AS note,
      (SELECT COUNT(*) FROM avis a WHERE a.id_chauffeur = ch.id_chauffeur) AS nb_avis
      FROM chauffeur ch JOIN compagnie c ON c.id_compagnie = ch.id_compagnie ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY ch.id_chauffeur`, p)
      .then((rows) => rows.map((r) => ({ ...r, note: r.note == null ? null : Number(r.note), nb_avis: Number(r.nb_avis) })));
  },
  async getChauffeur(id) { return (await this.listChauffeurs({ id_chauffeur: id }))[0] || null; },
  async createChauffeur(d) { const id = await insert('chauffeur', { id_compagnie: d.id_compagnie, prenom: d.prenom, photo: d.photo ?? null }); return this.getChauffeur(id); },
  async updateChauffeur(id, patch) { await update('chauffeur', 'id_chauffeur', id, patch, ['prenom', 'photo']); return this.getChauffeur(id); },
  async deleteChauffeur(id) { return del('chauffeur', 'id_chauffeur', id); },
  async createAvis(d) {
    try {
      const id = await insert('avis', { id_reservation: d.id_reservation, id_horaire: d.id_horaire, id_chauffeur: d.id_chauffeur, id_utilisateur: d.id_utilisateur, note: d.note, commentaire: d.commentaire ?? null, date_avis: utcNow() });
      return one(`SELECT ${AVIS_COLS} FROM avis WHERE id_avis = ?`, [id]);
    } catch (e) { if (isDup(e)) throw new DbError('DUPLICATE_AVIS'); throw e; }
  },
  async getAvisByReservation(id) { return one(`SELECT ${AVIS_COLS} FROM avis WHERE id_reservation = ?`, [id]); },
  async listAvis({ id_compagnie, id_chauffeur, limit = 100 } = {}) {
    const w = [], p = [];
    if (id_compagnie != null) { w.push('ch.id_compagnie = ?'); p.push(id_compagnie); }
    if (id_chauffeur != null) { w.push('a.id_chauffeur = ?'); p.push(id_chauffeur); }
    return q(`SELECT a.id_avis, a.id_reservation, a.id_horaire, a.id_chauffeur, a.id_utilisateur, a.note, a.commentaire, ${iso('a.date_avis')} AS date_avis, ch.prenom AS chauffeur_prenom, ch.id_compagnie
      FROM avis a JOIN chauffeur ch ON ch.id_chauffeur = a.id_chauffeur ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY a.id_avis DESC LIMIT ?`, [...p, Math.min(Number(limit) || 100, 100000)]);
  },
  async createTip(d) {
    const id = await insert('pourboire', { id_reservation: d.id_reservation, id_chauffeur: d.id_chauffeur, montant_fcfa: d.montant_fcfa, mode: d.mode, reference_transaction: d.reference_transaction ?? null, statut: d.statut || 'en_attente', date_pourboire: utcNow() });
    return one(`SELECT ${TIP_COLS} FROM pourboire WHERE id_pourboire = ?`, [id]);
  },
  async getTipByReference(ref) { return one(`SELECT ${TIP_COLS} FROM pourboire WHERE reference_transaction = ?`, [ref]); },
  async updateTip(id, patch) { await update('pourboire', 'id_pourboire', id, patch, ['statut']); return one(`SELECT ${TIP_COLS} FROM pourboire WHERE id_pourboire = ?`, [id]); },
  async listTips({ id_compagnie, id_chauffeur, id_reservation } = {}) {
    const w = [], p = [];
    if (id_compagnie != null) { w.push('ch.id_compagnie = ?'); p.push(id_compagnie); }
    if (id_chauffeur != null) { w.push('po.id_chauffeur = ?'); p.push(id_chauffeur); }
    if (id_reservation != null) { w.push('po.id_reservation = ?'); p.push(id_reservation); }
    return q(`SELECT po.id_pourboire, po.id_reservation, po.id_chauffeur, po.montant_fcfa, po.mode, po.reference_transaction, po.statut, ${iso('po.date_pourboire')} AS date_pourboire, ch.id_compagnie
      FROM pourboire po JOIN chauffeur ch ON ch.id_chauffeur = po.id_chauffeur ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY po.id_pourboire DESC`, p);
  },

  // ----- journal d'audit (le compte du site ne peut qu'ajouter et lire) -----
  async addAuditLog(d) {
    const cut = (s, n) => (s == null ? null : String(s).slice(0, n));
    const id = await insert('journal_audit', { id_utilisateur: d.id_utilisateur ?? null, utilisateur_nom: cut(d.utilisateur_nom, 200), id_compagnie: d.id_compagnie ?? null,
      action: cut(d.action, 60), entite: cut(d.entite, 30), id_entite: d.id_entite ?? null, details: cut(d.details, 500), date_evenement: utcNow() });
    return one(`SELECT id_journal, ${iso('date_evenement')} AS date_evenement, id_utilisateur, utilisateur_nom, id_compagnie, action, entite, id_entite, details FROM journal_audit WHERE id_journal = ?`, [id]);
  },
  async listAuditLog({ id_compagnie, entite, id_entite, action, limit = 100 } = {}) {
    const w = [], p = [];
    if (id_compagnie != null) { w.push('id_compagnie = ?'); p.push(id_compagnie); }
    if (entite) { w.push('entite = ?'); p.push(entite); }
    if (id_entite != null) { w.push('id_entite = ?'); p.push(id_entite); }
    if (action) { w.push('action = ?'); p.push(action); }
    return q(`SELECT id_journal, ${iso('date_evenement')} AS date_evenement, id_utilisateur, utilisateur_nom, id_compagnie, action, entite, id_entite, details FROM journal_audit ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY id_journal DESC LIMIT ?`, [...p, Math.min(Number(limit) || 100, 100000)]);
  },

  // ----- statistiques -----
  async getStats({ today, id_compagnie } = {}) {
    const cw = id_compagnie != null ? ' AND t.id_compagnie = ?' : '';
    const cp = id_compagnie != null ? [id_compagnie] : [];
    const j = 'FROM reservation r JOIN horaire h ON h.id_horaire = r.id_horaire JOIN trajet t ON t.id_trajet = h.id_trajet';
    const jh = 'FROM horaire h JOIN trajet t ON t.id_trajet = h.id_trajet JOIN bus b ON b.id_bus = h.id_bus';
    const jour = await one(`SELECT COUNT(*) AS n ${j} WHERE r.statut <> 'annulee' AND DATE(r.date_reservation) = ?${cw}`, [today, ...cp]);
    const fut = await one(`SELECT COUNT(*) AS n, COALESCE(SUM(b.nombre_places), 0) AS places ${jh} WHERE h.statut = 'programme' AND h.date_depart >= ?${cw}`, [today, ...cp]);
    const occ = await one(`SELECT COUNT(*) AS n ${j} WHERE r.statut <> 'annulee' AND h.statut = 'programme' AND h.date_depart >= ?${cw}`, [today, ...cp]);
    const users = id_compagnie == null ? await one("SELECT COUNT(*) AS n FROM utilisateur WHERE role = 'voyageur'") : null;
    const places = Number(fut.places);
    return { reservations_du_jour: Number(jour.n), trajets_actifs: Number(fut.n), taux_remplissage: places ? Math.round((Number(occ.n) / places) * 100) : 0, utilisateurs: users ? Number(users.n) : null };
  },
};
