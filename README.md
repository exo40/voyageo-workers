# Voyagéo : réservation de tickets de bus au Bénin

Projet scolaire DWM (Première, HTC-CETIP) : site web de réservation de tickets de bus.
Technologies : HTML5, CSS3, Bootstrap 5, JavaScript, Node.js, Express.js. Base de données : adaptateur interchangeable (JSON pour tester, MySQL ou autre pour la vraie base).

## Démarrer en 3 minutes

1. Installer **Node.js 20.12 ou plus récent** (https://nodejs.org, version LTS).
2. Dans le dossier du projet :
   ```
   npm install
   npm start
   ```
3. Ouvrir http://localhost:3000

Au premier démarrage, le site crée automatiquement :
- le **compte administrateur** défini dans le fichier `.env` (`ADMIN_EMAIL` et `ADMIN_PASSWORD`) ;
- des **données de démonstration** fictives (2 compagnies, 4 bus, environ 560 départs sur 14 jours). Mettre `DEMO_DATA=false` pour les désactiver.

L'administration est sur http://localhost:3000/admin (ou le bouton « Administration » du menu après connexion).

> **Le fichier `.env` contient des secrets** (mot de passe administrateur, clés de paiement, mot de passe de la base). Ne le publiez jamais sur GitHub (il est déjà dans `.gitignore`). Pour changer le mot de passe administrateur : menu « Mon compte ». Si vous l'oubliez : modifiez `ADMIN_PASSWORD` dans `.env` puis `npm run admin:reset`.

## Assistant (bot), WhatsApp et lieux d'embarquement

- **Bot** : bulle de discussion en bas à droite de chaque page. Il répond avec les vraies données du site (départs, tarifs, lieux d'embarquement) et chaque réponse propose « Continuer sur WhatsApp » avec la question déjà écrite. Code : `src/services/botService.js`, `public/js/chatbot.js`.
- **Service client WhatsApp** : numéro réglé dans `.env` (`WHATSAPP_NUMBER=22960315810`, `WHATSAPP_DISPLAY`). Affiché dans le bot, le bouton vert flottant et le pied de page.
- **Lieu d'embarquement + Google Maps** : dans Administration > Trajets, renseignez « Lieu d'embarquement » et collez le lien Google Maps (Partager > Copier le lien). Affiché dans les résultats, la page de réservation et le ticket (bouton « Voir sur Maps »). Sans lien, une recherche Maps sur le nom du lieu est utilisée.
- **Base MySQL** : voir la section « Base de données MySQL » ci-dessous (les anciennes migrations sont archivées dans `database/ancien_schema/`).

## Code de confirmation, mot de passe oublié, paiement FedaPay

- **Inscription avec code** : après le formulaire, un code à 6 chiffres est envoyé par e-mail (valable 15 min, 5 essais, renvoi toutes les 60 s). Le compte n'est créé qu'une fois le code saisi. Désactivable avec `EMAIL_VERIFICATION=false`.
- **Mot de passe oublié** : lien sur la page de connexion, code par e-mail puis nouveau mot de passe. Le site répond de la même façon que l'adresse existe ou non.
- **Codes en mémoire** (`src/services/codeStore.js`) : aucune table à ajouter. Ils disparaissent si le serveur redémarre (on redemande un code).
- **Réglage e-mail (SMTP)** obligatoire pour recevoir les codes : voir `.env.example` (exemple Gmail). Sans SMTP, en développement, le code s'affiche dans la console du serveur.
- **FedaPay** : `PAYMENT_MODE=fedapay` + clés dans `.env`. Le voyageur réserve, est redirigé vers FedaPay, paie, puis revient sur son ticket (confirmé uniquement si FedaPay confirme le paiement). Un webhook (`/paiement/webhook`) sécurise le cas où il ferme la page avant le retour.

- **Pas de ticket sans paiement** : tant que le paiement n'est pas confirmé (par FedaPay ou en simulation), la réservation reste « en attente » : aucun ticket, aucun QR code, et le retour d'un paiement non abouti ramène sur la page de paiement. Le ticket n'apparaît (et n'est envoyé par e-mail) qu'après confirmation.
- **Paiements par compagnie** : Administration > Paiements : total encaissé, nombre de paiements réussis / en attente / échoués par compagnie, et liste des derniers paiements. Un gestionnaire ne voit que sa compagnie.

## Commandes

| Commande | Rôle |
|---|---|
| `npm start` | Lance le site |
| `npm run dev` | Lance le site et le redémarre à chaque modification |
| `npm test` | Lance les tests automatiques (contrat base de données, API, paiement) |
| `npm run check:db` | Vérifie l'adaptateur de base de données choisi dans `.env` |
| `npm run seed` | Crée les données de démonstration si la base est vide |
| `npm run admin:reset` | Réinitialise le compte administrateur du `.env` |

## Structure

```
server.js              Démarrage (base de données, admin, démo, serveur)
.env / .env.example    Configuration (secrets)
public/                FRONTEND : pages HTML, css/voyageo.css, js/*.js, img/
private/admin.html     Page d'administration (servie seulement aux administrateurs)
src/app.js             Assemblage Express (sécurité, sessions, routes)
src/routes/            BACKEND : routes de l'API (auth, public, reservations, paiements, admin)
src/services/          Règles métier (réservation, catalogue, paiement, e-mail, mots de passe)
src/db/                COUCHE BASE DE DONNÉES : index.js, contract.js, adapters/ (json, mysql, _template)
src/payments/          Prestataires de paiement (fedapay, kkiapay)
database/               Scripts MySQL 8 : production, extensions du site, compte applicatif (ancien_schema/ = archive)
docs/                  Contrat de la base de données + fiche technique PDF
tests/                 Tests automatiques
```

## Documentation

- **`docs/FICHE_TECHNIQUE_Voyageo.pdf`** : où brancher la base de données, les clés de paiement, l'e-mail, la mise en ligne.
- **`docs/CONTRAT_BASE_DE_DONNEES.md`** : liste précise des fonctions que la base de données doit fournir.

## Rôles

- **Visiteur** : consulte et recherche les voyages.
- **Voyageur** : réserve, paie (option), télécharge/imprime son ticket, annule (jusqu'à 24 h avant le départ).
- **Gestionnaire de compagnie** : gère les bus, trajets, voyages et réservations de **sa** compagnie.
- **Administrateur** : gère tout (compagnies, utilisateurs, réservations).

---

## Version 1.1 : administration premium, paiements fiabilisés

### Ce qui a changé
- **Tableau de bord** (`/admin`) : chiffres 100 % réels (période 7 / 30 / 90 / 365 jours, comparaison avec la période précédente), 7 graphiques, alertes, tableau des prochains départs, activité récente. Aucune donnée fictive : une donnée absente vaut 0.
- **Gestionnaire** : même interface, limitée à sa compagnie. La restriction est appliquée **côté serveur sur chaque route** (une fiche d'une autre compagnie répond « introuvable »).
- **Modules** : fiches détaillées (voyage avec plan des places et passagers, réservation avec paiements et historique, compagnie, bus, utilisateur), recherche, filtres, pagination côté serveur, confirmations avant les actions sensibles, exports CSV (réservations, voyages, paiements).
- **Journal d'audit** : réservations, paiements, annulations, modifications, suspensions de comptes, exports. Page « Activité ».
- **Paiements** : distinction claire *confirmé / simulé / en attente / à vérifier / échoué / à rembourser / remboursé*. Les paiements simulés ne sont jamais comptés comme argent encaissé.
- **Règles métier** : conflit de bus (chevauchement + 30 min de battement), doublons de trajets et de compagnies, compagnie désactivée = plus aucune vente, un voyage annulé ne se réactive pas, comptes administrateurs protégés (compte principal du `.env`, dernier administrateur actif), mot de passe temporaire généré par l'administrateur (affiché une seule fois).

### Corrections de fiabilité (paiements)
| Risque | Avant | Maintenant |
|---|---|---|
| Double clic sur « payer » | Plusieurs transactions possibles | Transaction en cours **reprise** ; verrou par réservation |
| Retour navigateur + webhook simultanés | Confirmation potentiellement doublée | Confirmation **idempotente** sous verrou |
| Montant payé ≠ tarif | Ticket confirmé | **Non confirmé**, signalé « à vérifier » |
| Paiement reçu mais place prise | Paiement marqué « échoué » (argent invisible) | Reste « réussi » et apparaît **« à rembourser »** |
| Client qui paie deux fois | Non détecté | Détecté (« doublon »), à rembourser |

Le verrou protège un seul processus Node. Avec **plusieurs serveurs**, il faut en plus une contrainte en base (une seule transaction « réussie » par réservation).

### Migration de base de données (MySQL / MariaDB uniquement)
Une table est ajoutée, **aucune donnée n'est modifiée** :
```
mysql -u voyageo_user -p voyageo < database/ancien_schema/migration_journal_audit.sql
```
Avec l'adaptateur JSON (`DB_DRIVER=json`), rien à faire.

### Nouvelles routes (les anciennes sont inchangées)
`GET /api/admin/tableau-de-bord?jours=` · `GET /api/admin/activite` · `GET /api/admin/{horaires,reservations,bus,compagnies,utilisateurs}/:id` · `POST /api/admin/paiements/:id/rembourse` (admin) · `POST /api/admin/utilisateurs/:id/reinitialiser-mot-de-passe` (admin) · `GET /api/admin/export/{reservations,voyages,paiements}.csv`.
Les listes acceptent `?page=&limite=` ; sans ces paramètres elles gardent l'ancien comportement.

### Notes de sémantique
- `GET /api/admin/paiements` : `montant_fcfa` ne compte plus que l'argent **réel** ; la démonstration est dans `montant_simule_fcfa`.
- Une réservation expirée dont le paiement arrive quand même est confirmée si la place est libre, sinon signalée « à rembourser ».
- Le chiffre d'affaires est daté du jour de création de la transaction (la base ne conserve pas l'heure de confirmation).
- Voyagéo ne **déclenche pas** de remboursement chez FedaPay : l'administrateur rembourse puis clique « Marquer remboursé ».
- Le webhook FedaPay n'est pas vérifié par signature : il est traité comme une simple notification et le statut ET le montant sont toujours relus chez FedaPay.
- Un mot de passe réinitialisé ne ferme pas les sessions déjà ouvertes (stockage de sessions en mémoire).

### Tests
`npm test` exécute toute la suite. Les tests `admin-routes.test.js` exécutent la logique des routes via un mini-Express de test (`tests/support/fake-express.js`) et fonctionnent même sans `npm install`.

---

## Version 1.2 : agences inscrites, abonnement, encaissement direct

### Parcours d'une agence
1. **Inscription** sur `/inscription-agence.html` : crée la compagnie et son compte gestionnaire (code de confirmation par e-mail comme pour les voyageurs). Lien depuis le pied de page et la page d'inscription.
2. **Espace verrouillé** : tant que l'abonnement n'est pas payé, le gestionnaire ne voit que la page « Abonnement ». Le serveur refuse toutes les autres routes (erreur 402 `SUBSCRIPTION_REQUIRED`), pas seulement l'interface.
3. **Abonnement** : 20 000 FCFA pour 30 jours (`SUBSCRIPTION_PRICE_FCFA`, `SUBSCRIPTION_DURATION_DAYS`), payé sur **votre** compte FedaPay (clés du `.env`). Statut ET montant sont vérifiés auprès de FedaPay ; une transaction n'active l'abonnement qu'une seule fois ; le renouvellement s'ajoute à la période en cours.
4. **Encaissement des tickets** : le gestionnaire saisit **ses** clés FedaPay (publique + secrète) dans son espace. Dès lors, les clients le paient directement sur son compte.
5. Tant que l'agence n'a pas payé son abonnement et enregistré ses clés (en mode `fedapay`), **ses voyages ne sont ni proposés ni réservables**.

L'administrateur voit l'état d'abonnement de chaque compagnie (page « Compagnies »), peut **activer** (paiement en espèces), **suspendre** ou **dispenser** une compagnie, avec journal. Les compagnies créées par l'administrateur sont « sans abonnement » : elles fonctionnent comme avant, avec le compte FedaPay de la plateforme.

### Sécurité des clés FedaPay des agences
- La clé secrète est **chiffrée** (AES-256-GCM) dans une table séparée ; elle n'est jamais renvoyée au navigateur (affichage masqué), jamais écrite dans le journal, jamais visible par l'administrateur.
- Enregistrer ou supprimer des clés exige le **mot de passe** du gestionnaire (blocage après 5 échecs en 15 minutes).
- Les clés sont refusées si leur forme est invalide, si sandbox et live sont mélangés, ou si FedaPay les rejette (401/403).
- **`ENCRYPTION_KEY`** : à définir une fois et ne plus changer. Si elle change (ou si `SESSION_SECRET` change en son absence), les agences devront ressaisir leurs clés.

### Webhook par compagnie
Chaque compagnie ajoute dans son compte FedaPay l'adresse `APP_BASE_URL/paiement/webhook/<id_compagnie>` (affichée dans son espace) pour que le ticket soit confirmé même si le client ferme la page. Les références de transaction sont enregistrées `numéro@compagnie` : deux comptes FedaPay qui produisent le même numéro ne se confondent pas.

### Migration MySQL (en plus de celle de la v1.1)
```
mysql -u voyageo_user -p voyageo < database/ancien_schema/migration_agences_abonnement.sql
```
Ajoute 2 colonnes à `compagnie` et 2 tables. Les compagnies existantes restent « sans abonnement » (aucune n'est bloquée).

### À savoir
- La durée par défaut est de 30 jours (abonnement mensuel) : changez `SUBSCRIPTION_DURATION_DAYS` (ex. 365) si l'abonnement est annuel.
- Le contrôle des clés auprès de FedaPay et le paiement réel n'ont **pas** pu être testés avec les serveurs FedaPay : à essayer en `sandbox` avant la mise en production, en comparant avec la documentation officielle.
- Voyagéo ne perçoit aucune commission sur les tickets (l'argent va directement à la compagnie). L'abonnement est la seule recette.
- Les mots de passe oubliés / sessions ouvertes : voir v1.1.


## Nouveautés de cette version
- **Accueil animé** (bus qui roule, nuages, apparition au défilement ; désactivé automatiquement pour les personnes qui ont réglé leur appareil sur « réduire les animations») et **destinations populaires** plus attirantes (titre, accroche, prix « dès », départs du jour).
- **Photos** : les illustrations livrées sont dans `public/img/`. Pour de vraies photos de destinations, déposez `public/img/destinations/<ville>.jpg` (ex. `parakou.jpg`, `porto-novo.jpg`, `cotonou.jpg`, `bohicon.jpg`, `abomey-calavi.jpg`) : elles remplacent l'illustration.
- **Photo du bus** : l'administration et les agences l'ajoutent sur le bus (et peuvent la remplacer pour un voyage précis) ; elle est visible côté voyageur (résultats, enregistrement, ticket).
- **Chauffeurs** (prénom seul + photo), **notes en étoiles** et **pourboires** après le voyage. Menu « Chauffeurs » dans l'administration.
- **Suppression définitive d'un compte** (Utilisateurs → corbeille), en plus de la suspension.
- **Consentement** : case obligatoire à l'inscription, demandée une fois à la connexion pour les comptes existants ; pages `confidentialite.html` et `conditions.html`. Si vous modifiez ces textes, changez `legal.version` dans `src/config.js` : tout le monde devra réaccepter.
- **Lieu d'embarquement** obligatoire pour chaque trajet, affiché en évidence sur la page d'enregistrement (avec case à cocher) avant le paiement ; le ticket n'est délivré qu'après paiement.
- Les photos envoyées sont enregistrées dans `data/uploads/` (à sauvegarder avec la base de données).

### Mise à jour d'une base MySQL existante
Exécutez une seule fois `database/ancien_schema/migration_photos_chauffeurs_avis.sql` (archive : une base neuve utilise les trois scripts ci-dessus). Avec le stockage JSON, rien à faire.

- **Thème clair / sombre** : bouton lune/soleil dans l'en-tête du site et dans l'administration. Le choix est mémorisé sur l'appareil ; sans choix, le site suit le réglage de l'appareil.
- **Icônes** : tous les emojis ont été remplacés par des icônes vectorielles (`public/js/icons.js`).
- **Ticket PDF** : le bouton « Télécharger le ticket (PDF) » ouvre l'impression du navigateur (choisir « Enregistrer au format PDF ») ; le rendu est identique au ticket affiché à l'écran, quel que soit le thème.


## Base de données MySQL (production)

Prérequis : **MySQL 8.0.16 ou plus récent** (testé sur 8.0.46). MariaDB et le MariaDB de XAMPP ne sont pas compatibles.

1. Créer la base (compte administrateur MySQL), dans cet ordre :
   ```
   mysql -u root -p --default-character-set=utf8mb4 < database/voyageo_mysql_production.sql
   mysql -u root -p --default-character-set=utf8mb4 < database/voyageo_extensions_site.sql
   ```
2. Dans `database/voyageo_compte_applicatif.sql`, remplacer `CHANGER_CE_MOT_DE_PASSE` (16 caractères minimum), puis l'exécuter. Ne jamais le enregistrer rempli sur GitHub.
3. Dans `.env` : `DB_DRIVER=mysql`, `DB_USER=voyageo_app`, `DB_PASSWORD=` (le même mot de passe), `DB_HOST`, `DB_PORT`, `DB_NAME=voyageo`.
4. `npm install`, `npm run check:db`, puis `npm start` (le compte administrateur du `.env` est créé au premier démarrage).

Règles appliquées par la base elle-même (le site les respecte et affiche leur message) : une place = un voyageur, un bus ne peut pas faire deux voyages qui se chevauchent, un seul paiement réussi par réservation, montant du paiement = prix convenu de la réservation, un trajet par paire de villes et par compagnie, type de bus Standard / Climatisé / Minibus, durée de trajet obligatoire, annulation d'un voyage seulement après celle de ses réservations.

Tests : `npm test` (fichier JSON, sans installation). Pour rejouer TOUT sur une base MySQL de **test** vide : définir `DB_*` de cette base, puis `APP_TEST_DB=mysql node --test --test-concurrency=1 tests/<fichier>.test.js`, en recréant la base vide avant chaque fichier ; `CONTRACT_TEST_USE_ENV=1 npm test` pour le seul contrat.
