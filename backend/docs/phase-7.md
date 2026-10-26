# Phase 7 — Comptes plateformes et sous-advertisers

Contrat de la phase 7. Le **périmètre qui porte les credentials** d'une plateforme, et le
**sous-advertiser** qui dit sous quelle identité une marque y achète. C'est la phase la plus
sensible du modèle : elle est la seule à toucher à des secrets.

Prérequis : la phase 2 (l'Advertiser, dont dépend le sous-advertiser).

Entrées validées : `../../CADRAGE.md` § 12, la **règle des secrets** d'`A-FAIRE.md`, et le modèle de
multi-search généralisé aux DSP (D1).

---

## 1. Deux entités

```
ad_accounts              (organization, plateforme, externalId) unique sur les vivants
advertiser_ad_accounts   (advertiser, plateforme, devise) unique sur les vivants
```

L'`AdAccount` est au niveau **Organization** : c'est lui qui porte les credentials, son `scope` et sa
devise. L'`AdvertiserAdAccount` est au niveau **Advertiser** : il choisit, **pour une devise**, le
compte sur lequel cette marque achète, et porte son `externalAdvertiserId` — l'advertiser DV360,
l'advertiser Amazon, le compte publicitaire Meta, l'advertiser Hawk.

C'est le modèle de multi-search, généralisé, et **pas** le `DspConnection` de MBP : des credentials en
jsonb dans Postgres interdisent la rotation et l'audit, et son unicité par `(organisation, DSP)`
empêche une Organization d'utiliser plusieurs comptes d'une même plateforme — plusieurs advertisers,
plusieurs devises (`../../CADRAGE.md` § 12).

| Colonne de l'`AdAccount` | Règle                                                                         |
| ------------------------ | ----------------------------------------------------------------------------- |
| `platform`               | La plateforme, de l'énumération du modèle                                     |
| `externalId`             | Son identifiant chez elle : customer id, partner id, advertiser id            |
| `name`                   | Ce que l'interface affiche                                                    |
| `currency`               | ISO 4217 ; **le pacing et le change en dépendent**                            |
| `timezone`               | IANA ; les jours de la plateforme s'y comptent                                |
| `status`                 | `pending \| active \| invalid`                                                |
| `statusReason`           | Pourquoi, quand ce n'est pas `active`                                         |
| `secretName`             | Le **nom** du secret dans Secrets Manager, jamais sa valeur                   |
| `scope`                  | Ce que la plateforme exige au-dessus du compte : partner DV360, profil Amazon |

## 2. Les secrets ne passent ni par Postgres ni par un tool

Trois règles, et elles ne se négocient pas (`../../CADRAGE.md` § 12, `A-FAIRE.md`) :

1. **Postgres ne garde que le nom** du secret. Sa valeur vit dans AWS Secrets Manager, derrière
   `SecretStore`, que le socle fournit déjà.
2. **Aucun tool MCP n'écrit ni ne lit un credential.** La route HTTP existe — le front en a besoin —,
   les tools n'en ont pas. Un modèle ne doit jamais avoir à demander une clé.
3. **Rien ne le relit.** L'API répond `hasCredentials`, un booléen. Il n'existe aucune route, aucun
   tool et aucun champ qui redonne la valeur.

Ce qui distingue deux sortes de credentials, et la phase ne traite que la seconde :

| Credential                                                                                          | Où il vit                                                                   |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Celui de **l'application** (compte de service Google, developer token Microsoft, client LWA Amazon) | Un conteneur déclaré dans `infra/envs/prod/main.tf`, valeur posée à la main |
| Celui d'**un compte** (jeton de rafraîchissement OAuth, clé d'API OpenAI ou Thrad)                  | Secrets Manager, sous le nom que l'`AdAccount` garde                        |

## 3. Le cycle de vie du lien

Un compte connecté n'est pas un compte utilisable : la plupart des plateformes demandent au client
d'accepter l'accès. Le modèle le dit, avec une **table de transitions** et une seule route qui
l'applique.

```
            (connexion)
                 │
                 ▼
            ┌─────────┐   acceptation   ┌────────┐
            │ pending │ ──────────────► │ active │
            └─────────┘                 └────────┘
                 │  refus, expiration         │  révocation,
                 │                            │  credentials rejetés
                 ▼                            ▼
                     ┌─────────┐
                     │ invalid │
                     └─────────┘
```

| Depuis    | Vers      | Raison                                 |
| --------- | --------- | -------------------------------------- |
| `pending` | `active`  | Le client a accepté                    |
| `pending` | `invalid` | `link_declined`, `link_expired`        |
| `active`  | `invalid` | `link_revoked`, `credentials_rejected` |
| `invalid` | `pending` | Une nouvelle demande part              |

Un passage que la table ne nomme pas est un **400**, pas un état silencieux. Qui déclenche quoi :
dans cette phase, l'appelant, parce qu'aucun adapter n'existe ; à partir de la phase des plateformes,
le job `account.links` qui interroge la plateforme toutes les quinze minutes (`plan.md`). C'est la
même colonne et la même table de transitions — rien ne sera à défaire.

## 4. La devise et le fuseau

`../../CADRAGE.md` § 12 veut qu'ils soient **lus chez la plateforme** : le pacing et le change en
dépendent, et une devise devinée se paierait en argent réel. Aucun adapter n'existe encore, donc ils
sont **déclarés à la connexion** et la phase de chaque plateforme les rafraîchira depuis son API —
exactement le compromis de la durée d'un asset en phase 6, pour la même raison.

