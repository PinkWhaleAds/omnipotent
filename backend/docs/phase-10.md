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
| **3. Les campagnes**       | Le mapping, `apply`, les verdicts de validation, l'éclatement, et tout ce que fait une campagne Search de multi-search (§ 8)         | Les preuves de ses quatre temps (§ 8.1)                                    |

Le **lot 3** sera détaillé dans ce document avant d'être commencé : ses questions (le compte de test,
les limites d'objets) attendent des réponses que les lots 1 et 2 vont apporter.

**Le compte de test est tranché par Lorin le 2026-11-20** : les preuves se font sur **les vrais
comptes** déjà connectés, et aucun MCC de test Google ni bac à sable Microsoft n'est monté. Il a
précisé le même jour :

- une campagne de test a **10 € de budget au total**, sur toute sa période ; Google en reçoit une part
  par jour ;
- elle est **lancée, puis mise en pause aussitôt**. Le lancement envoie tout à Google sans attendre :
  elle y est donc active quelques instants, le temps de la pause, ses annonces encore en examen ;
- la preuve du **rapport** (`plateformes/google-ads.md` § 10), qui demande des impressions, passe à la
  **phase 15**, qui lit de toute façon les campagnes des phases 10 à 13. Celle du **verdict** d'une
  annonce se tente en pause : si Google n'examine pas une annonce en pause, la question revient à
  Lorin.

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

_Ajouté en écrivant le code, et **validé par Lorin**, le 2026-11-19_ : une cinquième méthode, `referenceOf(saisie)`, pure et
sans appel, qui rend la référence sous sa forme canonique — `555-000-1111` devient `5550001111` — ou
`null` si ce n'en est pas une. Sans elle, deux saisies du même compte passeraient pour deux comptes,
et la règle du § 4.5 tomberait.

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
- **une marque ne se relie qu'à un compte dont la devise est connue**, donc accepté ;
- **le nom et le fuseau ne se changent pas non plus** après coup, `PATCH` répondant
  `ad_account_field_read` : seul le `scope` reste à nous.

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

**Restaurer** un compte lié déconnecté obéit aux mêmes règles : aucune autre Organization ne doit le
tenir, et celle qui le restaure doit être la dernière à l'avoir tenu, ou l'appelant un super-admin.
Il revient `pending`, et le job du § 4.6 lit où en est son lien.

### 4.6 Le job `account.links`

Déjà prévu par `plan.md` et `phase-7.md` § 3, il est écrit par cette phase. Toutes les **15 minutes**,
pour chaque plateforme `manager_link` :

- il ne fait **rien** s'il n'existe aucun compte `pending` ou `active` de cette plateforme — le coût
  reste proportionnel au travail (`../../CADRAGE.md` § 14) ;
- sinon, **un** appel `linkStatuses()`, quelle que soit la quantité de comptes, puis les transitions du
  § 2. À l'acceptation, **un** `readLinkedAccount` par compte accepté, pour sa devise et son fuseau ;
- un compte qui se révèle être **lui-même un MCC** à l'acceptation passe `invalid`, avec un motif
  à lui, `manager_account` : un compte gestionnaire ne diffuse aucune campagne.

Chaque transition passe par la même méthode de service que la route, avec sa table de transitions, et
marque les unités du compte comme le fait déjà une écriture du compte (`phase-9.md`).

## 5. Lot 2 — connecter un compte Google

Tout est **transcrit de multi-search** (`~/PinkWhale/multi-search/backend/src/platforms/`), qui l'a fait
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

**Sans le MCC configuré, Google n'a pas d'adapter**, comme chez multi-search : l'application démarre.
Un poste de développement sans les secrets Google reste donc utilisable pour tout le reste. C'est
l'inverse d'omnipass, sans lequel l'application refuse de démarrer, et c'est voulu : sans omnipass,
aucune requête n'aurait de sens.

_Corrigé en écrivant le code, et **validé par Lorin**, le 2026-11-19_ : ce paragraphe disait qu'une connexion Google
répondrait alors `platform_not_connectable`. Ce n'est pas possible tel que le point 1 est tranché : la
façon de se connecter est déclarée **par l'adapter**, donc sans adapter rien ne dit que Google est une
plateforme `manager_link`. Un compte Google se **déclare** alors comme en phase 7, comme celui de
toute plateforme pas encore branchée. Le danger serait qu'il soit poussé plus tard, une fois l'adapter
présent, sans que son client ait rien accordé : le moteur l'interdit — une unité `manager_link` dont
le compte n'a pas de `linkRef` s'arrête sur `sync_account_not_linked`, définitivement. Le code
`platform_not_connectable` n'existe donc pas.

