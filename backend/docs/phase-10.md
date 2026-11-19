# Phase 10 — Google Ads

Contrat de la phase 10. La **première plateforme branchée** : Omnipotent s'y authentifie, y connecte
le compte d'un client, puis y pousse des campagnes. Écrit le 2026-11-19, avant la moindre ligne de
code de la phase.

Prérequis : les phases 7 (les comptes) et 9 (le moteur de synchronisation).

Entrées validées : `../../CADRAGE.md` § 12 (les comptes et les secrets) et § 14 (la synchronisation),
l'étude `plateformes/google-ads.md`, `phase-7.md` §§ 2 et 3 (les deux sortes de credentials, le cycle
de vie du lien), `phase-9.md` (l'interface d'adapter), et les accès montés le 2026-11-18
(`../../docs/runbook-acces.md`, partie B).

---

## 1. La phase en trois lots, livrés dans l'ordre

Chaque lot se livre seul et laisse les vérifications au vert (`../../CLAUDE.md`).

| Lot                        | Ce qu'il livre                                                                                                                       | Ce qui le clôt                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| **1. Le moteur commun**    | Ce qui manque au moteur pour une plateforme dont le credential est **le nôtre** : Google, puis Microsoft au même modèle              | Tout couvert contre un faux adapter ; aucun appel à Google                 |
| **2. Connecter un compte** | L'authentification, le client HTTP et son journal, l'invitation, le suivi du lien, la lecture du compte, la commande de consentement | Un vrai compte connecté : son nom, sa devise et son fuseau lus chez Google |
| **3. Les campagnes**       | Le mapping, `apply`, les verdicts de validation, l'éclatement — l'étude `plateformes/google-ads.md` les décrit déjà                  | La liste de clôture de `plateformes/google-ads.md` § 10                    |

Le **lot 3** sera détaillé dans ce document avant d'être commencé : ses questions (le compte de test,
les limites d'objets) attendent des réponses que les lots 1 et 2 vont apporter.

## 2. Ce que « connecter un compte » veut dire chez Google

Un client ne nous donne **aucune clé**. Nous agissons sur son compte par **notre** compte gestionnaire
(le MCC), et c'est lui qui accepte qu'on le gère :

```
 l'admin de l'Organization          Omnipotent                       Google Ads
 ─────────────────────────          ──────────                       ──────────
 donne le customer id   ──────►  invite le compte sous notre MCC ──► invitation en attente
                                 compte `pending`, `link_requested`
                                                                     l'admin du client accepte
                                                                     (Administration → Accès et
                                                                      sécurité → Gestionnaires)
                                 le job `account.links` le voit  ◄── lien `ACTIVE`
                                 lit le nom, la devise, le fuseau
                                 compte `active`
```

Les autres issues, qui sont exactement la table de transitions de `phase-7.md` § 3 :

| Ce que Google répond                                                            | Ce que devient le compte                                                                    |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `REFUSED` ou `CANCELED`                                                         | `invalid`, `link_declined`                                                                  |
| Toujours `PENDING` passé **30 jours**                                           | nous retirons l'invitation (Google ne le fait pas lui-même), puis `invalid`, `link_expired` |
| `INACTIVE` après avoir été `ACTIVE`                                             | `invalid`, `link_revoked`                                                                   |
| Le compte refuse nos appels (`USER_PERMISSION_DENIED`, `CUSTOMER_NOT_ENABLED`…) | `invalid`, `credentials_rejected`                                                           |

Les trente jours sont ceux de multi-search, et un réglage (`linkRequestLifetimeDays`).

## 3. Les credentials : les nôtres, une fois pour tous les clients

Ce sont ceux de `phase-7.md` § 2, première ligne : les credentials **de l'application**. Aucun
`AdAccount` Google ne porte de `secretName`.

