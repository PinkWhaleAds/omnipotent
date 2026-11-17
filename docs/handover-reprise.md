# Handover — reprendre le fil d'Omnipotent

Écrit le **2026-11-17**, à la fin d'une session qui a branché la tenancy réelle et refermé la phase 1.
Tu reprends le projet : ce document te dit **où est la vérité**, **dans quel état est le code**, **ce
qui t'attend** et **ce qui m'a coûté du temps**, pour que ça ne te le coûte pas deux fois.

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
| `A-FAIRE.md`                       | ce qui dépend de Lorin : comptes, accès, relevés, décisions produit  |
| `docs/runbook-acces.md`            | les mêmes démarches, **écran par écran** ; mis à jour le 2026-11-17  |

Les règles de travail sont dans `docs/README.md` § « Les règles » et valent pour une phase autant que
pour un cadrage. Les trois qui se perdent le plus vite :

- **ne rien déduire en silence** : une déduction se présente à Lorin **numérotée**, pour validation.
  C'est la méthode qui a produit `CADRAGE.md`, et elle fait remonter les erreurs avant qu'elles
  coûtent ;
- **ne jamais écrire un compte** de décisions, de phases ou de plateformes dans un document ou un
  commentaire : ces nombres bougent, et un nombre écrit devient faux sans que personne le voie ;
- **documentation en français, code et JSDoc en anglais.**

## 2. Deux contraintes de la machine et de la personne, à ne pas découvrir seul

**Ne lance jamais `jest` ni la couverture sans l'accord explicite de Lorin.** Sa machine n'a pas la RAM
pour les workers par défaut — 15 Go au total, ~6 Go disponibles, 20 cœurs, donc jest en lance 19 et la
machine tombe. Quand il a donné son accord, la forme qui passe est :

```sh
cd backend && npx jest --coverage true --coverageDirectory=coverage-unit --maxWorkers=4
```

**Un secret ne passe jamais par le chat, et « le chat » inclut un fichier ouvert dans l'éditeur.**
L'extension VS Code envoie automatiquement la sélection de Lorin : un secret collé dans un fichier puis
sélectionné arrive dans la conversation comme s'il l'avait écrit, même si le fichier est ignoré par
git. C'est arrivé **deux fois** le 2026-11-17 — le Client Secret du compte machine Auth0, puis un jeton
d'accès utilisateur. Le premier a été mis en rotation, et c'était la seule réaction juste. La forme à
proposer, toujours, est `read -rs` dans le terminal (`docs/runbook-acces.md`, en tête). Les
identifiants **non secrets** — un `client_id`, un customer id, un numéro de compte — peuvent circuler
dans le chat sans problème.

Et une préférence de Lorin, dans son `CLAUDE.md` : **aucun message de co-auteur dans un commit git.**

## 3. L'état du code, au commit `7ecbeff`

**Tout est vert, et vérifié deux fois** — en local et sur les runners GitHub (le workflow `backend` du
2026-11-17 à 19:00 UTC, sur ce même commit) :

| Vérification                      | Dernier résultat                                        |
| --------------------------------- | ------------------------------------------------------- |
| `pnpm build`                      | ✅                                                      |
| `pnpm test:cov` (unitaire)        | ✅ 108 suites, 1923 tests, **100 %** sur les 4 métriques |
| `pnpm test:integration`           | ✅ 7 suites, 42 tests                                   |
| `pnpm lint:check` / `prettier:check` | ✅                                                   |
| `terraform validate` + `test` (prod / test) | ✅ 29 + 11 tests hors-ligne                   |
| `terraform fmt -check -recursive` | ✅                                                      |

**Les phases livrées** : le socle (phase 0) et les phases 1 à 9. Le détail et ce que chacune porte sont
dans le tableau d'avancement de `backend/docs/plan.md` ; ne le recopie pas ici, lis-le là-bas.

**Ce que la phase 1 a changé le 2026-11-17**, puisque c'est le plus frais et donc le plus fragile :

- `@pinkwhaleads/omnipass-client` est installé, câblé, et ses types sont **réexportés** plutôt que
  recopiés (`backend/src/types/auth.types.ts`) ;
