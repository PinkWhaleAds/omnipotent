# Phase 8 — Preview et cycle de vie

Contrat de la phase 8. La **preview**, qui dit ce qui sera créé chez chaque plateforme et ce qui
cloche, et le **cycle de vie** `draft → preview → launch`. C'est la phase qui fait parler ensemble
tout ce que les précédentes ont construit — l'arbre, les courbes, le ciblage, les créas, les comptes —
sans appeler une seule plateforme.

Prérequis : les phases 4, 5, 6 et 7, toutes livrées.

Entrées validées : `../../CADRAGE.md` § 7 (la projection et l'éclatement), § 8 (le piège du budget mal
ciblé), § 9 (les couples acceptés) et § 13 (le cycle de vie), plus L5, L19 et G5.

---

## 1. La rigueur est à la publication, pas à la saisie

C'est la phrase qui tient la phase (`../../CADRAGE.md` § 13). Une campagne en `draft` s'enregistre
**en mode permissif** : seules les erreurs structurelles répondent 400, et une campagne incomplète
est une campagne en cours d'écriture, pas une faute. La preview est ce qui regarde l'ensemble, et le
lancement ce qui refuse tant qu'elle trouve une erreur.

Trois conséquences, et elles sont tout le contrat :

- la preview est **en lecture seule** et appelable à tout moment, même sur une campagne lancée ;
- elle sépare les **erreurs** — qui bloquent le lancement — des **avertissements** — une plateforme
  ignorera quelque chose —, chacun avec un **code stable et ses valeurs** pour la traduction ;
- le lancement ne fait rien d'autre que vérifier la preview et changer l'état.

## 2. Ce que la preview répond

Pour chaque couple `(plateforme, levier)` de la campagne :

| Champ            | Ce qu'il dit                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- |
| `objects`        | Combien d'objets seront créés chez elle, par type de son vocabulaire                                                |
| `effectiveCents` | Ce que cette plateforme recevra de budget, part comprise                                                            |
| `adAccountId`    | Le compte sur lequel la marque achète, et sa devise                                                                 |
| `fxRate`         | Le taux figé entre la devise de campagne et celle du compte, `null` tant qu'aucun service de change n'existe (§ 10) |

Plus, au niveau de la campagne, la liste des constats et un `launchable` qui est exactement
« aucune erreur ».

Le compte des objets est **calculé**, pas déclaré par un adapter : la projection de `../../CADRAGE.md`
§ 7 est une **donnée** du registre de plateforme — à quel objet correspond chacun de nos cinq
niveaux, et à quel niveau la plateforme tient un budget —, et le moteur en déduit les nombres. Un
adapter n'a donc rien à implémenter pour que la preview marche, et deux plateformes qui projettent
pareil partagent le même code.

### L'éclatement

Google ne tient un budget que sur la campagne : un budget explicite sur un TargetingGroup n'a pas
d'objet où se poser, donc **ce TargetingGroup devient sa propre campagne** chez elle
(`../../CADRAGE.md` § 7). Le moteur le déduit du niveau de budget déclaré : un nœud **sous** ce
niveau qui porte un budget explicite ajoute un objet de ce niveau. La preview l'annonce — « trois
campagnes Google au lieu d'une » — et un **plafond configurable** par AdGroup la fait refuser
au-delà.

## 3. Les constats

Les erreurs disent qu'il manque quelque chose sans quoi rien ne peut partir ; les avertissements que
quelque chose partira **en moins**. Chacun porte le niveau et le nœud qu'il concerne, quand il en
concerne un.

| Erreur                                | Quand                                                                |
| ------------------------------------- | -------------------------------------------------------------------- |
| `preview_lever_missing`               | La campagne n'achète sur aucun levier                                |
| `preview_ad_group_missing`            | Un levier sans AdGroup                                               |
| `preview_targeting_group_missing`     | Un AdGroup sans TargetingGroup (§ 8 : il en a toujours au moins un)  |
| `preview_line_missing`                | Un TargetingGroup sans Line                                          |
| `preview_creative_missing`            | Une Line sans créa                                                   |
| `preview_creative_version_missing`    | Une créa dont aucune version ne diffuse                              |
| `preview_keywords_missing`            | Un TargetingGroup Search sans aucun mot-clé positif                  |
| `preview_account_missing`             | Aucun compte relié pour cette plateforme et cette devise             |
| `preview_account_unusable`            | Le compte relié n'est pas actif                                      |
| `preview_account_credentials_missing` | Le compte n'a pas de credentials                                     |
| `preview_adapter_missing`             | Le couple `(plateforme, levier)` n'a pas encore d'adapter            |
| `preview_creative_unsupported`        | **Aucune** plateforme du levier n'accepte le couple de la créa (§ 9) |
| `preview_click_url_missing`           | Une plateforme exige une URL de clic que la créa n'a pas (G5)        |
| `preview_iab_categories_missing`      | Une plateforme exige des catégories IAB que la créa n'a pas (L19)    |
| `preview_platform_campaign_cap`       | L'éclatement dépasse le plafond d'objets par AdGroup                 |

