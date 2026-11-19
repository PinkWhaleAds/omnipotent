# Handover — reprendre le fil d'Omnipotent

Écrit le **2026-11-17**, à la fin d'une session qui a branché la tenancy réelle et refermé la phase 1.
**Repris le 2026-11-18**, à la fin d'une session qui a monté les accès Google et Microsoft avec Lorin,
avant qu'il change de machine.

Tu reprends le projet : ce document te dit **où est la vérité**, **dans quel état est le code**, **ce
qui t'attend** et **ce qui nous a coûté du temps**, pour que ça ne te le coûte pas deux fois.

Ce n'est pas un document de référence. Les documents de référence sont ceux cités au § 1, et c'est eux
qui font foi. Celui-ci est un passage de relais : il périme, et il a le droit.

---

## 1. Où est la vérité, et dans quel ordre la lire

Dans cet ordre, parce que chacun suppose le précédent :

| Document                           | Ce qu'il porte                                                      |
| ---------------------------------- | ------------------------------------------------------------------- |
| `CLAUDE.md` (racine)               | les conventions, le partage avec omnipass, où chaque chose appartient |
| `CADRAGE.md`                       | **la** référence : hiérarchie, algèbre du budget, profils de levier, et **toutes** les décisions `D…` et `T…` (§ 20) |
| `backend/docs/plan.md`             | les phases, leur contenu, leur ordre, et l'avancement réel           |
| `backend/docs/phase-N.md`          | le contrat d'une phase, écrit avant elle et corrigé après            |
| `backend/docs/reporting.md`        | les décisions `R…` du reporting                                      |
| `backend/docs/leviers.md`          | les décisions `L…` et `G…` des leviers                               |
| `backend/docs/error-codes.md`      | le catalogue des codes d'erreur — **ils font partie du contrat**     |
| `A-FAIRE.md`                       | ce qui dépend de Lorin : comptes, accès, relevés, décisions produit ; et les identifiants reçus (§ 2) |
| `docs/runbook-acces.md`            | les mêmes démarches, **écran par écran** ; mis à jour le 2026-11-18  |
| `docs/nouveau-poste.md`            | monter une machine neuve : outils, clés, dépôts, secrets             |

Les règles de travail sont dans `docs/README.md` § « Les règles » et valent pour une phase autant que
pour un cadrage. Les trois qui se perdent le plus vite :

- **ne rien déduire en silence** : une déduction se présente à Lorin **numérotée**, pour validation.
  C'est la méthode qui a produit `CADRAGE.md`, et elle fait remonter les erreurs avant qu'elles
  coûtent ;
- **ne jamais écrire un compte** de décisions, de phases ou de plateformes dans un document ou un
  commentaire : ces nombres bougent, et un nombre écrit devient faux sans que personne le voie ;
- **documentation en français, code et JSDoc en anglais.**

## 2. Ce qu'il faut savoir de la machine et de la personne

**Ne lance jamais `jest` ni la couverture sans l'accord explicite de Lorin.** L'ancien poste n'avait
pas la RAM pour les workers par défaut — 15 Go au total, ~6 Go disponibles, 20 cœurs, donc jest en
lançait 19 et la machine tombait. **Lorin change de poste le 2026-11-18** : demande-lui la RAM du
nouveau avant de supposer quoi que ce soit. Sur l'ancien, la forme qui passait était :

```sh
cd backend && npx jest --coverage true --coverageDirectory=coverage-unit --maxWorkers=4
```

**Un secret ne passe jamais par le chat, et « le chat » inclut un fichier ouvert dans l'éditeur.**
L'extension VS Code envoie automatiquement la sélection de Lorin : un secret collé dans un fichier puis
sélectionné arrive dans la conversation comme s'il l'avait écrit, même si le fichier est ignoré par
git. C'est arrivé **deux fois** le 2026-11-17 — le Client Secret du compte machine Auth0, puis un jeton
d'accès utilisateur. Le premier a été mis en rotation, et c'était la seule réaction juste. La forme à
proposer, toujours, est `read -rs` dans le terminal — et pour les secrets du magasin local,
`pnpm secrets:seed`, qui le fait pour lui. Les identifiants **non secrets** — un `client_id`, un
customer id, un numéro de compte — peuvent circuler dans le chat sans problème.