**Le lot 2 se livre en deux temps** (_décidé le 2026-11-20_) :

- **2a — lire.** Le jeton du compte de service, le client HTTP commun (`src/platforms/platform-http.ts`),
  le client Google Ads, la lecture des liens de notre MCC et celle d'un compte. Cela suffit à connecter
  un compte **que notre MCC gère déjà** — c'est le cas du premier compte que Lorin a donné. Tant que la
  2b n'est pas là, un compte qu'il faudrait **inviter** répond `platform_credentials_failed` : l'adapter
  dit que seul un admin humain du MCC peut inviter, et qu'il faut d'abord lancer `pnpm google:connect`
  (code de la plateforme `inviter_missing`) ;
- **2b — inviter.** Le jeton de l'inviteur, l'envoi et le retrait d'une invitation, et la commande de
  consentement `pnpm google:connect` (`src/platforms/google/google-connect.ts`, et son point d'entrée
  `src/scripts/google-connect.ts`), dont les gestes sont dans `../../docs/runbook-acces.md` B8. Le
  secret de l'inviteur est lu **frais** à chaque échange de jeton : un consentement donné est pris en
  compte sans redémarrer l'API. Un refus de Google garde le code qui dit pourquoi (`TOO_MANY_MANAGERS`
  plutôt que le `INVALID_CHANGE` qui le précède), et c'est lui que l'appelant lit dans
  `ad_account_link_refused`.

Deux écarts avec multi-search, sans effet sur ce qu'on obtient : le client HTTP est écrit sur le
`fetch` de Node, pas sur `axios`, qu'Omnipotent n'a pas — une dépendance de moins ; et l'adapter lit
l'état du lien **avant** d'inviter (point 10 du § 7), là où multi-search invite et lit la réponse.

Le **MCC se configure** par `GOOGLE_ADS_MANAGER_ID` (`backend/.env.example`) : sans lui, pas d'adapter.
En production, cette variable et le conteneur du secret `google-ads/service-account` restent à
déclarer dans `infra/`, avant le premier déploiement qui parle à Google.

### Les codes d'erreur du lot

| Code                           | Statut | Quand                                                                                | `params`                |
| ------------------------------ | ------ | ------------------------------------------------------------------------------------ | ----------------------- |
| `ad_account_field_required`    | 400    | Déclarer un compte d'une autre plateforme sans son nom, sa devise ou son fuseau      | `platform`, `field`     |
| `ad_account_reference_invalid` | 400    | Le customer id n'a pas dix chiffres, tirets permis                                   | `platform`, `field`     |
| `ad_account_field_read`        | 400    | Une devise, un fuseau ou un nom déclarés pour un compte dont la plateforme les donne | `platform`, `field`     |
| `ad_account_status_read`       | 400    | Une transition à la main sur un compte dont la plateforme tient le statut            | `platform`, `to`        |
| `ad_account_currency_unknown`  | 400    | Relier une marque à un compte pas encore accepté                                     | `status`                |
| `ad_account_manager`           | 400    | Le compte est lui-même un MCC                                                        | `platform`, `reference` |
| `ad_account_link_refused`      | 400    | Google refuse le lien ; `reason` porte son code quand il en donne un                 | `platform`, `reason`    |
| `ad_account_linked_elsewhere`  | 409    | Une autre Organization tient ce compte (§ 4.5)                                       | `platform`              |
| `ad_account_already_managed`   | 409    | Notre MCC le gère déjà sans que le client l'ait accordé à celle-ci                   | `platform`              |
| `platform_credentials_failed`  | 502    | **Nos** credentials ont échoué : un opérateur doit agir                              | `platform`              |
| `platform_unavailable`         | 503    | La plateforme ne répond pas, ou demande d'attendre                                   | `platform`              |

Ils sont dans `error-codes.md` depuis le lot 1, avec `sync_account_not_linked` et
`sync_platform_credentials_failed`, que le moteur garde sur une unité.

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

