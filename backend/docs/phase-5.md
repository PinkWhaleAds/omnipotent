# Phase 5 — Ciblage, listes et mots-clés

Contrat de la phase 5. Le **ciblage**, qui vit entièrement sur le `TargetingGroup`, les **listes
réutilisables** au niveau Organization, et les **mots-clés**. C'est la phase la plus large du modèle
en nombre de formes à valider, et la plus mécanique : presque tout se joue dans un registre.

Prérequis : la phase 3 (le `TargetingGroup` et les profils de levier, que cette phase complète).

Entrées validées : `../../CADRAGE.md` § 8 (dont T5 et L28), `leviers.md` § 4 et L2, et le registre de
MBP `types/targeting/` — **lu pour comprendre, jamais copié** (D36).

---

## 1. Un objet, pas des lignes

Le ciblage d'un TargetingGroup est **un seul objet** : une map `type → critères`, stockée en `jsonb`
sur `targeting_groups` (`../../CADRAGE.md` § 8). Écriture atomique, pas de N+1, un aller-retour pour
composer l'état voulu.

```
targeting_groups.targeting   jsonb NOT NULL DEFAULT '{}'
```

Pas de table `targeting_items` : MBP en a une, et c'est précisément ce que § 8 écarte. Un TargetingGroup
**sans aucun critère est valide** — il ne restreint rien.

Les **mots-clés** sont la seule exception, et pour une raison de volume : un AdGroup Search en porte
des milliers, qu'on ajoute par paquets de cinq cents et qu'on liste page par page. Ils ont donc leur
table (§ 4). L'objet de ciblage porte le reste, y compris les `contextHints` et les **références de
listes** de mots-clés négatifs partagées.

## 2. Le registre des dimensions

Chaque dimension est **un schéma Zod dédié**, enregistré dans un registre, comme § 8 le demande. Mais
les dimensions de MBP se rangent en un petit nombre de **familles de forme**, et c'est ce qui rend la
phase livrable : une dimension se déclare en nommant sa famille et son vocabulaire, au lieu d'écrire
le même `include/exclude` des dizaines de fois.

| Famille           | Forme                                                                                             | Exemples                                                                                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `include_exclude` | `{ include: T[], exclude: T[] }`, au moins une non vide, aucun élément dans les deux              | pays, OS, navigateur, device, langue, environnement, exchange, catégorie, genre et classification de contenu, format vidéo, taille de lecteur, position, placement social… |
| `opaque_ids`      | le même `include/exclude`, mais sur des **identifiants de plateforme** opaques, validés non vides | audiences, segments, intérêts, sources d'inventaire, publishers, placements, apps, domaines, chaînes et vidéos YouTube, catégories de POI…                                 |
| `list_reference`  | `{ listIds: uuid[] }` vers des listes de l'Organization (§ 3)                                     | sites et apps, bundles, devices, grilles, codes postaux, retargeting, mots-clés négatifs partagés                                                                          |
| `range`           | `{ min, max }` sur un entier ou un décimal                                                        | viewabilité, durée de contenu, multiplicateur d'audience (DOOH), échantillonnage IFA                                                                                       |
| `windows`         | une liste de fenêtres `(jour, heure de début, heure de fin)` plus **une** résolution de fuseau    | plages horaires                                                                                                                                                            |
| `shape`           | une forme propre, écrite à la main                                                                | proximité (rayon autour de points), GPS, clés-valeurs, démographie, marque et modèle de device                                                                             |

Une famille **n'est pas** un type : chaque dimension garde son schéma nommé, son vocabulaire et son
libellé, et c'est ce schéma qui est enregistré. La famille n'est qu'une fabrique, testée une fois.

Le registre vit dans `src/targeting/`, à côté de celui des profils de levier et de celui des
plateformes — c'est un registre, pas une forme de requête, et il est la source de vérité de la forme
qu'il déclare : le schéma de l'objet entier est **composé** depuis lui, donc Swagger documente chaque
dimension sans que personne en recopie une. Chaque entrée déclare :

