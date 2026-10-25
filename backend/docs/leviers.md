# Leviers — document de référence

Ce document dit, **fonctionnalité par fonctionnalité et levier par levier**, ce qui est transverse, ce qui est spécifique et ce qui est sans objet. Il est le produit du cadrage `docs/cadrage-leviers.md`.

Écrit le 2026-10-25, **validé le même jour** : les décisions **L1** à **L24** de la section 5 sont acquises, et Lorin a tranché les trois questions produit qui restaient — elles sont devenues **L25**, **L26** et **L27**, et elles **retirent** du périmètre plus qu'elles n'y ajoutent :

- **le budget reste toujours en argent** (D49) : un objectif en volume est une façon de le _saisir_, converti via le CPM ;
- **GAM est retiré** (D50) : onze plateformes ;
- **Amazon DSP quitte `audio`** (D51) ; **Omniscient est hors périmètre pour le moment** ; et **un parc d'écrans DOOH est une liste enregistrée chez Hawk** (L29).

Les trois dernières simplifient la grille : elles font disparaître les deux seules cases « spécifique » de la ligne du budget et le seul couple `(plateforme, levier)` non livrable.

**La conclusion la plus importante tient en une phrase : aucun des six leviers ne réclame un niveau que l'arbre n'a pas.** L'arbre linéaire `Campaign → Lever → AdGroup → TargetingGroup → Line` tient sur les six paradigmes. Tout ce qui manque manque en **champs** et en **registres**, pas en structure. C'est la bonne nouvelle de ce cadrage, et elle n'était pas acquise.

La deuxième tient en une autre : **les capacités ne se déclarent pas par plateforme, mais par couple `(plateforme, levier)`**. C'est le constat qui revient sur le ciblage, sur les créas et sur le capping, et il change la forme du registre prévu en `../../CADRAGE.md` § 8 et § 9.

---

## 0. Méthode, et ce qui a été vérifié

Tout ce qui suit a été lu dans le code, pas dans la documentation. Trois niveaux de confiance sont distingués dans le document :

| Marque          | Ce que ça veut dire                                                                   |
| --------------- | ------------------------------------------------------------------------------------- |
| **vérifié**     | lu dans le code de multi-search (le nôtre) ou de MBP / `meta-dsp-lib` (lecture seule) |
| **relevé live** | MBP porte la trace d'un essai sur un compte réel, avec sa date et son code d'erreur   |
| **à relever**   | personne ne l'a vérifié ; la question part dans `../../A-FAIRE.md`                    |

### Quatre corrections aux documents existants

Elles sont la conséquence directe de la règle « vérifier avant d'affirmer », et deux d'entre elles changent des conclusions écrites.

1. **Le `reporting-worker` de MBP a bien reçu son code de domaine.** `../../CADRAGE.md` § 15 et `backend/docs/reporting.md` § 2 affirment le contraire. Il contient 191 fichiers TypeScript, un fait canonique (`apps/reporting-worker/src/pipeline/canonical-fact.ts`) et **dix adapters de reporting** — `hawk`, `dv360`, `amazon`, `meta`, `tiktok`, `snap`, `gam`, `openai`, plus un faux et un client HTTP — chacun avec son normaliseur et ses ventilations (`*-breakdowns.ts`). Les cinq plateformes données pour « rien » (Meta, TikTok, Snap, GAM, Amazon Search) en ont quatre sur cinq. **Il existait donc une implémentation de référence lisible pour onze des douze plateformes de MBP** ; après le retrait de GAM (L26) il en reste dix sur nos onze, et seule Amazon Search n'a rien. Ce constat ne change pas le modèle de `reporting.md`, qui est bon ; il change l'estimation de l'inconnu.
2. **Hawk remonte des conversions et des visites.** `../../CADRAGE.md` § 15 écrit « Aucune conversion » pour Hawk, sur la foi des types de `meta-dsp-lib`. Le rapport que le `reporting-worker` demande réellement (`adapters/hawk/hawk-report.types.ts`, **relevé live le 2026-10-08**) porte `impression`, `click`, **`visit`**, **`conversion`**, `playouts`, les quatre quartiles, `complete`, les surfaces de visibilité IAB, et **sept** colonnes de coût dont `agencyMargin`. C'est beaucoup plus que les six mesures annoncées.
3. **La projection DV360 de `../../CADRAGE.md` § 7 est corroborée**, pas seulement hypothétique : l'Insertion Order de MBP est clé sur `Strategy.id` — notre AdGroup — et partagé par toutes ses feuilles (`dsp-adapters/dv360/infrastructure/insertion-order-context.resolver.ts`), le Line Item étant la feuille, notre TargetingGroup.
4. **La projection Amazon diverge.** MBP clé la campagne Amazon sur **notre Campaign** (`amazon/infrastructure/campaign-context.resolver.ts`), pas sur l'AdGroup. L'hypothèse de § 7 reste tenable — l'ad group Amazon porte bien un budget monétaire `LIFETIME` (`amazon/builders/adgroup-create-params.builder.ts`) — mais elle implique une campagne Amazon **par AdGroup**, et c'est le `flight` (dates + budget) de cette campagne qui doit alors venir de l'AdGroup. À trancher dans la phase Amazon.

### Un biais à nommer

`../../CADRAGE.md`, `reporting.md` et le modèle de données viennent de multi-search, qui ne connaît que le Search. Trois réflexes du Search sont passés dans le modèle sans y être questionnés, et ce cadrage les remet en cause : **la stratégie d'enchères posée sur la campagne** (G1), **le budget exprimé uniquement en argent** (G3), et **la page de destination posée sur la créa** (G4). Aucun des trois ne survit tel quel aux leviers programmatiques.

---

## 1. Les six fiches de levier

### `search`