**Parle simplement, une chose à la fois.** Le 2026-11-18, mon premier message de reprise était une
liste de déductions techniques sur le moteur ; la réponse a été « j'ai pas compris ce que tu veux ».
Ce qui a marché ensuite : dire **à quoi sert** une étape avant de la demander, guider **écran par
écran** (où cliquer, quoi noter), et marquer chaque valeur **[chat]** ou **[secret]**. Une question
de vérification se pose avec le chemin exact de l'écran où la vérifier, pas avec des numéros d'étape.

Et une préférence de Lorin, dans son `~/.claude/CLAUDE.md` : **aucun message de co-auteur dans un
commit git.** Ce fichier est sur sa machine, pas dans le dépôt : `docs/nouveau-poste.md` § 7 lui dit
de le recréer.

## 3. L'état du code

**Tout était vert au commit `7ecbeff`**, vérifié deux fois — en local et sur les runners GitHub (le
workflow `backend` du 2026-11-17 à 19:00 UTC) :

| Vérification                      | Dernier résultat                                        |
| --------------------------------- | ------------------------------------------------------- |
| `pnpm build`                      | ✅                                                      |
| `pnpm test:cov` (unitaire)        | ✅ 108 suites, 1923 tests, **100 %** sur les 4 métriques |
| `pnpm test:integration`           | ✅ 7 suites, 42 tests                                   |
| `pnpm lint:check` / `prettier:check` | ✅                                                   |
| `terraform validate` + `test` (prod / test) | ✅ 29 + 11 tests hors-ligne                   |
| `terraform fmt -check -recursive` | ✅                                                      |

**Rien sous `backend/src/` n'a changé depuis.** Le 2026-11-18 n'a touché que de la documentation et
l'outillage : `backend/scripts/seed-local-secrets.sh` (`pnpm secrets:seed`, la synchronisation des
secrets entre AWS et moto), `backend/scripts/setup-dev.sh` (`pnpm setup:dev`, la mise en route en une
commande), `backend/.env.example` (le Client ID d'omnipass, qui n'a pas de défaut, y est maintenant
actif) et `backend/README.md`. Les tests n'ont pas été relancés, faute d'objet ; `pnpm setup:dev` a
tourné sur l'ancien poste, et l'API a démarré derrière lui (`/readyz` → 200).

**Les phases livrées** : le socle (phase 0) et les phases 1 à 9. Le détail est dans le tableau
d'avancement de `backend/docs/plan.md` ; ne le recopie pas ici, lis-le là-bas.

**Ce que la phase 1 a changé le 2026-11-17** :

- `@pinkwhaleads/omnipass-client` est installé, câblé, et ses types sont **réexportés** plutôt que
  recopiés (`backend/src/types/auth.types.ts`) ;
- le **bouchon de tenancy est supprimé** : plus de `LocalAccessService`, plus d'`ACCESS_PROVIDER`, plus
  de `DEV_ACTOR_*`, plus de `tenancy-provider.ts`. Il n'y a **qu'une implémentation**, celle
  d'omnipass, et l'application **refuse de démarrer partout** sans compte machine ni secret dans le
  magasin. D43 est **amendée** en ce sens dans `CADRAGE.md` ;
- le chemin relayé a été **vérifié contre le vrai omnipass** : jeton machine, `resolve` relayé → 200
  avec l'instantané complet, lecture autorisée → 200, Organization invisible → **404
  `organization_not_found`** (`backend/docs/phase-1.md` § 6). Ce 404 a été levé **chez nous**, par le
  paquet, sur l'instantané en cache : omnipass n'a servi que des `resolve` en 200 (sa lettre du
  2026-11-17). Une trace de nos 404 ou 403 ne se cherche donc **jamais** dans ses journaux ;
- **ce qui reste non vérifié** : le **403 `role_required`**. Le seul compte existant est super-admin,
  donc `admin` de toute Organization : il ne peut pas se faire refuser, et le drapeau ne se retire
  jamais. Il faut une seconde adresse (un alias `+` suffit) invitée en `viewer` : la recette d'omnipass
  est dans `A-FAIRE.md` et le runbook, A5.

## 4. Démarrer la machine

