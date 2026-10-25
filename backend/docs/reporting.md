# Reporting — document de référence

Ce document fixe le modèle de données, les règles et les mécanismes du reporting d'Omnipotent. Il est le produit du cadrage `docs/cadrage-reporting.md`.

Écrit le 2026-10-25. Les décisions sont numérotées **R1** à **R14** en section 14 ; celles marquées « à valider » attendent Lorin.

Pour une plateforme publicitaire, le rapport _est_ le produit. Et **un chiffre faux et crédible est pire qu'un chiffre absent** : c'est le fil directeur de tout ce qui suit.

---

## 1. Périmètre

Ce document couvre : la table de faits, la résolution d'identité, l'argent, le temps, les conversions, les règles d'agrégation, le registre de capacités, le mode asynchrone, les jobs et la surface d'API.

Il ne couvre pas : ce que chaque plateforme remonte réellement — c'est l'étude de sa phase (`docs/cadrage-plateforme.md`, et les huit relevés de `A-FAIRE.md` section 13) — ni le front.

## 2. L'état des lieux

**Corrigé le 2026-10-25 par le cadrage des leviers, et vérifié.** La première version de ce document affirmait que le `reporting-worker` de MBP n'avait jamais reçu son code de domaine, sur la foi du README de `mbp-api`, qui est périmé. C'est faux : il porte **191 fichiers TypeScript**, un fait canonique (`src/pipeline/canonical-fact.ts`), un registre d'adapters, et **huit adapters de reporting réels** — `hawk`, `dv360`, `amazon`, `gam`, `meta`, `openai`, `snap`, `tiktok` — chacun avec ses types de rapport, son normaliseur et ses ventilations.

| Plateformes                                 | Référence lisible                                                                                                                                               |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Ads, Microsoft, OpenAI, Thrad        | **multi-search**, en production — notre code                                                                                                                    |
| Hawk, DV360, Amazon DSP, Meta, TikTok, Snap | le **`reporting-worker` de MBP** — lecture seule, jamais recopié. _(GAM en avait un aussi ; la plateforme est retirée du périmètre depuis le 2026-10-25, D50.)_ |
| Amazon Search                               | **rien**                                                                                                                                                        |

**Il existe donc une référence pour dix plateformes sur onze** (D50 ayant retiré GAM). La correction est plus forte encore sur Hawk : `../../CADRAGE.md` annonçait « aucune conversion » d'après les types de `meta-dsp-lib`, alors que le rapport réellement demandé par le worker porte `visit`, `conversion`, les quartiles, les surfaces de visibilité IAB et **sept** colonnes de coût dont `agencyMargin`.

Ce constat **ne change pas le modèle ci-dessous**, qui tient. Il change l'estimation de l'inconnu : le travail de chaque phase de plateforme est une **transcription**, pas une découverte — Amazon Search exceptée.

Ce qui reste vrai comme méthode : **le modèle doit accueillir ce qu'on n'a pas encore lu sans migration de la table de faits.**

## 3. La table de faits

Une seule table, large, à **colonnes nullables**. Pas de jsonb pour un nombre qu'on somme.

