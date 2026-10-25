# Handover — le socle backend

**À produire** : le squelette du backend d'Omnipotent dans `backend/`, et son infrastructure dans `infra/`. **Aucun code de domaine.**

**Pourquoi maintenant** : ce chantier ne dépend d'aucun cadrage. Le socle est indépendant du modèle métier, et il débloque toutes les phases suivantes. C'est aussi presque entièrement une **transcription** : multi-search est notre code et a déjà 36 phases de conventions durcies.

**À lire d'abord** :
1. `../CADRAGE.md` section 19 (conventions techniques) et section 20 (les 48 décisions).
2. `~/OmniAd/multi-search/backend/CLAUDE.md` **en entier** — c'est le contrat de conventions à reprendre.
3. `~/OmniAd/multi-search/backend/README.md` et `~/OmniAd/multi-search/infra/README.md`.

---

## 1. Le périmètre, strictement

### À livrer

- **Structure** : monorepo pnpm avec `backend/` et `infra/`. Pas de `frontend/`.
- **Outillage** : `package.json`, `tsconfig.json` + `tsconfig.build.json`, `eslint.config.mjs`, `.prettierrc.json`, `jest.config.ts` et `jest.integration.config.ts`, `Dockerfile`, `compose.yaml` (Postgres + émulation S3 et Secrets Manager), `.env.example`.
- **Démarrage** : `src/index.ts`, `src/app.ts`, `src/instrumentation.ts`, `src/server/`, les deux modes `api` et `worker` par `APP_MODE`.
- **Plugins** : error-handler, validation (Zod sur les bodies), auth, base de données, file de jobs, swagger, métriques, contexte de requête, rate limit.
- **Ressources de base** : `health` (`/livez`, `/readyz`, `/healthz`) et `status`, en controller / handler / schema, plus leur pendant MCP et le transport MCP.
- **Socle commun** : `src/configs`, `src/constants`, `src/types` (common, error, fastify, health, status, auth, pagination), `src/utils` (http, logger, process, schema, validation, pagination), `src/database` (data source, `BaseEntity`, transformers, index des migrations), `src/jobs` (l'ossature des `JobDefinition`, sans job métier).
- **Droits** : l'interface `AccessService` (`assertOrganizationRole`, `assertSeatRole`, `assertSuperAdmin`, `invalidateUser`) avec **une implémentation locale** — et une garde qui fait **refuser le démarrage en production** avec cette implémentation, parce que la production exige omnipass (D43, voir `~/OmniAd/omnipass/HANDOVER.md`).
- **Tests** : les helpers et mocks de multi-search (`createDataSourceMock`, les fixtures d'auth, le stub pg-boss), et **100 % de couverture** sur ce qui est livré.
- **CI** : GitHub Actions — lint, typecheck, tests, build de l'image, push ECR, déploiement.
- **Infra** : Terraform dans `infra/`, région **`eu-north-1`**, **propre instance RDS**, même compte AWS que multi-search. Reprendre ses modules.
- **`CLAUDE.md`** à la racine du dépôt : les conventions, adaptées de celui de multi-search.

### À ne pas livrer

Aucune entité de domaine — ni `Campaign`, ni `Lever`, ni `AdGroup`, ni `TargetingGroup`, ni `Line`, ni `Creative`, ni `Asset`, ni `Label`. Aucun adapter de plateforme. Aucun module métier. Aucune migration de domaine.

**Si tu te demandes si quelque chose entre dans le socle : est-ce que ça serait identique dans n'importe quel projet Fastify d'Omnilor ?** Si oui, c'est le socle. Sinon, c'est une phase.

## 2. Les conventions à respecter, sans discussion

Elles viennent de `../CADRAGE.md` section 19 et du `CLAUDE.md` de multi-search :

- **Zod source de vérité unique**, dans `src/types/<resource>.types.ts`, converti en JSON Schema par `toJsonSchema(...)`. Les bodies sont validés par le schéma Zod lui-même via le validateur de `validation.plugin.ts`.
- **Controller / handler / schema** pour le HTTP **et** pour le MCP. Jamais collapsé, jamais d'autre type de fichier.
- **Une seule forme d'erreur**, produite dans `error-handler.plugin.ts`, avec un **code stable** et ses valeurs : `{ statusCode, error, code, params, message, requestId }`. Les erreurs se **lancent** (`throw httpError(...)`), jamais ne s'assemblent dans un handler.
- Les **5xx ne fuient pas** leur message hors du mode développement.
- **Droits vérifiés dans les services**, jamais dans les handlers — pour que HTTP, MCP et jobs partagent les mêmes règles. 404 pour ce qui n'est pas visible, 403 pour un rôle trop faible.
- Les services renvoient des **formes d'API**, jamais des entités.
- **Migrations seulement**, jamais `synchronize`.
- Montants en **centimes entiers** dans les calculs.
- **Un processus par conteneur**, pas de `cluster`.
- **Code et JSDoc en anglais, documentation en français.**

## 3. Ce qu'il faut adapter, et pas copier tel quel

- **Le nom du projet** partout : `omnipotent` au lieu de `multi-search`.
- **Les préfixes de secrets** : `omnipotent/<env>/...`.
- **`platform-rules.ts`** : garder la **forme** du registre de capacités, vider le contenu. Les plateformes arrivent dans leurs phases.
- **Les jobs** : garder l'ossature de `JobDefinition` et la création des files, retirer les handlers métier.
- **La synchro** : ne rien livrer. Omnipotent change la conception sur un point important (D34 : coût proportionnel au travail en attente, pas au parc) et ça se construit avec le domaine.
- **L'entité `User` et la tenancy** : ne rien livrer. C'est omnipass.

## 4. À vérifier avant de clore

- [ ] `pnpm install && pnpm build` passe.
- [ ] `pnpm test:cov` passe à **100 %**.
- [ ] `pnpm lint:check` et `pnpm prettier:check` passent.
- [ ] L'application démarre en mode `api` et en mode `worker`.
- [ ] `/livez`, `/readyz`, `/status` répondent, et `/readyz` répond 503 pendant le démarrage.
- [ ] Swagger s'affiche en local et est désactivé en production.
- [ ] Le transport MCP répond et expose le tool `status`.
- [ ] Les migrations tournent sur une base jetable et le test d'intégration qui compare entités et migrations passe.
- [ ] La CI est verte.
- [ ] L'application **refuse de démarrer** avec `NODE_ENV=production` et l'implémentation locale des droits.
- [ ] `terraform validate` passe dans `infra/`.

## 5. Ce qui remonte à Lorin

Dans `../A-FAIRE.md` : le bucket d'état Terraform à choisir, les variables de dépôt GitHub (`AWS_DEPLOY_ROLE_ARN`, `AWS_REGION`) et l'identité OIDC, les audiences Auth0 d'Omnipotent dans le tenant partagé, et tout secret à créer.

Ne rien demander qui soit déjà tranché dans `../CADRAGE.md` : les 48 décisions sont prises.