| Secret                       | Ce que c'est                                            | Ce qu'il permet                                                                                         |
| ---------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `google-ads/service-account` | la clé JSON du compte de service, administrateur du MCC | tout lire et tout écrire sur un compte lié                                                              |
| `google-ads/inviter`         | `{ clientId, clientSecret, refreshToken }`              | **inviter** un compte, et retirer une invitation : Google refuse ces deux gestes à un compte de service |

Et un réglage qui n'est pas secret : l'identifiant du MCC, qui part en en-tête `login-customer-id` de
chaque appel (`A-FAIRE.md` § 2).

Le `refreshToken` de l'inviteur s'obtient **une fois**, par une commande que Lorin lance sur son poste
(`pnpm google:connect`, transcrite de multi-search) : elle ouvre la page de consentement de Google,
l'admin humain du MCC accepte, et la commande range le jeton dans le magasin local. `pnpm secrets:seed`
l'envoie ensuite sur AWS.

## 4. Lot 1 — ce qui manque au moteur

Le moteur de la phase 9 a été écrit pour des plateformes où **chaque compte a sa clé**. Google n'en a
pas. Ce qui en découle, et qui vaudra tel quel pour Microsoft :

### 4.1 Le moteur saute toute unité sans secret de compte

`syncUnit` (`src/services/sync.service.ts`) s'arrête sur `if (!account.secretName) return;`, et
`PlatformContext.credentials` ne porte que ce secret. Tel quel, **aucune unité Google ne serait jamais
synchronisée**, et sans aucune erreur pour le dire.

**La réponse** : l'adapter déclare **comment** sa plateforme se connecte, `connection`, avec deux
valeurs :

- `manager_link` — notre compte gestionnaire gère le sien, le client accepte un lien, et les
  credentials sont les nôtres (Google, Microsoft) ;
- `account_secret` — chaque compte apporte son secret (OpenAI, Thrad, et les DSP selon leur étude).

Pour `manager_link`, le moteur n'exige pas de `secretName` et `credentials` vaut `null`. L'adapter
reçoit **à sa construction** de quoi lire nos secrets, au dernier moment et jamais plus tôt : c'est ce
que fait le `registry.ts` de multi-search.

La déclaration est **sur l'adapter**, pas dans `PLATFORM_RULES` : le registre des règles est clé par
couple `(plateforme, levier)`, alors que la façon de se connecter est celle de la plateforme entière.

### 4.2 Un refus de nos credentials ne doit pas condamner le compte du client

Aujourd'hui, une `PlatformError` portant `invalidCredentials` passe l'`AdAccount` en `invalid`. Si
c'est **notre** clé de compte de service qui est révoquée, chaque compte client deviendrait `invalid`
d'un coup, alors que les clients n'y sont pour rien et ne peuvent rien y faire.

**La réponse** : `PlatformError` gagne `ownCredentials`, comme chez multi-search. Quand il est vrai :

- le compte **reste** `active` ;
- l'unité passe en erreur avec un code stable, `sync_platform_credentials_failed`, et un journal de
  niveau `error`, parce que c'est à un opérateur d'agir ;
- elle est **réessayée** avec le recul habituel, plafonné : une fois le secret réparé, tout repart sans
  que personne ait à relancer chaque unité.

Les codes qui le déclenchent chez Google (`UNAUTHENTICATED`, `NOT_ADS_USER`,
`CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION`) sont listés dans `plateformes/google-ads.md` § 4.

### 4.3 L'interface ne sait que pousser

`PlatformAdapter` n'a que `apply` (`src/platforms/platform-adapter.ts`). Il lui faut, pour une
plateforme `manager_link`, quatre méthodes de plus, facultatives, aux noms de multi-search :

| Méthode                        | Ce qu'elle fait                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `requestLink(reference)`       | Invite le compte, **sauf** si notre MCC le gère déjà ; répond `pending` ou `active` |
| `linkStatuses()`               | L'état de **tous** les liens de notre MCC, en **un seul** appel                     |
| `cancelLink(reference)`        | Retire une invitation en attente ; sans effet s'il n'y en a plus                    |
| `readLinkedAccount(reference)` | Lit le nom, la devise, le fuseau, et s'il s'agit lui-même d'un MCC                  |