**La première preuve est faite, le 2026-11-20**, avec le lot 2a. Lorin, super-admin, a connecté depuis
le Swagger local un vrai compte client que notre MCC gère déjà, dans l'Organization PinkWhale FR :
`POST /ad-accounts` avec la seule référence, tirets compris, a répondu **201**, le compte `active`, son
nom, `EUR` et `Europe/Paris` lus chez Google. Le journal des appels en compte **deux**, tous deux en
200 et d'environ 350 ms : l'état du lien lu sur notre MCC, puis le compte lu sur lui-même. Aucune
invitation n'est partie, et la connexion a coûté deux opérations du quota du projet. Le consentement de
l'inviteur, lui, reste à faire avec le lot 2b, et le chemin de l'invitation à prouver sur un compte
que notre MCC ne gère pas encore.

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

## 8. Lot 3 — les campagnes Google

Écrit le 2026-11-20, avant la moindre ligne de code du lot, les lots 1 et 2 livrés, puis **revu le
même jour** : Lorin veut qu'une campagne Search d'Omnipotent fasse **tout ce que fait une campagne
de multi-search**. Le lot passe donc de deux temps à quatre, et la phase 10 ne se clôt qu'une fois
cette parité atteinte chez Google.

### 8.1 En quatre temps

Chaque temps se livre seul et laisse les vérifications au vert. Une vraie campagne de test part dès
3a, sans attendre les trois autres.

| Temps                   | Ce qu'il livre                                                                                                                                                                                                          | Ce qui le clôt                                                                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **3a. Pousser**         | Le couple `(google_ads, search)` du registre, ce que le modèle gagne pour égaler multi-search (§ 8.4), le mapping et `apply` : créer, modifier, mettre en pause                                                         | Les preuves du § 8.6 sur le vrai compte                                                                                            |
| **3b. Les verdicts**    | Le verdict de chaque annonce, gardé par plateforme et montré dans l'API et le MCP (`../../CADRAGE.md` § 9), et le job `review.poll`                                                                                     | La preuve du verdict, si Google examine une annonce en pause (§ 1)                                                                 |
| **3c. Le ciblage fin**  | La part Google de la phase 21, avancée : le référentiel des lieux de Google, importé et tenu à jour, les régions, départements, villes et codes postaux, la recherche d'un lieu et le géocodage d'une adresse           | Une campagne de test ciblée sur une ville et un code postal, conforme dans l'interface de Google Ads                               |
| **3d. Les conversions** | La part Google de la phase 18, avancée : `ConversionGoal`, le script de suivi unique, l'action de conversion de chaque objectif chez Google et son état, l'enchère `maximize_conversions` qui nomme l'objectif optimisé | Un objectif créé, son script posé sur une page de test, son état lu chez Google, et une campagne de test en `maximize_conversions` |

Les temps 3b, 3c et 3d seront détaillés ici avant d'être commencés. Le lot B de la phase 11 suit le
même chemin pour Microsoft.

### 8.2 La mesure : ce que fait une campagne Search de multi-search

multi-search a été relu le 2026-11-20 dans **`~/PinkWhale/multi-search`**, à sa phase 39c (commit
`0aac705`) : c'est la cible de la parité, figée ce jour-là (D54). L'étude
`plateformes/google-ads.md` avait été écrite depuis une copie arrêtée au 2026-10-20 : où les deux
diffèrent, multi-search d'aujourd'hui l'emporte, et l'étude se corrige au fil du lot.

