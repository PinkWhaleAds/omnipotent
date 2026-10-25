# Faisabilité — Amazon retail search, TikTok Search Ads, Pinterest

Trois études de faisabilité, produites par le cadrage `docs/cadrage-plateforme.md` **section 6** (« Les plateformes sans aucune référence »). Contrairement aux neuf autres plateformes, il n'y a ici rien à transcrire : tout est à établir.

Une précision, parce que le périmètre a bougé le jour même : ce qui n'existe nulle part, c'est **l'inventaire search** de ces trois plateformes. Pinterest est absente de bout en bout. Amazon Search est, d'après le cadrage des leviers, la **seule** des onze plateformes (D50) dont MBP ne porte aucune référence de reporting. TikTok, en revanche, existe déjà dans MBP comme plateforme sociale — dix use-cases et un adapter de reporting — et c'est un argument qui pèse dans son verdict (§ 4.6).

Écrit le **2026-10-25**. Aucun compte n'existe sur ces trois plateformes : **aucune affirmation de ce document n'a été constatée sur un compte réel.** C'est la limite principale à garder en tête.

Ce document s'arrête à la décision. Il ne cadre pas les adapters : si une plateforme est retenue, elle reçoit son propre `backend/docs/plateformes/<plateforme>.md` au début de sa phase, selon les sections 3 et 4 du cadrage.

Les déductions et les décisions qui attendent une validation sont numérotées **F1** à **F16** en section 7.

---

## 1. Méthode et marques de provenance

Le cadrage demande que chaque affirmation soit datée et marquée de sa provenance, avec trois marques : « constaté sur notre compte », « transcrit de MBP », « d'après la documentation ». Aucune des trois ne s'applique vraiment ici — il n'y a pas de compte, il n'y a pas de MBP, et « d'après la documentation » mélange des sources de fiabilité très différentes. Les documentations commerciales sont en retard sur les API ; les contrats machine ne le sont pas.

J'ai donc découpé « d'après la documentation » en trois marques (**F1**, à valider) :

| Marque         | Ce que c'est                                                                                                                                              | Fiabilité                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **`[spec]`**   | Le contrat lisible par une machine : spec OpenAPI publiée, référence d'enums officielle, page de référence d'un endpoint. C'est **ce que l'API accepte**. | La plus haute hors compte réel                                                              |
| **`[doc]`**    | La documentation développeur en prose : guides, onboarding, pages de concepts.                                                                            | Haute, mais parfois en retard sur `[spec]`                                                  |
| **`[pub]`**    | La documentation commerciale : centre d'aide, articles produit, annonces.                                                                                 | **La plus basse** — souvent en avance sur le marketing et en retard sur l'API, ou l'inverse |
| **`[compte]`** | Constaté sur un de nos comptes.                                                                                                                           | Définitive — **aucune occurrence dans ce document**                                         |

Un fait marqué `[pub]` et contredit par `[spec]` : c'est `[spec]` qui gagne, et le désaccord s'écrit.

**Les sources, et comment elles ont été lues** — les trois portails de documentation sont des applications JavaScript qu'un simple téléchargement de page ne rend pas. Les trois servent en réalité leur contenu sous une forme exploitable, ce qui a permis de lire les sources primaires plutôt que des blogs tiers :

| Plateforme | Source primaire                                                                                                            | Datée du                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Amazon     | Index de contenu complet du centre de documentation (`d254z25g5bhk3u.cloudfront.net/en-us/searchIndex.json`, 18 Mo)        | consulté le 2026-10-25                                                                     |
| Amazon     | Specs OpenAPI de l'API unifiée + référence d'enums, dépôt officiel `amzn/ads-advanced-tools-docs`                          | dernier commit 2026-09-30 ; enums extraits par Amazon le 2026-07-14                        |
| TikTok     | API de contenu de la documentation (`business-api.tiktok.com/gateway/api/doc/client/node/get/v2/`), Marketing API **v1.3** | consulté le 2026-10-25                                                                     |
| TikTok     | Centre d'aide, page de disponibilité de Search Ads Campaign                                                                | « last updated April 2026 », consulté le 2026-10-25                                        |
| Pinterest  | Spec OpenAPI officielle **v5.28.0**, dépôt `pinterest/api-description`                                                     | dernier commit 2026-06-04                                                                  |
| Pinterest  | Pages développeur : paliers d'accès, limites de débit, sandbox                                                             | consultées le 2026-10-25 ; liste d'endpoints du sandbox « last updated September 8, 2026 » |

Les trois blogs tiers consultés en premier se sont révélés **faux sur au moins un point décisif chacun** : l'un affirme qu'Amazon n'a pas de sandbox et que c'est l'unique palier d'accès (la vérité est plus précise, et plus gênante), un autre décrit un sandbox Amazon qui a été coupé en 2022. Ils ne sont pas cités.

---

## 2. Les trois verdicts, en une page

|                             | **Pinterest**                         | **Amazon retail search**                                                  | **TikTok Search Ads**                               |
| --------------------------- | ------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------- |
| **Verdict**                 | ✅ **On intègre**                     | ✅ **On intègre**, sous condition                                         | ⏸️ **On reporte**                                   |
| **Rang**                    | **1er**                               | **2e**                                                                    | **3e**                                              |
| Levier(s)                   | `search` **et** `social`              | `search`                                                                  | `search` (et `social`, déjà prévu)                  |
| Accès à l'API               | Libre-service, 2 paliers              | Libre-service, sur candidature                                            | Libre-service                                       |
| Accès à l'inventaire search | **Libre**                             | **Libre**, mais l'annonceur doit vendre sur Amazon                        | **Allowlist, par objectif**                         |
| Faut-il négocier ?          | Non                                   | Non pour l'API ; oui, commercialement, pour avoir des annonceurs vendeurs | **Oui — un interlocuteur TikTok**                   |
| Sandbox                     | ✅ Vrai sandbox, couvre les mots-clés | ❌ **Aucun** — comptes de test sans diffusion                             | ✅ Sandbox avec données simulées                    |
| Prouvable sans dépense ?    | ✅ Oui, sauf l'accès agence           | ❌ **Non** — zéro donnée de performance hors diffusion réelle             | ⚠️ Partiellement                                    |
| France / EUR                | ✅ Oui                                | ✅ Oui (FR, marketplace EU)                                               | ✅ Oui (Web conversions, Traffic)                   |
| Ajustement à notre modèle   | **Bon**                               | **Bon**                                                                   | **Mauvais** — budget et mots-clés sur le même objet |

**Pinterest d'abord** parce que c'est la seule des trois qu'on peut prouver de bout en bout sans dépenser un euro et sans dépendre de personne : accès libre-service, sandbox qui couvre les mots-clés, contrat OpenAPI public, et un `placement_group` qui sépare explicitement l'inventaire search de l'inventaire browse — donc le levier reste l'inventaire sans contorsion.

