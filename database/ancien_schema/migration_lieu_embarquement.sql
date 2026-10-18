-- Migration : lieu d'embarquement + lien Google Maps (bases MySQL créées avant cette version).
-- À exécuter une seule fois : mysql -u root -p voyageo < database/migration_lieu_embarquement.sql
USE voyageo;
ALTER TABLE trajet
  ADD COLUMN lieu_embarquement VARCHAR(160) NULL AFTER duree_estimee,
  ADD COLUMN lien_maps VARCHAR(500) NULL AFTER lieu_embarquement;
