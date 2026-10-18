-- ============================================================
--  MIGRATION : inscription des agences, abonnement, clés de paiement (Voyagéo v1.2)
--  À exécuter UNE SEULE FOIS sur une base MySQL/MariaDB existante (après migration_journal_audit.sql).
--  Aucune donnée n'est supprimée. Les compagnies existantes passent en « non_requis » : elles ne sont PAS bloquées.
--  Commande :  mysql -u voyageo_user -p voyageo < database/migration_agences_abonnement.sql
--  (adaptateur JSON : rien à faire)
-- ============================================================
USE voyageo;

ALTER TABLE compagnie
  ADD COLUMN abonnement_statut ENUM('non_requis','en_attente','actif','expire') NOT NULL DEFAULT 'non_requis' AFTER statut,
  ADD COLUMN abonnement_expire_le DATE NULL AFTER abonnement_statut;

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
