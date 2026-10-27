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

## 4. Ce qui est fait, le 2026-10-27

Le paquet est installé — `@multisearchad/omnipass-client@0.1.1`, depuis GitHub Packages — et le
câblage est celui du § 2 :

- **Le registre, sans jeton nulle part dans le dépôt.** `backend/.npmrc` nomme le registre pour le
  scope `@multisearchad` et rien d'autre : en local le jeton vient de `~/.npmrc`, en CI du jeton du
  workflow — les deux dépôts sont dans la même organisation, donc aucun secret à créer — et dans
  l'image d'un **secret BuildKit** monté le temps d'un `RUN`. Vérifié par un vrai `docker build` : le
  paquet est bien dans l'image, et ni le jeton ni un `.npmrc` n'y subsistent.
- **Le vrai client derrière le fournisseur.** `AccessServicePlugin` construit `OmnipassClient` quand
  `ACCESS_PROVIDER=omnipass`, en lisant le secret du magasin au moment de la construction. Une valeur
  manquante fait échouer le **démarrage** et non la première connexion : un spec le prouve sur
  `clientId`.
- **Les types du contrat ne sont plus recopiés.** `src/types/auth.types.ts` les **réexporte** du
  paquet et ne garde que ce qui est à nous : `AuthMode`, `AccessTokenClaims`, et deux alias
  **dérivés** du snapshot (`SnapshotOrganization`, `SnapshotSeat`) que le paquet n'expose pas sous un
  nom. Aucune forme ne peut plus dériver de celle qu'omnipass implémente.
- **Le plugin d'authentification n'a pas changé d'un caractère**, et le garde-fou de D43 ne refuse
  plus omnipass — il est implémenté — tout en continuant de refuser la production avec autre chose.

## 5. Le bouchon reste, et c'est une décision à valider

Le § 2 disait de le supprimer. Je ne l'ai pas fait, pour une raison qui n'existait pas quand ce
document a été écrit :

1. **omnipass n'a pas encore déclaré nos audiences** dans son registre (point 5 de son
   `A-FAIRE.md`). Tant que ce n'est pas fait, un jeton que nous lui relayons est refusé — 403
   `audience_not_allowed` — et supprimer le bouchon rendrait l'application inutilisable en local sans
   rien apporter en échange.
2. Le jour où cette déclaration existe, le bouchon part **d'un coup** : `LocalAccessService` et ses
   tests, l'avertissement de démarrage, les quatre `DEV_ACTOR_*`, le fournisseur `local`, et le
   garde-fou de D43 qui n'aura plus rien à garder. C'est une demi-journée, pas une phase.

## 6. Ce qui se vérifie maintenant, et ce qui attend la déclaration

Vérifiable sans omnipass, et vérifié :

- le paquet s'installe, compile et se construit dans l'image ;
- le plugin construit le client pour `omnipass` et le bouchon pour `local`, et refuse de démarrer
  sans compte machine ;
- un `assert*` ne touche ni le réseau ni un cache — c'est le paquet qui le garantit, et ses propres
  tests le couvrent ;
- `OmnipassError` traverse l'API **telle quelle** : elle porte `statusCode`, `code`, `params` et les
  alias que notre gestionnaire d'erreurs lit déjà, donc aucun adaptateur.

En attente de la déclaration des audiences chez omnipass :

- se connecter avec un vrai jeton, lire une ressource d'une Organization, se faire refuser une autre
  (404) et un rôle trop faible (403) — le scénario que `plan.md` donne pour cette phase ;
- les quatre cas de dégradation du § 4 de `branchement-omnipotent.md` contre un vrai omnipass ; ils
  sont déjà couverts chez lui contre un `fetchFn` injecté.
