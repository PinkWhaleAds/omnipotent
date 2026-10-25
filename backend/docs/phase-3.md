# Phase 3 — L'arbre de campagne

Contrat de la phase 3. Les cinq niveaux de l'arbre, les **profils de levier**, et l'**algèbre du
budget**. C'est le cœur du produit : tout ce qui vient après projette cet arbre sur une plateforme.

Prérequis : la phase 2 (le CRUD de référence, que les cinq ressources recopient). **Aucun appel à une
plateforme**, aucun adapter, aucune preview.

Entrées validées : `../../CADRAGE.md` § 3, § 4, § 5, § 6, § 10, § 13 (D8 à D14, D22, D40, D49), et
`leviers.md` — L1 → L29, dont les sept déclarations à ajouter au profil (§ 4) et les manques du
modèle (§ 3).

---

## 1. Les cinq niveaux

```
Advertiser                                    (phase 2)
└── Campaign          budget + dates obligatoires, devise, fuseau, draft
    └── Lever         un canal, le choix des plateformes et leur répartition
        └── AdGroup   l'objet porteur de budget chez les plateformes : enchère et objectif
            └── TargetingGroup   tout le ciblage (phase 5), surcharge du montant d'enchère
                └── Line         lien TargetingGroup → Creative (phase 6)
```

Ce que chaque niveau porte, une fois l'étude des leviers intégrée — les trois dernières colonnes sont
ce que la phase ajoute au tableau de `../../CADRAGE.md` § 3 :

| Niveau           | Budget          | Dates           | Capping    | Plateformes              | Enchère                  | Objectif     | Autre                            |
| ---------------- | --------------- | --------------- | ---------- | ------------------------ | ------------------------ | ------------ | -------------------------------- |
| `Campaign`       | **obligatoire** | **obligatoire** | facultatif | —                        | —                        | —            | devise, fuseau, n° d'ordre       |
| `Lever`          | hérite          | hérite          | facultatif | **choix + répartition**  | —                        | —            | mode `ads \| products`           |
| `AdGroup`        | hérite          | hérite          | facultatif | surcharge de répartition | **stratégie + montant**  | **le porte** | —                                |
| `TargetingGroup` | hérite          | —               | facultatif | —                        | surcharge du **montant** | —            | ciblage (phase 5)                |
| `Line`           | hérite          | hérite          | facultatif | —                        | —                        | —            | surcharge de page de destination |

- `Lever` est unique par `(campaignId, lever)` : une campagne porte au plus un levier de chaque canal.
- `TargetingGroup` n'a **pas** de dates : c'est un ciblage appliqué, pas une période de diffusion.
- Les cinq niveaux deviennent **labélisables** (`../../CADRAGE.md` § 10) : la phase ajoute
  `campaign`, `lever`, `ad_group`, `targeting_group` et `line` à l'énumération applicative des types
  de ressource — **sans migration**, ce qui est exactement ce que D39 achetait.

## 2. Les profils de levier

Un registre déclaratif, `src/levers/lever-profiles.ts`, clé sur le **levier**. Le reste du code ne
teste jamais un nom de levier, par symétrie avec `src/platforms/platform-rules.ts` (`CLAUDE.md`).

Ce que le profil déclare, pour chaque levier :

