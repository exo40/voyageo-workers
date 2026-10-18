# Contrat de la couche base de données

Ce document est destiné au **responsable de la base de données**. Le site n'écrit jamais de SQL : il appelle seulement les fonctions ci-dessous, via `src/db/index.js`. Peu importe le moteur (MySQL, SQLite, PostgreSQL...), tant que l'adaptateur respecte ce contrat.

- Adaptateur de développement (complet, fonctionnel) : `src/db/adapters/json.js`
- Adaptateur MySQL 8 (testé sur MySQL 8.0.46) : `src/db/adapters/mysql.js` + `database/voyageo_mysql_production.sql` + `database/voyageo_extensions_site.sql`. Il traduit le vocabulaire du site vers celui de la base (rôle `admin` ↔ `administrateur`, compagnie `inactive` ↔ `suspendue`, paiement `en_attente` ↔ `initie`, `reservation.tarif_fcfa` = `prix_fcfa`...) ; les règles de la base remontent en `DbError('RULE')`.
- Gabarit vide pour un autre moteur : `src/db/adapters/_template.js` (à copier en `custom.js`, puis `DB_DRIVER=custom`)
- Vérification : `npm run check:db` (lecture seule) puis `CONTRACT_TEST_USE_ENV=1 npm test` (sur une base de TEST uniquement)

## Règles générales

1. **Toutes les fonctions sont `async`** et retournent une valeur (ou `null` quand l'élément n'existe pas).
2. Les objets retournés utilisent exactement les noms de champs du tableau « Objets ». Les noms de colonnes SQL peuvent différer, l'adaptateur fait la correspondance.
3. **Dates et heures** : `date_depart` = `"AAAA-MM-JJ"`, `heure_depart` / `heure_arrivee` = `"HH:MM"` (texte, sans secondes), `date_reservation`, `date_annulation`, `date_creation`, `date_paiement` = texte ISO 8601 en **UTC** (`"2026-11-14T08:30:00Z"`).
4. Les `id_*` sont des **nombres entiers** (pas des textes).
5. `updateXxx(id, patch)` ne modifie que les champs présents dans `patch` et retourne l'objet mis à jour, ou `null` si l'id n'existe pas.
6. `deleteXxx(id)` retourne `true` si supprimé, `false` si introuvable.
7. Les erreurs « normales » doivent être lancées avec `new DbError(code)` (`src/db/errors.js`) :

| Code | Quand le lancer |
|---|---|
| `SEAT_TAKEN` | `createReservation` ou `updateReservationStatus` : la place est déjà prise pour ce voyage |
| `DUPLICATE_TICKET` | `createReservation` : le numéro de ticket existe déjà (le site réessaie avec un autre numéro) |
| `DUPLICATE_EMAIL` | `createUser` : e-mail déjà utilisé (comparaison insensible à la casse) |
| `DUPLICATE_PLATE` | `createBus` / `updateBus` : immatriculation déjà utilisée |
| `DUPLICATE_TRAJET` | `createTrajet` / `updateTrajet` (MySQL) : la compagnie a déjà un trajet entre ces deux villes |
| `DUPLICATE_PAYMENT` | `createPayment` / `updatePayment` (MySQL) : un paiement réussi existe déjà pour la réservation, ou référence déjà utilisée |
| `RULE` | (MySQL) règle métier refusée par la base (déclencheurs 50001 à 50033) ; `message` = texte français de la base |
| `IN_USE` | `deleteXxx` : l'élément est référencé ailleurs (clé étrangère) |

Toute autre erreur (connexion perdue, SQL incorrect...) remonte telle quelle : le site répond « erreur serveur » et l'affiche dans la console.

## La règle la plus importante : une place = un seul voyageur

`createReservation` doit être **atomique**. Deux voyageurs qui valident la même place au même instant : un seul doit réussir, l'autre reçoit `DbError('SEAT_TAKEN')`. Avec MySQL, c'est garanti par la clé unique `(id_horaire, place_active)` : `place_active` vaut `numero_place` tant que la réservation est active (`en_attente` ou `confirmee`) et `NULL` quand elle est `annulee` (plusieurs `NULL` sont autorisés par MySQL). Le test « 10 demandes simultanées » du contrat vérifie ce comportement.

## Objets

**utilisateur** : `id_utilisateur, nom, prenom, email, telephone, mot_de_passe_hache, role ('voyageur'|'admin'|'gestionnaire'), statut ('actif'|'bloque'), id_compagnie (ou null), date_creation`

**compagnie** : `id_compagnie, nom, telephone, email, adresse, statut ('active'|'inactive')`

**bus** : `id_bus, id_compagnie, immatriculation, nombre_places, type` + `compagnie_nom` (jointure)

**trajet** : `id_trajet, id_compagnie, ville_depart, ville_arrivee, duree_estimee (minutes), lieu_embarquement (texte, facultatif), lien_maps (lien Google Maps, facultatif)` + `compagnie_nom`