| Ce que fait multi-search                                                                                   | Chez Omnipotent                    |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Annonces RSA, mots-clés et négatifs, budget total, courbes, répartition entre plateformes, pacing, devises | déjà dans le modèle (phases 3 à 9) |
| Pays, rayon autour d'un point, exclusion d'appareils, stratégies d'enchère, déclaration politique          | 3a                                 |
| Extensions : liens annexes, accroches, extraits structurés                                                 | 3a                                 |
| Marque : nom d'entreprise, logo, image                                                                     | 3a                                 |
| Réglages par plateforme : partenaires de recherche, AI Max                                                 | 3a                                 |
| Intention de lieu : « présentes » ou « présentes ou intéressées »                                          | 3a                                 |
| Heure de départ d'une campagne                                                                             | 3a                                 |
| Pause et reprise d'un AdGroup seul, et activation d'un AdGroup ajouté après le lancement                   | 3a                                 |
| Trois annonces au plus par ad group, en **erreur** qui bloque le lancement                                 | 3a                                 |
| Verdicts des annonces                                                                                      | 3b                                 |
| Régions, départements, villes, codes postaux, géocodage                                                    | 3c (avancé de la phase 21)         |
| Objectifs de conversion, script de suivi, `maximize_conversions`                                           | 3d (avancé de la phase 18)         |
| Rapports enrichis                                                                                          | phase 15                           |
| IA                                                                                                         | phase 16                           |
| Prévisions, idées et volumes de mots-clés                                                                  | phase 17                           |
| Liens d'agence                                                                                             | phase 19                           |
| Catalogues et campagnes Produits                                                                           | phase 20                           |

Un seul écart est **voulu** : à l'archivage, multi-search **supprime** la campagne chez Google ;
Omnipotent la **met en pause** (R5, § 8.5).

### 8.3 Le couple `(google_ads, search)` du registre

`PLATFORM_RULES` est vide : aucune campagne ne peut encore viser Google, et la preview répond
`preview_adapter_missing`. Le lot y déclare le couple :

- **la projection** : AdGroup → campagne, qui porte le budget (`budgetLevel: 'ad_group'`),
  TargetingGroup → ad group, Line → annonce responsive, et chaque mot-clé → un critère. Un
  TargetingGroup à budget propre devient sa propre campagne : l'éclatement, que le moteur déduit déjà ;
- **les créas** : `search_text:rsa` seul — l'étude l'appelle `search:responsive`, le registre des créas
  de la phase 6 l'a nommé ainsi — et une Line sans page de destination est refusée
  (`requiresClickThroughUrl`) ;
- **aucun budget minimum** : `minDailyBudgetCents: 0` ;
- **le ciblage** : en 3a, `country`, `proximity` et `device`. Un pays part par son identifiant chez
  Google, qui vaut 2000 plus son code numérique ISO 3166 — 2250 pour la France —, à constater sur
  quelques pays. `zip_code` et `location` arrivent en 3c ; d'ici là, comme toute dimension qu'un couple
  n'exprime pas, ils sont **retirés pour Google**, et la preview le dit avec le montant qui part sans eux
  (L2). `language` n'y est pas, Google la refusant depuis septembre ;
- **les stratégies d'enchère**, un champ de plus au registre : `max_cpc` → `MANUAL_CPC`,
  `maximize_clicks` → `TARGET_SPEND`, puis `maximize_conversions` en 3d. `cpm` est refusé, le Search
  n'achetant pas au mille ;
- **les plafonds**, en **erreur** de preview comme chez multi-search : trois annonces actives par ad
  group (`maxActiveAds`). Les dix mots par mot-clé et les cinq cents rayons, eux, le modèle les refuse
  déjà à la saisie (`MAX_KEYWORD_WORDS`, le schéma de `proximity`) ;
- **le ciblage partagé** (`sharedTargeting`) : `country`, `proximity`, puis `zip_code` et `location`
  en 3c — ce que Google ne pose que sur la campagne (§ 8.4, point 9) ;
- **les réglages** que le couple accepte, avec leur valeur par défaut : `searchPartners: true`,
  `aiMax: false` (§ 8.4, point 4) ;
- **l'intention de lieu** et **les extensions**, que le couple exprime (§ 8.4, points 5 et 6).

### 8.4 Ce que le modèle gagne en 3a

Tout ce qui suit vaut pour **toutes** les plateformes : le code lit le registre et le profil du levier,
jamais un nom de plateforme. Les formes, les limites et les codes sont **transcrits de multi-search**,
dont les fichiers sont cités.

1. **L'état voulu porte la stratégie d'enchère** de l'AdGroup — seul son montant (`bidMicros`) y est —
   **et la déclaration de publicité politique** de la campagne (D53). L'adapter envoie
   `DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING`, la preview refusant déjà l'autre cas.