| Déclaration | Pourquoi                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `schema`    | la validation des critères, source de vérité de la forme                                                             |
| `label`     | le nom lisible, que le front affiche sans le traduire lui-même                                                       |
| `family`    | la famille, pour que la discovery dise à un modèle à quoi s'attendre                                                 |
| `listKind`  | pour une `list_reference`, le genre de liste attendu — une liste de POI ne se branche pas sur une dimension de sites |

Ajouter une dimension, c'est **une entrée dans le fichier de son thème** (`geo`, `technical`,
`audience`, `inventory`, `content`, `quality`, `delivery`) et une valeur dans l'énumération, sans
toucher au service — la propriété que MBP a obtenue et qu'on garde. Le `satisfies` de l'assemblage est
la garde : une dimension déclarée d'un côté et pas de l'autre fait échouer la compilation.

### La route de découverte

`GET /targeting-dimensions` répond le registre : type, libellé, famille, et le **schéma JSON** des
critères. Le front n'a alors aucune forme en dur, et un modèle MCP sait composer un ciblage sans
l'avoir appris. C'est la même idée que `GET /platform-rules` côté multi-search.

## 3. Les listes

Les listes réutilisables (sites, apps, devices, POI, codes postaux, mots-clés négatifs…) sont au
niveau **Organization** et référencées par les critères. Une table `lists` : `organizationId`, `kind`,
`name`, et les items en `jsonb`.

Un item a **une seule forme, quel que soit le genre** : `value`, ce qui part vers la plateforme ;
`label`, ce qu'une interface affiche ; `metadata`, les valeurs dénormalisées dont les adapters ont
besoin — coordonnées, régie, pays, correspondance d'un mot-clé négatif. C'est la doctrine du § 6
appliquée aux listes, et ce qui évite un second registre de formes par genre.

Elles servent le CRUD de référence de la phase 2 (pagination, recherche, soft-delete, restore, bulk),
sans les labels — une liste est un outil, pas une chose par laquelle on organise une campagne —, plus
deux opérations propres :

- **dupliquer** vers une autre Organization du Seat, réservé au `seat_admin` ;
- **déplacer**, **refusé quand la liste est encore référencée** par un ciblage de l'Organization
  d'origine, avec un code qui propose la duplication (`../../CADRAGE.md` § 8).

« Encore référencée » se lit sur l'objet de ciblage : un index **GIN** sur `targeting_groups.targeting`
et une requête de containment, donc une seule question à la base, sans table de jointure à tenir.

## 4. Les mots-clés

Table `keywords` sous le **TargetingGroup** — et non sous l'AdGroup comme chez multi-search, puisque
tout le ciblage vit sur le TargetingGroup (§ 8). Le reste est **transcrit** de multi-search, où les
limites sont éprouvées : texte de 80 caractères et dix mots au plus, correspondance
`broad | phrase | exact`, polarité négative, unicité sur `(targetingGroup, texte, correspondance,
polarité)`, et un ajout en masse jusqu'à cinq cents par requête qui **saute les doublons** et rapporte
les refus un par un.

Les `contextHints` (ce que les plateformes LLM consomment au lieu de mots-clés) sont une dimension de
l'objet de ciblage, pas une table : il y en a quelques-uns, pas des milliers.

## 5. Les deux registres, et l'intersection

L2 est la règle, et elle tranche la lecture de `../../CADRAGE.md` § 8 :

| Registre                                      | Clé                    | Dit                                                                   | Produit                         |
| --------------------------------------------- | ---------------------- | --------------------------------------------------------------------- | ------------------------------- |
| **Profil de levier** (`src/levers/`)          | `levier`               | les dimensions qui ont un **sens** sur ce levier                      | un **400** à l'écriture         |
| **Registre de plateforme** (`src/platforms/`) | `(plateforme, levier)` | les dimensions que la plateforme **accepte**, et les granularités géo | un **avertissement de preview** |

Donc : le profil ajoute `targetingDimensions`, le registre de plateforme ajoute `targeting`. Une
dimension hors du profil du levier est refusée tout de suite ; une dimension que telle plateforme ne
gère pas est **écartée pour elle** et nommée dans la preview — le piège du budget mal ciblé de § 8,
qui appartient à la phase de la preview.