`reference` est le compte **tel que le client le lit** dans son interface : le customer id chez
Google, le numéro de compte chez Microsoft, où il diffère de l'identifiant des appels.

### 4.4 Le compte : ce que le client ne peut pas déclarer

Aujourd'hui, `POST /ad-accounts` exige un nom, une devise et un fuseau, **déclarés**, et
`PUT /ad-accounts/:id/status` laisse un admin passer le compte en `active` à la main (`phase-7.md`
§§ 3 et 4, un compromis écrit « tant qu'aucun adapter n'existe »). Pour une plateforme `manager_link`,
ce compromis devient dangereux :

- **la devise ne se devine pas.** Une devise déclarée fausse se paierait en argent réel
  (`../../CADRAGE.md` § 12). Elle est donc **lue chez Google** à l'acceptation, et vide jusque-là. Le
  nom et le fuseau aussi. Le corps de la connexion ne porte que la plateforme et le customer id ;
- **le statut vient de Google, pas de l'appelant.** Un `active` posé à la main ferait pousser des
  campagnes sur un compte dont le client n'a jamais accepté le lien. La transition à la main est donc
  **refusée** pour un compte `manager_link`, sauf `invalid → pending`, qui **renvoie une invitation** ;
- **une marque ne se relie qu'à un compte dont la devise est connue**, donc accepté.

Deux colonnes s'ajoutent, celles de multi-search : `linkRef`, la référence du lien, et
`linkRequestedAt`, d'où partent les trente jours.

### 4.5 Un compte lié à notre MCC n'appartient qu'à une Organization

**C'est le point de sécurité de la phase.** Notre compte de service gère **tous** les comptes liés à
notre MCC, quelle que soit l'Organization qui les a connectés. Or l'index unique d'aujourd'hui est
`(organization, plateforme, externalId)` : une **autre** Organization pourrait donc connecter le même
customer id. Si le lien est déjà actif, Google répondrait « déjà géré », le compte passerait `active`,
et cette Organization achèterait sur le compte d'un client qui ne lui a rien accordé.

**La réponse**, celle de multi-search :

- un index unique sur `(plateforme, linkRef)` parmi les comptes vivants : un compte lié n'est tenu que
  par **une** Organization. Une seconde reçoit **409 `ad_account_linked_elsewhere`**, sans savoir
  laquelle le tient ;
- un compte que notre MCC gère **déjà**, et qu'aucune Organization ne tient, n'a pas été accordé par
  son client à celle qui le demande. Il ne passe donc `active` que dans deux cas :
  - un **super-admin** le connecte. C'est lui qui sait pour quel client notre MCC le gère, et il agit
    pour ce client : **règle de Lorin, le 2026-11-19**, « sinon n'importe quel user peut le faire » ;
  - ou l'Organization qui l'a **tenu en dernier** le reconnecte, après l'avoir déconnecté.

  Toute autre reçoit **409 `ad_account_already_managed`**. L'admin d'une Organization ne suffit pas :
  pour la plateforme, c'est un utilisateur parmi d'autres. Le client doit alors mettre fin au lien chez
  Google, puis accepter une nouvelle invitation.

Déconnecter un compte **retire son invitation** si elle est encore en attente. Un lien déjà actif reste
en place : c'est au client d'y mettre fin, et c'est ce qui permet de reconnecter son compte sans lui
redemander son accord.

### 4.6 Le job `account.links`

Déjà prévu par `plan.md` et `phase-7.md` § 3, il est écrit par cette phase. Toutes les **15 minutes**,
pour chaque plateforme `manager_link` :

- il ne fait **rien** s'il n'existe aucun compte `pending` ou `active` de cette plateforme — le coût
  reste proportionnel au travail (`../../CADRAGE.md` § 14) ;
- sinon, **un** appel `linkStatuses()`, quelle que soit la quantité de comptes, puis les transitions du
  § 2. À l'acceptation, **un** `readLinkedAccount` par compte accepté, pour sa devise et son fuseau ;