**Sur une machine neuve**, `docs/nouveau-poste.md` est le pas à pas complet. Sur une machine déjà
montée, `backend/README.md` fait autorité ; voici ce qui se cherche le plus :

```sh
cd backend        # à la racine du dépôt pnpm échoue : il n'y a pas de package.json racine
pnpm setup:dev    # secrets, dépendances, .env, conteneurs (5442, 9012, 9022), schéma
pnpm start:dev    # API sur http://localhost:3002, Swagger sur /documentation
```

**Le piège du démarrage** : l'application lit le secret du compte machine dans le magasin, et en
développement le magasin est **moto**, pas AWS. **moto garde tout en mémoire** : un `down`, un `stop`
ou un redémarrage du poste le vide, et le démarrage échoue alors avec un message qui accuse AWS à
tort (`ResourceNotFoundException: Secrets Manager can't find the specified secret`). C'est arrivé
entre le 17 et le 18 : le secret d'omnipass avait disparu. Le remède est `pnpm secrets:seed`, qui
rapatrie tout d'AWS en quelques secondes — il ne demande que le profil `omnilor`.

**Trois autres choses qui se cherchent** :

- le profil AWS est **`omnilor`** (compte `903305161052`). Le profil `default` portait des clés mortes
  et répondait `UnrecognizedClientException`, qui ressemble à un problème de droits sans en être un ;
- le dépôt `PinkWhaleAds/omnipotent` se pousse par l'alias SSH **`git@github-pinkwhale:`**, et il est
  **public** (mesuré). `PinkWhaleAds` est un compte **personnel**, pas une organisation, et
  `docs/consuming.md` d'omnipass porte encore l'erreur inverse ;
- les routes de campagne sont `GET /advertisers/:id/campaigns` et `GET /campaigns/:id`. Un
  `GET /campaigns` répond 404, et ce n'est pas un trou d'authentification.

## 5. Le partage avec omnipass, et pourquoi il ne se négocie pas localement

`AccessService` (`backend/src/services/access.service.ts`) est **la seule porte** vers omnipass, et son
interface est **le contrat des deux projets** : `docs/consuming.md` de `PinkWhaleAds/omnipass`, cloné en
`~/PinkWhale/omnipass`. Une signature qui gêne se **remonte à Lorin**, jamais ne s'adapte ici.

Ce qui en découle, et que `CLAUDE.md` développe :

- ce dépôt ne porte **ni** `User`, **ni** `Seat`, **ni** `Organization`, ni membership, ni invitation.
  Une table d'ici garde `organizationId` et `userId` comme des **uuid opaques**, sans clé étrangère
  entre les deux bases (T4), et omnipass en est le **seul** écrivain (T5) ;
- le **jeton se vérifie ici**, l'**identité se résout là-bas** : le plugin d'authentification appelle
  `accessService.resolve(sub, token)` **une fois** par requête, en relayant le jeton de la personne pour
  qu'omnipass agisse avec **ses** droits ;
- tout `assert*` est du **calcul pur** sur l'instantané posé sur `request.auth` : une vérification de
  permission ne coûte **aucun** appel réseau. Aucun droit ne voyage dans le jeton (T3) ;
- **écrire la tenancy passe par le paquet**, jamais par un appel HTTP écrit à la main : chaque écriture
  réussie invalide l'utilisateur dans le cache local toute seule, ce qu'un appel manuel oublierait ;
- un `OmnipassError` traverse l'API **telle quelle**, sans adaptateur.

**Si joindre omnipass devient gênant dans une phase, la réponse reste de passer par omnipass** — jamais
d'ajouter une table ici.

## 6. Ce qui t'attend, et dans quel ordre

### Ce que Lorin veut : connecter ses vrais comptes Google et Microsoft

Il l'a dit le 2026-11-18. Les accès sont montés de son côté ; ce qui manque est **notre code**.
**Aucune ligne d'Omnipotent ne parle encore à Google ni à Microsoft** : le registre
`platform-rules.ts` et la table `ADAPTERS` sont vides, et un `AdAccount` n'est qu'une déclaration
rangée en base.

### Les accès, au 2026-11-18

Les identifiants non secrets sont dans `A-FAIRE.md` § 2. Ce qui existe :