|                         |                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ce qu'on achète**     | une intention : une requête tapée, ou une question posée à un assistant                                                                                  |
| **Unité d'achat**       | CPC surtout, CPM chez OpenAI (`supports.cpm`, vérifié dans `platform-rules.ts`)                                                                          |
| **Mesure du succès**    | le clic, puis la conversion en ligne ; la part d'impressions comme indicateur de couverture                                                              |
| **Temporalité**         | continue, et l'optimisation de la plateforme travaille dans la durée. C'est le paradigme pour lequel la courbe journalière et le pacing ont été inventés |
| **Ciblage propre**      | les **mots-clés** et les mots-clés négatifs avec leurs types de correspondance, les `context_hints` des plateformes conversationnelles, les extensions   |
| **Créas attendues**     | `(search_text, rsa)` — déclinée en chat cards chez OpenAI, en carte sponsorisée chez Thrad                                                               |
| **Plateformes**         | `google_ads`, `microsoft`, `openai`, `thrad`, `amazon_search` (à l'étude)                                                                                |
| **Ce qui n'existe pas** | aucune plateforme du levier n'expose de capping, aucune ne vend d'inventaire privé (pas de deals)                                                        |

Le levier est **prouvé de bout en bout** par multi-search sur quatre plateformes sur cinq.

### `dooh`

|                                         |                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ce qu'on achète**                     | une **diffusion sur un écran** dans un lieu public — un _playout_, que Hawk compte sous `playouts`                                                                                                                                                                                                                                                                                 |
| **Unité d'achat**                       | CPM, mais le CPM porte sur des **impressions, pas des diffusions** : une diffusion vaut N impressions, N étant le _multiplicateur d'audience_ de l'écran. Hawk en fait une dimension de ciblage (`multiplier`, **DOOH uniquement**, une seule plage honorée, relevé live le 2026-07-27) — on filtre l'inventaire par son multiplicateur pour ne pas payer des impressions gonflées |
| **Mesure du succès**                    | la couverture et la répétition sur une zone, et la **visite** en point de vente — Hawk remonte `visit`, et ses dimensions de rapport vont jusqu'à `visitedPOI`. **Pas le clic : un écran ne se clique pas**                                                                                                                                                                        |
| **Temporalité**                         | un plan, pas une campagne continue : une période, des créneaux horaires, un parc d'écrans. Hawk ne porte d'ailleurs **aucune date sur le Mediaplan** : les dates vivent sur l'Order avec leur fuseau, et le Mediaplan n'affiche que leur enveloppe (`boundSchedule`, vérifié)                                                                                                      |
| **Ciblage propre**                      | GPS en **cercles et polygones**, grilles de geohash, codes postaux, `metroCode`, listes de placements et de supply, et le `multiplier`. Chez Hawk, **ni `os`, ni `environment`, ni `ip`, ni `deviceType`** : refusés sur le canal DOOH (les deux premiers rejetés par Hawk lui-même, relevé live)                                                                                  |
| **Créas attendues**                     | `(display, image)` et `(video, file)`. Hawk refuse explicitement le HTML inline et le HTML5 en DOOH, et n'a pas de type pour une native DOOH                                                                                                                                                                                                                                       |
| **Plateformes**                         | `hawk` seule. DV360 sait pourtant faire du DOOH (`LINE_ITEM_TYPE_DISPLAY_OUT_OF_HOME`, vérifié) : la matrice de MBP ne l'ouvre pas, extension identifiée                                                                                                                                                                                                                           |
| **Comment on choisit un parc d'écrans** | Par une **liste enregistrée chez Hawk**, référencée par son uuid (L29). La liste se compose dans la console Hawk, hors d'Omnipotent ; nous la désignons et stockons son identifiant plus ses valeurs d'affichage — c'est le motif `*Referential` de MBP et la doctrine T5. Reste à relever **lequel** des quatre référentiels de Hawk porte des écrans                             |

### `audio`

|                      |                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Ce qu'on achète**  | une **écoute** : un spot inséré dans un flux musical, une radio en ligne, un podcast                                                                                                                                                                                                                                                       |
| **Unité d'achat**    | CPM, et le CPCV (coût par écoute complète) comme variante naturelle — Hawk porte des objectifs `complete` par jour et sur la vie de l'Order (vérifié)                                                                                                                                                                                      |
| **Mesure du succès** | la **complétion**, pas le clic : `start`, les quartiles, `complete`. Un spot audio n'a pas de surface cliquable sur la plupart des inventaires                                                                                                                                                                                             |
| **Temporalité**      | continue, proche du Search dans sa forme, avec un pacing sur la période                                                                                                                                                                                                                                                                    |
| **Ciblage propre**   | genres musicaux et catégories de podcast — `content-genre` chez Amazon, dont **les valeurs acceptées dépendent de l'`inventoryType`**, donc du levier (relevé live le 2026-07-22 : « Unsupported Content Genre Target for AdProgramType ») ; et, chez Hawk, le ciblage géographique **à la ville**, qui n'est délivré que sur Audio et CTV |
| **Créas attendues**  | `(audio, file)` et `(audio, vast_url)` — Hawk prend les deux, DV360 les deux                                                                                                                                                                                                                                                               |
| **Plateformes**      | `hawk`, `dv360`. **`amazon_dsp` est retiré du levier** (L27) : sa Creative Asset Library n'enregistre que `IMAGE` et `VIDEO` (relevé live), donc une créa audio ne peut pas y être poussée — « even though the DSP serves audio »                                                                                                          |

### `social`

|                         |                                                                                                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ce qu'on achète**     | un **placement dans un fil**, sur une plateforme qui ne vend que son propre inventaire                                                                                       |
| **Unité d'achat**       | CPM principalement, et ce que l'**objectif** de la campagne autorise : chez Meta, TikTok et Snap, l'objectif décide des optimisations et donc des enchères disponibles       |
| **Mesure du succès**    | dépend de l'objectif — couverture, clic de lien (Meta) ou _swipe_ (Snap), conversion via le pixel de la plateforme                                                           |
| **Temporalité**         | continue, avec une phase d'apprentissage que la plateforme protège                                                                                                           |
| **Ciblage propre**      | audiences et intérêts propriétaires, `social-placement`, **catégories de POI** (`poi`, catégories `LOI_*` chez Snap, avec un rayon unique pour toute la sélection)           |
| **Créas attendues**     | `display` et `video` seulement (vérifié sur les trois adapters de créas). Ni audio, ni native, ni MRAID                                                                      |
| **Plateformes**         | `meta`, `tiktok`, `snap`                                                                                                                                                     |
| **Ce qui manque**       | **l'objectif** (G2), **l'identité** — `page_id` Meta, `identity_id` TikTok, `profile_id` Snap, sans lesquels aucune annonce ne se crée (G11) — et les **mentions DSA** (G12) |
| **Ce qui n'existe pas** | les deals : ces plateformes ne vendent pas d'inventaire privé (confirmé par l'énumération `dsp_deals` de MBP, qui ne les contient pas)                                       |

### `ctv_tvs`

|                      |                                                                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ce qu'on achète**  | un **visionnage sur un grand écran** — télévision connectée, télévision segmentée                                                                     |
| **Unité d'achat**    | CPM, et le **CPCV** est la métrique du métier : une vidéo CTV n'est pas _skippable_, on achète des complétions                                        |
| **Mesure du succès** | la complétion (`video_completes`) et la couverture incrémentale face à la TV linéaire. **Pas le clic**                                                |
| **Temporalité**      | plan réservé, souvent sur deals — y compris en **PG**, c'est-à-dire un volume garanti à CPM fixe, donc une dépense engagée d'avance                   |
| **Ciblage propre**   | `content-genre`, `content-duration`, `content-rating`, `videoPlayerSize` (Hawk : **CTV uniquement**), position OpenRTB, `playbackMethod`, `skippable` |
| **Créas attendues**  | `(video, file)` et `(video, vast_url)`                                                                                                                |
| **Plateformes**      | `hawk`, `dv360`, `amazon_dsp`. **GAM est retiré** (L26)                                                                                               |
| **Ce qui contraint** | Chez Hawk, `zipCode` et `metroCode` ne sont **pas** délivrés sur le canal TV, alors qu'ils le sont en DOOH et en DAC (vérifié)                        |

### `dac`

|                      |                                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ce qu'on achète**  | de l'**affichage et de la vidéo sur le web et dans les applications** — le display et la vidéo classiques, plus la porte d'entrée vers YouTube                                                                |
| **Unité d'achat**    | CPM, sauf sur le chemin Demand Gen de DV360 qui est un **`TARGET_CPC`** (relevé live DVDG-000 : « ⚠ CPC, not CPM »)                                                                                           |
| **Mesure du succès** | le clic, la visibilité (`viewable_impressions` / `measurable_impressions`), et la conversion en ligne                                                                                                         |
| **Temporalité**      | continue                                                                                                                                                                                                      |
| **Ciblage propre**   | `kvps` (arbres d'expressions clé-valeur), `ifaSampling`, `interstitialParallax`, `youtube-channel` et `youtube-video`, `carrier`, `deviceMake` / `deviceModel`, `appSiteName`, et le GPS partagé avec le DOOH |
| **Créas attendues**  | `display` (image, HTML inline), `(video, file)`, `(video, vast_url)`, `native`, `mraid`, et **`(video, youtube_id)`** pour Demand Gen                                                                         |
| **Plateformes**      | `hawk`, `dv360`. **GAM est retiré** (L26)                                                                                                                                                                     |
| **Ce qui bloque**    | **DV360 refuse tout `frequency_cap` sur un Line Item Demand Gen** — même la forme « illimité » (relevé live, 400 `INVALID_ARGUMENT`)                                                                          |

### Ce que les six fiches disent ensemble

Trois familles, pas six paradigmes :

- **Le Search** achète une intention, mesure un clic, s'optimise en continu, et n'a ni inventaire privé ni capping.
- **Le Social** achète un placement propriétaire, et tout y passe par un **objectif immuable** qui conditionne enchères, mesure et créas.
- **Les quatre leviers programmatiques** (`dooh`, `audio`, `ctv_tvs`, `dac`) achètent une impression sur un inventaire tiers, au CPM, par enchère ouverte ou par deal, avec capping, et se mesurent en complétion ou en visibilité plus qu'en clic. Ils partagent presque tout — **y compris les mêmes plateformes** — et c'est à l'intérieur de cette famille que la distinction `(plateforme, levier)` fait tout le travail.

C'est pourquoi l'étude ne conclut pas « six variantes » : elle conclut **un modèle commun, deux registres, et une douzaine de champs qui manquent**.

---

## 2. La grille

**Légende** — **T** transverse (même code, même modèle) · **S** spécifique (une variante est nécessaire, elle est nommée) · **—** sans objet · **→** hors v1, extension identifiée · **?** la conclusion dépend d'un relevé sur compte réel, qui est dans `../../A-FAIRE.md`

| Fonctionnalité                     | `search` | `dooh` | `audio` | `social` | `ctv_tvs` | `dac` |
| ---------------------------------- | -------- | ------ | ------- | -------- | --------- | ----- |
| Objectifs de conversion            | T        | S      | T ?     | T        | T ?       | T     |
| Script de suivi unique             | T        | —      | T ?     | T        | T ?       | T     |
| Statistiques et rapports           | T        | T      | T       | T        | T         | T     |
| Catalogues et campagnes Produits   | T        | —      | —       | →        | —         | →     |
| Génération IA de textes            | T        | —      | —       | S        | —         | S     |
| Génération IA d'images et d'assets | T        | T      | S       | T        | S         | T     |
| Forecasts                          | T        | —      | —       | —        | —         | —     |
| Keyword ideas et volumes           | T        | —      | —       | —        | —         | —     |
| Liens d'agence                     | T        | —      | —       | →        | —         | —     |
| E-mails, digests, alertes          | T        | T      | T       | T        | T         | T     |
| Référentiel géo                    | T        | T      | T       | T        | T         | T     |
| Deals (PMP, PG)                    | —        | T      | T       | —        | T         | T     |
| Capping                            | —        | T      | T       | T        | T         | T     |
| Courbe de budget et pacing         | T        | T      | T       | T        | T         | T     |

### Les justifications, ligne par ligne

**Objectifs de conversion — transverse, sauf en DOOH.** L'entité est une déclaration d'annonceur (`key`, `name`, `category`, `valueMode`, `counting`) et sa projection par compte est déjà un registre par plateforme : multi-search a exactement ce couple `ConversionGoal` / `ConversionGoalRef`, avec un drapeau `biddable` par compte et une table de correspondance par catégorie vers chaque plateforme (vérifié dans `platforms/conversion-events.ts`). Rien de tout cela n'est propre à un levier. Trois réserves, qui sont des faits de plateforme et pas de levier :

- **Thrad ne remonte aucune conversion et ne sait pas enchérir dessus** (`conversionReporting: false`, `conversionBidding: 'none'`, vérifié). La divergence existe donc **déjà à l'intérieur du Search** : c'est l'argument qui tranche en faveur du transverse.
- **DV360 n'a pas de pixel : il a Floodlight**, c'est-à-dire des `floodlightActivityId` qui vivent dans Campaign Manager 360, un produit Google distinct (vérifié dans les types `DV360ConversionCountingConfig`). Le chemin Demand Gen pousse d'ailleurs un `conversionCounting` « minimal, Floodlight-free ». Mesurer une conversion sur DV360 suppose donc un accès CM360 — à régler dans la phase DV360.
- **En DOOH, c'est spécifique**, et c'est le seul cas où le paradigme tranche : la conversion DOOH est une **visite**, mesurée par la plateforme à partir de la mobilité (Hawk remonte `visit` et ventile par `visitedPOI`), pas un événement que notre script déclenche. Il n'existe aucun champ de déclaration d'objectif de conversion dans les types Hawk. Le modèle doit donc accepter un objectif **dont la source est la plateforme**, sans projection d'un événement à nous.

**Script de suivi unique — transverse, sans objet en DOOH.** Le script est un artefact de navigateur : il charge la balise de chaque plateforme et relaie le consentement (vérifié dans `tracking/loader.ts`, qui gère le mode consentement de Google, Microsoft, OpenAI et Thrad). Le mécanisme ne change pas d'un levier à l'autre ; ce qui change est **la liste des balises à charger**, donc un registre par plateforme. En DOOH, il n'apporte rien : aucune impression d'écran ne peut être rattachée à une conversion web par une balise de navigateur. En audio et en CTV il reste chargeable, mais l'attribution y est _post-vue_ et c'est la plateforme qui décide — d'où le `?` : à confirmer sur un compte réel que Hawk, DV360 et Amazon DSP acceptent un événement navigateur et savent l'attribuer à une exposition audio ou CTV.

**Statistiques et rapports — transverse, sans discussion.** L'intuition de départ est confirmée, et par une source solide : le fait canonique du `reporting-worker` de MBP couvre les huit plateformes non-Search avec **les mêmes familles** que celles décidées en R1 — noyau, coût en couches, vidéo en quartiles, visibilité, conversions — et `channel_family` y est une simple colonne (`display | video | audio | ctv | dooh | native | social`). La famille DOOH de `reporting.md` (`plays`) correspond aux `playouts` de Hawk. Deux précisions que la grille doit porter :

- **le grain atteint notre `Line`** chez Hawk (le rapport est par `lineCreativeId` × jour, vérifié) ;
- **GAM ne remontait aucun coût** (`cost_layers: 0`, « GAM reports revenue, never a cost ») : c'est l'un des trois constats qui ont fait retirer la plateforme (L26). Plus aucune plateforme du périmètre ne remonte un revenu à la place d'un coût.

**Catalogues et campagnes Produits — propre au Search.** L'intuition est confirmée, et plus largement qu'attendu : les **quatre** plateformes Search consomment un catalogue, chacune à sa façon (`delivery: 'fetch'` chez Google et Microsoft, `'sftp'` chez OpenAI et Thrad, une annonce par produit chez Thrad — vérifié dans `platform-rules.ts`). Côté programmatique, **rien n'existe dans aucune de nos deux références** : les créas catalogue de Meta sont « deliberately not modelled » dans `meta-dsp-lib`, le ciblage produit d'Amazon est une dimension d'audience par ASIN et non un flux, et Hawk n'a qu'un état `dco_paused` sans aucune API de DCO. Les deux extensions réelles sont donc nommées et hors v1 : **Meta Advantage+ catalog** sur `social`, et la **DCO** sur `dac`.

**Génération IA de textes — Search, puis les formats qui ont du texte.** Le mécanisme de multi-search (lire la page de destination, demander à Claude, proposer sans jamais appliquer) est transverse ; ce qui est spécifique est **le schéma de sortie et ses limites**, qui dépendent du couple `(format, subtype)`. Il n'y a donc rien à générer là où la créa n'a pas de champ de texte : un fichier audio, une vidéo hébergée et une image DOOH n'en ont aucun. Restent `social` et `dac`, où la native et les formats sociaux portent titre, texte et appel à l'action : une variante, pas un nouveau produit.

**Génération IA d'images et d'assets — transverse par nature, inexistante partout.** Vérifié : multi-search n'a qu'une interface `ImageGenerator` sans implémentation, et MBP n'en a pas du tout. Comme l'`Asset` est déjà agnostique du levier (D38), un générateur d'images sert le DOOH, le social, le DAC et l'image de chat card du Search sans variante. L'audio et la vidéo sont **spécifiques** au sens strict : ce sont d'autres modèles, pas d'autres tailles. C'est une **phase à part entière**, et la seule fonctionnalité de la grille qui n'a aucune implémentation de référence.

**Forecasts — propres au Search, et c'est tout.** Vérifié : MBP n'a **aucun** forecast. Les deux équivalents qu'on pouvait espérer ne sont plus au périmètre :

- en **DOOH**, l'outil de prévision aurait été **Omniscient** (audience d'un parc d'écrans, plan d'activation d'une zone) — **hors périmètre pour le moment** ;
- sur `ctv_tvs` et `dac`, l'équivalent aurait été la **prévision de disponibilité de GAM** — **GAM est retiré** (L26).

DV360, Amazon DSP et Hawk n'exposent rien d'exploitable dans `meta-dsp-lib`. **Aucun forecast hors Search en v1**, et c'est net : il n'y a plus de demi-mesure à porter dans le modèle.

**Keyword ideas et volumes — propre au Search.** L'intuition est confirmée : c'est le Keyword Planner de Google plus notre fournisseur de volumes. Une nuance mérite d'être écrite, parce qu'elle sera lue de travers : **les mots-clés comme dimension de ciblage ne sont pas propres au Search.** MBP porte `keyword.criteria.ts` et `negative-keyword-list.criteria.ts`, mappés sur `TARGETING_TYPE_KEYWORD` de DV360 et `KeywordTarget` d'Amazon — du ciblage **contextuel**. Le Planner pourrait donc un jour alimenter cette dimension : extension identifiée, pas v1.

**Liens d'agence — propre à Google et Microsoft.** Le modèle est « le compte manager de l'agence est rattaché sous le nôtre, un admin de l'agence accepte, et tous ses comptes clients deviennent joignables » (vérifié dans `AgencyLinkEntity` : MCC Google, customer Microsoft). Aucune autre plateforme de nos références n'a cela : MBP n'a qu'une `DspConnection` par `(organisation, DSP)`, un jeu de credentials, rien à rattacher. L'extension réelle est le **partenariat Business Manager / Business Center** de Meta, TikTok et Snap, qui est un autre modèle et pas une généralisation du nôtre.

**E-mails, digests, alertes — transverse.** Les codes de tâche de multi-search portent sur des comptes, des créas refusées, des liens expirés et du pacing : rien qui soit propre à un levier. Ce qui change est que **le catalogue de tâches grandit** — un deal expiré, une créa refusée par une SSP, un capping inexprimable, un écran retiré du parc d'une régie, un objectif rendu immuable. Transverse, avec des entrées en plus.

**Référentiel géo — transverse, avec deux sources et une résolution par plateforme.** Le mécanisme de multi-search est déjà le bon : un lieu canonique plus une table `(lieu, plateforme) → identifiant`, dont une ligne à `null` veut dire « cette plateforme n'a pas ce lieu » (vérifié). MBP le confirme à l'échelle de huit plateformes avec son `LocationRef`, qui porte jusqu'à huit espaces de noms simultanés — et un cas instructif : **Hawk prend des noms de ville, pas des identifiants** (`hawkCountry` + `hawkCity` viennent obligatoirement ensemble). Le pivot des identifiants Google reste le bon choix, puisqu'il sert aussi DV360 au niveau pays par simple formule (`2000 + code ISO numérique`, vérifié). Deux points à écrire noir sur blanc :

- **un seul référentiel en v1**, l'administratif, pivoté sur les identifiants Google. Omniscient étant hors périmètre, les objets géographiques qui ne sont pas des lieux administratifs — cercles, polygones, grilles de geohash — se **saisissent en coordonnées** et se stockent comme tels. C'est de toute façon la seule forme que les DSP acceptent, donc rien n'est à défaire le jour où une source vient les alimenter ;
- **la granularité acceptée dépend du couple `(plateforme, levier)`** : chez Hawk, le ciblage à la ville n'existe que sur Audio et CTV, le GPS que sur DOOH et DAC, `zipCode` et `metroCode` partout sauf en TV (vérifié). C'est transverse en mécanisme, pas en capacités.

**Deals — propres aux quatre leviers programmatiques.** L'intuition est confirmée par le modèle même de MBP : le `Deal` déclare les leviers qu'il sert dans un champ `devices` dont l'énumération est exactement `dooh | audio | ctv_tvs | dac` — **ni social, ni search** (vérifié). Un deal est un accès à de l'inventaire tiers ; le Search n'a pas d'inventaire, et les plateformes sociales ne vendent que le leur. Deux contraintes dures à porter dans le modèle, relevées live chez Hawk le 2026-09-23 :

- **un Order Hawk est PG ou ne l'est pas, et le drapeau est figé à la création** ; un mélange PG + PMP répond 409. Comme un Order correspond au couple `(AdGroup, TargetingGroup)`, **un TargetingGroup ne peut pas porter à la fois un deal PG et un deal PMP**, et attacher un deal PG à un TG déjà lancé force la restructuration de D40 ;
- **un deal porte son prix** (`bidCpm`), et en achat direct c'est lui qui fait l'enchère : le `buyingStrategy` de l'Order est soit la liste des deals avec leur CPM, soit une enchère ouverte (`secondprice`, `thirdInventoryBaseCPM`). Il n'y a donc **pas de « stratégie d'enchères »** au sens du Search sur ce chemin — voir G1.

**Capping — sans objet en Search, transverse ailleurs.** L'intuition est confirmée, et il faut en tirer la conséquence forte : **aucune des plateformes du levier `search` n'expose de capping.** OpenAI est formel et vérifié (`maxCaps: 0` — « the Advertiser API exposes no frequency cap on the campaign, the ad group or the ad ») ; Google réserve le capping à ses campagnes Display et Vidéo ; Microsoft et Thrad n'en ont pas. Le profil du levier `search` doit donc déclarer le capping **`interdit`**, pas « facultatif avec avertissement » : c'est la différence entre une API qui refuse en 400 et une preview qui prévient trop tard. Sur les cinq autres leviers, c'est transverse — et le travail est entièrement dans la **dégradation par plateforme**, documentée en G13.

**Courbe de budget et pacing — transverse, et c'est le résultat le plus contre-intuitif de l'étude.** La courbe journalière est née d'un besoin Search ; la question du cadrage était de savoir si un plan DOOH réservé s'y plie. **Oui**, et la preuve est dans les types :

- **Hawk** porte sur l'Order un budget `lifetime` **et** un bloc `daily` avec son propre `budget` (vérifié). MBP ne pousse que le `lifetime` ; rien n'empêche de pousser le budget du jour calculé par notre pacing, exactement comme multi-search le fait chez Google ;
- **DV360** a deux formes : `PACING_PERIOD_DAILY` avec `dailyMaxMicros`, et des **`budgetSegments`** (montant + plage de dates) sur l'Insertion Order — c'est-à-dire une courbe par segments, nativement ;
- **Meta, TikTok, Snap et Amazon DSP** ont tous un budget journalier ou de durée de vie.

La courbe tient donc **partout, sans exception** : GAM était la seule plateforme où elle n'avait pas de sens, et elle est retirée (L26). Une seule réserve subsiste, et elle n'est pas technique : **les deals PG**. Un deal garanti engage un volume à CPM fixe ; la courbe n'y est plus un choix mais une **contrainte**, la preview doit le dire, et un jour à 0 € sur un PG est une rupture d'engagement, pas une pause.

---

## 3. Ce qui manque au modèle

C'est la vraie question du cadrage. Chaque manque est énoncé avec **ce qui le prouve** et **sa conséquence sur l'arbre ou sur les entités**. Aucun ne demande un niveau supplémentaire.

### G1. Le modèle d'enchères n'a pas de place dans l'arbre

Le tableau « ce que porte chaque niveau » de `../../CADRAGE.md` § 3 a six colonnes — budget, dates, capping, plateformes, ciblage, statut — et **aucune pour les enchères**. Multi-search les pose sur la **Campaign** (`bidding: { strategy, amount }`, vérifié), ce qui ne tient plus dès qu'une campagne porte six leviers aux paradigmes différents. MBP, lui, **n'a pas d'enchères du tout** : chaque adapter applique une constante (`DV360_CAMPAIGN_DEFAULT_CPM`, `AMAZON_ADGROUP_DEFAULT_BID_BY_INVENTORY`, `TIKTOK_ADGROUP_DEFAULT_BID_PRICE`, `META_ADSET_DEFAULT_BID_AMOUNT_MINOR`, vérifiés) qu'un `*Overrides.bid` de requête peut écraser. C'est l'aveu, dans le code, que le modèle ne sait pas l'exprimer.

**Conséquence.** Les enchères descendent sur l'**AdGroup** — qui est l'objet porteur de budget chez les plateformes, donc celui qui porte la stratégie — avec une **surcharge du montant sur le TargetingGroup**, qui est l'objet d'enchère réel (ad group Google, Line Item DV360, ad group Amazon, ad set Meta, Order Hawk). Et l'énumération des quatre stratégies du Search ne suffit pas : il faut au moins `fixed_cpm` (DV360 `fixedBid`, Amazon `baseBid`), `target_cpc` (Demand Gen), `maximize_reach`, une forme CPCV pour la vidéo et l'audio, et **le cas « le prix vient du deal »**, où aucune stratégie ne s'applique.

### G2. L'« objectif » n'existe pas, et il est immuable

Meta exige un `objective` ODAX, TikTok un `objective_type`, Snap un `objective_v2_type` ; DV360 un `lineItemType` et Amazon un `inventoryType`. Les deux derniers se **déduisent du levier** et MBP a les tables pour le faire (vérifiées). Les trois premiers **ne se déduisent pas** : le levier est `social` dans les trois cas, et MBP code en dur `REACH` / `OUTCOME_AWARENESS` / `AWARENESS_AND_ENGAGEMENT`. Autrement dit, **MBP ne sait pas lancer une campagne sociale à la conversion.** Et ces valeurs sont **immuables après création** (« immutable post-create on TikTok », vérifié).

**Conséquence.** Un champ `objective` sur l'**AdGroup**, dont le profil de levier donne la liste permise et le défaut, immuable une fois lancé. Il **conditionne** les stratégies d'enchères disponibles, la possibilité d'enchérir sur une conversion et parfois le capping (voir G13). Le changer après lancement relève de la restructuration de D40, et la preview doit l'annoncer comme telle.

### G3. Le budget ne sait s'exprimer qu'en argent — **tranché (L25)**

Le constat : l'Order de Hawk accepte, par jour et sur la durée de vie, un `volume` (impressions ou diffusions), un nombre de `click`, un objectif de `complete` et un objectif de `conversion` (vérifié). Et un brief DOOH ou CTV s'écrit couramment en impressions, en contacts ou en GRP, pas en euros.

**Décision (L25, D49) : le budget reste toujours en argent, et un objectif en volume est une façon de le saisir.** C'est la réponse qui garde les deux avantages. L'utilisateur peut entrer « 500 000 impressions » au lieu d'un montant ; la saisie est **convertie en argent via le CPM** et c'est le **montant qui est stocké**. Le volume est conservé à côté comme la saisie qui l'a produit — pour l'afficher, et pour recalculer le montant si le CPM change.

Ce que cela préserve, et c'est tout l'intérêt : **l'algèbre du budget ne change pas d'une ligne.** Les montants restent en centimes entiers, en devise de campagne, et l'invariant `Σ enfants ≤ parent` de D8 continue de porter sur de l'argent — un invariant sur deux unités mélangées aurait été infernal.

Trois précisions à tenir :

- la conversion **exige un CPM**, qui est le montant d'enchère de L3 : saisir un volume sans CPM est un 400, pas une estimation implicite ;
- le montant obtenu est une **estimation** — le CPM payé en diffusion ne sera pas le CPM d'enchère. Le volume saisi est donc indicatif et ne doit jamais être présenté comme un engagement de livraison ;
- **il n'y a pas de second porteur de vérité.** C'est la même doctrine que le pacing de § 4 de `../../CADRAGE.md` : on ne crée pas une deuxième source à côté de la première.

### G4. La `Line` n'a aucune charge utile, et Hawk y met la page de destination

Chez multi-search, la page de destination vit sur la créa (`finalUrl`) et l'`Ad` — notre `Line` — n'est qu'un lien sans champ (vérifié). Chez Hawk, c'est l'inverse : « the landing page of the ad lives HERE, not on the creative », sur le `targetService.clickCommandUrl` de la **Line**, et il est **obligatoire** pour une vidéo uploadée et une native (relevé live, 409 `error.targetService.clickCommand...`). Le même objet porte `impressionPixelUrls`, c'est-à-dire les **traceurs tiers**.

**Conséquence.** Deux choses. La première : l'adapter doit pouvoir projeter la `finalUrl` de la créa sur la Line de la plateforme, et une **surcharge facultative de page de destination sur notre `Line`** devient naturelle — c'est le besoin « même créa, page différente selon le ciblage », qui est quotidien en agence. La seconde est plus grave : **les traceurs tiers n'ont aucune place dans le modèle**, alors qu'ils sont la norme en programmatique (pixel d'impression, traceur de clic, événements vidéo, vérification). Je recommande de les porter sur la **version de créa**, avec une surcharge possible sur la Line, et de laisser chaque adapter les poser où sa plateforme les attend.

### G5. Les créas programmatiques exigent des champs que `Creative` n'a pas

Vérifié sur l'adapter de distribution Hawk : **Hawk exige des catégories IAB et une URL de clic sur toute créa** — `uploadcreative` répond 400 sans `clickThroughUrl`, audio incluse — les identifiants étant validés contre la **Content Taxonomy 3.x** (`categoriesV3`). Une native exige en plus un titre (l'asset OpenRTB `title`), et une créa VAST en redirection exige une **affiche** (`thumbnail`), Hawk réclamant un `previewUrl`.

**Conséquence.** `iabCategories` sur la `Creative`, avec la version de taxonomie, et le caractère obligatoire déclaré dans le registre de la plateforme — pas supposé. Le `native/assets` de `../../CADRAGE.md` § 9 doit nommer le titre comme obligatoire. Et la preview doit refuser avant l'envoi, pas transmettre un 400.

### G6. Les capacités se déclarent par `(plateforme, levier)`, pas par plateforme

C'est le manque structurant, et il se constate trois fois :

- **ciblage** : Hawk a un garde par canal qui refuse une dimension selon le levier — `os`, `environment`, `ip`, `deviceType` interdits en DOOH ; `multiplier` réservé au DOOH ; GPS, exchanges, placements et supply sur DOOH et DAC seulement ; `appSiteName` sur DOOH, Audio et CTV ; `videoPlayerSize` sur CTV ; ville sur Audio et CTV ; `zipCode` et `metroCode` partout sauf CTV (tout vérifié). Et le commentaire du code dit **pourquoi** cela doit être pré-vérifié : un `os` envoyé sur une feuille DOOH répondait 200 et n'atteignait jamais Hawk — « a silent serve-everywhere », invisible même du détecteur de dérive (relevé live le 2026-09-23) ;
- **créas** : le type de créa Hawk se résout depuis la famille, donc depuis le levier, et « les couples pour lesquels Hawk n'a pas de type (une image TV, une native DOOH) sont refusés » ;
- **capping** : DV360 refuse tout capping sur Demand Gen, c'est-à-dire sur le chemin `dac` de DV360 — pas sur ses chemins `audio` et `ctv_tvs`.

**Conséquence.** Le registre de capacités de `../../CADRAGE.md` § 8 et § 9 est clé sur `(plateforme, levier)`. La règle de support de § 8 — « une dimension qu'aucune plateforme du périmètre ne supporte fait refuser » — se lit donc **à périmètre de levier**. Et le profil de levier reste nécessaire : il dit ce que le _modèle_ permet, le registre dit ce que la _plateforme_ accepte, et l'intersection se calcule et s'affiche dans la preview. Les deux registres ne se remplacent pas.

### G7. Il manque un sous-type de créa, et deux n'existent nulle part

`(video, youtube_id)` manque : le chemin Demand Gen de DV360 — la seule voie d'API vers YouTube, donc le cœur du levier `dac` sur DV360 — prend un **identifiant de vidéo YouTube**, sans aucun octet transmis (vérifié : UCA a un `videoKind: 'youtube'` et « the DSP adapter resolves the video to a DV360 `AdAsset` at push time »).

À l'inverse, deux sous-types de § 9 ne sont acceptés par **aucune** plateforme de nos références : `(display, html5)` et `(display, script_tag)`. Hawk les refuse explicitement (« an HTML5 or inline-HTML display creative has no Hawk image creative equivalent »), et UCA n'a qu'un `inline_html` qui porte son HTML dans ses `formatSpecs`.

**Conséquence.** Ajouter `(video, youtube_id)`. Et ne garder `html5` et `script_tag` en v1 que si une étude de plateforme prouve qu'une plateforme les prend ; sinon les sortir du périmètre, parce qu'un couple que personne n'accepte fait échouer toutes les previews sans servir personne.

### G8. Le levier `audio` n'est pas livrable sur `amazon_dsp` — **résolu (L27)**

Relevé live : la Creative Asset Library d'Amazon n'enregistre que des assets `IMAGE` et `VIDEO` — « an audio creative cannot be mirrored, **even though the DSP serves audio** ».

**Décision (L27, D51) : `amazon_dsp` est retiré du levier `audio`.** Déclarer le couple indisponible dans le registre aurait gardé la porte ouverte, mais aurait aussi laissé une plateforme éligible sur un levier où aucune créa ne peut partir — c'est-à-dire une preview qui bloque à chaque fois, pour tout le monde. Amazon DSP ne sert plus que `ctv_tvs`. Le levier `audio` devient `hawk` + `dv360`.

### G9. GAM n'est pas un DSP, et le modèle le traite comme tel

GAM est le **serveur publicitaire d'un éditeur**. Vérifié : MBP y crée des Line Items `STANDARD` avec une **priorité commerciale** (8 par défaut, « lower is stronger »), un `costType: CPM`, une **rotation de créas** (`EVEN`), et un objectif en impressions. Son rapport ne donne **aucun coût** mais un revenu. Chez MBP cela fonctionne parce qu'Azerion est lui-même éditeur et possède son réseau GAM. **Omnipotent n'est pas éditeur.**

**Décision (L26, D50) : GAM est retiré du périmètre.** Omnipotent passe à **onze plateformes**. C'est le retrait qui rapporte le plus de tout le cadrage, parce que GAM était à lui seul la cause de quatre complications :

- il était la **seule** plateforme où la courbe de budget journalière et le pacing n'avaient pas de sens (rapport sans coût) — la ligne « courbe de budget » de la grille devient transverse sans exception ;
- il était le seul à **exiger un objectif en impressions**, donc le principal argument pour un second porteur de budget (G3) ;
- il apportait trois notions de serveur publicitaire que le modèle n'a pas — **priorité commerciale**, **type de coût**, **rotation de créas** ;
- et il supposait un accès au réseau GAM d'un éditeur, c'est-à-dire une dépendance commerciale sans rapport avec l'achat média.

### G10. Les référentiels par plateforme n'existent pas, et sans eux le DOOH n'est pas composable

MBP expose **trente** routes de découverte (`/dsp-discovery/:dsp/...` : audiences, segments, deals, inventory sources, supply sources, catégories de POI, catégories de produits, ad units, placements, clés et valeurs de ciblage personnalisé, catalogues d'appareils, référentiels de codes postaux, de bundles, d'éditeurs, de placements, de supply, de grilles, de retargeting, langues…). Ce n'est pas un confort : **on ne compose pas un ciblage programmatique sans parcourir le catalogue de la plateforme**, parce que les valeurs sont des identifiants opaques qu'elle seule connaît. `../../CADRAGE.md` § 8 ne prévoit qu'Omniscient.

**Omniscient étant hors périmètre pour le moment, cette surface devient le seul chemin pour choisir de l'inventaire DOOH** — et L29 tranche lequel : **une liste enregistrée chez Hawk, référencée par son uuid.** Un parc d'écrans n'est donc pas une sélection qu'Omnipotent compose, c'est une liste qu'il **désigne**. Il reste à relever lequel des quatre référentiels de Hawk porte des écrans (`tagId` / placements, `supplyIds`, `appSiteName`, geohash) : c'est la route que l'interface appellera, et MBP a une route de découverte pour chacune des quatre.

**Conséquence.** Une surface transverse de **référentiels de plateforme** — une route par nature, la plateforme en paramètre, un cache, et la nature déclarée dans le registre de capacités. Le retrait d'Omniscient et L29 la font passer de « confort de composition » à **prérequis de la phase DOOH** : sans la route qui liste les listes, personne ne peut choisir un parc d'écrans.

### G11. L'identité sociale manque

Vérifié : créer une annonce demande un `page_id` chez Meta, un `identity_id` chez TikTok, un `profile_id` chez Snap. Sans identité, rien ne se crée.

**Conséquence.** Un jeu d'identités par plateforme sur `AdvertiserAdAccount` — le sous-advertiser de `../../CADRAGE.md` § 12 est exactement le bon endroit, puisque c'est la marque chez cette plateforme. La preview bloque un lancement `social` sans identité, avec un code stable.

### G12. Les mentions légales manquent : DSA et publicité politique

Vérifié : Meta **refuse la création d'un ad set sur un compte européen sans `dsa_beneficiary`**, et accepte un `dsa_payor` qui vaut le bénéficiaire par défaut. MBP les range dans les credentials de la **connexion**, donc au niveau de l'organisation — ce qui est faux : le bénéficiaire est **l'annonceur**. Par ailleurs l'Order Hawk porte un bloc `PoliticalDetails` dont tous les champs sont obligatoires dès qu'il est envoyé, y compris les six champs de commanditaire et un `originOfTheAmounts` à valeurs fermées.

**Conséquence.** `dsaBeneficiary` et `dsaPayor` sur l'`Advertiser`, surchargeables par campagne, exigés par la preview dès qu'une plateforme européenne est au périmètre. Et une position explicite sur la publicité politique — `../../A-FAIRE.md` § 15 porte déjà l'engagement exigé par Google ; il faut décider si Omnipotent la refuse tout court (le plus simple) ou modélise les déclarations.

### G13. Le capping est un cap unique, les plateformes et les briefs en veulent une pile

`../../CADRAGE.md` § 4 et D10 décrivent **un** cap. Le modèle canonique de MBP est une **pile** (`CappingConfig[]`) avec un moteur de projection par plateforme, et chaque plateforme dégrade autrement (tout vérifié) :

| Plateforme | Caps simultanés | Périodes exprimables                          | Plafond                                      | « illimité » exprimable                        |
| ---------- | --------------- | --------------------------------------------- | -------------------------------------------- | ---------------------------------------------- |
| Hawk       | **1**           | les cinq                                      | **30** (relevé live : 31 refusé, 30 accepté) | oui                                            |
| DV360      | **1**           | 4 ; `lifetime` approximé à 30 jours glissants | aucun connu                                  | oui — **sauf Demand Gen, qui refuse tout cap** |
| Amazon DSP | plusieurs       | 4 ; `lifetime` approximé à 60 jours           | —                                            | oui                                            |
| Meta       | plusieurs       | `lifetime` approximé à 90 jours               | oui, écrêtage visible                        | **non**                                        |
| TikTok     | **1**           | 3 ; `lifetime` approximé                      | oui                                          | **non** — et obligatoire sur l'objectif REACH  |
| Snap       | **1**           | 4 ; `lifetime` approximé à 30 jours           | aucun relevé                                 | oui                                            |
| OpenAI     | **0**           | aucune                                        | —                                            | oui                                            |

« 3 par jour **et** 10 au total » est un brief ordinaire. Un cap unique ne sait pas l'écrire.

**Conséquence.** Le capping devient une **liste** de caps à chaque niveau. `{ unlimited: true }` garde son sens de surcharge explicite (D10) mais n'est **pas toujours exprimable** : la preview doit le dire. Et une plateforme peut **exiger** un cap (TikTok sur REACH) — ce que le profil de levier ne sait pas exprimer, puisque ce n'est ni un levier ni un niveau : cela appartient au registre de plateforme, couplé à l'objectif de G2. Le moteur de dégradation — entrée la plus restrictive, écrêtage visible, approximation nommée — est à écrire une fois, pas par adapter.

### G14. Le type de campagne `ads | products` est au mauvais niveau

Multi-search le porte sur la **Campaign** et le filtre produit sur l'AdGroup (vérifié). Avec six leviers par campagne, une campagne ne peut pas être « Produits » dans son ensemble.

**Conséquence.** Le mode descend sur le **Lever** — un levier `search` en mode Produits — et le **filtre produit devient une dimension de ciblage du TargetingGroup**, ce qui est cohérent avec D14 (« tout le ciblage sur le TargetingGroup ») : choisir les produits qu'une unité diffuse _est_ un ciblage.

### G15. La marge commerciale et le numéro d'ordre d'insertion

Vérifié : **Hawk ne diffuse pas sans numéro d'ordre d'insertion** sur le Mediaplan (MBP en dérive un de l'identifiant de campagne quand il n'y en a pas), et l'Order porte `components.margin`, `marginRate` et `extraCPM`. MBP y pousse des valeurs neutres faute de modèle, et son rapport Hawk remonte une colonne `agencyMargin`.

**Conséquence.** Deux décisions. **Le numéro d'ordre d'insertion** est une référence commerciale qui a sa place sur la Campaign — toute agence en a un, et Hawk l'exige. **La marge** est plus lourde : la modéliser fait entrer Omnipotent dans la revente ; ne pas la modéliser oblige à pousser 0 chez Hawk, ce que MBP fait déjà. Je recommande de **ne pas la modéliser en v1** et de l'écrire comme tel, pour que ce soit un choix et non un oubli.

### G16. La projection manque pour `social`

Le tableau de `../../CADRAGE.md` § 7 a cinq colonnes et n'en a aucune pour Meta, TikTok ni Snap. Or c'est lui qui décide où vit l'objectif de G2. (GAM y manquait aussi ; L26 l'a réglé en le retirant.)

**Conséquence (retenue avec L4).** `AdGroup → Campaign` de la plateforme (qui porte l'objectif et le budget), `TargetingGroup → ad set / ad squad / ad group` (qui porte le ciblage, le capping et l'enchère), `Line → annonce`. Ce n'est pas ce que fait MBP, qui mappe notre Campaign sur la campagne Meta, mais c'est le motif déjà retenu pour Google et il garde l'objectif au bon endroit.

### G17. Les deals côté SSP n'ont pas de sens pour nous

MBP modélise un deal des **deux** côtés : `ssp_deals` sur Magnite, Equativ, Soundcast, Authorized Buyers et AdsWizz, et `dsp_deals` sur Hawk, DV360 et Amazon (vérifié). C'est logique chez Azerion, qui est aussi vendeur. Omnipotent achète.

**Conséquence.** Ne garder que le côté DSP : un deal est un identifiant, un CPM, un type (PMP ou PG), un pays, un exchange et les leviers qu'il sert. `../../CADRAGE.md` § 11 dit « côté SSP et côté DSP » : à corriger, sauf si Lorin veut modéliser la négociation avec les SSP, ce qui serait un autre produit.

### G18. La devise peut varier à l'intérieur d'une plateforme

`../../CADRAGE.md` § 12 range la devise sur l'`AdAccount`, et D22 fige un taux à l'ajout de la plateforme. Chez Hawk, vérifié : **l'argent est par Line**, « one organization can mix currencies », et l'adapter de reporting déclare la devise de compte à `XXX` (« no currency ») en prenant celle de **chaque ligne de rapport**.

**Conséquence.** Pour Hawk, la devise n'est pas une propriété de compte : elle se lit par unité de diffusion. Le taux figé de D22 doit alors être figé **par unité**, ce que `reporting.md` § 5 prévoit déjà en parlant du « taux figé de l'unité de diffusion ». À vérifier dans la phase Hawk, mais à ne pas découvrir à ce moment-là.

---

## 4. Ce que les profils de levier doivent déclarer

`../../CADRAGE.md` § 5 prévoit quatre déclarations par levier : les niveaux où budget, dates et capping sont `obligatoire | permis | interdit`, les plateformes éligibles, les dimensions de ciblage qui ont un sens, les formats de créa acceptés. L'étude en ajoute **sept**, et impose une séparation.

### La séparation : deux registres, et leur intersection

|         | Le **profil de levier**                | Le **registre de plateforme**                     |
| ------- | -------------------------------------- | ------------------------------------------------- |
| Clé     | `levier`                               | `(plateforme, levier)`                            |
| Dit     | ce que **le modèle** permet d'exprimer | ce que **la plateforme** accepte                  |
| Produit | un refus en **400** à l'écriture       | un **avertissement** ou une **erreur** de preview |
| Exemple | capping `interdit` sur `search`        | Hawk n'exprime qu'un cap, plafonné à 30           |

Les deux ne se remplacent pas, et c'est la réponse à la question « faut-il une stratégie par paradigme, ou le profil suffit-il ? » : **le profil déclare l'ensemble permis, le registre l'intersecte, la preview affiche la perte.** Aucun `if (lever === …)` nulle part, conformément à § 5 — mais pas de `if (platform === …)` non plus.

### Les sept déclarations à ajouter au profil

1. **L'unité d'achat et les stratégies d'enchères permises**, avec leur défaut (G1).
2. **Les objectifs permis et le défaut**, et si l'objectif est immuable après lancement (G2).
3. **Si la saisie en volume est permise**, et dans quelle unité — impressions, diffusions, complétions (L25). Le montant reste la vérité ; l'unité dit seulement ce que l'utilisateur a le droit de saisir.
4. **Si les deals sont permis**, et si le mélange PG + PMP doit être refusé sur un même TargetingGroup (G17).
5. **Si le script de suivi unique s'applique**, et si l'objectif de conversion peut avoir la plateforme pour source (G11 du Search, DOOH mis à part).
6. **Si le mode Produits s'applique** (G14).
7. **Les familles de métriques attendues au rapport**, qui alimentent directement la déclaration de couverture de `reporting.md` § 8 — un rapport `dooh` doit annoncer `plays`, un rapport `audio` et `ctv_tvs` les quartiles, un rapport `search` la part d'impressions.

### Les quatre déclarations à ajouter au registre de plateforme

Au-delà de ce que `reporting.md` § 9 prévoit déjà pour le reporting :

1. **Les couples `(format, subtype)` acceptés** — déjà prévu en D37, mais à clé `(plateforme, levier)` (G6).
2. **Les dimensions de ciblage acceptées** et les granularités géo, à la même clé (G6).
3. **La capacité de capping** : nombre de caps, périodes exprimables, approximations, plafond, et si « illimité » est exprimable, et s'il est **obligatoire** (G13).
4. **Les champs que la plateforme exige** et que le modèle ne rend pas obligatoires : catégories IAB, URL de clic, identité, bénéficiaire DSA, numéro d'ordre d'insertion (G5, G11, G12, G15).

### Et l'application au Search, par symétrie avec D12

D12 fixe `budget: interdit` sur la `Line` en Search, et explique pourquoi : les N Lines d'un TargetingGroup deviennent N annonces RSA dans un seul ad group Google. L'étude ajoute une deuxième application du même mécanisme : **`capping: interdit` à tous les niveaux sur le levier `search`**, puisqu'aucune de ses cinq plateformes ne sait l'exprimer. Et une troisième, symétrique : **`deals: interdit` sur `search` et sur `social`**.

---

## 5. Les décisions

**L1 → L24 sont validées** (2026-10-25). **L25 → L28** sont les réponses de Lorin aux questions produit, reprises dans `../../CADRAGE.md` sous D49, D50 et D51.

|         | Décision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Fonde    |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **L1**  | **Aucun levier ne demande un niveau de plus** : l'arbre linéaire des cinq niveaux tient sur les six paradigmes. Tout ce qui manque manque en champs et en registres                                                                                                                                                                                                                                                                                                                                                                | § 1, § 3 |
| **L2**  | Les capacités se déclarent sur **deux registres** : le **profil de levier** (clé `levier`, dit ce que le modèle permet, refuse en 400) et le **registre de plateforme** (clé **`(plateforme, levier)`**, dit ce que la plateforme accepte, produit erreurs et avertissements de preview). La preview affiche l'intersection et la perte                                                                                                                                                                                            | G6       |
| **L3**  | Les **enchères** descendent sur l'**AdGroup** (stratégie + montant), le **montant étant surchargeable sur le TargetingGroup**. Le profil de levier déclare les stratégies permises ; l'énumération s'étend au-delà des quatre du Search (`fixed_cpm`, `target_cpc`, `maximize_reach`, CPCV) et prévoit le cas « le prix vient du deal »                                                                                                                                                                                            | G1       |
| **L4**  | Un champ **`objective`** sur l'**AdGroup**, défaut et liste donnés par le profil de levier, **immuable après lancement** ; il conditionne enchères, enchère sur conversion et capping. Le changer relève de la restructuration de D40                                                                                                                                                                                                                                                                                              | G2       |
| **L5**  | **Le capping devient une liste de caps** à chaque niveau, avec un moteur de dégradation unique : entrée la plus restrictive quand la plateforme n'en prend qu'un, écrêtage visible au plafond, approximation nommée de `lifetime`. `{unlimited:true}` garde son sens, mais la preview dit où il n'est pas exprimable                                                                                                                                                                                                               | G13      |
| **L6**  | **`capping: interdit` sur le levier `search`** : aucune de ses cinq plateformes ne l'exprime. Un capping sur une campagne Search est refusé en 400, pas averti en preview                                                                                                                                                                                                                                                                                                                                                          | § 2, G13 |
| **L7**  | **`deals: interdit` sur `search` et `social`** ; permis sur les quatre leviers programmatiques, conformément à l'énumération `devices` de MBP                                                                                                                                                                                                                                                                                                                                                                                      | § 2      |
| **L8**  | Un **TargetingGroup ne peut pas mélanger un deal PG et un deal PMP** ; attacher un deal PG à un TG lancé déclenche la restructuration de D40, annoncée par la preview                                                                                                                                                                                                                                                                                                                                                              | G17      |
| **L9**  | **Seul le côté DSP des deals est modélisé.** `../../CADRAGE.md` § 11 est corrigé : pas d'entité de deal côté SSP                                                                                                                                                                                                                                                                                                                                                                                                                   | G17      |
| **L10** | La **courbe de budget journalière est transverse aux six leviers, sans exception**. Hawk prend un `daily.budget`, DV360 un `dailyMaxMicros` ou des segments de budget : le budget du jour calculé par notre pacing se pousse partout. Une seule réserve à porter dans le profil, et elle est contractuelle : les **deals PG**, où la courbe est une contrainte et où un jour à 0 € est une rupture d'engagement, pas une pause                                                                                                     | § 2, L26 |
| **L11** | **Les objectifs de conversion sont transverses**, entité et registre par plateforme compris ; **le DOOH est spécifique** : sa conversion est une visite dont la **source est la plateforme**, sans projection d'un événement à nous                                                                                                                                                                                                                                                                                                | § 2      |
| **L12** | **Le script de suivi unique est transverse et sans objet en DOOH.** Son extension est un registre de balises par plateforme. La balise de DV360 est **Floodlight**, donc un accès Campaign Manager 360 : à régler dans la phase DV360                                                                                                                                                                                                                                                                                              | § 2      |
| **L13** | **Catalogues et Produits restent propres au Search** — les quatre plateformes du levier les consomment. Meta Advantage+ catalog et la DCO sont des extensions nommées, hors v1                                                                                                                                                                                                                                                                                                                                                     | § 2      |
| **L14** | Le mode **`ads \| products` descend sur le Lever**, et le **filtre produit devient une dimension de ciblage du TargetingGroup**                                                                                                                                                                                                                                                                                                                                                                                                    | G14      |
| **L15** | **Keyword ideas et volumes restent propres au Search.** Les mots-clés comme **dimension de ciblage contextuel** restent disponibles sur `audio`, `ctv_tvs` et `dac` via DV360 et Amazon                                                                                                                                                                                                                                                                                                                                            | § 2      |
| **L16** | **Les liens d'agence restent propres à Google et Microsoft.** Les autres plateformes n'ont qu'un jeu de credentials par organisation ; le partenariat Business Manager / Business Center est une extension nommée                                                                                                                                                                                                                                                                                                                  | § 2      |
| **L17** | **Le référentiel géo est transverse**, avec **une seule source en v1** : l'administratif, pivoté sur les identifiants Google, plus une résolution par plateforme. Les objets non administratifs (cercles, polygones, grilles) se saisissent en coordonnées. La granularité acceptée est déclarée à la clé `(plateforme, levier)`                                                                                                                                                                                                   | § 2      |
| **L18** | La **`Line` gagne une charge utile** : une surcharge facultative de page de destination. Les **traceurs tiers** sont portés par la **version de créa**, avec surcharge possible sur la Line ; chaque adapter les pose où sa plateforme les attend                                                                                                                                                                                                                                                                                  | G4       |
| **L19** | La **`Creative` gagne `iabCategories`** (avec sa version de taxonomie) ; le caractère obligatoire des catégories IAB et de l'URL de clic est déclaré par plateforme. Le titre devient obligatoire sur `native/assets`                                                                                                                                                                                                                                                                                                              | G5       |
| **L20** | **`(video, youtube_id)` est ajouté** aux couples de D37. **`(display, html5)` et `(display, script_tag)` sortent du périmètre v1** sauf si une étude de plateforme prouve qu'une plateforme les accepte                                                                                                                                                                                                                                                                                                                            | G7       |
| **L21** | **Les identités sociales** (`page_id`, `identity_id`, `profile_id`) sont portées par `AdvertiserAdAccount` ; la preview bloque un lancement `social` sans identité                                                                                                                                                                                                                                                                                                                                                                 | G11      |
| **L22** | **`dsaBeneficiary` et `dsaPayor` sur l'`Advertiser`**, surchargeables par campagne, exigés par la preview dès qu'une plateforme européenne est au périmètre                                                                                                                                                                                                                                                                                                                                                                        | G12      |
| **L23** | Une surface transverse de **référentiels de plateforme** (une route par nature, la plateforme en paramètre, un cache, la nature déclarée au registre) devient une **phase du plan**. Sans elle, aucun ciblage programmatique n'est composable                                                                                                                                                                                                                                                                                      | G10      |
| **L24** | **La marge commerciale n'est pas modélisée en v1** (valeurs neutres chez Hawk, comme MBP). En revanche le **numéro d'ordre d'insertion** est porté par la Campaign, parce que Hawk ne diffuse pas sans lui                                                                                                                                                                                                                                                                                                                         | G15      |
| **L25** | **Le budget est toujours en argent.** Un **objectif en volume** (impressions, diffusions, complétions) est une **façon de le saisir** : converti via le CPM d'enchère, c'est le **montant** qui est stocké, le volume restant à côté comme la saisie qui l'a produit. L'algèbre du budget ne change pas. Saisir un volume sans CPM est un 400                                                                                                                                                                                      | G3       |
| **L26** | **GAM est retiré du périmètre** : serveur publicitaire d'un éditeur, pas un DSP, et Omnipotent n'est pas éditeur. **Onze plateformes.** `ctv_tvs` devient `hawk`/`dv360`/`amazon_dsp`, `dac` devient `hawk`/`dv360`                                                                                                                                                                                                                                                                                                                | G9       |
| **L27** | **`amazon_dsp` est retiré du levier `audio`** : sa bibliothèque d'assets n'enregistre pas d'audio. `audio` devient `hawk`/`dv360` ; Amazon DSP ne sert plus que `ctv_tvs`                                                                                                                                                                                                                                                                                                                                                          | G8       |
| **L28** | **Omniscient est hors périmètre pour le moment.** Le DOOH se compose avec les **référentiels de Hawk** seuls, ce qui rend L23 décisive et non plus seulement utile. T5 de `../../CADRAGE.md` reste la doctrine du jour où Omniscient revient                                                                                                                                                                                                                                                                                       | G10      |
| **L29** | **Un parc d'écrans DOOH est une liste enregistrée chez Hawk, référencée par son uuid.** Le TargetingGroup stocke l'identifiant de la liste plus ses valeurs dénormalisées (nom, nombre d'éléments) — le motif `*Referential` de MBP, la doctrine T5. Trois conséquences assumées : la liste se **compose dans la console Hawk**, hors d'Omnipotent ; **L23 devient un prérequis de la phase DOOH** et non un confort ; et un budget par écran est hors de portée — c'est **un budget par liste**, donc un TargetingGroup par liste | G10      |

### Les questions produit, tranchées le 2026-10-25

|        | Question                                    | Réponse                                                                                   |
| ------ | ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Q1** | Acheter en volume, ou seulement en argent ? | **Toujours en argent**, avec une saisie possible en volume convertie via le CPM → **L25** |
| **Q2** | Sur quel réseau GAM réservons-nous ?        | **On retire GAM** → **L26**                                                               |
| **Q3** | `amazon_dsp` reste-t-il dans `audio` ?      | **On le retire** → **L27**                                                                |
| **Q4** | Omniscient                                  | **Hors périmètre pour le moment** → **L28**                                               |

---

## 6. Ce qui reste à relever sur un compte réel

Ces points sont dans `../../A-FAIRE.md` ; ils sont rappelés ici parce que **trois cases de la grille en dépendent** (les `?`).

| À relever                                                                                                                                                                                                                                                                         | Décide                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Hawk, DV360 et Amazon DSP acceptent-ils un événement de conversion envoyé par un navigateur, et savent-ils l'attribuer à une exposition **audio** ou **CTV** ?                                                                                                                    | les deux `?` de « script de suivi unique » et de « objectifs de conversion » sur `audio` et `ctv_tvs`                                         |
| Comment Hawk mesure-t-il sa `conversion` et sa `visit` : panel de mobilité, pixel, postback ? Y a-t-il une déclaration d'objectif côté Hawk ?                                                                                                                                     | la forme de l'objectif de conversion « à source plateforme » (L11)                                                                            |
| **Lequel des quatre référentiels de Hawk porte des écrans** : `tagId` (placements), `supplyIds`, `appSiteName`, geohash ? MBP a une route de découverte pour chacun. Et accessoirement : **qui compose ces listes chez un client** — lui dans la console Hawk, ou nous pour lui ? | la route que l'interface appelle, et la façon d'onboarder un annonceur DOOH. La **forme** est tranchée par L29, il ne reste que le « lequel » |
| Google réserve-t-il bien le capping à ses campagnes Display et Vidéo, à l'exclusion du Search ?                                                                                                                                                                                   | L6, qui refuse en 400 au lieu d'avertir                                                                                                       |
| Dans quelle devise Hawk exprime-t-il l'argent d'une Line, et peut-on l'imposer ?                                                                                                                                                                                                  | G18 et la portée du taux figé de D22                                                                                                          |
| Meta, TikTok et Snap : quels objectifs ouvrent l'enchère sur conversion, et lesquels sont immuables ?                                                                                                                                                                             | la liste permise de L4                                                                                                                        |
