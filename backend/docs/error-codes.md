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

| Code                   | Statut | Quand                                                         | `params`             |
| ---------------------- | ------ | ------------------------------------------------------------- | -------------------- |
| `super_admin_required` | 403    | Action réservée aux administrateurs de la plateforme          | `{}`                 |
| `role_required`        | 403    | Le rôle de l'appelant est inférieur à celui qu'exige l'action | `required`, `actual` |

Les `assert*` sont du **calcul pur** sur l'instantané que `resolve` a rapporté : vérifier un droit ne coûte aucun appel réseau.

`role_required`, et les **404** `organization_not_found` et `seat_not_found` d'une Organization ou d'un Seat que l'appelant ne peut pas voir, sont émis par `@omnilor/omnipass-client`. Le bouchon de développement du socle accorde tout — `admin` sur toute Organization, `seat_admin` sur tout Seat — et n'émet donc qu'un seul de ces codes, `super_admin_required`, parce que `DEV_ACTOR_SUPER_ADMIN` peut être `false`. C'est voulu, et c'est pourquoi la production refuse de démarrer avec lui (D43).

Une Organization disparue chez omnipass répond **404**, jamais 500 (T4).

## Organization d'une requête

`src/utils/http.utils.ts`, `src/mcp/tool-result.ts`.

| Code                          | Statut | Quand                                                                                                | `params` |
| ----------------------------- | ------ | ---------------------------------------------------------------------------------------------------- | -------- |
| `organization_header_missing` | 400    | L'en-tête `X-Organization-Id` manque sur une route qui agit sur une Organization                     | `header` |
| `organization_id_required`    | 400    | Un tool MCP n'a reçu ni l'argument `organizationId` ni l'en-tête `X-Organization-Id` de la connexion | `{}`     |

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