**Amazon ensuite**, parce que l'API est de loin la plus riche des trois et que son arbre se projette proprement sur le nôtre, mais que deux obstacles la rendent chère à prouver : l'annonceur doit vendre sur Amazon (compte vendeur ou marchand — un compte d'agence ne peut pas acheter de Sponsored Products), et il n'existe aucun moyen d'obtenir le moindre chiffre de performance sans diffusion payante réelle.

**TikTok en dernier**, non pas par difficulté technique mais parce que l'inventaire est derrière une allowlist dont nous ne contrôlons pas le délai, et parce que la forme de ses campagnes search s'ajuste mal à notre arbre. Le bon moment pour la reprendre est la **phase Social** : même compte, mêmes credentials, même client HTTP — le coût marginal sera faible, et l'allowlist aura eu le temps d'arriver.

---

## 3. Amazon retail search

### 3.1 Les produits publicitaires

L'API Amazon Ads couvre bien plus que le search. Les familles accessibles, lues dans l'arborescence du centre de documentation `[doc, 2026-10-25]` :

| Produit                     | Inventaire                                                     | Nous intéresse ?                                          |
| --------------------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| **Sponsored Products** (SP) | Résultats de recherche Amazon **et** pages produit             | ✅ **Oui** — le cœur du levier                            |
| **Sponsored Brands** (SB)   | Haut des résultats de recherche, page d'accueil, pages produit | ✅ **Oui** — second format du levier                      |
| **Sponsored Display** (SD)  | Audiences et contextuel, sur et hors Amazon                    | ❌ Non — pas du search                                    |
| **Sponsored TV**            | CTV                                                            | ❌ Non — relève de `ctv_tvs`                              |
| **Amazon DSP**              | Programmatique                                                 | ❌ Non — c'est la plateforme `amazon_dsp`, déjà distincte |
| **Retail Ad Service** (RAS) | Sites et applis **d'autres distributeurs**                     | ⚠️ Pas maintenant — voir § 3.7                            |

Autour, et hors périmètre de cette étude : Amazon Marketing Cloud, Amazon Marketing Stream, Amazon Attribution, Ads Data Manager, Brand Store, Portfolios, Deal Management, Media Planning, Exports.

L'**API unifiée** `/adsApi/v1/` rassemble SP, SB et SD derrière un champ `adProduct` dont l'enum officielle ne contient que trois valeurs : `SPONSORED_PRODUCTS`, `SPONSORED_BRANDS`, `SPONSORED_DISPLAY` `[spec, extrait par Amazon le 2026-07-14]`. Elle expose 19 endpoints pour SP et 31 pour SB, tous en `POST`, sur le motif `/adsApi/v1/{create|query|update|delete}/{campaigns|adGroups|ads|targets|adExtensions}` `[spec, 2026-09-30]`.

Les anciennes API **ne sont pas mortes** : SP v3 et SB v4 restent la seule voie pour les règles de budget, les recommandations de budget, l'usage du budget, les règles d'optimisation, les recommandations de mots-clés, de produits, de catégories et d'enchères, les catégories ciblables et les raffinements de catégorie `[spec, 2026-09-30]`. Un adapter Amazon devra donc parler **deux API** : l'unifiée pour le CRUD, l'ancienne pour tout ce qui ressemble à un conseil. Ça vaut d'être dit maintenant : c'est un coût d'intégration qu'on ne devine pas.

### 3.2 Le levier, et une impureté à assumer

**`search`**, sans ambiguïté sur la famille. Mais l'enum `placement` de SP contient `TOP_OF_SEARCH`, `REST_OF_SEARCH` **et** `PRODUCT_PAGE` `[spec, 2026-07-14]`, et le seul réglage offert est un **ajustement d'enchère en pourcentage par placement** (`optimizations.bidSettings.bidAdjustments.placementBidAdjustments`) `[spec, 2026-09-30]`.

Une campagne Sponsored Products n'est donc **pas un inventaire purement search** : elle diffuse aussi sur les pages produit, et l'API n'offre aucun moyen de l'exclure — un ajustement est un pourcentage additif, pas une exclusion. C'est un cas où notre règle « le levier est l'inventaire » se heurte à la plateforme (**F2**).

### 3.3 L'accès à l'API — libre-service, mais sur candidature

Pas d'accord commercial. Trois étapes `[doc, 2026-10-25]` :

1. **Créer une application Login with Amazon (LwA)**, après inscription sur `developer.amazon.com`. Gratuit, aucune approbation. Elle donne le `client_id` et le `client_secret`.
2. **Candidater à l'accès à l'API.** Le formulaire porte « des questions sur la façon dont votre entreprise entend utiliser l'API Amazon Ads, ainsi que des informations sur l'**Amazon Ads API License Agreement** et la **Data Protection Policy** ». Deux voies, selon ce qu'on est :
   - **Partner** — « les entreprises qui construisent des applications et des solutions logicielles pour automatiser et optimiser la publicité **pour le compte d'autrui** ». La candidature passe par l'**Amazon Ads Partner Network**, après inscription : console → _API Applications_ → _Request API Access_.
   - **Direct Advertiser** — les annonceurs qui automatisent leur propre publicité.
3. **Assigner l'accès à l'application LwA.** On reçoit alors deux scopes : `advertising::campaign_management` (presque tous les appels) et `advertising::test:create_account` (création de comptes de test).

**Omnipotent est un Partner**, pas un annonceur direct : c'est la voie _Amazon Ads Partner Network_ (**F3**). Délai annoncé : « la revue de votre candidature peut prendre jusqu'à **1 jour ouvré** » `[doc, 2026-10-25]`. Pour la voie partenaire, une autre page donne 1 à 2 jours ouvrés pour l'inscription au Partner Network et « jusqu'à 48 heures » pour l'étape LwA `[doc, 2026-10-25]`.

Les jetons d'accès expirent en **60 minutes**, et se renouvellent par refresh token `[doc, 2026-10-25]`.

### 3.4 Le type de compte — la contrainte qui décide de tout

C'est le fait le plus important de cette étude, et il est explicite. Un **profil** représente « un compte annonceur dans une marketplace donnée », et son `accountInfo.type` ne prend que trois valeurs `[doc, 2026-10-25]` :

| `type`   | Produits accessibles                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| `vendor` | « Sponsored Products, Sponsored Brands, and Sponsored Display **only** »                                    |
| `seller` | Idem — et « pour Sponsored Brands et Sponsored Display, le compte **doit être inscrit au Brand Registry** » |
| `agency` | « **DSP and Data Provider APIs only** »                                                                     |

Conséquence, et elle n'est pas négociable : **l'annonceur doit vendre sur Amazon.** Un compte d'agence ne peut pas acheter de Sponsored Products — il n'ouvre que le DSP. Les clients d'Omnipotent qui voudront du levier Amazon Search devront avoir un compte **Seller Central** ou **Vendor Central** avec des ASIN actifs, et être au Brand Registry pour Sponsored Brands.

Le seul produit Amazon ouvert à un annonceur qui ne vend pas sur Amazon est **Sponsored Display**, qui a sa propre voie documentée (« advertise products or services not sold on Amazon ») `[doc, 2026-10-25]` — mais c'est du display, pas du search.

**Hiérarchie des comptes**, qui se projette bien sur notre modèle (§ 12 du `CADRAGE.md`) :

- Un **profil** = `(compte annonceur × marketplace)`. Le `profileId` voyage dans l'en-tête `Amazon-Advertising-API-Scope` et il est obligatoire, même pour un annonceur mono-marketplace — sans lui, 401 ou 400 `[doc, 2026-10-25]`.
- Un profil n'est visible que sur **l'hôte régional de sa marketplace** : un annonceur JP + SG interrogé sur l'hôte nord-américain reçoit `[]`, et un `profileId` hors région renvoie un 4XX `[doc, 2026-10-25]`.
- Les **manager accounts** (`POST /managerAccounts`, type `Advertiser` ou `Agency`) lient plusieurs comptes annonceurs, avec une permission **Editor** ou **Viewer** par compte lié ; Viewer lit et rapporte, et reçoit un 401 sur toute écriture. `GET /managerAccounts` liste jusqu'à 50 comptes liés par manager account. `GET /profiles` renvoie en plus tous les comptes qui ont donné la permission Editor à un manager account de l'utilisateur `[doc, 2026-10-25]`.

Autrement dit : `AdAccount` = le manager account (ce qui porte les credentials, avec son `scope`), `AdvertiserAdAccount.externalAdvertiserId` = le `profileId`, et la devise et le fuseau se lisent sur le profil (**F6**).

### 3.5 Pays et devises

Trois hôtes régionaux, **22 marketplaces** `[doc, 2026-10-25]` :

| Hôte                            | Région | Marketplaces                                                       |
| ------------------------------- | ------ | ------------------------------------------------------------------ |
| `advertising-api.amazon.com`    | NA     | US, CA, MX, BR                                                     |
| `advertising-api-eu.amazon.com` | EU     | UK, FR, IT, ES, DE, NL, AE, PL, TR, EG, SA, SE, BE, **IN**, **ZA** |
| `advertising-api-fe.amazon.com` | FE     | JP, AU, SG                                                         |

À noter : l'Inde et l'Afrique du Sud sont servies par l'hôte **européen**, ce qui est contre-intuitif et mérite d'être codé en table, pas déduit d'un code pays.

L'enum `currencyCode` compte **61 devises** `[spec, 2026-07-14]` — bien plus que les 22 marketplaces, parce qu'elle sert aussi la facturation et le DSP. Les devises des marketplaces search sont l'intersection utile : USD, CAD, MXN, BRL, GBP, EUR, PLN, TRY, SEK, AED, SAR, EGP, INR, ZAR, JPY, AUD, SGD.

**Les minimums et maximums d'enchère sont documentés par marketplace et par produit** `[doc, 2026-10-25]`, ce qui répond directement à la question « les minimums par devise » du cadrage. Extrait pour Sponsored Products :

| Marketplace            | Devise    | Enchère min / max (SP) |
| ---------------------- | --------- | ---------------------- |
| US                     | USD       | 0,02 / 1 000           |
| UK, DE, FR, ES, IT, NL | EUR / GBP | 0,02 / 1 000           |
| JP                     | JPY       | 2 / 100 000            |
| BR                     | BRL       | 0,07 / 3 700           |
| AE                     | AED       | 0,24 / 184             |
| SE                     | SEK       | 0,18 / 9 300           |
| AU                     | AUD       | 0,02 / 1 410           |

La même page porte des contraintes de budget par marketplace et des contraintes de caractères : nom de campagne **128 caractères pour un marchand, 116 pour un vendeur** — une asymétrie qu'on n'inventerait pas, et qui doit vivre dans le registre de capacités.

**SP Global Campaigns** permet une campagne unique sur plusieurs marketplaces, avec surcharges par pays (`marketplaceConfigurations[].overrides` sur `state`, `name`, dates, optimisations, tags) et expansion automatique (`autoScaleGlobalCampaign: AUTO | MANUAL`). 21 marketplaces supportés `[spec, 2026-09-30]`. C'est séduisant, et c'est un piège à notre échelle : notre Campaign porte **une** devise (§ 4 du `CADRAGE.md`), alors qu'une campagne globale porte un budget par marketplace donc par devise. **À écarter pour le premier adapter** (**F5**).

### 3.6 Le sandbox — il n'y en a pas, et c'est un problème

La réponse est nette, et elle contredit la moitié d'internet. Le sandbox d'Amazon Ads, `https://advertising-api-test.amazon.com`, est inscrit à la page des **dépréciations** : annoncé en **mai 2022**, coupé le **2022-06-28**, remplacement indiqué « See test accounts » `[doc, 2026-10-25]`.

Ce qui existe à la place, ce sont les **comptes de test** : `POST /testAccounts` avec un `countryCode`, un `accountType` (`VENDOR` ou `AUTHOR`) et un `vendorCode` optionnel ; `GET /testAccounts` suit la création. Ils demandent le scope `advertising::test:create_account` et un compte utilisateur Amazon **qui ne gère aucun compte Amazon Ads** — Amazon recommande d'en créer un neuf. `VENDOR` est supporté sur 20 marketplaces, `AUTHOR` sur 6 (US, UK, IT, ES, FR, DE) `[doc, 2026-10-25]`.

Et voici la limite, citée : les comptes de test « ne diffusent pas de publicité et n'ont pas de facturation active ». Par conséquent :

> « Les publicités sponsorisées créées dans des comptes de test ne seront pas diffusées auprès des acheteurs. En conséquence, **les données de performance liées aux campagnes créées avec des comptes de test ne seront pas disponibles**. Cela inclut, sans s'y limiter, les clics, les impressions, les ventes, l'ACOS et la dépense. »

L'Insights API n'est pas supportée ; l'API de factures répond mais sans données.

**Ce que ça coûte.** Sur les huit preuves exigées avant de clore une phase (§ 5 du cadrage), un compte de test permet d'en faire six : connecter un compte, créer une campagne complète, vérifier la preview, modifier en ciblé, vérifier le zéro-appel, provoquer une erreur. Il ne permet **pas** les deux dernières — lire un verdict de validation d'annonce, et lire un rapport dont les lignes se rattachent à nos entités. Or le reporting est précisément « le vrai trou » du projet. **Clore la phase Amazon Search demandera un compte vendeur réel et de la dépense réelle** (**F8**). C'est la raison principale pour laquelle Amazon passe après Pinterest.

### 3.7 Retail Ad Service — à surveiller, pas à intégrer

Amazon Retail Ad Service « permet aux annonceurs de construire des campagnes via Amazon Ads qui diffusent sur **les sites et applications d'autres distributeurs**. L'API suit un motif similaire à celui des campagnes Sponsored Products » `[doc, 2026-10-25]`. Un ad group porte un `retailerId` (« le catalogue produit qui contient les produits que vous voulez promouvoir »), une annonce porte un `retailerOfferId`, et Amazon construit une créa responsive à partir des détails de l'offre. Ciblage auto ou manuel, négatifs supportés.

Mais : « pour l'instant, l'API RAS ne supporte que les appels vers la région **Amérique du Nord** pour les annonceurs de la marketplace **États-Unis** » `[doc, 2026-10-25]`.

C'est un **inventaire distinct** — du retail media sur des distributeurs tiers, atteint par la même API et les mêmes credentials. Pas le levier Amazon Search, pas une treizième plateforme non plus. US seulement : hors périmètre aujourd'hui, à reprendre si ça ouvre en Europe (**F4**).

### 3.8 Projection, enchères, quotas

**Projection** (hypothèse, à confirmer en phase — **F6**) :

| Notre niveau   | Objet Amazon                                       | Budget ?                                                  | Période ?                                     | Capping ? |
| -------------- | -------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------- | --------- |
| Campaign       | —                                                  | —                                                         | —                                             | —         |
| Lever          | —                                                  | —                                                         | —                                             | —         |
| AdGroup        | **Campaign**                                       | ✅ `budgets[]`, `recurrenceTimePeriod: DAILY \| LIFETIME` | ✅ `startDateTime` / `endDateTime` (ISO 8601) | —         |
| TargetingGroup | **Ad group** (`bid: { bid }`, cibles)              | ❌                                                        | ❌                                            | —         |
| Line           | **Product ad** (`adType: PRODUCT_AD`, ASIN ou SKU) | ❌                                                        | ❌                                            | —         |

C'est exactement la forme Google / Microsoft de multi-search, et elle capte le gain annoncé en § 7 du `CADRAGE.md` : plusieurs ad groups Amazon sous un même budget. Les **portfolios** (`portfolioId`) offrent un regroupement optionnel au-dessus des campagnes, sans équivalent chez nous — à ignorer.

**Ciblage.** Un endpoint unique `/adsApi/v1/create/targets` avec un `targetType` (`AUTO`, `KEYWORD`, `PRODUCT`, `PRODUCT_CATEGORY`, `PRODUCT_AUDIENCE`, `PRODUCT_CATEGORY_AUDIENCE`, `AUDIENCE`) et un drapeau `negative` remplace les cinq endpoints de SP v3 `[spec, 2026-09-30]`. Les types de correspondance de mots-clés sont `BROAD`, `PHRASE`, `EXACT` `[spec, 2026-07-14]` — identiques aux nôtres, ce qui est une bonne nouvelle pour le mapping. Les négatifs existent au niveau ad group **et** campagne (champ `campaignId` au lieu d'`adGroupId`).

**Enchères.** `bidStrategy` ∈ `SALES_DOWN_ONLY`, `SALES` / `SALES_UP_AND_DOWN`, `NEW_TO_BRAND`, `RULE_BASED`, ou absent pour une enchère manuelle `[spec, 2026-07-14 et 2026-09-30]`. Facturation `CPC` ou `VCPM` (`costType`). Budget : un seul `budgetType` (`MONETARY`), récurrence `DAILY`, `LIFETIME` ou `OTHER`.

**Statuts.** À la création, `ENABLED` ou `PAUSED` seulement ; `ARCHIVED` en lecture. Le `PROPOSED` de v3 n'existe plus. La lecture renvoie un objet `status: { deliveryStatus, deliveryReasons[] }` où `deliveryStatus` ∈ `DELIVERING`, `NOT_DELIVERING`, `UNAVAILABLE`, avec un tableau de raisons — c'est plus riche que l'ancien `servingStatus` et ça se prête bien à notre remontée d'état `[spec, 2026-09-30]`.

**Quotas et limites** `[doc, 2026-10-25]` :

- Pas de quota fixe : « les limites de débit sont **dynamiques et fondées sur la charge du système** ». 429 + en-tête `Retry-After` en secondes. Backoff exponentiel recommandé.
- Les limites du reporting dépendent de la **taille de la file d'attente de génération de rapports**, par région, avec plusieurs paliers : plus la file est longue, plus la limite baisse. Recommandation explicite d'étaler les demandes de rapports dans la journée.
- Les opérations « list extended data » pèsent **5 fois** une opération standard. À n'appeler que si l'on a besoin du statut des entités.
- Pour lister beaucoup d'entités, Amazon renvoie vers les **Exports** plutôt que vers des milliers d'appels de liste.
- Tailles de lot : campagnes, ad groups et annonces **10** par création / mise à jour / suppression, 100 en lecture ; **cibles : 1 000** par écriture et 5 000 en lecture `[spec, 2026-09-30]`.
- Garanties P99 : CRUD synchrone **30 s** ; impression ou clic disponible via l'API en **12 h** ; invalidation d'impression ou clic **72 h** ; génération de rapport asynchrone **15 min**.

Les 12 h entre un clic et sa disponibilité sont à retenir pour le `statsReadAt` du reporting : Amazon n'est pas une plateforme temps réel, et notre modèle le sait déjà.

**En-têtes de l'API unifiée** : `Amazon-Ads-ClientId` (et non plus `Amazon-Advertising-API-ClientId`), `Content-Type: application/json`, tout en `POST`, `Amazon-Advertising-API-Scope` devenu optionnel, `Amazon-Ads-AccountId` ajouté — obligatoire pour les campagnes globales `[spec, 2026-09-30]`.

**Reporting.** Une API « Ads v1 » offre une bibliothèque de dimensions incluant _Search term_, _Target_, _Targeting_, _Targeting match type_, _Matched target_, et des métriques de conversion retail détaillées (add to cart, detail page views, branded searches, long-term sales, new-to-brand) `[doc, 2026-10-25]`. Le terme de recherche est donc disponible. Rien de tout ça n'est observable sans diffusion réelle.

### 3.9 Verdict Amazon — **on intègre, en deuxième, sous condition**

**Pour.** L'API est libre-service et gratuite, la revue tient en un jour ouvré, le modèle se projette proprement sur notre arbre, les types de correspondance de mots-clés sont identiques aux nôtres, les minimums d'enchère sont documentés par devise, le terme de recherche est disponible en reporting, et la France est ouverte.

**Contre.** L'annonceur doit vendre sur Amazon — ce n'est pas une contrainte technique mais une contrainte de clientèle, et elle n'est pas de notre ressort. Il n'y a aucun sandbox, et les comptes de test ne diffusent pas, donc ne produisent **aucune** donnée de performance : deux des huit preuves de fin de phase exigent un compte vendeur réel et de la dépense réelle. Et l'adapter devra parler deux API en parallèle, l'unifiée et l'ancienne.

**La condition**, à trancher par Lorin avant d'inscrire la phase au plan : **existe-t-il, parmi les clients visés, des annonceurs qui vendent sur Amazon ?** Si la réponse est non, le levier Amazon Search n'a pas d'utilisateur et la phase doit attendre, quelle que soit la qualité de l'API.

---

## 4. TikTok Search Ads

### 4.1 Deux choses différentes qu'il ne faut pas confondre

C'est le piège de cette étude, et la documentation elle-même prend soin de le signaler.

**(a) Automatic Search Placement** — « Search Ads peut étendre votre publicité in-feed à la page de résultats de recherche TikTok en atteignant les utilisateurs qui recherchent des termes spécifiques liés à votre produit ou service » `[doc v1.3, 2026-10-25]`. C'est un **interrupteur sur l'ad group** : `search_result_enabled`, qui vaut `true` par défaut dès que l'objectif et le placement s'y prêtent. Objectifs admis : `APP_PROMOTION`, `WEB_CONVERSIONS`, `TRAFFIC`, `LEAD_GENERATION`. **Aucun mot-clé positif** — seulement des mots-clés négatifs, via l'API Negative Keywords.

Ce n'est donc pas un achat search : c'est une extension de diffusion d'une campagne sociale. Elle appartient au levier **`social`** (**F9**).

**(b) Search Ads Campaign** — « un type de campagne **fondé sur les mots-clés** qui atteindra les utilisateurs TikTok dans la page de résultats de recherche avec une expérience utilisateur organique. Avec les Search Ads Campaigns, vous pouvez **contrôler des budgets propres au search** et cibler des mots-clés spécifiques » `[doc v1.3, 2026-10-25]`. Un drapeau sur la campagne : `is_search_campaign: true`.

Et la documentation est explicite sur l'incompatibilité des deux : « la Search Ads Campaign **n'est pas compatible** avec l'Automatic Search Placement. (…) la Search Ads Campaign est spécifiquement conçue pour cibler la page de résultats de recherche TikTok » — `search_result_enabled` est ignoré et forcé à `false` dans une campagne search `[doc v1.3, 2026-10-25]`.

C'est **(b)** qui constitue le levier `search`. Deux chemins pour la créer : le **flux manuel** (`/campaign/create/` → `/adgroup/create/` → `/ad/create/`) et le **flux Upgraded Smart+**, qui ajoute les objectifs App Promotion et Sales et automatise mots-clés et créas.

Cela confirme ce qu'annonçait le `CADRAGE.md` § 6 : TikTok sera présent sur `social` **et** `search`, deux intégrations, un même compte. Et le choix de ne pas créer de levier `social_search` est le bon — `placement` et `is_search_campaign` suffisent à distinguer les inventaires.

### 4.2 L'accès — l'API est libre, l'inventaire ne l'est pas

**L'API** est libre-service `[doc, 2026-10-25]` : compte TikTok for Business → inscription développeur (profil à faire approuver) → création d'une app développeur. La description de l'app doit préciser les usages prévus et si l'accès est interne ou partagé. On choisit un périmètre de permissions, on soumet, et « la revue peut prendre **2 à 3 jours ouvrés** ». Jusqu'à **10 URL de redirection** par app et **5 apps par développeur**. Ensuite, autorisation OAuth par l'annonceur et jeton d'accès longue durée.

**L'inventaire search, lui, est fermé.** Deux citations, de la référence de l'endpoint et du guide :

> `is_search_campaign` — « **Les Search Ads Campaigns sont actuellement une fonctionnalité sur allowlist uniquement. Si vous souhaitez y accéder, contactez votre représentant TikTok.** (…) Une fois défini, ce champ ne peut pas être modifié. » `[spec v1.3, 2026-10-25]`

> « Les Search Ads Campaign sous différents objectifs de campagne sont contrôlées par des **allowlists séparées**. Si vous souhaitez y accéder, veuillez contacter votre représentant TikTok. » `[doc v1.3, 2026-10-25]`

Deux conséquences. D'abord, il faut **un interlocuteur commercial TikTok**, et une allowlist **par objectif** : obtenir Web Conversions ne donne pas Traffic. Ensuite, `is_search_campaign` est **immuable** — une campagne search ne peut pas devenir sociale ni l'inverse, donc chez nous le choix du levier fige la campagne plateforme à la création, et un changement de levier doit provoquer une recréation, pas une mise à jour.

Deux autres fonctionnalités sont elles aussi sur allowlist séparée : les **mots-clés automatisés** (`automated_keywords_enabled`) et le **filtre d'inventaire** de brand safety (`brand_safety_type`) `[doc v1.3, 2026-10-25]`.

### 4.3 Pays et devises

La disponibilité est publiée au centre d'aide, **par objectif**, page « last updated April 2026 », stade produit « Live » `[pub, 2026-10-25]` :

| Objectif            | Marchés                                        |
| ------------------- | ---------------------------------------------- |
| **Web Conversion**  | US, CA, UK, IT, MX, ES, DE, **FR**, SA, AU, BR |
| **Traffic**         | US, CA, UK, IT, MX, JP, ES, DE, **FR**, SA     |
| **Lead Generation** | **US uniquement**                              |

Formats annoncés : Search Ads Video, Carousel Image Ads, et Search Catalog — ce dernier limité aux verticales Sales et Travel & Entertainment `[pub, 2026-10-25]`.

La France est donc ouverte sur les deux objectifs qui nous intéressent. Marque `[pub]` : c'est du centre d'aide, pas de l'API — à reconfirmer auprès de l'interlocuteur TikTok au moment de la demande d'allowlist.

**Devises** : 57 devises, chacune avec un **ratio de vérification de budget** et une **précision** `[doc, 2026-10-25]`. L'intervalle de budget quotidien autorisé se calcule comme _intervalle de base × ratio de la devise_. Exemples : USD, EUR, GBP, AUD, CAD, SGD, CHF, AED, SAR ratio 1 et précision 0,01 ; JPY ratio 100 précision 1 ; SEK, DKK, NOK, MXN, THB, TRY, CZK ratio 10 ; KRW et CLP ratio 1 000 ; IDR et VND ratio 10 000. C'est une règle d'arrondi par devise qu'il faudra porter dans le registre, sinon les budgets seront refusés en 400.

### 4.4 Le sandbox — réel, utile, mais avec une inconnue

`https://sandbox-ads.tiktok.com/open_api`, contre `https://business-api.tiktok.com/open_api` en production `[doc, 2026-10-25]`. Un compte publicitaire de sandbox par app développeur, créé depuis le portail avec **nom, pays, devise et fuseau au choix** — ce qui est précieux pour tester notre lecture de devise et de fuseau.

Endpoints supportés : `/campaign/{create,get,update,status/update}/`, `/adgroup/{create,get,update,status/update}/`, `/ad/{create,get,update,status/update}/`, `/file/image/ad/upload/`, `/file/video/ad/upload/`, `/report/integrated/get/` (GET), `/term/{check,confirm,get}/`, `/user/info/`, `/identity/{create,get,delete}/`. Les permissions de l'app se reflètent automatiquement sur le compte de sandbox, et « le plan à long terme est de supporter tous les endpoints ».

**Données simulées** pour le reporting synchrone : « le format des données est le même que les vraies données, mais les données ne sont pas fondées sur vos réglages de campagne réels ». Les **rapports asynchrones ne sont pas supportés** par les données simulées.

Limites de débit en sandbox : **1 QPS, 30 QPM, 1 000 QPD par endpoint** `[doc, 2026-10-25]`.

**L'inconnue :** la documentation ne dit pas si l'allowlist `is_search_campaign` s'applique en sandbox. Si elle ne s'applique pas, on peut écrire et tester l'adapter search **avant** d'obtenir l'allowlist, ce qui change l'ordonnancement. À vérifier dès que l'app développeur existe — c'est une question à 10 minutes qui peut faire gagner des semaines (**F12**).

En production, les limites sont par app et par endpoint, sur quatre paliers : Basic (défaut) 10 QPS / 600 QPM / 864 000 QPD, Advanced 20 / 1 200 / 1 728 000, Premium 30 / 1 800 / 2 592 000, Ultimate 50 / 3 000 / 4 320 000. On ne monte **que d'un palier à la fois**, sur demande justifiée. Throttling : `"code": 40100` ; après une limite QPM il faut attendre 5 minutes, après une limite QPD jusqu'au lendemain 00:00 UTC `[doc, 2026-10-25]`.

### 4.5 La forme des campagnes search — et pourquoi elle s'ajuste mal

Tout ce qui suit est lu dans le guide officiel de création `[doc v1.3, 2026-10-25]`, objectif Website Conversions.

**Au niveau campagne :** `objective_type` ∈ `WEB_CONVERSIONS`, `TRAFFIC`, `LEAD_GENERATION` ; `is_search_campaign: true` ; **Smart+ désactivé** ; et surtout **`budget_optimize_on` doit être `false`** — l'optimisation de budget de campagne est interdite. Maximum **999 campagnes par compte publicitaire** `[spec v1.3, 2026-10-25]`.

**Au niveau ad group**, le budget (`budget_mode`, `budget`) **et** les mots-clés vivent sur le même objet :

- **Mots-clés** : « spécifier une liste de **1 à 1 000** mots-clés de recherche valides » avec leur `match_type`, via `search_keywords`. Le résultat de la revue de chaque mot-clé se lit dans `audit_status` au sein de `search_keywords` après `/adgroup/get/`. Un endpoint `/tool/search_keyword/recommend/` fournit des suggestions.
- **Négatifs** : jusqu'à **10 000** par ad group, via l'API Negative Keywords.
- **Placement** : `placement_type: PLACEMENT_TYPE_NORMAL` et `placements: ["PLACEMENT_TIKTOK"]`, obligatoirement.
- **Enchère** : `bid_type: BID_TYPE_CUSTOM` (cost cap) **obligatoire** — avec `bid_price` si `optimization_goal: CLICK`, ou `conversion_bid_price` si `CONVERT`. Facturation `CPC` pour CLICK, `OCPM` pour CONVERT.
- **Pacing** : `PACING_MODE_SMOOTH` imposé — pas de diffusion accélérée.
- **Pixel obligatoire** quand l'optimisation vise un site web (pas pour une TikTok Instant Page).
- Pas d'ACO (`creative_material_mode: CUSTOM`), pas de split test (« les ad groups search ne peuvent pas être utilisés dans `/split_test/create/` »).

Et la liste de ce qui **doit être absent** est longue. Doivent tous ne pas être passés : `saved_audience_id`, `auto_targeting_enabled`, `audience_ids`, `excluded_audience_ids`, `smart_audience_enabled`, `interest_category_ids`, `interest_keyword_ids`, `purchase_intention_keyword_ids`, `actions`, `smart_interest_behavior_enabled`, `included_pangle_audience_package_ids`, `excluded_pangle_audience_package_ids`, `targeting_expansion`, `contextual_tag_ids`, `blocked_pangle_app_ids`, `brand_safety_partner`, `category_exclusion_ids`, `vertical_sensitivity_id`, `keyword_bid_type`, `keyword_bid`.

**Il ne reste donc que la géographie (`location_ids`) et les mots-clés.** Pas d'audience, pas d'intérêt, pas de centre d'intérêt, pas même une enchère par mot-clé.

Deux conséquences pour notre modèle, et ce sont les plus importantes de cette section.

**(1) Le budget et les mots-clés sont sur le même objet, donc il y a éclatement.** Comme la CBO est interdite, le budget est sur l'ad group TikTok — qui porte aussi les mots-clés. Notre `AdGroup` (qui porte le budget) et notre `TargetingGroup` (qui porte les mots-clés) se projettent sur **le même objet TikTok**. Donc N TargetingGroups sous un AdGroup ⇒ N ad groups TikTok ⇒ **le budget de l'AdGroup doit être éclaté** entre eux (§ 7 du `CADRAGE.md`). C'est l'exact inverse du gain obtenu sur Google : là-bas le TargetingGroup nous fait économiser des campagnes, ici il nous force à découper un budget (**F10**).

**(2) Le profil de levier ne peut pas être indexé par le seul levier.** Le § 5 du `CADRAGE.md` fait déclarer au profil de levier « quelles dimensions de ciblage ont un sens ». Or sur le levier `search`, TikTok interdit tout sauf géographie et mots-clés, tandis que Pinterest autorise âge, genre, langue, intérêts et audiences **en plus** des mots-clés (§ 5.5). Les deux sont sur le même levier et n'acceptent pas les mêmes dimensions. Le registre doit donc être indexé par **`(levier, plateforme)`**, pas par levier seul — ou bien le profil de levier déclare l'union et le registre de capacités de la plateforme retranche, chaque retranchement devenant un avertissement nommé dans la preview. C'est une décision d'architecture, elle touche le cadrage, et elle vaut mieux prise maintenant qu'après (**F11**).

**Reporting** : la dimension `ad_type` vaut `Search` pour une Search Ad (« toute valeur autre que `Search` indique que l'annonce n'en est pas une »), et la dimension `search_terms` donne la segmentation par terme de recherche, dans les rapports de base `[doc v1.3, 2026-10-25]`. Il existe aussi un endpoint `/tool/...` de diagnostics de santé des Search Ads Campaigns.

**Un point non vérifié.** Une recherche web rapporte que la documentation TikTok annoncerait qu'à partir du **1er janvier 2027**, `/campaign/create/`, `/campaign/copy/task/create/`, `/adgroup/create/`, `/ad/create/` et `/ad/aco/create/` cesseraient de permettre la création ou la copie de campagnes « non-Search Legacy Manual Flow » pour les objectifs Sales, App Promotion et Lead Generation, au profit des API Smart+ — la mention « non-Search » suggérant que le flux manuel **search** survivrait. **Je n'ai pas retrouvé cette note** dans la référence de `/campaign/create/` ni dans la page Timelines des versions, qui ne donne pour v1.3 qu'un « Available until: TBD ». À confirmer auprès de TikTok : si le flux manuel search est menacé, c'est le flux Smart+ qu'il faut viser d'emblée (**F13**).

### 4.6 Verdict TikTok — **on reporte, à rattacher à la phase Social**

**Pour.** L'API est libre-service et bien documentée, le sandbox existe et couvre le CRUD plus un reporting simulé, la France est ouverte sur deux objectifs, les types de correspondance de mots-clés existent, le terme de recherche est disponible en reporting, et surtout **le coût marginal est faible** : TikTok est déjà au plan pour le levier `social`, donc le client HTTP, l'authentification, le modèle de compte et l'upload de créas seront déjà écrits. L'adapter search réutilise tout.

Et le coût marginal est encore plus faible qu'estimé : le cadrage des leviers a établi le même jour que le `reporting-worker` de MBP **existe bel et bien**, avec dix adapters de reporting dont un **`tiktok`** — il y a donc une implémentation de référence lisible pour le reporting TikTok, là où le `CADRAGE.md` la donnait pour inexistante. La dimension `ad_type` suffit ensuite à séparer le search du social dans les rapports.

**Contre.** L'inventaire est derrière une **allowlist par objectif** dont nous ne maîtrisons ni l'obtention ni le délai, et qui exige un interlocuteur commercial. La forme des campagnes s'ajuste mal à notre arbre : budget et mots-clés sur le même objet, donc éclatement systématique, et un ciblage réduit à la géographie qui force une exception dans le registre de capacités. `is_search_campaign` est immuable, ce qui interdit toute réparation par mise à jour.

**Donc : on reporte**, sans l'écarter. Concrètement — la demande d'allowlist part **maintenant** (elle ne coûte rien et le délai n'est pas de notre ressort), l'app développeur et le sandbox se créent en même temps que ceux du levier Social, et l'adapter search s'écrit **dans la phase Social, juste après l'adapter social**, si et seulement si l'allowlist est arrivée. Si elle n'arrive pas, on n'a rien perdu.

---

## 5. Pinterest

### 5.1 Les produits publicitaires

Lus dans l'enum `CreativeType` de la spec OpenAPI officielle `[spec v5.28.0, 2026-06-04]` — 14 valeurs : `REGULAR`, `VIDEO`, `MAX_VIDEO`, `CAROUSEL`, `SHOPPING`, `SHOP_THE_PIN`, `COLLECTION`, `MAX_WIDTH_REGULAR_COLLECTION`, `MAX_WIDTH_VIDEO_COLLECTION`, `IDEA`, `SHOWCASE`, `QUIZ`, `COLLAGE`, `APP`.

Les objectifs, enum `ObjectiveType` : `AWARENESS`, `CONSIDERATION`, `WEB_CONVERSION`, `CATALOG_SALES`, `VIDEO_COMPLETION`, `SALES`, `APP_INSTALL`, `CTV_CONSIDERATION`. La présence de `CTV_CONSIDERATION` est à noter : Pinterest a un inventaire CTV, hors de notre sujet mais pas sans intérêt pour le levier `ctv_tvs` plus tard.

La campagne porte aussi un champ `is_top_of_search`, marqué **Restricted** et immuable hors brouillon `[spec, 2026-06-04]` — c'est la mécanique des prises de parole en tête de recherche, à ignorer pour un premier adapter.

**Ce qui nous intéresse** : `REGULAR`, `VIDEO`, `CAROUSEL` pour le search standard, et `SHOPPING` / `COLLECTION` si l'on branche un catalogue. Les formats premium (`SHOWCASE`, `QUIZ`, `COLLAGE`, `IDEA`) demandent chacun une mécanique de créa propre — `quiz_pin_data` exige par exemple « un Pin organique créé pour chaque résultat du quiz » — et sortent du périmètre d'un premier adapter.

### 5.2 Le levier — les deux, et proprement

Pinterest répond à la question posée dans `A-FAIRE.md` § 11 (« search, social, ou les deux ? ») mieux que les deux autres plateformes, parce que l'API rend la séparation explicite.

L'enum `PlacementGroupType` vaut `ALL`, `SEARCH`, `BROWSE`, `OTHER`, et le champ `placement_group` existe **au niveau campagne et au niveau ad group** `[spec v5.28.0, 2026-06-04]`. Il existe en plus un `PlacementType` (`SEARCH`, `BROWSE`, `RELATED_PINS`) pour les multiplicateurs d'enchère par placement — fonctionnalité _Restricted_.

Donc : `placement_group: SEARCH` + mots-clés ⇒ levier **`search`**. `placement_group: BROWSE` ⇒ levier **`social`**. Une seule entrée `pinterest` dans l'enum des plateformes, **deux éligibilités de levier**, et le levier reste bien l'inventaire sans que rien n'ait à être deviné (**F14**).

### 5.3 L'accès — libre-service, deux paliers

Aucun accord commercial. Un compte, une app, et deux paliers `[doc, 2026-10-25]` :

**Trial access**, accordé dès l'approbation de l'app. « Le meilleur pour explorer les fonctionnalités de notre API. » Point décisif : **lire et créer des publicités est supporté aux deux paliers** — seuls les Pins et boards créés sont bridés, « tous les Pins et Boards créés avec Trial access ne sont visibles que de leur créateur, comme des entités Sandbox ». Limites : **1 000 requêtes par jour par app** toutes catégories confondues, et **300 par jour** pour `ads_write` `[doc, 2026-10-25]`.

**Standard access**, par demande de passage : _My apps_ → _Upgrade_ (visible seulement si l'app est éligible) → vérification des détails et du lien de politique de confidentialité → **téléversement d'une démonstration vidéo** → soumission. La vidéo doit montrer l'app réalisant une action via l'API, **y compris le flux OAuth** ; un enregistrement de terminal ou de Postman est accepté, et un développeur solo n'est pas exempté. Motifs de refus listés : la vidéo ne montre pas l'authentification de l'utilisateur, l'app utilise autre chose qu'OAuth (identifiants collectés, cookies de session), ou la démonstration ne montre pas d'intégration Pinterest réelle. Limites : **100 req/s par utilisateur par app** en universel, et par catégorie et par minute : `ads_write` **400**, `ads_read` **1 000**, `ads_analytics` **300**, `ads_conversions` 120 000 par compte publicitaire `[doc, 2026-10-25]`.

Deux remarques. D'abord, le palier Trial suffit pour écrire l'adapter et le prouver — 300 écritures publicitaires par jour, c'est peu mais ce n'est pas bloquant pour du développement. Ensuite, la démonstration vidéo du passage en Standard est un livrable à prévoir, pas une formalité administrative : elle doit montrer notre propre flux OAuth en fonctionnement.

**Accès agence.** Une API _Business Access_ existe : `POST /businesses/{business_id}/invites` (invitations et demandes), `POST /businesses/{business_id}/invites/assets/access` (permission sur un actif), les asset groups, les membres, les partenaires d'un actif, et `PATCH /businesses/invites` pour accepter ou refuser `[spec v5.28.0, 2026-06-04]`. C'est exactement notre modèle de lien de compte, avec son cycle de vie demande / acceptation / refus / révocation. Bonne nouvelle pour le § 12 du `CADRAGE.md`.

Un piège daté, à noter : « les apps enregistrées **à partir du 14 septembre 2026** peuvent recevoir une erreur HTTP 403 `PINNER_DATA_ACCESS_DENIED` lors de la demande d'un board ou d'un Pin sans autorisation de Pinterest pour les utilisateurs non professionnels » `[doc, 2026-10-25]`. Notre app sera enregistrée après cette date : à surveiller, puisque notre créa **est** un Pin (§ 5.6).

### 5.4 Pays et devises

Les deux réponses sont dans la spec, donc fiables `[spec v5.28.0, 2026-06-04]`.

**`TargetingAdvertiserCountry` — 38 pays** où un annonceur peut être établi : US, GB, CA, IE, AU, NZ, **FR**, SE, IL, DE, AT, IT, ES, NL, BE, PT, CH, HK, JP, KR, SG, NO, DK, FI, CY, LU, MT, PL, RO, HU, CZ, GR, SK, BR, MX, AR, CL, CO.

**`Currency` — 26 devises** pour un compte publicitaire (plus `UNK`) : USD, GBP, CAD, EUR, AUD, NZD, SEK, ILS, CHF, HKD, JPY, SGD, KRW, NOK, DKK, PLN, RON, HUF, CZK, BRL, MXN, ARS, CLP, COP, INR, TRY.

La France et l'euro sont dans les deux listes. Le ciblage géographique, lui, s'appuie sur une enum `Country` de 248 valeurs — c'est le ciblage, pas la facturation, et les deux ne doivent pas être confondus dans le registre.

Les montants sont en **micro-devise** partout (`bid_in_micro_currency`, `budget_in_micro_currency`), ce qui s'aligne sur notre convention de micros. Et un endpoint `POST /ad_accounts/{id}/bid_floor` **donne les enchères plancher** : on les lit au lieu de les figer dans une table, ce qui est mieux que chez Amazon.

### 5.5 Mots-clés, ciblage, enchères et budget

**Mots-clés** `[spec v5.28.0, 2026-06-04]`. Enum `MatchType` : `BROAD`, `PHRASE`, `EXACT`, `EXACT_NEGATIVE`, `PHRASE_NEGATIVE`. Les trois positifs correspondent un pour un aux nôtres ; les négatifs sont exprimés comme des types de correspondance, pas comme un drapeau `negative` — une différence de forme à absorber dans le mapping.

Le niveau d'attachement est précisé par l'endpoint lui-même : « les annonceurs et les campagnes ne peuvent recevoir que des mots-clés d'exclusion (`_NEGATIVE`). **Tous les types de correspondance sont disponibles pour les ad groups.** » Et : « les mots-clés créés via Ads Manager auront leur `parent_id` réglé sur un `ad_group_id`, pas sur un `ad_account_id` ». Un mot-clé vaut **120 caractères** au maximum. Le champ `bid` d'un mot-clé est **déprécié** : « l'entrée ne sera pas prise en compte et le champ renverra `null` » — donc l'enchère vit sur l'ad group, comme chez TikTok. Archiver un mot-clé revient à le supprimer : il ne reçoit plus de métriques et disparaît de la liste du parent.

Aucune limite documentée sur le **nombre** de mots-clés par ad group : à relever sur un compte réel (**F16**).

**Ciblage.** Le `targeting_spec` porte 15 dimensions `[spec v5.28.0, 2026-06-04]` : `AGE_BUCKET`, `MINIMUM_AGE`, `MAXIMUM_AGE`, `GENDER`, `LOCALE`, `GEO`, `GEO_EXCLUDE`, `LOCATION`, `LOCATION_EXCLUDE`, `INTEREST`, `AUDIENCE_INCLUDE`, `AUDIENCE_EXCLUDE`, `APPTYPE`, `SHOPPING_RETARGETING`, `TARGETING_STRATEGY`. Toutes restent disponibles **à côté** des mots-clés — contrairement à TikTok, Pinterest ne force pas à choisir entre recherche et ciblage. C'est la moitié de la raison pour laquelle le registre doit être indexé par `(levier, plateforme)` (**F11**).

Deux exclusivités à connaître : un ad group accepte **au plus un** `targeting_template_ids` et **au plus un** `customer_segment_id`, et un customer segment est incompatible avec le `targeting_spec` et les templates.

**Enchères et budget.** L'ad group porte `bid_in_micro_currency`, `bid_strategy_type`, `billable_event` et `budget_in_micro_currency` — ce dernier « **REQUIRED** pour les campagnes non-CBO ». `billable_event` (enum `ActionType`) ∈ `CLICKTHROUGH`, `IMPRESSION`, `VIDEO_V_50_MRC`. `BudgetType` ∈ `DAILY`, `LIFETIME`, `CBO_ADGROUP`. `PacingDeliveryType` ∈ `STANDARD`, `ACCELERATED` — qui se projette directement sur notre pacing. L'ad group porte aussi un `lifetime_frequency_cap`, donc un capping.

La campagne, elle, porte `daily_spend_cap` et `lifetime_spend_cap` (et non un budget), `is_campaign_budget_optimization` (immuable hors brouillon), et `default_ad_group_budget_in_micro_currency` utilisé lors du retour de CBO vers non-CBO `[spec v5.28.0, 2026-06-04]`.

**`EntityStatus` contient `DRAFT` et `DELETED_DRAFT`** — Pinterest a un état brouillon **native**, ce qui s'aligne sur notre `draft` mieux que n'importe quelle autre plateforme du lot.

**Outils de mots-clés**, qui recoupent directement des fonctionnalités de multi-search :

- `GET /ad_accounts/{id}/keywords/metrics` — « métriques de mots-clés pour un pays donné, agrégées sur tout Pinterest », champ `keyword_query_volume` décrit comme « la fréquence de recherche du mot-clé ». L'unité n'est pas documentée et la description du champ est manifestement un reste interne : **à relever sur un compte réel** avant de l'afficher comme un volume (**F16**).
- `GET /trends/keywords/{region}/top/{trend_type}` — les mots-clés de recherche en tendance, avec filtres géographiques, démographiques et par intérêt, plusieurs types de tendance (nouveaux, permanents, saisonniers), et des séries de volume relatif **normalisées de 0 à 100** sur l'année passée et trois mois de prévision.

Le volume relatif normalisé n'est pas le volume absolu que donne Google. Si le front de multi-search affiche un jour des volumes Pinterest à côté des volumes Google, ce ne sera **pas la même grandeur** — à ne pas mélanger dans une même colonne.

### 5.6 Le sandbox — le meilleur des trois

Un vrai environnement séparé `[doc, 2026-10-25]` : `https://api-sandbox.pinterest.com/v5/`, identique à la production au sous-domaine près.

**Jeton séparé**, de deux façons : depuis _My Apps_ → _Manage_ → _Configure_ → _Generate Access Token_ → _Sandbox_, valable **30 jours** ; ou par le flux OAuth sur l'hôte `api-sandbox`, ce qui permet de le rafraîchir et de choisir les scopes. Les jetons ne traversent pas la frontière : un jeton de sandbox ne marche pas en production et réciproquement. Même chose pour les identifiants — « votre identifiant de production ne sera pas reconnu », il faut créer un compte publicitaire de sandbox avec `ad_accounts/create` sur l'hôte sandbox.

**Ce qui est couvert** — et c'est large : comptes publicitaires (liste, création, lecture, analytics, `sandbox/delete`, analytics de ciblage, liste de templates) ; campagnes (liste, création, mise à jour, lecture, analytics, analytics de ciblage) ; ad groups (idem, plus audience sizing et lecture du plancher d'enchère) ; annonces et prévisualisations (création de prévisualisations, prévisualisation de campagne, CRUD d'annonces, analytics) ; **ciblage : mots-clés en lecture, création et mise à jour, métriques de mots-clés par pays, mots-clés en tendance, mise à jour de template de ciblage et de customer segment** ; formulaires de prospects ; facturation (comptes SSIO, ordres d'insertion, lignes de commande). Les prévisualisations d'annonces sont « visibles pour vous dans le Sandbox mais pas en diffusion ni visibles des utilisateurs Pinterest ».

**Ce qui ne l'est pas** : création de Pins vidéo, création et gestion de shopping ads, **test de l'accès business**, simulation de l'enchère, vérification de l'état d'un flux, upload de conversions, édition en masse.

Liste d'endpoints « last updated September 8, 2026 », revue « sur une base trimestrielle ».

**Ce que ça permet, concrètement** : sept des huit preuves de fin de phase, mots-clés inclus. Seul l'**accès agence** ne peut pas être prouvé en sandbox — il faudra un vrai compte client. Aucune autre plateforme du lot n'offre autant.

**La contrainte de créa, en revanche, est réelle.** `AdCreate` exige `ad_group_id`, **`pin_id`** et `creative_type` `[spec v5.28.0, 2026-06-04]`. La créa Pinterest **est un Pin organique**, qui doit exister sur le compte Pinterest de l'annonceur avant d'être promu. Notre modèle de créa (§ 9 du `CADRAGE.md`) doit donc accueillir une étape « créer le Pin, puis promouvoir le Pin », comparable à l'identité TikTok. En Trial access, les Pins créés ne sont visibles que de leur créateur, et en sandbox les Pins vidéo sont impossibles — ce qui borne ce qu'on peut tester sans production (**F15**).

### 5.7 Projection

Hypothèse, à confirmer en phase (**F15**) :

| Notre niveau   | Objet Pinterest                                                       | Budget ?                                    | Période ?                    | Capping ?                   |
| -------------- | --------------------------------------------------------------------- | ------------------------------------------- | ---------------------------- | --------------------------- |
| Campaign       | —                                                                     | —                                           | —                            | —                           |
| Lever          | —                                                                     | —                                           | —                            | —                           |
| AdGroup        | **Campaign** (CBO activée)                                            | ✅ `daily_spend_cap` / `lifetime_spend_cap` | ✅ `start_time` / `end_time` | —                           |
| TargetingGroup | **Ad group** (mots-clés, `placement_group: SEARCH`, `targeting_spec`) | ⚠️ `budget_in_micro_currency` si non-CBO    | ✅ `start_time` / `end_time` | ✅ `lifetime_frequency_cap` |
| Line           | **Ad** (`pin_id`, `creative_type`)                                    | ❌                                          | ❌                           | —                           |

Encore la forme Google / Microsoft, avec un choix à trancher : **CBO ou budgets par ad group ?** Avec CBO, le budget est sur la campagne Pinterest et notre AdGroup s'y projette sans éclatement — c'est ce que je recommande. Sans CBO, le budget redescend sur l'ad group et on retombe sur l'éclatement de TikTok. `is_campaign_budget_optimization` étant immuable hors brouillon, ce choix se fige à la création : il doit être explicite dans l'adapter, pas implicite.

La campagne Pinterest impose par ailleurs que son `start_time` précède celui de ses ad groups, et un ad group sans dates hérite de la campagne `[spec, 2026-06-04]` — cohérent avec notre héritage de périodes.

### 5.8 Verdict Pinterest — **on intègre, en premier**

**Pour.** Accès entièrement libre-service, sans interlocuteur commercial ni allowlist. Un **contrat OpenAPI public et versionné** (v5.28.0), ce qu'aucune des deux autres n'offre — on code contre un contrat, pas contre de la prose. Un **vrai sandbox** qui couvre campagnes, ad groups, annonces **et mots-clés**, donc sept preuves sur huit sans dépenser un euro. France et EUR ouverts. Un `placement_group` qui sépare explicitement search et browse, donc le levier reste l'inventaire. Des types de correspondance de mots-clés qui correspondent aux nôtres. Un état `DRAFT` native. Une API d'accès business qui reproduit notre modèle de lien de compte. Les planchers d'enchère lisibles par l'API. Et une source de volumes et de tendances de mots-clés, utile au-delà de Pinterest.

**Contre.** La créa est un Pin organique, ce qui ajoute une étape à notre modèle de créa — c'est le seul vrai travail nouveau. Le passage en Standard access demande une démonstration vidéo du flux OAuth. Les volumes de mots-clés sont relatifs et normalisés, pas absolus. L'accès business ne se teste pas en sandbox. Et le 403 `PINNER_DATA_ACCESS_DENIED` pour les apps enregistrées depuis le 14 septembre 2026 est à surveiller, puisqu'il touche la lecture des Pins.

Aucun de ces points n'est bloquant, et aucun ne dépend d'un tiers. **Pinterest entre au plan, et passe en premier des trois.**

---

## 6. Ce que ces trois études changent au cadrage

Quatre choses, au-delà des trois verdicts.

**6.1 Le registre de capacités doit être clé sur `(plateforme, levier)` — et deux études y arrivent séparément.** Sur le seul levier `search`, TikTok n'accepte que géographie et mots-clés, Pinterest accepte en plus âge, genre, langue, intérêts, audiences et retargeting shopping, et Amazon accepte en plus le ciblage produit et catégorie. Un profil indexé par levier seul ne peut pas exprimer ça.

C'est exactement la conclusion **L2** du cadrage des leviers (`backend/docs/leviers.md`), atteinte le même jour et par un autre chemin — lui par les gardes de Hawk par canal, moi par trois plateformes sur un même levier. Deux études indépendantes qui tombent sur la même forme de registre, c'est le meilleur signal qu'on puisse avoir qu'elle est juste. Il n'y a donc **rien à rouvrir** : F11 n'est pas une décision de plus, c'est une confirmation de L2 (**F11**).

**6.2 L'éclatement n'est pas un cas limite, c'est la règle sur certaines plateformes.** TikTok Search impose budget et mots-clés sur le même objet. Pinterest l'impose aussi si l'on n'active pas la CBO. Le mécanisme d'éclatement du § 7 du `CADRAGE.md` sera donc exercé dès les premières plateformes non-Google, et pas seulement en cas exotique. Il mérite d'être écrit tôt et bien.

**6.3 Deux plateformes exigent une créa préexistante sur la plateforme.** Pinterest exige un `pin_id`, TikTok exige une identité et une vidéo téléversée. Le modèle de créa doit prévoir une étape de publication **chez la plateforme** avant la promotion — ce n'est pas un détail d'adapter, c'est un niveau dans le cycle de vie d'une créa.

**6.4 Un sandbox n'est pas un acquis.** Pinterest en a un vrai, TikTok en a un avec des données simulées, Amazon n'en a aucun. Pour Amazon, deux des huit preuves de fin de phase exigent une dépense réelle. Le plan doit en tenir compte dans l'estimation des phases, et `A-FAIRE.md` dans la liste des comptes à ouvrir.

**Et sur le compte des plateformes** : retenir Pinterest porte l'enum à **treize** plateformes — `google_ads`, `microsoft`, `openai`, `thrad`, `amazon_search`, `amazon_dsp`, `dv360`, `hawk`, `gam`, `meta`, `tiktok`, `snap`, **`pinterest`**. Et `tiktok` gagne une seconde éligibilité de levier le jour où l'allowlist arrive (**F14**).

---

## 7. Déductions et décisions à valider

Rien de ce qui suit n'a été décidé unilatéralement. Chaque point attend un oui, un non, ou une correction.

| #       | Déduction ou décision                                                                                                                                                                                                                                                                                                                                                                                                      | Enjeu                                                                                                                                          |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1**  | Découper « d'après la documentation » en `[spec]`, `[doc]`, `[pub]`, et garder `[compte]`. Un `[pub]` contredit par un `[spec]` perd.                                                                                                                                                                                                                                                                                      | Méthode. Si tu préfères les trois marques du cadrage, je rétrograde tout en « d'après la documentation » et on perd l'information de fiabilité |
| **F2**  | Une campagne Sponsored Products diffuse aussi sur les **pages produit**, sans possibilité d'exclusion (seuls des ajustements positifs existent). On l'accepte sous `search` et la preview émet un avertissement nommé.                                                                                                                                                                                                     | Fidélité de la règle « le levier est l'inventaire »                                                                                            |
| **F3**  | Omnipotent candidate à l'API Amazon Ads comme **Partner**, via l'Amazon Ads Partner Network, pas comme Direct Advertiser.                                                                                                                                                                                                                                                                                                  | C'est la voie qui correspond à ce qu'on est, et elle conditionne le formulaire                                                                 |
| **F4**  | **Amazon Retail Ad Service** est un inventaire distinct (retail media sur distributeurs tiers), US seulement aujourd'hui : hors périmètre, à surveiller. Ni le levier Amazon Search, ni une plateforme de plus.                                                                                                                                                                                                            | Évite une confusion de périmètre                                                                                                               |
| **F5**  | **SP Global Campaigns écarté** du premier adapter : une campagne globale porte un budget par marketplace donc par devise, alors que notre Campaign porte une devise unique.                                                                                                                                                                                                                                                | Contredirait le § 4 du `CADRAGE.md`                                                                                                            |
| **F6**  | Projection Amazon : AdGroup → campagne, TargetingGroup → ad group, Line → product ad. `AdAccount` = manager account, `AdvertiserAdAccount.externalAdvertiserId` = `profileId`. Portfolios ignorés.                                                                                                                                                                                                                         | Même forme que Google / Microsoft                                                                                                              |
| **F7**  | Pour Amazon, l'adapter devra parler **deux API** : l'unifiée `/adsApi/v1/` pour le CRUD, et SP v3 / SB v4 pour les règles de budget et toutes les recommandations.                                                                                                                                                                                                                                                         | Coût d'intégration à inscrire au plan                                                                                                          |
| **F8**  | La phase Amazon Search **ne peut pas se clore sur un compte de test** : deux des huit preuves (verdict de validation d'annonce, lecture d'un rapport) exigent un compte vendeur réel et de la dépense réelle.                                                                                                                                                                                                              | Planification et budget                                                                                                                        |
| **F9**  | L'**Automatic Search Placement** de TikTok reste sur le levier `social` : c'est une extension de diffusion d'une campagne in-feed, sans mots-clés positifs. Seule la **Search Ads Campaign** est `search`.                                                                                                                                                                                                                 | Sinon on classe du social en search                                                                                                            |
| **F10** | Sur TikTok Search, AdGroup et TargetingGroup se projettent sur le **même** ad group TikTok (CBO interdite), donc N TargetingGroups ⇒ **éclatement du budget**. Proposition : éclatement par division, avec avertissement en preview.                                                                                                                                                                                       | Inverse du gain obtenu sur Google                                                                                                              |
| **F11** | **Confirme la décision L2 de `backend/docs/leviers.md`** par une voie indépendante : le registre de capacités est clé sur **`(plateforme, levier)`**, le profil de levier déclarant ce que le modèle permet et le registre ce que la plateforme accepte. Rien à rouvrir — F11 **illustre** L2 sur le seul levier `search`, où TikTok n'accepte que géographie et mots-clés là où Pinterest accepte en plus six dimensions. | Convergence de deux études. Si L2 est validée, F11 l'est aussi                                                                                 |
| **F12** | À vérifier dès l'app TikTok créée : l'allowlist `is_search_campaign` **s'applique-t-elle en sandbox** ? Si non, l'adapter search peut s'écrire et se tester avant l'allowlist.                                                                                                                                                                                                                                             | Peut changer l'ordonnancement                                                                                                                  |
| **F13** | Non vérifié : une dépréciation TikTok au **1er janvier 2027** du flux manuel pour les objectifs non-Search. Introuvable dans la référence de `/campaign/create/` et dans la page Timelines. À confirmer auprès de TikTok.                                                                                                                                                                                                  | Si le flux manuel search est menacé, viser Smart+ d'emblée                                                                                     |
| **F14** | **Pinterest est sur `search` et `social`**, séparés par `placement_group` : une entrée `pinterest` dans l'enum, deux éligibilités de levier. L'enum passe à **treize** plateformes.                                                                                                                                                                                                                                        | Répond à la question ouverte d'`A-FAIRE.md` § 11                                                                                               |
| **F15** | Projection Pinterest : AdGroup → campagne **avec CBO**, TargetingGroup → ad group (mots-clés, `placement_group: SEARCH`), Line → ad (`pin_id`). CBO recommandée pour éviter l'éclatement ; immuable hors brouillon, donc à figer à la création. Et la créa est un **Pin organique** : une étape de publication avant promotion.                                                                                            | Projection et modèle de créa                                                                                                                   |
| **F16** | À relever sur un compte réel : le nombre maximum de mots-clés par ad group Pinterest (non documenté), et l'unité réelle de `keyword_query_volume` — à ne pas afficher comme un volume absolu à côté de ceux de Google.                                                                                                                                                                                                     | Un chiffre faux et crédible est pire qu'un chiffre absent                                                                                      |

---

## 8. Ce qui reste à vérifier sur un compte réel

Rien de ce document n'est marqué `[compte]`. Les relevés à faire au début de chaque phase retenue, en plus des huit points d'`A-FAIRE.md` § 13 :

**Pinterest** — l'allowlist n'existe pas, donc tout est vérifiable tout de suite, sauf indiqué.

- [ ] Le nombre maximum de mots-clés par ad group (**F16**).
- [ ] L'unité de `keyword_query_volume` et sa comparabilité avec les volumes Google (**F16**).
- [ ] Le comportement exact de `is_campaign_budget_optimization` et le choix CBO (**F15**).
- [ ] Le flux `Business Access` de bout en bout — **impossible en sandbox**, demande un compte client.
- [ ] Le 403 `PINNER_DATA_ACCESS_DENIED` sur la lecture des Pins pour une app enregistrée après le 2026-09-14.
- [ ] La création d'un Pin puis sa promotion, et ce que le palier Trial autorise réellement à voir.

**Amazon** — vérifiable en compte de test, sauf les deux derniers points.

- [ ] Le type de profil réellement obtenu (`seller`, `vendor`) et les produits qu'il ouvre.
- [ ] La lecture de la devise et du fuseau sur le profil.
- [ ] Les contraintes de budget par marketplace (la page les documente ; les relever pour les marketplaces visées).
- [ ] Le verdict de validation d'une annonce — **compte réel exigé**.
- [ ] La lecture d'un rapport et le rattachement de ses lignes à nos entités — **compte réel et dépense exigés**.

**TikTok** — après obtention de l'allowlist, sauf le premier point.

- [ ] L'allowlist s'applique-t-elle en sandbox (**F12**) ?
- [ ] La dépréciation annoncée au 2027-01-01 (**F13**).
- [ ] La disponibilité réelle de la France par objectif, à reconfirmer auprès de l'interlocuteur TikTok (la liste est `[pub]`).
- [ ] L'`audit_status` de chaque mot-clé après revue, et son délai.
- [ ] Le comportement d'un budget qui ne respecte pas le ratio de vérification de sa devise.

---

## 9. Ce que ce document ne fait pas

Il ne cadre aucun adapter : les sections 3 et 4 du cadrage (projection complète, ciblage dimension par dimension, capping, créas, idempotence, registre de quotas) restent à remplir dans la phase de chaque plateforme retenue, dans son propre `backend/docs/plateformes/<plateforme>.md`. Les projections données ici sont des **hypothèses** marquées comme telles.

Il ne redéfinit pas le modèle de reporting — c'est `backend/docs/reporting.md`. Il signale seulement ce que chaque plateforme en rendra possible, et à quel prix.

Et il ne tranche pas la question commerciale qui conditionne Amazon : savoir s'il existe des annonceurs qui vendent sur Amazon parmi les clients visés. Elle est dans `A-FAIRE.md`.
