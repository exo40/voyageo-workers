-- ============================================================
--  MIGRATION : journal d'audit (Voyagéo v1.1)
--  À exécuter UNE SEULE FOIS sur une base MySQL/MariaDB existante.
--  Elle AJOUTE une table et ne modifie ni ne supprime aucune donnée.
--  Commande :  mysql -u voyageo_user -p voyageo < database/migration_journal_audit.sql
--  (adaptateur JSON : rien à faire, la collection « journal » est créée automatiquement)
-- ============================================================
USE voyageo;
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
