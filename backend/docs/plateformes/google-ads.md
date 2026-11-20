# Google Ads

Étude de la plateforme, produite au début de la phase 10 et avant d'écrire son adapter
(`../../../docs/cadrage-plateforme.md`). Écrite le 2026-10-27.

## À lire avant celui-ci

**`~/PinkWhale/multi-search/backend/docs/platforms/google-ads.md`** — l'étude de multi-search, sourcée
page par page sur la documentation de Google : versions et dates d'arrêt, en-têtes, niveaux d'accès,
GAQL, `mutate`, ressources d'une campagne Search, validation, Keyword Planner, et une liste de risques
et d'incohérences relevées dans la documentation. Elle est **à nous** et elle fait référence.

**Ce document-ci ne la recopie pas.** Il porte ce qui est propre à Omnipotent — la projection sur nos
cinq niveaux, l'éclatement, ce que notre carte d'identifiants garde, le capping — et les décisions que
cela force. Pour le protocole, c'est l'autre qu'il faut ouvrir.

**Provenance de chaque affirmation**, marquée partout : **[MS]** transcrit de multi-search, qui le fait
tourner en production (`~/PinkWhale/multi-search/backend/src/platforms/google/`, le client, le mapping et
l'adapter) ; **[DOC]** d'après la documentation de Google ; **[À VOIR]** à constater sur notre compte,
que nous n'avons pas encore.

Google Ads est le cas le plus facile du plan : tout ce qui suit est une **transcription**, pas une
découverte. Rien n'en vient de MBP, qui n'a pas d'adapter Google.

---

## 1. La projection sur notre arbre

> **Revue le 2026-11-20 (D55)** : Google pose les lieux sur la campagne, pas sur l'ad group. Chez
> Omnipotent, **un TargetingGroup devient donc une campagne Google et son ad group**, comme
> multi-search, et son budget est le sien ou sa part de l'AdGroup (`../phase-10.md` § 8.3). Le tableau
> ci-dessous est la première version, gardée pour l'histoire.

| Notre niveau       | Objet chez Google                 | Porte un budget ?  | Une période ?      | Un capping ?   |
| ------------------ | --------------------------------- | ------------------ | ------------------ | -------------- |
| **Campaign**       | — rien                            | non                | non                | non            |
| **Lever**          | — rien                            | non                | non                | non            |
| **AdGroup**        | **Campaign** (+ `CampaignBudget`) | **oui**, quotidien | **oui**, début/fin | non (voir § 3) |
| **TargetingGroup** | **Ad group**                      | non                | non                | non            |
| **Line**           | **Responsive search ad**          | non                | non                | non            |

**[MS]** Le plan de création le prouve, opération par opération : un `campaignBudget`, puis une
`campaign` en `advertisingChannelType: 'SEARCH'`, ses `campaignCriterion` (lieux, cercles, appareils),
un `adGroup`, ses `adGroupCriterion` (mots-clés) et ses `adGroupAd`. Le budget est **propre à la
campagne**, jamais partagé, période `DAILY`.

**Le gain sur multi-search est réel.** Multi-search n'a qu'un niveau entre la campagne et l'annonce,
donc il fait « 1 AdGroup = 1 campagne Google + 1 ad group ». Avec le TargetingGroup, nous pouvons
avoir **plusieurs ad groups Google sous un même budget**, ce qui est la façon dont Google fonctionne
réellement.

### L'éclatement

**[MS]** Google ne tient un budget que sur la campagne. Donc, dans les termes de notre registre :
`budgetLevel = 'ad_group'`. Un budget explicite sur un **TargetingGroup** n'a nulle part où se poser :
ce TargetingGroup devient **sa propre campagne Google** (`../../../CADRAGE.md` § 7), et son ad group
pend de cette nouvelle campagne. Le moteur de la phase 9 le déduit déjà, et la preview l'annonce.

Le budget reste **interdit sur la Line** en Search (profil du levier), donc l'éclatement ne peut pas se
cumuler.

### Ce que Google fige

**[MS]**, et c'est ce qui doit faire refuser une modification chez nous plutôt qu'échouer à la synchro :

- un **critère de lieu**, un **cercle de proximité** et un **mot-clé** sont **immuables** : Google
  n'accepte pas de modifier ce qui les définit. Les changer est donc une suppression et une création
  dans le même `mutate`, et l'objet qui en sort a un **nouvel identifiant** chez Google. Qui s'en
  souvient diffère selon l'objet, et c'est le § 7 qui le dit : un lieu et un cercle n'ont **aucune
  clé** dans notre carte `refs` — ils viennent du ciblage d'un TargetingGroup, pas d'un nœud —, donc
  nous ne gardons pas leur identifiant du tout et l'adapter les compare **par leur contenu**, comme le
  fait multi-search. Un **mot-clé**, lui, a sa clé (`keyword:<id>`) : changer son type de
  correspondance lui donne un nouvel identifiant, et c'est l'`ExternalIdHistory` qui garde l'ancien ;
- un **appareil** n'est pas immuable et ne s'enlève pas non plus : il s'exclut par un **ajustement
  d'enchère de 0** — ce que l'interface montre comme « −100 % » — et se recible par un ajustement
  de 1 ;
- **l'`advertisingChannelType`** d'une campagne ne change jamais. Un AdGroup qui changerait de levier
  serait une autre campagne — notre modèle l'interdit déjà, le levier étant au-dessus de l'AdGroup ;
- **le fuseau d'un compte** est immuable (`accountTimezoneMutable: false`), ce qui est cohérent avec
  notre décision de figer le fuseau de la campagne au lancement (phase 9).

## 2. Le ciblage

**[MS]** Ce que le couple `(google_ads, search)` applique vraiment :

| Dimension                                 | Google Search                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pays, régions, villes, codes postaux      | **oui**, en `geoTargetConstant`, inclusion et exclusion                                                                                                                                                                                                                                                                                                |
| Rayon autour d'un point                   | **oui**, en `proximity`                                                                                                                                                                                                                                                                                                                                |
| Intention de lieu                         | **oui** : `PRESENCE` ou `PRESENCE_OR_INTEREST` à l'inclusion ; une exclusion est toujours `PRESENCE`                                                                                                                                                                                                                                                   |
| Appareils                                 | **oui** : desktop, mobile, tablette                                                                                                                                                                                                                                                                                                                    |
| Mots-clés, types de correspondance        | **oui** : `BROAD`, `PHRASE`, `EXACT`, et les négatifs                                                                                                                                                                                                                                                                                                  |
| **Langue**                                | **non, et c'est un refus** : créer un `CampaignCriterion.language` sur une campagne Search répond `ContextError.OPERATION_NOT_PERMITTED_FOR_CONTEXT` depuis fin septembre 2026 **[MS]**. Une campagne diffuse dans la langue de ses annonces et de sa page de destination ; les langues restent utiles au Keyword Planner et à la génération de textes |
| Audiences, centres d'intérêt, démographie | **[À VOIR]** — multi-search ne les utilise pas, donc rien n'est prouvé ici                                                                                                                                                                                                                                                                             |

**Les dimensions dangereuses sont celles que Google ignore en silence** : elles n'échouent pas, elles
**élargissent** la diffusion. La langue en est une depuis septembre : une campagne qui la demandait
diffuse désormais plus large. Chacune devient un avertissement nommé dans la preview
(`preview_targeting_dropped`), qui dit la dimension, la plateforme **et le montant** qui partira sans
elle.

## 3. Le capping — Google Search ne sait pas l'exprimer

**[DOC]** La limitation de la répétition (`frequency capping`) de Google existe sur les campagnes
Display et Vidéo, **pas** sur le Search : il n'y a pas de champ pour elle sur une campagne
`advertisingChannelType: 'SEARCH'`. **[MS]** Le registre de multi-search n'a d'ailleurs aucun champ de
capping pour Google.

Or notre modèle accepte un capping aux cinq niveaux (L5). La règle de `../../../CADRAGE.md` § 10
tranche : **une plateforme qui ne sait pas l'exprimer fidèlement produit un avertissement dans la
preview, jamais une approximation silencieuse.** C'est donc un avertissement, pas un refus — un
utilisateur peut légitimement poser un capping sur un AdGroup multi-plateformes dont Google n'est
qu'une part.

C'est la réponse à la question ouverte de `../../../A-FAIRE.md` : **on avertit, on ne refuse pas**.

## 4. Authentification et comptes

**[MS]** Et c'est le point le plus coûteux de la phase, parce qu'il demande **deux** credentials de
natures différentes :

| Credential                         | À quoi il sert                                                                                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Compte de service** Google Cloud | Tout : lire, créer, modifier, lire les rapports. Un JWT signé en RS256 échangé contre un jeton d'accès          |
| **OAuth d'un humain admin du MCC** | **Envoyer, retirer et terminer les invitations de lien manager** : Google les **refuse** à un compte de service |
| `login-customer-id`                | Notre MCC, en en-tête : c'est par lui que nous agissons sur un compte client                                    |

**Il n'y a plus de developer token** depuis le 2026-09-09 : l'en-tête est « optional and ignored by the
API servers », et le **niveau d'accès appartient au projet Google Cloud** du compte de service
**[MS]**. Les seuls en-têtes sont donc `Authorization: Bearer <jeton>` et `login-customer-id`. Les
résumés générés par IA en tête de certaines pages de Google disent encore le contraire — c'est le corps
des pages qui a raison.

La deuxième ligne du tableau est une surprise qu'il vaut mieux lire ici que découvrir en phase :
multi-search a une commande dédiée (`pnpm google:connect`) qui fait consentir une fois un humain admin
du MCC et garde son `refresh_token`. Il faudra l'équivalent, et son secret va dans Secrets Manager.

**La hiérarchie, dans notre vocabulaire** (`../../../CADRAGE.md` § 12) :

- ce qui porte les credentials = notre **`AdAccount`**, au niveau Organization. Son `externalId` est le
  **customer id** du compte client, et son `scope` n'a rien à porter pour Google — le `login-customer-id`
  est notre MCC, le même pour tous ;
- le sous-advertiser = notre **`AdvertiserAdAccount`**. Pour Google, il n'y a pas d'objet
  « advertiser » sous le compte : l'`externalAdvertiserId` vaut alors le customer id lui-même.
  **[À VOIR]** à confirmer sur notre compte, et c'est une déduction à valider (§ 9, point 2) ;
- **la devise et le fuseau se lisent** sur `customer_client` depuis notre MCC, avec aussi le nom et le
  fait que ce soit un compte de test **[MS]**.

**Le cycle de vie du lien** **[MS]** : `connection: 'manager_link'`. Nous **invitons** le compte
client ; un admin du client accepte dans son interface (Google Ads → Administration → Accès et
sécurité → Gestionnaires). Les états de Google se lisent `PENDING`, `ACTIVE`, `REFUSED`, `CANCELED`
(refusé), `INACTIVE` (terminé) — ce qui est exactement les états de notre `AdAccount` de la phase 7.
Google **ne termine pas** une invitation de lui-même : c'est nous qui la retirons passé un délai.

Et la perte d'accès a ses codes à elle, qui invalident **le compte** et non l'unité
(`USER_PERMISSION_DENIED`, `CUSTOMER_NOT_ENABLED`, `CUSTOMER_NOT_FOUND`,
`ACTION_NOT_PERMITTED_FOR_SUSPENDED_ACCOUNT`…) **[MS]**. Un échec de **nos** credentials
(`UNAUTHENTICATED`, `NOT_ADS_USER`, `CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION`) en est
**volontairement absent** : là, c'est à un opérateur d'agir, jamais au client.

## 5. Enchères et budget

**[MS]** Correspondance de nos stratégies :

| La nôtre               | Google                 | Montant                                                                                                                                 |
| ---------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `max_cpc`              | `MANUAL_CPC`           | **oui**, le CPC maximum, posé sur l'ad group                                                                                            |
| `maximize_clicks`      | `TARGET_SPEND`         | **facultatif** : un plafond de CPC (`cpcBidCeilingMicros`)                                                                              |
| `maximize_conversions` | `MAXIMIZE_CONVERSIONS` | **non envoyé** : Google maximise dans le budget, sans coût par conversion cible. **Demande le suivi des conversions**, donc la phase 18 |
| `fixed_cpm`, `max_cpm` | —                      | **refusé** : `cpm: false`, le Search n'achète pas au mille                                                                              |

**Le budget quotidien** est en **micros**, arrondi à l'unité minimale de la devise du compte : un
millionième pour les devises à unité entière (`JPY`, `KRW`, `VND`, `CLP`, `COP`, `IDR`, `PKR`, `RSD`,
`TRL`), un centième pour toutes les autres **[MS]**.

**Aucun minimum quotidien déclaré** pour Google (`minDailyBudget: null` chez multi-search), donc
`minDailyBudgetCents: 0` dans notre registre. **[À VOIR]** : à confirmer, un compte en devise à unité
entière pouvant se comporter autrement.

**Le comportement à 0 est une règle du moteur, et il nous en manque une.** Multi-search met l'unité
**en pause** quand le budget du jour est à 0, ou sous le minimum de la plateforme, ou quand le budget
planifié est atteint, ou avant la date de début **[MS]**. Notre `desiredUnit` de la phase 9 ne déduit
la pause que des statuts des nœuds : il enverrait un budget de 0 sur un objet actif, ce qu'une
plateforme refuse. **C'est un manque de la phase 9, pas de celle-ci**, et il se corrige dans l'état
voulu — donc pour toutes les plateformes d'un coup.

## 6. Quotas, limites, erreurs

**[MS]** et **[DOC]** :

- **l'unité du quota est l'opération**, sur une fenêtre **glissante de 24 h**, et elle compte **pour tout
  le projet Google Cloud** — pas par compte client. Chaque opération d'un `mutate` compte une unité ;
  une requête `search` compte 1, et ses pages suivantes 0 **[MS]**. C'est pour cela que la phase 9
  journalise un nombre d'opérations par appel ;
- **le niveau d'accès du projet Google Cloud fixe ce plafond**, et un projet neuf démarre au niveau le
  plus bas **[MS]** : `Test` ne parle qu'à des comptes de test, `Explorer` tombe à **2 880 opérations
  par jour en production** — un piège —, `Basic` remonte à 15 000, et `Standard` les lève. Il faut donc
  demander `Basic` **puis** `Standard`, dans cet ordre ;
- **et ce plafond est partagé.** Il vaut pour tout le projet, tous clients confondus. L'étude de
  multi-search le chiffre : avec une revue des annonces toutes les dix minutes et des statistiques
  horaires, **cinquante AdGroups consomment déjà environ 8 400 opérations par jour avant la moindre
  écriture**. Et comme Omnipotent réutilise le projet de multi-search (décision du 2026-10-27), les
  deux produits se partagent le **même** plafond : la demande d'accès **Standard** n'est pas une
  optimisation, c'est une condition pour que les deux tiennent ensemble ;
- **temporaire contre définitif** : les statuts gRPC `ABORTED`, `DEADLINE_EXCEEDED`, `INTERNAL`,
  `RESOURCE_EXHAUSTED`, `UNAVAILABLE`, `UNKNOWN` ; les codes Google `CONCURRENT_MODIFICATION`,
  `INTERNAL_ERROR`, `TRANSIENT_ERROR`, `RESOURCE_TEMPORARILY_EXHAUSTED` ; et les statuts HTTP 429, 500,
  502, 503, 504 **[MS]**. Tout le reste est définitif, ce qui est exactement la classification que la
  phase 9 attend d'une `PlatformError` ;
- **une écriture à moitié réussie n'existe pas** dans un `mutate` : il est **atomique**, et il accepte
  des identifiants temporaires négatifs pour créer un parent et ses enfants d'un coup **[MS]**. C'est
  une bonne nouvelle pour l'idempotence : soit l'arbre entier existe, soit rien ;
- **limites d'objets par compte** : **[À VOIR]**, c'est le point 5 de `../../../A-FAIRE.md`, et c'est
  ce qui règle le plafond d'éclatement de la phase 8.

## 7. Idempotence

**[MS]** Deux mécanismes, et nous avons les deux :

- **retrouver ce qu'une synchro interrompue a créé** : multi-search cherche la campagne par un **tag
  dans son nom** (`[ms:<unitId>]`), ce qui suffit parce que le nom est à nous. Nous avons mieux : la
  carte `refs` du `PlatformUnit`, qui garde l'identifiant de chaque objet **qui vient d'un de nos
  nœuds ou d'un de nos mots-clés** — c'est la forme de ses clés, `<niveau>:<id>` et `keyword:<id>`.
  Ce qui vient du **ciblage** n'y est donc pas : un critère de lieu, un cercle, un ajustement
  d'appareil n'ont pas de clé, et l'adapter les lit chez Google et les compare par leur contenu. C'est
  voulu, et pas un oubli : notre table de faits est clé sur nos entités, pas sur un critère, donc rien
  ne se perd si l'identifiant d'un lieu change. Le tag dans le nom reste utile en secours — une synchro
  tuée entre le `mutate` et l'écriture de `refs` a créé des objets dont nous n'avons pas l'identifiant,
  et c'est le seul moyen de les retrouver. **Nous gardons donc les deux** ;
- **relier une ligne de rapport à notre entité** : un paramètre d'URL personnalisé (`mskey`) sur chaque
  annonce, dont la valeur nomme notre nœud. Google ne donne pas de clé d'idempotence.

## 8. Les créas

**[MS]** Le couple accepté est **un seul** : `search:responsive`. Ses limites sont déjà dans notre
registre (`src/creatives/creative-formats.ts`, `SEARCH_AD_LIMITS`), transcrites en phase 6 — titres de
30 caractères, descriptions de 90, chemins d'affichage de 15.

- **Google fait tourner au plus trois annonces responsive actives par ad group** (`maxAdsPerAdGroup: 3`)
  **[MS]** : au-delà, c'est un avertissement de la preview, pas un refus.
- **Un mot-clé ne dépasse pas dix mots** (`maxKeywordWords: 10`) **[MS]**.
- **Modifier une annonce qui diffuse** réécrit les champs du masque — URLs finales, paramètres
  personnalisés, titres, descriptions, chemins **[MS]** — et **relance sa validation**. C'est
  exactement ce qui justifie nos **versions immuables** de la phase 6 : une version nouvelle est une
  empreinte nouvelle, donc un appel, et la validation repart une fois.
- **Le verdict de validation se lit** : `APPROVED` → approuvé, `APPROVED_LIMITED` et
  `AREA_OF_INTEREST_ONLY` → limité, `DISAPPROVED` → refusé, et les sujets de règlement expliquent un
  verdict limité **[MS]**. « Limité » est **approuvé**, mais montré à moins de monde : ce n'est pas un
  échec, et la preview ne doit pas le traiter comme tel.
- **Extensions** : liens annexes, accroches, extraits structurés, et la marque (nom d'entreprise, logo,
  image) **[MS]**. Un lien annexe à une seule ligne de description est **refusé** : les descriptions
  vont par paire. Le logo est envoyé tel quel, ses contraintes non vérifiées — un logo refusé est
  journalisé.
- **La déclaration de publicité politique européenne** est portée par **chaque** campagne
  (`contains_eu_political_advertising`) **[MS]**. La question ouverte est **tranchée (D53)** : ce n'est
  pas une constante, c'est **l'utilisateur qui déclare**, et la campagne porte un champ obligatoire
  `containsPoliticalAdvertising`. L'adapter envoie donc `DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING`
  quand il vaut `false`, et n'a pas d'autre cas à traiter : `true` ne franchit pas la preview
  (`preview_political_advertising_unsupported`), parce que les déclarations de commanditaire que Google
  exige ensuite ne sont pas modélisées — et que Microsoft refuse la publicité politique tout court
  (`PoliticalCampaignsAreNotSupported`).

## 9. Les points à valider

1. **Le capping Search est un avertissement, pas un refus** (§ 3). Il n'existe pas de champ pour lui
   sur une campagne Search, et CADRAGE § 10 interdit l'approximation silencieuse.
2. **L'`externalAdvertiserId` d'un `AdvertiserAdAccount` Google vaut le customer id lui-même** (§ 4) :
   Google n'a pas d'objet advertiser sous le compte. À confirmer sur notre compte.
3. **La pause à budget nul est corrigée dans l'état voulu de la phase 9**, pas dans l'adapter (§ 5) :
   un objet dont le jour est à 0, ou sous le minimum de la plateforme, ou dont la fenêtre n'a pas
   commencé, part **en pause**. C'est une règle du moteur, donc elle vaut pour toutes les plateformes.
4. **On garde le tag dans le nom en plus de la carte `refs`** (§ 7), pour le seul cas qu'elle ne couvre
   pas : une synchro tuée entre l'appel et l'enregistrement.
5. **Deux credentials, et la commande qui fait consentir l'humain** (§ 4) : le compte de service ne
   suffit pas, Google lui refuse les invitations de lien manager.

## 10. Ce qui reste à constater sur notre compte

Rien de ce qui suit ne peut s'écrire depuis un document ; c'est la liste de clôture de la phase
(`../../../docs/cadrage-plateforme.md` § 5), et elle attend les accès du point 3 de
`../../../A-FAIRE.md`.

- [x] Connecter un compte, lire sa devise et son fuseau — **fait le 2026-11-20** (`../phase-10.md` § 6).
- [ ] Créer une campagne complète de bout en bout, visible dans l'interface de Google Ads.
- [ ] Vérifier que la preview annonçait exactement ce qui a été créé, l'éclatement compris.
- [ ] Modifier quelque chose et vérifier que la synchro n'a touché que ce qui a changé.
- [ ] Relancer la synchro sans modification et vérifier **zéro appel**.
- [ ] Lire le verdict de validation d'une annonce, et un verdict « limité » — en pause, si Google
      examine une annonce en pause (`../phase-10.md` § 1).
- [ ] Lire un rapport et vérifier que ses lignes se rattachent à nos entités par `mskey` — **passe à la
      phase 15** : les campagnes de test restent en pause, sans impressions (`../phase-10.md` § 1).
- [ ] Provoquer une erreur et vérifier qu'elle remonte avec un code stable.
- [ ] Relever les limites d'objets du compte, qui règlent le plafond d'éclatement.
