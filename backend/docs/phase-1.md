# Phase 1 — Accès et tenancy : brancher omnipass

Contrat de la phase 1. Remplacer le **bouchon** de `AccessService` par le vrai client d'omnipass, et
supprimer tout ce qui n'existait que pour le bouchon.

Prérequis : omnipass livré — **c'est fait**. Son client est publié :
`@multisearchad/omnipass-client`, version `0.1.1`, tag `client-v0.1.1`, sur GitHub Packages.

Entrées validées : `~/OmniAd/omnipass/docs/message-socle-omnipotent.md` (le contrat, § 2),
`reponse-socle-omnipotent.md` (nos questions et ses réponses) et
`branchement-omnipotent.md` (le mode d'emploi du remplacement), plus T1 → T5 et D43.

---

## 1. Ce que cette phase n'est pas

Elle n'écrit **aucun** modèle d'identité. Omnipotent ne porte ni `User`, ni `Seat`, ni
`Organization`, ni membership, ni invitation (T5) : une table d'ici garde `organizationId` et
`userId` comme des uuid **opaques**, sans clé étrangère entre les deux bases (T4). Cette phase ne
crée donc pas une table, et la seule chose qu'elle ajoute au domaine est **rien**.

Elle ne réécrit pas non plus les droits. Le contrat a tenu : les signatures de notre interface
`AccessService` et celles de `OmnipassClient` **coïncident**, vérifié une par une — `resolve`,
`assertSuperAdmin`, `getSeatRole`, `assertSeatRole`, `getOrganizationAccess`,
`assertOrganizationRole`, `invalidateUser`, `invalidateAll`. Les services continuent d'écrire
`await this.access.assertOrganizationRole(actor, organizationId, 'manager')`, et ces appels restent
du **calcul pur** sur l'instantané : aucun réseau sur le chemin d'une permission.

## 2. Ce qui change : une ligne, et des suppressions

```diff
- fastify.decorate('accessService', new LocalAccessService(accessConfig));
+ fastify.decorate(
+   'accessService',
+   new OmnipassClient({
+     url: omnipassConfig.url,
+     audience: omnipassConfig.audience,
+     clientId: omnipassConfig.clientId,
+     clientSecret: await fastify.secretStore.get(omnipassConfig.secretName),
+     auth0Domain: authConfig.domain,
+     cacheTtl: accessConfig.cacheTtl,
+     logger: LoggerBuilder.getChildLogger('Omnipass'),
+   })
+ );
```

Et ce qui part avec : le bouchon `LocalAccessService`, ses tests, l'avertissement de démarrage, les
quatre `DEV_ACTOR_*`, et le garde-fou D43 — qui n'a plus rien à garder une fois qu'il n'y a plus
d'autre fournisseur que le vrai. Notre copie locale du `Snapshot` (`src/types/auth.types.ts`) s'en va
aussi : le paquet l'exporte.

Le plugin d'authentification ne change pas d'un caractère : il vérifie le jeton lui-même, contre les
clés publiques du tenant et pour l'audience de la route, puis appelle `resolve(sub, token)` une fois
par requête. C'est le partage que le socle a posé dès le départ (`CLAUDE.md`), et il est resté juste.

## 3. Ce que la phase livre déjà, et qui ne dépend de personne

- **`src/configs/omnipass.config.ts`** : `OMNIPASS_URL`, `OMNIPASS_AUDIENCE`, `OMNIPASS_CLIENT_ID` et
  le **nom** de l'entrée du magasin de secrets. La valeur du secret n'est nulle part dans la
  configuration : le plugin la lit au moment de construire le client (`../../CADRAGE.md` § 12).
  `clientId` n'a **pas** de valeur par défaut — un déploiement qui choisit omnipass sans compte
  machine doit se le faire dire, pas se le faire deviner.
- **L'infrastructure** : le conteneur `omnipass/client-secret` est déclaré dans
  `infra/envs/prod/main.tf` (`module "secrets"`), sa valeur posée **à la main** et jamais par
  Terraform ; les trois variables non secrètes sont dans l'environnement des tâches ; et
  `omnipass_client_id` est **refusé vide** quand `access_provider = "omnipass"`, pour que l'erreur
  arrive au `plan` et non dans une boucle de redémarrage.

## 4. Ce qu'il manque, et c'est tout

Le paquet est sur **GitHub Packages**, qui exige un jeton en lecture. Le jeton de la session `gh` de
cette machine porte `repo` et `read:org` mais **pas** `read:packages` : le registre répond 403, donc
`pnpm install` ne peut pas récupérer le paquet, donc la ligne du § 2 ne peut pas être écrite — un
`import` qui ne compile pas n'est pas un début de code, c'est un build cassé.

Ce qu'il faut, dans l'ordre :

1. un jeton GitHub avec `read:packages`, posé dans `~/.npmrc` — **jamais** dans le dépôt ni dans une
   conversation. Le dépôt ne portera qu'un `.npmrc` qui nomme le registre et **lit** le jeton dans
   l'environnement, forme standard et sans secret ;
2. le **compte machine** d'Omnipotent sur omnipass (`client_credentials`) : son `client_id` peut
   m'être donné ici, son secret va dans Secrets Manager sous `omnipass/client-secret` ;
3. la **déclaration des audiences et de l'URL** d'Omnipotent dans la configuration d'omnipass, sans
   laquelle omnipass refuse le jeton relayé de nos utilisateurs.

Les trois sont dans `A-FAIRE.md`.

## 5. Comment la phase se testera

- **Le bouchon n'existe plus** : aucun chemin ne construit un acteur depuis l'environnement, et un
  test le prouve en lisant les fournisseurs déclarés.
- **Les erreurs traversent telles quelles** : `OmnipassError` porte `statusCode`, `code`, `params` et
  les alias que notre gestionnaire d'erreurs lit déjà. Les quatre cas du § 4 de
  `branchement-omnipotent.md` — identité sans compte, omnipass injoignable à cache chaud puis à cache
  froid, écriture qui n'arrive pas — sont éprouvés contre un `fetchFn` injecté, **sans** appeler
  omnipass.
- **Aucun appel réseau sur une permission** : un `assert*` ne touche ni le réseau ni un cache, ce qui
  se vérifie en comptant les appels du `fetchFn`.
- **Le démarrage en production** ne dépend plus d'un garde-fou : il n'y a plus de fournisseur à
  refuser.
