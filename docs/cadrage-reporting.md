# Cadrage — le reporting

**À produire** : `backend/docs/reporting.md`, le document de référence du reporting d'Omnipotent.

**Quand** : avant la première phase qui lit des statistiques chez une plateforme — donc avant le découpage du plan si possible, parce que ce cadrage peut encore ajouter une dimension à la table de faits.

**Pourquoi c'est critique** : pour une plateforme publicitaire, le rapport *est* le produit. Un chiffre faux et crédible est pire qu'un chiffre absent. Et les douze plateformes ne remontent ni les mêmes métriques, ni à la même fraîcheur, ni par le même mécanisme.

**À lire d'abord** : `../CADRAGE.md` section 15 (Reporting), section 7 (Projection sur les plateformes) et section 14 (Synchronisation pilotée par l'état) ; puis `../A-FAIRE.md` section 13.

---

## 1. L'état des lieux, vérifié dans le code

| Plateformes | Ce qui existe |
| --- | --- |
| Google Ads, Microsoft, OpenAI, Thrad | **Prouvé, en production chez multi-search.** Un contrat `InsightRow` minimal : `day`, `externalAdId`, `cardKey`, `impressions`, `clicks`, `costMicros`, `conversions`, `conversionValueMicros`. Les deux derniers sont **déjà nullables** « where the platform reports none » |
| Hawk | **Adapter de reporting complet** dans le `reporting-worker` de MBP : `impression`, `click`, `visit`, `conversion`, les quartiles, la visibilité IAB, **sept** colonnes de coût dont `agencyMargin`. Synchrone. *(Les 6 mesures des types de `meta-dsp-lib` étaient une vue partielle.)* |
| DV360 | **Types seulement** : `IMPRESSIONS`, `CLICKS`, `MEDIA_COST_ADVERTISER`, `TRUEVIEW_VIEWS`, `COMPLETE_LISTENS_VIDEO`. **Asynchrone** : créer une query, poller, télécharger |
| Amazon DSP | **Types seulement** : des **centaines** de colonnes, tout l'univers retail (`detailPageViews`, `addToCart`, `purchases`), ses frais propres (`amazonDSPAudienceFee`, `amazonDSPConsoleFee`), et `totalCost` ≠ `supplyCost`. **Asynchrone**, `groupBy: order \| lineItem \| creative`, `timeUnit: SUMMARY \| DAILY` |
| Meta, TikTok, Snap, GAM | **Adapter de reporting complet** dans le `reporting-worker` (types, normaliseur, ventilations), malgré l'absence de module dans `meta-dsp-lib` |
| Amazon Search | **Rien**, nulle part |

**Il existe une référence lisible pour onze plateformes sur douze.** *(Corrigé le 2026-10-25 : cette section affirmait l'inverse, en se fiant au README de `mbp-api`, périmé. Le `reporting-worker` porte 191 fichiers TypeScript, un fait canonique, un registre d'adapters et huit adapters de reporting.)* Seule Amazon Search n'a rien.

### Où regarder

Dans multi-search (notre code, réutilisable) :

```
~/PinkWhale/multi-search/backend/src/
├── database/entities/stats-daily.entity.ts        la table de faits actuelle
├── database/entities/platform-campaign.entity.ts  statsReadAt, la fraîcheur par unité
├── database/entities/fx-rate.entity.ts            les taux BCE
├── platforms/platform-adapter.ts                  le contrat InsightRow
├── services/stats.service.ts                      pull et backfill
├── services/platform-status.service.ts            comment la fraîcheur est exposée
├── modules/report/                                la surface d'API des rapports
├── types/report.types.ts                          les schémas Zod des rapports
└── jobs/index.ts                                  stats.pull (horaire), stats.backfill (05:30 UTC, 30 jours)
```

Dans MBP et `meta-dsp-lib` (lecture seule, jamais de copie) :

```
~/OmniAd/mbp/meta-dsp-lib/src/types/dsp/hawk/reporting.ts      dimensions et mesures Hawk
~/OmniAd/mbp/meta-dsp-lib/src/types/dsp/dv360/reporting.ts     le mécanisme asynchrone
~/OmniAd/mbp/meta-dsp-lib/src/types/dsp/amazon/report.ts       l'ampleur du catalogue Amazon
~/OmniAd/mbp/mbp-api/apps/mbp-api/src/database/entities/external-id-history.entity.ts
~/OmniAd/mbp/mbp-api/apps/mbp-api/src/services/delivery/       le port de lecture des faits
~/OmniAd/mbp/mbp-api/apps/reporting-worker/src/pipeline/        le fait canonique, les ventilations, le registre d'adapters
~/OmniAd/mbp/mbp-api/apps/reporting-worker/src/adapters/<dsp>/  LA référence : types de rapport, normaliseur, ventilations
```

---

## 2. Ce qui est déjà décidé, et qui ne se rouvre pas

De `../CADRAGE.md` :

