# Prompts de lancement des sessions

Quatre chantiers parallélisables. Chacun est autoportant : le prompt suffit à démarrer, le document qu'il désigne contient tout le reste.

Le cadrage du reporting est mené par la session de cadrage initiale, il n'a donc pas de prompt ici.

---

## 1. Socle backend — `~/PinkWhale/omnipotent`

```
Tu construis le squelette technique du backend d'Omnipotent, une API d'achat média
multi-plateformes. Aucun code de domaine : seulement le socle.

Lis dans cet ordre, en entier :
1. /home/lorin/OmniAd/omnipotent/docs/handover-socle-backend.md  ← ton périmètre exact
2. /home/lorin/OmniAd/omnipotent/CADRAGE.md, sections 19 et 20
3. /home/lorin/OmniAd/multi-search/backend/CLAUDE.md

Multi-search est notre code et a 36 phases de conventions durcies : ton travail est
à 90 % une transcription, pas une invention. Reprends ses conventions sans les
rediscuter. Le code de /home/lorin/OmniAd/mbp/ appartient à Azerion : il se lit
pour comprendre, jamais ne se recopie.

Livre ce que décrit le handover, vérifie la liste de sa section 4, et n'ajoute
aucune entité de domaine (ni Campaign, ni Lever, ni AdGroup, ni TargetingGroup,
ni Line, ni Creative, ni Asset, ni Label) ni aucun adapter de plateforme.

Les décisions du CADRAGE.md (§ 20) sont prises : ne les rouvre pas. Pour tout le reste,
ne déduis rien en silence — présente tes déductions numérotées à Lorin pour validation.
Ce qui dépend de lui (secrets, variables GitHub, Auth0, bucket Terraform) s'écrit
dans /home/lorin/OmniAd/omnipotent/A-FAIRE.md.

Code et JSDoc en anglais, documentation en français.
```

---

## 2. omnipass — `~/OmniAd/omnipass`

```
Tu construis omnipass, le service d'identité et de tenancy partagé par tous les
projets d'Omnilor (Omnipotent, Omniscient, et les suivants). Le dépôt est vide.

Lis dans cet ordre, en entier :
1. /home/lorin/OmniAd/omnipass/HANDOVER.md  ← tout y est : périmètre, modèle, invariants
2. /home/lorin/OmniAd/omnipotent/CADRAGE.md, sections 16 et 19
3. /home/lorin/OmniAd/multi-search/backend/CLAUDE.md

Le périmètre est minuscule et doit le rester : Users, Seats, Organizations,
memberships, invitations, et un rôle grossier par (user, seat) et (user, org).
Rien d'applicatif. La règle de frontière de la section 2 du handover tranche
chaque hésitation, et le piège nommé à la fin du document — l'élargissement du
périmètre — est le seul vrai risque de ce projet.

Les six entités de multi-search (user, seat, organization, les deux memberships,
invitation) sont à reprendre quasi telles quelles : c'est notre code et il est
éprouvé. Une seule amputation, décrite dans le handover.

Commence par les sept décisions déjà prises (section 10), puis écris
backend/docs/plan.md avant de coder. Ne déduis rien en silence : présente tes
déductions numérotées à Lorin pour validation.

Code et JSDoc en anglais, documentation en français.
```

---

## 3. Cadrage des leviers — `~/PinkWhale/omnipotent`

```
Tu mènes le cadrage des leviers d'Omnipotent. Tu ne codes pas : tu produis un
document de référence, /home/lorin/OmniAd/omnipotent/backend/docs/leviers.md
(crée le dossier s'il n'existe pas).

Lis dans cet ordre, en entier :
1. /home/lorin/OmniAd/omnipotent/docs/cadrage-leviers.md  ← ta mission
2. /home/lorin/OmniAd/omnipotent/docs/README.md           ← les règles de travail
3. /home/lorin/OmniAd/omnipotent/CADRAGE.md, sections 5, 6 et 17

La question centrale : pour chacune des 14 fonctionnalités de multi-search et
chacun des 6 leviers (search, dooh, audio, social, ctv_tvs, dac), est-ce
transverse, spécifique, ou sans objet ? L'objectif est le transverse autant que
possible, mais chaque levier est un paradigme différent et forcer le transverse
là où ils divergent produit une abstraction inutilisable.

La vraie question du cadrage est à la section 3 du document : qu'est-ce qui
manque au modèle pour un levier donné ? Si le DOOH ou la CTV exigent une notion
que notre arbre n'a pas, il faut le dire maintenant, pas pendant leur phase.

Sources : /home/lorin/OmniAd/multi-search (notre code, librement réutilisable) et
/home/lorin/OmniAd/mbp (Azerion : lecture pour comprendre, jamais de copie).
Vérifie dans le code avant d'affirmer — beaucoup de ce qui est documenté dans MBP
n'est pas implémenté.

Ne déduis rien en silence : présente tes déductions numérotées à Lorin pour
validation. Document en français.
```

---

## 4. Faisabilité Amazon Search, TikTok Search Ads, Pinterest — `~/PinkWhale/omnipotent`

```
Tu mènes trois études de faisabilité courtes, pour décider si Amazon Search
(retail search), TikTok Search Ads et Pinterest entrent dans le levier Search
d'Omnipotent, et dans quel ordre. Tu ne codes pas.

Lis dans cet ordre :
1. /home/lorin/OmniAd/omnipotent/docs/cadrage-plateforme.md, SECTION 6 uniquement
2. /home/lorin/OmniAd/omnipotent/docs/README.md   ← les règles de travail
3. /home/lorin/OmniAd/omnipotent/CADRAGE.md, section 6 (matrice levier × plateforme)

Ces trois plateformes n'existent ni dans multi-search ni dans MBP : c'est de la
vraie découverte, contrairement aux neuf autres. Pour chacune, établis : les
produits publicitaires et lesquels nous intéressent, le ou les leviers concernés
(le levier est l'inventaire, pas la famille de plateforme — TikTok peut être sur
social ET search), les conditions d'accès à l'API et le type de compte, les pays
et devises ouverts, l'existence d'un sandbox, puis un verdict écrit : on intègre,
on reporte, on écarte, avec la raison.

Produis /home/lorin/OmniAd/omnipotent/backend/docs/plateformes/faisabilite-search.md
(crée les dossiers). Marque chaque affirmation de sa provenance et de sa date — les
documentations publicitaires sont souvent en retard sur les API.

Ce qui demande une action de Lorin (créer un compte, demander un accès, négocier)
s'écrit dans /home/lorin/OmniAd/omnipotent/A-FAIRE.md.

Ne déduis rien en silence. Document en français.
```

---

## Ce qui attend

`backend/docs/plan.md` — le découpage en phases. À écrire **après** les cadrages reporting et leviers, parce que tous deux peuvent encore ajouter une dimension au modèle ou une notion à l'arbre.