| Google Ads                                                   | Microsoft Advertising                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------- |
| projet Cloud payant, API activée                             | compte gestionnaire                                           |
| compte de service, invité **Administrateur** du MCC de production | developer token de **production**, accordé tout de suite  |
| client OAuth « Application de bureau » pour l'inviteur       | application Entra : « Any Entra ID Tenant + Personal Microsoft accounts », plateforme Web, retour `http://localhost:4102/microsoft/callback` |
| accès **Basic** ; **Standard demandé le 2026-11-18** (revue ~10 jours ouvrés) | utilisateur de service dédié, **Super Admin**, double authentification active |
| **pas** de MCC de test (B4) : à rediscuter avant les preuves, qui écriraient sur un vrai compte | **pas** de bac à sable (C4) : même remarque |

Deux points à connaître sur les personnes :

- l'**humain admin du MCC**, qui consentira pour l'inviteur Google, est probablement `admin@pinkwhale.co`
  — à confirmer avec Lorin au moment du consentement ;
- l'**utilisateur de service Microsoft** est un compte **personnel** outlook.com dédié. Son adresse
  n'est **pas** dans le dépôt, qui est public : Lorin te la donnera. Limite assumée : un client dont la
  politique exige des identités professionnelles répondra `PersonalIdentityNotAvailable` ; en changer
  ne demandera que de refaire le consentement. `admin@pinkwhale.co` se connecte à Microsoft
  Advertising par un **compte Google**, ce qui interdit de le prendre pour l'API.

### Les secrets, et leur forme — c'est un contrat

**Ils vivent sur AWS** — Secrets Manager du compte `903305161052`, région `eu-north-1`, sous
`omnipotent/dev/`, hors de Terraform. Le backend, lui, les lit en développement dans moto sous
`omnipotent/` ; `pnpm secrets:seed` tient les deux côtés d'accord, la valeur la plus récente gagnant.
Le secret d'omnipass rapatrié d'AWS a été **vérifié le 2026-11-18** : Auth0 délivre un jeton machine
avec lui. Coût : quarante cents par secret et par mois.

Leurs noms et leurs formes sont **ceux de multi-search** (`src/platforms/google/google.auth.ts`,
`src/platforms/microsoft/microsoft.auth.ts`), pour que la transcription n'ait rien à réinventer :

| Nom                          | Forme                                                   | Écrit par                    |
| ---------------------------- | ------------------------------------------------------- | ---------------------------- |
| `omnipass/client-secret`     | la chaîne du Client Secret                              | à la main, une fois          |
| `google-ads/service-account` | le fichier JSON de la clé, tel quel                     | à la main, une fois          |
| `google-ads/inviter`         | `{ clientId, clientSecret }`, puis `refreshToken`        | à la main, puis la commande de consentement Google |
| `microsoft-ads/app`          | `{ clientId, clientSecret, developerToken }`            | à la main, une fois          |
| `microsoft-ads/oauth`        | `{ refreshToken, … }`                                    | la commande de consentement Microsoft, à écrire |
| `github/npm-token`           | le jeton du paquet d'omnipass ; côté poste, `~/.npmrc`  | à la main, tous les 90 jours |

« À la main » veut dire `pnpm secrets:seed set <nom>`, qui redemande la valeur sans écho. Les
commandes de consentement écriront dans moto, comme le fait multi-search : la synchronisation suivante
les enverra sur AWS. **Si tu veux qu'elles écrivent directement sur AWS**, c'est une décision à
présenter, pas à prendre.

La production les attend sous `omnipotent/prod/…`, dans des conteneurs que Terraform doit encore
déclarer (`module "secrets"` de `infra/envs/prod/main.tf`), valeurs posées à la main.

### La prochaine tâche : le code de connexion, Google puis Microsoft

« Connecter un compte » veut dire : s'authentifier, **lire** le compte (nom, devise, fuseau),
l'**inviter** sous notre compte gestionnaire, et **suivre** son acceptation. Pousser des campagnes
vient après. L'ordre :

1. ✅ **Fait le 2026-11-19, et validé par Lorin** : `backend/docs/phase-10.md`, en trois lots, avec
   ses points numérotés (§ 7) et la règle du super-admin (§ 4.5). Ce qui suit est l'état d'avant :
   écrire `backend/docs/phase-10.md`, le contrat, comme chaque phase — avec les déductions
   ci-dessous, numérotées, présentées **simplement** à Lorin (§ 2).