- **Postgres**, table de faits partitionnée par jour, **derrière un port de repository**. ClickHouse est remis à plus tard (D32).
- **Table de faits large à colonnes nullables**, pas de jsonb pour les nombres : on somme en SQL sans détour (D35).
- **Noyau obligatoire** `impressions`, `clicks`, `costMicros` ; familles optionnelles par-dessus.
- **Un registre de capacités de reporting par plateforme**, comme le registre de ciblage : le code ne teste jamais un nom de plateforme (D35).
- **Les métriques propres à une plateforme** vivent dans une table annexe et n'apparaissent que dans le rapport de cette plateforme (D35).
- **Coût canonique = ce que l'annonceur paie**, le détail conservé à côté (D35).
- **Fréquence de pull déclarée par plateforme**, pas globale (D35).
- **Les trous restent `null`, jamais des zéros** (D35).
- **Aucun écran n'annonce du « temps réel »** ; la fraîcheur est déclarée et affichée par plateforme (D35).
- La table de faits est **clé sur nos entités**, pas sur les identifiants plateforme, et un **historique append-only des identifiants externes** permet qu'un rapport portant un ancien identifiant retrouve la bonne entité (D40).

---

## 3. Les six problèmes de mapping à résoudre

C'est le cœur du cadrage. Aucun n'est un renommage de colonnes.

### 3.1 Mapping d'identité

Relier une ligne de rapport plateforme à **nos** entités (campagne, levier, AdGroup, TargetingGroup, Line).

Multi-search utilise **deux mécanismes selon la plateforme**, et la nuance compte : chez **Google et Microsoft**, la clé de carte est posée dans un **paramètre d'URL personnalisé** (`mskey`) et relue depuis le rapport — robuste ; chez **OpenAI et Thrad**, elle est dans le **nom de l'annonce**, ce qui casse si un client le modifie. Par ailleurs multi-search enregistre déjà les identifiants externes de ce qu'il crée (`platform_campaigns.cards`, `.keywords`, `.externalCampaignId`, `.externalAdGroupId`), mais ne s'en sert pas pour l'attribution des statistiques.

**À décider :**
- Quels identifiants externes on enregistre **à l'écriture**, et à quel niveau de notre arbre. Multi-search enregistre déjà les cartes et les mots-clés dans `platform_campaigns` ; MBP porte un `externalId` sur chaque unité de diffusion.
- La forme exacte de l'**historique append-only** des identifiants : une ligne par changement, jamais modifiée ni supprimée, et une première matérialisation (pas d'identifiant → un identifiant) qui n'est pas un changement.
- Ce qu'on fait d'une ligne de rapport qu'on **n'arrive pas** à rattacher : rejet, ligne « non attribuée » visible dans le rapport, ou alerte. Elle ne doit pas disparaître en silence.
- Le tag dans le nom reste-t-il, comme **filet de secours** pour retrouver ce qu'une synchro interrompue a créé ? (Il sert déjà à l'idempotence des adapters, c'est un autre usage.)

### 3.2 Mapping de métriques

Au-delà des noms (`impression` / `impressions` / `METRIC_IMPRESSIONS`), les **définitions** diffèrent : un clic Search n'est pas un clic DOOH ; une « conversion » dépend de la fenêtre et du modèle d'attribution de chaque plateforme ; `videoComplete` chez Hawk n'est pas `COMPLETE_LISTENS_VIDEO` chez DV360.

**À produire :** un **dictionnaire canonique** — pour chaque métrique, son nom, sa définition en une phrase, son unité — puis, par plateforme, la correspondance **et la perte**. Une traduction avec perte doit être écrite comme telle, pas masquée.