2. **Le statut d'un nœud se change seul.** Un nœud créé dans une campagne lancée naît en pause
   (`statusOfNewNode`), et rien ne peut aujourd'hui l'activer : il reste en pause pour toujours. Cela
   vaut pour **les quatre niveaux** sous la campagne, pas seulement l'AdGroup comme chez multi-search,
   puisque chez Omnipotent un TargetingGroup ou une Line ajoutés après le lancement naissent aussi en
   pause. D'où `PUT /levers|ad-groups|targeting-groups|lines/:id/status`, sur le modèle de
   `PUT /campaigns/:id/status`, et les outils MCP `set-lever-status`, `set-ad-group-status`,
   `set-targeting-group-status`, `set-line-status`. Les règles de multi-search
   (`services/campaign-lifecycle.service.ts`) :
   - le rôle `manager` ; une campagne terminée ou archivée refuse, comme un statut inchangé ;
   - **activer** un nœud d'une campagne lancée est refusé quand sa fin est passée, et quand la preview
     trouve une erreur sur lui ou sous lui — l'erreur citée avec ses codes ;
   - une erreur sous un nœud **en pause** ne bloque plus le lancement, puisque ce nœud ne part pas ;
   - un AdGroup **jamais activé n'atteint aucune plateforme** : il n'a pas d'unité. C'est ce que dit
     déjà `../../CADRAGE.md` § 13, et que le code ne respecte pas encore — `ensureUnits` crée l'unité
     d'un AdGroup en pause, que la synchro crée alors en pause chez Google. L'AdGroup garde la date de
     sa première activation (`activatedAt`), comme chez multi-search.

3. **L'heure de départ**, sur la campagne : `startTime`, `HH:mm` dans le fuseau de la campagne, `null`
   valant minuit (`docs/phase-36.md` de multi-search). Elle **ne part jamais** chez une plateforme :
   avant elle, l'état voulu met tout en pause, et à son heure le hash change, donc un appel active la
   campagne. multi-search compte pour cela sur un balayage de toutes les campagnes vivantes toutes les
   cinq minutes, que D34 interdit ici : le **rendez-vous** de la campagne (`nextPacingAt`), qui tombe
   aujourd'hui à son minuit local, tombe à l'heure de départ quand elle vient avant. La date et l'heure
   de départ se modifient tant qu'elles ne sont pas atteintes, puis le refus est
   `campaign_start_reached`.

4. **Les réglages par plateforme**, sur le **Lever** — l'équivalent chez nous d'une campagne de
   multi-search, qui ne connaît qu'un levier. `platformSettings`, par plateforme, ne prend que les clés
   que le registre déclare pour le couple, chacune avec sa valeur par défaut ; une autre clé est
   refusée en 400. Chez Google : `searchPartners` (le réseau des partenaires de recherche) et `aiMax`.
   Chez Microsoft, au lot B : `syndicationPartners`, `audienceNetwork`, `aiMax`.

5. **L'intention de lieu**, sur l'**AdGroup**, comme chez multi-search : `presence` par défaut, ou
   `presence_or_interest`. Google la pose sur la campagne, qui est notre AdGroup ; sur le
   TargetingGroup, deux ad groups d'une même campagne Google pourraient se contredire. Le profil du
   levier la permet sur `search` seul, et la preview avertit pour une plateforme du levier qui ne
   l'exprime pas.

6. **Les extensions**, sur le **Lever** pour la même raison que les réglages : les liens annexes (vingt
   au plus, un texte de 25 caractères, deux descriptions de 35 **ou aucune**, une URL), les accroches
   (vingt de 25 caractères) et les extraits structurés (dix, un en-tête parmi treize, trois à dix
   valeurs de 25 caractères) — `types/campaign.types.ts` de multi-search. Le profil du levier les
   permet sur `search` seul. Un lien annexe à une seule description est une **erreur** de preview ;
   une plateforme du levier qui n'en prend pas en reçoit un avertissement. Chaque campagne Google de
   l'unité les reçoit toutes, éclatement compris.

7. **La marque, sur la créa RSA** : un nom d'entreprise (25 caractères), un logo et une image, comme
   chez multi-search. Le couple `search_text:rsa` gagne le champ `businessName` et deux rôles
   facultatifs, `logo` et `image`. Une image est **envoyée une fois par compte** à la plateforme, et
   la référence qu'elle rend est gardée, comme chez multi-search (`platform_asset_refs`) : c'est elle
   que remplit `DesiredCreative.assets`, vide aujourd'hui. Une image que la plateforme refuse est
   gardée sous une référence vide, pour n'être jamais renvoyée, et la campagne part sans elle. Chaque
   campagne Google prend la marque de la première Line, par date de création, dont la créa en porte
   une.