- un compte qui se révèle être **lui-même un MCC** à l'acceptation passe `invalid` : un compte
  gestionnaire ne diffuse aucune campagne.

Chaque transition passe par la même méthode de service que la route, avec sa table de transitions, et
marque les unités du compte comme le fait déjà une écriture du compte (`phase-9.md`).

## 5. Lot 2 — connecter un compte Google

Tout est **transcrit de multi-search** (`~/OmniAd/multi-search/backend/src/platforms/`), qui l'a fait
tourner contre la vraie API :

| Ce qu'on écrit                                                                                     | D'où il vient chez multi-search                                                    |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Le client HTTP commun : délai, **une ligne de journal par appel**, erreurs typées                  | `platform-http.ts` — le journal existe déjà chez nous (`platform-call.service.ts`) |
| Le jeton du compte de service : un JWT signé RS256, échangé, gardé jusqu'à son expiration          | `google/google.auth.ts`, `GoogleServiceAccountAuth`                                |
| Le jeton de l'inviteur, depuis son `refreshToken`                                                  | `google/google.auth.ts`, `GoogleInviterAuth`                                       |
| Le client Google Ads : `search` (GAQL), `mutate`, les deux en-têtes, la classification des erreurs | `google/google.client.ts`                                                          |
| Les quatre méthodes du § 4.3                                                                       | `google/google.adapter.ts`                                                         |
| La commande de consentement                                                                        | `google/google-connect.ts` et `scripts/google-connect.ts`                          |