| Avertissement               | Quand                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `preview_targeting_dropped` | Une dimension que cette plateforme n'applique pas : **le budget qui y part diffuse sans cette restriction** (§ 8) |
| `preview_creative_dropped`  | Le couple de la créa n'est pas accepté par **cette** plateforme, mais par une autre du levier                     |
| `preview_campaign_split`    | L'éclatement crée plusieurs objets là où il y en aurait eu un                                                     |
| `preview_node_paused`       | Un nœud en pause : il ne partira pas                                                                              |

Le piège du budget mal ciblé mérite son avertissement propre parce qu'il est **silencieux
autrement** : la part des plateformes qui n'appliquent pas la restriction diffuse quand même, ce qui
est l'inverse de l'intention. L'avertissement nomme la dimension, la plateforme et **le montant**.

## 4. Le cycle de vie

```
   ┌───────┐  launch (preview sans erreur)  ┌────────┐
   │ draft │ ─────────────────────────────► │ active │
   └───────┘                                └────────┘
                                             │      ▲
                                      pause  │      │ resume
                                             ▼      │
                                          ┌────────┐
                                          │ paused │
                                          └────────┘
        active, paused ──► ended ──► archived
```

| Depuis             | Vers       | Par                                        |
| ------------------ | ---------- | ------------------------------------------ |
| `draft`            | `active`   | `POST /campaigns/:id/launch` **seulement** |
| `active`           | `paused`   | `PUT /campaigns/:id/status`                |
| `paused`           | `active`   | `PUT /campaigns/:id/status`                |
| `active`, `paused` | `ended`    | `PUT /campaigns/:id/status`                |
| `ended`            | `archived` | `PUT /campaigns/:id/status`                |

La table est la seule autorité, comme en phase 7 : un passage qu'elle ne nomme pas est un 400. Et
`draft → active` n'est **pas** dans la route de statut : on ne lance pas une campagne en changeant un
champ, on la lance en passant la preview.

Les cinq niveaux gardent leur `active | paused`. Un nœud **créé dans une campagne déjà lancée démarre
en pause** (`../../CADRAGE.md` § 13) : la règle vit dans l'écriture commune des nœuds, donc elle vaut
pour les quatre niveaux d'un coup, et la preview le signale.

## 5. Les routes

| Méthode | URL                      | Rôle      | Ce qu'elle fait                        |
| ------- | ------------------------ | --------- | -------------------------------------- |
| `GET`   | `/campaigns/:id/preview` | `viewer`  | Ce qui sera créé, et les constats      |
| `POST`  | `/campaigns/:id/launch`  | `manager` | Lance, si la preview n'a aucune erreur |
| `PUT`   | `/campaigns/:id/status`  | `manager` | Applique une transition de la table    |

Et leurs tools MCP du même nom (D21). La preview est en lecture seule : un modèle peut l'appeler
avant de proposer quoi que ce soit, et c'est précisément ce qu'on veut qu'il fasse.

## 6. Comment la phase se teste

- **La preview d'une campagne vide** : elle liste les manques, un par niveau, et `launchable` est faux.
- **Le chemin complet** : une campagne complète, un couple déclaré au registre, un compte actif avec
  credentials — la preview n'a aucune erreur, le lancement passe, et la campagne est `active`.
- **Le refus** : lancer avec une erreur répond 400 et ne change rien ; relancer une campagne déjà
  lancée est refusé par la table.
- **L'éclatement** : un TargetingGroup qui porte un budget ajoute une campagne plateforme, la preview
  le dit, et le plafond la refuse au-delà.
- **Le piège du budget mal ciblé** : une dimension qu'une plateforme n'applique pas produit un
  avertissement qui nomme le montant qui diffusera sans elle.
- **Les comptes** : pas de compte, compte en attente, compte sans credentials — trois erreurs
  distinctes, parce que les trois se corrigent différemment.
- **MCP** : les mêmes opérations par les tools.

## 7. Les points présentés à Lorin

Avec la livraison, réversibles chacun en peu de lignes — à corriger s'ils sont faux.

1. **La projection est une donnée du registre de plateforme**, pas une méthode d'adapter : le moteur
   compte les objets à partir de la table de `../../CADRAGE.md` § 7 et du niveau de budget déclaré.
   Un adapter n'implémente donc rien pour la preview, et l'éclatement se déduit au lieu d'être codé
   par plateforme.
2. **`fxRate` existe dans la réponse et vaut `null`** tant qu'aucun service de change n'est écrit
   (D22 le fige au lancement). Le champ est dans le contrat pour que le front soit écrit une fois,
   mais il ne dit rien aujourd'hui.
3. **Le registre de plateforme est vide**, donc la preview d'une campagne complète répond aujourd'hui
   `preview_adapter_missing` sur chacun de ses couples : c'est la vérité — aucune plateforme n'a
   d'adapter. Les tests déclarent un couple pour éprouver le chemin complet, comme le fait déjà le
   spec du registre.
4. **Le plafond d'objets par AdGroup** est une configuration (`Preview.maxPlatformObjectsPerAdGroup`),
   avec une valeur par défaut volontairement basse au regard des limites réelles de Google : c'est un
   garde-fou contre l'éclatement, pas une limite de plateforme. La valeur exacte des comptes Google
   est dans `A-FAIRE.md`.