- le **bouchon de tenancy est supprimé** : plus de `LocalAccessService`, plus d'`ACCESS_PROVIDER`, plus
  de `DEV_ACTOR_*`, plus de `tenancy-provider.ts`. Il n'y a **qu'une implémentation**, celle
  d'omnipass, et l'application **refuse de démarrer partout** sans compte machine ni secret dans le
  magasin — plus seulement en production. D43 est **amendée** en ce sens dans `CADRAGE.md` ;
- le chemin relayé a été **vérifié contre le vrai omnipass** : jeton machine, `resolve` relayé → 200
  avec l'instantané complet, lecture autorisée → 200, Organization invisible → **404
  `organization_not_found`**. Le détail est dans `backend/docs/phase-1.md` § 6 ;
- **ce qui reste non vérifié** : le **403 `role_required`**. Le seul compte existant est super-admin,
  donc `admin` de toute Organization par la règle des rôles effectifs : il ne peut pas se faire
  refuser. Il faut une deuxième personne avec un rôle `viewer`, invitée par omnipass. C'est dans
  `A-FAIRE.md` et dans le runbook (A5).

## 4. Démarrer la machine en cinq minutes

`backend/README.md` est à jour et fait autorité ; voici seulement ce qui se cherche le plus :

```sh
cd backend
pnpm install                              # à la racine du dépôt ça échoue : il n'y a pas de package.json racine
docker compose up -d postgres rustfs moto # 5442, 9012, 9022
pnpm migration:run
pnpm start:dev                            # API sur http://localhost:3002, Swagger sur /documentation
```

**Le piège du démarrage** : l'application lit le secret du compte machine dans le magasin, et en
développement le magasin est **moto**, pas AWS — `config/default.json` y pointe. Sans le secret,
le démarrage échoue avec un message qui accuse AWS à tort
(`ResourceNotFoundException: Secrets Manager can't find the specified secret`). La commande de
réamorçage est dans `backend/README.md` et dans le runbook (A4) ; **moto n'a pas de volume**, donc un
`docker compose down` l'efface et il faut la rejouer.

**Trois autres choses qui se cherchent** :

- le profil AWS est **`omnilor`** (compte de test `903305161052`). Le profil `default` porte des clés
  mortes et répond `UnrecognizedClientException`, qui ressemble à un problème de droits sans en être
  un ;
- le dépôt `PinkWhaleAds/omnipotent` se pousse par l'alias SSH **`git@github-pinkwhale:`**, et il est
  **public** (mesuré). `PinkWhaleAds` est un compte **personnel**, pas une organisation — je m'étais
  trompé là-dessus, et `docs/consuming.md` d'omnipass porte encore la même erreur ;
- les routes de campagne sont `GET /advertisers/:id/campaigns` et `GET /campaigns/:id`. Un
  `GET /campaigns` répond 404, et ce n'est pas un trou d'authentification — j'y ai cru dix minutes.

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
- un `OmnipassError` traverse l'API **telle quelle**, sans adaptateur : elle porte déjà `statusCode`,
  `code`, `params` et les alias que notre gestionnaire d'erreurs lit.

**Si joindre omnipass devient gênant dans une phase, la réponse reste de passer par omnipass** — jamais
d'ajouter une table ici. C'est la tentation que la suppression du bouchon rend visible, et c'est
exactement celle à refuser.

## 6. Ce qui t'attend, et dans quel ordre

### La prochaine tâche : la phase 10, l'adapter Google contre des faux

C'est la tâche que j'avais annoncée et qui n'a pas commencé. Elle a un avantage rare : **elle ne dépend
d'aucun accès en attente**. Son étude est faite et sourcée — `backend/docs/plateformes/google-ads.md`
porte la projection, le ciblage, les deux credentials, les quotas, l'idempotence et les créas, chaque
affirmation marquée de sa provenance. Son contrat est la ligne 10 du tableau des phases de
`backend/docs/plan.md`.

