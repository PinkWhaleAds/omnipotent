# Codes de l'API

Pour le développeur du front. Le backend écrit ses messages en anglais ; le front est en français. Chaque message que l'API renvoie porte donc un **code** stable et les **valeurs** de son message : le front traduit `code` + `params`, et n'affiche le `message` anglais qu'en secours, pour un code qu'il ne connaît pas encore.

Ce document est relevé dans le code (`src/`). Il ne contient aujourd'hui que les codes du **socle** — authentification, droits, limites de débit, validation, MCP, pannes d'infrastructure. **Chaque phase ajoute ici les codes de sa ressource**, dans sa section, avec la même règle : un code qui part en production ne change plus de sens.

## Où trouver les codes

| Message         | Où                       | Champs                      |
| --------------- | ------------------------ | --------------------------- |
| Erreur de l'API | Toute réponse 4xx ou 5xx | `code`, `params`, `message` |

Les autres sortes de messages codés — problèmes d'une prévisualisation, conformité d'une créa, tâches à traiter, état d'un objet chez une plateforme — arrivent dans des réponses **réussies** et viennent avec leurs phases. Le modèle est celui de multi-search (`~/PinkWhale/multi-search/backend/docs/error-codes.md`) : une ligne par sorte de message, avec les champs qui portent le code.

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

Les corps sont validés par leur schéma Zod lui-même (`src/plugins/validation.plugin.ts`), les querystrings, paramètres d'URL et en-têtes par AJV sur leur JSON Schema. Dans les deux cas la réponse a la forme ci-dessus, et la correspondance entre les deux est faite par `src/utils/validation.utils.ts`. Les longueurs se comptent en caractères Unicode (points de code) : un emoji compte 1. Jusqu'au 2026-11-21, elles se comptaient en unités UTF-16, un emoji comptant 2 ; Zod 4.6 a changé de mesure pour corriger une faille, et AJV l'a suivi. Un front qui mesure avec `.length` reste plus strict que l'API, donc jamais refusé.

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

Ces quatre codes sont levés par `@pinkwhaleads/omnipass-client`, sous la forme d'une `OmnipassError` qui porte `statusCode`, `code`, `params` et les alias `errorCode` / `errorParams` que le gestionnaire d'erreurs lit déjà : elle traverse l'API telle quelle, **sans adaptateur**. Ils viennent tous du vrai service : il n'y a plus de bouchon local depuis le 2026-11-17 (D43, amendé), précisément parce qu'un bouchon qui accorde tout ne peut émettre aucun de ces refus.

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

| Code                       | Statut | Quand                                                                            | `params` |
| -------------------------- | ------ | -------------------------------------------------------------------------------- | -------- |
| `<niveau>_not_found`       | 404    | Absent, supprimé, ou d'une autre Organization                                    | `{}`     |
| `<niveau>_not_deleted`     | 409    | `restore` sur un nœud vivant                                                     | `{}`     |
| `lever_already_exists`     | 409    | La campagne porte déjà ce canal — à la création comme à une restauration         | `lever`  |
| `line_creative_duplicated` | 409    | Une autre Line du même TargetingGroup diffuse déjà cette créa (`phase-6.md` § 6) | `line`   |

Une Line choisit sa créa par `creativeId`, à sa création ou ensuite : une créa d'une autre marque que
la campagne, ou supprimée, répond `creative_not_found`.

### Ce que le modèle refuse d'exprimer

Ces refus viennent du **profil de levier**, qui dit ce que le modèle permet. Ce qu'une **plateforme**
n'accepte pas est l'affaire du registre de plateforme, et devient un avertissement de preview, pas
une erreur (L2).

| Code                          | Statut | Quand                                                                                                                                                                                                                                            | `params`                  |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| `lever_field_forbidden`       | 400    | Le profil déclare ce champ `interdit` à ce niveau — un budget sur une Line Search (D12), un capping sur le Search (L6), des extensions ou une intention de lieu hors du Search. Sur une campagne, la règle est l'union des leviers qu'elle porte | `lever`, `level`, `field` |
| `platform_not_eligible`       | 400    | La plateforme ne sert pas ce levier (`../../CADRAGE.md` § 6)                                                                                                                                                                                     | `platform`, `lever`       |
| `bid_strategy_not_permitted`  | 400    | Stratégie hors de celles que le profil du levier permet                                                                                                                                                                                          | `strategy`, `lever`       |
| `objective_not_permitted`     | 400    | Objectif hors de ceux que le profil du levier permet                                                                                                                                                                                             | `objective`, `lever`      |
| `products_mode_not_permitted` | 400    | Le levier n'a pas de mode Produits (L13, L14)                                                                                                                                                                                                    | `lever`                   |
| `volume_not_permitted`        | 400    | Le levier n'accepte pas de saisie en volume dans cette unité (L25)                                                                                                                                                                               | `unit`, `lever`           |

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