**La version de l'API** est celle de multi-search, `v25`, dont l'arrêt est prévu en **août 2027**
(l'étude de multi-search, lue sur la documentation de Google le 2026-10-07). Monter de version est un
changement d'une ligne, suivi d'une relecture des notes de version.

**Sans le MCC configuré, Google n'a pas d'adapter**, comme chez multi-search : l'application démarre,
et une connexion Google répond `platform_not_connectable`. Un poste de développement sans les secrets
Google reste donc utilisable pour tout le reste. C'est l'inverse d'omnipass, sans lequel l'application
refuse de démarrer, et c'est voulu : sans omnipass, aucune requête n'aurait de sens.

### Les codes d'erreur du lot

| Code                           | Statut | Quand                                                                                | `params`                |
| ------------------------------ | ------ | ------------------------------------------------------------------------------------ | ----------------------- |
| `ad_account_reference_invalid` | 400    | Le customer id n'a pas dix chiffres, tirets permis                                   | `platform`, `field`     |
| `ad_account_field_read`        | 400    | Une devise, un fuseau ou un nom déclarés pour un compte dont la plateforme les donne | `platform`, `field`     |
| `ad_account_status_read`       | 400    | Une transition à la main sur un compte dont la plateforme tient le statut            | `platform`, `to`        |
| `ad_account_currency_unknown`  | 400    | Relier une marque à un compte pas encore accepté                                     | `status`                |
| `ad_account_manager`           | 400    | Le compte est lui-même un MCC                                                        | `platform`, `reference` |
| `ad_account_linked_elsewhere`  | 409    | Une autre Organization tient ce compte (§ 4.5)                                       | `platform`              |
| `ad_account_already_managed`   | 409    | Notre MCC le gère déjà sans que le client l'ait accordé à celle-ci                   | `platform`              |
| `platform_not_connectable`     | 400    | Aucun adapter pour cette plateforme, ou pas configuré                                | `platform`              |
| `platform_credentials_failed`  | 502    | **Nos** credentials ont échoué : un opérateur doit agir                              | `platform`              |
| `platform_unavailable`         | 503    | La plateforme ne répond pas, ou demande d'attendre                                   | `platform`              |

Ils iront dans `error-codes.md` avec le code, comme toujours.

## 6. Comment la phase se teste

- **Aucun test n'appelle Google** (`../../CADRAGE.md` § 14). Le client se couvre contre un faux
  `fetch`, l'adapter contre un faux client, le moteur et le job contre un faux adapter.
- **Le moteur** : une unité `manager_link` sans `secretName` est synchronisée ; un `ownCredentials`
  laisse le compte `active` et l'unité réessayable ; un `invalidCredentials` seul l'invalide toujours.
- **Le job** : chaque ligne du § 2, et zéro appel quand aucun compte n'attend.
- **La sécurité** : une seconde Organization reçoit 409 sur un compte tenu ; un compte déconnecté ne
  se reconnecte qu'au même endroit ou par un super-admin ; une transition à la main est refusée.
- **L'intégration** : l'index unique sur `(plateforme, linkRef)` contre une vraie base.
- **Sur le vrai Google**, une seule fois, par Lorin : le consentement de l'inviteur, puis la connexion
  d'un vrai compte client, jusqu'à lire sa devise et son fuseau. C'est la première preuve de
  `plateformes/google-ads.md` § 10.

## 7. Les points présentés à Lorin

**Validés par Lorin le 2026-11-19**, avec la précision du point 6. Rien d'autre n'a été déduit en
silence.

1. **Les credentials Google sont les nôtres** et ne vivent sur aucun compte (§ 3, § 4.1) ; l'adapter
   déclare `manager_link`, et le moteur n'exige plus de secret de compte pour lui.
2. **Un échec de nos credentials ne touche pas le compte du client** (§ 4.2) : l'unité attend et
   réessaie, et l'opérateur est averti.
3. **Quatre méthodes facultatives** s'ajoutent à l'interface d'adapter (§ 4.3).
4. **La devise, le fuseau et le nom d'un compte Google sont lus, jamais déclarés**, et vides tant que le
   client n'a pas accepté (§ 4.4). Une marque ne s'y relie qu'une fois le compte accepté.
5. **Le statut d'un compte Google vient de Google** : la transition à la main est refusée, sauf pour
   renvoyer une invitation (§ 4.4).
6. **Un compte Google n'appartient qu'à une Organization**, et un compte que notre MCC gère déjà ne
   se connecte directement que par un **super-admin** (§ 4.5).
7. **Une invitation sans réponse est retirée après trente jours** (§ 2).
8. **Déconnecter retire l'invitation en attente, mais laisse un lien actif en place** (§ 4.5).
9. **Sans MCC configuré, l'application démarre sans Google** (§ 5).
10. **Avant d'inviter, on regarde si notre MCC gère déjà le compte**, par le compte de service (un
    appel). S'il le gère, le compte est lu et passe `active` sans invitation, donc **sans** le
    consentement de l'inviteur, **mais seulement pour un super-admin** ou pour l'Organization qui l'a
    tenu en dernier (§ 4.5). C'est un écart avec multi-search, qui invite toujours et lit la réponse
    « déjà géré » de Google : l'invitation passe par l'inviteur, qu'une connexion de ce genre n'a
    alors pas à attendre. Les règles du § 4.5 s'appliquent de la même façon.

Et deux questions qui ne sont pas des déductions :

- **quel compte Google Ads connecter en premier** pour la preuve du § 6 — **répondu le 2026-11-19**,
  par un vrai compte client dont le numéro reste hors du dépôt, qui est public. Lu le même jour depuis
  notre MCC : il y est **déjà lié** (`ACTIVE`), en EUR, fuseau Europe/Paris, et ce n'est ni un compte de
  test ni un MCC. Sa connexion prendra donc le chemin « déjà géré » (point 10), et le chemin de
  l'invitation se prouvera sur un autre compte ;
- **quelle adresse consent pour l'inviteur** : probablement `admin@pinkwhale.co`, l'admin humain du
  MCC.

Et un préalable, trouvé et levé le 2026-11-19 : le secret de la clé du compte de service contenait le
chemin du fichier, pas la clé (`A-FAIRE.md` § 2). La clé a été refaite le jour même, et elle est
**vérifiée contre le vrai Google** : un jeton obtenu, puis le compte ci-dessus lu depuis notre MCC.
