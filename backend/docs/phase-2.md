# Phase 2 — Advertisers, labels et le CRUD de référence

Contrat de la phase 2. Deux ressources, et surtout **la forme que les trente phases suivantes
recopient** : soft-delete, `restore`, bulk au choix de l'appelant, pagination, tri, filtres. Se
tromper ici coûte trente fois ; c'est pourquoi la forme est fixée dans ce document avant le code.

Prérequis : la phase 0 (le socle). La tenancy reste celle d'omnipass : `organizationId` est un uuid
**opaque**, aucune clé étrangère ne sort de notre base (T4).

---

## 1. Les deux ressources

### `Advertiser`

La marque pour laquelle on achète. Elle appartient à **une** Organization et portera plus tard sa
bibliothèque de créas et ses comptes plateformes.

| Champ            | Règle                                                                      |
| ---------------- | -------------------------------------------------------------------------- |
| `organizationId` | L'Organization, uuid opaque. Indexé                                        |
| `name`           | 1 à 255 caractères, `trim`. **Unique par Organization**, parmi les vivants |
| `websiteUrl`     | `http(s)`, 2048 caractères au plus, ou `null`                              |

Le nom est unique par Organization parce qu'un advertiser est une marque : deux fois la même dans un
même espace de travail est une erreur de saisie, pas un cas d'usage. L'unicité ne regarde que les
vivants (index partiel sur `deleted_at IS NULL`), sinon supprimer puis recréer une marque serait
refusé.

### `Label`

Un outil d'organisation, **jamais** un porteur de comportement (CADRAGE § 10). Rien du domaine ne
décide quoi que ce soit en fonction d'un label.

| Champ            | Règle                                                                     |
| ---------------- | ------------------------------------------------------------------------- |
| `organizationId` | L'Organization, uuid opaque. Indexé                                       |
| `name`           | 1 à 64 caractères, `trim`. **Unique par Organization**, parmi les vivants |
| `color`          | `#rrggbb` en minuscules                                                   |

Plats, volontairement : pas de hiérarchie, pas de dossier — c'est précisément ce qu'on évite.

### `LabelAssignment`

**Une seule table polymorphe** `(labelId, resourceType, resourceId)`, pas une table de jointure par
type de ressource (D39). L'intégrité référentielle est donc portée par l'application : c'est le
compromis assumé pour qu'ajouter une ressource labélisable ne demande **aucune migration**. Les
ressources étant en soft-delete, une affectation orpheline est inoffensive.

`resourceType` est une énumération applicative qui grandit à chaque phase : `advertiser` seul
aujourd'hui, puis `campaign`, `lever`, `ad_group`, `targeting_group`, `line`, `creative`, `asset`,
`list`. Unique sur le triplet.

## 2. Le CRUD de référence

Toute ressource du domaine suit cette forme. Les six points ont été validés par Lorin le 2026-10-25.

### 2.1 Soft-delete et `restore`

- `DELETE /<resources>/:id` pose `deletedAt`. La ressource disparaît des lectures.
- `POST /<resources>/:id/restore` l'enlève. Rôle requis : `manager`, comme la suppression.
- Les deux répondent **200** avec `{ id, deletedAt }`, jamais un 204 vide : la suppression est douce,
  `deletedAt` est précisément ce que `restore` annule, et c'est déjà la forme que les lots renvoient.
- Restaurer une ressource vivante répond **409** `<resource>_not_deleted` : c'est une erreur de
  l'appelant, pas une opération sans effet.
- La suppression **cascade** sur les enfants et `restore` restaure le **sous-arbre** (D19). Aucune
  des deux ressources de cette phase n'a d'enfant : la phase 3 l'exerce pour de vrai, et la forme est
  déjà là.
- Supprimer une ressource **libère son nom** : l'unicité ne regarde que les vivants.

### 2.2 Le bulk

Le mode est un champ du corps, `mode: 'atomic' | 'partial'`, **`atomic` par défaut** — le moins
surprenant : soit tout passe, soit rien.

| Route                            | Corps                                                     |
| -------------------------------- | --------------------------------------------------------- |
| `POST /<resources>/bulk`         | `{ mode?, items: [<corps de création>, …] }`              |
| `PATCH /<resources>/bulk`        | `{ mode?, items: [{ id, …<corps de modification> }, …] }` |
| `DELETE /<resources>/bulk`       | `{ mode?, ids: [uuid, …] }`                               |
| `POST /<resources>/bulk/restore` | `{ mode?, ids: [uuid, …] }`                               |

- **1 à 200 éléments.** Au-delà, `validation_failed` : un lot illimité est une requête qui tient une
  connexion et une transaction trop longtemps.
