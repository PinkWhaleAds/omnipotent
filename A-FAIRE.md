# À faire de ton côté — Omnipotent

Ce qui ne dépend que de toi : comptes à créer, accès à demander, clés à générer, décisions à trancher, questions à poser aux plateformes. Je mets ce fichier à jour dès qu'un nouveau besoin apparaît, et je coche ce qui est fait quand tu me le dis.

**Clic par clic** : les démarches de ce document sont détaillées écran par écran dans [`docs/runbook-acces.md`](docs/runbook-acces.md), écrit le 2026-10-27.

**Règle des secrets** : une clé, un mot de passe ou un fichier de clé ne passe **jamais** par le chat. Les secrets vont dans `backend/.env` (ignoré par git) ou dans Secrets Manager. Les identifiants non secrets (ID de compte, ID de MCC, numéro de réseau, nom de dépôt) peuvent m'être donnés dans le chat.

Mis à jour le **2026-10-25** : l'étude de faisabilité du point 11 est faite (`backend/docs/plateformes/faisabilite-search.md`), les points 6, 8, 8b et 11 en découlent. Rien n'est encore développé.

## En bref

| #   | Quoi                                                                                   | Ce que ça débloque                                | Urgence                            |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------- |
| 1   | Comptes et credentials des plateformes du périmètre (Pinterest comprise, si F14 passe) | Chaque adapter, au fil des phases                 | Au fil des phases                  |
| 1b  | Qui développe omnipass, et quand le lancer                                             | Le socle d'identité                               | **Avant la mise en production**    |
| 2   | Confirmer la réutilisation des accès de multi-search                                   | Les 4 premiers adapters (phase Search)            | **Avant la phase 1**               |
| 3   | omnipass — qui le développe, et quand                                                  | Le socle d'identité de tous les projets           | **Avant la phase 1**               |
| 4   | Accès **Standard** à l'API Google Ads                                                  | Lève le plafond de 15 000 opérations/jour         | Avant les tests Search réels       |
| 5   | Vérifier les limites d'objets Google par compte                                        | Le garde-fou de l'éclatement par TargetingGroup   | Avant les tests Search réels       |
| 6   | Amazon Ads — accès API **Partner** + un compte vendeur réel                            | Levier Search, puis Audio et CTV                  | Avant la phase Amazon              |
| 7   | DV360 — accès partenaire + API                                                         | Leviers Audio, CTV & TVS, DAC                     | Avant la phase DV360               |
| 8   | Meta / TikTok / Snap — comptes business + apps approuvées                              | Levier Social                                     | Avant la phase Social              |
| 8b  | **Pinterest** — compte business + app (libre-service)                                  | Leviers Search **et** Social                      | **Première des trois nouvelles**   |
| 8c  | **TikTok Search Ads** — demande d'allowlist auprès de TikTok                           | Le levier Search sur TikTok                       | **Maintenant** (délai subi)        |
| 10  | AWS — bucket d'état, variables GitHub OIDC, **2 API Auth0**                            | Déploiement d'Omnipotent (le Terraform est écrit) | Avant la première mise en ligne    |
| 11  | Études Amazon Search / TikTok Search / Pinterest                                       | Périmètre définitif du levier Search              | **Faite** — 16 points à valider    |
| 12  | Étude : fonctionnalités transverses vs propres au Search                               | Périmètre fonctionnel (conversions, catalogues…)  | Avant la phase conversions         |
| 13  | Étude reporting et capacités, une par plateforme                                       | Les rapports, la fraîcheur, les formats de créa   | Dans la phase de chaque plateforme |
| 14  | GitHub — dépôts créés                                                                  | Pousser le code, faire tourner la CI              | Fait (vides)                       |

---

## 1. Comptes et credentials des plateformes — le principe

**Décidé** : Omnipotent traite **toutes** les plateformes de la même façon, Hawk compris. Hawk est une plateforme tierce exactement comme DV360 : on s'y connecte par son API avec des credentials rangés dans Secrets Manager, et on ne touche à aucune infrastructure Azerion. Le code de MBP reste une **référence de lecture** (accord avec Azerion) dont Omnipotent ne reprend aucune ligne.

Conséquence pratique : les comptes DV360, GAM et Hawk utilisés par MBP étaient ceux d'Azerion. Il faut les nôtres.

- [ ] Tu me donnes, au moment de chaque phase, les identifiants non secrets (ID de compte, de partenaire, de réseau) et tu ranges les secrets dans Secrets Manager sans les faire passer par le chat.
- [x] **Hawk** : l'accès API en tant que tiers est acquis.
- [ ] Vérifier pour les autres plateformes si un **accord commercial** est nécessaire avant l'accès API (c'est le cas de DV360 et d'Amazon DSP).

## 2. Réutilisation des accès de multi-search

Omnipotent reprend les quatre plateformes Search de multi-search. Ces accès existent déjà côté MS.

