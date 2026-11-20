# Phase 11 — Microsoft Advertising

Contrat de la phase 11. La deuxième plateforme branchée, **sur le modèle de Google** : notre compte
gestionnaire Microsoft gère celui du client une fois qu'il a accepté, avec nos credentials. Écrit le
2026-11-20, avant la moindre ligne de code de la phase.

Prérequis : le lot 1 de la phase 10 (le moteur commun, déjà livré), et le lot 2 de la même phase, dont
celle-ci reprend la forme.

Entrées validées : `phase-10.md` §§ 3 à 7 (la connexion par lien, la règle du super-admin, le job
`account.links`), et les accès montés le 2026-11-18 (`../../docs/runbook-acces.md`, partie C).

---

## 1. La phase en deux lots

| Lot                        | Ce qu'il livre                                                                                                                                              | Ce qui le clôt                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **A. Connecter un compte** | Le jeton de notre utilisateur de service, le client de l'API, l'invitation, la lecture d'un compte, et la commande de consentement `pnpm microsoft:connect` | Un vrai compte connecté : son nom, sa devise et son fuseau lus chez Microsoft |
| **B. Les campagnes**       | Le mapping, `apply`, les verdicts de validation — après le lot 3 de la phase 10, qu'il suit                                                                 | Le scénario de `plan.md`, sur un compte à décider                             |

Le lot B sera détaillé ici avant d'être commencé.

## 2. Ce qui change par rapport à Google

Le chemin est le même : le client ne donne aucune clé, nous l'invitons sous notre compte gestionnaire,
un **Super Admin** de son compte accepte (Outils → Tous les comptes → Demandes → Reçues), et le job
`account.links` le voit. Ce qui diffère, et tout vient de multi-search, qui le fait tourner contre la
vraie API (`~/OmniAd/multi-search/backend/src/platforms/microsoft/`) :

- **deux numéros pour inviter.** Microsoft demande le **numéro du compte** (`F123ABCD`) **et** le
  **numéro du client** qui le possède ; sans le second, il répond un 400 vide (multi-search,
  2026-10-18). La référence reste le numéro du compte ; le numéro du client voyage dans le `scope` du
  compte, `{ "customerNumber": "…" }` — c'est exactement ce que le `scope` porte : ce que la plateforme
  exige au-dessus du compte (`phase-7.md` § 1). `requestLink` reçoit donc le `scope` en plus de la
  référence ;
- **un identifiant d'appel différent de la référence.** Le compte se lit par son identifiant numérique,
  que Microsoft ne donne qu'une fois le lien actif : `externalId` le prend à l'acceptation, la
  référence restant dans `linkRef` (`phase-10.md` § 4.3) ;
- **un jeton qui change à chaque renouvellement.** Notre utilisateur de service se connecte par OAuth ;
  chaque renouvellement rend un **nouveau** refresh token, que l'API réécrit dans le magasin de secrets.
  Plusieurs processus peuvent le renouveler : ils le font **sous un verrou** PostgreSQL partagé
  (`pg_advisory_xact_lock`), comme chez multi-search. Microsoft ne révoque pas l'ancien jeton, donc une
  copie un peu en retard reste bonne ;
- **ses propres fuseaux.** Microsoft nomme ses fuseaux à sa façon (`BrusselsCopenhagenMadridParis`) ;
  la table de multi-search les traduit en IANA (`Europe/Paris`). Un fuseau absent de la table est
  **refusé**, jamais deviné : les jours de la plateforme s'y comptent ;
- **des comptes qu'il ne laisse pas gérer** : un compte en mode **Smart** (le client passe en mode
  Expert), un compte **inactif** ou **suspendu**, un compte **prépayé** ; chacun est un refus nommé ;
- **une invitation qui expire d'elle-même** : Microsoft la décline après trente jours (`LinkExpired`).
  Le job y lit `link_expired`, pas un refus du client.

## 3. Les credentials

| Secret                | Ce que c'est                                                        | Écrit par                                                    |
| --------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------ |
| `microsoft-ads/app`   | `{ clientId, clientSecret, developerToken }` de l'application Entra | à la main, le 2026-11-18 — il y est                          |
| `microsoft-ads/oauth` | `{ refreshToken, accessToken, … }` de notre utilisateur de service  | `pnpm microsoft:connect`, puis l'API à chaque renouvellement |

Un réglage, non secret : l'identifiant de notre compte gestionnaire (`A-FAIRE.md` § 2), par
`MICROSOFT_ADS_CUSTOMER_ID`. Sans lui, Microsoft n'a pas d'adapter, comme Google sans son MCC. Ni bac à
sable (C4) ni environnement à choisir : la **production** seule.

**`pnpm microsoft:connect`** est la commande de `pnpm google:connect`, côté Microsoft : une page de
consentement Microsoft, un serveur local sur le port **4102** — celui de l'adresse de retour déclarée
dans l'application Entra le 2026-11-18 (C2) —, et le jeton rangé sans jamais être affiché. Lorin s'y
connecte avec **l'utilisateur de service** dédié, pas avec `admin@pinkwhale.co`, qui entre chez
Microsoft par un compte Google.

**En production**, l'API doit pouvoir **écrire** `microsoft-ads/oauth`, et ce secret seul : c'est à
déclarer dans `infra/` avec ses conteneurs, avant le premier déploiement qui parle à Microsoft.

## 4. Ce que le code ajoute au moteur

Deux retouches au lot 1 de la phase 10, petites :

- `requestLink(reference, scope)` : le `scope` du compte en plus, pour le numéro du client. Google
  l'ignore ;
- un statut de lien de plus, `expired`, que le job traduit en `link_expired`.

## 5. Les points présentés à Lorin

**Les huit points sont validés par Lorin le 2026-11-20.**

1. **Le numéro du client passe par le `scope`** du compte, sans nouveau champ (§ 2).
2. **L'API réécrit le jeton Microsoft à chaque renouvellement**, sous un verrou partagé ; en production
   elle aura le droit d'écrire ce secret-là, et lui seul (§§ 2 et 3).
3. **Un fuseau Microsoft inconnu est refusé**, jamais deviné (§ 2).
4. **Les comptes Smart, inactifs, suspendus ou prépayés sont refusés**, chacun avec sa raison (§ 2).
5. **Une invitation expirée par Microsoft se lit `link_expired`** (§§ 2 et 4).
6. **La commande de consentement tourne sur le port 4102**, avec l'utilisateur de service (§ 3).
7. **Production seule**, sans bac à sable (§ 3).
8. **Déconnecter retire l'invitation en attente**, comme chez Google. multi-search ne le fait que pour
   un lien d'agence ; pour un compte, c'est le même appel, non encore éprouvé : un échec n'empêche pas
   la déconnexion, et Microsoft déclinerait de toute façon l'invitation au bout de trente jours.

Le numéro de notre compte gestionnaire est `K120003KD1` (`A-FAIRE.md` § 2). Le compte à connecter
porte, d'après Lorin, le même identifiant que le gestionnaire : il appartiendrait donc à **notre
propre** client Microsoft, cas que multi-search ne prévoit pas — il exige un lien accepté. Avant de
trancher, on le **constate** : une fois le consentement donné, la liste en lecture seule des comptes
que voit notre utilisateur de service dira à qui chacun appartient. Si c'est le nôtre, un neuvième point
viendra : un compte de notre propre client est actif tout de suite, sans invitation.

Et la question d'origine : **quel compte Microsoft Advertising connecter en premier**, avec son numéro de compte
et le numéro de son client — et notre compte gestionnaire le gère-t-il déjà, comme le premier compte
Google ?