Le registre de plateforme est **vide** tant qu'aucune phase de plateforme n'a livré : à ce stade il n'y
a donc rien à intersecter et aucun avertissement, ce qui est le comportement voulu — le refus, lui,
vient du profil et marche dès cette phase.

## 6. Pas de référentiel externe

Omniscient est **hors périmètre** (L28) : aucune dimension n'appelle un service externe à l'écriture.
Les dimensions qui désignent un référentiel de plateforme (POI, écrans, audiences, segments) portent
des **identifiants opaques** plus les **valeurs dénormalisées** que l'appelant envoie — nom,
coordonnées, régie, pays —, exactement le principe du référentiel géo de multi-search : garder l'id
_et_ son nom plutôt que rappeler la plateforme à la synchro. Un identifiant devenu obsolète échoue
**à la poussée**, là où la plateforme le dit.

## 7. Les routes

| Méthode  | URL                                          | Rôle         | Ce qu'elle fait                                  |
| -------- | -------------------------------------------- | ------------ | ------------------------------------------------ |
| `GET`    | `/targeting-dimensions`                      | authentifié  | Le registre, avec le schéma JSON de chaque forme |
| `GET`    | `/targeting-groups/:id/targeting`            | `viewer`     | L'objet de ciblage                               |
| `PUT`    | `/targeting-groups/:id/targeting`            | `manager`    | Remplace l'objet entier, atomiquement            |
| `PUT`    | `/targeting-groups/:id/targeting/:dimension` | `manager`    | Pose ou remplace **une** dimension               |
| `DELETE` | `/targeting-groups/:id/targeting/:dimension` | `manager`    | Retire une dimension                             |
| `GET`    | `/targeting-groups/:id/keywords`             | `viewer`     | Les mots-clés, paginés, filtrés par polarité     |
| `POST`   | `/targeting-groups/:id/keywords`             | `manager`    | En ajoute jusqu'à cinq cents, doublons sautés    |
| `PATCH`  | `/keywords/:id`                              | `manager`    | Change la correspondance ou la polarité          |
| `DELETE` | `/keywords/:id`                              | `manager`    | En retire un                                     |
| —        | `/lists` et `/lists/:id…`                    | —            | Le CRUD de référence de la phase 2, au complet   |
| `POST`   | `/lists/:id/duplicate`                       | `seat_admin` | Copie vers une autre Organization du Seat        |
| `POST`   | `/lists/:id/move`                            | `seat_admin` | Déplace, refusé si la liste est référencée       |

Et leurs tools MCP du même nom (D21).

## 8. Les codes d'erreur de la phase

Catalogués dans `error-codes.md`, section « Le ciblage, les listes et les mots-clés ».

| Code                            | Statut | Quand                                                            | `params`                        |
| ------------------------------- | ------ | ---------------------------------------------------------------- | ------------------------------- |
| `targeting_dimension_forbidden` | 400    | Le levier du nœud n'a rien à faire de cette dimension            | `lever`, `dimension`            |
| `targeting_criteria_invalid`    | 400    | Les critères ne passent pas le schéma de leur dimension          | `dimension`, `reason`           |
| `targeting_list_kind_mismatch`  | 400    | Une liste d'un genre sur une dimension qui en attend un autre    | `listId`, `kind`, `expected`    |
| `targeting_group_not_found`     | 404    | Le nœud est absent, supprimé, ou d'une autre Organization        | `{}`                            |
| `keywords_not_permitted`        | 400    | Le levier n'achète pas de mots                                   | `lever`                         |
| `keyword_text_invalid`          | 400    | Le texte porte trop de mots                                      | `text`, `words`, `max`          |
| `keyword_not_found`             | 404    | Absent, ou d'une autre Organization                              | `{}`                            |
| `keyword_already_exists`        | 409    | Le changement ferait un doublon dans le même nœud                | `text`, `matchType`, `negative` |
| `list_not_found`                | 404    | Absente, supprimée, ou d'une autre Organization                  | `listId`                        |
| `list_not_deleted`              | 409    | `restore` sur une liste vivante                                  | `{}`                            |
| `list_name_taken`               | 409    | Une liste vivante du même genre porte déjà ce nom                | `kind`, `name`                  |
| `list_referenced`               | 409    | Déplacement d'une liste encore référencée : dupliquer à la place | `listId`, `references`          |
| `list_same_organization`        | 400    | Dupliquer ou déplacer vers l'Organization d'origine              | `organizationId`                |
| `list_other_seat`               | 400    | La cible appartient à un autre Seat                              | `organizationId`                |

