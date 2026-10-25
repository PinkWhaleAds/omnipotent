# Phase 4 — Courbes de budget et pacing

Contrat de la phase 4. La **courbe journalière** — un jour, un montant — et le **pacing**, qui dit
combien dépenser aujourd'hui. Deux choses qui ont l'air simples et qui ne le sont pas : la courbe
parce qu'elle doit toujours sommer au budget malgré les jours verrouillés et les jours passés, le
pacing parce qu'il ne doit **jamais** devenir une seconde source de vérité.

Prérequis : la phase 3 (l'algèbre du budget, dont celle-ci est le prolongement dans le temps).

Entrées validées : `../../CADRAGE.md` § 4 (D8, D9, D22), `leviers.md` L10, et
`~/OmniAd/multi-search/backend/src/services/budget-curve.helpers.ts`, qui porte l'algorithme durci
par trente-six phases — **c'est notre code, il se transcrit** (D1).

---

## 1. Une seule table

```
budget_days   (level, node_id, day) unique
              cents, locked
```

Une **seule** table pour les cinq niveaux (`../../CADRAGE.md` § 4), clé sur le triplet. Pas une table
par niveau : la courbe d'un AdGroup et celle d'une campagne sont la même chose, et le jour où une
sixième ressource porte un budget, elle n'aura rien à migrer. `level` est la même énumération
applicative que celle des labels, pour la même raison.

| Colonne  | Règle                                                                 |
| -------- | --------------------------------------------------------------------- |
| `level`  | `campaign \| lever \| ad_group \| targeting_group \| line`            |
| `nodeId` | Le nœud, uuid opaque de **notre** base (aucune FK : le niveau varie)  |
| `day`    | `YYYY-MM-DD`, dans le fuseau de la campagne                           |
| `cents`  | Entier, en devise de campagne. **0 est une valeur**, pas une absence  |
| `locked` | Un jour verrouillé garde son montant quand les autres sont recalculés |

Pas de clé étrangère vers le nœud, puisque son niveau varie — même compromis que les affectations de
labels (D39), et les nœuds étant en soft-delete, une courbe orpheline est inoffensive.

## 2. Qui porte une courbe

**Tout niveau portant un budget explicite peut avoir la sienne** (`../../CADRAGE.md` § 4). Les
autres **suivent la forme de leur parent au prorata**, calculée à la lecture — jamais stockée, comme
le budget effectif de la phase 3.

Conséquence à tenir : si un nœud rend son budget (`budgetCents: null`), sa courbe n'a plus d'objet et
**disparaît**. L'inverse est vrai aussi : poser un budget explicite sur un nœud lui donne une courbe
plate par défaut, qu'il peut ensuite façonner.

## 3. L'algèbre de la courbe

En **centimes entiers**, et la somme des jours fait **exactement** le budget du nœud — jamais un
centime de plus ni de moins. C'est ce que `distribute` garantit par la méthode du plus fort reste,
déjà utilisée pour la répartition par plateforme en phase 3.

### 3.1 Ce qui ne bouge pas

Trois sortes de jours gardent leur montant quand les autres sont recalculés :

| Figé                                       | Pourquoi                                                   |
| ------------------------------------------ | ---------------------------------------------------------- |
| Un jour **verrouillé**                     | L'utilisateur l'a décidé (`locked`)                        |
| Un jour **passé**                          | Il a déjà diffusé : le réécrire serait réécrire l'histoire |
| Un jour **édité** dans la requête en cours | Ce que l'appelant vient de dire gagne sur le recalcul      |

Le reste se partage **au prorata de ce qu'il portait déjà**, donc la forme de la courbe survit à un
changement de budget. Un jour à 0 reste à 0 : c'est une intention, pas un vide.

### 3.2 Les trois refus

| Code                       | Quand                                                                |
| -------------------------- | -------------------------------------------------------------------- |
| `budget_below_past_days`   | Les jours déjà passés portent à eux seuls plus que le budget demandé |
| `budget_fixed_days_exceed` | Verrouillés, édités et passés réunis dépassent le budget             |
| `budget_no_free_day`       | Il reste quelque chose à répartir et aucun jour ne peut l'absorber   |

Les trois sont des **400** : ce sont des états impossibles, pas des incomplétudes — la même frontière
qu'en phase 3 (§ 6 de `phase-3.md`).

### 3.3 Les presets, et les jours qui ne diffusent pas

Trois formes transcrites de multi-search, plus une quatrième :

- **`flat`** — tous les jours égaux, le défaut ;
- **`weekend_boost`** — un samedi et un dimanche pèsent `factor` fois un jour de semaine (1,5 par
  défaut) ;
- **`ramp_up`** — le premier quart de la période monte en pente, le reste est plat ;
- **`selected_days`** — seuls les jours de semaine nommés diffusent, les autres passent à 0.

Et **deux façons de dire qu'un jour ne diffuse pas**, qui se combinent :

| Ce qu'on veut dire    | Comment                                                             |
| --------------------- | ------------------------------------------------------------------- |
| « Pas le samedi »     | `selected_days` avec les jours de semaine qui diffusent             |
| « Pas le 26 octobre » | `excludedDays: ['2026-10-26']`, **avec n'importe quelle forme**     |
| Les deux à la fois    | Les deux champs ensemble : du lundi au vendredi, sauf un jour férié |

Les deux mettent le jour à **0**, et un jour à 0 met le nœud en pause ce jour-là. Un jour peut aussi
être mis à 0 à la main par `PUT`, et il y reste — mais un preset le réécrirait, alors que
`excludedDays` tient.

Un preset **recalcule les jours libres seulement** : les verrouillés et les passés gardent leur
montant, parce qu'un preset est une forme, pas un effacement.

### 3.4 La période

Au plus **731 jours** (deux ans), comme multi-search. Une campagne qui change de fenêtre garde les
montants de tous ses jours encore dans la fenêtre — pas seulement les passés et les verrouillés : ce
qui est stocké gagne, sinon façonner une courbe ne servirait à rien. Un jour **nouveau** entre comme
un **jour moyen** (la moyenne des jours stockés, ou la part égale du budget quand rien n'est stocké),
et les autres lui font de la place au prorata. La forme survit donc à un changement de fenêtre comme
à un changement de budget, et rien n'est réécrit en base pour cela : la complétion se fait à la
lecture.

## 4. Le pacing

**Ce n'est pas un job.** C'est une **fonction pure**, calculée à l'intérieur de la synchronisation,
comme une partie de l'état voulu (`../../CADRAGE.md` § 4). Un job qui « pousserait les budgets »
créerait une seconde source de vérité à côté de la synchro ; il n'y en a pas, et il n'y en aura pas.

Pour le jour courant, elle donne cinq choses :

| Sortie               | Définition                                                                   |
| -------------------- | ---------------------------------------------------------------------------- |
| `plannedCents`       | Le total prévu sur la période                                                |
| `plannedToDateCents` | Ce que la courbe prévoyait jusqu'à hier inclus                               |
| `remainingCents`     | `prévu − dépensé avant aujourd'hui`, **jamais négatif**                      |
| `todayCents`         | Le reste réparti sur les jours restants **en gardant la forme de la courbe** |
| `status`             | `on_track \| underspending \| overspending \| budget_reached`                |

**La dépense entre en paramètre.** Elle vient du reporting, qui est la phase 15 : d'ici là la
fonction est testée avec des dépenses données, et personne ne lit de vraie dépense. C'est précisément
ce qui la rend testable — et ce qui fait qu'elle sera juste le jour où les vraies dépenses arrivent.

## 5. Les fuseaux

Le jour est celui de la **campagne**, ou de l'Organization à défaut (phase 3 l'a posé). Un compte
plateforme a son propre fuseau : le budget d'un jour plateforme est le nôtre **au prorata des heures
qui se chevauchent** entre les deux jours.

Cette fonction-là est **pure** aussi, et elle est écrite dans cette phase même si personne ne l'appelle
encore : c'est la phase des plateformes qui la consommera, et la découvrir à ce moment-là serait la
découvrir trop tard. Les pauses des jours à 0 se font à minuit, heure de la campagne.

## 6. Les routes

| Méthode  | URL                                | Rôle      | Ce qu'elle fait                                  |
| -------- | ---------------------------------- | --------- | ------------------------------------------------ |
| `GET`    | `/<niveau>/:id/budget-days`        | `viewer`  | La courbe, la sienne ou celle héritée au prorata |
| `PUT`    | `/<niveau>/:id/budget-days`        | `manager` | Édite des jours ; les autres se rééquilibrent    |
| `POST`   | `/<niveau>/:id/budget-days/preset` | `manager` | Applique une forme                               |
| `DELETE` | `/<niveau>/:id/budget-days`        | `manager` | Remet la courbe à plat                           |
| `GET`    | `/<niveau>/:id/pacing`             | `viewer`  | Le pacing du jour                                |

Pour les cinq niveaux, donc vingt-cinq routes, et leurs tools MCP du même nom
(`get-campaign-budget-days`, `update-ad-group-budget-days`, `apply-line-budget-preset`,
`get-targeting-group-pacing`…). La convention de la phase 3 s'applique : ces routes vivent **à plat**
sur la ressource, puisqu'un id porte ses parents.

## 7. Les codes d'erreur de la phase

| Code                        | Statut | Quand                                                           | `params`                    |
| --------------------------- | ------ | --------------------------------------------------------------- | --------------------------- |
| `budget_below_past_days`    | 400    | Les jours passés portent plus que le budget                     | `pastCents`, `budgetCents`  |
| `budget_fixed_days_exceed`  | 400    | Verrouillés, édités et passés dépassent le budget               | `fixedCents`, `budgetCents` |
| `budget_no_free_day`        | 400    | Rien ne peut absorber le reste                                  | `remainingCents`            |
| `budget_day_outside_window` | 400    | Un jour édité est hors de la fenêtre du nœud                    | `day`                       |
| `budget_day_past`           | 400    | Un jour déjà passé : son montant et son verrou ne changent plus | `day`                       |
| `budget_curve_not_allowed`  | 400    | Le nœud n'a pas de budget explicite, donc pas de courbe à lui   | `level`                     |
| `budget_period_too_long`    | 400    | La fenêtre dépasse 731 jours                                    | `days`, `max`               |

## 8. Les quatre points, tranchés

Tranchés par Lorin le 2026-10-25.

1. **Une courbe disparaît quand son nœud rend son budget.** Un nœud qui repasse en héritage n'a plus
   de montant à lui, donc plus rien à répartir : ses jours sont supprimés, la réponse le dit, et le
   nœud suit désormais la forme de son parent au prorata.
2. **La dépense est un paramètre jusqu'à la phase 15**, et c'est ainsi que multi-search fonctionne
   aussi : son `pacingOf` lit les lignes de `stats_daily` déjà chargées dans l'instantané de la
   synchro, les convertit au taux figé de l'unité de diffusion, et appelle `paceDay` — rien n'est
   stocké, rien n'est poussé par un job. D'ici la phase 15, `GET /pacing` répond donc un **plan**, pas
   un diagnostic.
3. **Le prorata entre fuseaux est écrit maintenant**, bien que personne ne l'appelle avant la phase
   des plateformes.
4. **Les quatre formes, et les jours nommés** (§ 3.3) : « pas le samedi » **et** « pas le
   26 octobre », qui se combinent.

## 9. Comment la phase se teste

- **L'algèbre, sans base** : une courbe qui somme exactement au budget sur 731 jours ; un jour
  verrouillé qui survit à trois recalculs ; un jour passé qui ne bouge pas ; un preset qui respecte
  les deux ; les trois refus.
- **Swagger** : poser une courbe sur une campagne, verrouiller un jour, changer le budget, voir les
  autres jours se rééquilibrer et le verrouillé tenir.
- **Le pacing** : une campagne à mi-parcours sous-dépensée donne un `todayCents` plus élevé que la
  courbe, et un statut `underspending` ; une campagne dont le budget est atteint donne 0 et
  `budget_reached`.
- **MCP** : les mêmes opérations par les tools.
- **Les tests** : 100 % de couverture, et l'intégration prouve l'unicité `(level, nodeId, day)`.

## 10. Ce que l'écriture a changé

Trois choses que seule l'écriture a montrées. Elles sont **tranchées et faites**, notées ici pour que
la décision ne se reprenne pas.

1. **La lecture ne reconstruit pas, elle complète.** La fonction transcrite de multi-search qui
   répartissait à parts égales les jours libres (`rebuildCurve`) est juste quand la **période**
   change, et fausse quand on **relit** une courbe : elle effaçait la forme stockée à chaque lecture.
   Elle est remplacée par `completeCurve`, qui garde ce qui est stocké, fait entrer un jour nouveau
   comme un jour moyen, et rééquilibre (§ 3.4). Le défaut se voyait deux fois : une courbe façonnée
   répondait plate, et un nœud que personne n'avait façonné figeait ses jours passés à un centime —
   donc entassait tout son budget sur les jours restants.
2. **Un seul module pour les cinq niveaux.** La courbe est **une** ressource — une table, un service
   dont les méthodes prennent le niveau en argument —, donc `src/modules/budget-day` et
   `src/mcp/tools/budget-day` servent les vingt-cinq routes et les vingt-cinq tools depuis une
   table des niveaux, au lieu de cinq modules qui répéteraient la même ligne. Les **entrées** des
   tools restent niveau par niveau (`adGroupId` pour un AdGroup), comme la phase 3 l'a appris au
   modèle.
3. **Reposter un jour passé à l'identique passe.** Seul un changement de montant ou de verrou sur un
   jour passé est refusé : c'est ce qui rend un `PUT` de la courbe entière rejouable.