| Code                                | Statut | Quand                                                                                                                          | `params`                     |
| ----------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `targeting_dimension_forbidden`     | 400    | Le levier du nœud n'a rien à faire de cette dimension                                                                          | `lever`, `dimension`         |
| `targeting_criteria_invalid`        | 400    | Les critères ne passent pas le schéma de leur dimension, clé inconnue comprise                                                 | `dimension`, `reason`        |
| `targeting_list_kind_mismatch`      | 400    | Une liste d'un genre branchée sur une dimension qui en attend un autre                                                         | `listId`, `kind`, `expected` |
| `targeting_location_unknown`        | 400    | Un lieu de `location` dont le référentiel ne connaît pas l'identifiant (`GET /geo/locations`)                                  | `ids`                        |
| `targeting_location_not_targetable` | 400    | Un lieu de `location` qui ne se cible pas ainsi : un pays (par `country`), un niveau non proposé, ou un lieu que Google retire | `ids`                        |
| `targeting_group_not_found`         | 404    | Le TargetingGroup est absent, supprimé, ou d'une autre Organization                                                            | `{}`                         |

Une dimension absente du registre ou un type de dimension inconnu sont refusés **par le schéma** de
la route, donc en `validation_failed` : l'énumération des dimensions fait partie du contrat.

### Le ciblage géographique : ce que le front doit savoir

Ce que fait multi-search, repris tel quel, avec ce que le modèle d'Omnipotent y change
(`docs/phase-10.md` § 8.9, D57). Un front qui l'ignore compose des ciblages que la preview refuse, ou
qui diffusent plus large qu'il ne le montre.

- **Les pays sont la limite du TargetingGroup.** Un pays qui contient des lieux ou des rayons est
  **remplacé** par eux ; un pays qui n'en a aucun part entier. « France et Belgique, avec Paris » vaut
  donc Paris plus toute la Belgique, et non Paris seul. Un lieu ou un rayon hors des pays inclus est
  une **erreur** de preview : pour cibler Paris, inclure aussi la France.
- **Un lieu s'envoie par son seul identifiant**, celui du référentiel (`GET /geo/locations`) :
  `{ "include": [{ "id": "1006094" }] }`. L'API complète `level`, `name`, `canonicalName` et
  `countryCode`, et les rend à la lecture. Renvoyer ce qu'une lecture a rendu n'est pas une erreur : ces
  champs sont réécrits depuis le référentiel.
- **Un code postal est un lieu** comme un autre, trouvé par la recherche avec le niveau
  `postal_code`. La dimension `zip_code`, du texte libre sans pays, n'est pas envoyée à Google : la
  preview le dit, avec le montant qui partirait sans elle.
- **Un rayon porte son pays** (`countryCode`), obligatoire : c'est le pays qu'il remplace. Le géocodage
  le donne ; un rayon posé à la main sur une carte doit le recevoir du front.
- **Les noms sont ceux de Google, en anglais** (« Ile-de-France »). Les noms français des régions qui en
  ont un se cherchent aussi, mais la réponse garde le nom de Google.
- **Un lieu que Google retire** reste lisible (`active: false` dans `GET /geo/locations/by-ids`), mais
  il bloque toute nouvelle écriture des lieux du TargetingGroup tant qu'il n'en est pas ôté : le front
  doit le montrer et proposer de l'enlever.
- **Le géocodage peut être éteint** : ses routes répondent alors `geo_service_unavailable`, et
  `GET /geo/status` le dit d'avance, pour ne pas montrer un champ d'adresse qui échouera. Il est aussi
  plafonné par heure et par Organization. Une adresse introuvable n'est pas une erreur de la requête :
  elle porte son propre code dans la réponse, à côté des autres.
- **Chez multi-search, le ciblage est sur l'AdGroup, et se modifie en partie.** Ici, il est sur le
  TargetingGroup, une dimension à la fois : `country`, `location` et `proximity` s'écrivent chacune par
  sa route.

### Le référentiel des lieux et le géocodage

`src/services/{geo,geocoding}.service.ts` (`docs/phase-10.md` § 8.9). Les routes du référentiel ne
nomment aucune Organization : il est le même pour tous. Celles du géocodage et de la carte en nomment
une, dont elles consomment le plafond horaire.

