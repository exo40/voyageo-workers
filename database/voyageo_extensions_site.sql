-- =====================================================================
-- Voyagéo : COMPLÉMENT du schéma de production pour les fonctions du site
-- Fichier : voyageo_extensions_site.sql
--
-- À exécuter UNE SEULE FOIS, APRÈS voyageo_mysql_production.sql et AVANT voyageo_compte_applicatif.sql,
-- avec un compte administrateur MySQL (MySQL 8.0.16 ou plus récent) :
--   mysql -u <compte_administrateur_mysql> -p --default-character-set=utf8mb4 < voyageo_extensions_site.sql
--
-- Pourquoi ce fichier : le script de production couvre le cœur (compagnie, bus, trajet, horaire, réservation,
-- paiement, remboursement). Le site utilise en plus : photos des bus, chauffeurs, avis des voyageurs, pourboires,
-- journal d'audit, abonnement des agences, clés de paiement des compagnies, consentement RGPD.
-- Ce fichier AJOUTE ces éléments sans modifier ni supprimer aucune donnée ni aucune règle existante.
-- Il ne contient aucune donnée. Si une colonne ou une table existe déjà, MySQL s'arrête avec une erreur
-- (1060 ou 1050) sur la première instruction : rien n'a été modifié, il ne faut pas le relancer.
-- Mêmes conventions que le script de production : utf8mb4_unicode_ci, clés étrangères RESTRICT, dates en UTC.
-- =====================================================================

SET NAMES utf8mb4;
USE voyageo;

-- ---------------------------------------------------------------------
-- Colonnes ajoutées aux tables existantes
-- ---------------------------------------------------------------------
ALTER TABLE compagnie
    ADD COLUMN abonnement_statut    ENUM('non_requis', 'en_attente', 'actif', 'expire') NOT NULL DEFAULT 'non_requis' AFTER statut,   -- non_requis = compagnie créée par l'administrateur
    ADD COLUMN abonnement_expire_le DATE NULL AFTER abonnement_statut;

ALTER TABLE utilisateur
    ADD COLUMN consentement_date    DATETIME NULL AFTER date_creation,        -- acceptation de la politique de confidentialité (UTC)
    ADD COLUMN consentement_version VARCHAR(20) NULL AFTER consentement_date;

ALTER TABLE bus
    ADD COLUMN photo VARCHAR(120) NULL AFTER type;                            -- ex. /uploads/ab12cd34ef56ab78.jpg

