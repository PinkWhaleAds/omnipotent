# Cadrage — une plateforme

**À produire** : `backend/docs/plateformes/<plateforme>.md`, un document par plateforme.

**Quand** : au début de la phase de la plateforme, avant d'écrire son adapter.

## Ce cadrage n'est pas une découverte

**MBP a déjà prouvé l'essentiel.** Huit plateformes y ont un client API réel et un adapter qui tourne, et multi-search en prouve trois autres. Ce cadrage est donc, pour l'immense majorité du travail, une **transcription** : lire ce qui existe, l'écrire dans notre vocabulaire, vérifier sur un compte réel. La découverte ne concerne que quatre cas, et trois zones de delta.

Le document le plus précieux du lot, à lire avant tout le reste : **`~/OmniAd/mbp/mbp-api/apps/mbp-api/src/services/dsp-adapters/CLAUDE.md`** — 135 Ko de quirks par DSP, accumulés en production (« hard-won per-DSP quirks so you don't rediscover them out of context »). Son `README.md` voisin décrit l'architecture hexagonale des adapters. Attention : les documents de ciblage par dimension qu'il référence (`docs/targeting/README.md`, `dsp-platform-subtleties.md`) sont **git-ignorés et absents localement** — ne pas les chercher.

Rappel : on lit MBP et `meta-dsp-lib` pour comprendre, on n'en recopie aucune ligne. Multi-search est à nous.

---

## 1. Ce qui est déjà prouvé, et où

| Plateforme | Client API | Adapter MBP | Ciblage | Capping | Créas → plateforme | Reporting |
| --- | --- | --- | --- | --- | --- | --- |
| **Hawk** | `meta-dsp-lib` | 28 use-cases | registre | registre | — | `hawkReporting` |
| **DV360** | `meta-dsp-lib` | 24 use-cases | registre | registre | — | types seulement |
| **Amazon DSP** | `meta-dsp-lib` | 19 use-cases | registre | registre | — | `amazonReports` |
| **GAM** | `meta-dsp-lib` | 16 use-cases | registre | registre | — | — |
| **Snap** | `meta-dsp-lib` | 11 (squelette) | — | registre | — | — |
| **TikTok** | `meta-dsp-lib` | 10 use-cases | — | registre | adapter UCA | — |
| **Meta** | `meta-dsp-lib` | 9 use-cases | — | registre | — | — |
| **OpenAI** | `meta-dsp-lib` + **multi-search** | 7 use-cases | multi-search | registre | adapter UCA | **multi-search** |
| **Google Ads** | **multi-search** | — | multi-search | — | multi-search | **multi-search** |
| **Microsoft** | **multi-search** | — | multi-search | — | multi-search | **multi-search** |
| **Thrad** | **multi-search** | — | multi-search | — | multi-search | **multi-search** |
| **Amazon Search** | — | — | — | — | — | — |

Où regarder, précisément :

```
~/OmniAd/mbp/mbp-api/apps/mbp-api/src/services/
├── dsp-adapters/CLAUDE.md                      ← 135 Ko de quirks par DSP, à lire en premier
├── dsp-adapters/README.md                      architecture des adapters
├── dsp-adapters/<dsp>/use-cases/               ce que l'adapter sait faire, opération par opération
├── dsp-adapters/<dsp>/<dsp>.targeting-capabilities.ts   hawk, dv360, amazon, gam seulement
├── dsp-adapters/targeting-capabilities.registry.ts
├── dsp-adapters/capping-capabilities.registry.ts        les 8 DSP, avec ce que chacun ne sait pas exprimer
└── dsp-adapters/<dsp>/builders/                la traduction de nos critères vers les leurs

~/OmniAd/mbp/meta-dsp-lib/src/dsp/<dsp>/        le client HTTP réel de chaque plateforme
~/OmniAd/mbp/mbp-api/packages/core/src/services/lever-eligibility.ts   la matrice levier × DSP, commentée

~/PinkWhale/multi-search/backend/src/platforms/    google, microsoft, openai, thrad : clients, mapping, adapters
~/PinkWhale/multi-search/backend/src/platforms/platform-rules.ts   le registre de capacités, forme à reprendre
```

## 2. Le delta réel — trois zones, et rien d'autre

**2.1 Le reporting — corrigé le 2026-10-25, ce n'est plus un trou.** Le `reporting-worker` de MBP porte **191 fichiers TypeScript** et **huit adapters de reporting réels** (`hawk`, `dv360`, `amazon`, `gam`, `meta`, `openai`, `snap`, `tiktok`), chacun avec ses types, son normaliseur et ses ventilations. Il reste donc une **transcription** par plateforme, et Amazon Search comme seule inconnue. Le modèle qui l'accueille est dans [`cadrage-reporting.md`](cadrage-reporting.md) et `backend/docs/reporting.md`.

**2.2 Les créas.** La distribution d'une créa vers une plateforme n'est prouvée que pour **deux plateformes sur huit** (TikTok et OpenAI, par les adapters de `universal-creative-api`). Et les couples `(format, subtype)` acceptés — image, HTML5, tag script tiers, MRAID, fichier vidéo, VAST en redirection, VAST audio, native — ne sont **déclarés nulle part** : l'entité créa d'UCA porte un format « without any per-format Zod refinement », et la validation était « a future slice ».

**2.3 Le ciblage pour quatre DSP.** Les registres de capacités existent pour Hawk, DV360, Amazon et GAM. Ils n'existent pas pour **Meta, TikTok, Snap et OpenAI** — pour ces quatre, les dimensions supportées sont à établir.

À quoi s'ajoutent deux choses qui concernent **toutes** les plateformes, mais qui sont du travail court :

- **La projection sur notre arbre.** MBP a un arbre différent (`Campaign > Lever > Strategy > TargetingGroup + Line` en frères, feuille `Line × TG × Platform`). Le nôtre est linéaire. La correspondance est donc à **re-dériver**, pas à découvrir — et le chemin est court, puisque les `Order` de Hawk sont déjà désambiguïsés par `(strategyId, targetingGroupId)`, soit exactement notre couple AdGroup × TargetingGroup.
- **La vérification sur un compte réel.** Les comptes de MBP étaient ceux d'Azerion ; les nôtres sont neufs. Ce qui marchait là-bas n'a pas été prouvé ici.

---

## 3. La transcription — ce qui se lit et s'écrit

Pour chacun des points suivants : lire la source, écrire ce qu'elle prouve dans notre vocabulaire, et **marquer d'où ça vient**.

- **Projection** — remplir le tableau ci-dessous depuis les use-cases de l'adapter et la cascade de MBP.

  | Notre niveau | Objet de la plateforme | Porte un budget ? | Une période ? | Un capping ? |
  | --- | --- | --- | --- | --- |
  | Campaign | | | | |
  | Lever | | | | |
  | AdGroup | | | | |
  | TargetingGroup | | | | |
  | Line | | | | |

  Puis en déduire : à quels niveaux un budget explicite chez nous provoque un **éclatement** (`../CADRAGE.md` section 7), et ce que la plateforme **fige après le lancement** — un champ qu'elle refuse de modifier doit faire refuser la modification chez nous, pas échouer à la synchro.

- **Ciblage** — depuis `<dsp>.targeting-capabilities.ts` et les `builders/` quand ils existent. Noter les dimensions **ignorées silencieusement**, les plus dangereuses : elles n'échouent pas, elles élargissent la diffusion, et chacune devient un avertissement nommé dans la preview.
- **Capping** — depuis `capping-capabilities.registry.ts`, qui couvre les huit DSP et dit déjà ce que chacun ne sait pas exprimer fidèlement.
- **Authentification et comptes** — type de credentials, rotation, hiérarchie (ce qui porte les credentials = notre `AdAccount`, le sous-advertiser = notre `AdvertiserAdAccount` et son `externalAdvertiserId`), cycle de vie du lien, lecture de la devise et du fuseau du compte.
- **Enchères et budget** — stratégies disponibles et correspondance avec les nôtres, celles qui demandent un montant, les minimums par devise, la forme du budget quotidien, le comportement à 0.
- **Quotas, limites, erreurs** — unité et fenêtre du quota, limites de débit, codes temporaires contre définitifs, et ce qui arrive quand une écriture réussit à moitié. `platform-rules.ts` de multi-search donne la forme du registre à remplir.
- **Idempotence** — comment retrouver ce qu'une synchro interrompue a créé, et si la plateforme offre une clé d'idempotence. Multi-search utilise un tag dans le nom ; MBP enregistre les identifiants externes.

## 4. Le delta à établir

- **Créas** : les couples `(format, subtype)` acceptés, leurs limites (dimensions, poids, durée, nombre et longueur des titres), l'acceptation des tags tiers et des VAST en redirection avec la profondeur maximale, le cycle de validation et comment on lit le verdict, et ce qui se passe quand on modifie une créa qui diffuse — c'est ce qui justifie nos versions immuables.
- **Reporting** : les huit points de `../A-FAIRE.md` section 13, à constater sur un compte réel. Le modèle qui les accueille est fixé par [`cadrage-reporting.md`](cadrage-reporting.md) ; ce cadrage-ci **remplit** le registre, il ne le redéfinit pas.

## 5. À prouver sur un compte réel avant de clore la phase

Une phase ne se termine pas sur du document.

- [ ] Connecter un compte, lire sa devise et son fuseau.
- [ ] Créer une campagne complète de bout en bout, visible dans l'interface de la plateforme.
- [ ] Vérifier que la preview annonçait exactement ce qui a été créé.
- [ ] Modifier quelque chose et vérifier que la synchro n'a touché que ce qui a changé.
- [ ] Relancer la synchro sans modification et vérifier **zéro appel** (le hash).
- [ ] Lire le verdict de validation d'une annonce.
- [ ] Lire un rapport et vérifier que ses lignes se rattachent à nos entités.
- [ ] Provoquer une erreur et vérifier qu'elle remonte avec un code stable.

## 6. Les plateformes sans aucune référence

**Amazon Search, TikTok Search Ads, Pinterest** : rien n'existe, ni dans MBP ni dans multi-search. Pour celles-là, et pour elles seules, commencer par une **étude de faisabilité** et s'arrêter là — elle suffit pour décider si on les inscrit au plan.

- **Produits publicitaires** : que vend la plateforme, et lesquels nous intéressent ?
- **Levier(s)** : lequel ou lesquels ? Le levier est l'**inventaire**, pas la famille de plateforme — TikTok peut être sur `social` et sur `search`.
- **Accès API** : libre-service ou accord commercial ? Quel type de compte ? Qui le négocie ?
- **Pays et devises** ouverts.
- **Sandbox**, et ce qu'il permet réellement.
- **Verdict** écrit : on intègre, on reporte, on écarte — avec la raison.

Tout ce qui demande une action de Lorin s'écrit dans `../A-FAIRE.md`.

---

## Ce que le document de référence doit contenir

`backend/docs/plateformes/<plateforme>.md` : les sections 3 et 4 remplies, chaque affirmation **datée** et marquée de sa provenance — **« constaté sur notre compte »**, **« transcrit de MBP »**, ou **« d'après la documentation »**. La distinction compte : les documentations publicitaires sont souvent en retard sur les API, et ce que MBP prouvait tournait sur d'autres comptes que les nôtres. Plus les décisions prises, les avertissements que la plateforme déclenchera dans la preview, et ce qui reste à vérifier.

## Hors périmètre

Écrire l'adapter — ça vient après, dans la même phase. Redéfinir le modèle de reporting — c'est [`cadrage-reporting.md`](cadrage-reporting.md). Et recopier du code de MBP ou de `meta-dsp-lib` : on lit pour comprendre le protocole, on écrit le nôtre en axios dans le style de multi-search.
