# Omnipotent — backend

API d'Omnipotent, la plateforme qui pilote des campagnes publicitaires sur six leviers — Search,
DOOH, Audio, Social, CTV & TVS et DAC — depuis une seule interface. Le nombre de plateformes qu'ils
couvrent est fixé par `../CADRAGE.md` § 6 et bouge (GAM est sorti avec D50) : il n'est écrit nulle
part dans le code.

**Ce dépôt ne contient aujourd'hui que le socle** : le squelette technique, sans aucun code de
domaine. Le modèle métier, les plateformes et les écrans arrivent phase par phase ; leur plan va dans
[`docs/plan.md`](docs/plan.md), et les décisions déjà prises sont dans
[`../CADRAGE.md`](../CADRAGE.md) § 20, et les documents de référence de `docs/`
([`plan.md`](docs/plan.md), [`reporting.md`](docs/reporting.md), [`leviers.md`](docs/leviers.md)).

Ce que le socle livre :

- **Démarrage et cycle de vie** : une image, deux modes (`api` et `worker`), un seul processus par
  conteneur, arrêt propre sur `SIGTERM` avec drainage.
- **Plugins Fastify** : gestion des erreurs, validation (Zod sur les corps), authentification Auth0,
  base de données, file de jobs, Swagger, métriques, journal d'accès, CORS, limites de débit, et le
  transport MCP.
- **Ressources** : les sondes `/livez`, `/readyz`, `/healthz`, `/status`, les métadonnées OAuth du
  serveur MCP, et le tool MCP `get-status`.
- **Socle commun** : configuration, constantes, types Zod, utilitaires, source de données TypeORM et
  ossature des migrations, ossature des `JobDefinition`, registre de capacités des plateformes (sa
  forme, vide).
- **Droits** : les interfaces `AccessService` et `IdentityService`, avec une implémentation locale
  chacune, et le refus de démarrer en production sans **omnipass** (D43).

## Prérequis