La devise d'un compte **ne change pas** après sa connexion : les montants déjà poussés y sont
exprimés, et un compte d'une autre devise est un autre compte. Le fuseau, lui, se corrige.

## 5. Un advertiser, une devise, un compte

Le lien est unique par `(advertiser, plateforme, devise)` : une marque achète sur **un** compte par
devise et par plateforme, ce qui est la question que la synchronisation posera à chaque poussée. Le
compte lié doit être de la **même Organization** et de la **même devise** que le lien, et un lien ne
se crée pas vers un compte `invalid`.

## 6. Les routes

| Méthode  | URL                            | Rôle      | Ce qu'elle fait                               |
| -------- | ------------------------------ | --------- | --------------------------------------------- |
| `GET`    | `/ad-accounts`                 | `viewer`  | Les comptes de l'Organization, par plateforme |
| `POST`   | `/ad-accounts`                 | `admin`   | Connecte un compte, en `pending`              |
| `GET`    | `/ad-accounts/:id`             | `viewer`  | Un compte, et s'il porte des credentials      |
| `PATCH`  | `/ad-accounts/:id`             | `admin`   | Son nom, son fuseau, son `scope`              |
| `DELETE` | `/ad-accounts/:id`             | `admin`   | Le déconnecte ; le secret est effacé          |
| `POST`   | `/ad-accounts/:id/restore`     | `admin`   | Le rend, sans credentials                     |
| `PUT`    | `/ad-accounts/:id/status`      | `admin`   | Applique une transition de la table           |
| `PUT`    | `/ad-accounts/:id/credentials` | `admin`   | Pose le secret ; **aucun tool MCP**           |
| `DELETE` | `/ad-accounts/:id/credentials` | `admin`   | L'efface                                      |
| `GET`    | `/advertisers/:id/ad-accounts` | `viewer`  | Les comptes de cette marque, par devise       |
| `POST`   | `/advertisers/:id/ad-accounts` | `manager` | La relie à un compte pour une devise          |
| `PATCH`  | `/advertiser-ad-accounts/:id`  | `manager` | Change son `externalAdvertiserId`             |
| `DELETE` | `/advertiser-ad-accounts/:id`  | `manager` | Défait le lien                                |

Et leurs tools MCP du même nom (D21), **sauf les deux routes de credentials** : il n'y en aura jamais.

## 7. Les codes d'erreur de la phase

| Code                            | Statut | Quand                                                               | `params`                      |
| ------------------------------- | ------ | ------------------------------------------------------------------- | ----------------------------- |
| `ad_account_not_found`          | 404    | Absent, déconnecté, ou d'une autre Organization                     | `{}`                          |
| `ad_account_not_deleted`        | 409    | `restore` sur un compte vivant                                      | `{}`                          |
| `ad_account_already_connected`  | 409    | Cette Organization a déjà ce compte sur cette plateforme            | `platform`, `externalId`      |
| `ad_account_transition_invalid` | 400    | La table des transitions ne nomme pas ce passage                    | `from`, `to`                  |
| `ad_account_currency_immutable` | 400    | Changer la devise d'un compte connecté                              | `currency`                    |
| `ad_account_unusable`           | 400    | Relier une marque à un compte `invalid`                             | `status`, `statusReason`      |
| `ad_account_other_currency`     | 400    | Le lien et le compte ne sont pas dans la même devise                | `currency`, `accountCurrency` |
| `advertiser_account_exists`     | 409    | Cette marque a déjà un compte pour cette plateforme et cette devise | `platform`, `currency`        |
| `advertiser_account_not_found`  | 404    | Lien absent, ou d'une autre Organization                            | `{}`                          |

## 8. Comment la phase se teste

- **Le cycle de vie** : chaque transition de la table passe, chaque autre est un 400 nommé.
- **Les secrets** : poser un credential écrit dans `SecretStore` et **rien** dans Postgres sinon son
  nom ; la réponse ne porte jamais la valeur ; déconnecter le compte efface le secret.
- **L'unicité** : deux fois le même compte sur une Organization est refusé, et le même compte chez
  une autre Organization est accepté ; une marque n'a qu'un compte par plateforme et par devise.
- **Les refus du lien** : un compte `invalid`, une devise qui ne correspond pas, une autre
  Organization.
- **MCP** : les mêmes opérations par les tools, **sauf** les credentials, et un test prouve qu'aucun
  tool ne les expose.
- **L'intégration** : les deux index uniques partiels sur une vraie base.

## 9. Les points présentés à Lorin

Avec la livraison, parce qu'ils sont réversibles en une ligne chacun — à corriger s'ils sont faux.
Rien d'autre n'a été déduit en silence.

1. **Connecter un compte et poser son secret demandent `admin`**, pas `manager` : un credential est
   la chose la plus sensible de l'API et il vaut pour toute l'Organization. Relier une marque à un
   compte déjà connecté reste `manager`, puisque c'est une décision de campagne.
2. **Une seule route de transition**, `PUT /ad-accounts/:id/status`, au lieu d'une route par verbe :
   la table des transitions est alors écrite une fois, au même endroit, et le job des phases
   plateformes l'appliquera telle quelle.
3. **La devise et le fuseau sont déclarés** à la connexion tant qu'aucun adapter ne sait les lire
   (§ 4), et la devise est **immuable** ensuite.
4. **Aucun tool MCP ne touche aux credentials**, et un test le prouve en vérifiant qu'aucun nom de
   tool ne les nomme.