| Déclaration                                                             | Vient de           | Rempli par                                             |
| ----------------------------------------------------------------------- | ------------------ | ------------------------------------------------------ |
| Budget, dates, capping par niveau — `obligatoire \| permis \| interdit` | § 5, D12, L6       | **cette phase**                                        |
| Plateformes éligibles                                                   | § 6                | **cette phase**                                        |
| Unité d'achat, stratégies d'enchères permises et défaut                 | L3                 | **cette phase**                                        |
| Objectifs permis, défaut, immuabilité                                   | L4                 | **cette phase**, voir § 9.1                            |
| Saisie en volume permise, et son unité                                  | L25                | **cette phase**                                        |
| Deals permis, et refus du mélange PG + PMP                              | L7, L8             | **cette phase** (le drapeau ; l'entité est à sa phase) |
| Mode Produits permis                                                    | L14                | **cette phase**                                        |
| Script de suivi et objectif de conversion à source plateforme           | L11, L12           | la phase des conversions                               |
| Dimensions de ciblage qui ont un sens                                   | § 8                | la phase du ciblage                                    |
| Formats de créa acceptés                                                | § 9, L19, L20      | la phase des créas                                     |
| Familles de métriques attendues                                         | `reporting.md` § 8 | la phase du reporting                                  |

**Le profil n'est pas le registre de plateforme** (L2) : le profil dit ce que **le modèle** permet
d'exprimer et refuse en **400 à l'écriture** ; le registre dit ce que **la plateforme** accepte et
produit une erreur ou un avertissement de **preview**. Les deux cohabitent, la preview affiche
l'intersection. Un champ laissé vide dans le profil de cette phase est une déclaration **absente**,
pas une déclaration permissive : la phase qui la remplit la remplit pour les six leviers d'un coup.

Trois applications déjà tranchées, et elles sont le test du mécanisme :

- `budget: interdit` sur la `Line` du levier `search` (D12) — les N Lines d'un TargetingGroup
  deviennent N annonces RSA dans un seul ad group Google ;
- `capping: interdit` à **tous** les niveaux du levier `search` (L6) — aucune de ses plateformes ne
  sait l'exprimer, donc c'est un 400, pas un avertissement ;
- `deals: interdit` sur `search` et `social` (L7).

## 3. L'algèbre du budget

Le cœur, et la partie à ne pas rater : elle est pure, testable sans base, et tout le reste s'appuie
dessus. En **centimes entiers**, en devise de campagne, agnostique de plateforme.

### 3.1 L'héritage

- **Obligatoire sur la Campaign**, `null` en dessous = hérite.
- L'héritage par défaut est la **division égale entre frères**.
- Frères mélangés : **les montants explicites sont servis d'abord, les `null` se partagent le reste à
  parts égales**.
- Un montant explicite qui ferait dépasser le parent est **refusé en 400** : `Σ enfants ≤ parent`
  tient à tous les niveaux.
- Pas de pourcentage, pas de mode `auto`, **ni prêt ni emprunt** entre nœuds (D8).
- Un niveau dont le profil dit `budget: interdit` n'a **aucun** budget effectif : il ne compte pas
  dans la division de ses frères, et ne peut jamais porter de courbe (§ 5 de `../../CADRAGE.md`).

### 3.2 La répartition par plateforme

Une **clé de distribution, pas un budget** : choisie sur le `Lever` avec les plateformes,
surchargeable sur l'`AdGroup`, appliquée multiplicativement à la feuille.

```
budget(nœud, plateforme) = budget_effectif(nœud) × part(plateforme, résolue à l'AdGroup)
```

Les parts somment à 100 % — en centièmes de point entiers, pour que trois plateformes à parts égales
ne perdent pas un centime.

### 3.3 La saisie en volume (L25)

L'utilisateur peut saisir « 500 000 impressions » au lieu d'un montant. La saisie est convertie via
le **CPM d'enchère** de L3, et c'est le **montant** qui est stocké ; le volume est conservé à côté
comme la saisie qui l'a produit.

- Saisir un volume **sans CPM** est un **400**, jamais une estimation implicite.
- Le montant est **recalculé dans la même requête** quand le volume ou le CPM change : pas de job, pas
  de second porteur de vérité, même doctrine que le pacing.
- Le volume est **indicatif** et ne doit jamais être présenté comme un engagement de livraison.

### 3.4 La résolution ne se stocke pas

Le budget effectif d'un nœud est **calculé à la lecture**, jamais écrit en base. Une valeur stockée
serait fausse dès qu'un frère change, et il faudrait un job pour la rattraper — donc une seconde
source de vérité. Chaque nœud renvoie :

```json
{
  "budget": {
    "explicitCents": null,
    "effectiveCents": 150000,
    "source": "inherited",
    "volume": null,
    "perPlatform": [{ "platform": "hawk", "shareBasisPoints": 4000, "cents": 60000 }]
  }
}
```

`source` ∈ `explicit | inherited | forbidden`, pour que le front sache s'il affiche une valeur saisie
ou une part calculée.

## 4. Dates, capping, enchère, objectif

**Dates.** Obligatoires sur la Campaign. En dessous, `null` = la fenêtre du parent ; une surcharge
doit être **incluse** dans celle du parent, sinon 400.

**Capping.** Une **liste** de caps à chaque niveau (L5), chacun « au plus N impressions par période
et par utilisateur », période ∈ `hour | day | week | month | lifetime`. « 3 par jour **et** 10 au
total » est un brief ordinaire : un cap unique ne savait pas l'écrire. `null` = hérite du parent ;
une liste **vide** = « explicitement aucun cap », la surcharge explicite de D10. Le moteur de
dégradation par plateforme (entrée la plus restrictive, écrêtage visible, approximation de
`lifetime` nommée) appartient à la preview, pas à cette phase.

**Enchère** (L3). `bidStrategy` + `bidAmountCents` sur l'`AdGroup`, **montant surchargeable sur le
TargetingGroup** qui est l'objet d'enchère réel chez les plateformes. L'énumération dépasse les
quatre stratégies du Search : `fixed_cpm`, `target_cpc`, `maximize_reach`, une forme CPCV, et
`from_deal` — le cas où le prix vient du deal et où aucune stratégie ne s'applique. Le profil déclare
les permises et le défaut.

**Objectif** (L4). `objective` sur l'`AdGroup`, liste et défaut donnés par le profil, **immuable
après lancement**. Il conditionne les stratégies disponibles, l'enchère à la conversion et parfois le
capping. Le lancement n'existant pas encore, cette phase pose le champ et sa validation par le
profil ; **la garde d'immuabilité arrive avec le cycle de vie** (phase 8), et le document de cette
phase-là doit la reprendre.

## 5. Statuts : ce que la phase pose, et ce qu'elle ne pose pas

- `draft` est un état de la **Campaign** seule. Une campagne y naît.
- `active | paused` aux cinq niveaux, `ended | archived` sur la Campaign.
- Cette phase pose les **colonnes** et leurs valeurs permises. Les **transitions** —
  `draft → preview → launch`, l'AdGroup créé en pause dans une campagne lancée, le refus de lancer
  sur une erreur de preview — appartiennent à la phase 8.

## 6. Ce qui est refusé à l'écriture, et ce qui attend la preview

`../../CADRAGE.md` § 13 est clair : **la rigueur est à la publication, pas à la saisie**. On doit
pouvoir enregistrer une campagne incomplète. Mais « incomplète » n'est pas « impossible », et la
frontière est celle-ci :

| Refusé en **400** à l'écriture                                   | Pourquoi                                                                    |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Un champ que le profil déclare `interdit`                        | Le modèle ne sait pas l'exprimer : ce n'est pas un manque, c'est une erreur |
| `Σ enfants > parent`                                             | L'algèbre ne doit jamais tenir un état impossible                           |
| Une fenêtre de dates hors de celle du parent                     | Même raison                                                                 |
| Une part de plateforme dont la somme ne fait pas 100 %           | Même raison                                                                 |
| Une plateforme hors des éligibles du levier                      | Le profil le sait sans appeler personne                                     |
| Un volume saisi sans CPM                                         | L25                                                                         |
| Une valeur hors de l'énumération du profil (stratégie, objectif) | Le profil le sait                                                           |
| Sur la Campaign : budget, dates, devise manquants à la création  | Ce sont ses colonnes obligatoires, pas de la complétude                     |

| Laissé passer, et rapporté par la **preview** (phase 8)                | Pourquoi                                       |
| ---------------------------------------------------------------------- | ---------------------------------------------- |
| Un Lever sans AdGroup, un AdGroup sans TargetingGroup, un TG sans Line | C'est une campagne en cours de saisie          |
| Un objectif absent là où le profil en demande un                       | Le défaut du profil s'applique au lancement    |
| Ce qu'une plateforme n'exprime pas (cap écrêté, `lifetime` approximé)  | C'est le registre de plateforme, pas le modèle |
| Tout ce qui demande d'appeler une plateforme                           | Aucun appel dans cette phase                   |

## 7. Les routes

La convention de multi-search, transcrite : **lister et créer sous le parent**, **lire, modifier et
supprimer à plat** sur la ressource.

| Ressource        | Sous le parent                    | À plat                  |
| ---------------- | --------------------------------- | ----------------------- |
| `Campaign`       | `/advertisers/:id/campaigns`      | `/campaigns/:id`        |
| `Lever`          | `/campaigns/:id/levers`           | `/levers/:id`           |
| `AdGroup`        | `/levers/:id/ad-groups`           | `/ad-groups/:id`        |
| `TargetingGroup` | `/ad-groups/:id/targeting-groups` | `/targeting-groups/:id` |
| `Line`           | `/targeting-groups/:id/lines`     | `/lines/:id`            |

Chacune porte le **CRUD de référence** de la phase 2 au complet — soft-delete, `restore`, bulk
`atomic | partial`, pagination, tri, recherche, filtre par labels, pose de labels — avec deux
aménagements :

- la création en lot vit **sous le parent** (`POST /levers/:id/ad-groups/bulk`), la modification, la
  suppression et la restauration en lot **à plat** (`PATCH /ad-groups/bulk`), puisque chaque id porte
  déjà son parent ;
- le `Lever` **n'a pas de routes de lot** : une campagne en porte au plus un par canal, un lot de 200
  n'a aucun sens.

Toutes org-scoped, le rôle vérifié **dans le service**. Chacune a son tool MCP du même nom en
`kebab-case` (D21).

La suppression **cascade** sur le sous-arbre et `restore` restaure le sous-arbre (D19) : c'est la
phase où le mécanisme travaille pour de vrai, les deux ressources de la phase 2 n'ayant pas d'enfant.

## 8. Les codes d'erreur de la phase

| Code                         | Statut | Quand                                                                 | `params`                       |
| ---------------------------- | ------ | --------------------------------------------------------------------- | ------------------------------ |
| `<resource>_not_found`       | 404    | Absent, supprimé, ou d'une autre Organization — pour les cinq niveaux | `{}`                           |
| `lever_already_exists`       | 409    | La campagne porte déjà ce levier                                      | `lever`                        |
| `lever_field_forbidden`      | 400    | Le profil déclare ce champ `interdit` à ce niveau                     | `lever`, `level`, `field`      |
| `budget_exceeds_parent`      | 400    | `Σ enfants > parent`                                                  | `parentCents`, `childrenCents` |
| `dates_outside_parent`       | 400    | La fenêtre sort de celle du parent                                    | `parentStart`, `parentEnd`     |
| `platform_shares_invalid`    | 400    | Les parts ne somment pas à 100 %                                      | `total`                        |
| `platform_share_duplicated`  | 400    | La même plateforme apparaît deux fois dans une répartition            | `platform`                     |
| `dates_reversed`             | 400    | La fenêtre se termine avant de commencer                              | `startsOn`, `endsOn`           |
| `volume_not_permitted`       | 400    | Le levier n'accepte pas de saisie en volume dans cette unité (L25)    | `unit`, `lever`                |
| `platform_not_eligible`      | 400    | La plateforme n'est pas éligible à ce levier                          | `platform`, `lever`            |
| `bid_strategy_not_permitted` | 400    | Stratégie hors de celles que le profil permet                         | `strategy`, `lever`            |
| `objective_not_permitted`    | 400    | Objectif hors de ceux que le profil permet                            | `objective`, `lever`           |
| `volume_without_bid`         | 400    | Saisie en volume sans CPM d'enchère (L25)                             | `unit`                         |
| `currency_unknown`           | 400    | Devise hors de la liste ISO 4217 retenue                              | `currency`                     |

## 9. Ce que je te demande de valider

Les points que je ne peux pas déduire, ou qui touchent une décision déjà prise.

### 9.1 Les listes d'objectifs ne sont connues que pour le Search

L4 veut une liste permise par levier. Elle est connue pour `search` (Google et Microsoft), mais pour
`social` elle dépend de ce que Meta, TikTok et Snap ouvrent à l'enchère sur conversion — un point de
`../../A-FAIRE.md` à relever sur un compte réel. **Ma proposition** : la phase livre le mécanisme et
remplit `search` ; les autres leviers reçoivent un objectif par défaut unique et sûr, et leur liste
complète arrive avec l'étude de leur première plateforme. Le profil porte alors une déclaration
_incomplète_ et assumée, pas une déclaration permissive.

### 9.2 Le capping « illimité » devient une liste vide

D10 exprime « pas de cap » par `{ unlimited: true }`. Le capping devenant une liste (L5), **je
propose qu'une liste vide porte ce sens** : `null` hérite, `[]` dit explicitement « aucun cap », une
liste non vide donne la pile. Même sens que D10, sans type union, et c'est déjà la convention des
deals (`../../CADRAGE.md` § 11 : tableau vide = explicitement aucun deal). **Je touche la forme de
D10, pas son sens** — d'où cette ligne.

### 9.3 La devise est obligatoire, le fuseau a un défaut

Le `Snapshot` d'omnipass donne le **fuseau** de l'Organization : le fuseau d'une campagne peut donc
en hériter par défaut. Il ne donne **pas** de devise. **Ma proposition** : `currency` obligatoire à la
création d'une campagne, `timezone` par défaut celui de l'Organization, surchargeable. Si tu préfères
une devise par Organization, c'est une écriture de tenancy, donc une demande à omnipass.

### 9.4 La taille de la phase

Cinq ressources × le CRUD de référence, l'algèbre, les profils et leurs validations : c'est deux à
trois fois la phase 2. **Ma proposition** : la livrer en un seul lot, mais dans cet ordre, chaque
étape laissant l'arbre vert — (1) les profils et l'algèbre, purs et testés sans base ; (2) les cinq
entités et leur migration ; (3) les services, la cascade, les validations ; (4) la surface HTTP et
MCP. Si tu veux un point de contrôle au milieu, c'est après (1) : c'est là que se décide la forme que
tout le reste consomme.

### 9.5 Les services autonomes, revisités

Tu as tranché pour des services autonomes, et je l'ai suivi. Cette phase est le vrai test : cinq
ressources qui partagent l'héritage, la cascade et la validation par profil. **Ma proposition** :
garder des services autonomes, mais sortir l'héritage, la cascade et la résolution de budget dans des
**fonctions pures partagées** (`src/levers/`, `src/domain/budget.ts`) que chaque service appelle —
donc pas de classe de base, mais pas non plus cinq copies de l'algèbre.

## 10. Comment la phase se teste

- **L'algèbre, sans base** : trois frères dont un explicite, le reste divisé ; un explicite qui
  dépasse, refusé ; un niveau `interdit` qui ne compte pas dans la division ; des parts de plateforme
  qui ne perdent pas un centime.
- **Swagger** : créer une campagne, lui ajouter un levier `search` et un levier `dac`, répartir
  60/40, créer deux AdGroups, voir les budgets résolus à chaque niveau, poser un budget sur une Line
  Search et se faire refuser en 400.
- **La cascade** : supprimer un AdGroup, voir disparaître ses TargetingGroups et ses Lines, le
  restaurer, voir revenir le sous-arbre.
- **MCP** : les mêmes opérations par les tools.
- **Les tests** : 100 % de couverture, et l'intégration prouve la cascade et les index.

## 11. Ce que l'écriture a changé au contrat

Livré le 2026-10-25. Cinq choses se sont décidées en écrivant, et elles valent plus que le contrat
initial parce qu'elles sont prouvées par du code :

1. **La saisie en volume vit où vit le CPM** — donc sur l'AdGroup et le TargetingGroup, pas sur la
   campagne ni sur la Line, qui n'ont pas d'enchère. Un champ qui n'aurait jamais pu aboutir a été
   retiré plutôt que documenté. Sur un TargetingGroup, la conversion prend son propre montant, sinon
   celui de son AdGroup.
2. **Le budget obligatoire d'une campagne est tenu par le schéma**, pas par un code d'erreur maison :
   `budgetCents` est requis à la création et non nullable à la modification. `campaign_budget_required`
   n'existe pas.
3. **La vérification des leviers est symétrique.** La campagne vérifie ses champs contre les leviers
   qu'elle porte, **et** un levier ajouté vérifie les champs que la campagne porte déjà. Sans le
   second sens, on contournerait L6 en ajoutant le levier Search après le capping.
4. **La cascade est datée.** Les descendants sont marqués au même instant que le nœud supprimé, et une
   restauration ne ramène que ceux qui portent cet instant : un enfant supprimé avant son parent reste
   supprimé.
5. **Le canal est dénormalisé** sur les trois niveaux du bas, comme `campaignId` : chaque écriture
   interroge le profil et chaque lecture de budget lui demande si le niveau porte un budget, donc sans
   la colonne les deux remontaient l'arbre.

Et un code d'erreur du § 8 n'a pas été écrit : `currency_unknown`. La devise est validée par sa forme
(ISO 4217, trois lettres) et ce qu'une plateforme accepte d'acheter dans cette devise est l'affaire de
son registre, donc un avertissement de preview — pas quelque chose que le modèle puisse savoir.
