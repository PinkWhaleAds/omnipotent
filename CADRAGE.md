# Omnipotent — document de cadrage

Ce document fixe ce qu'est Omnipotent, ce qu'il reprend, ce qu'il simplifie et ce qu'il refuse. Il est la référence pour écrire ensuite le plan de développement (`backend/docs/plan.md`, découpé en phases, à la manière de multi-search).

Écrit le 2026-10-24, après le cadrage avec Lorin. Aucune ligne de code n'existe encore. Ce que tu dois faire de ton côté est dans `A-FAIRE.md`.

---

## 1. Le projet en une page

Omnipotent est une **API d'achat média multi-plateformes** : on y conçoit une campagne une fois, et elle est déclinée, lancée et pilotée chez chaque plateforme publicitaire choisie, puis mesurée avec le détail par plateforme.

Il couvre **six leviers** — Search, DOOH, Audio, Social, CTV & TVS, DAC — sur **onze plateformes**.

Il naît de deux constats :

- **MBP** (Azerion) sait acheter sur beaucoup de plateformes, mais son modèle est trop complexe (modes de budget `fixed/percentage/auto`, prêt et emprunt entre nœuds, grille à deux dimensions `line × targetingGroup`, niveau `Layer` dont la logique n'a jamais été implémentée) et la qualité du code n'est pas au niveau.
- **multi-search** (MS) fait la même chose sur le Search uniquement, mais **simplement et bien** : arbre de budget additif, courbe journalière, synchronisation par état voulu, `draft → preview → launch`, droits dans les services, 100 % de couverture.

Omnipotent = **la couverture de MBP avec la simplicité et les conventions de MS**, plus le Search.

Dans un second temps, le back de multi-search est **remplacé** par Omnipotent : un levier `search` est créé automatiquement dans chaque campagne, et le front de multi-search s'adapte pour consommer Omnipotent. Omnipotent ne s'adapte à personne et ne porte aucun legacy.

**Aucun projet n'est en production, aucun client n'existe.** Rien n'est à migrer, tout peut être cassé.

---

## 2. Les quatre projets observés, et la règle de réutilisation

| Projet | Chemin | Rôle pour Omnipotent |
| --- | --- | --- |
| `fastify-boilerplate` | `~/OmniAd/fastify-boilerplate` | Socle Fastify + Zod + MCP + OTel dont MS est déjà dérivé |
| `multi-search` | `~/OmniAd/multi-search` | **Modèle à suivre** : conventions, modèle de données Search, adapters, infra |
| `mbp-api` | `~/OmniAd/mbp/mbp-api` | **Référence de lecture** : ce qu'une plateforme multi-DSP doit savoir faire |
| `meta-dsp-lib` | `~/OmniAd/mbp/meta-dsp-lib` | **Référence de lecture** : SDK multi-DSP d'Azerion |

**Règle de réutilisation du code, contraignante :**

- Le code de **MBP et de `meta-dsp-lib` se lit pour comprendre, et ne se recopie jamais.** Ce sont des projets d'Azerion ; l'accès en lecture repose sur un accord avec eux. Aucune ligne n'entre dans Omnipotent.
- Le code de **multi-search est le nôtre**, donc librement réutilisable : conventions, helpers, client OpenAI, modules entiers.

Conséquence directe : les douze adapters de plateformes sont **écrits**, en axios dans le style de MS. `meta-dsp-lib` n'est ni une dépendance ni une source de copie — il n'est d'ailleurs publié que sur le registry privé d'Azerion.

---

## 3. La hiérarchie

```
Seat                        (société cliente)
└── Organization            (espace de travail, porte les comptes plateformes)
    └── Advertiser          (la marque, porte la bibliothèque de créas)
        └── Campaign        budget + dates obligatoires, devise, fuseau, draft/launch
            └── Lever       un canal : search | dooh | audio | social | ctv_tvs | dac
                            porte le choix des plateformes et leur répartition
                └── AdGroup
                    └── TargetingGroup   porte TOUT le ciblage, et un budget
                        └── Line         lien TargetingGroup → Creative
```

Par rapport à MBP : le niveau `Layer` **disparaît** (son escalade `layerLevel` / `activationThreshold` n'est implémentée nulle part dans MBP — seulement dans le seed, les exemples Swagger et la migration), le `TargetingGroup` devient **parent** de la `Line` au lieu d'être son frère, et le niveau `Strategy` est renommé `AdGroup`.

Ce changement de parenté est la simplification la plus importante du projet : chez MBP, `TargetingGroup` et `Line` sont frères, l'unité de diffusion est la **cellule** `line × targetingGroup × platform`, et il faut un solveur avec ordre de service (`fixed → percentage → auto`), partition « capped first-served » et une règle correctrice pour qu'une Line à 10 € sous deux groupes ne résolve pas à 20 €. En rendant l'arbre **linéaire**, tout cela devient une addition.

On n'est pas plus plat que MBP — on lui retire un seul niveau. La simplification est ailleurs : **l'arbre est linéaire, et l'algèbre du budget est une addition.**

### Ce que porte chaque niveau

| Niveau | Budget | Dates | Capping | Plateformes | Ciblage | Statut |
| --- | --- | --- | --- | --- | --- | --- |
| Campaign | **obligatoire** | **obligatoire** | facultatif | — | — | `draft`/`active`/`paused`/`ended`/`archived` |
| Lever | hérite | hérite | facultatif | **choix + répartition** | — | `active`/`paused` |
| AdGroup | hérite | hérite | facultatif | surcharge de la répartition | — | `active`/`paused` |
| TargetingGroup | hérite | — | facultatif | — | **tout** | `active`/`paused` |
| Line | hérite | hérite | facultatif | — | — | `active`/`paused` |

Le `TargetingGroup` n'a **pas** de dates : il représente un ciblage appliqué, pas une période de diffusion.

---

## 4. Budget, dates et capping : l'algèbre

### Budget

- **Obligatoire sur la Campaign.** En dessous, `null` = hérite.
- L'héritage par défaut est la **division égale entre frères**.
- Quand des frères mélangent valeurs explicites et `null` : **les montants explicites sont servis d'abord, les `null` se partagent le reste à parts égales.**
- Un montant explicite qui ferait dépasser le parent est **refusé** : l'invariant `Σ enfants ≤ parent` tient à tous les niveaux.
- Pas de mode `percentage`, pas de mode `auto` explicite, **pas de prêt ni d'emprunt** entre nœuds. Ce sont les trois mécanismes de MBP qu'on supprime.
- Tous les calculs se font en **centimes entiers**, comme MS (`toCents`, `distribute`, `rebalance`), pour que les sommes collent au centime.

### Répartition par plateforme

La répartition est une **clé de distribution, pas un budget**. Elle est choisie sur le **Lever** (en même temps que les plateformes), surchargeable sur l'**AdGroup**, et s'applique multiplicativement à la feuille :

```
budget(nœud, plateforme) = budget_effectif(nœud) × part(plateforme, résolue à l'AdGroup)
```

Un TG à 3 000 € sous un Lever réparti Hawk 40 % / DV360 60 % diffuse 1 200 € sur Hawk et 1 800 € sur DV360. Les budgets de tous les niveaux restent en **devise de campagne et agnostiques de plateforme**.

### Dates

Obligatoires sur la Campaign. En dessous, `null` = la fenêtre du parent ; une surcharge doit être **incluse** dans celle du parent.

### Capping

Facultatif aux cinq niveaux. `null` = hérite du parent ; `{ unlimited: true }` = surcharge explicite « pas de cap » ; une configuration = un cap. Le modèle canonique est celui de MBP (« au plus N impressions par période et par utilisateur », périodes `hour | day | week | month | lifetime`, pas de fenêtre multi-unités puisque certaines plateformes n'acceptent que des périodes unitaires). Une plateforme qui ne sait pas l'exprimer fidèlement produit un **avertissement** dans la preview, jamais une approximation silencieuse.

### Courbe journalière

- Un jour = un montant. Par défaut `budget / nombre de jours`, chaque jour modifiable, avec des presets.
- Un jour **verrouillé** garde son montant quand les autres sont recalculés.
- Un jour à 0 € ne diffuse pas : on met en pause, puis on réactive.
- Définie sur la Campaign ; **tout niveau portant un budget explicite peut avoir la sienne**, les autres suivent la forme du parent au prorata.
- Une **seule table** `budget_days`, clé `(level, nodeId, day)` — pas une table par niveau.

### Pacing

Le pacing **n'est pas un job**. C'est une fonction pure, calculée **à l'intérieur de la synchronisation**, comme partie de l'état voulu. Pour le jour courant elle donne : total prévu, prévu à date, reste (prévu − dépensé avant aujourd'hui, jamais négatif), **budget du jour = le reste réparti sur les jours restants en gardant la forme de la courbe**, et un statut (`on_track` / `underspending` / `overspending` / `budget_reached`).

Un job qui « pousserait les budgets » créerait une seconde source de vérité à côté de la synchro. Il n'y en a pas.

**Fuseaux** : le jour est celui de la Campaign (ou de l'Organization à défaut). Chaque compte plateforme a son propre fuseau : le budget d'un jour plateforme est calculé **au prorata des heures qui se chevauchent** entre les deux. Les pauses des jours à 0 se font à minuit, heure de la campagne.

**Devise** : choisie à la création de la campagne. Si le compte plateforme a une autre devise, on convertit au taux BCE **figé au moment où la plateforme est ajoutée** — un mouvement de change ne réécrit jamais un plan existant.

---

## 5. Profils de levier

Tout ce qui varie d'un levier à l'autre vit dans **un registre déclaratif**, pas dans des conditions dispersées. Pour chaque levier, le profil déclare :

- à quels niveaux le **budget**, les **dates** et le **capping** sont `obligatoire | permis | interdit` ;
- quelles **plateformes** sont éligibles ;
- quelles **dimensions de ciblage** ont un sens ;
- quels **formats de créa** sont acceptés.

Aucun `if (lever === 'search')` nulle part dans le code.

### `interdit` n'est pas `null`

C'est la distinction qui fait tout fonctionner :

| État | Signification | Budget effectif ? |
| --- | --- | --- |
| `obligatoire` | le champ doit être rempli | oui, explicite |
| `permis` | `null` = hérite par division, une valeur = explicite | **oui** |
| `interdit` | le champ **doit être absent** | **non, aucun** |

Avec `permis` + `null`, le niveau a quand même un budget effectif (sa part par division) : il est donc **candidat** à devenir son propre objet porteur de budget chez la plateforme. Avec `interdit`, il n'en a aucun, donc il ne peut jamais le devenir.

**Application au Search** : `budget` est `interdit` sur la `Line`. Les N Lines d'un TargetingGroup deviennent donc **N annonces RSA dans un seul ad group Google**, ce qui préserve la rotation et l'optimisation d'annonces de Google — au lieu de N campagnes séparées. L'API refuse un budget sur une Line Search en 400, et l'adapter n'a aucune question à se poser.

Avoir des comportements différents par levier est assumé : c'est le rôle du profil de les rendre explicites et testables.

---

## 6. Matrice levier × plateforme

Reprise de MBP, à cinq changements près : OpenAI quitte `dac`, le levier `search` est créé, `gaming` est supprimé, **GAM est retiré** (D50) et **Amazon DSP quitte `audio`** (D51).

| Levier | Plateformes |
| --- | --- |
| `search` | Google Ads, Microsoft Advertising, OpenAI, Thrad, **Amazon Search** |
| `dooh` | Hawk |
| `audio` | Hawk, DV360 |
| `ctv_tvs` | Hawk, DV360, Amazon DSP |
| `dac` | Hawk, DV360 |
| `social` | Meta, TikTok, Snap |

Une plateforme peut servir **plusieurs leviers** (DV360 en sert trois). Un levier ne peut apparaître **qu'une fois par campagne**, sinon le levier `search` auto-créé pour multi-search serait ambigu.

**Onze plateformes** : `google_ads`, `microsoft`, `openai`, `thrad`, `amazon_search`, `amazon_dsp`, `dv360`, `hawk`, `meta`, `tiktok`, `snap`.

Amazon compte pour **deux plateformes distinctes** : API différentes, types de compte différents, donc deux adapters et deux entrées dans l'enum. Les stubs non intégrés de MBP (`azerion`, `youtube`, `mgid`) sont supprimés — YouTube reste atteint via DV360 sur `dac`.

**Pourquoi GAM sort** (décidé le 2026-10-25, cadrage des leviers G9) : GAM n'est pas un DSP mais le **serveur publicitaire d'un éditeur** — on y réserve des Line Items avec une priorité commerciale et un objectif en impressions, et son rapport donne un **revenu, jamais un coût**. Chez MBP cela fonctionne parce qu'Azerion est lui-même éditeur et possède son réseau. Omnipotent ne l'est pas. Conséquence heureuse : GAM était la **seule** plateforme sur laquelle la courbe de budget journalière et le pacing n'avaient pas de sens.

**Pourquoi Amazon DSP sort d'`audio`** (G8) : sa Creative Asset Library n'enregistre que des assets `IMAGE` et `VIDEO` (relevé live chez MBP), donc une créa audio ne peut pas y être poussée — « even though the DSP serves audio ». Amazon DSP ne sert plus que `ctv_tvs`.

Hawk est traité **exactement comme n'importe quelle plateforme tierce**, au même titre que DV360 : connexion par son API avec des credentials, aucune dépendance à l'infrastructure d'Azerion.

### À l'étude

`Amazon Search` (retail search), `TikTok Search Ads` et `Pinterest`. Quand TikTok Search Ads arrivera, TikTok sera présent sur `social` **et** `search` : deux intégrations, un même compte. Pas de levier `social_search` — le levier est l'inventaire, pas la famille de plateforme.

---

## 7. Projection sur les plateformes

Chaque adapter déclare à quel objet de sa plateforme correspond chacun de nos niveaux, et à quel niveau sa plateforme peut **tenir un budget**.

| Omnipotent | Google / Microsoft | OpenAI / Thrad | DV360 | Amazon DSP | Hawk |
| --- | --- | --- | --- | --- | --- |
| Campaign | — | — | — | — | Mediaplan |
| AdGroup | **Campaign** (budget) | **Campaign** (budget) | Insertion Order | Campaign | Order *(avec le TG)* |
| TargetingGroup | Ad group (mots-clés, ciblage) | Ad group | Line Item | Ad group | Order *(avec l'AdGroup)* |
| Line | Annonce RSA | 1-3 chat cards / 1 carte | Creative | Ad | Line |
| Statut | prouvé (MS) | prouvé (MS) | à confirmer | à confirmer | lu dans MBP |

Les colonnes Google, Microsoft, OpenAI et Thrad sont **prouvées** : c'est ce que multi-search fait aujourd'hui. Pour Hawk, l'index unique de MBP sur `platform_resources` désambiguïse ses `Order` par `(strategyId, targetingGroupId)` — donc un Order Hawk correspond au couple `(AdGroup, TargetingGroup)`. DV360 et Amazon sont des hypothèses à confirmer dans leur phase.

**Gain par rapport à multi-search** : MS doit faire « 1 AdGroup = 1 campagne Google + 1 ad group » parce qu'il n'a qu'un niveau entre la campagne et l'annonce. Avec le TargetingGroup, on peut avoir **plusieurs ad groups Google sous un même budget**, ce qui est la façon dont Google fonctionne réellement.

### Budget à un niveau que la plateforme ne porte pas : l'éclatement

Google ne tient un budget que sur la campagne. Un budget explicite sur un TargetingGroup n'a donc pas d'objet où se poser. La règle retenue est **l'éclatement** : ce TargetingGroup devient **sa propre campagne Google**, et la preview l'annonce (« 3 campagnes Google au lieu d'une »).

C'est ce qui rend le **budget par POI** possible partout, y compris en Search. Un seul cas particulier, confiné dans l'adapter, et visible avant le lancement. Il ne peut pas se cumuler puisque le budget reste `interdit` sur la Line en Search.

Trois garde-fous le rendent sûr : la synchronisation par hash ne coûte **aucun appel** quand rien n'a changé ; la preview affiche le nombre d'objets qui seront créés chez chaque plateforme ; un **plafond configurable** de campagnes plateforme par AdGroup est refusé par la preview au-delà.

### Changer la projection après le lancement

Ajouter un budget sur un TargetingGroup d'un AdGroup **déjà lancé** change sa projection : ce qui était une campagne Google doit en devenir trois. **C'est autorisé.** L'interdire signifierait « il faut savoir à la création si tu voudras un jour un budget par POI », ce qui est irréaliste — et multi-search pose déjà la règle inverse : tout est modifiable après le lancement, sauf ce que les plateformes figent.

La restructuration est portée par l'adapter, de façon idempotente : il crée les nouveaux objets, y porte les ad groups et les annonces, puis **met en pause et archive les anciens** — jamais de suppression, pour garder l'historique.

Deux conséquences à assumer, et la preview doit les **annoncer explicitement** :

- **Notre reporting ne perd rien.** La table de faits est clé sur **nos** entités (campagne, levier, AdGroup, TargetingGroup, Line), pas sur les identifiants plateforme. Un changement d'identifiant ne casse donc aucun agrégat. Il faut pour cela conserver l'**historique des identifiants externes** : une table **append-only**, une ligne par changement, jamais modifiée ni supprimée, pour qu'un rapport portant sur les jours précédents — et qui porte encore l'ancien identifiant — retrouve la bonne entité. MBP a exactement cette table (`external_id_history`) et pour exactement cette raison : « its delivery reports keep the OLD id for the days before the change ». Une première matérialisation (pas d'identifiant → un identifiant) n'est pas un changement et ne s'enregistre pas.
- **L'historique d'optimisation de la plateforme, lui, est perdu.** Une nouvelle campagne Google repart sans apprentissage et ses annonces repassent en validation. Sur une stratégie « maximiser les conversions », c'est un coût réel. La preview doit l'écrire en clair : « cette modification recrée 3 campagnes Google : l'apprentissage et les validations repartent de zéro ».

La même règle vaut pour **tout** changement qui modifie la projection : retirer le budget d'un TargetingGroup, ou retirer une plateforme d'un levier — ce qui la met en pause chez elle, sans rien y supprimer.

---

## 8. Ciblage

**Tout le ciblage vit sur le `TargetingGroup`.** L'AdGroup et la Line n'en portent aucun. Les mots-clés, les mots-clés négatifs et les `context_hints` en font partie.

- On supporte **toutes les dimensions de MBP** (une soixantaine : géo, POI, proximité, audiences, segments, devices, OS, navigateurs, exchanges, inventaire, brand safety, viewabilité, genres et durées de contenu, formats vidéo, plages horaires, clés-valeurs, listes…).
- Chaque dimension est un **schéma Zod** dédié, enregistré dans un registre, plus un **traducteur par plateforme**.
- Le ciblage est stocké en **un seul objet** sur le TargetingGroup (map `type → critères`), pas en lignes : écriture atomique, pas de N+1, un seul aller-retour pour composer l'état voulu. Le registre par dimension et le registre de capacités par plateforme restent identiques.
- **Règle de support** : une dimension qu'**aucune** plateforme du périmètre ne supporte fait **refuser** la création. Dès qu'au moins une la supporte, elle est **écartée** des plateformes qui ne la gèrent pas, avec un **avertissement** dans la preview.
- Un TargetingGroup **sans aucun critère est valide** : il ne restreint rien.
- Un AdGroup a **toujours au moins un TargetingGroup**. En Search, le levier et le TargetingGroup unique sont **créés automatiquement**.

### Le piège du budget mal ciblé

Si un TargetingGroup utilise une dimension que seule une plateforme du périmètre supporte (un rayon autour d'un POI, par exemple), la part des autres plateformes diffuse **sans cette restriction** — ce qui est l'inverse de l'intention. La preview doit le **nommer explicitement** : « le TargetingGroup *X* utilise un ciblage POI que DV360 ne sait pas appliquer : 1 800 € y seront diffusés sans cette restriction ». L'utilisateur corrige en réglant la répartition de son AdGroup.

Un filtre de plateformes sur le TargetingGroup a été envisagé puis **écarté** : dans le cas normal (tous les TG d'un AdGroup sont dans la même situation), régler la répartition de l'AdGroup suffit, et la surcharge existe déjà. Le filtre reste en réserve si le cas mixte se présente vraiment.

### Listes

Les **listes réutilisables** (sites, apps, devices, POI) sont au niveau **Organization** et sont référencées par les critères de ciblage des TargetingGroups.

Un `seat_admin` peut **dupliquer** une liste vers une autre Organization de son Seat, et la **déplacer**. Le déplacement est **refusé quand la liste est encore référencée** par un ciblage de l'Organization d'origine, avec un code d'erreur qui propose la duplication — sinon on laisserait derrière lui des ciblages pointant vers une liste devenue invisible.

### Référentiels externes

Omniscient (produit interne : écrans DOOH, régies, IRIS, zones, POI, audiences, personas, segments) est utilisé pour le ciblage POI et zone et la sélection d'écrans, selon un partage net :

- **Exploration** : le front appelle Omniscient **en direct**. Proxyfier des cartes, des grilles et des séries d'audience doublerait la latence et imposerait un passe-plat par endpoint.
- **Persistance et exécution** : Omnipotent stocke les **identifiants choisis** plus les **valeurs dénormalisées dont les adapters ont besoin** (nom, coordonnées, régie, pays), et n'appelle Omniscient que pour **résoudre et valider** à l'écriture.

Règle de fond : **une panne d'Omniscient doit empêcher de composer un ciblage, jamais de diffuser ce qui est déjà composé.** C'est le même principe que le référentiel géo de MS, qui garde l'id Google *et* son nom plutôt que de rappeler Google à la synchro.

---

## 9. Créas

- Une **bibliothèque par Advertiser**.
- Une entité `Creative` avec **deux** discriminants : le **`format`** (le type d'inventaire visé) et le **`subtype`** (la façon dont la créa arrive à la plateforme), chacun avec sa charge utile.
- Les **octets** vivent dans des `Asset` — une créa n'est jamais les octets (voir plus bas).
- Un **cache d'upload par plateforme** évite de renvoyer un asset déjà transmis.
- Le **statut de validation est suivi par plateforme**. Aucune validation interne : on ne fait que refléter le verdict de chaque plateforme, visible dans l'API et les tools MCP.
- Une `Line` est **unique par `(TargetingGroup, Creative)`**.

### Formats et sous-types

| `format` | `subtype` | Ce que c'est |
| --- | --- | --- |
| `search_text` | `rsa` | Titres et descriptions ; déclinés en chat cards chez OpenAI et en carte sponsorisée chez Thrad |
| `display` | `image` | Une image hébergée |
| `display` | `html5` | Un bundle HTML5 hébergé |
| `display` | `script_tag` | Un tag publicitaire tiers, servi par un autre serveur |
| `display` | `mraid` | Une créa rich media mobile utilisant l'API MRAID |
| `video` | `file` | Un fichier vidéo hébergé |
| `video` | `vast_url` | Un VAST tiers en redirection (wrapper) |
| `audio` | `file` | Un fichier audio hébergé |
| `audio` | `vast_url` | Un VAST / DAAST audio tiers |
| `native` | `assets` | Titre, texte, image, appel à l'action |

Le `mraid` que j'avais retiré par erreur est bien là : c'est un **sous-type de display**, pas un format à part. Et les **tags script** comme les **VAST en redirection** sont des sous-types, pas des formats : ce qui change n'est pas l'inventaire visé mais la façon dont la créa arrive à la plateforme.

Ce découpage compte parce que **le registre de capacités déclare, par plateforme, les couples `(format, subtype)` acceptés** — et ils divergent beaucoup : certaines plateformes refusent les tags tiers, certaines plafonnent la profondeur de redirection d'un VAST, certaines n'acceptent que de l'hébergé. Une créa dont le couple n'est accepté par **aucune** plateforme du périmètre fait échouer la preview ; acceptée par certaines seulement, elle produit un avertissement.

### Les assets sont une ressource de premier plan

Un `Asset` n'est pas un simple attachement de créa : c'est une **ressource à part entière de la bibliothèque de l'Advertiser**, avec son CRUD, ses labels et sa recherche.

- **Métadonnées** : type MIME, dimensions, durée, poids, empreinte.
- **Provenance** : `uploaded` (déposé par le client) ou `ai_generated`, avec un lien vers la génération qui l'a produit.
- **Déduplication par empreinte** : redéposer le même fichier ne crée pas un second asset.
- **Lien N-N avec les créas** : un asset sert dans plusieurs créas, une créa utilise plusieurs assets.
- Un asset **utilisé par une créa ne peut pas être supprimé** : soft-delete et refus explicite, jamais de créa cassée.

C'est ce qui prépare la **génération de créas par IA**, dans les deux sens : l'IA produira des **assets bruts** qu'on assemblera ensuite en créas, et le client pourra déposer ses propres assets pour **alimenter** cette génération. Les deux ont besoin que l'asset existe indépendamment de toute créa.

Multi-search a déjà `Asset` et `AiGeneration`, et sa génération d'images est une interface sans implémentation : c'est le point d'accroche.

### Versions immuables

Une créa qui diffuse doit pouvoir être modifiée **sans interrompre la diffusion** pendant que la plateforme re-valide. D'où le modèle versionné : `Creative` + `CreativeVersion`, une version active, la nouvelle prend le relais **quand la plateforme l'a approuvée**. L'ancienne continue de servir entre-temps.

C'est le point sur lequel on s'écarte de multi-search, qui mute la créa en place et détecte les changements par hash — suffisant en Search où la revue est rapide, insuffisant dès qu'une créa tourne sur plusieurs DSP qui la repassent chacune en validation.

### Hors périmètre

Le **rendu de l'ad markup** (ADM) et le DSP interne d'Azerion. MBP a deux services pour ça (`internal-dsp` et `internal-creative-api`) parce qu'Azerion est lui-même vendeur et serveur de publicité. Omnipotent ne diffuse jamais une publicité : il pilote des plateformes tierces, qui servent les annonces.

---

## 10. Labels

Les utilisateurs auront beaucoup de créas, beaucoup d'assets et beaucoup de campagnes. Il leur faut un moyen de retrouver leur travail — mais **pas une arborescence de dossiers** : un label, on peut en poser plusieurs, et une ressource n'a pas à vivre à un seul endroit.

- Un `Label` appartient à une **Organization** : un nom, une couleur, unique par organisation.
- Il se pose sur **n'importe quelle ressource** de l'organisation : campagne, levier, AdGroup, TargetingGroup, Line, créa, asset, liste, advertiser.
- L'affectation passe par **une seule table polymorphe** `(labelId, resourceType, resourceId)`, pas une table de jointure par type de ressource. L'intégrité référentielle est alors portée par l'application et non par la base : c'est le compromis assumé pour qu'ajouter une ressource labélisable ne demande aucune migration. Les ressources étant en soft-delete, une affectation orpheline est inoffensive et nettoyable.
- Toutes les routes de liste acceptent un **filtre par label**. Plusieurs labels se combinent selon `labelMode` ∈ `any | all`, **dont le défaut est `any`** (le OU) : c'est l'usage le plus fréquent — « montre-moi tout ce qui est marqué *Q1* ou *Q2* » — et le ET reste disponible pour croiser deux axes.
- Les labels sont **plats**, volontairement. Pas de hiérarchie, pas de dossier — c'est précisément ce qu'on évite.

Une règle à tenir : un label est un outil d'organisation, **jamais** un porteur de comportement. Rien dans le domaine ne doit décider quoi que ce soit en fonction d'un label, sinon il devient une configuration déguisée que personne ne peut plus déplacer.

## 11. Deals

Les **deals** (PMP et PG, côté SSP et côté DSP) sont conservés : ils sont indispensables en DOOH, CTV et Audio.

Ils sont portés par l'**AdGroup** *et* par le **TargetingGroup**, le TargetingGroup héritant par défaut. Donc : `null` = hérite de l'AdGroup, un tableau = surcharge. **Un tableau vide signifie « explicitement aucun deal »** et n'est pas la même chose que `null` — c'est le piège classique de ce genre d'héritage, et il doit être testé.

---

## 12. Comptes plateformes et sous-advertisers

Le modèle de multi-search, généralisé aux DSP.

- **`AdAccount`** — le périmètre qui porte les credentials, au niveau **Organization** : `platform`, `externalId`, `name`, `currency`, `timezone`, `status` (`pending` / `active` / `invalid`), `secretName`, plus un `scope` pour ce que la plateforme exige au-dessus (partner DV360, profil Amazon). La devise et le fuseau sont **lus chez la plateforme** et stockés, parce que le pacing et le change en ont besoin.
- **`AdvertiserAdAccount`** — le **sous-advertiser**, au niveau **Advertiser** : `advertiserId × platform × currency → adAccountId`, plus **`externalAdvertiserId`** (l'advertiser DV360, l'advertiser Amazon, le compte pub Meta, l'advertiser Hawk).
- **Les secrets vont dans AWS Secrets Manager.** Postgres ne garde que leur nom. Un secret ne passe **jamais** par un tool MCP ni par une conversation.
- Le **cycle de vie du lien** est modélisé : demande, acceptation, refus, expiration, révocation.

Pourquoi pas le `DspConnection` de MBP, qui stocke les credentials en jsonb dans Postgres et n'autorise qu'une connexion par `(organisation, DSP)` : les secrets en base interdisent la rotation et l'audit propres, et la contrainte d'unicité empêche une organisation d'utiliser plusieurs comptes d'une même plateforme (plusieurs advertisers, plusieurs devises). MBP a d'ailleurs dû ajouter cet index unique en urgence après qu'une seconde connexion ait détourné silencieusement tout le trafic d'une plateforme.

---

## 13. Cycle de vie : `draft → preview → launch`

Repris de multi-search et étendu à **tous** les leviers.

- **`draft`** est un état, uniquement sur la Campaign. Tant qu'elle y est, rien n'est envoyé aux plateformes et elle est enregistrée **en mode permissif** : seules les erreurs structurelles répondent 400. On peut donc sauvegarder une campagne incomplète.
- **`preview`** est une vérification en lecture seule, appelable à tout moment. Elle renvoie ce qui **sera créé** chez chaque plateforme (nombre de campagnes, ad groups, annonces, mots-clés, budget effectif, compte utilisé, taux de change) et une liste de constats séparés en **erreurs** (bloquent le lancement) et **avertissements** (une plateforme ignorera quelque chose), chacun avec un **code stable et ses valeurs** pour la traduction.
- **`launch`** est refusé tant que la preview renvoie une erreur.

La rigueur est donc **à la publication, pas à la saisie**. C'est ce qui permet d'être permissif sans jamais envoyer une campagne invalide.

Statuts : `active` / `paused` aux cinq niveaux. Un AdGroup créé dans une campagne déjà lancée démarre en pause et n'atteint aucune plateforme jusqu'à son activation.

---

## 14. Synchronisation pilotée par l'état

- Chaque plateforme implémente une interface d'adapter commune et passe par un client HTTP unique : clé, timeout, **une ligne de journal par appel**, erreurs typées.
- Chaque modification d'une campagne lancée marque les unités concernées `pending` **dans la même transaction** que la modification, puis met un job de synchro en file.
- Le job construit l'**état voulu** (fonction pure), le **hache**, et **saute** l'unité si le hash est identique au dernier appliqué. Sinon l'adapter applique l'état.
- Les adapters sont **idempotents** : avant de créer quoi que ce soit, ils retrouvent ce qu'une synchro interrompue aurait déjà créé.
- Aucun test unitaire ni d'intégration n'appelle une plateforme : adapters factices.

### Le coût périodique doit être proportionnel au travail en attente, jamais à la taille de la base

C'est un **écart assumé** par rapport à l'implémentation actuelle de multi-search, dont le balayage remet en file une synchro pour **toutes** les campagnes vivantes toutes les 5 minutes. À 10 000 campagnes, cela fait 33 jobs par seconde en continu et plusieurs centaines de requêtes SQL par seconde, pour zéro appel plateforme — et cela grandit linéairement avec les clients.

Omnipotent sépare et borne :

1. **Convergence** — uniquement les unités `pending` ou `error` dont `next_attempt_at <= now`, lues par un index partiel. Une requête indexée par minute en régime établi.
2. **Rafraîchissement du pacing** — par campagne, programmé à **son minuit local** via `next_pacing_at`. Une passe par jour et par campagne, naturellement étalée sur les fuseaux.
3. **Fin de campagne** — un `UPDATE … WHERE` avec le fuseau résolu en SQL, pas une boucle sur le parc.
4. **Jamais charger une campagne propre** — l'état `pending` est écrit dans la même transaction que chaque modification : c'est déjà le bit « sale ». Avec le déclencheur quotidien et celui des statistiques, il n'y a aucune raison de charger l'arbre d'une campagne où rien ne s'est passé.

Plus le **coalescing** (N modifications d'une campagne dans une fenêtre = une synchro) et une prise de travail en `FOR UPDATE SKIP LOCKED` pour que plusieurs workers se partagent le backlog sans verrou global.

Règle générale : **ne jamais compter sur le fait qu'un job a tourné ; toujours pouvoir recalculer la vérité depuis la base.** La base porte l'intention, la plateforme porte l'état, quelque chose réconcilie périodiquement les deux.

---

## 15. Reporting

**C'est le point le plus sous-estimé du projet, et le plus critique pour une plateforme publicitaire.** Il mérite son propre document de cadrage avant d'être implémenté.

### Constat sur l'existant

| | État |
| --- | --- |
| Google, Microsoft, OpenAI, Thrad | **Prouvé** : multi-search a un pull qui tourne. Contrat minimal : `day`, `externalAdId`, `cardKey`, `impressions`, `clicks`, `costMicros`, `conversions`, `conversionValueMicros` — les deux derniers déjà **nullables** « where the platform reports none » |
| Hawk | Client et adapter complets, **plus un adapter de reporting dans le `reporting-worker`** : le rapport réellement demandé porte `impression`, `click`, `visit`, **`conversion`**, les quartiles, les surfaces de visibilité IAB et **sept** colonnes de coût dont `agencyMargin` (corrigé le 2026-10-25 ; les 6 mesures des types de `meta-dsp-lib` étaient une vue partielle). Synchrone |
| DV360 | Types seulement : `IMPRESSIONS`, `CLICKS`, `MEDIA_COST_ADVERTISER`, `TRUEVIEW_VIEWS`, `COMPLETE_LISTENS_VIDEO`. **Asynchrone** (créer une query, poller, télécharger) |
| Amazon DSP | Types seulement : **des centaines de colonnes**, tout l'univers retail (`detailPageViews`, `addToCart`, `purchases`), ses frais propres (`amazonDSPAudienceFee`, `amazonDSPConsoleFee`), `totalCost` ≠ `supplyCost`. **Asynchrone** |
| Meta, TikTok, Snap | Pas de module dans `meta-dsp-lib`, mais **un adapter de reporting complet dans le `reporting-worker` de MBP** (types, normaliseur, ventilations) |
| Amazon Search | **Rien**, nulle part |

**Il existe une référence lisible pour dix plateformes sur onze** — le `reporting-worker` de MBP porte 191 fichiers TypeScript et huit adapters de reporting. Seule Amazon Search n'a rien. *(Corrigé le 2026-10-25 : la première version de ce document affirmait l'inverse, sur la foi du README de `mbp-api`, qui est périmé.)*

### Le modèle

- **Table de faits large à colonnes nullables**, en Postgres, partitionnée par jour. Pas de jsonb pour les nombres : on somme en SQL sans détour. Noyau obligatoire (`impressions`, `clicks`, `costMicros`), puis familles optionnelles — conversions, vidéo (`starts`, `q25`, `q50`, `q75`, `completes`), audio, DOOH (`plays`), search (part d'impressions…).
- **Un registre de capacités de reporting par plateforme**, comme le registre de ciblage et comme les quotas : quelles métriques, quelle granularité, synchrone ou asynchrone, fraîcheur attendue, fréquence de pull, fenêtre de restatement. Le code ne teste jamais un nom de plateforme.
- Les **métriques propres à une plateforme** (le retail Amazon, les POI visités de Hawk) ne polluent pas la table commune : table annexe, visibles seulement dans le rapport de cette plateforme.
- **Coût canonique = ce que l'annonceur paie**, avec le détail conservé à côté quand la plateforme le donne.
- **Fréquence de pull par plateforme**, déclarée, pas globale.
- Lecture derrière **un port de repository**, pour que basculer vers ClickHouse reste contenu dans une implémentation si un jour on veut de l'horaire sur toutes les dimensions ou de l'analytique large. L'ordre de grandeur attendu (quelques millions de lignes par mois) ne le justifie pas aujourd'hui.
- Jobs : pull horaire sur les derniers jours, **backfill quotidien sur 30 jours** — ce n'est pas une précaution, c'est nécessaire parce que les conversions arrivent en retard.

### Les règles non négociables

- **Les trous restent `null`, jamais des zéros.** Un `SUM` sur une colonne que trois plateformes sur cinq remplissent donne un chiffre faux et parfaitement crédible.
- **Un agrégat n'additionne que ce que toutes les plateformes du périmètre remontent.**
- **Aucun écran n'annonce du « temps réel ».** Il n'y a pas de live uniforme : les plateformes synchrones permettent quelques minutes de retard, les asynchrones imposent un cycle créer → poller → télécharger, et les conversions sont toujours en retard partout. Ce qu'on garantit est une **fraîcheur déclarée et affichée par plateforme** (« données arrêtées à 14:05 pour Google, 12:00 pour Amazon »).

### Le problème du mapping, à cadrer

C'est ce qui demandera le plus de travail, et ce n'est pas un renommage de colonnes.

1. **Mapping d'identité** — relier une ligne de rapport à nos entités. Multi-search le fait en partie par un **tag dans le nom** de l'annonce (`adId` est nullable « read from the tag of the ad's name »), ce qui est fragile. Omnipotent doit le faire à partir des **identifiants externes enregistrés à l'écriture**. Le tag reste un filet de secours pour retrouver ce qu'une synchro interrompue a créé.
2. **Mapping de métriques** — au-delà des noms (`impression` / `impressions` / `METRIC_IMPRESSIONS`), les **définitions** diffèrent : un clic Search n'est pas un clic DOOH, une « conversion » dépend de la fenêtre et du modèle d'attribution de chaque plateforme, `videoComplete` chez Hawk n'est pas `COMPLETE_LISTENS_VIDEO` chez DV360. C'est une **traduction avec perte**, et la perte doit être documentée.
3. **Mapping d'unités** — micros, devises, centimes. Le coût arrive dans la **devise du compte** ; un rapport agrégé doit convertir avec le **taux figé de la plateforme**, pas celui du jour, sinon les totaux bougent rétroactivement.
4. **Mapping temporel** — le jour est celui du **compte plateforme**, pas celui de la campagne. Un rapport par jour multi-plateformes additionne des journées qui ne se recouvrent pas exactement. Décision à prendre : garder le jour du compte (fidèle à la facturation) ou reventiler au prorata dans le fuseau de la campagne (fidèle à l'utilisateur, inexact face à la facture). Multi-search garde le jour du compte.
5. **Mapping de granularité** — on **ne répartit jamais une métrique qu'on n'a pas mesurée**. Le rapport s'arrête au niveau le plus fin que la plateforme fournit ; en dessous, c'est « non disponible sur cette plateforme ».
6. **Double comptage des conversions** — si le script de suivi unique transmet chaque conversion à **toutes** les plateformes, chacune s'attribue la même conversion et **la somme surcompte**. Il faut deux colonnes distinctes qui ne s'additionnent jamais : les conversions **attribuées par chaque plateforme** (pour leur optimisation) et celles **mesurées par nous** (pour le rapport). La source de vérité du rapport est notre tracking.

Chaque plateforme fait l'objet d'une **étude reporting dans sa propre phase**, constatée sur un compte réel — les huit points à relever sont dans `A-FAIRE.md` section 13.

---

## 16. Tenancy : le service `omnipass`

Les Seats, Organizations, Users, memberships, invitations et rôles vivent dans un **service séparé**, dépôt `git@github.com:MultiSearchAd/omnipass.git`, partagé par Omnipotent, Omniscient et les projets suivants.

**Pourquoi séparé et pas un module d'Omnipotent** : il y a deux socles de natures différentes. Omnipotent est le socle du domaine **publicitaire** et bougera tous les jours pendant des années ; la tenancy est le socle de l'**identité**, une surface minuscule qui se stabilise en quelques semaines. Mettre la tenancy dans Omnipotent accrocherait la connexion de tous les produits au rythme de release du produit le plus agité — Omniscient ne pourrait plus authentifier personne pendant un déploiement de feature de campagne.

Trois conditions qui le rendent peu coûteux :

1. **Périmètre minuscule** : Users, Seats, Organizations, memberships, invitations, et un **rôle grossier** par `(user, seat)` et `(user, org)`. **Rien d'applicatif.** Chaque app garde « ce rôle peut faire quoi ici » dans ses propres services.
2. **Un package client avec cache en mémoire** (TTL court + invalidation explicite). En régime établi, zéro appel réseau ; en panne, dégradation pendant le TTL au lieu d'un blocage total. Pas de claims de droits dans le token : un admin révoqué garderait ses droits jusqu'à l'expiration du JWT.
3. **Aucune FK inter-bases** : chaque app stocke `organizationId` comme un uuid opaque. omnipass est le **seul writer** de la tenancy ; une suppression se propage par événement ou par réconciliation.

Auth0 fournit l'**identité** uniquement. Le **tenant est partagé** entre les projets : Omnipotent réutilise celui de multi-search, avec ses propres audiences — une pour l'API REST, une pour le serveur MCP, dont un token de l'une n'est jamais accepté par l'autre. Le header `X-Organization-Id` désigne l'Organization sur laquelle on agit. Les droits sont vérifiés **dans les services**, jamais dans les handlers, pour que HTTP, MCP et jobs partagent les mêmes règles. Ce qu'un appelant ne peut pas voir répond **404** ; un rôle trop faible, **403**.

Omniscient sera retravaillé pour consommer omnipass.

---

## 17. Périmètre repris de multi-search

Quand Omnipotent remplacera le back de multi-search, il devra reprendre **tout** MS, pas seulement l'arbre de campagne :

- catalogues et campagnes **Produits** ;
- objectifs de **conversion** et le **script de suivi unique** (une seule balise chez le client, qui charge celles de chaque plateforme et relaie le consentement) ;
- **génération IA** par Claude (titres, descriptions, mots-clés, négatifs, context hints, extensions) — suggestions uniquement, rien n'est appliqué automatiquement ;
- **forecasts**, keyword ideas et volumes de recherche ;
- **liens d'agence** Google et Microsoft ;
- **e-mails**, digests et alertes ;
- **référentiel géo** (géocodage, lieux, codes postaux) ;
- **codes d'erreur stables** et leurs valeurs, pour que le front traduise ;
- **i18n** (français et anglais).

Le partage entre **transverse à tous les leviers** et **propre à un levier** dépend de ce que les plateformes savent faire. L'objectif est **le transverse autant que possible** — mais chaque levier est un paradigme différent (ce qu'on achète, au coût de quoi, ce qui mesure le succès), donc l'étude se mène **levier par levier** et non « Search contre le reste ». Son cadrage est dans `docs/cadrage-leviers.md`.

**L'étude est menée** : son document de référence est `backend/docs/leviers.md` — six fiches de levier, la grille des 14 fonctionnalités, 18 manques du modèle et les décisions L1→L24. Son résultat le plus important : **aucun levier ne réclame un niveau que l'arbre n'a pas**. Tout ce qui manquait manquait en champs et en registres.

---

## 18. La bascule de multi-search

- MS n'a **aucun client**. Son front **et** son back sont **gelés** : aucun travail parallèle dessus pendant le développement d'Omnipotent.
- Au moment de la bascule, le **front de MS s'adapte** pour consommer Omnipotent. Son apparence ne change pas, son intégration oui. **Omnipotent n'expose aucune route de compatibilité** et ne porte aucun legacy.
- Un levier **`search`** et un **TargetingGroup unique** sont créés automatiquement dans chaque campagne. L'utilisateur de MS continue de voir `Campagne → AdGroup → Créas` : l'écran AdGroup éditera l'AdGroup pour le budget et les dates, et son TargetingGroup unique pour le ciblage et les mots-clés.
- Aujourd'hui dans MS, les plateformes et leur répartition se choisissent à la création de la campagne. Après la bascule, ce choix sera en réalité celui du levier `search` — invisible pour l'utilisateur.
- Omnipotent aura **son propre front plus tard**. Dans l'immédiat, un seul front (multi-search) consomme une petite partie d'Omnipotent.
- Le back de MS sera **coupé dans un second temps**, après la bascule.

---

## 19. Conventions techniques

Reprises de multi-search **telles quelles** — ce sont 36 phases de leçons déjà payées.

- **Fastify**, **Zod comme source de vérité unique**, découpage **controller / handler / schema** pour le HTTP comme pour le MCP.
- **Postgres**, **TypeORM**, migrations (jamais `synchronize`), **pg-boss**.
- Une seule image Docker, deux modes : **`api`** (HTTP + MCP) et **`worker`** (jobs). Un troisième mode dédié au pull des statistiques est possible plus tard.
- **Toutes les opérations exposées en tools MCP.**
- **Droits vérifiés dans les services**, jamais dans les handlers.
- **Une seule forme d'erreur**, produite en un seul endroit, avec un **code stable** et ses valeurs.
- **Soft-delete + `restore` + `bulk create/update/delete` sur toutes les ressources**, en all-or-nothing **et** en best-effort au choix de l'appelant. La suppression cascade sur les enfants, `restore` restaure le sous-arbre.
- Les services renvoient des **formes d'API**, jamais des entités.
- Tous les montants en **centimes entiers** dans les calculs.
- **100 % de couverture** de tests unitaires. Jamais d'appel à une plateforme en test.
- **Monorepo pnpm** : `backend/`, `infra/` (pas de `frontend/` pour l'instant).
- **Code et JSDoc en anglais, documentation en français.**
- Un `docs/plan.md` de référence, des phases `docs/phase-N.md` livrables une par une.

### Scalabilité horizontale

Les processus API sont **sans état** (un processus par conteneur, pas de `cluster`, rien en mémoire de module), le MCP est **sans état par défaut** (chaque requête construit son serveur et le jette, donc n'importe quel réplica sert n'importe quelle requête — ne jamais activer son mode *stateful*, qui épinglerait un client à un pod), et les workers sont séparés de l'API et montent en charge indépendamment. pg-boss prend ses jobs en `FOR UPDATE SKIP LOCKED`, donc N workers se partagent la file sans verrou global. Avec D34, le coût périodique est constant et non proportionnel au parc.

Quatre pièces s'ajoutent à ça, et deux d'entre elles sont des pannes classiques si on les oublie :

| | Décision |
| --- | --- |
| **D44** | Un **pooler de connexions** (RDS Proxy ou pgBouncer) dès qu'on dépasse quelques réplicas : N réplicas × un pool chacun épuisent les connexions Postgres bien avant le CPU |
| **D45** | Un **limiteur de débit partagé entre réplicas**, par plateforme — les quotas des plateformes sont **globaux au projet**, et sans compteur partagé chaque réplica croit disposer du quota entier |
| **D46** | Un **verrou par campagne** pour la synchro : le travail se parallélise entre campagnes, jamais à l'intérieur d'une |
| **D47** | Un **jitter** sur le rafraîchissement du pacing à minuit local, pour éviter que toutes les campagnes d'un fuseau se réveillent à la même seconde |
| **D48** | Un **réplica de lecture** pour les rapports quand le volume l'exigera ; le port de repository le rend contenu |

**Le plafond réel n'est pas le nôtre.** Les quotas des plateformes sont globaux : l'accès Basic de Google est de 15 000 opérations par jour **pour tout le projet**, partagées entre tous les clients. Aucun réplica supplémentaire n'ajoute du quota. Le nombre de clients qu'on peut servir est borné par les plateformes, pas par l'architecture — d'où D31 et D45.

### Infrastructure

- **Même compte AWS** que multi-search (le compte Omnilor partagé), région **`eu-north-1`** (Stockholm), avec un **Terraform séparé** et sa **propre instance RDS**. MS sera coupé dans un second temps.
- CI **GitHub Actions**. Secrets dans **Secrets Manager**, chiffrement KMS, images dans ECR, base RDS, fichiers S3.
- Rien de l'infrastructure Azerion ou Hawk.
- Développement local en Docker Compose (Postgres + émulation S3 et Secrets Manager).

---

## 20. Les décisions validées

| # | Décision |
| --- | --- |
| D1 | Matrice levier × plateforme de MBP, OpenAI retiré de `dac`, levier `search` ajouté ; *amendée par D50 et D51* |
| D2 | Les stubs `azerion`, `youtube`, `mgid` sont supprimés |
| D3 | Amazon compte pour deux plateformes : `amazon_dsp` et `amazon_search` |
| D4 | Leviers `search \| dooh \| audio \| social \| ctv_tvs \| dac`, pas de `gaming`, un seul levier par type et par campagne |
| D5 | Plateformes et répartition sur le Lever, surcharge sur l'AdGroup uniquement |
| D6 | Budget et dates obligatoires sur la Campaign ; en dessous `null` = hérite, le budget par division égale |
| D7 | Entre frères, les montants explicites d'abord, les `null` se partagent le reste à parts égales |
| D8 | Un montant explicite qui dépasse le parent est refusé (`Σ enfants ≤ parent`) |
| D9 | Une surcharge de dates doit être incluse dans la fenêtre du parent |
| D10 | Capping facultatif aux 5 niveaux ; `null` = hérite, `{unlimited:true}` = surcharge ; plateforme incapable → avertissement |
| D11 | Courbe sur la Campaign ; tout niveau à budget explicite peut avoir la sienne, les autres suivent au prorata |
| D12 | `interdit` ≠ `null` : champ absent **et** niveau jamais porteur de budget chez la plateforme |
| D13 | Toujours ≥ 1 TargetingGroup par AdGroup ; un TG sans critère est valide ; en Search levier et TG auto-créés |
| D14 | Tout le ciblage sur le TargetingGroup, mots-clés, négatifs et `context_hints` inclus |
| D15 | Deals sur l'AdGroup et le TG, le TG hérite ; tableau vide = « aucun deal », distinct de `null` |
| D16 | Listes au niveau Organization, référencées par les critères du TG |
| D17 | Une `Line` est unique par `(TargetingGroup, Creative)` |
| D18 | `draft` seulement sur la Campaign ; `active`/`paused` aux 5 niveaux ; `draft → preview → launch` pour tous les leviers |
| D19 | Soft-delete + `restore` + bulk sur toutes les ressources ; suppression en cascade, restauration du sous-arbre |
| D20 | *Corrigée par D37* — une entité `Creative` par Advertiser, discriminant de format, octets dans des `Asset` |
| D21 | Monorepo pnpm, conventions MS, un Postgres, une image, modes `api`/`worker`, MCP complet, droits dans les services, 100 % de couverture |
| D22 | Devise choisie à la création, taux BCE figé à l'ajout de la plateforme ; budget du jour au prorata des fuseaux |
| D23 | **Onze** adapters écrits en axios style MS ; Search d'abord, puis DV360, Hawk, Social, Amazon DSP |
| D24 | Études : Amazon Search, TikTok Search Ads, Pinterest, et transverse vs propre au Search |
| D25 | *Précisée par D30* — le back de multi-search est gelé |
| D26 | *Retirée* — pas de filtre de plateformes sur le TG ; la répartition de l'AdGroup suffit, la preview avertit |
| D27 | Une seule table `budget_days`, clé `(level, nodeId, day)` |
| D28 | Le pacing n'est pas un job : fonction pure calculée dans la synchro |
| D29 | TikTok sur `social` **et** `search` quand TikTok Search Ads arrivera ; pas de levier `social_search` |
| D30 | Front **et** back de multi-search gelés, aucun travail parallèle dessus |
| D31 | Accès Standard à l'API Google Ads demandé ; la preview affiche le nombre d'objets créés, avec un plafond configurable |
| D32 | Statistiques en Postgres derrière un port de repository ; ClickHouse remis à plus tard |
| D33 | Le lien TargetingGroup ↔ Creative s'appelle `Line` |
| D34 | Synchro périodique pilotée par l'état, pas par un balayage du parc (les 4 règles de la section 14) |
| D35 | Table de faits large à colonnes nullables, registre de capacités de reporting, coût canonique, fréquence par plateforme, trous `null` jamais zéros |
| D36 | MBP et `meta-dsp-lib` se lisent sans jamais être recopiés ; le code de multi-search est réutilisable |
| D37 | Créas à **deux** discriminants `format` + `subtype` ; `mraid` rétabli comme sous-type de display ; tags script et VAST en redirection sont des sous-types ; le registre de capacités déclare les couples acceptés par plateforme |
| D38 | `Asset` est une ressource de premier plan : CRUD, provenance `uploaded`/`ai_generated`, déduplication par empreinte, lien N-N avec les créas, suppression refusée s'il est utilisé |
| D39 | Labels plats et multiples sur **toutes** les ressources, table polymorphe, filtre `labelMode` ∈ `any \| all` **avec `any` par défaut**, et jamais porteurs de comportement |
| D40 | Changer la projection après le lancement est **autorisé** : restructuration idempotente, anciens objets mis en pause et archivés, historique append-only des identifiants externes, conséquences annoncées par la preview |
| D41 | Les listes restent au niveau Organization ; un `seat_admin` peut les dupliquer et les déplacer entre Organizations de son Seat, le déplacement étant refusé si la liste est référencée |
| D42 | Infra : `eu-north-1`, propre instance RDS, Terraform séparé, tenant Auth0 partagé avec celui de multi-search et des audiences propres |
| D43 | omnipass est développé **en parallèle** ; Omnipotent démarre derrière l'interface `AccessService` avec une implémentation locale, et **refuse de démarrer en production** sans omnipass |
| D44 | Un **pooler de connexions** dès qu'on dépasse quelques réplicas |
| D45 | Un **limiteur de débit partagé entre réplicas** par plateforme — les quotas sont globaux au projet |
| D46 | Un **verrou par campagne** pour la synchro |
| D47 | Un **jitter** sur le rafraîchissement du pacing à minuit local |
| D48 | Un **réplica de lecture** pour les rapports quand le volume l'exigera |
| D49 | Le budget est **toujours en argent**. Un **objectif en volume** (impressions, diffusions, complétions) est une **façon de le saisir** : il est converti en argent à la saisie via le CPM, et c'est le montant qui est stocké. L'algèbre du budget ne change pas |
| D50 | **GAM est retiré du périmètre** — serveur publicitaire d'un éditeur, pas un DSP (§ 6). **Onze plateformes** |
| D51 | **Amazon DSP est retiré du levier `audio`** — sa bibliothèque d'assets n'enregistre pas d'audio (§ 6) |
| L1→L24 | Les leviers : voir `backend/docs/leviers.md`, validées le 2026-10-25 |
| R1→R14 | Le reporting : voir `backend/docs/reporting.md`. **R9 (nos propres conversions) est reporté en V2** |
| T1 | La tenancy vit dans un service séparé, `omnipass` |
| T2 | Périmètre d'omnipass : identité et tenancy seulement, rôle grossier, rien d'applicatif |
| T3 | Consommation par un package client avec cache en mémoire ; pas de droits dans le token |
| T4 | Aucune FK inter-bases ; omnipass est le seul writer de la tenancy |
| T5 | Omniscient : exploration en direct depuis le front, résolution serveur-à-serveur, identifiants et valeurs dénormalisées stockés chez nous |

---

## 21. Ce qui reste ouvert

| Sujet | Nature |
| --- | --- |
| **Nos propres conversions (R9)** | Reporté en **V2** : attribution au clic, sans laquelle aucun total de conversions multi-plateformes n'est exact |
| **Référentiels de plateforme** | L23 — parcourir les catalogues de chaque plateforme (audiences, segments, deals, inventaire, placements, écrans). Sans eux, aucun ciblage programmatique n'est composable. **Une phase à inscrire au plan** |
| **Omniscient** | **Hors périmètre pour le moment** (décidé le 2026-10-25). T5 reste la doctrine du jour où il revient ; d'ici là le DOOH se compose avec les référentiels de Hawk seuls |
| **Amazon Search, TikTok Search Ads, Pinterest** | `docs/cadrage-plateforme.md`, partie « faisabilité », avant de les inscrire au plan |
| **Projection DV360 et Amazon DSP** | `docs/cadrage-plateforme.md` — les hypothèses de la section 7 à confirmer dans leur phase |
| **Limites d'objets Google et Microsoft** | `A-FAIRE.md` section 5 — un relevé de dix minutes, pour régler le plafond d'éclatement |
| **Couples `(format, subtype)` par plateforme** | `docs/cadrage-plateforme.md` — un relevé par plateforme |
| **Migration d'Omniscient vers omnipass** | Plus tard : Omniscient est encore en développement et n'entre pas dans le périmètre actuel |
| **Génération d'images** | Multi-search a une interface sans implémentation ; à décider |
| **Front d'Omnipotent** | Plus tard |
| **Filtre de plateformes sur le TargetingGroup** | En réserve, si le cas mixte se présente |

---

## 22. Prochaines étapes

1. ~~Mener le cadrage du reporting~~ et ~~le cadrage des leviers~~ : **faits**, `backend/docs/reporting.md` et `backend/docs/leviers.md`.
2. **Écrire `backend/docs/plan.md`** : le plan de développement découpé en phases, chacune livrable et testable, à la manière de multi-search.
3. **Construire omnipass** (`~/OmniAd/omnipass/HANDOVER.md`), en parallèle.
4. **Initialiser le backend** depuis les conventions de multi-search.
5. Lancer les démarches de `A-FAIRE.md`, en commençant par ce qui a des délais : l'accès Standard chez Google, le statut de partenaire OpenAI, et les accords commerciaux DV360 et Amazon DSP.

Les documents de cadrage sont listés dans `docs/README.md`. Chacun est autoportant : une session le prend, mène l'étude, et produit le document de référence qu'il décrit.