| Colonne                                                             | Type                 | Rôle                                                                                                |
| ------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------- |
| `day`                                                               | `date`               | Le jour **du compte plateforme** (voir § 6)                                                         |
| `platform`                                                          | `varchar`            | La plateforme                                                                                       |
| `platformUnitId`                                                    | `uuid`               | Notre unité de diffusion chez elle                                                                  |
| `grain`                                                             | `varchar`            | `line \| targeting_group \| ad_group \| platform_unit` — le niveau **auquel la mesure a été faite** |
| `campaignId`, `leverId`, `adGroupId`                                | `uuid`               | Le chemin dans notre arbre, dénormalisé                                                             |
| `targetingGroupId`                                                  | `uuid` null          | `null` au-dessus de son grain                                                                       |
| `lineId`                                                            | `uuid` null          | `null` au-dessus de son grain                                                                       |
| `externalId`                                                        | `varchar`            | L'identifiant de l'objet mesuré chez la plateforme                                                  |
| `unattributed`                                                      | `boolean`            | `true` quand la ligne n'a pas pu être rattachée sous son grain (§ 4)                                |
| `impressions`, `clicks`                                             | `bigint`             | Le noyau, toujours renseigné                                                                        |
| `costMicros`                                                        | `bigint`             | **Micros de la devise du compte** (§ 5)                                                             |
| `mediaCostMicros`, `supplyCostMicros`, `feesMicros`                 | `bigint` null        | Les composantes, quand la plateforme les donne                                                      |
| `platformConversions`                                               | `numeric(14,4)` null | Ce que **la plateforme** s'attribue (§ 7)                                                           |
| `platformConversionValueMicros`                                     | `bigint` null        | Sa valeur, devise du compte                                                                         |
| `videoStarts`, `videoQ25`, `videoQ50`, `videoQ75`, `videoCompletes` | `bigint` null        | Famille vidéo                                                                                       |
| `audioStarts`, `audioCompletes`                                     | `bigint` null        | Famille audio                                                                                       |
| `plays`                                                             | `bigint` null        | Famille DOOH                                                                                        |
| `readAt`                                                            | `timestamptz`        | Quand la ligne a été lue                                                                            |

**Partitionnée par `day`.** Unique sur `(platformUnitId, day, grain, externalId)`.

Le chemin de notre arbre est **dénormalisé** sur chaque ligne : un rapport par levier ou par AdGroup ne doit pas joindre quatre tables.

### La règle du remplacement

Un pull **remplace** l'intégralité d'un `(platformUnitId, day)` ; il ne fusionne jamais. C'est ce qui rend les corrections de la plateforme (restatements) correctes, et ce qui garantit qu'un jour ne mélange jamais deux grains. Multi-search applique déjà cette règle (« the last days are read again and **replace** what was kept »).

### Pourquoi une colonne `grain`

Deux raisons, et les deux sont des bugs évités :

1. **Ne jamais additionner deux grains.** Une plateforme qui ne descend pas sous l'AdGroup produit des lignes de grain `ad_group` ; les sommer avec des lignes de grain `line` compterait deux fois.
2. **Une plateforme qui renvoie à la fois un total et son détail** ferait exactement ce double comptage. Le grain explicite plus la règle du remplacement l'interdisent structurellement.

## 4. L'identité : retrouver nos entités dans un rapport

### Comment multi-search le fait, vérifié dans le code

Deux mécanismes différents, et la nuance compte :

- **Google et Microsoft** : la clé de carte (`<adId>:<index>`) est posée dans un **paramètre d'URL personnalisé** (`mskey`, dans `urlCustomParameters`), et relue depuis le rapport. Robuste : un client qui renomme l'annonce dans l'interface de la plateforme ne casse rien.
- **OpenAI et Thrad** : la clé est dans le **nom de l'annonce** (` · <cardKey> [ms:<unitId>]`). Fragile, mais ces plateformes n'offrent rien d'autre.

Par ailleurs, multi-search **enregistre déjà** les identifiants externes de ce qu'il crée : `platform_campaigns.externalCampaignId`, `.externalAdGroupId`, `.cards` (par clé de carte) et `.keywords`.

### La règle pour Omnipotent

**Résolution primaire : la carte qu'on a enregistrée à l'écriture.** L'identifiant externe d'une ligne de rapport se résout par la correspondance `externalId → notre entité` que nous possédons. C'est nous qui avons créé l'objet, donc nous savons ce qu'il est.

**Secours, dans cet ordre :**

1. Un **marqueur durable et lisible par machine** dans un emplacement que la plateforme prévoit : paramètre d'URL personnalisé, champ de référence externe, libellé. C'est le `mskey` de Google.
2. Le **nom**, et seulement quand la plateforme n'offre rien d'autre.

**Ce qu'on ne fait jamais : perdre une ligne.** Une ligne non rattachable est **conservée** avec `unattributed = true` au grain le plus fin atteignable, et **remonte dans le rapport** comme « non attribué ». Un écart silencieux entre la facture de la plateforme et notre rapport est le pire défaut possible.

### L'historique des identifiants externes