- Node **22.12** ou plus (le build est en CommonJS et `pg-boss` est en ESM pur : `require()` d'un
  module ES n'est stable que depuis 22.12) et pnpm 10 (`corepack enable`)
- Docker (PostgreSQL pour le développement et les tests d'intégration)

## Démarrer

```sh
pnpm install
cp .env.example .env                      # puis remplir les valeurs Auth0 (ci-dessous)
docker compose up -d postgres rustfs moto # PostgreSQL sur 5442, S3 (RustFS) sur 9012, Secrets Manager (moto) sur 9022
pnpm migration:run                        # crée le schéma (aucune migration encore : la table `migrations` seule)
pnpm start:dev                            # API sur http://localhost:3002 (Swagger : /documentation)
pnpm start:worker                         # optionnel : le worker de jobs, dans un autre terminal
```

Les ports publiés sont ceux de multi-search décalés de un, pour que les deux piles cohabitent sur la
même machine — **le port HTTP compris** : 3002, pendant que multi-search et omnipass gardent 3000. Un
identifiant d'API Auth0 étant unique dans le tenant partagé, `http://localhost:3000/mcp` est déjà pris
par eux, et sans ce décalage Omnipotent n'aurait pas d'API MCP locale. `docker compose up --build` lance toute la pile en conteneurs (étape de migration, API,
worker, Grafana sur http://localhost:3012).

### Auth0

Auth0 prouve **seulement qui appelle** ; les droits vivent ailleurs (omnipass). Le tenant est
**partagé** avec multi-search (D42) et Omnipotent y a ses propres audiences. Dans le tenant :

1. **Une API pour l'API REST** (Applications > APIs) : identifiant = `AUTH0_AUDIENCE`, RS256.
2. **Une API pour le serveur MCP, par environnement** : son identifiant est exactement
   `MCP_RESOURCE_URL` — l'URL servie, que le client envoie comme indicateur de ressource — donc
   `http://localhost:3002/mcp` en local et l'URL publique ailleurs. RS256, _Allow Offline Access_,
   permission `mcp:use`.
3. **Une Single Page Application** pour le Swagger UI : celle de multi-search fait l'affaire, il suffit
   d'ajouter `http://localhost:3002/documentation/static/oauth2-redirect.html` à ses _Allowed Callback
   URLs_ et `http://localhost:3002` à ses _Allowed Web Origins_, sans rien retirer de ce qui y est
   déjà. Son client id va dans `AUTH0_SWAGGER_CLIENT_ID`.
4. **Sur chaque API, section `User-delegated access` : ajouter cette application navigateur.** Sans
   ça, Auth0 refuse la demande de jeton avant même d'afficher la page de connexion, et son message ne
   dit pas pourquoi.
5. Facultatif : une application **Native** pour les connecteurs Claude (claude.ai et Claude Desktop
   ne peuvent pas enregistrer leur propre client) : _Allowed Callback URLs_
   `https://claude.ai/api/mcp/auth_callback` et `https://claude.com/api/mcp/auth_callback`,
   _Authentication Method_ `None` (PKCE). Son client id va dans `MCP_CLAUDE_CLIENT_ID`.

L'API REST et le serveur MCP sont **deux API Auth0 avec deux identifiants** : l'application refuse de
démarrer si `MCP_RESOURCE_URL` égale `AUTH0_AUDIENCE` (ou est vide alors que MCP est actif), car un
jeton de l'une ouvrirait l'autre.

Ce qui **n'est pas** à régler ici : l'Action post-login qui ajoute l'adresse aux jetons, la liste des
connexions dont `email_verified` est cru, et les adresses qui reçoivent le drapeau super-admin. Tout
cela appartient à omnipass — le socle ne lit du jeton que son `sub`.

### Identité et droits : le bouchon de développement

`AccessService` (`src/services/access.service.ts`) est **l'unique porte vers omnipass**, et son
interface est **le contrat des deux projets**, figée signature par signature
(`docs/consuming.md` de `PinkWhaleAds/omnipass`, cloné en `~/PinkWhale/omnipass`). `@pinkwhaleads/omnipass-client` est
installé depuis la phase 1 et porte **exactement** ces signatures : le service est donc le client
lui-même, et `src/types/auth.types.ts` réexporte les types du contrat au lieu d'en garder une copie.

Ce que le socle **ne porte pas**, et ne portera jamais : aucune entité `User`, `Seat`,
`Organization`, membership ou invitation ; aucun `IdentityService` ; aucun modèle de rôles à lui.
Résoudre un `sub` Auth0 en utilisateur demande la table `users` d'omnipass, qui en est le seul writer
(T5).

Le partage est net :

- le **jeton est vérifié ici**, localement, contre les clés publiques du tenant (JWKS) et pour
  l'audience de la route ;
- l'**identité est résolue là-bas** : le plugin d'auth appelle `accessService.resolve(sub, token)`
  une fois par requête et relaie le jeton de l'utilisateur, pour qu'omnipass agisse avec **ses**
  droits et jamais avec ceux de l'application ;
- l'instantané rapporté (`Snapshot` : l'utilisateur, ses Seats, ses Organizations et ses rôles) est
  posé sur `request.auth`, et **tous les `assert*` sont du calcul pur** dessus — vérifier un droit ne
  coûte aucun appel réseau. Rien des droits ne voyage dans le jeton (T3) : un administrateur révoqué
  perd ses droits à l'expiration du cache, pas à celle de son JWT.

`ACCESS_PROVIDER` choisit : avec `omnipass`, le plugin construit le vrai client et lit le secret du
compte machine dans le magasin, au démarrage. Avec `local`, il livre un **bouchon**, pas une tenancy
— pour développer sans omnipass sous la main, et tant qu'omnipass n'a pas déclaré nos audiences dans
son registre. `CADRAGE.md` § 8 parlait d'une « implémentation locale (mêmes tables) » ; c'est
incompatible avec l'interdiction de porter la tenancy, et omnipass a tranché pour le bouchon :

- un acteur de développement **fixe**, lu dans l'environnement (`DEV_ACTOR_USER_ID`,
  `DEV_ACTOR_EMAIL`, `DEV_ACTOR_SUPER_ADMIN`) ;
- `admin` sur **toute** Organization, `seat_admin` sur **tout** Seat — rien n'est caché, aucun
  membership n'est lu, et aucun rôle n'est réellement refusé ;
- un `warn` explicite au démarrage, pour que personne ne croie que la tenancy fonctionne.

Il ne dégrade pas les tests : un test de service bouchonne `AccessService`, comme chez multi-search.
Il ne sert qu'à faire tourner l'application à la main.

Et le garde-fou de **D43** : avec `NODE_ENV=prod` et autre chose qu'omnipass, le démarrage **échoue**
(`src/services/tenancy-provider.ts` lève, `App.start` termine par `killProcess`, code de sortie 1) :

```
Access.provider is "local": production requires "omnipass" (D43). The local implementation grants
every Organization to every caller and reads no membership, so it must never serve real data.
Deploy omnipass first.
```

Câbler le client omnipass est donc ce qui débloque une mise en production. D'ici là, seul un
environnement local ou jetable tourne. Et si un bouchon ne suffit plus pour une phase, la réponse est
d'avancer la phase 2 d'omnipass — **jamais** d'ajouter des tables ici.

## Appeler l'API

Le Swagger UI est servi en local sur http://localhost:3002/documentation (bouton **Authorize**), et
le document OpenAPI sur `/documentation/json`. Il est **coupé en production** (`APP_DOCS_ENABLED`) :
ces routes répondent 404.

Les routes publiques, qui ne demandent aucun jeton : `/livez`, `/readyz`, `/healthz`, `/status` et
`/.well-known/oauth-protected-resource[/mcp]`. Tout le reste attend un jeton d'accès émis pour
`AUTH0_AUDIENCE`.

Une route qui agit sur une Organization lit l'en-tête `X-Organization-Id` ; les droits sont vérifiés
**dans les services**, jamais dans un handler, pour que HTTP, MCP et jobs partagent les mêmes règles.

## Serveur MCP

`POST /mcp`, avec un jeton émis pour `MCP_RESOURCE_URL` (pas celui de l'API REST). Le mode par défaut
est **sans session** : chaque requête construit son serveur et son transport puis les jette, donc
n'importe quelle réplique peut servir n'importe quelle requête. `APP_MCP_STATEFUL=true` garderait les
sessions en mémoire du processus, ce qui exige d'épingler chaque client à un pod : `../CADRAGE.md`
§ 19 (« Scalabilité horizontale ») dit de **ne jamais l'activer**. Le mode existe, testé, parce qu'il
vient de multi-search ; le laisser à `false` est la règle.

Une 401 porte l'en-tête `WWW-Authenticate` qui pointe vers
`/.well-known/oauth-protected-resource/mcp` : c'est par là qu'un client MCP découvre où se connecter.

Le socle expose un seul tool, `get-status`. **Toutes les opérations de l'API sont exposées en tools
MCP** (D21) : chaque phase enregistre les siens dans `src/mcp/tools/index.ts`, à côté de son
controller HTTP.

## Modes de processus

Une seule image, `APP_MODE` choisit ce qu'un processus fait :

- **`api`** — l'API HTTP, le serveur MCP, Swagger, et tout ce qui authentifie. Il peut mettre des
  jobs en file, il n'en exécute jamais.
- **`worker`** — les workers de jobs, plus les sondes et `/status` pour que l'orchestrateur puisse le
  surveiller. Il ne sert aucune route d'API.

Un **processus par conteneur**, jamais `cluster` : la montée en charge est le travail de
l'orchestrateur (des répliques), pas de l'application.

## Base de données et migrations

Le schéma ne change que par **migrations**, jamais par `synchronize`. Une entité se change, puis :

```sh
pnpm migration:generate src/database/migrations/<Nom>   # relire le SQL produit
# ajouter la classe à src/database/migrations/index.ts
pnpm migration:run
```

Dans l'image, les migrations tournent comme une **étape à part** (`node dist/database/migrate.js`,
le service `migrate` de `compose.yaml`, une tâche ECS ponctuelle en production), pour que les
répliques ne se les disputent pas au démarrage.

Le socle ne porte **aucune entité** : celles du domaine arrivent dans leurs phases, et celles de la
tenancy (`User`, `Seat`, `Organization`, memberships) appartiennent à omnipass et ne vivront jamais
ici — une table d'ici stocke `organizationId` et `userId` comme des **uuid opaques**, sans clé
étrangère entre les deux bases (T4).

## Tests

```sh
pnpm test:cov          # tests unitaires, 100 % de couverture exigée
pnpm test:integration  # contre un vrai PostgreSQL (docker compose up -d postgres)
```

La suite d'intégration recrée une base jetable `<DB_NAME>_it`, y applique les migrations et compare
le schéma migré aux entités : elle échoue si les deux divergent. Jamais d'appel à une plateforme dans
un test.

## Sondes

- **`/livez`** — vivacité seulement. Un 503 ici fait redémarrer le conteneur : n'y enregistrer
  **aucune dépendance**, sinon la panne de quelqu'un d'autre redémarre celui-ci en boucle.
- **`/readyz`** — disponibilité : le contrôle `app` intégré plus chaque dépendance (`postgres`,
  `queue`). Un 503 sort seulement le pod du service. Toute la fenêtre de démarrage répond 503.
- **`/healthz`** — tout, pour le nom conventionnel et les supervisions humaines.

Une dépendance absente ou en panne au démarrage est un contrôle de disponibilité, **pas** une raison
de refuser de démarrer : la base et la file réessaient en arrière-plan avec un délai croissant.

## Erreurs

Toute erreur a la même forme, produite en un seul endroit
(`src/plugins/error-handler.plugin.ts`) : `{ statusCode, error, code, params, message, requestId }`.
Les codes sont documentés dans [`docs/error-codes.md`](docs/error-codes.md) — le front traduit
`code` + `params`. Les handlers **lancent** (`throw httpError(...)`), ils n'assemblent jamais un
corps d'erreur. Le message d'une **5xx** ne sort pas de l'application hors développement.

## Journaux, journal d'accès et limites de débit

Une ligne structurée par requête HTTP (`AccessLogPlugin`) : méthode, **motif** de route (jamais
l'URL, qui peut porter une clé), statut, durée, adresse du client, utilisateur, Organization,
identifiant de requête. Les sondes n'y sont pas.

Le format des journaux (`src/utils/log-format.utils.ts`) écrit une erreur avec son nom, son message,
sa pile, son code et sa chaîne de causes, et **masque les secrets à toute profondeur**
(`Authorization`, cookies, jetons, mots de passe, clés, configuration axios, jetons dans une query
string). Ne jamais journaliser une URL avec sa query string, un en-tête ou un corps.

Chaque appelant est limité par `RateLimitPlugin`, par utilisateur authentifié ou par adresse IP sur
une route publique. Une route qui coûte (quota d'une plateforme, appel IA, e-mail, fichier, lecture
lourde) prend sa propre limite dans `ROUTE_RATE_LIMITS`.

## Observabilité

OpenTelemetry, activé par `APP_TELEMETRY_ENABLED` avec `OTEL_EXPORTER_OTLP_ENDPOINT`
(`src/instrumentation.ts`, chargé par `--require`/`--import` avant l'application). En local,
`docker compose up -d otel-lgtm` apporte Grafana, Loki, Tempo et Prometheus sur
http://localhost:3012.

## Déploiement

L'infrastructure AWS est dans [`../infra/`](../infra/README.md) : région `eu-north-1`, ECS Fargate
ARM64, sa propre instance RDS, un Terraform séparé de celui de multi-search (D42). Le déploiement est
`.github/workflows/deploy.yml` (image → migrations → API et worker), ou `infra/scripts/deploy.sh`
depuis une machine avec un profil AWS local.

## Variables d'environnement

Toutes dans [`.env.example`](.env.example), avec ce que chacune fait. Les valeurs par défaut vivent
dans `config/default.json` (node-config), la correspondance avec les variables dans
`config/custom-environment-variables.json`, et `config/prod.json` applique les réglages de
production.
