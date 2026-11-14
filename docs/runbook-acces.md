# Runbook des accès — clic par clic

Écrit le 2026-10-27 pour Lorin. Chaque section est une suite d'écrans, dans l'ordre, avec ce qu'il
faut en rapporter et où le mettre. `A-FAIRE.md` dit **quoi** ; ce document dit **comment**.

**La règle des secrets, qui ne bouge jamais** : une clé, un mot de passe, un jeton ou un fichier de
clé ne passe **jamais** par le chat. Il va dans `backend/.env` (ignoré par git) ou dans Secrets
Manager. Les identifiants non secrets — un `client_id`, un customer id, un numéro de compte — peuvent
m'être donnés dans le chat.

Les libellés d'interface sont ceux de la fin octobre 2026. Quand un écran ne ressemble pas à ce qui
est écrit ici, dis-le moi plutôt que de chercher : c'est le document qui a vieilli.

**Repris le 2026-11-14**, après trois changements de ton côté : un **nouveau tenant Auth0**, un
**compte gestionnaire Google** et un **compte gestionnaire Microsoft**. Le premier rend caduque une
partie de ce qui était fait — A0 dit quoi exactement —, le deuxième raccourcit la partie B, et le
troisième ouvre une partie C qui n'existait pas.

---

## A. omnipass — ce qui débloque la mise en production

### A0. Ce que le nouveau tenant rend caduc

Tu as créé un **nouveau tenant Auth0**, et tout le monde y déménage — omnipass, multi-search,
Omnipotent. C'est la seule façon que ça marche, et ce n'est pas un choix de confort : omnipass
vérifie la **signature** du jeton que nous lui relayons avec le JWKS du **tenant partagé** (son
`backend/docs/plan.md` § 14). Deux tenants, et chaque jeton relayé est refusé — Omnipotent ne pourrait
résoudre aucun appelant.

**Les valeurs d'avant ne valent plus rien. Ne les recolle nulle part :**

| Valeur de l'ancien tenant             | Ce qu'elle était                              |
| ------------------------------------- | ---------------------------------------------- |
| `dev-3rwjfrn4yf3tar80.eu.auth0.com`   | le domaine du tenant                           |
| `tkSxRukHoCBTTNd616lsiF8Fqb7RpQbv`    | le compte machine partagé vers omnipass        |
| `qUq67lX2piWp4RJSNlSMqOtW51Y2VHBy`    | l'application navigateur (SPA) de multi-search |
| L'API `Omnipotent REST`               | créée et vérifiée le 2026-10-27, sur l'ancien  |

Je les ai retirées d'`A-FAIRE.md` : une valeur morte qui traîne dans un document est pire qu'une
valeur absente, parce qu'elle se recopie sans qu'on se demande d'où elle vient.

**Ce qui n'est pas perdu** : le travail de compréhension. Les pièges restent les mêmes — la section
`User-delegated access` qu'on oublie, l'identifiant d'API MCP qui doit être l'URL exacte du `/mcp`
servi, l'Action post-login sans laquelle aucune première connexion n'aboutit. Le pas à pas ci-dessous
les intègre, dans l'ordre.

**Et une bonne nouvelle** : un tenant neuf repart avec son budget d'entités intact — 10 API et 10
applications. Le mur du 2026-10-27, qui avait déjà fait changer la conception du compte machine
d'omnipass, ne nous gêne pas aujourd'hui. Il reviendra : trois produits qui ont chacun une API REST et
une API MCP **par environnement** mangent dix places vite. La seule réponse durable reste le plan
payant, et ce n'est pas urgent.

### A1. Le jeton GitHub pour installer le paquet — _fait, sauf un clic_

Deux besoins différents, et il ne faut pas les confondre. **A1a est fait depuis le 2026-10-27** et le
paquet est installé ; **A1b reste**, et il fera échouer la CI à la première exécution. Je garde le pas
à pas : un jeton expire, et celui-ci est à 90 jours.

**A1a. Pour ma machine — fait.**

Tu ne trouves pas `~/.npmrc` parce qu'**il n'existe pas par défaut** : npm le crée à la demande, et
c'est à nous de l'écrire. Ce n'est pas un fichier du projet, c'est un fichier de ton compte
utilisateur.

