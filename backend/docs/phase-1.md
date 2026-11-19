# Phase 1 — Accès et tenancy : brancher omnipass

Contrat de la phase 1. Remplacer le **bouchon** de `AccessService` par le vrai client d'omnipass, et
supprimer tout ce qui n'existait que pour le bouchon.

Prérequis : omnipass livré — **c'est fait**. Son client est publié :
`@pinkwhaleads/omnipass-client`, version `0.1.1`, tag `client-v0.1.1`, sur GitHub Packages.

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
  `omnipass_client_id` est **refusé vide**, pour que l'erreur arrive au `plan` et non dans une boucle
  de redémarrage.

## 4. Ce qui est fait, le 2026-10-27

Le paquet est installé — `@pinkwhaleads/omnipass-client@0.1.1`, depuis GitHub Packages — et le
câblage est celui du § 2 :

- **Le registre, sans jeton nulle part dans le dépôt.** `backend/.npmrc` nomme le registre pour le
  scope `@pinkwhaleads` et rien d'autre : en local le jeton vient de `~/.npmrc`, en CI du jeton du
  workflow — les deux dépôts sont dans la même organisation, donc aucun secret à créer — et dans
  l'image d'un **secret BuildKit** monté le temps d'un `RUN`. Vérifié par un vrai `docker build` : le
  paquet est bien dans l'image, et ni le jeton ni un `.npmrc` n'y subsistent.
- **Le vrai client, et le seul.** `AccessServicePlugin` construit `OmnipassClient` au démarrage, en
  lisant le secret du magasin au moment de la construction. Une valeur
  manquante fait échouer le **démarrage** et non la première connexion : un spec le prouve sur
  `clientId`.
- **Les types du contrat ne sont plus recopiés.** `src/types/auth.types.ts` les **réexporte** du
  paquet et ne garde que ce qui est à nous : `AuthMode`, `AccessTokenClaims`, et deux alias
  **dérivés** du snapshot (`SnapshotOrganization`, `SnapshotSeat`) que le paquet n'expose pas sous un
  nom. Aucune forme ne peut plus dériver de celle qu'omnipass implémente.
- **Le plugin d'authentification n'a pas changé d'un caractère**, et le garde-fou de D43 ne refuse
  plus omnipass — il est implémenté — tout en continuant de refuser la production avec autre chose.

## 5. Le bouchon est supprimé

Ce document a hésité deux fois. Le § 2 disait de le supprimer dès qu'omnipass aurait déclaré nos
audiences ; j'ai ensuite recommandé de le garder, au motif qu'exiger le secret du compte machine de
**chaque personne** qui touche au dépôt coûterait plus cher. Lorin a tranché le 2026-11-17, avec le
fait qui manquait à mon raisonnement : il est seul à développer, il détient déjà ce secret, et aucun
client ne verra le produit avant qu'il soit terminé. L'argument tombe.

Sont partis d'un coup : `LocalAccessService` et ses tests, l'avertissement de démarrage, les quatre
`DEV_ACTOR_*`, le fournisseur `local` et toute la variable `ACCESS_PROVIDER`, et
`tenancy-provider.ts` avec le garde-fou de D43 — qui n'avait plus rien à garder une fois qu'il
n'existe qu'une implémentation.

Ce que le refus devient : l'application ne démarre **nulle part** sans compte machine ni secret dans
le magasin, et plus seulement en production. C'est un garde-fou plus simple et plus large que celui
qu'il remplace.

Ce que ça coûte, et qu'il faut savoir : l'environnement de test a besoin, lui aussi, du secret dans
son Secrets Manager. Son `terraform.tfvars.example` le dit.

## 6. Ce qui se vérifie maintenant, et ce qui attend encore

Vérifiable sans omnipass, et vérifié :

- le paquet s'installe, compile et se construit dans l'image ;
- le plugin construit le client pour `omnipass` et le bouchon pour `local`, et refuse de démarrer
  sans compte machine ;
- un `assert*` ne touche ni le réseau ni un cache — c'est le paquet qui le garantit, et ses propres
  tests le couvrent ;
- `OmnipassError` traverse l'API **telle quelle** : elle porte `statusCode`, `code`, `params` et les
  alias que notre gestionnaire d'erreurs lit déjà, donc aucun adaptateur.

**Contre le vrai omnipass, le 2026-11-17** — premier appel relayé réel des deux côtés :

- le compte machine obtient son jeton (`aud` `https://api.omnipass.app`, 24 h) ;
- `POST /identity/resolve`, jeton de la personne relayé en `X-End-User-Token` : **200**, instantané
  complet — l'utilisateur, son Seat, son Organization avec son rôle effectif, ses invitations ;
- une lecture dans une Organization où la personne a un rôle : **200** ;
- une Organization qu'elle ne voit pas : **404 `organization_not_found`**. Ce refus **n'est pas venu
  d'omnipass** : le paquet l'a levé dans notre processus, sur l'instantané en cache, sans appel réseau.
  Les journaux d'omnipass ne montrent ce soir-là que trois `resolve`, tous en 200, et aucun 404 ni 403
  (sa lettre du 2026-11-17). C'est T3 vérifié en vrai : une autorisation ne coûte aucun aller-retour.
  Le 404 reste la preuve que l'instantané est le vrai, puisque le bouchon faisait de l'appelant un
  `admin` de **toute** Organization et aurait répondu 200.

Pourquoi trois `resolve` et pas un seul : un instantané est gardé **60 s** (`DEFAULT_CACHE_TTL` du
paquet, et notre `cacheTtl` par défaut), et les étapes se sont étalées sur trois minutes. Le premier
appel a pris 343 ms, parce qu'il allait chercher les clés du tenant à froid ; les suivants ont pris 15
et 32 ms. Ne rien dimensionner sur le premier chiffre. Et pour suivre ce qu'omnipass reçoit vraiment,
il ne faut regarder que `resolve` dans ses journaux : nos 404 et 403 n'y apparaîtront jamais.

Ce qui reste à vérifier, et pourquoi :

- **un rôle trop faible : 403 `role_required`.** Il est intestable avec notre compte, et c'est
  **structurel**. Chez omnipass, un super-admin est `seat_admin` de tout Seat (`loadSeatRole`), donc
  `admin` de toute Organization. **Le piège** : le drapeau super-admin s'accorde mais ne se retire
  jamais (`user.isSuperAdmin ||= …`). Retirer l'adresse de la liste des super-admins ne rétrograde donc
  rien, et on chercherait la panne du mauvais côté. **La recette** d'omnipass (`A-FAIRE.md`) :
  1. inviter une seconde adresse (un alias `+` suffit) avec le rôle `viewer` ;
  2. se connecter avec cette adresse et accepter l'invitation ;
  3. appeler une action qui exige `manager`.

  Il faut bien l'**inviter** d'abord : une adresse jamais invitée et non super-admin ne peut pas se
  connecter du tout (`user_not_invited`) ;

- **le même parcours par le MCP**, qui attend que notre API MCP existe et que son audience soit
  ajoutée à l'entrée `pinkwhale`. Ce parcours passe par **notre** `/mcp`, avec le jeton d'une personne,
  relayé à `resolve` comme en REST. Le `/mcp` d'omnipass n'est pas sur ce chemin, et il refuse de toute
  façon un jeton machine (`user_required`) ;
- les quatre cas de dégradation du § 4 de `branchement-omnipotent.md` contre un vrai omnipass ; ils
  sont déjà couverts chez lui contre un `fetchFn` injecté.
