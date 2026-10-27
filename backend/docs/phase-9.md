# Phase 9 — Synchronisation par état voulu

Contrat de la phase 9. Le **moteur** qui fait exister chez les plateformes ce que l'arbre décrit, et
qui n'y touche plus quand rien n'a changé. C'est la phase qui n'appelle aucune plateforme **et qui
rend les suivantes possibles** : les phases Google Ads, Microsoft, OpenAI et Thrad n'écriront qu'un
adapter chacune.

Prérequis : la phase 8.

Entrées validées : `../../CADRAGE.md` § 7 (la projection et l'éclatement), § 13 (le cycle de vie),
§ 14 (la synchronisation pilotée par l'état, D34), § 19 (D46, le verrou par campagne), et R5
(l'historique des identifiants externes).

---

## 1. La règle qui tient la phase

> La base porte l'intention, la plateforme porte l'état, quelque chose réconcilie périodiquement les
> deux. (`../../CADRAGE.md` § 14)

Tout le reste en découle. Le moteur ne « pousse » pas des modifications : il calcule **l'état voulu**,
le compare à ce qu'il a appliqué la dernière fois, et n'appelle la plateforme que si les deux
diffèrent. Un worker tué en vol ne perd rien, parce que rien n'est tenu en mémoire : l'état voulu se
recalcule depuis la base, et le bit « sale » est en base lui aussi.

Et le coût périodique est **proportionnel au travail en attente, jamais à la taille de la base** —
l'écart assumé avec multi-search, dont le balayage remet en file une synchro pour toutes les
campagnes vivantes toutes les cinq minutes.

## 2. Les trois tables

### `PlatformUnit` — l'unité de synchronisation

Une ligne par couple **(AdGroup, plateforme)**. C'est le grain de multi-search, généralisé : ce que
la plateforme traite comme un tout — un budget, un objet racine, ses enfants — et ce qu'un seul appel
d'adapter applique.

Elle porte le compte sur lequel la marque achète, le taux de change figé au moment où la plateforme a
rejoint la campagne, l'état de synchro (`pending | synced | error`), le **hash du dernier état
appliqué**, les tentatives, la prochaine tentative, et la **carte des identifiants externes**.

La carte `refs` est un `jsonb` clé → identifiant, où la clé est `<niveau>:<id du nœud>` pour un objet
de l'arbre et `keyword:<id>` pour un mot-clé. C'est ce qui généralise les `cards` et les `keywords` de
multi-search aux cinq niveaux : un adapter y retrouve ce qu'il a créé, et l'éclatement y tient
naturellement puisque plusieurs clés peuvent désigner des objets du même niveau.

### `ExternalIdHistory` — append-only

Une ligne par **changement** d'un identifiant externe, jamais modifiée ni supprimée (R5,
`../../CADRAGE.md` § 7). Une première matérialisation — pas d'identifiant, puis un identifiant —
**n'est pas un changement** et ne s'enregistre pas. Elle existe pour qu'un rapport portant sur les
jours précédents, et qui porte encore l'ancien identifiant, retrouve la bonne entité quand la
restructuration de la phase 14 recrée des objets.

### `PlatformCall` — le journal

Une ligne par appel HTTP : la plateforme, le compte, la méthode, le chemin, le statut, la durée,
l'identifiant de requête que la plateforme donne pour son support, l'erreur, et le nombre
d'opérations que l'appel a coûté au quota. C'est la source des incidents plateforme et de la
consommation de quota des phases suivantes. L'écriture est **en arrière-plan** : un insert qui échoue
est journalisé, il ne fait jamais échouer l'appel.

## 3. L'état voulu, et son hash

Une **fonction pure** : l'arbre lu, les comptes, les courbes, et elle rend l'arbre **projeté** chez
une plateforme plus son empreinte.

Chaque objet voulu porte sa clé dans `refs`, le niveau et le nœud dont il vient, ce qu'il devient là-bas
(le vocabulaire de la phase 8), son parent, son nom, son statut, son budget du jour quand il en tient
un, sa fenêtre, son capping, son ciblage, sa créa et ses mots-clés. L'adapter traduit ; il ne décide
rien de la structure.

Le hash est l'empreinte SHA-256 de cet objet voulu. Deux propriétés en découlent, et ce sont les deux
qui comptent :

- **rien n'a changé ⇒ aucun appel.** Le hash est identique, l'unité est sautée ;
- **une seule chose a changé ⇒ un appel.** L'adapter reçoit l'état complet et ce qu'il a déjà créé ;
  c'est lui qui n'envoie que les différences.

Le budget envoyé est le **budget pacé du jour**, converti dans la devise du compte au taux figé. Une
unité en pause envoie le maximum du minimum de la plateforme et de la moyenne planifiée, parce qu'une
plateforme refuse un budget sous son minimum même sur un objet en pause.

**Et un objet qui ne peut pas diffuser aujourd'hui part en pause**, pour trois raisons qui ne sont pas
un statut que quelqu'un a posé : sa fenêtre n'a pas commencé ou s'est terminée, son budget du jour est
à zéro — ce que le pacing répond une fois le total planifié dépensé —, ou ce budget est sous le minimum
de la plateforme. Les trois sont des règles du **moteur** et valent donc pour toutes les plateformes
d'un coup ; sans elles, une plateforme reçoit un budget de zéro, qu'elle refuse ou, pire, qu'elle
remplace par celui de la veille (`plateformes/google-ads.md` § 5).

Deux choses que l'état voulu **ne fait pas**, et qui décident du coût d'une synchro : l'arbre est lu
**une fois** par campagne, et la fenêtre de diffusion de chaque nœud est héritée **en mémoire** depuis
le nœud du dessus au lieu d'être redemandée à la base. La demander par nœud coûterait une requête par
nœud de la branche — des centaines sur un gros AdGroup, à chaque synchro, pour une information qu'on
tient déjà. Seule la courbe est lue, et seulement au niveau qui porte un budget là-bas.

## 4. La convergence, pilotée par l'état

Les quatre règles de D34, chacune dans un job :

| Job              | Fréquence    | Ce qu'il fait                                                                                                 |
| ---------------- | ------------ | ------------------------------------------------------------------------------------------------------------- |
| `sync.campaign`  | à la demande | Applique l'état voulu de chaque unité d'une campagne, sous le verrou de la campagne                           |
| `sync.sweep`     | 1 min        | **Seulement** les unités `pending` ou `error` dont la tentative est due, par un index partiel                 |
| `pacing.refresh` | 1 min        | Les campagnes dont le `nextPacingAt` est échu : recalcule, et reprogramme au minuit local suivant avec jitter |
| `campaign.end`   | 5 min        | Un seul `UPDATE … WHERE`, fuseau résolu en SQL : jamais une boucle sur le parc                                |

**Jamais charger une campagne propre.** Chaque modification d'une campagne lancée marque ses unités
`pending` **dans la même transaction** que la modification : c'est le bit « sale », et il est en base,
donc il survit à tout. Le sweep ne lit que ce bit. Une campagne où rien ne s'est passé n'est jamais
chargée — ni son arbre, ni ses courbes, ni ses comptes.

**Le verrou par campagne** (D46) est un verrou consultatif PostgreSQL : deux workers ne synchronisent
jamais la même campagne en même temps, et celui qui n'obtient pas le verrou **ne fait rien** — le
sweep suivant rattrapera. C'est ce qui rend sûre la création paresseuse d'un objet parent partagé,
comme le mediaplan de Hawk ou la campagne Google d'un éclatement.

**Le coalescing** tombe du même mécanisme : N modifications dans la fenêtre du sweep marquent le même
bit et produisent **une** synchro.

## 5. Les erreurs, temporaires ou définitives

Un appel qui échoue lève une `PlatformError` qui porte ce dont le moteur a besoin : le statut HTTP, si
**réessayer plus tard peut marcher**, si la **clé a été refusée**, l'identifiant de requête de la
plateforme, et son code d'erreur quand elle en donne un.

- **temporaire** — 408, 409, 425, 429, 5xx, ou aucune réponse : l'unité passe `error` avec une
  prochaine tentative qui **double à chaque échec**, jusqu'à une heure. Le sweep la reprendra ;
- **définitive** — tout le reste : l'unité passe `error` avec son code et ses valeurs, et **n'est pas
  reprogrammée**. Il faut une modification — qui remet le bit `pending` — ou une reprise explicite ;
- **clé refusée** (401) : le compte passe `invalid`, la preview le dit, et plus aucune unité de ce
  compte n'est appelée tant qu'un admin n'a pas reposé la clé.

Le code d'erreur voyage tel quel jusqu'à l'API : `lastErrorCode` et `lastErrorParams` sont le code
stable et ses valeurs, le front les traduit (`error-codes.md`).

## 6. Les routes

| Méthode | URL                                           | Rôle      | Ce qu'elle fait                                 |
| ------- | --------------------------------------------- | --------- | ----------------------------------------------- |
| `GET`   | `/campaigns/:id/platform-status`              | `viewer`  | Où en est chaque unité, et ce qui existe là-bas |
| `POST`  | `/campaigns/:id/sync`                         | `manager` | Demande une synchro maintenant                  |
| `POST`  | `/campaigns/:id/platform-units/:unitId/retry` | `manager` | Reprend une unité en erreur sans attendre       |

Et leurs tools MCP du même nom (D21). Aucune route n'expose un credential, ni un corps de requête
envoyé à une plateforme : le journal des appels garde le chemin, pas la charge.

## 7. Comment la phase se teste

Les trois preuves demandées par le plan, plus ce que le moteur doit garantir :

- **Modifier et voir une seule synchro appliquer la différence** : deux modifications dans la même
  fenêtre, un seul appel d'adapter, et le hash enregistré change une fois.
- **Relancer sans modification et voir zéro appel** : la deuxième synchro ne touche pas l'adapter.
- **Tuer un worker en vol** : l'unité reste `pending`, le sweep la reprend, et l'adapter retrouve ce
  qu'il avait créé par la carte `refs`.
- **Le verrou** : deux synchros concurrentes de la même campagne, une seule travaille.
- **Les erreurs** : une temporaire reprogramme avec un délai qui double, une définitive ne
  reprogramme pas, un 401 invalide le compte.
- **L'historique** : un identifiant qui change écrit une ligne, une première matérialisation n'en
  écrit aucune.
- **Deux projections** : le moteur est éprouvé contre une projection en forme de Google Ads (notre
  AdGroup devient une campagne qui tient le budget) **et** une en forme de DSP (notre campagne devient
  un insertion order, le budget est au-dessus), pour qu'il ne puisse pas supposer l'une en silence.
- **Aucun appel à une plateforme**, jamais : adapters factices (`../../CADRAGE.md` § 14).

## 8. Les points présentés à Lorin

Avec la livraison, réversibles chacun en peu de lignes — à corriger s'ils sont faux.

1. **Le grain de l'unité est le couple (AdGroup, plateforme)**, pas `Line × plateforme` comme
   l'esquissait la ligne du plan. C'est le grain que multi-search prouve, et l'identifiant d'une Line
   là-bas vit dans la carte `refs` de l'unité. Une unité par Line devrait, à chaque synchro, soit
   redemander à la plateforme les identifiants de ses ancêtres — un appel, donc la fin de « rien n'a
   changé, aucun appel » —, soit répéter ces identifiants sur chaque ligne. L'unité de **diffusion**
   reste la Line ; l'unité de **synchronisation** est ce qu'un seul appel d'adapter applique.

2. **La projection est devenue la déduction unique**, dans `platforms/projection.ts`, et la preview
   s'en sert maintenant au lieu de compter elle-même. En la partageant, ce que la preview promet et ce
   que le moteur fait ne peuvent plus diverger — et au passage la preview perd une hypothèse qu'elle
   avait en dur : elle ne supposait l'éclatement possible que si la plateforme tient son budget sur
   **notre** AdGroup. Les deux formes sont désormais éprouvées côte à côte dans les tests.

3. **Le lancement fige le fuseau sur la campagne**, avec son rendez-vous de pacing. Un job n'a pas
   d'appelant, donc il ne peut pas lire le fuseau de l'Organization dans le snapshot d'omnipass ; et
   surtout, un changement du fuseau de l'Organization ne doit pas déplacer rétroactivement les jours
   d'une campagne qui diffuse déjà. Même raisonnement que D22 sur le taux de change.

4. **Le bit « sale » est écrit dans la transaction de la modification ; la mise en file, elle, est
   faite par le sweep.** Le bit est non négociable et il est là. Pour le job, pg-boss ne sait pas
   mettre en file **dans** une transaction : un envoi immédiat est forcément après le commit, donc une
   panne entre les deux le perd et seul le sweep rattrape. Le sweep est donc porteur dans tous les
   cas, et sa minute **est** la fenêtre de coalescing que demande § 14. Le lancement, les transitions
   de statut, les deux routes explicites et les jobs mettent en file tout de suite, parce que là c'est
   gratuit. Si une latence d'une minute sur une modification ordinaire te gêne, c'est une ligne par
   service à ajouter.

5. **Le client HTTP commun attend la phase 10**, qui est la première à avoir une plateforme à
   appeler. Ce qui relève de cette phase est livré : la `PlatformError` — puisque c'est le moteur qui
   classe temporaire ou définitif — et le journal des appels. Écrire le client maintenant serait du
   code sans appelant, à couvrir à 100 % sans rien prouver.

6. **Le contenu d'une liste réutilisable n'est pas dans l'empreinte** : le ciblage la référence par
   identifiant. Modifier une liste marque donc les campagnes dont le ciblage mentionne cet
   identifiant, trouvées par une recherche volontairement **trop large** — elle ne peut pas rater une
   référence, et un faux positif ne coûte rien puisque l'empreinte de cette campagne n'a pas changé et
   que sa synchro n'appelle personne. Être généreux est gratuit ici ; être précis demanderait un index
   par dimension.

7. **`external_id_history` est append-only par un trigger**, pas par convention. R5 ne tient que si
   aucun code — le nôtre ou un futur — ne peut réécrire cette trace, et un test d'intégration le
   prouve.