2. **Combler les trous du moteur**, qui valent pour toutes les plateformes. La lecture du 2026-11-18
   en a trouvé trois, **non validés** par Lorin — mon premier exposé était trop technique, il faudra
   le refaire :
   - le moteur **saute toute unité dont le compte n'a pas de `secretName`**
     (`backend/src/services/sync.service.ts`, dans `syncUnit`), et `PlatformContext.credentials` ne
     porte que le secret du compte. Or chez Google et Microsoft le credential est **celui de
     l'application** (`backend/docs/phase-7.md` § 2) : tel quel, aucune unité Google ne serait jamais
     synchronisée. Proposition : le registre déclare d'où vient le credential, et l'adapter reçoit à
     sa construction de quoi lire le secret de l'application — c'est ce que fait multi-search ;
   - **un refus de nos propres credentials invaliderait le compte du client** : `invalidCredentials`
     passe l'`AdAccount` en `invalid`. multi-search distingue `ownCredentials` — c'est alors à un
     opérateur d'agir (`backend/docs/plateformes/google-ads.md` § 4) ;
   - **l'interface n'a que `apply`** (`backend/src/platforms/platform-adapter.ts`) : rien pour lire un
     compte, ce que la première preuve de clôture exige, ni pour inviter et suivre un lien
     (`account.links`, `backend/docs/phase-7.md` § 3). multi-search a des méthodes facultatives
     `readAccount`, `requestLink`, `linkStatuses`.
3. **La connexion Google** : la signature du JWT du compte de service, le client REST commun avec son
   journal d'appels (`platform-http.ts` de multi-search), la lecture de `customer_client` depuis le
   MCC, l'invitation par l'inviteur, le suivi des statuts, et la commande de consentement
   (`src/scripts/google-connect.ts` de multi-search).
4. **La connexion Microsoft**, sur le même modèle, avec sa commande de consentement
   (`microsoft-connect.ts`) sur le port **4102**.
5. **Puis les campagnes** : le reste des phases 10 et 11 — mapping, adapter, projection, éclatement,
   idempotence — et les huit preuves de chaque phase, qui la **closent**.

Côté multi-search, le Google à transcrire fait environ 5 800 lignes (client, auth, mapping, adapter,
types, et le client HTTP commun). **`CADRAGE.md` § 14 tient tout** : aucun test n'appelle une
plateforme ; l'adapter se couvre contre des faux.

### Ce que la lecture du 2026-11-18 a trouvé, et qui n'est pas corrigé