| Code                       | Statut | Quand                                                                                                                              | `params` |
| -------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `geo_search_too_short`     | 400    | Le texte cherché a moins de `min` lettres ou chiffres, une fois la casse, les accents et la ponctuation ôtés                       | `min`    |
| `geo_hourly_limit_reached` | 429    | L'Organization a demandé `limit` adresses, positions ou cartes dans l'heure : un garde-fou contre une boucle, compté par processus | `limit`  |
| `geo_service_unavailable`  | 503    | Le géocodage et les cartes ne sont pas disponibles ici (`GET /geo/status`) : placer le rayon par ses coordonnées                   | `{}`     |
| `geo_map_failed`           | 502    | Amazon Location n'a pas dessiné la carte                                                                                           | `{}`     |

Une adresse ou une position introuvable **n'est pas une erreur de la requête** : la réponse est un 200,
et l'élément porte son propre code dans `errorCode`, à côté des autres :

| `errorCode`              | Quand                                                          |
| ------------------------ | -------------------------------------------------------------- |
| `geo_address_not_found`  | Aucun lieu ne correspond à l'adresse, dans les pays demandés   |
| `geo_position_not_found` | Aucune adresse près de la position                             |
| `geo_lookup_failed`      | Amazon Location a échoué sur cet élément : réessayer plus tard |

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
un même ciblage (`line_creative_duplicated`, à l'écriture de la Line).

## Les comptes plateformes

`src/services/ad-account.service.ts` (phase 7, `docs/phase-7.md` § 7).

| Code                            | Statut | Quand                                                               | `params`                 |
| ------------------------------- | ------ | ------------------------------------------------------------------- | ------------------------ |
| `ad_account_transition_invalid` | 400    | La table des transitions ne nomme pas ce passage                    | `from`, `to`             |
| `ad_account_unusable`           | 400    | Relier une marque à un compte dont l'accès n'est plus valide        | `status`, `statusReason` |
| `ad_account_not_found`          | 404    | Absent, déconnecté, ou d'une autre Organization                     | `{}`                     |
| `ad_account_not_deleted`        | 409    | `restore` sur un compte connecté                                    | `{}`                     |
| `ad_account_already_connected`  | 409    | Cette Organization a déjà ce compte sur cette plateforme            | `platform`, `externalId` |
| `advertiser_account_exists`     | 409    | Cette marque a déjà un compte pour cette plateforme et cette devise | `platform`, `currency`   |
| `advertiser_account_not_found`  | 404    | Lien absent, ou d'une autre Organization                            | `{}`                     |

La **devise** d'un compte ne figure pas dans son corps de mise à jour : les montants déjà poussés y
sont exprimés, donc un compte d'une autre devise est un autre compte — l'envoyer est un
`validation_failed`. Et il n'existe **aucun code** au sujet d'un credential : sa valeur n'est jamais
lue, donc jamais refusée ; l'API ne dit que `hasCredentials`.

### Les comptes liés à notre compte gestionnaire

Phase 10 (`docs/phase-10.md` § 4). Une plateforme dont l'adapter déclare `manager_link` — Google Ads,
puis Microsoft — connecte un compte par sa seule **référence** : nous l'invitons sous notre compte
gestionnaire, ou le lisons tout de suite quand celui-ci le gère déjà. Son nom, sa devise et son fuseau
sont **lus** chez la plateforme, et son statut suit le lien.

| Code                           | Statut | Quand                                                                                                                                                      | `params`                |
| ------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `ad_account_field_required`    | 400    | Déclarer un compte d'une plateforme qui ne les donne pas sans son nom, sa devise ou son fuseau                                                             | `platform`, `field`     |
| `ad_account_field_read`        | 400    | Déclarer, ou changer, un nom, une devise ou un fuseau que la plateforme donne                                                                              | `platform`, `field`     |
| `ad_account_reference_invalid` | 400    | La référence n'en est pas une : un customer id Google a dix chiffres, tirets permis                                                                        | `platform`, `field`     |
| `ad_account_status_read`       | 400    | Une transition à la main sur un compte lié ; seule `invalid → pending` se demande, et réinvite                                                             | `platform`, `to`        |
| `ad_account_currency_unknown`  | 400    | Relier une marque à un compte dont le client n'a pas encore accepté le lien : pas de devise                                                                | `status`                |
| `ad_account_manager`           | 400    | Le compte est lui-même un compte gestionnaire, qui ne diffuse aucune campagne                                                                              | `platform`, `reference` |
| `ad_account_link_refused`      | 400    | La plateforme refuse le lien, avec son propre code quand elle en donne un                                                                                  | `platform`, `reason`    |
| `ad_account_linked_elsewhere`  | 409    | Une autre Organization tient ce compte — sans dire laquelle                                                                                                | `platform`              |
| `ad_account_already_managed`   | 409    | Notre compte gestionnaire gère déjà ce compte, et ni un super-admin ni l'Organization qui l'a tenu en dernier ne le demande (règle de Lorin du 2026-11-19) | `platform`              |
| `platform_credentials_failed`  | 502    | **Nos** credentials ont échoué : un opérateur doit agir, le client n'y peut rien                                                                           | `platform`              |
| `platform_unavailable`         | 503    | La plateforme n'a pas répondu, ou demande d'attendre : réessayer dans un moment                                                                            | `platform`              |

Un refus que **nous** avons formulé arrive avec notre code à nous, et les valeurs de son message : la
phase de chaque plateforme les ajoute ici. Un compte dont la plateforme n'a pas d'adapter, ou dont
l'adapter se dit `manager_link` sans implémenter le lien, répond `sync_adapter_missing` (500) : c'est
notre manque, jamais celui de l'appelant.

Le **motif de statut** `manager_account` s'ajoute aux autres : un compte qui se révèle, à
l'acceptation, être lui-même un compte gestionnaire passe `invalid` avec lui.

#### Les refus de Microsoft Advertising

Phase 11 (`docs/phase-11.md` § 2). La référence d'un compte Microsoft est son **numéro de compte** —
huit lettres et chiffres, lus dans Outils → Tous les comptes —, et l'inviter demande en plus le numéro
du client qui le possède, dans `scope.customerNumber`. Ces refus sont les nôtres : ils arrivent avec
leur code, en `400`.

| Code                                  | Quand                                                                                                              | `params`               |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| `ad_account_customer_number_required` | Inviter un compte sans le numéro du client qui le possède                                                          | `platform`             |
| `ad_account_prepaid`                  | Le compte est prépayé, ce qu'aucun compte gestionnaire ne gère : son client passe d'abord en facturation mensuelle | `platform`             |
| `ad_account_link_not_active`          | Lire un compte que notre compte gestionnaire ne gère pas : ni à notre propre client, ni sous un lien actif         | `platform`             |
| `ad_account_not_expert`               | Le compte est en mode Smart : son client le passe en mode Expert                                                   | `platform`, `mode`     |
| `ad_account_inactive`                 | Le compte est inactif ou suspendu                                                                                  | `platform`, `status`   |
| `ad_account_timezone_unknown`         | Son fuseau n'est pas dans notre table, ou il n'a pas de devise : rien n'est deviné                                 | `platform`, `timezone` |

## Les conversions

`src/services/{conversion-goal,tracking}.service.ts` (`docs/phase-10.md` § 8.10, D58).

### Ce que le front doit savoir

Ce que fait multi-search, repris tel quel, avec ce que le modèle d'Omnipotent y change. Un front qui
l'ignore installe un code qui ne mesure rien, ou montre prête une campagne qui ne peut pas partir.

- **Un seul code par marque.** `GET /advertisers/:id/tracking` donne l'extrait à coller dans le `<head>`
  de chaque page du site (`snippet`), l'adresse du script qu'il charge, et les domaines que la
  Content Security Policy du site doit autoriser (`cspDomains`). La première lecture donne à la marque la
  clé publique de son script : elle ne change plus ensuite.
- **Rien ne part avant le consentement.** Le site appelle `msq('consent', { ads: 'granted' })` depuis
  son bandeau de consentement, et `msq('consent', { ads: 'denied' })` en cas de refus. Avant, le script
  ne charge aucune balise et ne pose aucun cookie : les conversions attendent, cinquante au plus, et un
  refus les efface. Le front doit le dire à l'utilisateur, qui l'oublie sinon : un site sans cet appel ne
  mesure rien, sans aucune erreur.
- **Une conversion** est `msq('conversion', { goal: '<clé>', value, currency, orderId })`. `value` et
  `currency` ne servent qu'à un objectif `dynamic` ; un objectif `fixed` envoie toujours sa valeur, un
  objectif `none` aucune. `orderId` évite qu'une même commande compte deux fois. Ces appels sont ceux du
  script de multi-search : un site déjà équipé garde son code.
- **`lastSeenAt`** dit quand une page du site a chargé le script pour la dernière fois, à l'heure près :
  `null` tant que le code n'est pas installé.
- **L'état d'un objectif se lit compte par compte**, dans `platforms[].goals[]` : `pending` tant qu'il
  n'est pas mis en place, `ready`, `manual_required` quand quelqu'un doit agir, `failed` quand la
  plateforme a refusé, `paused` une fois l'objectif archivé. La mise en place se fait en tâche de fond
  après chaque écriture ; ce qui échoue ou attend quelqu'un est repris toutes les demi-heures.
- **La valeur d'un objectif est en centimes** (`defaultValueCents`), comme tout montant de l'API ; le
  site, lui, envoie des unités (`value: 89.9`).
- **La clé et la catégorie ne changent jamais.** Deux clés qui ne diffèrent que par `-` et `_` sont
  refusées. Un objectif ne se supprime pas : il s'archive, et l'archivage est refusé tant qu'un AdGroup
  d'une campagne lancée l'optimise. Chez Google, rien n'est supprimé : l'action reste, et le script ne
  l'appelle plus.
- **L'objectif optimisé se pose sur l'AdGroup** (`conversionGoalId`), à côté de sa stratégie, et non sur
  la campagne comme chez multi-search. Il ne compte qu'en `maximize_conversions`. Il se change après le
  lancement, comme la stratégie : **l'apprentissage de Google repart alors**, et le front doit le dire.
- **Une campagne en `maximize_conversions` ne part pas** tant que son objectif n'est pas prêt sur le
  compte de la plateforme : la preview le refuse, et la synchro aussi pour une campagne déjà lancée.

### Les refus des routes

| Code                                | Statut | Quand                                                                                                                            | `params`                                                 |
| ----------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `conversion_goal_not_found`         | 404    | L'objectif n'existe pas, ou appartient à une autre Organization ou à une autre marque                                            | `{}`                                                     |
| `conversion_goal_currency_required` | 400    | Une valeur (`fixed` ou `dynamic`) sans devise                                                                                    | `valueMode`                                              |
| `conversion_goal_value_required`    | 400    | Une valeur fixe sans montant                                                                                                     | `valueMode`                                              |
| `conversion_goal_key_taken`         | 409    | La marque a déjà un objectif de cette clé, archivé compris                                                                       | `key`                                                    |
| `conversion_goal_key_too_close`     | 409    | La clé ne diffère d'une autre que par `-` et `_` : une plateforme ne les distinguerait pas                                       | `key`, `existingKey`                                     |
| `conversion_goal_optimized`         | 409    | Archiver un objectif qu'optimise un AdGroup d'une campagne lancée : lui donner d'abord un autre objectif, ou une autre stratégie | `adGroupId`, `adGroupName`, `campaignId`, `campaignName` |
| `conversion_goal_archived`          | 400    | Nommer sur un AdGroup un objectif archivé                                                                                        | `goalName`                                               |
| `tracking_key_unknown`              | 404    | Le script d'une clé qu'aucune marque n'a (`GET /t/:key.js`)                                                                      | `{}`                                                     |

### Pourquoi un suivi ou un objectif n'est pas prêt

`messageCode` et `messageParams` de `platforms[]` et de `platforms[].goals[]`, quand c'est nous qui avons
formulé le message ; un texte de la plateforme a `messageCode` nul.

| Code                                          | Où       | Quand                                                                                                                                   | `params`           |
| --------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `tracking_not_supported`                      | suivi    | Omnipotent ne sait pas encore mettre le suivi en place sur cette plateforme                                                             | `platform`         |
| `google_conversion_tracking_by_our_manager`   | suivi    | Les conversions du compte sont suivies par notre compte gestionnaire (suivi inter-comptes) : un opérateur doit le couper pour ce compte | `account`          |
| `google_conversion_tracking_by_other_manager` | suivi    | Les conversions du compte sont suivies par un autre compte gestionnaire : il doit cesser de les suivre                                  | `account`          |
| `google_conversion_snippet_missing`           | objectif | Google n'a pas donné d'extrait de page pour l'action de conversion                                                                      | `conversionAction` |

## La preview et le cycle de vie

`src/services/preview.service.ts` (phase 8, `docs/phase-8.md` § 3 et § 4).

Les constats de la preview ne sont **pas** des erreurs HTTP : ils voyagent **dans** sa réponse, en
deux listes. Ce sont des codes stables avec leurs valeurs, comme les erreurs, parce que le front les
traduit de la même façon.

### Les refus des routes

| Code                                         | Statut | Quand                                                                                                                                                                                              | `params`                |
| -------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `campaign_preview_failed`                    | 400    | Lancer alors que la preview rapporte au moins une erreur                                                                                                                                           | `errors`                |
| `campaign_not_draft`                         | 400    | Lancer autre chose qu'un brouillon                                                                                                                                                                 | `status`                |
| `campaign_transition_invalid`                | 400    | La table des transitions ne nomme pas ce passage                                                                                                                                                   | `from`, `to`            |
| `campaign_political_advertising_unsupported` | 400    | Déclarer une campagne **déjà lancée** comme publicité politique : les plateformes portent notre déclaration inverse, et l'arrêter pour une déclaration tardive est une fonctionnalité à part (D53) | `status`                |
| `campaign_start_reached`                     | 400    | Déplacer le premier jour ou l'heure de départ d'une campagne lancée qui a déjà démarré                                                                                                             | `startsOn`, `startTime` |
| `campaign_start_past`                        | 400    | Déplacer le départ d'une campagne lancée vers un moment déjà passé                                                                                                                                 | `startsOn`, `startTime` |

`draft → active` n'est pas dans la table : on ne lance pas une campagne en écrivant un champ, et
`PUT /campaigns/:id/status` n'accepte donc pas `draft` dans son corps.

Le statut d'un nœud sous la campagne — levier, AdGroup, TargetingGroup, Line — se change par
`PUT /<niveau>/:id/status` (`phase-10.md` § 8.4, point 2) :

| Code                    | Statut | Quand                                                                                             | `params`                   |
| ----------------------- | ------ | ------------------------------------------------------------------------------------------------- | -------------------------- |
| `node_campaign_closed`  | 400    | La campagne est terminée ou archivée : ses nœuds gardent leur statut                              | `status`                   |
| `node_status_unchanged` | 400    | Le nœud a déjà ce statut                                                                          | `level`, `status`          |
| `node_ended`            | 400    | Activer, dans une campagne lancée, un nœud dont la fenêtre est finie                              | `level`, `endsOn`          |
| `node_not_activatable`  | 400    | Activer, dans une campagne lancée, un nœud sur lequel ou sous lequel la preview trouve une erreur | `level`, `errors`, `codes` |

Une erreur de la preview sous un nœud **en pause** ne bloque pas le lancement : ce nœud n'envoie rien.
Elle bloquera son activation.

### Les erreurs de la preview, qui bloquent le lancement

| Code                                        | Quand                                                                                                                                                                                                                                 | `params`                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `preview_lever_missing`                     | La campagne n'achète sur aucun levier                                                                                                                                                                                                 | `{}`                                           |
| `preview_political_advertising_unsupported` | La campagne est déclarée comme publicité politique : aucune plateforme du périmètre n'en accepte (D53)                                                                                                                                | `{}`                                           |
| `preview_ad_group_missing`                  | Un levier sans AdGroup                                                                                                                                                                                                                | `lever`                                        |
| `preview_targeting_group_missing`           | Un AdGroup sans TargetingGroup                                                                                                                                                                                                        | `name`                                         |
| `preview_line_missing`                      | Un TargetingGroup sans Line                                                                                                                                                                                                           | `name`                                         |
| `preview_creative_missing`                  | Une Line sans créa, ou dont la créa a été supprimée                                                                                                                                                                                   | `name`                                         |
| `preview_creative_version_missing`          | Une créa dont aucune version ne diffuse                                                                                                                                                                                               | `creative`                                     |
| `preview_creative_text_duplicate`           | Une créa répète un texte là où son couple les veut tous différents, espaces et majuscules mis à part : deux titres d'une annonce responsive, par exemple                                                                              | `creative`, `field`, `text`                    |
| `preview_keywords_missing`                  | Un TargetingGroup Search sans mot-clé positif                                                                                                                                                                                         | `name`                                         |
| `preview_account_missing`                   | Aucun compte relié pour cette plateforme et cette devise                                                                                                                                                                              | `platform`, `currency`                         |
| `preview_account_unusable`                  | Le compte relié n'est pas actif                                                                                                                                                                                                       | `platform`, `status`, `statusReason`           |
| `preview_account_credentials_missing`       | Le compte n'a pas de credentials, sur une plateforme où chaque compte apporte les siens                                                                                                                                               | `platform`                                     |
| `preview_adapter_missing`                   | Le couple `(plateforme, levier)` n'a pas encore d'adapter                                                                                                                                                                             | `platform`, `lever`                            |
| `preview_click_url_missing`                 | La plateforme exige une URL de clic que ni la Line ni sa créa n'ont                                                                                                                                                                   | `creative`                                     |
| `preview_bid_strategy_unsupported`          | La plateforme n'enchérit pas avec la stratégie de cet AdGroup                                                                                                                                                                         | `platform`, `strategy`                         |
| `preview_too_many_ads`                      | Plus d'annonces actives sous un même objet que la plateforme n'en diffuse : trois par ad group chez Google                                                                                                                            | `count`, `max`                                 |
| `preview_targeting_not_shared`              | Des TargetingGroups qui partagent une campagne de la plateforme demandent des lieux différents, alors qu'elle ne les pose que sur la campagne : donner un budget propre à l'un, ce qui l'éclate, ou le déplacer dans un autre AdGroup | `dimension`                                    |
| `preview_geo_outside_countries`             | Des lieux ou des rayons d'un TargetingGroup hors des pays qu'il inclut, ou un rayon sans pays, écrit avant D57 : inclure leur pays, ou les ôter                                                                                       | `count`, `names`                               |
| `preview_conversion_goal_missing`           | Un AdGroup en `maximize_conversions` ne nomme pas d'objectif, ou un objectif que l'Organization n'a pas : lui en donner un (`conversionGoalId`)                                                                                       | `{}`                                           |
| `preview_conversion_goal_archived`          | L'objectif qu'optimise cet AdGroup est archivé : il n'est plus mesuré                                                                                                                                                                 | `goalName`                                     |
| `preview_conversion_goal_not_ready`         | L'objectif qu'optimise cet AdGroup n'est pas prêt sur le compte de la plateforme ; `reasonCode` dit pourquoi, quand on le sait (voir « Les conversions »)                                                                             | `platform`, `goalName`, `status`, `reasonCode` |
| `preview_geo_too_many_radii`                | Plus de rayons que cette plateforme n'en prend sur un objet                                                                                                                                                                           | `platform`, `count`, `max`                     |
| `preview_sitelink_descriptions`             | Un lien annexe à une seule ligne de description : les plateformes en prennent deux, ou aucune                                                                                                                                         | `text`                                         |
| `preview_iab_categories_missing`            | La plateforme exige des catégories IAB que la créa n'a pas                                                                                                                                                                            | `creative`                                     |
| `preview_platform_campaign_cap`             | L'éclatement dépasse le plafond d'objets par AdGroup                                                                                                                                                                                  | `objects`, `max`                               |

### Les avertissements, qui ne bloquent rien

| Code                              | Quand                                                                                                                                                                                   | `params`                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `preview_targeting_dropped`       | Cette plateforme n'applique pas cette dimension : **ce montant y diffusera sans elle**                                                                                                  | `dimension`, `cents`                      |
| `preview_geo_widened_to_country`  | Cette plateforme ne sait pas cibler un lieu ou un rayon de ce pays (`reasons` : `level`, `radius`) : **elle y diffuse dans tout le pays**, avec ce montant                              | `platform`, `country`, `reasons`, `cents` |
| `preview_geo_exclusions_ignored`  | Cette plateforme n'exclut pas des lieux de ce niveau : ils ne sont pas exclus chez elle                                                                                                 | `platform`, `count`, `names`              |
| `preview_creative_dropped`        | Cette plateforme n'accepte pas le couple de la créa                                                                                                                                     | `format`, `subtype`                       |
| `preview_campaign_split`          | L'éclatement crée plusieurs objets là où il y en aurait eu un                                                                                                                           | `objects`, `level`                        |
| `preview_node_paused`             | Un nœud en pause : il ne partira pas                                                                                                                                                    | `{}`                                      |
| `preview_extensions_dropped`      | Cette plateforme ne montre aucune des extensions du levier                                                                                                                              | `platform`                                |
| `preview_bid_amount_ignored`      | Cette plateforme ne prend pas de montant sous cette stratégie : Google maximise les conversions sans coût cible, **le montant de l'AdGroup ou de ses TargetingGroups n'est pas envoyé** | `platform`, `strategy`                    |
| `preview_location_intent_dropped` | Cette plateforme ne vise que les personnes présentes dans les lieux, pas celles qui s'y intéressent                                                                                     | `platform`                                |

Chaque constat porte en plus `level`, `nodeId` et `platform` — nuls quand il concerne la campagne
entière ou toutes les plateformes —, de sorte qu'une interface peut le poser à côté du nœud fautif
sans deviner.

## La synchronisation

`src/services/sync.service.ts` (phase 9, `docs/phase-9.md` § 5).

### Les refus des routes

| Code                         | Statut | Quand                                                         | `params` |
| ---------------------------- | ------ | ------------------------------------------------------------- | -------- |
| `sync_campaign_not_launched` | 400    | Demander une synchro d'un brouillon : il n'existe rien là-bas | `{}`     |
| `platform_unit_not_found`    | 404    | L'unité n'existe pas, ou appartient à une autre campagne      | `{}`     |

### Les erreurs qu'une unité garde

Elles ne sont pas des réponses HTTP : elles sont **enregistrées sur l'unité**, et la route de statut
les rend dans `errorCode` et `errorParams`. Le front les traduit comme les autres.

| Code                               | Quand                                                                                                                                                                                                                                                                                               | `params`   |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `sync_adapter_missing`             | Le couple est déclaré au registre mais aucune phase n'a écrit l'adapter                                                                                                                                                                                                                             | `platform` |
| `sync_account_not_linked`          | Un compte **déclaré à la main** sur une plateforme dont les credentials sont les nôtres, donc jamais lié par nous : rien n'y est poussé. Le déconnecter, puis le connecter par sa référence (`docs/phase-10.md` § 4.5)                                                                              | `platform` |
| `sync_platform_credentials_failed` | **Nos** credentials ont échoué chez la plateforme — un compte de service, l'autorisation de notre compte gestionnaire. Le compte du client reste `active`, et l'unité réessaie avec le recul habituel : c'est à un opérateur d'agir, et tout repart seul une fois réparé (`docs/phase-10.md` § 4.2) | `platform` |

Une erreur venue d'une plateforme garde **son** texte et son code à elle : `errorCode` est alors nul,
sauf quand c'est nous qui avons formulé le message — les phases plateformes ajouteront leurs codes
ici. Les erreurs que la synchronisation rencontre ailleurs dans l'application (un secret absent, un
compte illisible) arrivent avec leur propre code, celui qu'elles portaient déjà.