- En **`atomic`**, tout se joue dans une transaction : le premier échec annule tout et répond son
  code, comme la route unitaire l'aurait fait.
- En **`partial`**, chaque élément est tenté dans sa propre transaction. La réponse est **200**, même
  avec des échecs — le détail est dans le corps :

```json
{
  "items": [{ "id": "…", "name": "Maison Lune", "…": "…" }],
  "failed": [{ "index": 2, "code": "advertiser_name_taken", "params": { "name": "Herbéa" }, "message": "…" }]
}
```

`index` est la position dans le tableau envoyé, pas un id : un élément refusé à la création n'en a
pas. Les deux tableaux réunis ont toujours la taille du lot envoyé.

Une route de bulk répond **200** dans les deux modes, jamais 201 : en `partial` le corps porte des
échecs, et une route qui change de statut selon son mode est une route qu'on lit deux fois.

Un lot coûte : il tient une connexion et une transaction pour jusqu'à 200 éléments. Chaque route de
bulk a donc **son propre quota**, `BULK_RATE_LIMIT` — le dixième du défaut
(`src/plugins/rate-limit.plugin.ts`) — et le tool MCP qui la reflète est compté sur le **même**
compteur (`mcpToolRateLimiter`), sinon la limite se contourne en passant par l'autre porte.

Un **droit** refusé n'est jamais un échec partiel : le rôle est vérifié une fois, avant le lot, et un
403 ou un 404 d'Organization refuse la requête entière. En `partial`, seuls les échecs **par
élément** sont collectés.

### 2.3 Pagination, tri, filtres

| Paramètre        | Règle                                                                               |
| ---------------- | ----------------------------------------------------------------------------------- |
| `page`, `limit`  | Déjà dans le socle : 1-based, 50 par défaut, 200 au plus, page 10 000 au plus       |
| `sortBy`         | Un champ **déclaré triable** par la ressource ; un autre répond `validation_failed` |
| `sortOrder`      | `asc` \| `desc`, `asc` par défaut                                                   |
| `search`         | Texte contenu dans le nom, sans casse **ni accents**                                |
| `labelIds`       | Liste d'uuid                                                                        |
| `labelMode`      | `any` \| `all`, **`any` par défaut** (D39)                                          |
| `includeDeleted` | `false` par défaut ; `true` liste aussi les supprimés, avec leur `deletedAt`        |

Les champs triables sont déclarés dans le schéma Zod de la ressource, jamais devinés : un tri
silencieusement ignoré est un bug qu'on ne voit pas. Chaque tri **se termine par l'id**, sinon une
ligne peut apparaître sur deux pages et une autre sur aucune.

Le filtre par label est sur **toutes** les routes de liste, dès cette phase : `any` est un `IN`,
`all` exige autant d'affectations que de labels demandés.

### 2.4 La pose des labels

- `PUT /<resources>/:id/labels` avec `{ labelIds: [...] }`, la **liste complète** : idempotent, il
  remplace. Rôle `manager`.
- `GET /labels/:id/resources` dit ce qu'un label marque, par type de ressource.
- Un `labelId` d'une autre Organization répond **404** `label_not_found` : un label ne traverse pas
  les Organizations.
- Supprimer un label laisse ses affectations en place : elles redeviennent visibles si on le restaure.

## 3. Les routes

| Méthode  | URL                         | Rôle      |
| -------- | --------------------------- | --------- |
| `GET`    | `/advertisers`              | `viewer`  |
| `POST`   | `/advertisers`              | `manager` |
| `GET`    | `/advertisers/:id`          | `viewer`  |
| `PATCH`  | `/advertisers/:id`          | `manager` |
| `DELETE` | `/advertisers/:id`          | `manager` |
| `POST`   | `/advertisers/:id/restore`  | `manager` |
| `PUT`    | `/advertisers/:id/labels`   | `manager` |
| `POST`   | `/advertisers/bulk`         | `manager` |
| `PATCH`  | `/advertisers/bulk`         | `manager` |
| `DELETE` | `/advertisers/bulk`         | `manager` |
| `POST`   | `/advertisers/bulk/restore` | `manager` |
| `GET`    | `/labels`                   | `viewer`  |
| `POST`   | `/labels`                   | `manager` |
| `GET`    | `/labels/:id`               | `viewer`  |
| `PATCH`  | `/labels/:id`               | `manager` |
| `DELETE` | `/labels/:id`               | `manager` |
| `POST`   | `/labels/:id/restore`       | `manager` |
| `GET`    | `/labels/:id/resources`     | `viewer`  |
| `POST`   | `/labels/bulk`              | `manager` |
| `PATCH`  | `/labels/bulk`              | `manager` |
| `DELETE` | `/labels/bulk`              | `manager` |
| `POST`   | `/labels/bulk/restore`      | `manager` |