- **multi-search parle déjà aux deux plateformes**, contrairement à ce que dit son `A-FAIRE.md` § 8,
  jamais coché. Son environnement de test a dans Secrets Manager `multi-search/test/microsoft-ads/app`
  (le 2026-11-09), `…/microsoft-ads/oauth` (**rafraîchi le 2026-11-18 au matin**, donc un processus
  l'utilise), `…/google-ads/service-account` et `…/google-ads/inviter` (le 2026-11-11). Le code à
  transcrire a donc déjà tourné contre les vraies API — une bonne nouvelle, à confirmer avec Lorin.

- **`backend/docs/plateformes/google-ads.md` contredit L6** : son § 3 et le point 1 de son § 9 disent
  qu'un capping Search est un avertissement, alors que L6 — validée avant l'étude — le refuse en 400,
  et que le code suit L6 (`CAPPING_NOWHERE` dans `backend/src/levers/lever-profiles.ts`). C'est
  l'étude qui est périmée, à corriger sur place.
- **Le point 3 de ce même § 9 est fait** : la pause à budget nul est dans `delivers()`
  (`backend/src/platforms/desired-state.ts`).
- **`backend/CLAUDE.md` n'existe pas**, alors que `CLAUDE.md` y renvoie deux fois ; il n'a jamais
  existé dans l'historique.
- **Des comptes sont déjà faux** : `backend/docs/plan.md` écrit « D1→D48 » alors que D53 existe, et
  « 53 décisions », « 14 décisions » ; `CADRAGE.md` § 2 parle de « douze adapters » contre « onze »
  dans D23.

### Ce qui attend Lorin, et rien d'autre

`A-FAIRE.md` est la liste complète ; le runbook la détaille écran par écran.

| Partie du runbook            | État au 2026-11-18                                                          |
| ---------------------------- | --------------------------------------------------------------------------- |
| **A. omnipass et Auth0**     | ✅ **close**, sauf l'API MCP d'Auth0, qui attend qu'on serve un `/mcp`      |
| **B. Google Ads**            | ✅ B1 → B6 et le client OAuth ; reste **B7** (Keyword Planner, phase 17), **B8** (le consentement, après notre code), **B9** (les limites du compte), la revue Standard |
| **C. Microsoft Advertising** | ✅ C1 → C3 ; reste le **consentement**, après notre code, et la date d'expiration du client secret Entra à relever |

**Rien ne bloque plus l'écriture du code.**

### Un message écrit et jamais envoyé

`docs/message-a-omnipass-paquet.md` est prêt et n'est pas parti. Il concède deux erreurs, livre le
constat « `PinkWhaleAds` est un compte personnel » avec le `403 permission_denied: read_package`
mesuré, et dit qu'avec multi-search sur un autre tenant **notre première surface vivante est le MCP**.
Il faut aussi annoncer à omnipass que **le chemin relayé a tourné** du premier coup. Les messages
passent par Lorin, qui fait le relais entre les deux sessions.

## 7. Les erreurs que nous avons faites, parce qu'elles sont instructives

Écrites sans les arrondir : chacune était une déduction présentée comme un fait, ou une étape
oubliée, et c'est le schéma à reconnaître, pas les détails.

| Ce qui a été affirmé                                  | Ce qui était vrai                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| « `PinkWhaleAds` est une organisation, déplaçons-y le dépôt » | C'est un compte **personnel** (`gh api users/PinkWhaleAds` → `"type": "User"`) |
| « Le plan payant GitHub est la seule réponse durable » | Le dépôt est **public** : les environnements d'Actions y sont gratuits           |
| « Le plafond Auth0 va déborder »                       | 3 API sur 10 et 2 applications sur 10 — omnipass a corrigé                        |
| « Le `403` du paquet vient de la portée du jeton »     | Il venait du **compte** : `npm whoami` répondait `LorinProjects`                 |
| « Gardons le bouchon de tenancy »                      | L'argument reposait sur « chaque personne qui touche au dépôt ». Il y en a **une** |
| Le runbook B couvrait l'inviteur Google                | Il manquait le **client OAuth « Application de bureau »** : sans lui, pas de consentement (2026-11-18) |
| « Pose le secret, puis supprime le fichier téléchargé » | moto oublie tout à chaque redémarrage : l'original doit rester dans le gestionnaire de mots de passe |
| La commande A4 posait le secret d'omnipass            | Sa variable n'était pas exportée : `python3` ne la voyait pas. `pnpm secrets:seed` la remplace |
| « multi-search n'a jamais parlé à Microsoft », dit à Lorin d'après une case non cochée | Ses secrets Microsoft existent depuis le 2026-11-09 et son jeton tourne. **Une case non cochée n'est pas un fait** : la vérité était à une commande `list-secrets` |
| « Range tes secrets dans ton gestionnaire de mots de passe » | Lorin n'a pas compris comment, et voulait un script clé en main. AWS les garde maintenant : demande d'abord ce que la personne sait faire |

La plus utile reste celle du bouchon. Le raisonnement était correct et sa prémisse fausse : Lorin
développe seul et aucun client ne verra le produit avant qu'il soit terminé. **Demande la prémisse
avant de bâtir la recommandation.**

## 8. Ce qui est décidé et attend sa phase

Ne les réinvente pas, et ne les livre pas en avance : `CADRAGE.md` les porte, et chacune attend la
phase qui en a besoin — un pooler de connexions au-delà de quelques réplicas (D44), un limiteur de
débit partagé entre réplicas et par plateforme (D45), un verrou par campagne pour la synchro (D46), un
jitter sur le rafraîchissement du pacing au minuit local (D47), une réplique de lecture pour les
rapports (D48).

Et une réserve qui n'est pas un oubli : la réserve explicite sur tout total de conversions
multi-plateformes (`reporting.md`, R9 famille 1) tient lieu de vérité jusqu'à ce que nos propres
conversions existent, en V2.