-- ---------------------------------------------------------------------
-- CHAUFFEUR (prénom seul + photo : jamais le nom de famille)
-- ---------------------------------------------------------------------
CREATE TABLE chauffeur (
    id_chauffeur  INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_compagnie  INT UNSIGNED NOT NULL,
    prenom        VARCHAR(60) NOT NULL,
    photo         VARCHAR(120) NULL,
    PRIMARY KEY (id_chauffeur),
    KEY idx_chauffeur_compagnie (id_compagnie),
    CONSTRAINT fk_chauffeur_compagnie FOREIGN KEY (id_compagnie) REFERENCES compagnie(id_compagnie)
        ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE horaire
    ADD COLUMN id_chauffeur INT UNSIGNED NULL,
    ADD COLUMN photo_bus    VARCHAR(120) NULL,                                -- photo propre à ce voyage (sinon : photo du bus)
    ADD KEY idx_horaire_chauffeur (id_chauffeur),
    ADD CONSTRAINT fk_horaire_chauffeur FOREIGN KEY (id_chauffeur) REFERENCES chauffeur(id_chauffeur)
        ON DELETE RESTRICT ON UPDATE RESTRICT;

-- ---------------------------------------------------------------------
-- AVIS des voyageurs sur le chauffeur (un seul avis par réservation)
-- ---------------------------------------------------------------------
CREATE TABLE avis (
    id_avis         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_reservation  INT UNSIGNED NOT NULL,
    id_horaire      INT UNSIGNED NOT NULL,
    id_chauffeur    INT UNSIGNED NOT NULL,
    id_utilisateur  INT UNSIGNED NOT NULL,
    note            TINYINT UNSIGNED NOT NULL,
    commentaire     VARCHAR(300) NULL,
    date_avis       DATETIME NOT NULL,
    PRIMARY KEY (id_avis),
    UNIQUE KEY ux_avis_reservation (id_reservation),
    KEY idx_avis_chauffeur (id_chauffeur),
    KEY idx_avis_utilisateur (id_utilisateur),
    CONSTRAINT fk_avis_reservation FOREIGN KEY (id_reservation) REFERENCES reservation(id_reservation) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_avis_horaire     FOREIGN KEY (id_horaire)     REFERENCES horaire(id_horaire)         ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_avis_chauffeur   FOREIGN KEY (id_chauffeur)   REFERENCES chauffeur(id_chauffeur)     ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_avis_utilisateur FOREIGN KEY (id_utilisateur) REFERENCES utilisateur(id_utilisateur) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_avis_note CHECK (note BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- POURBOIRE (payé après le voyage ; indépendant du paiement du ticket)
-- ---------------------------------------------------------------------
CREATE TABLE pourboire (
    id_pourboire           INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_reservation         INT UNSIGNED NOT NULL,
    id_chauffeur           INT UNSIGNED NOT NULL,
    montant_fcfa           INT UNSIGNED NOT NULL,
    mode                   VARCHAR(30) NOT NULL,                              -- fedapay, simulation...
    reference_transaction  VARCHAR(100) NULL,
    statut                 ENUM('en_attente', 'reussi', 'echoue') NOT NULL DEFAULT 'en_attente',
    date_pourboire         DATETIME NOT NULL,
    PRIMARY KEY (id_pourboire),
    UNIQUE KEY ux_pourboire_reference (reference_transaction),
    KEY idx_pourboire_reservation (id_reservation),
    KEY idx_pourboire_chauffeur (id_chauffeur),
    CONSTRAINT fk_pourboire_reservation FOREIGN KEY (id_reservation) REFERENCES reservation(id_reservation) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_pourboire_chauffeur   FOREIGN KEY (id_chauffeur)   REFERENCES chauffeur(id_chauffeur)     ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_pourboire_montant CHECK (montant_fcfa > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- JOURNAL D'AUDIT (actions sensibles et événements métier ; le site n'y fait qu'ajouter des lignes)
-- ---------------------------------------------------------------------
CREATE TABLE journal_audit (
    id_journal       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    date_evenement   DATETIME NOT NULL,
    id_utilisateur   INT UNSIGNED NULL,                                       -- auteur (NULL = système : paiement, webhook...)
    utilisateur_nom  VARCHAR(200) NULL,
    id_compagnie     INT UNSIGNED NULL,                                       -- compagnie concernée (isolation des données du gestionnaire)
    action           VARCHAR(60) NOT NULL,                                    -- ex. reservation.annulee, paiement.confirme
    entite           VARCHAR(30) NULL,
    id_entite        INT UNSIGNED NULL,
    details          VARCHAR(500) NULL,
    PRIMARY KEY (id_journal),
    KEY idx_journal_date (date_evenement),
    KEY idx_journal_compagnie (id_compagnie, date_evenement),
    KEY idx_journal_entite (entite, id_entite)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- CLÉS DE PAIEMENT DES COMPAGNIES (la clé secrète est CHIFFRÉE par le site : AES-256-GCM)
-- ---------------------------------------------------------------------
CREATE TABLE compagnie_paiement (
    id_compagnie    INT UNSIGNED NOT NULL,
    fedapay_env     ENUM('sandbox', 'live') NOT NULL,
    public_key      VARCHAR(190) NOT NULL,
    secret_key_enc  VARCHAR(600) NOT NULL,
    verifie         TINYINT(1) NOT NULL DEFAULT 0,
    date_maj        DATETIME NOT NULL,
    PRIMARY KEY (id_compagnie),
    CONSTRAINT fk_cpaiement_compagnie FOREIGN KEY (id_compagnie) REFERENCES compagnie(id_compagnie) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ABONNEMENT DES AGENCES (paiements versés à Voyagéo)
-- ---------------------------------------------------------------------
CREATE TABLE abonnement_paiement (
    id_abonnement          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    id_compagnie           INT UNSIGNED NOT NULL,
    montant_fcfa           INT UNSIGNED NOT NULL,
    mode                   VARCHAR(30) NOT NULL,                              -- fedapay, simulation, manuel
    reference_transaction  VARCHAR(100) NULL,
    statut                 ENUM('en_attente', 'reussi', 'echoue') NOT NULL DEFAULT 'en_attente',
    jours                  INT UNSIGNED NULL,                                 -- durée accordée
    expire_le              DATE NULL,                                         -- date de fin obtenue après ce paiement
    date_paiement          DATETIME NOT NULL,
    PRIMARY KEY (id_abonnement),
    UNIQUE KEY ux_abonnement_reference (reference_transaction),
    KEY idx_abonnement_compagnie (id_compagnie),
    CONSTRAINT fk_abonnement_compagnie FOREIGN KEY (id_compagnie) REFERENCES compagnie(id_compagnie) ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT ck_abonnement_montant CHECK (montant_fcfa > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