- [ ] Confirmer qu'Omnipotent **réutilise** les mêmes comptes et accès, et ne refait pas la démarche :
  - **Google Ads** : **décidé le 2026-10-27 — on réutilise les accès de multi-search**, un seul projet Google Cloud et un seul MCC pour les deux produits. Mais ils **n'existent pas encore** : la section 7 de `~/OmniAd/multi-search/A-FAIRE.md` est entièrement à cocher. Il faut donc projet Google Cloud (**compte de facturation payant**, un projet en essai gratuit est refusé), API Google Ads activée, MCC de production, MCC de test avec un compte client dedans, compte de service ajouté comme utilisateur du MCC, compte Keyword Planner, et le **`refresh_token` OAuth d'un humain admin du MCC** — Google refuse les invitations de lien manager à un compte de service (`backend/docs/plateformes/google-ads.md` § 4). **Il n'y a plus de developer token** depuis le 2026-09-09 : le niveau d'accès est celui du projet Cloud. Les clés vont dans Secrets Manager, jamais dans le chat ; le customer id du MCC n'étant pas secret, tu peux me le donner ici.
    **Conséquence du partage** : le plafond d'opérations est celui du projet, tous clients confondus — les deux produits se le partagent. L'étude de multi-search chiffre cinquante AdGroups à ~8 400 opérations par jour avant la moindre écriture, sur 15 000 en Basic. L'accès **Standard** devient donc une condition, pas une optimisation.
  - **Microsoft Advertising** : compte gestionnaire, sandbox, application Entra ID, developer token.
  - **OpenAI Ads** : compte `OmniAd` et sa clé Ads API.
  - **Thrad** : organisation et clé API.
  - **Anthropic** : clé API pour la génération de textes.
  - **Auth0** : tenant, application SPA, les deux API (REST et MCP).
- [x] Auth0 : **tenant partagé**, celui de multi-search. Omnipotent y aura ses **propres** audiences (REST et MCP), omnipass aussi.
- [ ] Le statut de **partenaire API OpenAI** (point 1 du `A-FAIRE.md` de multi-search) reste ouvert : il conditionne la gestion du pixel OpenAI et les enchères à la conversion.

## 3. omnipass — le service de tenancy

Décision prise : un service séparé, dépôt `git@github.com:MultiSearchAd/omnipass.git` (créé, vide, branche `master`). Il porte Users, Seats, Organizations, memberships, invitations et un rôle grossier par `(user, seat)` et `(user, org)`. Rien d'applicatif.

- [x] **En parallèle** d'Omnipotent, qui démarre avec une implémentation locale derrière l'interface `AccessService`. Jamais de production sans omnipass.
- [x] Nom définitif : `omnipass`.
- [x] Omniscient est **hors périmètre pour l'instant** (encore en développement) ; sa migration viendra plus tard.
- [ ] Décider **qui** le développe, et lancer la session avec `~/OmniAd/omnipass/HANDOVER.md`.
- [ ] Renommer la branche `master` en `main` pour être cohérent avec les autres dépôts.

## 4. Google Ads — accès Standard