Ce qu'elle livre : le client REST avec son journal d'appels, la signature du JWT du compte de service,
le mapping, l'adapter, son entrée au registre, la projection `AdGroup → campagne / TG → ad group /
Line → RSA`, l'éclatement quand un TG porte un budget, et l'idempotence par paramètre d'URL
personnalisé.

**Et la contrainte qui tient tout** : `CADRAGE.md` § 14 — **aucun test n'appelle une plateforme**.
L'adapter se développe et se couvre entièrement contre des faux. Les **huit preuves** sur un compte
réel closent la phase, et elles attendent les accès Google (partie B du runbook), qui n'existent pas
encore. Donc la phase s'écrit en entier maintenant et se **clôt** plus tard : dis-le explicitement
quand tu la livres, plutôt que de la déclarer terminée.

### Ce qui attend Lorin, et rien d'autre

`A-FAIRE.md` est la liste complète ; le runbook la détaille écran par écran. L'état au 2026-11-17 :

| Partie du runbook           | État                                                                       |
| --------------------------- | -------------------------------------------------------------------------- |
| **A. omnipass et Auth0**    | ✅ **close**, sauf l'API MCP d'Auth0, qui attend qu'on serve un `/mcp`     |
| **B. Google Ads**           | le MCC de production existe ; **tout le reste est à faire** (B1 → B9)      |
| **C. Microsoft Advertising** | le compte gestionnaire existe ; **tout le reste est à faire** (C1 → C4)   |

Donc : **B est le seul blocage réel**, et il ne bloque que la **clôture** de la phase 10, pas son
écriture.

### Un message écrit et jamais envoyé

`docs/message-a-omnipass-paquet.md` est prêt et n'est pas parti. Il concède deux erreurs que j'avais
faites, livre le constat « `PinkWhaleAds` est un compte personnel » avec le `403 permission_denied:
read_package` mesuré, et dit qu'avec multi-search sur un autre tenant **notre première surface vivante
est le MCP**, pas une page web. Il faut aussi annoncer à omnipass que **le chemin relayé a tourné** —
c'était son premier essai réel, il avait proposé de regarder ses journaux en direct, et il mérite de
savoir que ça a marché du premier coup. Les messages passent par Lorin, qui fait le relais entre les
deux sessions.

## 7. Les erreurs que j'ai faites, parce qu'elles sont instructives

Je les écris sans les arrondir : chacune était une déduction présentée comme un fait, et c'est le
schéma à reconnaître, pas les détails.

| Ce que j'ai affirmé                                   | Ce qui était vrai                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| « `PinkWhaleAds` est une organisation, déplaçons-y le dépôt » | C'est un compte **personnel** (`gh api users/PinkWhaleAds` → `"type": "User"`) |
| « Le plan payant GitHub est la seule réponse durable » | Le dépôt est **public** : les environnements d'Actions y sont gratuits           |
| « Le plafond Auth0 va déborder »                       | 3 API sur 10 et 2 applications sur 10 — omnipass a corrigé                        |
| « Le `403` du paquet vient de la portée du jeton »     | Il venait du **compte** : `npm whoami` répondait `LorinProjects`                 |
| « Gardons le bouchon de tenancy »                      | L'argument reposait sur « chaque personne qui touche au dépôt ». Il y en a **une** |

La dernière est la plus utile. Mon raisonnement était correct et sa prémisse était fausse : Lorin
développe seul et aucun client ne verra le produit avant qu'il soit terminé. **Demande la prémisse
avant de bâtir la recommandation.**

## 8. Ce qui est décidé et attend sa phase

Ne les réinvente pas, et ne les livre pas en avance : `CADRAGE.md` les porte, et chacune attend la
phase qui en a besoin — un pooler de connexions au-delà de quelques réplicas (D44), un limiteur de
débit partagé entre réplicas et par plateforme (D45), un verrou par campagne pour la synchro (D46), un
jitter sur le rafraîchissement du pacing au minuit local (D47), une réplique de lecture pour les
rapports (D48).

Et quelques réserves qui ne sont pas des oublis : la réserve explicite sur tout total de conversions
multi-plateformes (`reporting.md`, R9 famille 1) tient lieu de vérité jusqu'à ce que nos propres
conversions existent, en V2.
