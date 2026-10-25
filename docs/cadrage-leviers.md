# Cadrage — les leviers

**À produire** : `backend/docs/leviers.md`, le document qui dit, fonctionnalité par fonctionnalité et levier par levier, ce qui est transverse et ce qui est spécifique.

**Quand** : en parallèle du cadrage du reporting, avant la phase des conversions.

**L'objectif est le transverse autant que possible.** Une fonctionnalité écrite une fois pour les six leviers vaut mieux que six variantes. Mais chaque levier est un **paradigme différent** — ce qu'on achète, au coût de quoi, ce qui mesure le succès — et forcer le transverse là où les paradigmes divergent produit une abstraction qui ne sert personne. L'étude se mène donc **levier par levier**, et pas « Search contre le reste ».

**À lire d'abord** : `../CADRAGE.md` section 5 (profils de levier), section 6 (matrice levier × plateforme) et section 17 (périmètre repris de multi-search).

---

## 1. Le paradigme de chaque levier

Pour chacun des six leviers — `search`, `dooh`, `audio`, `social`, `ctv_tvs`, `dac` — établir :

- **Ce qu'on achète** : une intention de recherche, une impression sur un écran dans la rue, une écoute, un visionnage, un placement dans un fil.
- **L'unité d'achat** : CPC, CPM, CPCV, CPL, autre. C'est ce qui décide quelles stratégies d'enchères ont un sens.
- **Ce qui mesure le succès** : un clic, une visite en magasin, une complétion de vidéo, une part de voix, une conversion en ligne.
- **La temporalité** : une campagne Search tourne en continu et s'optimise ; un plan DOOH se réserve souvent à l'avance sur un créneau. Est-ce que ça change quelque chose à notre arbre ou à nos courbes de budget ?
- **Le ciblage qui n'existe que là** : les POI et les zones en DOOH, le contenu et les genres en CTV, les mots-clés en Search.
- **Les créas attendues** : quels couples `(format, subtype)`.

## 2. La grille à remplir

Pour chaque fonctionnalité reprise de multi-search, dire pour chaque levier : **transverse** (même code, même modèle), **spécifique** (il faut une variante, et laquelle), ou **sans objet**.

| Fonctionnalité | `search` | `dooh` | `audio` | `social` | `ctv_tvs` | `dac` |
| --- | --- | --- | --- | --- | --- | --- |
| Objectifs de conversion | | | | | | |
| Script de suivi unique | | | | | | |
| Statistiques et rapports | | | | | | |
| Catalogues et campagnes Produits | | | | | | |
| Génération IA de textes | | | | | | |
| Génération IA d'images et d'assets | | | | | | |
| Forecasts | | | | | | |
| Keyword ideas et volumes | | | | | | |
| Liens d'agence | | | | | | |
| E-mails, digests, alertes | | | | | | |
| Référentiel géo | | | | | | |
| Deals (PMP, PG) | | | | | | |
| Capping | | | | | | |
| Courbe de budget et pacing | | | | | | |

Mes intuitions de départ, à confirmer ou démolir : les **statistiques** sont transverses sans discussion ; les **conversions** le sont probablement mais toutes les plateformes ne savent pas les recevoir ; les **catalogues** et le **keyword planner** sont propres au Search ; les **deals** sont propres aux leviers programmatiques ; le **capping** n'a pas de sens en Search. Ce sont des intuitions, pas des conclusions.

## 3. Les questions qui méritent une réponse argumentée

- **Les conversions sont-elles vraiment transverses ?** Chaque plateforme doit savoir recevoir une conversion et l'attribuer. Lesquelles ne savent pas ? Et le script de suivi unique, qui transmet chaque conversion à toutes, pose un problème de double comptage traité dans [`cadrage-reporting.md`](cadrage-reporting.md) — mais la question de **qui peut recevoir quoi** est ici.
- **Le modèle d'enchères commun tient-il sur six leviers ?** `max_cpc`, `maximize_clicks`, `maximize_conversions`, `cpm` viennent du Search. Le DOOH et la CTV achètent autrement. Faut-il une stratégie par paradigme, ou le profil de levier suffit-il à déclarer ce qui est disponible ?
- **La courbe de budget journalière a-t-elle un sens partout ?** Elle est née d'un besoin Search. Un plan DOOH réservé sur un créneau s'y plie-t-il ?
- **Qu'est-ce qui manque au modèle** pour un levier donné ? C'est la vraie question de ce cadrage : si le DOOH ou la CTV exigent une notion que l'arbre n'a pas, il faut le dire **maintenant**, pas pendant leur phase.
- **Quelles fonctionnalités n'existent pas encore et seront nécessaires ?** La génération d'assets par IA est déjà pressentie ; d'autres apparaîtront en examinant les paradigmes un par un.

## 4. Ce que le document de référence doit contenir

`backend/docs/leviers.md` :

1. Une fiche par levier : paradigme, unité d'achat, mesure du succès, ciblage propre, créas attendues, plateformes.
2. La **grille remplie**, avec une justification là où c'est « spécifique ».
3. Les **manques du modèle** révélés par l'étude, chacun avec sa conséquence sur l'arbre ou sur les entités.
4. Les conséquences sur les **profils de levier** (`../CADRAGE.md` section 5) : ce que chaque profil doit déclarer en plus de ce qui est déjà prévu.
5. Les décisions prises, numérotées, à faire valider par Lorin.

## 5. Les pièges

- **Forcer le transverse** sur des paradigmes qui divergent produit une abstraction que personne ne peut utiliser sans la contourner. Quand deux leviers ont vraiment besoin de deux comportements, le profil de levier est là pour ça.
- **Multiplier le spécifique** par facilité produit six fois le même code avec cinq bugs différents. Le doute se tranche en faveur du transverse, mais avec un argument.
- **Ne pas conclure sur de la documentation seule.** Ce qu'un levier exige se voit en regardant ce que ses plateformes acceptent — donc ce cadrage se nourrit de [`cadrage-plateforme.md`](cadrage-plateforme.md), et peut rester ouvert sur un levier jusqu'à ce que sa première plateforme soit étudiée.
- **Le Search est surreprésenté dans nos références** : multi-search ne connaît que lui. Ce qui paraît « naturel » dans son modèle est souvent une habitude du Search, pas une vérité de l'achat média.