- [ ] Demander l'accès **Basic** dès le projet créé (automatisé, quelques minutes après la vérification de marque), **puis** l'accès **Standard** (revue d'environ 10 jours ouvrés). Un projet neuf démarre au niveau `Test`, qui ne parle qu'à des comptes de test, et `Explorer` tombe à **2 880 opérations par jour en production** : c'est le piège à éviter. `Basic` plafonne à **15 000 opérations par jour pour tout le projet**, partagé avec multi-search depuis la décision de réutiliser ses accès, ce qui rend `Standard` nécessaire plus tôt qu'il n'y paraît.
- [ ] Rappel : le niveau d'accès d'un projet est retiré après **90 jours sans appel**. Ne pas laisser le projet inactif pendant le développement d'Omnipotent.

## 5. Limites d'objets Google — vérification

L'option retenue pour le budget par POI (« éclatement ») crée **une campagne Google par TargetingGroup portant un budget explicite**. L'ordre de grandeur des limites par compte Google est de plusieurs milliers de campagnes, très loin de ce qu'on produira — mais il faut le chiffre exact pour régler le garde-fou.

- [ ] Relever sur la page « account limits » de Google Ads les limites exactes par compte : campagnes, ad groups par campagne, mots-clés, annonces actives.
- [ ] Même relevé pour Microsoft Advertising.
- [ ] Me donner les chiffres : je règle le plafond configurable de campagnes plateforme par AdGroup, refusé par la preview au-delà.

## 6. Amazon Ads

Deux intégrations **distinctes**, deux adapters, deux entrées dans l'enum des plateformes.

L'étude de faisabilité est faite : **verdict « on intègre, en deuxième, sous condition »**. Le détail est dans `backend/docs/plateformes/faisabilite-search.md` § 3. Ce qui suit est ce qui dépend de toi.

**L'accès à l'API — libre-service, gratuit, revue annoncée à 1 jour ouvré.** Trois étapes, dans l'ordre :

- [ ] S'inscrire comme développeur sur `developer.amazon.com` et créer une **application Login with Amazon**. Gratuit, aucune approbation. Donne le `client_id` et le `client_secret` (le secret ne passe pas par le chat).
- [ ] S'inscrire à l'**Amazon Ads Partner Network**, puis y demander l'accès API : console → _API Applications_ → _Request API Access_. C'est la voie **Partner** (« entreprises qui construisent des solutions logicielles pour le compte d'autrui »), **pas** la voie Direct Advertiser — déduction **F3** de l'étude, à confirmer. Le formulaire demande les usages prévus et fait accepter l'**Amazon Ads API License Agreement** et la **Data Protection Policy** : à lire avant de signer.
- [ ] Assigner l'accès API à l'application LwA depuis le lien reçu par mail. Vérifier qu'on obtient bien les **deux** scopes : `advertising::campaign_management` et `advertising::test:create_account` (le second crée les comptes de test).
- [ ] Me donner le `client_id` et l'identifiant du manager account (non secrets).

**La condition qui décide de la phase.** Le type de compte n'est pas négociable : un profil Amazon est `vendor`, `seller` ou `agency`, et un compte **`agency` n'ouvre que le DSP** — il ne peut pas acheter de Sponsored Products. Pour Sponsored Brands, un compte marchand doit en plus être inscrit au **Brand Registry**.

- [ ] **Trancher : y a-t-il, parmi les clients visés, des annonceurs qui vendent sur Amazon** (Seller Central ou Vendor Central, avec des ASIN actifs) ? Si non, le levier Amazon Search n'a pas d'utilisateur et la phase attend, quelle que soit la qualité de l'API.
- [ ] Si oui : identifier un annonceur pilote et obtenir l'accès à son compte publicitaire via un **manager account** en permission _Editor_ (la permission _Viewer_ renvoie 401 sur toute écriture).

**Il n'y a pas de sandbox.** Celui d'Amazon (`advertising-api-test.amazon.com`) a été coupé le 2022-06-28. Le remplacement, les **comptes de test** (`POST /testAccounts`, type `VENDOR` ou `AUTHOR`), ne diffuse aucune publicité : donc **aucune** donnée de performance — ni clics, ni impressions, ni dépense.

- [ ] Créer un **compte utilisateur Amazon neuf** (une adresse mail à laquelle on a accès, qui ne gère aucun compte Amazon Ads) pour y créer les comptes de test. Me donner l'adresse, pas le mot de passe.
- [ ] Prévoir un **budget de dépense réelle** sur le compte de l'annonceur pilote : deux des huit preuves de fin de phase (lire le verdict de validation d'une annonce, lire un rapport) sont impossibles autrement (**F8**).

**Amazon DSP**, séparément :

- [ ] **Amazon DSP** (`amazon_dsp`, leviers Audio et CTV & TVS) : accès API Amazon DSP, qui est rarement ouvert sans accord commercial. Vérifier si c'est accessible à Omnilor. À noter : la nouvelle API unifiée couvre aussi la gestion de campagnes DSP, ce qui n'était pas le cas avant — l'accès reste la question, pas l'API.
- [ ] Surveiller **Amazon Retail Ad Service** (publicité sur les sites d'autres distributeurs, même API) : **États-Unis uniquement** aujourd'hui. À reprendre si ça ouvre en Europe (**F4**).

## 7. DV360

- [ ] Accès à un **partenaire DV360** (le DV360 de MBP passait par Azerion : il faut le nôtre).
- [ ] Activer la Display & Video 360 API sur un projet Google Cloud (le même que Google Ads, ou un dédié).
- [ ] Compte de service autorisé sur le partenaire, et au moins un advertiser de test.
- [ ] Vérifier les conditions d'accès : DV360 n'est pas en libre-service, il faut un contrat.

## 8. Meta, TikTok, Snap — levier Social

Pour chacune, il faut un compte business, une application, et une revue de l'application par la plateforme avant d'avoir les permissions de gestion de campagnes. Les démarches exactes seront précisées au moment de l'étude de chaque plateforme.

- [ ] **Meta** : Business Manager, application Meta for Developers, demande des permissions `ads_management`, compte publicitaire de test.
- [ ] **TikTok** : TikTok Business Center, application TikTok for Business, accès API Marketing. La revue de l'app développeur est annoncée à **2 à 3 jours ouvrés** ; un développeur peut avoir 5 apps au maximum. Pendant qu'on y est, créer un **compte publicitaire de sandbox** (`sandbox-ads.tiktok.com`) en choisissant son pays, sa devise et son fuseau — ça sert aussi au levier Search.
- [ ] **Snap** : Snap Business Manager, application, accès Marketing API.
- [ ] Me confirmer, pour chacune, si Omnilor a déjà un compte business ou s'il faut en créer un.

## 8b. Pinterest — leviers Search et Social

**Verdict de l'étude : « on intègre, en premier des trois »** (`backend/docs/plateformes/faisabilite-search.md` § 5). C'est la seule des trois nouvelles plateformes qui ne dépend de personne : accès entièrement libre-service, aucune allowlist, aucun interlocuteur commercial, un vrai sandbox, et un contrat OpenAPI public. Rien à négocier — seulement des comptes à ouvrir.

- [ ] Créer (ou me confirmer l'existence d') un **compte Pinterest business** pour Omnilor.
- [ ] Créer une **app** sur `developers.pinterest.com`. L'approbation donne le palier **Trial**, qui autorise déjà la lecture **et l'écriture** de publicités : seuls les Pins et boards créés restent invisibles des autres. Limites Trial : 1 000 requêtes/jour par app, dont **300/jour** en écriture publicitaire — assez pour développer.
- [ ] Me donner le `client_id` de l'app (non secret) ; le secret va dans `backend/.env`.
- [ ] Générer un **jeton de sandbox** (_My Apps_ → _Manage_ → _Configure_ → _Generate Access Token_ → _Sandbox_). Il dure **30 jours**, donc il faudra le régénérer — ou passer par le flux OAuth sur l'hôte `api-sandbox` pour pouvoir le rafraîchir.
- [ ] Prévoir la **démonstration vidéo** exigée pour passer en **Standard access** (400 écritures/minute au lieu de 300/jour). Elle doit montrer notre application réalisant une action réelle via l'API, **flux OAuth inclus** ; un enregistrement de terminal est accepté. Ce n'est pas une formalité : les refus listés par Pinterest portent précisément sur l'absence du flux d'authentification. À faire quand l'adapter marche, pas avant.
- [ ] Pour prouver l'**accès agence** (API _Business Access_, le pendant de nos liens Google/Microsoft) : il faut un **compte client réel**, c'est la seule chose que le sandbox ne sait pas simuler. Identifier un annonceur pilote.
- [ ] Me dire si un annonceur pilote a déjà un compte Pinterest business **avec des Pins** : la créa Pinterest **est** un Pin organique, qui doit exister avant d'être promu (**F15**).

## 8c. TikTok Search Ads — la demande d'allowlist

**Verdict de l'étude : « on reporte, à rattacher à la phase Social »** (`backend/docs/plateformes/faisabilite-search.md` § 4). L'API est libre-service, mais **l'inventaire search est sur allowlist**, et il y a **une allowlist par objectif de campagne**. Le délai n'est pas de notre ressort, donc la demande part maintenant : elle ne coûte rien, et si elle arrive pendant la phase Social l'adapter search suit immédiatement.

- [ ] **Identifier un interlocuteur commercial TikTok** (« your TikTok representative » — c'est le terme de la documentation ; sans lui, rien n'est possible).
- [ ] Lui demander l'allowlist **`is_search_campaign`**, en précisant **les objectifs** voulus : `WEB_CONVERSIONS` et `TRAFFIC` sont ouverts en France, `LEAD_GENERATION` est annoncé **États-Unis uniquement**. Obtenir un objectif ne donne pas les autres.
- [ ] En profiter pour demander les deux autres allowlists, moins importantes : **mots-clés automatisés** (`automated_keywords_enabled`) et **filtre d'inventaire** de brand safety.
- [ ] Lui faire **confirmer la disponibilité de la France par objectif** : la liste vient du centre d'aide (« last updated April 2026 »), pas de l'API.
- [ ] Lui poser la question de la **dépréciation du 1er janvier 2027** du flux manuel pour les objectifs non-Search : je ne l'ai retrouvée ni dans la référence de `/campaign/create/` ni dans la page des versions, alors qu'elle circule. Si le flux manuel **search** est menacé lui aussi, il faut viser le flux Smart+ d'emblée (**F13**).
- [ ] Question à 10 minutes, dès que l'app développeur existe, et qui peut faire gagner des semaines : **l'allowlist s'applique-t-elle en sandbox ?** Si non, l'adapter search s'écrit et se teste avant de l'avoir obtenue (**F12**).

## 9. Google Ad Manager — ~~à obtenir~~ **sans objet**

**GAM est retiré du périmètre** le 2026-10-25 (D50 / L26) : c'est le serveur publicitaire d'un éditeur, pas un DSP, et Omnipotent n'est pas éditeur. Plus rien à obtenir ici. Si GAM revient un jour, il faudra l'accès à un réseau, l'API activée et un compte de service autorisé dessus.

## 10. AWS — Terraform d'Omnipotent

Décision prise : **même compte AWS** que multi-search (le compte Omnilor partagé), un **Terraform séparé** pour Omnipotent, et multi-search sera coupé dans un second temps.

Le Terraform existe : `infra/` reprend les modules de multi-search, sans son module `frontend` (Omnipotent n'a pas de front). `terraform validate`, `terraform fmt` et les 40 tests hors-ligne (`terraform test`, fournisseurs simulés) passent. Rien n'a été appliqué sur AWS.

- [x] Région : **`eu-north-1`** (Stockholm), comme multi-search.
- [x] Découpage : un `infra/` propre à Omnipotent, Terraform séparé.
- [x] Base : Omnipotent prend sa **propre instance RDS**.
- [ ] **Le bucket d'état Terraform.** J'ai supposé un **nouveau bucket**, `omnipotent-tfstate-<id du compte>`, créé par `infra/bootstrap` comme chez multi-search (`infra/envs/*/versions.tf`). Dis-moi si tu préfères un préfixe dans celui de multi-search : c'est une ligne à changer dans les deux `versions.tf`.
- [ ] GitHub : créer les variables de dépôt `AWS_DEPLOY_ROLE_ARN` et `AWS_REGION` de l'environnement `production`, et régler le modèle de sujet OIDC (la commande `gh` est dans `infra/README.md`, étape 5). Le dépôt est `MultiSearchAd/omnipotent` (variable `github_repository`).
- [ ] **Monter le nouveau tenant Auth0** — l'API REST faite et vérifiée le 2026-10-27 vivait sur l'**ancien** tenant, et **ne vaut plus** : Lorin en a créé un nouveau le 2026-11-14, où tout le monde déménage. Les trois valeurs que cette ligne enregistrait (le domaine `dev-3rwjfrn4yf3tar80…`, le `client_id` de l'application navigateur et celui du compte machine partagé) sont **retirées** plutôt que corrigées : une valeur morte se recopie sans qu'on se demande d'où elle vient. À refaire, clic par clic : [`docs/runbook-acces.md`](docs/runbook-acces.md) § A2 — l'application navigateur `Omnilor Web`, les trois API, le `User-delegated access` de chacune, et le compte machine. **Ce qui me parvient ensuite** : le domaine du tenant et les deux `client_id`, non secrets.
- [ ] **L'API MCP, une par environnement** — au déploiement, pas avant : son identifiant doit être **l'URL exacte** du `/mcp` servi (`terraform output mcp_url`), RS256, _Allow Offline Access_, permission `mcp:use`, et l'application navigateur ajoutée dans son `User-delegated access`. **Attention au plafond** : un tenant gratuit est limité à **10 API (Resource Servers)**, Management API comprise, et multi-search, omnipass et Omniscient les saturent avec leurs API MCP par environnement — la création a déjà été refusée une fois le 2026-10-27. Les sorties sont dans [`docs/runbook-acces.md`](docs/runbook-acces.md) § A2 : libérer les places mortes, ou passer le tenant à Essentials. L'application **refuse de démarrer** si l'identifiant MCP est vide ou égal à l'audience REST. Pour mémoire, dans le tenant partagé avec multi-search (D42) : une pour l'API REST (son identifiant va dans `auth0_audience`) et **une par environnement** pour le serveur MCP, dont l'identifiant doit être **exactement** l'URL `/mcp` servie (`terraform output mcp_url`) — omnipass l'a appris en mettant la sienne en service. RS256, _Allow Offline Access_, permission `mcp:use`, et l'application navigateur ajoutée dans `User-delegated access` de chacune, sans quoi Auth0 refuse avant la page de connexion. L'application **refuse de démarrer** si les deux identifiants sont égaux. Le reste se réutilise tel quel chez multi-search (tenant, Action post-login, SPA, application Native des connecteurs Claude) : clic par clic dans [`docs/runbook-acces.md`](docs/runbook-acces.md) § A2, avec la raison pour laquelle une audience, elle, ne se partage pas.
- [x] ~~Deux noms à trancher, qui bloquent l'API MCP~~ — **tranchés le 2026-10-27 (D52)** : nom d'hôte de production **`omnipotent.omnilor.com`** (l'étiquette `api` est celle de multi-search) et port local **3002** (3000 reste à multi-search et à omnipass, et un identifiant d'API est unique dans le tenant partagé). Posés dans `backend/config`, `backend/.env.example`, `backend/Dockerfile`, `infra/envs/prod`, et les 29 + 11 tests hors-ligne Terraform repassent. **Les identifiants des trois API à créer sont donc connus** : [`docs/runbook-acces.md`](docs/runbook-acces.md) § A2, pas à pas.
- [ ] Facultatif : l'application **Native** Auth0 pour les connecteurs Claude (son client id va dans `mcp_claude_client_id`).
- [ ] **L'Action post-login du tenant** — toujours **chez omnipass**, mais elle redevient bloquante : un tenant neuf n'en a pas, et sans elle **aucune première connexion n'aboutit**, pour aucun produit. C'est le premier point du message prêt à transmettre, [`docs/message-a-omnipass-tenant.md`](docs/message-a-omnipass-tenant.md).
- [x] ~~**Un jeton GitHub avec `read:packages`**, posé dans `~/.npmrc`~~ — **fait le 2026-10-27**, et le paquet est installé : `pnpm add` le récupère, l'image le récupère aussi (vérifié par un vrai `docker build`, le jeton passant par un secret BuildKit qui n'est dans aucune couche). **Il reste un clic** : autoriser le dépôt `omnipotent` à lire le paquet (runbook § A1b), sans quoi la CI échouera à l'installation — elle utilise le jeton du workflow, qui n'a accès qu'aux paquets qu'on lui ouvre. Pour mémoire — **jamais** dans le dépôt ni dans le chat. C'est ce qui bloque aujourd'hui, et c'est tout ce qui bloque : le client d'omnipass est publié (`@multisearchad/omnipass-client@0.1.1`, tag `client-v0.1.1`) sur GitHub Packages, qui exige un jeton en lecture. Le jeton de ta session `gh` porte `repo` et `read:org` mais pas `read:packages` : le registre répond 403, donc `pnpm install` ne récupère pas le paquet. Forme attendue dans `~/.npmrc` : `//npm.pkg.github.com/:_authToken=<le jeton>`. **Il faut un jeton « classic »** : vérifié le 2026-10-27, un jeton _fine-grained_ (`github_pat_…`) est refusé par ce registre (`403 permission_denied: The token provided does not match expected scopes`), et la documentation de GitHub ne promet que les jetons classic pour npm.
- [ ] **Le compte machine Auth0 vers omnipass** — à recréer sur le nouveau tenant, et le budget d'applications étant neuf, une **déduction à valider** : je propose un compte machine **propre à Omnipotent** plutôt que le compte partagé d'avant, pour que son `client_id` nomme l'appelant dans les journaux d'omnipass et qu'une rotation de secret n'affecte qu'un produit. La conception d'omnipass accepte les deux, puisqu'elle s'appuie sur l'audience signée du jeton relayé, pas sur l'identité du compte. Son `client_id` n'est pas secret et peut m'être donné ; son secret va dans le magasin, sous `omnipass/client-secret`.
- [ ] **Donner à omnipass les audiences et l'URL de base d'Omnipotent** (point 5 de `~/OmniAd/omnipass/A-FAIRE.md`). Sans cette déclaration, omnipass refuse un jeton relayé dont l'`aud` ne lui est pas déclaré — c'est ce qui empêche une application de relayer le jeton d'une autre. **Nécessaire pour que l'environnement de test d'Omnipotent parle à un vrai omnipass**, ce qu'omnipass a accepté comme premier consommateur réel.
- [ ] **Un secret à poser après l'apply** : `omnipotent/prod/omnipass/client-secret`, le secret du compte machine ci-dessus. C'est le premier conteneur qu'une phase déclare ; les suivantes ajouteront les leurs, et leur valeur se pose toujours à la main, jamais par Terraform.
- [x] ~~Prévoir un troisième déploiement pour **omnipass**, avec sa propre instance RDS.~~ — **retiré de notre liste le 2026-10-27** : c'est l'infrastructure d'omnipass, elle vit dans son dépôt et dans son propre `A-FAIRE.md`. Rien à faire ici, et rien que j'attende de ce côté.

**Conséquence de D43, à connaître avant de déployer** : avec `NODE_ENV=prod`, le backend refuse de démarrer tant que les droits ne viennent pas d'omnipass. Une mise en production est donc impossible avant omnipass, **par construction** — c'est voulu. L'environnement de **test** (compte jetable, aucune donnée réelle) tourne en `NODE_ENV=dev` avec l'implémentation locale (`infra/envs/test/test_override.tf`) : il est déployable tout de suite.

## 11. Études de plateformes — faite

- [x] **Faite le 2026-10-25** : `backend/docs/plateformes/faisabilite-search.md`. Les trois questions sont tranchées.

| Plateforme               | Verdict                                                              | Rang    | Levier(s)                                               |
| ------------------------ | -------------------------------------------------------------------- | ------- | ------------------------------------------------------- |
| **Pinterest**            | ✅ on intègre                                                        | **1er** | `search` **et** `social`, séparés par `placement_group` |
| **Amazon retail search** | ✅ on intègre, **sous condition** d'un annonceur qui vend sur Amazon | **2e**  | `search`                                                |
| **TikTok Search Ads**    | ⏸️ on reporte, à rattacher à la **phase Social**                     | 3e      | `search` (en plus de `social`)                          |

Réponses aux trois questions qui étaient posées :

- **Amazon retail search** : Sponsored Products et Sponsored Brands nous intéressent ; API libre-service sur candidature Partner ; 22 marketplaces, France incluse ; **mais** l'annonceur doit vendre sur Amazon, et il n'y a aucun sandbox.
- **TikTok Search Ads** : **oui**, l'inventaire search existe en API et il est bien séparé des campagnes feed — `is_search_campaign` sur la campagne, mots-clés sur l'ad group. Donc TikTok sera présent sur `social` **et** `search`. Mais c'est sur allowlist, par objectif.
- **Pinterest** : **les deux leviers**, et l'API rend la séparation explicite (`placement_group` ∈ `ALL`, `SEARCH`, `BROWSE`, `OTHER`, au niveau campagne et ad group). Mots-clés en `BROAD`, `PHRASE`, `EXACT` plus deux types d'exclusion, à l'ad group.

Ce qu'il te reste à faire est remonté dans les sections **6** (Amazon), **8b** (Pinterest) et **8c** (TikTok).

**Et ce qui ne concerne pas les comptes mais le cadrage** : l'étude a fait remonter **16 déductions numérotées F1→F16** à valider (§ 7 du document). Aucune ne contredit `CADRAGE.md`.

À noter : **F11** — le registre de capacités doit être clé sur `(plateforme, levier)` — est **la même conclusion que la décision L2** du cadrage des leviers, mené en parallèle le même jour. Les deux études y sont arrivées séparément, par des chemins différents. Il n'y a donc qu'une décision à prendre, pas deux, et elle est plus solide qu'elle n'y paraîtrait.

Celles qui demandent vraiment ton arbitrage : **F1** (découper les marques de provenance), **F2** (accepter que Sponsored Products diffuse aussi sur les pages produit sous le levier `search`), **F5** (écarter les campagnes Amazon multi-marketplaces, qui porteraient plusieurs devises), **F8** (budgeter de la dépense réelle sur Amazon) et **F14** (Pinterest sur deux leviers, l'enum passant à treize plateformes).

## 12. Étude : transverse ou propre à un levier

✅ **Menée.** Le document de référence est **`backend/docs/leviers.md`** : les six fiches de levier, la grille des 14 fonctionnalités remplie, 18 manques du modèle (G1→G18) et **24 décisions à valider (L1→L24)**.

Tes intuitions de départ sont confirmées sur six lignes sur sept. Les deux résultats qui ne l'étaient pas : la **courbe de budget journalière tient sur les six leviers** (Hawk accepte un budget du jour, DV360 des segments de budget), et le **capping n'est pas « à avertir » mais `interdit` en Search**, aucune de ses cinq plateformes ne l'exprimant.

- [ ] **Valider les 24 décisions L1→L24** de `backend/docs/leviers.md` § 5.
- [x] **L1→L24 validées** le 2026-10-25, ainsi que les quatre questions produit : **toujours en argent** avec une saisie possible en volume (L25 / D49), **GAM retiré** (L26 / D50), **`amazon_dsp` retiré d'`audio`** (L27 / D51), **Omniscient hors périmètre** (L28). `CADRAGE.md` est à jour.
- [ ] Reste une correction à porter dans `CADRAGE.md` : **§ 7**, la table de projection n'a pas de colonne pour Meta, TikTok et Snap — donc pas de place déclarée pour l'objectif de L4. La proposition est dans `backend/docs/leviers.md` G16.

## 13. Reporting et capacités — une étude par plateforme

Les plateformes ne remontent **pas** les mêmes informations, ni à la même fraîcheur, ni par le même mécanisme. Constat corrigé le 2026-10-25, après lecture du code : les 4 plateformes Search de multi-search ont un pull qui tourne, et le **`reporting-worker` de MBP porte bien son code de domaine** — 191 fichiers, un fait canonique et huit adapters de reporting, Meta, TikTok et Snap compris. **Il existe donc une référence lisible pour dix de nos onze plateformes** ; seule Amazon Search n'a rien. _(La version précédente de cette section affirmait l'inverse, sur la foi du README de `mbp-api`, qui est périmé.)_

Le cadrage complet d'une plateforme est dans **`docs/cadrage-plateforme.md`** (projection, ciblage, créas, enchères, reporting, quotas, idempotence, authentification). Dans sa phase, à constater sur un compte réel et à m'écrire :

- [ ] Quelles **métriques** elle remonte (impressions, clics, coût, conversions, valeur, métriques vidéo/audio, métriques propres).
- [ ] Quelle **définition du coût** : coût média, coût total, frais séparés. Lequel l'annonceur paie-t-il réellement.
- [ ] À quelle **granularité** : campagne, ad group, créa, mot-clé, autre.
- [ ] En **synchrone** ou en **asynchrone** (créer un rapport, poller, télécharger).
- [ ] Quelle **fraîcheur** réelle, et au bout de combien de temps les chiffres d'une heure donnée sont stables.
- [ ] Quelle **fenêtre de restatement** des conversions (combien de jours en arrière les chiffres bougent encore).
- [ ] Quel **fuseau horaire** le rapport utilise, et dans quelle **devise**.
- [ ] Quelles **limites de quota** s'appliquent aux appels de reporting, séparément de celles des écritures.

Et, tant qu'on y est sur un compte réel, deux relevés qui ne concernent pas le reporting mais la même étude :

- [ ] Quels **couples `(format, subtype)` de créa** la plateforme accepte : image, HTML5, tag script tiers, MRAID, fichier vidéo, VAST en redirection, VAST audio, native. Et si elle plafonne la profondeur de redirection d'un VAST.
- [ ] À quels niveaux de **notre** arbre la plateforme peut tenir un **budget** et une **période** — c'est ce qui détermine sa projection et les éclatements.

Et sept relevés que le cadrage des leviers a fait remonter (`backend/docs/leviers.md` § 6) — trois cases de sa grille en dépendent :

- [ ] **Hawk, DV360, Amazon DSP** : acceptent-ils un événement de conversion envoyé par un navigateur, et savent-ils l'attribuer à une exposition **audio** ou **CTV** (attribution post-vue) ?
- [ ] **Hawk** : comment mesure-t-il sa `conversion` et sa `visit` — panel de mobilité, pixel, postback ? Existe-t-il une déclaration d'objectif de conversion côté Hawk ?
- [ ] **Hawk, décisif pour le DOOH, et le plus urgent des six** : lequel de ses référentiels **liste des écrans** — `tagId` (placements), `supplyIds`, `appSiteName`, geohash ? Omniscient étant hors périmètre (L28), c'est le **seul** chemin vers l'inventaire DOOH. MBP a une route de découverte pour chacun des quatre, donc la réponse tient en un appel sur un compte réel.
- [x] ~~**Google** : le capping est-il bien réservé aux campagnes Display et Vidéo, à l'exclusion du Search ?~~ — **répondu** : il n'existe aucun champ de capping sur une campagne `SEARCH`, et multi-search n'en déclare aucun pour Google. Conformément à CADRAGE § 10, on **avertit dans la preview**, on ne refuse pas (`backend/docs/plateformes/google-ads.md` § 3).
- [ ] **Hawk** : dans quelle devise l'argent d'une Line est-il exprimé, et peut-on l'imposer ? Chez Hawk l'argent est **par Line**, pas par compte — ce qui change la portée du taux figé de D22.
- [ ] **Meta, TikTok, Snap** : quels objectifs ouvrent l'enchère sur conversion, et lesquels sont immuables après création ?

Point produit qui en découle : **aucun écran ne doit annoncer du « temps réel »**. Un agrégat multi-plateformes mélange des chiffres arrêtés à des heures différentes. L'API expose la fraîcheur par plateforme (`statsReadAt`) et le front l'affiche.

## 14. GitHub

- [x] Dépôt privé `git@github.com:MultiSearchAd/omnipotent.git` créé (vide, branche `main`).
- [x] Dépôt privé `git@github.com:MultiSearchAd/omnipass.git` créé (vide, branche `master`).
- [ ] Renommer la branche d'`omnipass` en `main`.
- [ ] **Renommer la branche locale d'`omnipotent` en `main`** : la copie de travail est sur `master` et n'a encore aucun commit (`git branch -m master main`), alors que le dépôt distant est sur `main`.
- [ ] Facultatif : la variable de dépôt `DOCKERHUB_USERNAME` et le secret `DOCKERHUB_TOKEN`. Les runners GitHub ne sont pas soumis aux limites de Docker Hub pour les images publiques, donc ce n'est utile que sur un runner auto-hébergé ; sans eux la CI ne se connecte pas.
- [ ] Vérifier le plan GitHub de l'organisation `MultiSearchAd` : le plan gratuit ne permet pas de protéger l'environnement `production`, et on aura trois dépôts à déployer.

## 15. Juridique et conformité

À reprendre de multi-search, en l'étendant aux nouveaux leviers.

- [ ] Engagement « pas de publicité politique » dans les conditions d'utilisation (exigé par Google sur chaque campagne).
- [ ] Consentement des visiteurs pour le script de suivi, à étendre aux plateformes DSP.
- [ ] Nom de domaine neutre pour le script de suivi (point 9 du `A-FAIRE.md` de multi-search) : toujours à acheter ?
- [ ] Vérifier les obligations propres au **DOOH** (affichage en lieu public) et à la **CTV**, s'il y en a.
- [ ] **DSA** : Meta **refuse la création d'un ad set sur un compte européen** sans `dsa_beneficiary` (relevé dans le code de MBP). Il faut le **bénéficiaire** et le **payeur** de chaque annonceur européen — c'est une donnée à collecter auprès des clients, pas un champ technique. Décision de modèle associée : L22 de `backend/docs/leviers.md`.
- [x] ~~**Publicité politique** : décider si Omnipotent refuse tout court ou modélise les déclarations.~~ — **tranché le 2026-10-27 : c'est l'utilisateur qui déclare**, et **implémenté le même jour** (D53 : colonne et migration, champ obligatoire à la création, erreur de preview `preview_political_advertising_unsupported`, mapping Google documenté).** Le front le demande, donc le back doit le **recevoir** : la campagne porte un champ **obligatoire** à la création, et rien n'est deviné ni mis en constante. Tant que les déclarations que Hawk exige ne sont pas modélisées (six champs de commanditaire, origine des fonds à valeurs fermées), déclarer « oui » est **refusé** par un code stable plutôt que d'échouer chez la plateforme ; déclarer « non » envoie à Google son `DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING`, qui est obligatoire sur chaque campagne. Le champ étant obligatoire, il doit arriver **avant** qu'un front consomme l'API.
- [ ] Formaliser par écrit l'accord avec Azerion sur l'accès en lecture au code de MBP, pour qu'il ne repose pas sur un accord verbal.