8. **Les plafonds en erreur** (§ 8.3). Les trois annonces se comptent sur les Lines **actives** d'un
   TargetingGroup, parce que Google plafonne les annonces actives : c'est un écart avec multi-search,
   qui compte toutes ses annonces, faute de statut sur elles. La preview vérifie aussi, comme
   multi-search, qu'une créa RSA n'a pas deux titres ou deux descriptions identiques.

9. **Le ciblage partagé.** Trouvé en écrivant le code, et absent de l'étude : une campagne Search de
   Google pose ses lieux et ses rayons **sur la campagne**, jamais sur un ad group. Or notre ciblage
   vit sur le TargetingGroup, qui devient un ad group : deux TargetingGroups d'un même AdGroup ciblant
   deux villes ne peuvent pas tenir dans une seule campagne Google, et envoyer leur union diffuserait
   plus large que chacun ne l'a demandé. Le registre nomme ces dimensions (`sharedTargeting`), et la
   preview refuse en **erreur** (`preview_targeting_not_shared`) des TargetingGroups qui partagent une
   campagne de la plateforme et les demandent différemment. Le remède est dit dans le message : donner
   un budget propre à l'un, ce qui l'éclate en sa propre campagne, ou le déplacer dans un autre
   AdGroup. multi-search n'a pas ce cas, n'ayant qu'un ad group par campagne. Les appareils, eux, se
   règlent sur l'ad group chez Google, et ne sont pas concernés.

10. **Un compte relié à notre MCC passe la preview.** Elle refusait tout compte sans secret propre
    (`preview_account_credentials_missing`), ce qu'un compte Google n'a jamais : c'est notre
    credential qui sert (§ 4.1). Elle ne le demande plus que sur une plateforme où chaque compte
    apporte le sien, ce qu'elle lit dans l'adapter.

Un champ de plus dans l'état voulu change l'empreinte de chaque unité : chacune repasse une fois à la
première synchro. Aucune n'existe encore chez une plateforme, donc rien n'en bouge.

### 8.5 `apply`, transcrit de multi-search

- **Retrouver avant de créer** : un objet est cherché dans `refs`, puis, pour une campagne, par un tag
  dans son nom, `[op:<clé>]` — le seul moyen de retrouver ce qu'une synchro tuée entre l'appel et
  l'écriture de `refs` a créé (étude § 7).
- **Un `mutate` atomique par campagne Google**, parents et enfants d'un coup par des identifiants
  temporaires, extensions comprises : l'arbre existe en entier, ou rien (§ 6).
- **Ne modifier que ce qui a changé.** Ce que Google fige — un lieu, un cercle, un mot-clé, une
  extension — se remplace dans le même appel. Une extension se compare **par son contenu** : celle qui
  n'est plus voulue est détachée de la campagne, celle qui manque est créée et attachée, jamais une
  modifiée sur place (`desiredLinks`, `linkKey` de `google.mapping.ts`).
- **La marque après la structure**, un appel par type : un refus définitif de Google, qui ne sert le
  nom et le logo qu'aux annonceurs éligibles, est journalisé et passé, sans faire échouer la synchro.
