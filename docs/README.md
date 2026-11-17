# Documents de cadrage — Omnipotent

## La convention

Un **cadrage** est une étude autoportante qu'une session peut prendre seule, mener de bout en bout, et conclure par un **document de référence** versionné dans le dépôt.

- Le **cadrage** dit ce qu'il faut établir, où regarder, et ce qu'il faut produire.
- Le **document de référence** dit ce qui a été décidé, et devient la vérité du projet.

Un cadrage ne code pas. Il établit, il tranche, il documente. L'implémentation vient dans la phase correspondante du plan.

## Deux sortes de documents

- **`cadrage-*.md`** — une étude qui produit un **document de référence**. Elle ne code pas.
- **`handover-*.md`** — un chantier qui produit du **code**.

## Les cadrages et les chantiers

| Document | Produit | Quand |
| --- | --- | --- |
| [`cadrage-reporting.md`](cadrage-reporting.md) | `backend/docs/reporting.md` | ✅ **mené** — le document de référence existe |
| [`cadrage-leviers.md`](cadrage-leviers.md) | `backend/docs/leviers.md` | ✅ **mené** — le document de référence existe |
| [`cadrage-plateforme.md`](cadrage-plateforme.md) | `backend/docs/plateformes/<plateforme>.md` | au début de la phase de chaque plateforme ; sa section 6 seule pour une plateforme non décidée |
| [`handover-socle-backend.md`](handover-socle-backend.md) | le squelette de `backend/` et `infra/` | ✅ **mené** — le socle est livré |
| [`handover-reprise.md`](handover-reprise.md) | rien : il passe le fil à une session qui reprend | écrit le 2026-11-17, à relire **avant** de reprendre le projet |
| [`../../omnipass/HANDOVER.md`](../../omnipass/HANDOVER.md) | le service de tenancy, dépôt séparé | **tout de suite** |

Les prompts de lancement de ces sessions sont dans [`prompts-sessions.md`](prompts-sessions.md).

Le cadrage des plateformes est surtout une **transcription** : MBP prouve déjà huit plateformes et multi-search trois autres. Le delta réel se limite au reporting, aux créas et au ciblage de quatre DSP — le document le dit en ouverture et donne la matrice de ce qui est déjà prouvé.

## Qui pilote

**Claude pilote le projet.** Les sessions de cadrage ont produit les documents de référence de
`backend/docs/` ; à partir de maintenant il y a un fil unique qui tient le plan, l'état et les
arbitrages, et Lorin tranche les questions produit.

Ce qui en découle pour une session qui reprend le fil :

- la vérité du projet est dans `../CADRAGE.md`, `backend/docs/plan.md` et les documents de référence
  qu'il cite — rien d'autre ne fait foi ;
- un document de référence se **corrige** quand il est faux, sur place, avec ce qui le prouve ; on ne
  laisse pas deux documents se contredire ;
- les **numéros de décision** vivent chacun dans leur document (`D…` et `T…` dans `CADRAGE.md` § 20,
  `R…` dans `reporting.md`, `L…` et `G…` dans `leviers.md`, `F…` dans
  `plateformes/faisabilite-search.md`). Relire la dernière valeur **avant** d'en attribuer une ;
- **aucun document n'écrit un compte** de décisions ni de plateformes : ces nombres bougent, et un
  nombre écrit quelque part devient faux sans que personne le voie.

## Les règles, pour toute session qui prend un cadrage

1. **Lire `../CADRAGE.md` d'abord.** C'est la référence du projet : la hiérarchie, l'algèbre du budget, les profils de levier, les conventions et les décisions déjà prises — `D…` et `T…` dans son § 20, `R…` dans `backend/docs/reporting.md`, `L…` et `G…` dans `backend/docs/leviers.md`, `F…` dans `backend/docs/plateformes/faisabilite-search.md`. Ne jamais écrire un compte de décisions dans un document : il périme. Ne pas les rouvrir sans raison ; les contredire demande une validation explicite.
2. **Ne rien déduire en silence.** Toute déduction se présente à Lorin numérotée, pour validation. C'est la méthode qui a produit `CADRAGE.md` et elle fonctionne : elle fait remonter les erreurs avant qu'elles coûtent.
3. **Le code de MBP (`~/OmniAd/mbp/`) et de `meta-dsp-lib` se lit pour comprendre et ne se recopie jamais** — ce sont des projets d'Azerion. Celui de **multi-search (`~/OmniAd/multi-search/`) est à nous**, donc librement réutilisable.
4. **Vérifier avant d'affirmer.** Beaucoup de ce qui est écrit dans MBP n'est pas implémenté (le `Layer` et son escalade, le `reporting-worker`). Lire le code, pas seulement les commentaires.
5. **Ce qui dépend de Lorin** — comptes, accès, relevés sur un compte réel, décisions produit — s'écrit dans `../A-FAIRE.md`, dans la section concernée.
6. **Documentation en français, code et JSDoc en anglais.**
7. **Où écrire** : les cadrages et handovers vivent dans ce dossier (`docs/`, niveau projet) ; les documents de référence du backend vivent dans `backend/docs/` (`plan.md`, `reporting.md`, `leviers.md`, `plateformes/<plateforme>.md`), comme chez multi-search. Créer le dossier s'il n'existe pas encore.

## L'état des chantiers

| Chantier | Produit | État |
| --- | --- | --- |
| Cadrage reporting | `backend/docs/reporting.md` | ✅ mené — `R1`→`R14` **à valider** |
| Cadrage leviers | `backend/docs/leviers.md` | ✅ mené et validé — `L1`→`L29`, `G1`→`G18` |
| Faisabilité Amazon Search / TikTok Search / Pinterest | `backend/docs/plateformes/faisabilite-search.md` | ✅ menée — Pinterest puis Amazon, TikTok reporté ; `F1`→`F16` **à valider** |
| Plan de développement | `backend/docs/plan.md` | ✅ écrit — 33 phases (0 → 32), 2 jalons |
| **Phase 0 — socle backend** | `backend/`, `infra/` | ✅ **livré et vérifié** — couverture unitaire à 100 %, `terraform validate` et les tests hors-ligne verts. Déductions **à valider**, et ce qui dépend de Lorin dans `../A-FAIRE.md` § 10 et § 14 |
| omnipass | dépôt séparé | ✅ **livré et déployé** — son contrat avec le socle est `docs/consuming.md` de `PinkWhaleAds/omnipass`, cloné en `~/PinkWhale/omnipass` |
| Phase 1 — accès et tenancy | `backend/` | ✅ **livrée et vérifiée contre le vrai service** le 2026-11-17 ; le bouchon est supprimé. Reste le 403 `role_required`, qui demande un second compte |
| **Les phases suivantes** | `backend/` | l'avancement réel est dans [`../backend/docs/plan.md`](../backend/docs/plan.md) — ce tableau-ci ne le double pas |

Les règles ci-dessus valent aussi pour une **phase** du plan, pas seulement pour un cadrage.