1. va sur **github.com**, clique ta photo en haut à droite → **Settings** ;
2. tout en bas du menu de gauche → **Developer settings** ;
3. **Personal access tokens** → **Tokens (classic)**. **Il faut un jeton « classic »** : GitHub
   Packages ne prend pas encore les jetons « fine-grained » pour npm ;
4. **Generate new token** → **Generate new token (classic)** ;
5. **Note** : `omnipotent-packages` ; **Expiration** : 90 jours ;
6. dans la liste des scopes, coche **`read:packages`** seulement. Rien d'autre — pas besoin de
   `repo` pour lire un paquet ;
7. **Generate token**, et **copie le jeton** : GitHub ne te le remontrera plus.

Puis, dans un terminal, **une seule commande** (remplace `ghp_xxx` par le jeton) :

```sh
printf '//npm.pkg.github.com/:_authToken=%s\n' 'ghp_xxx' >> ~/.npmrc
```

Le fichier est créé s'il n'existe pas. **Ne me donne pas le jeton** : la commande ci-dessus suffit, et
je vérifierai seulement que `pnpm install` récupère le paquet.

**Vérifié le 2026-10-27, et c'est le piège de cette étape** : un jeton « fine-grained » — il commence
par `github_pat_` — est **refusé** par le registre npm de GitHub Packages, avec un message qui
n'explique rien : `403 permission_denied: The token provided does not match expected scopes`. La
documentation de GitHub est explicite : ce registre n'accepte qu'un **personal access token
(classic)**. C'est pour ça que l'étape 3 ci-dessus insiste.

Si `~/.npmrc` contient déjà une ligne refusée, **remplace-la** au lieu d'en ajouter une seconde — avec
deux lignes pour le même registre, plus personne ne sait laquelle sert :

```sh
sed -i '/npm\.pkg\.github\.com/d' ~/.npmrc
printf '//npm.pkg.github.com/:_authToken=%s\n' 'ghp_xxx' >> ~/.npmrc
```

