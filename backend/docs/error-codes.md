# Codes de l'API

Pour le développeur du front. Le backend écrit ses messages en anglais ; le front est en français. Chaque message que l'API renvoie porte donc un **code** stable et les **valeurs** de son message : le front traduit `code` + `params`, et n'affiche le `message` anglais qu'en secours, pour un code qu'il ne connaît pas encore.

Ce document est relevé dans le code (`src/`). Il ne contient aujourd'hui que les codes du **socle** — authentification, droits, limites de débit, validation, MCP, pannes d'infrastructure. **Chaque phase ajoute ici les codes de sa ressource**, dans sa section, avec la même règle : un code qui part en production ne change plus de sens.

## Où trouver les codes

| Message         | Où                       | Champs                      |
| --------------- | ------------------------ | --------------------------- |
| Erreur de l'API | Toute réponse 4xx ou 5xx | `code`, `params`, `message` |

Les autres sortes de messages codés — problèmes d'une prévisualisation, conformité d'une créa, tâches à traiter, état d'un objet chez une plateforme — arrivent dans des réponses **réussies** et viennent avec leurs phases. Le modèle est celui de multi-search (`~/OmniAd/multi-search/backend/docs/error-codes.md`) : une ligne par sorte de message, avec les champs qui portent le code.

Règles communes :