**À décider :**
- Le noyau obligatoire et les familles optionnelles (conversions, vidéo avec ses quartiles, audio, DOOH, search).
- Quelles métriques sont **stockées** et lesquelles sont **calculées à la lecture** (un CTR, un eCPM ne se stockent pas : ils se dérivent, sinon ils deviennent faux dès qu'on agrège).
- Ce qu'on fait des métriques qu'une seule plateforme remonte : table annexe (déjà décidé), mais sous quelle forme.

### 3.3 Mapping d'unités et de devises

Le coût arrive en **micros**, dans la **devise du compte plateforme**, alors que la campagne a sa propre devise avec un **taux figé au moment où la plateforme a été ajoutée**.

**À décider :**
- Stocke-t-on le coût dans la **devise du compte** (ce que fait multi-search) et convertit-on **à la lecture**, ou stocke-t-on converti ? Stocker natif garde la vérité de la facture plateforme mais impose une jointure ; stocker converti simplifie la lecture mais perd la facture et fige une conversion.
- Dans tous les cas, la conversion utilise le **taux figé de la plateforme**, jamais celui du jour — sinon les totaux passés bougent rétroactivement, ce qui est inacceptable dans un rapport.
- Les frais plateforme (`amazonDSPAudienceFee`, `amazonDSPConsoleFee`, marges) : dans le coût canonique ou à côté ?

### 3.4 Mapping temporel

Le jour d'un rapport est celui du **compte plateforme**, pas celui de la campagne (UTC chez Thrad). Un rapport « par jour » multi-plateformes additionne donc des journées qui ne se recouvrent pas exactement.

**À décider :** garder le jour du compte (fidèle à la facturation plateforme, ce que fait multi-search) ou reventiler au prorata dans le fuseau de la campagne (fidèle à l'utilisateur, inexact face à la facture). Les deux sont défendables ; il faut trancher, l'écrire, et l'afficher dans le rapport.

Question liée : faut-il de l'**horaire** ? Si oui, sur quelles plateformes et pour quoi faire — cela change la volumétrie d'un ordre de grandeur et c'est le principal argument qui ferait revenir ClickHouse.

### 3.5 Mapping de granularité

Les plateformes ne descendent pas au même niveau : multi-search descend à l'annonce, Hawk au creative et jusqu'au POI visité, Amazon au `lineItem`, DV360 selon la query, certaines s'arrêtent à la campagne.

**La règle est posée : on ne répartit jamais une métrique qu'on n'a pas mesurée.** Le rapport s'arrête au niveau le plus fin que la plateforme fournit ; en dessous, c'est « non disponible sur cette plateforme », pas une estimation.

**À décider :** comment l'API l'exprime. Un champ par plateforme disant « mon niveau le plus fin est X » ? Des cellules explicitement `null` avec un motif ? Il faut que le front puisse l'afficher sans inventer.

### 3.6 Double comptage des conversions

**Le piège le plus dangereux du lot.** Le script de suivi unique de multi-search « charge les balises de chaque plateforme utilisée et **transmet chaque conversion à toutes** ». Chaque plateforme s'attribue donc la même conversion, et **la somme des conversions plateformes surcompte** — d'autant plus que les modèles d'attribution se chevauchent.

**À décider :** deux colonnes distinctes qui **ne s'additionnent jamais** —
- les conversions **attribuées par chaque plateforme**, qui servent à leur optimisation et doivent être remontées telles quelles ;
- les conversions **mesurées par nous**, qui sont la source de vérité du rapport.

Et ce qui en découle : quel chiffre le rapport affiche par défaut, comment on nomme les deux pour qu'un utilisateur ne les confonde pas, et ce qu'on fait du coût par conversion (lequel des deux numérateurs).

---

## 4. Ce que le document de référence doit contenir

`backend/docs/reporting.md` :

1. Le **schéma de la table de faits** : colonnes, nullabilité, clés, partitionnement, index, et ce qui y est interdit.
2. Le **dictionnaire canonique des métriques** : nom, définition, unité, famille.
3. La **table de correspondance par plateforme** : métrique canonique → métrique plateforme, avec la perte annotée, et les trous assumés.
4. La forme du **registre de capacités de reporting** (son type TypeScript) : métriques, granularité la plus fine, synchrone ou asynchrone, fraîcheur attendue, fréquence de pull, fenêtre de restatement, fuseau, devise, quota propre au reporting.
5. Les **règles d'agrégation** : ce qui se somme, ce qui se dérive, ce qui refuse de s'agréger, et comment les `null` se propagent.
6. Les **jobs** : pull, backfill, et le mécanisme asynchrone (créer → poller → télécharger) qui n'existe pas dans multi-search et qu'il faut concevoir.
7. La **surface d'API** des rapports, avec la fraîcheur par plateforme exposée.
8. Les **décisions prises**, numérotées, à faire valider par Lorin.
9. Les **questions restées ouvertes**, et dans quelle phase elles se tranchent.

---

## 5. Les pièges, nommés

- **Un `SUM` sur une colonne que trois plateformes sur cinq remplissent donne un chiffre faux et parfaitement crédible.** C'est le piège numéro un. Les trous restent `null`.
- **Les conversions arrivent en retard**, partout, par la fenêtre d'attribution. Le backfill sur 30 jours de multi-search n'est pas une précaution, c'est une nécessité.
- **Un rapport agrégé mélange des plateformes arrêtées à des heures différentes.** D'où l'interdiction d'annoncer du temps réel.
- **Le mécanisme asynchrone n'existe nulle part dans notre code.** DV360 et Amazon imposent créer → poller → télécharger, avec un état à persister entre les étapes et des rapports qui expirent. C'est un vrai morceau à concevoir, pas une variante du pull synchrone.
- **Les quotas de reporting sont séparés de ceux d'écriture** sur certaines plateformes, et un backfill de 30 jours peut les consommer d'un coup. Multi-search groupe déjà ses lectures par compte pour cette raison.
- **Ne pas concevoir pour les seules plateformes déjà lues.** Amazon Search n'a aucune référence, et une transcription fait toujours remonter des surprises ; le modèle doit les accueillir sans migration de la table de faits.

## 6. Hors périmètre

Implémenter. Choisir ClickHouse (c'est décidé : Postgres). Concevoir le front. Mener les études plateforme par plateforme — celles-là sont dans `cadrage-plateforme.md` et se font dans la phase de chaque plateforme ; ce cadrage-ci fixe le **modèle** qui les accueillera.
