# Phase 6 — Assets et créas

Contrat de la phase 6. La **bibliothèque d'un Advertiser** : les **assets**, qui sont les octets et
une ressource à part entière, et les **créas**, qui n'en sont jamais — une créa dit _comment_ une
plateforme reçoit un message, et porte ses versions.

Prérequis : la phase 3 (l'arbre, dont la `Line` choisit une créa).

Entrées validées : `../../CADRAGE.md` § 9 (dont D37), `leviers.md` L18, L19, L20 et G5, et
`~/PinkWhale/multi-search/backend/src/services/asset.service.ts`, **notre code** (D1) dont l'inspection
d'image et la clé de stockage se transcrivent.

---

## 1. Trois entités et un lien

```
assets               (advertiser, empreinte) unique sur les vivants
creatives            format + subtype, la bibliothèque de l'Advertiser
creative_versions    immuables, une active par créa
creative_version_assets   quel asset joue quel rôle dans quelle version
```

Le lien N-N vit entre un **asset** et une **version**, pas une créa : ce qui est figé, ce sont les
octets d'une version. « Les assets d'une créa » est l'union de ceux de ses versions, et c'est ce que
l'API répond.

## 2. L'asset est une ressource de premier plan

Pas un attachement de créa (`../../CADRAGE.md` § 9) : il a son CRUD, ses labels, sa recherche, et il
existe **avant** toute créa — c'est ce qui rend possible la génération par IA dans les deux sens.

| Colonne                 | Règle                                                                      |
| ----------------------- | -------------------------------------------------------------------------- |
| `advertiserId`          | La bibliothèque est par Advertiser                                         |
| `fingerprint`           | SHA-256 des octets ; **unique par Advertiser** parmi les vivants           |
| `mimeType`, `sizeBytes` | Relevés sur les octets reçus                                               |
| `width`, `height`       | Lus dans l'image ; `null` hors image                                       |
| `durationMs`            | Pour une vidéo ou un audio ; **déclaré**, voir § 10                        |
| `provenance`            | `uploaded \| ai_generated`                                                 |
| `aiGenerationId`        | La génération qui l'a produit, `null` sinon — uuid opaque jusqu'à sa phase |
| `storageKey`            | `<organization>/<advertiser>/<asset>/<nom sûr>`, comme multi-search        |

**Redéposer le même fichier ne crée pas un second asset** : l'empreinte le retrouve et la réponse est
l'asset existant, en **200** plutôt qu'un 201 — ce qui rend l'upload rejouable.

**Un asset qu'une version vivante utilise ne se supprime pas** : refus explicite avec le nombre de
créas qui le tiennent, jamais de créa cassée (`../../CADRAGE.md` § 9).

## 3. Le registre des couples `(format, subtype)`

Deux discriminants, chacun avec sa charge utile, et **un registre** — même forme que celui des
dimensions de ciblage : un couple déclare le schéma de sa charge utile et les **rôles d'asset** qu'il
exige.

| `format`      | `subtype`    | Ce que la version porte                                     |
| ------------- | ------------ | ----------------------------------------------------------- |
| `search_text` | `rsa`        | Titres et descriptions                                      |
| `display`     | `image`      | Un asset image                                              |
| `display`     | `mraid`      | Un bundle rich media mobile                                 |
| `video`       | `file`       | Un asset vidéo, et son affiche                              |
| `video`       | `vast_url`   | Une URL VAST tierce, et son affiche (G5)                    |
| `video`       | `youtube_id` | Un identifiant de vidéo YouTube, aucun octet (L20)          |
| `audio`       | `file`       | Un asset audio                                              |
| `audio`       | `vast_url`   | Une URL VAST/DAAST tierce                                   |
| `native`      | `assets`     | Titre **obligatoire** (L19), texte, image, appel à l'action |

`(display, html5)` et `(display, script_tag)` **sortent du périmètre v1** (L20) : aucune plateforme de
nos références ne les accepte, et un couple que personne ne prend ferait échouer toutes les previews.
Le jour où une étude de plateforme en trouve une, c'est une entrée de plus dans le registre.

Le **registre de plateforme** déclare les couples acceptés, à la clé `(plateforme, levier)` (G6) : un
couple qu'aucune plateforme du périmètre n'accepte fait échouer la preview, accepté par certaines
seulement il produit un avertissement. Comme en phase 5, ce registre est vide jusqu'à la première
phase de plateforme, donc il n'avertit rien, et le refus du **modèle** marche dès maintenant.

## 4. Les versions sont immuables

Une créa qui diffuse doit pouvoir changer **sans interrompre la diffusion** pendant que les
plateformes revalident (`../../CADRAGE.md` § 9). Donc :

- une version ne se **modifie jamais** et ne se supprime pas : on en crée une nouvelle ;
- la créa pointe une **version active**, celle qui diffuse ;
- l'activation est **explicite** dans cette phase ; le jour où les plateformes valident, c'est leur
  approbation qui la déclenche, et l'ancienne sert jusque-là.

C'est l'écart assumé avec multi-search, qui mute la créa en place : suffisant en Search où la revue
est rapide, insuffisant dès qu'une créa tourne sur plusieurs DSP.

## 5. Ce que la créa porte, et ce que la version porte

| Sur la **créa** (stable)                     | Sur la **version** (figée)    |
| -------------------------------------------- | ----------------------------- |
| Le nom, les labels                           | La charge utile de son couple |
| `format` et `subtype`, immuables             | Les assets, par rôle          |
| `iabCategories` + version de taxonomie (L19) | Les **traceurs tiers** (L18)  |
| `clickThroughUrl`                            |                               |

Le caractère **obligatoire** des catégories IAB et de l'URL de clic est déclaré **par plateforme**,
pas supposé (L19) : Hawk refuse une créa sans URL de clic, audio comprise, là où d'autres n'en
demandent pas. Le modèle les accepte donc nullables et la preview tranche.

Les traceurs vivent sur la version, avec **surcharge possible sur la `Line`** (L18) : chaque adapter
les posera où sa plateforme les attend.

## 6. La `Line` choisit une créa

La `Line` gagne `creativeId`, et le couple **`(TargetingGroup, Creative)` est unique** parmi les
vivantes (`../../CADRAGE.md` § 9) : une même créa ne diffuse pas deux fois sur le même ciblage.

Elle reste **nullable** : une Line sans créa se sauvegarde (§ 13 : l'incomplet s'enregistre), et c'est
la preview qui la refuse au lancement.

## 7. Les routes

| Méthode  | URL                               | Rôle        | Ce qu'elle fait                                             |
| -------- | --------------------------------- | ----------- | ----------------------------------------------------------- |
| `GET`    | `/advertisers/:id/assets`         | `viewer`    | La bibliothèque, filtrée par type et par labels             |
| `POST`   | `/advertisers/:id/assets`         | `manager`   | Dépose un fichier ; le même deux fois donne un asset        |
| `GET`    | `/assets/:id`                     | `viewer`    | Un asset, avec son URL de téléchargement                    |
| `PATCH`  | `/assets/:id`                     | `manager`   | Son nom ; les octets ne changent jamais                     |
| `DELETE` | `/assets/:id`                     | `manager`   | Refusé s'il est utilisé                                     |
| `POST`   | `/assets/:id/restore`             | `manager`   | Le rend à la bibliothèque                                   |
| `PUT`    | `/assets/:id/labels`              | `manager`   | Les labels qu'il porte                                      |
| `GET`    | `/advertisers/:id/creatives`      | `viewer`    | La bibliothèque de créas                                    |
| `POST`   | `/advertisers/:id/creatives`      | `manager`   | Crée une créa **et sa première version**                    |
| `GET`    | `/creatives/:id`                  | `viewer`    | La créa, sa version active, ses assets                      |
| `PATCH`  | `/creatives/:id`                  | `manager`   | Nom, catégories IAB, URL de clic                            |
| `DELETE` | `/creatives/:id`                  | `manager`   | La supprime, versions comprises                             |
| `POST`   | `/creatives/:id/restore`          | `manager`   | La rend                                                     |
| `PUT`    | `/creatives/:id/labels`           | `manager`   | Les labels                                                  |
| `GET`    | `/creatives/:id/versions`         | `viewer`    | Ses versions, la plus récente d'abord                       |
| `POST`   | `/creatives/:id/versions`         | `manager`   | En crée une ; rien n'est modifié                            |
| `GET`    | `/creative-versions/:id`          | `viewer`    | Une version et ses assets                                   |
| `POST`   | `/creative-versions/:id/activate` | `manager`   | La met en diffusion                                         |
| `GET`    | `/creative-formats`               | authentifié | Le registre des couples et le schéma de chaque charge utile |

Les créas servent le **bulk** du CRUD de référence ; les assets **non** : leur création, ce sont des
octets, et un envoi porte un fichier. Et leurs tools MCP du même nom (D21).

## 8. Les codes d'erreur de la phase

Catalogués dans `error-codes.md`, section « La bibliothèque : assets et créas ».

| Code                          | Statut | Quand                                                  | `params`                      |
| ----------------------------- | ------ | ------------------------------------------------------ | ----------------------------- |
| `asset_too_large`             | 400    | Le fichier dépasse le plafond d'envoi                  | `maxBytes`, `sizeBytes`       |
| `asset_type_unsupported`      | 400    | Le type annoncé n'est pas accepté                      | `mimeType`, `accepted`        |
| `asset_unreadable`            | 400    | Les octets ne se lisent pas comme l'image annoncée     | `mimeType`                    |
| `asset_other_advertiser`      | 400    | Un asset d'un autre Advertiser dans une version        | `assetId`, `advertiserId`     |
| `asset_not_found`             | 404    | Absent, supprimé, ou d'une autre Organization          | `{}`                          |
| `asset_not_deleted`           | 409    | `restore` sur un asset vivant                          | `{}`                          |
| `asset_in_use`                | 409    | Suppression d'un asset qu'une version vivante utilise  | `assetId`, `creatives`        |
| `multipart_required`          | 415    | Un envoi dont le corps n'est pas `multipart/form-data` | `{}`                          |
| `creative_couple_unknown`     | 400    | Le couple `(format, subtype)` n'est pas au registre    | `format`, `subtype`           |
| `creative_payload_invalid`    | 400    | La charge utile ne passe pas le schéma de son couple   | `format`, `subtype`, `reason` |
| `creative_asset_role_missing` | 400    | Un rôle d'asset que le couple exige manque             | `role`, `format`, `subtype`   |
| `creative_asset_role_unknown` | 400    | Un rôle que le couple n'attend pas                     | `role`, `format`, `subtype`   |
| `creative_not_found`          | 404    | Absente, supprimée, ou d'une autre Organization        | `{}`                          |
| `creative_version_not_found`  | 404    | Absente, ou d'une autre Organization                   | `{}`                          |
| `creative_not_deleted`        | 409    | `restore` sur une créa vivante                         | `{}`                          |

L'unicité `(TargetingGroup, Creative)` est tenue par la **base** ; le refus nommé qui l'explique
appartient à la phase de la preview, qui compose les Lines.

## 9. Comment la phase se teste

- **La déduplication** : déposer deux fois le même fichier et n'obtenir qu'un asset, la seconde
  réponse étant l'existant ; le même fichier chez un autre Advertiser en donne bien un second.
- **Le refus de suppression** : un asset tenu par une version vivante ne se supprime pas, et se
  supprime une fois la créa supprimée.
- **Les versions** : créer une créa display, en faire une nouvelle version, vérifier que l'ancienne
  n'a pas bougé d'un octet et qu'elle diffuse jusqu'à l'activation de la nouvelle.
- **Le registre** : chaque couple accepte un exemple et refuse une forme voisine ; un rôle manquant
  et un rôle inconnu sont refusés.
- **L'unicité `(TargetingGroup, Creative)`** : deux Lines du même ciblage ne portent pas la même créa,
  et l'intégration le prouve sur une vraie base.
- **MCP** : les mêmes opérations par les tools.

## 10. Les cinq points, tranchés

Validés par Lorin le 2026-10-26, avant l'écriture.

1. **L'empreinte est unique par Advertiser**, pas par Organization : la bibliothèque est celle d'un
   Advertiser (§ 9), donc le même fichier déposé pour deux marques donne deux assets — chacune garde
   la main sur le sien, et supprimer celui de l'une ne casse pas les créas de l'autre. Redéposer dans
   le **même** Advertiser répond l'existant en 200.
2. **Ce que le conteneur ne sait pas mesurer est déclaré.** Les dimensions d'une image se lisent dans
   ses octets — `image-size`, que multi-search utilise déjà, est la seule dépendance que la phase
   ajoute. Mais la **durée** d'une vidéo ou d'un audio demanderait `ffprobe`, qui n'est pas dans
   l'image : elle est donc **envoyée par l'appelant** et nulle sinon. Les plateformes revalident de
   toute façon, et la preview reflète leur verdict (§ 9 de `../../CADRAGE.md` : aucune validation
   interne).
3. **Les assets d'une version sont nommés par rôle** — `image`, `video`, `audio`, `thumbnail`, `logo`,
   `icon` — et le registre déclare les rôles que chaque couple exige. C'est ce qui permet d'exiger
   l'affiche d'un VAST en redirection (G5) sans écrire un `if` par plateforme.
4. **L'activation d'une version est explicite dans cette phase.** Le modèle cible dit « la nouvelle
   prend le relais quand la plateforme l'a approuvée » ; aucune plateforme ne valide encore, donc la
   route d'activation existe et la synchro la pilotera plus tard. Rien ne sera à défaire : c'est la
   même colonne.
5. **Une créa se supprime avec ses versions**, et un asset lui survit : l'asset est une ressource de
   premier plan, pas un attachement.

## 11. Ce que l'écriture a changé

Quatre choses que seule l'écriture a montrées. Elles sont **tranchées et faites**.

1. **Un code du contrat n'existe pas.** `creative_version_foreign` devait refuser l'activation d'une
   version appartenant à une autre créa — impossible : une version est nommée par **son** id et porte
   sa créa, donc il n'y a rien à confronter. Le code est retiré plutôt que gardé pour une branche
   qu'aucun appel n'atteint.
2. **Un refus de multipart se met en forme comme un refus de corps JSON.** Les parties d'un envoi ne
   traversent pas le schéma de la route, donc le handler lève une erreur **de la forme de Fastify** et
   laisse le gestionnaire d'erreurs nommer le champ, la règle et l'emplacement : une seule mise en
   forme, au même endroit, et `field` dit bien `labelIds` ou `file`.
3. **Ce que la bibliothèque d'images sait, on ne le redemande pas.** `image-size` garantit les
   dimensions d'une image qu'il a lue ; les gardes qui les revérifiaient étaient mortes et sont
   parties. Un format lisible mais hors liste — un BMP — est refusé par la recherche de son type dans
   la liste des acceptés, sans branche de plus.
4. **Le fixture d'arbre de campagne est devenu commun.** L'intégration de la phase 5 et celle de
   cette phase ont besoin de la même chaîne Advertiser → campagne → levier → AdGroup →
   TargetingGroup : elle vit dans `test/integration/database.utils.ts`, et les deux specs la lisent.
