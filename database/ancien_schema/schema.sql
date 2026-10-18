-- ============================================================
--  VOYAGÉO : schéma MySQL / MariaDB (proposition de référence)
--  Moteur InnoDB, jeu de caractères utf8mb4 (accents et caractères spéciaux).
--  Ce schéma correspond à la partie X du cahier des charges.
--  Le responsable de la base de données peut l'adapter, tant que le
--  CONTRAT (docs/CONTRAT_BASE_DE_DONNEES.md) reste respecté.
-- ============================================================
CREATE DATABASE IF NOT EXISTS voyageo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE voyageo;

-- ---------- COMPAGNIE ----------
CREATE TABLE IF NOT EXISTS compagnie (
  id_compagnie  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nom           VARCHAR(120) NOT NULL,
  telephone     VARCHAR(25)  NULL,
  email         VARCHAR(190) NULL,
  adresse       VARCHAR(255) NULL,
  statut        ENUM('active','inactive') NOT NULL DEFAULT 'active',
  abonnement_statut    ENUM('non_requis','en_attente','actif','expire') NOT NULL DEFAULT 'non_requis', -- non_requis = compagnie créée par l'administrateur
  abonnement_expire_le DATE NULL,
  PRIMARY KEY (id_compagnie),
  UNIQUE KEY uq_compagnie_nom (nom)
) ENGINE=InnoDB;