Et **un jeton qui a transité par une conversation, un fichier ouvert dans l'éditeur ou un
copier-coller partagé est à considérer comme perdu** : supprime-le (Settings → Developer settings →
Tokens (classic) → l'icône de corbeille) et régénères-en un. Ça coûte deux minutes, et c'est la seule
réaction juste.

**A1b. Pour la CI, qui n'a besoin d'aucun jeton.** Les deux dépôts sont dans la même organisation,
donc le `GITHUB_TOKEN` d'Actions suffit — à condition d'autoriser le dépôt à lire le paquet :

1. va sur **github.com/orgs/MultiSearchAd/packages** ;
2. clique **`omnipass-client`** ;
3. colonne de droite → **Package settings** ;
4. section **Manage Actions access** → **Add repository** → choisis **`omnipotent`**, rôle **Read**.

C'est le point 9.2 de l'`A-FAIRE.md` d'omnipass, et il attendait que le paquet soit publié — c'est
fait depuis le 2026-10-26.

### A2. Monter le nouveau tenant — _30 minutes, dans cet ordre_

Un tenant neuf ne contient **rien** : pas d'Action post-login, pas d'application, pas d'API. L'ordre
ci-dessous n'est pas décoratif, chaque étape dépend de la précédente.

**Étape 0, et c'est celle d'omnipass : l'Action post-login.** Elle ajoute l'adresse e-mail de la
personne aux access tokens, sous l'espace de noms `https://omnilor/` que lit omnipass. Sans elle,
**aucune première connexion n'aboutit** — ni chez nous, ni chez multi-search. Elle appartient au
tenant, donc elle se fait une fois pour les trois produits, et c'est la session omnipass qui en a le
code (point 3 de son `A-FAIRE.md`). Elle est en tête de la liste A5.

**1. L'application navigateur (SPA).** C'est elle qui obtient les jetons des personnes, et c'est le
front de multi-search qui consommera Omnipotent après la bascule (`CADRAGE.md` § 18) : une seule
suffit pour les deux produits.

1. **manage.auth0.com**, vérifie en haut à gauche que tu es bien sur le **nouveau** tenant ;
2. **Applications** → **Applications** → **Create Application** ;
3. **Name** : `Omnilor Web` ; type **Single Page Web Applications** → **Create** ;
4. onglet **Settings** → **Allowed Callback URLs** :
   `http://localhost:3002/documentation/static/oauth2-redirect.html` (le Swagger UI d'Omnipotent en
   local), plus celles de multi-search ; **Allowed Web Origins** : `http://localhost:3002`, plus
   celles de multi-search. Les listes sont séparées par des virgules ;
5. **Save Changes**, en bas de la page, et **note le `Client ID`** : non secret, donne-le moi.

**2. Les API.** Le chemin est le même pour chacune : **Applications** → **APIs** → **Create API** →
**Name**, **Identifier**, **Signing Algorithm** `RS256` → **Create**.

| Name                     | Identifier                            | Réglages en plus                                  |
| ------------------------ | ------------------------------------- | ------------------------------------------------- |
| `Omnipotent REST`        | `https://api.omnipotent.app`          | aucun                                             |
| `Omnipotent MCP (local)` | `http://localhost:3002/mcp`           | _Allow Offline Access_ ; permission `mcp:use`     |
| `Omnipotent MCP`         | `https://omnipotent.omnilor.com/mcp`  | _Allow Offline Access_ ; permission `mcp:use`     |

Trois choses à savoir sur ce tableau, et chacune a coûté une erreur à quelqu'un :

- **l'identifiant REST n'a pas besoin de résoudre.** `https://api.omnipotent.app` est un nom, pas une
  adresse ; omnipass fait pareil avec `https://api.omnipass.app` tout en servant sur
  `omnipass.omnilor.com` ;
- **un identifiant MCP, si.** Il doit être **l'URL exacte** du `/mcp` servi, sans barre oblique
  finale, parce que le client l'envoie comme indicateur de ressource (RFC 8707). D'où une API **par
  environnement** : celle de l'environnement de test s'ajoutera avec son adresse CloudFront, le jour
  où il sera en ligne ;
- **les identifiants REST et MCP doivent différer.** L'application refuse de démarrer s'ils sont
  égaux : un jeton de client MCP ne doit jamais ouvrir toute l'API REST.

Les deux noms, `omnipotent.omnilor.com` et le port `3002`, sont tranchés (D52) et déjà posés dans le
code et l'infrastructure : tu n'as rien à en déduire.

**3. L'étape qu'on oublie, et qui fait échouer _avant_ la page de connexion.** Sur **chacune** des
trois API : section **`User-delegated access`** → ajoute l'application **`Omnilor Web`**. Sans ça,
Auth0 refuse la demande de jeton et son message ne dit pas pourquoi. C'est le point 8 de l'`A-FAIRE.md`
d'omnipass, constaté chez eux sur un vrai appel.

**4. Le compte machine vers omnipass.** Sur l'ancien tenant, le plan gratuit avait épuisé les
applications, donc omnipass en partageait une seule entre produits. Le budget est neuf, et ça rouvre
un choix que je ne tranche pas seul :

1. **un compte machine propre à Omnipotent** — c'est ce que je recommande. Son `client_id` nomme
   l'appelant dans les journaux d'omnipass, et une rotation de secret n'affecte qu'un produit. Coût :
   une place d'application sur dix.
2. **le compte machine partagé** qu'omnipass recréera de toute façon pour lui-même. Zéro place
   consommée, et ça marche : c'est l'audience signée du jeton relayé qui dit quel produit appelle.
   Mais les journaux d'omnipass ne distinguent plus qui l'appelle.

Dans les deux cas, la création est la même : **Applications** → **Create Application** → **Name**
`Omnipotent machine` → type **Machine to Machine Applications** → **Create**, puis choisis l'API
d'omnipass (`https://api.omnipass.app`) dans la liste d'autorisation. Le `Client ID` n'est pas secret
et peut m'être donné ; le **Client Secret** ne passe pas par le chat (A4).

**Ce que tu me rapportes dans le chat** : le **domaine du nouveau tenant**, le `Client ID` de
`Omnilor Web`, celui du compte machine, et « les trois API sont créées ». Rien de tout ça n'est un
secret.

### A3. Déclarer Omnipotent chez omnipass — _une demande_

omnipass doit **connaître nos audiences**, sans quoi il refuse le jeton que nous lui relayons — c'est
ce qui empêche une application de relayer le jeton d'une autre, et ça s'applique à nous.

Demande à la session omnipass d'ajouter Omnipotent à son registre (`backend/config/default.json`)
avec les deux audiences de production — `https://api.omnipotent.app` et
`https://omnipotent.omnilor.com/mcp` — et notre URL de front, qui est celle de multi-search
(`https://app.omnilor.com`) puisque c'est son front qui nous consommera. Son propre document le dit :
« trois lignes de configuration et un déploiement ». Sans cette déclaration : 403
`audience_not_allowed`.

Si un jour on veut exercer le MCP **local** contre un vrai omnipass, il faudra lui déclarer
`http://localhost:3002/mcp` aussi.

### A4. Le secret dans notre magasin — _2 minutes_

En local, le plus simple est `backend/.env`, qui est ignoré par git. Le `client_id` y va en clair, le
secret **jamais** :

```sh
cd ~/OmniAd/omnipotent/backend
printf 'AUTH0_DOMAIN=%s\n' '<le domaine du nouveau tenant>' >> .env
printf 'OMNIPASS_CLIENT_ID=%s\n' '<le client id du compte machine>' >> .env
```

Et le secret, **jamais dans le `.env` d'un environnement partagé ni dans le chat** : en production il
va dans le conteneur que Terraform a déjà créé, `omnipotent/prod/omnipass/client-secret`. La commande
viendra avec le premier `apply` ; en local, je te donnerai la forme exacte quand on branchera
`ACCESS_PROVIDER=omnipass`.

### A5. Ce qu'omnipass doit refaire, et que je ne peux pas faire d'ici

Le tenant est partagé, donc le déménagement est le sien autant que le nôtre. À transmettre à la
session omnipass — j'en ai fait un message prêt à copier,
[`message-a-omnipass-tenant.md`](message-a-omnipass-tenant.md) :

1. **l'Action post-login** sur le nouveau tenant (espace de noms `https://omnilor/`) — sans elle,
   **aucune première connexion n'aboutit**, pour personne ;
2. son **API REST** (`https://api.omnipass.app`) et son **API MCP par environnement** ;
3. son **compte machine**, et l'autorisation de celui d'Omnipotent sur son API ;
4. l'**application navigateur** listée dans le `User-delegated access` de chacune de ses API ;
5. sa configuration : `AUTH0_DOMAIN` dans son `.env`, son `.env.example` et son infrastructure ;
6. et le registre des consommateurs, où Omnipotent s'ajoute (A3).

Le même travail attend **multi-search** s'il doit continuer de tourner : son front et son back sont
gelés (D30), mais leur `AUTH0_DOMAIN` et leur `client_id` de SPA sont de la configuration, pas du
code.

---

## B. Google Ads — une seule démarche pour les deux produits

**Décision du 2026-10-27** : Omnipotent réutilise les accès de multi-search, qui n'existaient pas
encore. Ce qui suit est donc à faire **une fois**, et sert les deux produits.

**Depuis le 2026-11-14, le compte gestionnaire (MCC) de production existe.** Reste celui de test, et
tout ce qui touche au projet Cloud.

**Deux choses ont changé chez Google en septembre 2026, et elles changent le chemin** :

- **le developer token n'existe plus** comme unité de droits. L'en-tête est ignoré par les serveurs, et
  les releases attendues au premier semestre 2027 le **refuseront**. Nous ne l'envoyons pas ;
- **la demande d'accès a déménagé** : elle ne se fait plus dans le Centre d'API du MCC mais sur la page
  **Google Ads API** de la **console Google Cloud**. Le niveau d'accès appartient au **projet Cloud**
  qui possède le compte de service.

### B0. Ce que tu me donnes, et par quel chemin

Le détail de chaque étape est plus bas ; voici d'abord **la liste de ce qui doit me parvenir**, dans
l'ordre où les étapes la produisent.

**Dans le chat — rien de tout cela n'est un secret.** Un customer id est public sur n'importe quelle
facture Google, une adresse de compte de service ne permet rien sans sa clé, et un identifiant de
projet Cloud non plus.

| Ce que tu m'envoies                       | Produit par | Ce que j'en fais                                     |
| ----------------------------------------- | ----------- | ---------------------------------------------------- |
| L'**identifiant du projet** Cloud         | B1          | Le journal des appels, et le suivi du quota du projet |
| L'**adresse du compte de service**        | B3          | Vérifier qu'elle est bien invitée dans les MCC (B5)   |
| Le **customer id du MCC de production** _(créé)_ | B4   | `GOOGLE_ADS_MANAGER_ID`, l'en-tête `login-customer-id` |
| Le **customer id du MCC de test**         | B4          | Les huit preuves de la phase 10                       |
| Le **customer id du compte client de test** | B4        | Le compte sur lequel les preuves écrivent             |
| Le **customer id du compte Keyword Planner** | B7       | `GOOGLE_ADS_PLANNER_CUSTOMER_ID` (phase 17)           |
| Le **niveau d'accès atteint**, et la date de la demande Standard | B6 | Le plafond d'opérations que je prends pour vrai, et ce que j'écris dans `A-FAIRE.md` |
| Les **quatre limites de compte**          | B9          | Régler le plafond d'éclatement, aujourd'hui à 50      |

Écris-les en vrac, une ligne par valeur, en me disant laquelle est laquelle — je les enregistre dans
`A-FAIRE.md` et dans la configuration. Si tu n'en as qu'une partie, envoie cette partie : rien
n'attend le lot complet.

**Hors du chat, et c'est la seule chose qui en sort : la clé JSON du compte de service.** Elle ne me
parvient pas du tout, et c'est voulu — je n'en ai pas besoin pour écrire l'adapter, puisqu'aucun test
n'appelle une plateforme (`CADRAGE.md` § 14). Elle ne sert qu'aux huit preuves qui closent la phase.
Son chemin :

1. **laisse le fichier téléchargé où il est**, hors du dépôt. Ne le colle pas dans un fichier du
   projet, même ignoré par git — et ne me dis pas son contenu, même tronqué ;
2. le jour où l'adapter sait le lire, une seule commande le pose dans le magasin de secrets local, et
   je te la donnerai telle quelle :

   ```sh
   aws --endpoint-url http://localhost:9022 --region eu-north-1 secretsmanager create-secret \
     --name omnipotent/google-ads/service-account \
     --secret-string "file:///chemin/vers/la-cle.json"
   ```

3. en production, le même secret s'appelle `omnipotent/prod/google-ads/service-account`, son conteneur
   est déclaré par Terraform à la phase 10, et sa valeur se pose à la main, jamais par Terraform ;
4. une fois posée, **supprime le fichier téléchargé**. Une clé de compte de service ne s'expire pas
   toute seule : elle vaut jusqu'à ce qu'on la révoque.

**Et une chose que tu ne peux pas me donner, parce qu'elle n'est pas à donner** : le consentement de
l'humain administrateur du MCC (B8). Il passe par une commande que je dois d'abord transcrire, qui
ouvre une page Google dans ton navigateur et écrit elle-même le `refresh_token` dans le magasin. Tu ne
verras jamais ce jeton, et moi non plus.

### B1. Le projet Google Cloud — _15 minutes, et il doit être payant_

1. **console.cloud.google.com** ;
2. sélecteur de projet en haut → **Nouveau projet** ;
3. **Nom du projet** : `omnilor-ads` (il servira les deux produits) → **Créer** ;
4. menu ☰ → **Facturation** → **Associer un compte de facturation**, et associe un compte de
   facturation **payant**.

**Pourquoi payant** : un projet en essai gratuit est refusé à la demande d'accès production. C'est un
refus connu depuis la fin des developer tokens, et il se découvre tard.

### B2. Activer l'API — _2 minutes_

1. menu ☰ → **API et services** → **Bibliothèque** ;
2. cherche **Google Ads API** → **Activer**.

Le projet démarre au niveau **Test**, qui ne parle qu'à des comptes de test. C'est normal, et c'est
pour ça que l'étape B6 existe.

### B3. Le compte de service et sa clé — _10 minutes_

1. menu ☰ → **API et services** → **Identifiants** → **Créer des identifiants** → **Compte de
   service** ;
2. **Nom** : `omnilor-ads-api` → **Créer et continuer** → **Terminé** (aucun rôle IAM nécessaire : les
   droits viennent du MCC, pas d'IAM) ;
3. clique le compte de service créé → onglet **Clés** → **Ajouter une clé** → **Créer une clé** →
   **JSON** → **Créer**. Le fichier se télécharge ;
4. **note l'adresse e-mail du compte de service** (de la forme
   `omnilor-ads-api@omnilor-ads.iam.gserviceaccount.com`) : l'étape B5 en a besoin.

**Le fichier JSON est un secret** : il va dans Secrets Manager, jamais dans le chat ni dans le dépôt.
Je te donnerai la commande `aws secretsmanager` quand l'adapter saura le lire.

### B4. Les MCC — _le premier est fait, le second demande un autre compte Google_

**Le MCC de production : fait le 2026-11-14.** Il ne me manque que son **customer id**, les 10
chiffres affichés en haut de l'interface. Il n'est pas secret, donne-le moi dans le chat : il devient
`GOOGLE_ADS_MANAGER_ID`, et l'en-tête `login-customer-id` de chaque appel.

**Le MCC de test**, qui reste à créer, avec un **autre compte Google** — Google refuse qu'un même
compte soit administrateur des deux :

1. déconnecte-toi, ou ouvre une fenêtre de navigation privée, et connecte-toi avec le second compte ;
2. **ads.google.com/home/tools/manager-accounts** → **Créer un compte administrateur** ;
3. choisis **Gérer les comptes d'autres personnes**, renseigne pays, devise et fuseau ;
4. dans ce MCC de test → **Comptes** → **+** → **Créer un compte** : ce sera notre compte client de
   test. Les comptes de test **ne diffusent pas d'annonces** et ne dépensent rien, mais l'API s'y
   comporte comme en production — c'est là que passeront les huit preuves de la phase 10 ;
5. **note les deux customer id** : celui du MCC de test et celui du compte client de test.

**Pourquoi un compte de test alors qu'on a la production** : un adapter qui se trompe crée de vraies
campagnes sur un vrai compte, et le niveau d'accès `Test` du projet Cloud (B2) ne parle **qu'**à des
comptes de test. Les deux vont ensemble.

### B5. Donner au compte de service l'accès aux MCC — _5 minutes, et c'est l'étape qu'on oublie_

Le compte de service est un utilisateur comme un autre : sans invitation, il ne voit rien.

Dans **chaque** MCC (production et test) :

1. **Administration** → **Accès et sécurité** → onglet **Utilisateurs** → **+** ;
2. colle l'adresse e-mail du compte de service notée en B3 ;
3. niveau d'accès : **Administrateur** → **Envoyer l'invitation**.

Un compte de service **n'a pas de boîte mail** : selon les cas l'invitation est acceptée
automatiquement, ou il faut l'accepter depuis la page **Invitations en attente** du même écran. Si
l'accès ne fonctionne pas, c'est presque toujours ici.

### B6. Demander l'accès, dans le bon ordre — _minutes, puis ~10 jours ouvrés_

Sur la **console Google Cloud**, pas dans le MCC :

1. menu ☰ → **API et services** → **API et services activés** → **Google Ads API** ;
2. la page d'**aperçu** (« Overview ») porte l'état d'accès du projet et le formulaire de demande ;
3. demande **Basic** d'abord. La revue est **automatisée** et prend quelques minutes, mais elle
   dépend d'une **vérification de marque** : si Google te la demande, c'est un formulaire sur le
   domaine et l'identité de l'entreprise ;
4. **puis** demande **Standard**. Revue humaine, environ **dix jours ouvrés**.

**Ne saute pas Basic, et ne t'arrête pas à Explorer** : `Explorer` plafonne à **2 880 opérations par
jour en production**, ce qui est en dessous de ce que coûte le seul suivi de nos campagnes.

**Pourquoi Standard est une condition et pas un confort** : le plafond est celui du **projet**, tous
clients confondus, et les deux produits se le partagent maintenant. L'étude de multi-search chiffre
cinquante AdGroups à environ **8 400 opérations par jour avant la moindre écriture**, sur 15 000 en
Basic.

### B7. Le compte du Keyword Planner — _5 minutes_

Sous le MCC de production, crée un compte **non administrateur** dédié : c'est lui qui portera les
appels du Keyword Planner, qui a sa propre limite d'une requête par seconde et par compte.

1. dans le MCC de production → **Comptes** → **+** → **Créer un compte** ;
2. **note son customer id**, non secret.

### B8. Le consentement de l'humain inviteur — _5 minutes, mais après le code_

Google **refuse les invitations de lien manager venant d'un compte de service**. Il faut donc qu'un
humain administrateur du MCC consente une fois, et nous gardons son `refresh_token`.

Cette étape passe par une commande que je dois d'abord transcrire depuis multi-search
(`pnpm google:connect`) : elle ouvre une page de consentement Google, tu te connectes **avec le compte
admin du MCC**, et elle écrit le secret dans Secrets Manager sans qu'il passe par le chat. **Rien à
faire maintenant** : je te préviendrai quand la commande existera.

### B9. Relever les limites du compte — _10 minutes, après B4_

Dans le MCC de production → **Administration** → **Limites du compte**. Relève : campagnes par compte,
ad groups par campagne, mots-clés par compte, annonces actives par ad group.

**Ce que j'en fais** : régler le plafond d'éclatement de la phase 8, aujourd'hui à 50 — une valeur que
j'ai choisie basse exprès et sans fondement.

---

## C. Microsoft Advertising — le compte gestionnaire est créé

Tu as créé un **compte gestionnaire Microsoft** le 2026-11-14. C'est la phase 11, et elle vient après
Google : rien ici n'est urgent, mais le **developer token** demande une validation qui peut traîner,
donc autant le lancer tôt.

**Ne transpose pas Google ici.** Chez Microsoft le **developer token existe toujours** et il est
**obligatoire** dans chaque appel (en-tête `DeveloperToken`) ; c'est chez Google qu'il a disparu en
septembre 2026. Et l'authentification est celle d'un **utilisateur**, pas d'un compte de service :
jeton OAuth Entra ID avec la portée `https://ads.microsoft.com/msads.manage` et `offline_access`.

Tout ce qui suit est tiré de l'étude sourcée de multi-search
(`~/OmniAd/multi-search/backend/docs/platforms/microsoft-ads.md`), où chaque affirmation porte sa
référence.

### C0. Ce que tu me donnes, et par quel chemin

**Dans le chat, non secret** : le **customer id** du compte gestionnaire (le `cid=` de l'URL de
l'interface), son **numéro de compte gestionnaire** (10 caractères), le **numéro** (8 caractères) et
l'**id** (le `aid=` de l'URL) du compte annonceur de test, et le **client id** de l'application Entra.

**Hors du chat** : le **developer token** et le **client secret** de l'application. Les deux sont des
credentials : ils iront dans le magasin de secrets avec une commande que je te donnerai à la phase 11,
comme la clé JSON de Google.

### C1. Le developer token — _5 minutes, puis une validation_

À demander par un **Super Admin** du compte gestionnaire :

1. **ads.microsoft.com** → **Settings** → **Developer settings**
   (`https://ads.microsoft.com/cc/Settings/DevSettings`) ;
2. **Request Token**.

Le jeton est **universel** depuis juillet 2019 : un seul suffit pour l'application entière, quel que
soit l'utilisateur dont on porte le jeton OAuth. Il **ne donne aucun droit** par lui-même — l'accès
est celui de l'utilisateur authentifié, avec ses comptes et son rôle.

Pour le **bac à sable**, il n'y a rien à demander : le jeton universel public est **`BBD37VB98`**, et
le bac à sable a ses propres identifiants, séparés de la production.

### C2. L'application Entra ID — _15 minutes_

C'est elle qui porte le flux OAuth. Deux pièges dès l'inscription :

1. **portal.azure.com** → **App registrations** → **New registration**. Connecte-toi avec un compte
   **professionnel** : Microsoft n'accepte plus l'inscription depuis un compte personnel ;
2. **Supported account types** : **Accounts in any organizational directory and personal Microsoft
   accounts** ;
3. **Redirect URI** : plateforme **Web**, et une URL que nous contrôlons. Pas une URI
   `…/nativeclient` : celle-là est réservée aux applications publiques ;
4. **Register**, puis **note le `Application (client) ID`** — non secret, donne-le moi ;
5. **Certificates & secrets** → **New client secret** → durée **12 mois** → **Add**. La valeur n'est
   **affichée qu'une fois** : copie-la tout de suite, et ne me la donne pas.

**Pourquoi une application web avec secret, et pas publique** : notre service tourne sur plusieurs
conteneurs. Microsoft est explicite — avec le même `client_id` et le même `client_secret`, un refresh
token obtenu sur une machine se rafraîchit depuis une autre. Un refresh token obtenu **sans** secret
ne peut plus être rafraîchi avec un secret (`Public clients can't send a client secret`), donc le
choix se fait maintenant, pas après.

### C3. L'utilisateur de service, et son consentement — _10 minutes, le consentement après le code_

Le jeton OAuth représente une **personne**. Il faut donc un utilisateur dédié :

1. dans **ads.microsoft.com** → **Accounts** → **Users** → invite une adresse **dédiée**, par exemple
   `ads-api@…`, et non le compte d'une personne : un départ casserait l'accès ;
2. donne-lui le rôle **Super Admin** sur le compte gestionnaire. C'est le rôle exigé pour créer et
   suivre les liens de comptes clients (phase 19) ;
3. active l'**authentification multifacteur** sur cette adresse : le consentement l'exige.

Le consentement lui-même passera par une commande que je dois écrire — elle ouvre la page Microsoft,
tu te connectes **avec cette adresse**, et elle écrit le refresh token dans le magasin sans qu'il
passe par le chat. **Rien à faire maintenant** de ce côté : je te préviendrai.

À savoir pour plus tard : chaque rafraîchissement renvoie un **nouveau** refresh token, qu'il faut
garder ; la durée de vie par défaut est de **90 jours** ; et un changement de mot de passe, un retrait
de droits ou une décision de Microsoft le révoquent — le point de jeton répond alors `invalid_grant`,
et il faut re-consentir.

### C4. Le bac à sable — _ce qu'il faut savoir avant d'y aller_

Les huit preuves de la phase 11 passent dans le **bac à sable** : comptes, identifiants et jeton y
sont séparés de la production. Une inconnue y reste, et je préfère l'écrire que la découvrir : la
**portée** du consentement. La documentation indique le même point OAuth qu'en production, mais le SDK
Python demande `https://si.ads.microsoft.com/msads.manage` au lieu de `https://ads.microsoft.com/…`.
On tranchera au premier appel réel — c'est de toute façon à la phase 11.

---

## Ce que tu me donnes dans le chat, en une fois

Rien de secret là-dedans, et chaque ligne peut arriver seule : rien n'attend le lot complet.

**Auth0, le nouveau tenant** (A2) :

- le **domaine du tenant** ;
- le `Client ID` de l'application navigateur `Omnilor Web` ;
- le `Client ID` du **compte machine** vers omnipass ;
- « les trois API sont créées ».

**Google** (B) :

- le customer id du **MCC de production** — il existe depuis le 2026-11-14 ;
- ceux du **MCC de test** et du **compte client de test** ;
- l'**identifiant du projet** Cloud et l'**adresse du compte de service** ;
- le customer id du compte **Keyword Planner**, le **niveau d'accès atteint**, les quatre **limites du
  compte**.

**Microsoft** (C) :

- le **customer id** du compte gestionnaire et son **numéro** (10 caractères) ;
- le **numéro** et l'**id** du compte annonceur de test ;
- le `Application (client) ID` de l'application Entra.

Et il reste **un clic** : autoriser le dépôt `omnipotent` à lire le paquet (A1b), sans quoi la CI
échoue à l'installation.

**Ce qui ne passe jamais par ici** : la clé JSON du compte de service Google, le developer token et le
client secret Microsoft, le Client Secret du compte machine Auth0. Chacun a son chemin vers le magasin
de secrets, décrit à son étape.