Les refus que l'adapter de Google Ads formule lui-même, avant ou après avoir appelé Google
(`phase-10.md` § 8.5) — aucun ne se retente seul :

| Code                                 | Quand                                                                                                                                                                         | `params`             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| `google_campaign_removed`            | La campagne Google de ce nœud a été supprimée hors d'Omnipotent : elle n'est jamais recréée en silence                                                                        | `campaign`           |
| `google_country_unsupported`         | Un pays inclus que Google Ads ne cible pas                                                                                                                                    | `country`            |
| `google_geo_outside_countries`       | Des lieux ou des rayons hors des pays inclus — la preview les refuse d'abord : sans eux, la campagne diffuserait plus large que demandé                                       | `count`              |
| `google_bid_strategy_unsupported`    | Une stratégie avec laquelle Google Search n'enchérit pas ici — la preview la refuse d'abord                                                                                   | `strategy`           |
| `google_conversion_goal_missing`     | Un AdGroup en `maximize_conversions` sans objectif — la preview le refuse d'abord                                                                                             | `{}`                 |
| `google_conversion_goal_not_ready`   | L'objectif qu'optimise l'AdGroup n'est pas prêt sur ce compte : sans lui, la campagne enchérirait sur les objectifs du compte du client. L'unité repart seule dès qu'il l'est | `goalName`, `status` |
| `google_conversion_goal_unavailable` | L'objectif est prêt mais n'a pas d'objectif personnalisé sur ce compte                                                                                                        | `{}`                 |
| `google_bid_required`                | Un CPC manuel sans montant d'enchère                                                                                                                                          | `{}`                 |
| `google_ad_incomplete`               | Une Line active sans créa ou sans page de destination — la preview la refuse d'abord                                                                                          | `line`               |