-- ---------- UTILISATEUR ----------
CREATE TABLE IF NOT EXISTS utilisateur (
  id_utilisateur      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nom                 VARCHAR(100) NOT NULL,
  prenom              VARCHAR(100) NOT NULL,
  email               VARCHAR(190) NOT NULL,
  telephone           VARCHAR(25)  NULL,
  mot_de_passe_hache  VARCHAR(255) NOT NULL,           -- JAMAIS le mot de passe en clair
  role                ENUM('voyageur','admin','gestionnaire') NOT NULL DEFAULT 'voyageur',
  statut              ENUM('actif','bloque') NOT NULL DEFAULT 'actif',
  id_compagnie        INT UNSIGNED NULL,               -- renseigné pour le rôle "gestionnaire"
  date_creation       DATETIME NOT NULL,               -- heure UTC
  consentement_date   DATETIME NULL,                   -- date d'acceptation de la politique de confidentialité (heure UTC)
  consentement_version VARCHAR(20) NULL,               -- version de la politique acceptée
  PRIMARY KEY (id_utilisateur),
  UNIQUE KEY uq_utilisateur_email (email),
  CONSTRAINT fk_utilisateur_compagnie FOREIGN KEY (id_compagnie)
    REFERENCES compagnie (id_compagnie) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ---------- BUS ----------
CREATE TABLE IF NOT EXISTS bus (
  id_bus          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_compagnie    INT UNSIGNED NOT NULL,
  immatriculation VARCHAR(30)  NOT NULL,
  nombre_places   SMALLINT UNSIGNED NOT NULL,
  type            VARCHAR(40)  NULL,
  photo           VARCHAR(120) NULL,                   -- ex. /uploads/ab12cd34ef56ab78.jpg
  PRIMARY KEY (id_bus),
  UNIQUE KEY uq_bus_immatriculation (immatriculation),
  CONSTRAINT ck_bus_places CHECK (nombre_places BETWEEN 1 AND 80),
  CONSTRAINT fk_bus_compagnie FOREIGN KEY (id_compagnie)
    REFERENCES compagnie (id_compagnie) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ---------- TRAJET (liaison entre deux villes) ----------
CREATE TABLE IF NOT EXISTS trajet (
  id_trajet       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_compagnie    INT UNSIGNED NOT NULL,
  ville_depart    VARCHAR(80)  NOT NULL,
  ville_arrivee   VARCHAR(80)  NOT NULL,
  duree_estimee   SMALLINT UNSIGNED NULL,              -- en minutes
  lieu_embarquement VARCHAR(160) NULL,                 -- ex. « Gare routière de Jonquet, Cotonou »
  lien_maps       VARCHAR(500) NULL,                   -- lien Google Maps du lieu d'embarquement
  PRIMARY KEY (id_trajet),
  KEY idx_trajet_villes (ville_depart, ville_arrivee),
  CONSTRAINT ck_trajet_villes CHECK (ville_depart <> ville_arrivee),
  CONSTRAINT fk_trajet_compagnie FOREIGN KEY (id_compagnie)
    REFERENCES compagnie (id_compagnie) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ---------- CHAUFFEUR (prénom seul + photo : jamais le nom de famille) ----------
CREATE TABLE IF NOT EXISTS chauffeur (
  id_chauffeur    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_compagnie    INT UNSIGNED NOT NULL,
  prenom          VARCHAR(60)  NOT NULL,
  photo           VARCHAR(120) NULL,
  PRIMARY KEY (id_chauffeur),
  CONSTRAINT fk_chauffeur_compagnie FOREIGN KEY (id_compagnie)
    REFERENCES compagnie (id_compagnie) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ---------- HORAIRE (un départ précis d'un trajet = un "voyage") ----------
CREATE TABLE IF NOT EXISTS horaire (
  id_horaire      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_trajet       INT UNSIGNED NOT NULL,
  id_bus          INT UNSIGNED NOT NULL,
  date_depart     DATE NOT NULL,
  heure_depart    TIME NOT NULL,
  heure_arrivee   TIME NULL,
  tarif_fcfa      INT UNSIGNED NOT NULL,
  statut          ENUM('programme','annule','termine') NOT NULL DEFAULT 'programme',
  id_chauffeur    INT UNSIGNED NULL,
  photo_bus       VARCHAR(120) NULL,                   -- photo propre à ce voyage (sinon : photo du bus)
  PRIMARY KEY (id_horaire),
  KEY idx_horaire_recherche (date_depart, statut),
  CONSTRAINT fk_horaire_trajet FOREIGN KEY (id_trajet)
    REFERENCES trajet (id_trajet) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_horaire_bus FOREIGN KEY (id_bus)
    REFERENCES bus (id_bus) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_horaire_chauffeur FOREIGN KEY (id_chauffeur)
    REFERENCES chauffeur (id_chauffeur) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ---------- RESERVATION ----------
-- RÈGLE ANTI-DOUBLE RÉSERVATION :
--   place_active = numero_place tant que la réservation est active (en_attente ou confirmee),
--   place_active = NULL quand elle est annulée.
--   La clé UNIQUE (id_horaire, place_active) interdit deux réservations actives pour la même place
--   d'un même voyage, et autorise de nombreuses lignes annulées (NULL n'est jamais "en double").
CREATE TABLE IF NOT EXISTS reservation (
  id_reservation      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  numero_ticket       VARCHAR(30)  NOT NULL,           -- ex. VYG-2026-123456
  id_utilisateur      INT UNSIGNED NOT NULL,
  id_horaire          INT UNSIGNED NOT NULL,
  numero_place        SMALLINT UNSIGNED NOT NULL,
  place_active        SMALLINT UNSIGNED NULL,
  nom_passager        VARCHAR(100) NOT NULL,
  prenom_passager     VARCHAR(100) NOT NULL,
  telephone_passager  VARCHAR(25)  NOT NULL,
  piece_identite      VARCHAR(60)  NULL,
  statut              ENUM('en_attente','confirmee','annulee') NOT NULL DEFAULT 'confirmee',
  date_reservation    DATETIME NOT NULL,               -- heure UTC
  date_annulation     DATETIME NULL,
  PRIMARY KEY (id_reservation),
  UNIQUE KEY uq_reservation_ticket (numero_ticket),
  UNIQUE KEY uq_place_voyage (id_horaire, place_active),
  KEY idx_reservation_utilisateur (id_utilisateur),
  CONSTRAINT fk_reservation_utilisateur FOREIGN KEY (id_utilisateur)
    REFERENCES utilisateur (id_utilisateur) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_reservation_horaire FOREIGN KEY (id_horaire)
    REFERENCES horaire (id_horaire) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ---------- PAIEMENT (optionnel) ----------
CREATE TABLE IF NOT EXISTS paiement (
  id_paiement            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_reservation         INT UNSIGNED NOT NULL,
  montant_fcfa           INT UNSIGNED NOT NULL,
  mode                   VARCHAR(30)  NOT NULL,        -- simulation, fedapay...
  reference_transaction  VARCHAR(100) NULL,
  statut                 ENUM('en_attente','reussi','echoue') NOT NULL DEFAULT 'en_attente',
  date_paiement          DATETIME NOT NULL,            -- heure UTC
  PRIMARY KEY (id_paiement),
  UNIQUE KEY uq_paiement_reference (reference_transaction),
  CONSTRAINT fk_paiement_reservation FOREIGN KEY (id_reservation)
    REFERENCES reservation (id_reservation) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ---------- AVIS DES VOYAGEURS SUR LE CHAUFFEUR (un seul avis par réservation) ----------
CREATE TABLE IF NOT EXISTS avis (
  id_avis        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_reservation INT UNSIGNED NOT NULL,
  id_horaire     INT UNSIGNED NOT NULL,
  id_chauffeur   INT UNSIGNED NOT NULL,
  id_utilisateur INT UNSIGNED NOT NULL,
  note           TINYINT UNSIGNED NOT NULL,
  commentaire    VARCHAR(300) NULL,
  date_avis      DATETIME NOT NULL,                   -- heure UTC
  PRIMARY KEY (id_avis),
  UNIQUE KEY uq_avis_reservation (id_reservation),
  CONSTRAINT ck_avis_note CHECK (note BETWEEN 1 AND 5),
  CONSTRAINT fk_avis_reservation FOREIGN KEY (id_reservation) REFERENCES reservation (id_reservation) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_avis_chauffeur FOREIGN KEY (id_chauffeur) REFERENCES chauffeur (id_chauffeur) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ---------- POURBOIRES (payés après le voyage) ----------
CREATE TABLE IF NOT EXISTS pourboire (
  id_pourboire          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_reservation        INT UNSIGNED NOT NULL,
  id_chauffeur          INT UNSIGNED NOT NULL,
  montant_fcfa          INT UNSIGNED NOT NULL,
  mode                  VARCHAR(30)  NOT NULL,
  reference_transaction VARCHAR(100) NULL,
  statut                ENUM('en_attente','reussi','echoue') NOT NULL DEFAULT 'en_attente',
  date_pourboire        DATETIME NOT NULL,            -- heure UTC
  PRIMARY KEY (id_pourboire),
  UNIQUE KEY uq_pourboire_reference (reference_transaction),
  CONSTRAINT fk_pourboire_reservation FOREIGN KEY (id_reservation) REFERENCES reservation (id_reservation) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_pourboire_chauffeur FOREIGN KEY (id_chauffeur) REFERENCES chauffeur (id_chauffeur) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ---------- JOURNAL D'AUDIT (actions sensibles et événements métier) ----------
CREATE TABLE IF NOT EXISTS journal_audit (
  id_journal       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  date_evenement   DATETIME NOT NULL,                  -- heure UTC
  id_utilisateur   INT UNSIGNED NULL,                  -- auteur (NULL = système : paiement, webhook...)
  utilisateur_nom  VARCHAR(200) NULL,
  id_compagnie     INT UNSIGNED NULL,                  -- compagnie concernée (isolation des données du gestionnaire)
  action           VARCHAR(60)  NOT NULL,              -- ex. reservation.annulee, paiement.confirme
  entite           VARCHAR(30)  NULL,                  -- reservation, horaire, bus, trajet, compagnie, utilisateur, paiement
  id_entite        INT UNSIGNED NULL,
  details          VARCHAR(500) NULL,
  PRIMARY KEY (id_journal),
  KEY idx_journal_date (date_evenement),
  KEY idx_journal_compagnie (id_compagnie, date_evenement),
  KEY idx_journal_entite (entite, id_entite)
) ENGINE=InnoDB;

-- ---------- CLÉS DE PAIEMENT DES COMPAGNIES (la clé secrète est CHIFFRÉE par l'application : AES-256-GCM) ----------
CREATE TABLE IF NOT EXISTS compagnie_paiement (
  id_compagnie    INT UNSIGNED NOT NULL,
  fedapay_env     ENUM('sandbox','live') NOT NULL,
  public_key      VARCHAR(190) NOT NULL,
  secret_key_enc  VARCHAR(600) NOT NULL,
  verifie         TINYINT(1) NOT NULL DEFAULT 0,
  date_maj        DATETIME NOT NULL,                  -- heure UTC
  PRIMARY KEY (id_compagnie),
  CONSTRAINT fk_cpaiement_compagnie FOREIGN KEY (id_compagnie) REFERENCES compagnie (id_compagnie) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ---------- ABONNEMENTS DES AGENCES (paiements versés à Voyagéo) ----------
CREATE TABLE IF NOT EXISTS abonnement_paiement (
  id_abonnement          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_compagnie           INT UNSIGNED NOT NULL,
  montant_fcfa           INT UNSIGNED NOT NULL,
  mode                   VARCHAR(30)  NOT NULL,        -- fedapay, simulation, manuel
  reference_transaction  VARCHAR(100) NULL,
  statut                 ENUM('en_attente','reussi','echoue') NOT NULL DEFAULT 'en_attente',
  jours                  INT UNSIGNED NULL,            -- durée accordée
  expire_le              DATE NULL,                    -- date de fin obtenue après ce paiement
  date_paiement          DATETIME NOT NULL,            -- heure UTC
  PRIMARY KEY (id_abonnement),
  UNIQUE KEY uq_abonnement_reference (reference_transaction),
  KEY idx_abonnement_compagnie (id_compagnie),
  CONSTRAINT fk_abonnement_compagnie FOREIGN KEY (id_compagnie) REFERENCES compagnie (id_compagnie) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

-- ---------- Compte MySQL dédié (à adapter : choisissez votre propre mot de passe) ----------
-- CREATE USER 'voyageo_user'@'localhost' IDENTIFIED BY 'UnMotDePasseSolide';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON voyageo.* TO 'voyageo_user'@'localhost';
-- FLUSH PRIVILEGES;