Toutes org-scoped : en-tête `X-Organization-Id`, et le rôle vérifié **dans le service**.

Chacune a son tool MCP (D21), en `kebab-case` :

| Ressource    | Tools                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `advertiser` | `list-advertisers`, `get-advertiser`, `create-advertiser`, `update-advertiser`, `delete-advertiser`, `restore-advertiser`, `set-advertiser-labels`, `bulk-*-advertisers` |
| `label`      | `list-labels`, `get-label`, `create-label`, `update-label`, `delete-label`, `restore-label`, `list-label-resources`, `bulk-*-labels`                                     |

Les quatre `bulk-*` sont `bulk-create`, `bulk-update`, `bulk-delete` et `bulk-restore`. Un tool
org-scoped prend un `organizationId` **optionnel** et retombe sur l'en-tête de la connexion : Claude
Code envoie l'en-tête, les connecteurs de Claude.ai et de ChatGPT ne peuvent pas. La liste complète
est tenue par `test/unit/mocks/mcp-tools.fixtures.ts`, et le test de bout en bout appelle chaque tool
une fois : un tool ajouté sans appel qui l'exerce fait échouer la suite.

## 4. Les codes d'erreur de la phase

| Code                     | Statut | Quand                                                    | `params` |
| ------------------------ | ------ | -------------------------------------------------------- | -------- |
| `advertiser_not_found`   | 404    | Absent, supprimé, ou d'une autre Organization            | `{}`     |
| `advertiser_name_taken`  | 409    | Une marque vivante porte déjà ce nom dans l'Organization | `name`   |
| `advertiser_not_deleted` | 409    | `restore` sur un advertiser vivant                       | `{}`     |
| `label_not_found`        | 404    | Absent, supprimé, ou d'une autre Organization            | `{}`     |
| `label_name_taken`       | 409    | Un label vivant porte déjà ce nom dans l'Organization    | `name`   |
| `label_not_deleted`      | 409    | `restore` sur un label vivant                            | `{}`     |
| `bulk_ids_duplicated`    | 400    | Le même id apparaît deux fois dans un lot                | `id`     |

## 5. Comment la phase se teste

- **Swagger** (`/documentation`) : créer un advertiser, lui poser deux labels, le retrouver par
  label, le supprimer, le restaurer.
- **Un bulk partiel** : trois advertisers dont un en doublon de nom, `mode: 'partial'` → 200, deux
  créés, un dans `failed` avec `advertiser_name_taken`. Le même lot en `atomic` → 409, rien créé.
- **MCP**, depuis Claude Code (`.mcp.json` livré avec la phase) : les mêmes opérations par les tools.
- **Les tests** : 100 % de couverture, la première migration, et le test d'intégration qui compare
  les entités au schéma migré commence à travailler pour de vrai.

## 6. Les entrées inconnues sont refusées

Tranché le 2026-10-25, et **remonté au socle** : toute entrée de l'API est un objet Zod `strict`.

Un champ que la route ne déclare pas — dans un corps, une querystring, un param ou les arguments
d'un tool MCP — répond **400 `validation_failed`** avec la règle `additionalProperties` et le nom du
champ fautif dans `field`. Il n'est plus ni ignoré ni supprimé en silence : `?sort=name` au lieu de
`?sortBy=name` renvoyait une liste triée par défaut sans que personne ne le voie, exactement le bug
que la règle de `sortBy` cherche à éviter.

Ce que ça a demandé :

| Où                                 | Quoi                                                                                      |
| ---------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/types/api.types.ts`           | `paginationQuerySchema` en `z.strictObject` — la base de toute liste                      |
| `src/types/crud.types.ts`          | `bulkBodySchema`, `bulkIdsBodySchema`, `setLabelsBodySchema` stricts                      |
| les corps de chaque ressource      | `z.strictObject`, et l'item d'un lot l'est donc aussi                                     |
| `src/plugins/validation.plugin.ts` | `removeAdditional: false` dans AJV, sinon il **supprime** le paramètre au lieu de refuser |

Ce que ça change pour un appelant : un front qui envoie un champ de trop reçoit maintenant un 400 au
lieu de réussir en silence. C'est voulu — mais à savoir au moment où le front de multi-search
basculera (CADRAGE § 18), parce qu'un champ en trop qui passait inaperçu se verra d'un coup.

La rigueur traverse `.extend()` et `.omit()` : un schéma bâti sur un schéma strict l'est aussi, donc
les trente ressources suivantes l'héritent sans rien à faire. **Seule exception** : un schéma
d'**en-têtes** reste souple, une requête portant par nature ses propres en-têtes.