Ce qui distingue les deux familles n'est pas le code mais `nextAttemptAt` : une prochaine tentative
fixée veut dire « réessayer peut marcher », et **nulle** veut dire qu'il faut corriger quelque chose —
une modification, qui remet le bit, ou `POST /campaigns/:id/platform-units/:unitId/retry`.

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

| Code                         | Statut | Quand                                                                                      | `params`                       |
| ---------------------------- | ------ | ------------------------------------------------------------------------------------------ | ------------------------------ |
| `platform_unknown`           | 400    | Aucun connecteur ne déclare cette plateforme                                               | `platform`                     |
| `platform_lever_unsupported` | 400    | La plateforme a un connecteur, mais pas pour ce levier                                     | `platform`, `lever`            |
| `platform_setting_unknown`   | 400    | Un réglage du levier que la plateforme ne déclare pas pour ce levier (`phase-10.md` § 8.4) | `platform`, `lever`, `setting` |

Le registre est clé sur le couple **`(plateforme, levier)`** (`leviers.md` L2, confirmé par F11 de
`plateformes/faisabilite-search.md`) : la même plateforme n'accepte pas les mêmes choses sur deux
leviers. Chaque plateforme y arrive avec sa phase — Google Ads sur le Search avec la phase 10 —, et ce qu'un levier
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
