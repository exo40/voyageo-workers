-- ============================================================
--  MIGRATION : photos des bus, chauffeurs, avis, pourboires, consentement.
--  À exécuter UNE SEULE FOIS sur une base MySQL/MariaDB déjà créée avec l'ancien schema.sql.
-- ============================================================
USE voyageo;

ALTER TABLE utilisateur
  ADD COLUMN consentement_date DATETIME NULL AFTER date_creation,
  ADD COLUMN consentement_version VARCHAR(20) NULL AFTER consentement_date;

ALTER TABLE bus ADD COLUMN photo VARCHAR(120) NULL AFTER type;

CREATE TABLE IF NOT EXISTS chauffeur (
  id_chauffeur    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_compagnie    INT UNSIGNED NOT NULL,
  prenom          VARCHAR(60)  NOT NULL,
  photo           VARCHAR(120) NULL,
  PRIMARY KEY (id_chauffeur),
  CONSTRAINT fk_chauffeur_compagnie FOREIGN KEY (id_compagnie)
    REFERENCES compagnie (id_compagnie) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

ALTER TABLE horaire
  ADD COLUMN id_chauffeur INT UNSIGNED NULL,
  ADD COLUMN photo_bus VARCHAR(120) NULL,
  ADD CONSTRAINT fk_horaire_chauffeur FOREIGN KEY (id_chauffeur)
    REFERENCES chauffeur (id_chauffeur) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS avis (
  id_avis        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_reservation INT UNSIGNED NOT NULL,
  id_horaire     INT UNSIGNED NOT NULL,
  id_chauffeur   INT UNSIGNED NOT NULL,
  id_utilisateur INT UNSIGNED NOT NULL,
  note           TINYINT UNSIGNED NOT NULL,
  commentaire    VARCHAR(300) NULL,
  date_avis      DATETIME NOT NULL,
  PRIMARY KEY (id_avis),
  UNIQUE KEY uq_avis_reservation (id_reservation),
  CONSTRAINT ck_avis_note CHECK (note BETWEEN 1 AND 5),
  CONSTRAINT fk_avis_reservation FOREIGN KEY (id_reservation) REFERENCES reservation (id_reservation) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_avis_chauffeur FOREIGN KEY (id_chauffeur) REFERENCES chauffeur (id_chauffeur) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pourboire (
  id_pourboire          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_reservation        INT UNSIGNED NOT NULL,
  id_chauffeur          INT UNSIGNED NOT NULL,
  montant_fcfa          INT UNSIGNED NOT NULL,
  mode                  VARCHAR(30)  NOT NULL,
  reference_transaction VARCHAR(100) NULL,
  statut                ENUM('en_attente','reussi','echoue') NOT NULL DEFAULT 'en_attente',
  date_pourboire        DATETIME NOT NULL,
  PRIMARY KEY (id_pourboire),
  UNIQUE KEY uq_pourboire_reference (reference_transaction),
  CONSTRAINT fk_pourboire_reservation FOREIGN KEY (id_reservation) REFERENCES reservation (id_reservation) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_pourboire_chauffeur FOREIGN KEY (id_chauffeur) REFERENCES chauffeur (id_chauffeur) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;