- Traduire par le code, jamais en lisant `message`. Un code inconnu se traduit par le texte générique de son statut (voir « Codes génériques »), puis par `message`.
- Un même code garde le même sens partout. Quand il sert sur plusieurs routes, sa ligne le dit.
- Valeurs des `params` : un objet plat dont chaque valeur est un texte, un nombre, un booléen ou `null` (`{}` quand le message n'a pas de valeur). Dates `AAAA-MM-JJ`, instants ISO 8601 ; une liste est un texte dont les éléments sont séparés par une virgule et une espace.

## Forme d'une erreur

Toutes les erreurs (HTTP 4xx et 5xx) ont la même forme, décrite par `errorResponseSchema` (`src/types/error.types.ts`) et produite par `src/plugins/error-handler.plugin.ts` :

```json
{
  "statusCode": 403,
  "error": "Forbidden",
  "code": "role_required",
  "params": { "required": "manager", "actual": "viewer" },
  "message": "This action requires the manager role",
  "requestId": "req-4f"
}
```

| Champ        | Contenu                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| `statusCode` | Le statut HTTP                                                                                         |
| `error`      | Le libellé anglais du statut (`Not Found`, `Conflict`…)                                                |
| `code`       | La clé de traduction : snake_case en minuscules, 64 caractères au plus, stable d'une version à l'autre |
| `params`     | Les valeurs du message (voir « Règles communes »)                                                      |
| `message`    | Le texte anglais, en secours ; opaque pour une 5xx hors développement (voir « Erreurs serveur »)       |
| `requestId`  | L'identifiant de la requête, à citer dans un signalement : il relie la réponse aux journaux du serveur |

Ce que l'appelant n'a pas le droit de voir répond **404** (comme s'il n'existait pas) ; un rôle trop bas répond **403** `role_required`.

### Erreur de validation : `validation_failed`

Une requête refusée par le schéma de sa route répond **400** avec le code `validation_failed` et la première règle non respectée :

| `params`   | Contenu                                                                                                                                                                                                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `field`    | Le chemin du champ en cause, en pointillé (`platforms.0.share`), `null` pour la racine                                                                                                                                                                                                   |
| `rule`     | Le mot-clé JSON Schema non respecté : `required`, `type`, `enum`, `pattern`, `format`, `minLength`, `maxLength`, `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `minItems`, `maxItems`, `multipleOf`, `additionalProperties`, `oneOf`, `propertyNames`, `items`, `custom` |
| `location` | La partie de la requête : `body`, `querystring`, `params` ou `headers`                                                                                                                                                                                                                   |

Un champ que la route **ne déclare pas** est refusé, pas ignoré : la règle est `additionalProperties`
et `field` nomme le champ fautif. Vrai d'un corps, d'une querystring et des arguments d'un tool MCP ;
les en-têtes, eux, restent souples (une requête porte les siens).

Les corps sont validés par leur schéma Zod lui-même (`src/plugins/validation.plugin.ts`), les querystrings, paramètres d'URL et en-têtes par AJV sur leur JSON Schema. Dans les deux cas la réponse a la forme ci-dessus, et la correspondance entre les deux est faite par `src/utils/validation.utils.ts`. Les longueurs se comptent en unités de code UTF-16 : un emoji compte 2.

## Authentification

`src/plugins/auth.plugin.ts` et `src/services/token-verifier.service.ts`.

| Code                         | Statut | Quand                                                                                                                              | `params` |
| ---------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `token_missing`              | 401    | Pas d'en-tête `Authorization: Bearer <token>` sur une route authentifiée                                                           | `{}`     |
| `invalid_token`              | 401    | Jeton illisible, expiré, signé par une clé inconnue du tenant, ou émis pour une autre audience (REST au lieu de MCP, ou l'inverse) | `{}`     |
| `not_authenticated`          | 401    | Un service a demandé l'appelant sur une route non authentifiée : erreur de câblage, jamais la faute du client                      | `{}`     |
| `authentication_unavailable` | 503    | Les clés publiques du tenant sont injoignables                                                                                     | `{}`     |

Le jeton est vérifié **ici**, l'identité est résolue **chez omnipass** : le plugin d'auth appelle `accessService.resolve(sub, token)`, une fois par requête, et relaie le jeton de l'utilisateur pour qu'omnipass agisse avec **ses** droits et jamais avec ceux de l'application. Les refus propres à l'identité — une connexion Auth0 qui ne vérifie pas les adresses, une adresse non vérifiée, une identité sans compte — sont émis par omnipass et documentés chez lui ; ils traversent cette API telles quelles.

Sur `POST /mcp`, une 401 porte en plus l'en-tête `WWW-Authenticate`, qui pointe vers `/.well-known/oauth-protected-resource/mcp` : c'est par là qu'un client MCP découvre où se connecter.

## Droits

`src/services/access.service.ts`. Les droits sont vérifiés **dans les services**, jamais dans un handler.

| Code                     | Statut | Quand                                                          | `params`             |
| ------------------------ | ------ | -------------------------------------------------------------- | -------------------- |
| `super_admin_required`   | 403    | Action réservée aux administrateurs de la plateforme           | `{}`                 |
| `role_required`          | 403    | Le rôle de l'appelant est inférieur à celui qu'exige l'action  | `required`, `actual` |
| `seat_not_found`         | 404    | Le Seat n'existe pas, ou l'appelant ne peut pas le voir        | `{}`                 |
| `organization_not_found` | 404    | L'Organization n'existe pas, ou l'appelant ne peut pas la voir | `{}`                 |

Les `assert*` sont du **calcul pur** sur l'instantané que `resolve` a rapporté : vérifier un droit ne coûte aucun appel réseau — un refus de rôle ne dépend donc **pas** de la disponibilité d'omnipass.

Ces quatre codes sont levés par `@omnilor/omnipass-client`, sous la forme d'une `OmnipassError` qui porte `statusCode`, `code`, `params` et les alias `errorCode` / `errorParams` que le gestionnaire d'erreurs lit déjà : elle traverse l'API telle quelle, **sans adaptateur**. Le bouchon de développement du socle accorde tout — `admin` sur toute Organization, `seat_admin` sur tout Seat — et n'émet donc que `super_admin_required`, parce que `DEV_ACTOR_SUPER_ADMIN` peut être `false`. C'est voulu, et c'est pourquoi la production refuse de démarrer avec lui (D43).

Une Organization disparue chez omnipass répond **404**, jamais 500 (T4).

## Identité, chez omnipass

Ces codes sont émis par **omnipass**, à la résolution de l'appelant ou à une écriture de tenancy, et traversent cette API telles quelles. Ils sont documentés ici parce que le front les traduit comme les autres.

| Code                         | Statut | Quand                                                                          | `params`                  |
| ---------------------------- | ------ | ------------------------------------------------------------------------------ | ------------------------- |
| `invalid_token`              | 401    | Le jeton relayé est refusé par omnipass — pour le front, un jeton à renouveler | `{}`                      |
| `user_not_invited`           | 403    | L'identité n'a pas de compte : il faut l'inviter                               | `{}`                      |
| `email_not_verified`         | 403    | L'adresse de l'identité n'est pas vérifiée                                     | `{}`                      |
| `sign_in_method_unverified`  | 403    | La connexion Auth0 utilisée ne vérifie pas les adresses                        | `provider`                |
| `email_linked_elsewhere`     | 403    | Cette adresse est déjà liée à une autre méthode de connexion                   | `email`                   |
| `invitation_limit_reached`   | 429    | Trop d'invitations envoyées                                                    | `per`, `limit`, `retryAt` |
| `authentication_unavailable` | 503    | L'identité ne peut pas être établie : cache froid et omnipass injoignable      | `{}`                      |
| `tenancy_unavailable`        | 503    | Une **écriture** de tenancy n'a pas atteint omnipass                           | `{}`                      |

Trois autres codes d'omnipass ne sont **jamais** la faute d'un utilisateur, seulement d'une configuration — un déploiement correct ne les voit pas. S'ils apparaissent, les journaliser bruyamment : `service_required` (403), `application_unknown` (403, un `client_id` hors du registre), `audience_not_allowed` (403, un jeton relayé dont l'`aud` n'est pas déclaré pour Omnipotent).

## Organization d'une requête

`src/utils/http.utils.ts`, `src/mcp/tool-result.ts`.

| Code                          | Statut | Quand                                                                                                | `params` |
| ----------------------------- | ------ | ---------------------------------------------------------------------------------------------------- | -------- |
| `organization_header_missing` | 400    | L'en-tête `X-Organization-Id` manque sur une route qui agit sur une Organization                     | `header` |
| `organization_id_required`    | 400    | Un tool MCP n'a reçu ni l'argument `organizationId` ni l'en-tête `X-Organization-Id` de la connexion | `{}`     |

## Le CRUD de référence

Partagé par toute ressource du domaine (`docs/phase-2.md` § 2, `src/types/crud.types.ts`).

| Code                  | Statut | Quand                                                              | `params` |
| --------------------- | ------ | ------------------------------------------------------------------ | -------- |
| `bulk_ids_duplicated` | 400    | Le même id apparaît deux fois dans un lot : la liste est mal bâtie | `id`     |

En mode `partial`, un échec **par élément** n'est pas une erreur de la requête : la réponse est 200,
et chaque élément refusé est une entrée de `failed` portant son `index`, son `code` et ses `params`
— les mêmes que la route unitaire aurait répondus. Un droit refusé, lui, refuse le lot entier.

Un échec sans code stable (une 5xx, une panne) n'est jamais rapporté par élément : il fait échouer
toute la requête, parce que l'appelant n'a rien à en corriger.

## Advertisers et labels

`src/services/advertiser.service.ts`, `src/services/label.service.ts`.

| Code                     | Statut | Quand                                                                | `params` |
| ------------------------ | ------ | -------------------------------------------------------------------- | -------- |
| `advertiser_not_found`   | 404    | Absent, supprimé, ou d'une autre Organization                        | `{}`     |
| `advertiser_name_taken`  | 409    | Une marque vivante porte déjà ce nom dans l'Organization             | `name`   |
| `advertiser_not_deleted` | 409    | `restore` sur un advertiser vivant                                   | `{}`     |
| `label_not_found`        | 404    | Absent, supprimé, d'une autre Organization, ou posé depuis une autre | `{}`     |
| `label_name_taken`       | 409    | Un label vivant porte déjà ce nom dans l'Organization                | `name`   |
| `label_not_deleted`      | 409    | `restore` sur un label vivant                                        | `{}`     |

L'unicité du nom ne regarde que les **vivants** : supprimer libère le nom, et une restauration dont
le nom a été repris entre-temps répond `*_name_taken`. Les deux codes de nom portent le nom demandé,
pour que le front puisse l'écrire dans son message.

## L'arbre de campagne

`src/services/{campaign,lever,ad-group,targeting-group,line}.service.ts`,
`src/services/{budget,tree,node}.helpers.ts`, `src/levers/lever-profiles.ts` (phase 3,
`docs/phase-3.md` § 8).

### Les cinq niveaux

Chaque niveau porte ses deux codes, construits sur son nom : `campaign`, `lever`, `ad_group`,
`targeting_group`, `line`.

| Code                   | Statut | Quand                                                                    | `params` |
| ---------------------- | ------ | ------------------------------------------------------------------------ | -------- |
| `<niveau>_not_found`   | 404    | Absent, supprimé, ou d'une autre Organization                            | `{}`     |
| `<niveau>_not_deleted` | 409    | `restore` sur un nœud vivant                                             | `{}`     |
| `lever_already_exists` | 409    | La campagne porte déjà ce canal — à la création comme à une restauration | `lever`  |

### Ce que le modèle refuse d'exprimer

Ces refus viennent du **profil de levier**, qui dit ce que le modèle permet. Ce qu'une **plateforme**
n'accepte pas est l'affaire du registre de plateforme, et devient un avertissement de preview, pas
une erreur (L2).

| Code                          | Statut | Quand                                                                                                                                                                                    | `params`                  |
| ----------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `lever_field_forbidden`       | 400    | Le profil déclare ce champ `interdit` à ce niveau — un budget sur une Line Search (D12), un capping sur le Search (L6). Sur une campagne, la règle est l'union des leviers qu'elle porte | `lever`, `level`, `field` |
| `platform_not_eligible`       | 400    | La plateforme ne sert pas ce levier (`../../CADRAGE.md` § 6)                                                                                                                             | `platform`, `lever`       |
| `bid_strategy_not_permitted`  | 400    | Stratégie hors de celles que le profil du levier permet                                                                                                                                  | `strategy`, `lever`       |
| `objective_not_permitted`     | 400    | Objectif hors de ceux que le profil du levier permet                                                                                                                                     | `objective`, `lever`      |
| `products_mode_not_permitted` | 400    | Le levier n'a pas de mode Produits (L13, L14)                                                                                                                                            | `lever`                   |
| `volume_not_permitted`        | 400    | Le levier n'accepte pas de saisie en volume dans cette unité (L25)                                                                                                                       | `unit`, `lever`           |

### L'algèbre du budget et les fenêtres

| Code                        | Statut | Quand                                                                               | `params`                       |
| --------------------------- | ------ | ----------------------------------------------------------------------------------- | ------------------------------ |
| `budget_exceeds_parent`     | 400    | `Σ enfants > parent` : l'invariant de D8, à tous les niveaux                        | `parentCents`, `childrenCents` |
| `budget_entered_twice`      | 400    | Un montant **et** un volume dans la même requête : l'un des deux serait un mensonge | `unit`                         |
| `volume_without_bid`        | 400    | Saisie en volume sans CPM d'enchère pour la convertir (L25)                         | `unit`                         |
| `dates_outside_parent`      | 400    | La fenêtre sort de celle du parent                                                  | `parentStart`, `parentEnd`     |
| `dates_reversed`            | 400    | La fenêtre se termine avant de commencer                                            | `startsOn`, `endsOn`           |
| `platform_shares_invalid`   | 400    | Les parts ne somment pas à 100 % (10 000 points de base)                            | `total`                        |
| `platform_share_duplicated` | 400    | La même plateforme apparaît deux fois dans une répartition                          | `platform`                     |

Deux choses que le front peut compter sur : un budget est **toujours** en centimes entiers et en
devise de campagne, et une lecture donne à la fois ce qu'un nœud porte (`explicitCents`) et ce qu'il
peut dépenser (`effectiveCents`), avec la raison (`source` ∈ `explicit | inherited | forbidden`) —
donc il n'a jamais à refaire la division lui-même.

## La courbe journalière et le pacing

`src/services/budget-curve.{service,helpers}.ts`, `src/services/pacing.helpers.ts` (phase 4,
`docs/phase-4.md` § 7).

Un nœud dont le budget est hérité n'a pas de courbe à lui : il **lit** celle de son parent à son
échelle, et toute écriture sur lui est refusée. Les cinq niveaux partagent ces codes, le niveau
voyageant en `params` quand il explique le refus.

| Code                        | Statut | Quand                                                                     | `params`                    |
| --------------------------- | ------ | ------------------------------------------------------------------------- | --------------------------- |
| `budget_curve_not_allowed`  | 400    | Écrire sur un nœud sans budget explicite : il suit la forme de son parent | `level`                     |
| `budget_day_outside_window` | 400    | Un jour édité est hors de la fenêtre du nœud                              | `day`                       |
| `budget_day_past`           | 400    | Un jour déjà passé : son montant et son verrou ne changent plus           | `day`                       |
| `budget_below_past_days`    | 400    | Les jours déjà passés portent à eux seuls plus que le budget demandé      | `pastCents`, `budgetCents`  |
| `budget_fixed_days_exceed`  | 400    | Verrouillés, édités et passés réunis dépassent le budget                  | `fixedCents`, `budgetCents` |
| `budget_no_free_day`        | 400    | Il reste quelque chose à répartir et aucun jour ne peut l'absorber        | `remainingCents`            |
| `budget_period_too_long`    | 400    | La fenêtre du nœud dépasse le maximum de jours d'une courbe               | `days`, `max`               |

Reposter sur un jour passé **le montant qu'il porte déjà** n'est pas un refus : c'est ce qui permet
de renvoyer une courbe entière telle quelle. Seul un changement — de montant ou de verrou — est
refusé.

Deux choses que le front peut compter sur : les jours d'une courbe somment **exactement** au budget
du nœud, et un jour à `0` est une intention, pas un vide — il met le nœud en pause ce jour-là.

## Le ciblage, les listes et les mots-clés

`src/targeting/dimensions/`, `src/services/{targeting,list,keyword}.service.ts` (phase 5,
`docs/phase-5.md` § 8).

Deux registres se partagent les refus (L2) : le **profil de levier** dit ce que le modèle permet
d'exprimer et refuse en 400 ; le **registre de plateforme** dit ce qu'une plateforme accepte et
produit un avertissement de preview, jamais une erreur.

### Le ciblage

| Code                            | Statut | Quand                                                                          | `params`                     |
| ------------------------------- | ------ | ------------------------------------------------------------------------------ | ---------------------------- |
| `targeting_dimension_forbidden` | 400    | Le levier du nœud n'a rien à faire de cette dimension                          | `lever`, `dimension`         |
| `targeting_criteria_invalid`    | 400    | Les critères ne passent pas le schéma de leur dimension, clé inconnue comprise | `dimension`, `reason`        |
| `targeting_list_kind_mismatch`  | 400    | Une liste d'un genre branchée sur une dimension qui en attend un autre         | `listId`, `kind`, `expected` |
| `targeting_group_not_found`     | 404    | Le TargetingGroup est absent, supprimé, ou d'une autre Organization            | `{}`                         |

Une dimension absente du registre ou un type de dimension inconnu sont refusés **par le schéma** de
la route, donc en `validation_failed` : l'énumération des dimensions fait partie du contrat.

### Les listes

| Code                     | Statut | Quand                                                                             | `params`               |
| ------------------------ | ------ | --------------------------------------------------------------------------------- | ---------------------- |
| `list_not_found`         | 404    | Absente, supprimée, ou d'une autre Organization                                   | `listId`               |
| `list_not_deleted`       | 409    | `restore` sur une liste vivante                                                   | `{}`                   |
| `list_name_taken`        | 409    | Une liste vivante du même genre porte déjà ce nom                                 | `kind`, `name`         |
| `list_referenced`        | 409    | **Déplacement** d'une liste qu'un ciblage référence encore : dupliquer à la place | `listId`, `references` |
| `list_same_organization` | 400    | Dupliquer ou déplacer vers l'Organization d'origine                               | `organizationId`       |
| `list_other_seat`        | 400    | La cible appartient à un autre Seat : une liste ne voyage que dans le sien        | `organizationId`       |

Le genre d'une liste ne change jamais : les dimensions la référencent par ce qu'elle contient, et le
corps de la mise à jour ne déclare donc pas `kind` — l'envoyer est un `validation_failed`.

### Les mots-clés

| Code                     | Statut | Quand                                                          | `params`                        |
| ------------------------ | ------ | -------------------------------------------------------------- | ------------------------------- |
| `keywords_not_permitted` | 400    | Le levier n'achète pas de mots : seul le Search en achète      | `lever`                         |
| `keyword_text_invalid`   | 400    | Le texte porte plus de mots que les plateformes n'en acceptent | `text`, `words`, `max`          |
| `keyword_not_found`      | 404    | Absent, ou d'une autre Organization                            | `{}`                            |
| `keyword_already_exists` | 409    | Le changement ferait un doublon du même mot dans le même nœud  | `text`, `matchType`, `negative` |

Trois choses que le front peut compter sur : poster un mot-clé que le nœud porte déjà **n'est pas une
erreur** — la réponse le donne tel qu'il est, donc coller deux fois la même liste ne change rien ;
un texte refusé est rapporté par son **index** dans `failed`, comme tous les bulks ; et un mot-clé
supprimé l'est pour de bon, la réponse disant `deleted: true` plutôt qu'une date.

## La bibliothèque : assets et créas

`src/services/{asset,creative}.service.ts`, `src/creatives/creative-formats.ts` (phase 6,
`docs/phase-6.md` § 8).

### Les assets

| Code                     | Statut | Quand                                                  | `params`                  |
| ------------------------ | ------ | ------------------------------------------------------ | ------------------------- |
| `asset_too_large`        | 400    | Le fichier dépasse le plafond d'envoi                  | `maxBytes`, `sizeBytes`   |
| `asset_type_unsupported` | 400    | Le type annoncé n'est pas accepté par la bibliothèque  | `mimeType`, `accepted`    |
| `asset_unreadable`       | 400    | Les octets ne se lisent pas comme l'image annoncée     | `mimeType`                |
| `asset_other_advertiser` | 400    | Une version réclame un asset d'un autre Advertiser     | `assetId`, `advertiserId` |
| `asset_not_found`        | 404    | Absent, supprimé, ou d'une autre Organization          | `{}`                      |
| `asset_not_deleted`      | 409    | `restore` sur un asset vivant                          | `{}`                      |
| `asset_in_use`           | 409    | Suppression d'un asset qu'une version vivante utilise  | `assetId`, `creatives`    |
| `multipart_required`     | 415    | Un envoi dont le corps n'est pas `multipart/form-data` | `{}`                      |

Deux choses que le front peut compter sur : **redéposer le même fichier n'est pas une erreur** — la
réponse est l'asset déjà là, en **200** au lieu de **201** —, et un asset qu'une créa tient ne se
supprime jamais en silence : le refus dit combien de créas le retiennent.

### Les créas et leurs versions

| Code                          | Statut | Quand                                                | `params`                      |
| ----------------------------- | ------ | ---------------------------------------------------- | ----------------------------- |
| `creative_couple_unknown`     | 400    | Le couple `(format, subtype)` n'est pas au registre  | `format`, `subtype`           |
| `creative_payload_invalid`    | 400    | La charge utile ne passe pas le schéma de son couple | `format`, `subtype`, `reason` |
| `creative_asset_role_missing` | 400    | Un rôle d'asset que le couple exige manque           | `role`, `format`, `subtype`   |
| `creative_asset_role_unknown` | 400    | Un rôle que le couple n'attend pas                   | `role`, `format`, `subtype`   |
| `creative_not_found`          | 404    | Absente, supprimée, ou d'une autre Organization      | `{}`                          |
| `creative_version_not_found`  | 404    | Absente, ou d'une autre Organization                 | `{}`                          |
| `creative_not_deleted`        | 409    | `restore` sur une créa vivante                       | `{}`                          |

Le `format` et le `subtype` ne figurent pas dans le corps de mise à jour : les changer invaliderait
la charge utile de toutes les versions, donc c'est une autre créa — l'envoyer est un
`validation_failed`. Une version ne se modifie ni ne se supprime : il n'y a **aucune** route pour
cela, et `(targetingGroup, creative)` unique côté Line empêche la même créa de diffuser deux fois sur
un même ciblage (`line_creative_duplicated` est l'erreur de la phase de la preview, la base la
refusant déjà).

## Limite de débit

`src/plugins/rate-limit.plugin.ts` (routes HTTP) et `src/mcp/tool-rate-limit.ts` (tools MCP, sur la limite de la route qu'ils reflètent).

| Code           | Statut | Quand                                                                           | `params`                       |
| -------------- | ------ | ------------------------------------------------------------------------------- | ------------------------------ |
| `rate_limited` | 429    | Trop d'appels de cet utilisateur, ou de cette adresse IP sur une route publique | `retryAfter` (secondes), `max` |

La réponse porte aussi `Retry-After`, et chaque réponse porte `X-RateLimit-Limit`, `X-RateLimit-Remaining` et `X-RateLimit-Reset`.

## MCP

`src/plugins/mcp.plugin.ts`. Le mode par défaut est **sans session** (`stateful: false`) : seul `POST /mcp` existe.

| Code                          | Statut | Quand                                                                           | `params` |
| ----------------------------- | ------ | ------------------------------------------------------------------------------- | -------- |
| `mcp_sessions_disabled`       | 405    | `GET` ou `DELETE /mcp` en mode sans session : ce sont des opérations de session | `method` |
| `mcp_session_invalid`         | 400    | En-tête `Mcp-Session-Id` absent ou inconnu (mode avec sessions)                 | `{}`     |
| `mcp_session_of_another_user` | 403    | La session appartient à un autre utilisateur                                    | `{}`     |
| `mcp_sessions_limit_reached`  | 429    | Le processus tient déjà `McpServer.maxSessions` sessions                        | `max`    |

Un tool qui échoue ne renvoie pas une erreur de protocole : il renvoie un résultat `isError: true` dont le texte est le message. Une erreur 4xx du service y arrive telle quelle, pour que le modèle puisse réagir ; une 5xx devient un message opaque et part dans les journaux (`src/mcp/tool-result.ts`).

## Plateformes

`src/platforms/platform-rules.ts`.

| Code                         | Statut | Quand                                                  | `params`            |
| ---------------------------- | ------ | ------------------------------------------------------ | ------------------- |
| `platform_unknown`           | 400    | Aucun connecteur ne déclare cette plateforme           | `platform`          |
| `platform_lever_unsupported` | 400    | La plateforme a un connecteur, mais pas pour ce levier | `platform`, `lever` |

Le registre est clé sur le couple **`(plateforme, levier)`** (`leviers.md` L2, confirmé par F11 de
`plateformes/faisabilite-search.md`) : la même plateforme n'accepte pas les mêmes choses sur deux
leviers. Il est vide dans le socle — chaque plateforme arrive avec sa phase, et ce qu'un levier
_autorise_ est l'affaire du profil de levier, qui refuse en 400 à l'écriture.

Les identifiants de plateforme sont ceux de `../../CADRAGE.md` § 6 : `google_ads`, `microsoft`,
`openai`, `thrad`, `amazon_search`, `amazon_dsp`, `dv360`, `hawk`, `meta`, `tiktok`, `snap`.

## Infrastructure

| Code                    | Statut | Quand                                                                  | `params` |
| ----------------------- | ------ | ---------------------------------------------------------------------- | -------- |
| `job_queue_unavailable` | 503    | La file de jobs n'a pas encore démarré : réessayer                     | `{}`     |
| `secret_missing`        | 500    | Un secret attendu n'existe pas dans le magasin : erreur de déploiement | `{}`     |

## Routes

| Code              | Statut | Quand                              | `params`        |
| ----------------- | ------ | ---------------------------------- | --------------- |
| `route_not_found` | 404    | Aucune route ne correspond à l'URL | `method`, `url` |

## Codes génériques

Une erreur sans code propre prend le code de son statut (`DEFAULT_ERROR_CODES`, `src/utils/http.utils.ts`), sans `params` ; un statut absent de cette liste prend `error`. Le backend n'en émet pas lui-même : ils viennent de Fastify et de ses extensions (JSON illisible, corps trop gros, type de contenu refusé) ou d'une panne imprévue.

| Code                     | Statut |
| ------------------------ | ------ |
| `bad_request`            | 400    |
| `unauthorized`           | 401    |
| `forbidden`              | 403    |
| `not_found`              | 404    |
| `method_not_allowed`     | 405    |
| `conflict`               | 409    |
| `payload_too_large`      | 413    |
| `unsupported_media_type` | 415    |
| `unprocessable`          | 422    |
| `too_many_requests`      | 429    |
| `internal_error`         | 500    |
| `bad_gateway`            | 502    |
| `unavailable`            | 503    |

## Erreurs serveur

Le message d'une **5xx** ne sort pas de l'application hors développement : il est remplacé par `Internal Server Error`, et le vrai message avec sa pile part dans les journaux, relié à la réponse par `requestId`. Les messages d'erreur portent des chaînes de connexion, des chemins et du SQL : ne jamais élargir cette règle.

Les messages d'une **4xx** atteignent l'appelant : ils lui disent quoi corriger.