Une table **append-only**, une ligne par changement, jamais modifiée ni supprimée. Un rapport portant sur les jours d'avant un changement porte encore l'ancien identifiant : il doit retrouver la bonne entité. Une première matérialisation (pas d'identifiant → un identifiant) n'est pas un changement et ne s'enregistre pas.

C'est ce qui permet la **restructuration après lancement** décidée en D40 : quand un budget posé sur un TargetingGroup éclate un AdGroup en plusieurs campagnes plateforme, notre reporting ne perd rien. MBP a exactement cette table, pour exactement cette raison.

## 5. L'argent

- Le coût est **stocké natif** : en micros de la **devise du compte plateforme**. C'est la vérité de la facture.
- Il est **converti à la lecture**, avec le **taux figé** de l'unité de diffusion — jamais le taux du jour, sinon les totaux passés bougent rétroactivement.
- Les sommes d'argent se font en **centimes entiers** de la devise de la campagne, pour qu'un total colle au centime. Multi-search le fait déjà : `FLOOR(micros / 10000 / fxRate + 0.5)`.
- **Coût canonique = ce que l'annonceur paie.** Les composantes (coût média, coût de supply, frais de la plateforme) vivent dans des colonnes distinctes et nullables, pour l'analyse. **Le coût canonique ne se recompose jamais depuis ses composantes** : une plateforme qui n'en donne qu'une partie produirait un total faux.

## 6. Le temps

- **Le jour est celui du compte plateforme**, stocké tel quel. Un rapport l'affiche comme tel, en nommant le fuseau.
- On ne **reventile pas** au prorata dans le fuseau de la campagne : ce serait plus confortable à lire, mais les chiffres ne réconcilieraient plus avec les factures des plateformes. La réconciliation prime sur le confort.
- **Grain journalier uniquement.** Le registre note si une plateforme pourrait fournir de l'horaire ; on y reviendra si le produit l'exige, et c'est le principal argument qui ramènerait ClickHouse.
- **Restatements** : les plateformes corrigent les jours récents, et les conversions arrivent en retard (des semaines chez Google et Microsoft, qui comptent une conversion au jour de son clic). D'où la fenêtre de backfill, qui n'est pas une précaution mais une nécessité.
- **Fraîcheur** : chaque unité de diffusion porte la date de sa dernière lecture, et l'API l'expose. **La fraîcheur d'un agrégat est la plus ancienne des fraîcheurs qu'il mélange.**
- **Aucun écran n'annonce du temps réel.** Il n'y a pas de live uniforme : les plateformes synchrones permettent quelques minutes de retard, les asynchrones imposent un cycle de plusieurs minutes, et les conversions sont toujours en retard partout.

## 7. Les conversions

### Le problème

Le script de suivi unique charge les balises de **chaque** plateforme utilisée et **transmet chaque conversion à toutes**. Chaque plateforme reçoit donc le même événement. Elle ne l'attribue que si elle avait un clic ou une impression à y rattacher — donc le surcomptage n'est pas systématique, mais il est **réel dès que deux plateformes revendiquent la même conversion**, ce que leurs fenêtres d'attribution et leurs modèles (post-clic, post-vue) rendent courant.

Multi-search ne résout pas ce problème : il somme les conversions de toutes les plateformes d'une campagne.

### La règle

Deux familles, qui **ne s'additionnent jamais** entre elles :

1. **Les conversions attribuées par les plateformes.** Sommables **à l'intérieur** d'une plateforme. Présentées entre plateformes **uniquement avec la mention explicite d'un chevauchement possible** — jamais comme un chiffre exact.
2. **Les conversions mesurées par nous.** Dédupliquées par événement, attribuées à notre arbre. Ce sont elles qui seraient la source de vérité du rapport.

**En v1, seule la famille 1 existe.** Le total d'une campagne la présente avec sa réserve, nommée dans l'API par un code stable que le front traduit.

La famille 2 demande une **attribution au clic** : un identifiant de clic propagé dans l'URL de destination, stocké, puis rapproché à la conversion. C'est un chantier à part entière, et le plan de multi-search le prévoyait déjà pour plus tard (« l'API serveur […] vient après la phase 7 »). **À inscrire comme une phase**, pas à improviser ici.

## 8. Les dérivés et l'agrégation

- **Aucun dérivé n'est stocké.** `ctr`, `cpc`, `cpm`, `cpa`, taux de complétion : tous calculés à la lecture, et **nullables**. Un dérivé stocké devient faux dès qu'on agrège.
- Un dérivé est `null` quand son dénominateur est nul.
- **Le coût par conversion se calcule sur le coût des seules lignes où la conversion était mesurée**, pas sur le coût total. Multi-search le fait déjà correctement, avec un `FILTER (WHERE conversions IS NOT NULL)` sur la somme des conversions **et** sur celle du coût. C'est la subtilité la plus facile à rater : diviser le coût total par des conversions partielles produit un coût par conversion gonflé et crédible.
- **Les trous restent `null`, jamais des zéros.** Une métrique qu'aucune ligne de l'agrégat n'a mesurée est `null`.
- **Un agrégat déclare sa couverture** : pour chaque famille de métriques, quelles plateformes de son périmètre ne la mesurent pas. C'est ce qui permet au front d'écrire « hors Thrad, qui ne mesure pas les conversions » au lieu d'afficher un trou inexpliqué.

## 9. Le registre de capacités de reporting

Une entrée par plateforme, dans le même esprit que le registre de ciblage et celui des quotas : **le code ne teste jamais un nom de plateforme.**

Chaque entrée déclare : les métriques remontées (par famille), le **grain le plus fin**, le mode (synchrone ou asynchrone), la **fraîcheur attendue**, la **fréquence de pull**, la **fenêtre de restatement**, le **fuseau** et la **devise** du rapport, le **quota propre au reporting** (souvent distinct de celui des écritures), et la façon dont l'identité se résout (carte enregistrée, paramètre personnalisé, nom).

`platform-rules.ts` de multi-search donne la forme à reprendre. Le remplissage se fait dans la phase de chaque plateforme, sur un compte réel.

## 10. Les métriques propres à une plateforme

Elles **ne polluent pas** la table de faits commune. Une table annexe par plateforme, **à colonnes typées** et sur **le même grain** que la table principale, créée dans la phase de cette plateforme.

Pas d'EAV, pas de jsonb pour ce qui se somme : l'univers retail d'Amazon (`detailPageViews`, `addToCart`, `purchases`) doit s'agréger en SQL comme le reste. Le jsonb n'est acceptable que pour une métrique purement descriptive que nous n'agrégeons jamais.

Ces métriques n'apparaissent que dans le rapport de leur plateforme, jamais dans un total multi-plateformes.

## 11. Le mode asynchrone

**Rien de tel n'existe dans multi-search.** DV360 et Amazon DSP imposent un cycle **créer une demande → interroger son état → télécharger**, avec des rapports qui expirent. C'est un mécanisme à construire, pas une variante du pull synchrone.

Il demande une entité de **demande de rapport** portant : la plateforme, le compte, la période, le grain, l'identifiant de la demande chez la plateforme, son état (`queued → running → ready → downloaded`, ou `failed` / `expired`), ses tentatives et sa prochaine tentative.

Et les garanties qui vont avec : reprise après interruption (une demande en cours survit à un redéploiement), expiration (une demande jamais prête ne bloque pas la file éternellement), et **idempotence** (ne pas relancer une demande identique déjà en cours).

## 12. Les jobs

- **Pull horaire** sur une fenêtre courte de jours récents : les plateformes corrigent les jours récents.
- **Backfill quotidien** sur une fenêtre longue : les conversions tardives atteignent les rapports.
- **Lectures groupées par compte** quand l'adapter le permet — chez Google, les lectures comptent contre un quota journalier partagé par tous les clients.
- Une campagne dont les chiffres ont bougé est **resynchronisée**, pour que son pacing suive la dépense réelle. C'est l'un des trois déclencheurs de la synchro (D34).
- Le pull peut devenir un **troisième mode de processus** (`APP_MODE`) plus tard : il est I/O-bound sur les API des plateformes, avec ses propres quotas et son propre profil de retry, et il ne partage pas le chemin d'écriture de la synchro. Même code, pas un autre service.

## 13. La surface d'API

- Un rapport par campagne : total, puis par plateforme, par levier, par AdGroup, par TargetingGroup, par Line et par jour.
- Un rapport comparatif sur une période, pour une liste de campagnes.
- Le **pacing** (où en est la dépense face au plan) reste distinct du rapport : il est calculé, pas stocké.
- Chaque réponse porte : la devise, la période, la **fraîcheur par plateforme**, la **couverture par famille de métriques**, et la réserve sur les conversions multi-plateformes — chacun avec un **code stable** et ses valeurs, pour que le front traduise.

## 14. Les décisions

|         | Décision                                                                                                                                                                                                         | État           |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **R1**  | Une table de faits unique, large, à colonnes nullables, partitionnée par jour, avec le chemin de notre arbre dénormalisé et une colonne **`grain`**                                                              | à valider      |
| **R2**  | Un pull **remplace** un `(unité, jour)`, il ne fusionne jamais                                                                                                                                                   | à valider      |
| **R3**  | Identité : résolution primaire par la **carte enregistrée à l'écriture** ; secours par un **marqueur durable** (paramètre d'URL, référence externe, libellé), et le nom en dernier recours                       | à valider      |
| **R4**  | Une ligne non rattachable est **conservée** et remonte comme « non attribué » — jamais perdue                                                                                                                    | à valider      |
| **R5**  | Historique **append-only** des identifiants externes ; une première matérialisation n'est pas un changement                                                                                                      | à valider      |
| **R6**  | Coût **stocké natif** (micros, devise du compte), **converti à la lecture** au **taux figé**, sommé en centimes entiers                                                                                          | à valider      |
| **R7**  | Coût canonique = ce que l'annonceur paie ; les composantes à côté, et **jamais de recomposition**                                                                                                                | à valider      |
| **R8**  | Le **jour est celui du compte plateforme**, sans reventilation ; grain journalier seulement                                                                                                                      | à valider      |
| **R9**  | Deux familles de conversions qui ne s'additionnent jamais ; en v1 seules celles des plateformes existent, présentées **avec une réserve explicite** ; les nôtres (attribution au clic) sont **une phase à part** | **à trancher** |
| **R10** | Aucun dérivé stocké ; tous nullables ; le coût par conversion sur le **coût des seules lignes mesurées**                                                                                                         | à valider      |
| **R11** | Les trous restent `null` ; un agrégat **déclare sa couverture** par famille de métriques                                                                                                                         | à valider      |
| **R12** | Un **registre de capacités de reporting** par plateforme ; le code ne teste jamais un nom de plateforme                                                                                                          | à valider      |
| **R13** | Métriques propres à une plateforme dans une **table annexe typée** sur le même grain ; pas d'EAV, pas de jsonb pour ce qui se somme                                                                              | à valider      |
| **R14** | Le **mode asynchrone** est un mécanisme à construire : entité de demande, états, reprise, expiration, idempotence                                                                                                | à valider      |

## 15. Ce qui reste ouvert

| Sujet                                | Nature                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| **Nos propres conversions**          | R9 : chantier d'attribution au clic. Phase v1 ou plus tard ?                                               |
| **L'horaire**                        | Inutile aujourd'hui ; le registre note qui pourrait le fournir. C'est l'argument qui ramènerait ClickHouse |
| **Les frais plateforme**             | Dans le coût canonique ou à côté ? Tranché par plateforme, à son étude                                     |
| **Ce que remonte chaque plateforme** | Les huit relevés de `A-FAIRE.md` section 13, dans la phase de chaque plateforme                            |

## 16. Ce que ce cadrage ajoute au plan

Trois éléments que le modèle d'`../../CADRAGE.md` ne portait pas :

1. La colonne **`grain`** et la règle du remplacement — sans elles, un double comptage structurel.
2. L'**historique append-only des identifiants externes** — déjà impliqué par D40, maintenant spécifié.
3. Le **mécanisme asynchrone** de reporting, avec son entité de demande — un morceau de travail qui n'existe nulle part dans nos références.

Et une **phase nouvelle** à inscrire : la **mesure de nos propres conversions** avec attribution au clic, sans laquelle aucun total de conversions multi-plateformes ne peut être présenté comme exact.