- **Les réglages** : `networkSettings` (Google Search toujours, les partenaires selon le réglage, ni le
  Display ni les partenaires de contenu), `aiMaxSetting.enableAiMax`, et
  `geoTargetTypeSetting` (l'intention de lieu en positif, `PRESENCE` toujours en négatif).
- **Les dates** : `startDateTime` n'est envoyée que si elle est encore à venir dans le fuseau du
  compte, `endDateTime` que si la fin n'est pas passée.
- **Une annonce qui n'est plus voulue se met en pause avant** qu'une autre s'active ou se crée : le
  plafond de trois annonces actives n'est jamais franchi, même un instant.
- **Ne jamais supprimer** (R5) : un nœud retiré de notre arbre, une campagne terminée ou archivée
  mettent leurs objets **en pause** chez Google. C'est l'écart voulu avec multi-search, tranché par
  Lorin le 2026-11-20 : une campagne supprimée chez Google ne se récupère pas, une campagne en pause
  ne coûte rien et garde son historique.
- **Chaque annonce porte `mskey`**, un paramètre d'URL personnalisé qui nomme sa Line : c'est ce qui
  rattachera les rapports à nos entités en phase 15.
- **Une campagne supprimée chez Google**, hors d'Omnipotent, est un refus à code stable, jamais une
  recréation silencieuse.
- **Le statut appliqué se relit** chez Google après l'appel.

Le compte se désigne par son customer id, et la marque aussi : Google n'a pas d'objet « advertiser »
sous un compte, donc l'`externalAdvertiserId` d'un `AdvertiserAdAccount` Google vaut le customer id
(étude § 9, point 2).

### 8.6 Les preuves de 3a, sur le vrai compte

Aux règles du § 1, depuis le Swagger local, par Lorin :

1. une marque reliée au compte Google connecté ;
2. une campagne de test de **10 € au total** — un AdGroup, un TargetingGroup ciblé sur un pays et un
   rayon, deux Lines dont une avec un logo, quelques mots-clés, des liens annexes, des accroches, une
   heure de départ — et sa preview ;
3. le lancement, **puis la pause aussitôt** ;
4. dans l'interface de Google Ads, la campagne en pause, conforme à la preview : réglages, intention
   de lieu, extensions et marque compris ;
5. une modification, et le journal des appels : seul ce qui a changé est parti ; puis une synchro sans
   modification : **zéro appel** ;
6. un AdGroup ajouté après le lancement : en pause, absent de Google, puis activé, et présent ;
7. une erreur provoquée, remontée avec son code ;
8. les limites d'objets du compte, relevées (`../../A-FAIRE.md` § 5).

### 8.7 Les points présentés à Lorin

**Validés le 2026-11-20.** Le lot en quatre temps (§ 8.1) ; la pause à l'archivage, contre la
suppression de multi-search (§ 8.5) ; et les points de la première version du contrat, revus pour la
parité :

1. le ciblage Google de 3a est le pays, le rayon autour d'un point et l'appareil, le reste en 3c ;
2. `max_cpc` et `maximize_clicks` en 3a, `maximize_conversions` en 3d, `cpm` refusé ;
3. l'état voulu porte la stratégie d'enchère et la déclaration politique, pour toutes les plateformes ;
4. un tag `[op:…]` dans le nom de chaque campagne Google, en secours de `refs` ;
5. l'`externalAdvertiserId` d'un compte Google est son customer id ;
6. trois annonces au plus par ad group, en erreur et non en avertissement.

**Validés le 2026-11-20 aussi**, à la lecture de cette version — ce que le modèle d'Omnipotent, plus
large que celui de multi-search, oblige à choisir :

7. **Les extensions et les réglages par plateforme vont sur le Lever** (§ 8.4, points 4 et 6), qui
   joue chez nous le rôle de la campagne de multi-search, puisqu'une campagne d'Omnipotent peut mêler
   plusieurs leviers.
8. **L'intention de lieu va sur l'AdGroup** (point 5), comme chez multi-search.
9. **Le statut se change aux quatre niveaux**, et un AdGroup jamais activé n'atteint aucune plateforme
   (point 2).
10. **L'heure de départ ne part jamais** chez la plateforme : elle déplace le rendez-vous de la
    campagne (point 3), sans balayage de toutes les campagnes.
11. **La marque va sur la créa RSA**, et les images envoyées sont gardées par compte (point 7).
12. **Les trois annonces se comptent sur les Lines actives** (point 8).
13. **La parité vise multi-search tel qu'il est le 2026-11-20** (commit `0aac705`, sa phase 39c), et
    non tant qu'il avance : D30 le disait gelé, il ne l'est pas, la cible l'est (D54). Ce qu'il gagne
    ensuite va dans une phase à part.

**À valider** — trouvé en écrivant le code de 3a :

14. **Des TargetingGroups qui partagent une campagne Google doivent demander les mêmes lieux**, sinon
    la preview refuse le lancement (§ 8.4, point 9). L'autre voie serait de les éclater d'office en
    campagnes séparées, ce qui diviserait le budget de l'AdGroup sans que personne ne l'ait demandé.