**horaire « enrichi »** (retourné par `searchHoraires`, `listHoraires`, `getHoraire`, `createHoraire`, `updateHoraire`) :
`id_horaire, id_trajet, id_bus, date_depart, heure_depart, heure_arrivee, tarif_fcfa, statut ('programme'|'annule'|'termine')` + `ville_depart, ville_arrivee, duree_estimee, lieu_embarquement, lien_maps, id_compagnie, compagnie_nom, immatriculation, nombre_places` + **`places_occupees`** (nombre de réservations non annulées de ce voyage).

**réservation « enrichie »** (retournée par toutes les fonctions de réservation) :
`id_reservation, numero_ticket, id_utilisateur, id_horaire, numero_place, nom_passager, prenom_passager, telephone_passager, piece_identite, statut ('en_attente'|'confirmee'|'annulee'), date_reservation, date_annulation` + `ville_depart, ville_arrivee, date_depart, heure_depart, heure_arrivee, tarif_fcfa, statut_horaire, id_compagnie, compagnie_nom, utilisateur_email, utilisateur_nom`.

**paiement** : `id_paiement, id_reservation, montant_fcfa, mode, reference_transaction, statut ('en_attente'|'reussi'|'echoue'), date_paiement`

## Fonctions

### Cycle de vie
| Fonction | Rôle |
|---|---|
| `init()` | Se connecte à la base (et crée les tables si l'adaptateur le prévoit). Appelée une fois au démarrage. |
| `close()` | Ferme proprement les connexions. |
| `ping()` | Retourne `true` si la base répond. |

### Utilisateurs
| Fonction | Paramètres | Retour |
|---|---|---|
| `findUserByEmail(email)` | e-mail (insensible à la casse) | utilisateur ou `null` |
| `findUserById(id)` | | utilisateur ou `null` |
| `createUser(data)` | `nom, prenom, email, telephone, mot_de_passe_hache, role, statut, id_compagnie` | utilisateur créé. `DUPLICATE_EMAIL` |
| `updateUser(id, patch)` | champs : `nom, prenom, telephone, mot_de_passe_hache, role, statut, id_compagnie` | utilisateur ou `null` |
| `listUsers({q, role, id_compagnie})` | tous facultatifs ; `q` cherche dans prénom, nom, e-mail, téléphone | tableau, plus récents d'abord |

### Compagnies, bus, trajets
| Fonction | Paramètres | Retour |
|---|---|---|
| `listCompagnies()` | | tableau trié par nom |
| `getCompagnie(id)` / `createCompagnie(d)` / `updateCompagnie(id, patch)` / `deleteCompagnie(id)` | `nom, telephone, email, adresse, statut` | `deleteCompagnie` : `IN_USE` si bus, trajets ou utilisateurs liés |
| `listBus({id_compagnie})` / `getBus(id)` | | bus avec `compagnie_nom` |
| `createBus(d)` / `updateBus(id, patch)` / `deleteBus(id)` | `id_compagnie, immatriculation, nombre_places, type` | `DUPLICATE_PLATE` ; `IN_USE` si des voyages l'utilisent |
| `listTrajets({id_compagnie})` / `getTrajet(id)` | | trajets avec `compagnie_nom` |
| `createTrajet(d)` / `updateTrajet(id, patch)` / `deleteTrajet(id)` | `id_compagnie, ville_depart, ville_arrivee, duree_estimee, lieu_embarquement, lien_maps` | `IN_USE` si des voyages l'utilisent |

### Horaires (voyages)
| Fonction | Paramètres | Retour |
|---|---|---|
| `searchHoraires({ville_depart, ville_arrivee, date})` | villes comparées **sans tenir compte de la casse ni des accents** (avec MySQL : collation `utf8mb4_unicode_ci`) | horaires enrichis de statut `programme` à cette date, triés par heure |
| `listHoraires({id_compagnie, date_min, date_max, id_trajet})` | tous facultatifs | horaires enrichis triés par date puis heure |
| `getHoraire(id)` | | horaire enrichi ou `null` |
| `createHoraire(d)` / `updateHoraire(id, patch)` | `id_trajet, id_bus, date_depart, heure_depart, heure_arrivee, tarif_fcfa, statut` | horaire enrichi |
| `deleteHoraire(id)` | | `IN_USE` s'il existe une réservation (même annulée) |
| `getOccupiedSeats(id_horaire)` | | tableau trié des `numero_place` des réservations **non annulées** |

### Réservations
| Fonction | Paramètres | Retour |
|---|---|---|
| `createReservation(d)` | `numero_ticket, id_utilisateur, id_horaire, numero_place, nom_passager, prenom_passager, telephone_passager, piece_identite, statut` | réservation enrichie. **Atomique.** `SEAT_TAKEN`, `DUPLICATE_TICKET`. `date_reservation` = maintenant (UTC) |
| `getReservationByTicket(numero)` / `getReservationById(id)` | | réservation ou `null` |
| `listReservationsByUser(id_utilisateur)` | | tableau, départs les plus récents d'abord |
| `listReservations({id_compagnie, statut, q, id_horaire, limit})` | `q` cherche dans ticket, nom, prénom, téléphone du passager | tableau, plus récentes d'abord, au plus `limit` lignes (200 par défaut) |
| `cancelReservation(id)` | | réservation avec `statut='annulee'`, `date_annulation` = maintenant ; **la place est libérée** |
| `updateReservationStatus(id, statut)` | | réservation ; `SEAT_TAKEN` si on réactive une réservation annulée dont la place a été reprise |
| `expirePendingReservations(cutoffIso)` | date ISO UTC | nombre de réservations `en_attente` **créées avant** cette date passées à `annulee` (place libérée) |

### Paiements
| Fonction | Paramètres | Retour |
|---|---|---|
| `createPayment(d)` | `id_reservation, montant_fcfa, mode, reference_transaction, statut` | paiement créé |
| `getPaymentByReference(ref)` | | paiement ou `null` |
| `getLatestPaymentByReservation(id_reservation)` | | le plus récent, ou `null` |
| `updatePayment(id, patch)` | `statut, reference_transaction, mode` | paiement |
| `listPayments({id_compagnie})` | `id_compagnie` facultatif | paiements, du plus récent au plus ancien, enrichis de : `numero_ticket, id_compagnie, compagnie_nom, ville_depart, ville_arrivee, utilisateur_nom` (sert à l'écran « Paiements » de l'administration) |

### Chauffeurs, avis et pourboires
| Fonction | Paramètres | Retour |
|---|---|---|
| `listChauffeurs({id_compagnie})` | | chauffeurs `{id_chauffeur, id_compagnie, prenom, photo, compagnie_nom, note, nb_avis}` (`note` = moyenne sur 5 ou `null`) |
| `getChauffeur(id)` / `createChauffeur(d)` / `updateChauffeur(id, patch)` | `id_compagnie, prenom, photo` | chauffeur ou `null` |
| `deleteChauffeur(id)` | | `true` ; `IN_USE` si un voyage, un avis ou un pourboire s'y rapporte |
| `createAvis(d)` | `id_reservation, id_horaire, id_chauffeur, id_utilisateur, note (1-5), commentaire` | avis ; `DUPLICATE_AVIS` s'il en existe déjà un pour cette réservation |
| `getAvisByReservation(id)` | | avis ou `null` |
| `listAvis({id_compagnie, id_chauffeur, limit})` | | avis, plus récents d'abord, avec `chauffeur_prenom` |
| `createTip(d)` / `getTipByReference(ref)` / `updateTip(id, {statut})` | `id_reservation, id_chauffeur, montant_fcfa, mode, reference_transaction, statut` | pourboire (`en_attente`, `reussi`, `echoue`) |
| `listTips({id_compagnie, id_chauffeur, id_reservation})` | | pourboires, plus récents d'abord |

Ajouts à d'autres entités : `deleteUser(id)` (`IN_USE` s'il a des réservations ou des avis), `bus.photo`, `horaire.id_chauffeur` et `horaire.photo_bus`, `utilisateur.consentement_date` / `consentement_version`. Les vues de voyage et de réservation exposent `photo_bus`, `bus_photo`, `id_chauffeur`, `chauffeur_prenom`, `chauffeur_photo`, `chauffeur_note`, `chauffeur_nb_avis`.

### Statistiques
| Fonction | Paramètres | Retour |
|---|---|---|
| `getStats({today, id_compagnie})` | `today` = `"AAAA-MM-JJ"` (heure du Bénin) | `{reservations_du_jour, trajets_actifs, taux_remplissage, utilisateurs}` |

`reservations_du_jour` : réservations non annulées créées ce jour. `trajets_actifs` : voyages `programme` dont la date est ≥ `today`. `taux_remplissage` : entier 0 à 100 = places occupées / places totales de ces voyages. `utilisateurs` : nombre de voyageurs (`null` si `id_compagnie` est fourni).

## Procédure conseillée

1. Installer MySQL 8, exécuter `database/voyageo_mysql_production.sql` puis `database/voyageo_extensions_site.sql`.
2. Créer le compte dédié (pas `root`) avec `database/voyageo_compte_applicatif.sql`.
3. Renseigner `DB_DRIVER=mysql`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` dans `.env`.
4. `npm install`, puis `npm run check:db`.
5. Sur une **base de test vide** : `CONTRACT_TEST_USE_ENV=1 npm test`. Les 12 tests du contrat doivent passer.
6. `npm start` : le compte administrateur du `.env` et les données de démonstration sont créés automatiquement.