Une dimension inconnue et un genre de liste inconnu sont refusés **par le schéma** de la route, en
`validation_failed` : les deux énumérations font partie du contrat.

## 9. Comment la phase se teste

- **Le registre, sans base** : chaque dimension valide un exemple et refuse une forme voisine ; les
  familles sont testées une fois chacune, puis chaque dimension sur son vocabulaire.
- **L'objet** : poser deux dimensions, en remplacer une, en retirer une, et vérifier que les autres
  n'ont pas bougé ; un TargetingGroup sans critère reste valide.
- **Les refus** : une dimension inconnue, une dimension hors du profil du levier, des critères
  invalides, une liste du mauvais genre.
- **Les listes** : dupliquer vers une autre Organization, se faire refuser le déplacement d'une liste
  référencée, et le même déplacement accepté après que le ciblage l'a lâchée.
- **Les mots-clés** : cinq cents d'un coup dont un invalide — les autres entrent, celui-là est
  rapporté.
- **L'intégration** : l'index GIN sert bien la question « cette liste est-elle référencée », et
  l'unicité des mots-clés tient sur une vraie base.
- **MCP** : les mêmes opérations par les tools.

## 10. Les quatre points, tranchés

Validés par Lorin le 2026-10-25, avant l'écriture.

1. **Les familles de forme** (§ 2) plutôt que des dizaines de fichiers écrivant le même
   `include/exclude` : chaque dimension garde son schéma nommé, mais il est fabriqué. C'est ce qui
   rend « toutes les dimensions de MBP » livrable et testable à 100 %.
2. **Les mots-clés en table, sous le TargetingGroup** (§ 4), et non dans l'objet de ciblage : le
   volume et les erreurs par mot-clé l'exigent. Les listes de négatifs partagées restent, elles, une
   dimension qui référence une liste.
3. **Le refus vient du profil de levier, l'avertissement du registre de plateforme** (§ 5) : c'est L2
   appliqué à la lettre, et la seule lecture de § 8 qui tienne tant qu'aucune plateforme n'est livrée.
4. **Les identifiants de référentiel restent opaques** (§ 6), Omniscient étant hors périmètre : on
   stocke l'id et les valeurs dénormalisées envoyées par l'appelant, et l'obsolescence se découvre à
   la poussée.

## 11. Ce que l'écriture a changé

Quatre choses que seule l'écriture a montrées. Elles sont **tranchées et faites**, notées ici pour que
la décision ne se reprenne pas.

1. **Un défaut de la phase 4 trouvé en chemin** : `BudgetCurveServicePlugin` n'était pas enregistré
   sur le serveur HTTP. Les vingt-cinq routes des courbes auraient levé une erreur au premier appel,
   et tous les tests unitaires passaient — ils montent leur propre application. Le plugin est
   enregistré, et une garde lit désormais `src/services/` depuis le disque pour vérifier que **tout**
   service exporté est enregistré : un oubli de ce genre fait rougir la suite.
2. **Les mots-clés ne font pas une transaction par ligne.** Le `runBulk` de la phase 2 ouvre une
   transaction par item, ce qui serait des centaines d'allers-retours pour une liste collée depuis un
   tableur. Les textes sont donc jugés en mémoire, les valides insérés en **une** instruction qui
   ignore les doublons, et la réponse relue. Le format des refus reste celui des bulks :
   `toBulkFailure` est exporté du helper au lieu d'être recopié.
3. **Les listes n'ont pas de filtre par label.** Le CRUD de référence en donne un à toute ressource ;
   une liste est un outil, pas une chose qu'on organise par labels — comme le Label lui-même, elle
   n'en porte pas.
4. **Les labels des dimensions sont en français**, parce qu'ils sont ce que le front affiche sans les
   traduire (§ 2) — le reste du code et des JSDoc reste en anglais.
