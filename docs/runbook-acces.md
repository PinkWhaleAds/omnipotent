# Runbook des accès — clic par clic

Écrit le 2026-10-27 pour Lorin. Chaque section est une suite d'écrans, dans l'ordre, avec ce qu'il
faut en rapporter et où le mettre. `A-FAIRE.md` dit **quoi** ; ce document dit **comment**.

**La règle des secrets, qui ne bouge jamais** : une clé, un mot de passe, un jeton ou un fichier de
clé ne passe **jamais** par le chat. Il va dans `backend/.env` (ignoré par git) ou dans Secrets
Manager. Les identifiants non secrets — un `client_id`, un customer id, un numéro de compte — peuvent
m'être donnés dans le chat.

Les libellés d'interface sont ceux de la fin octobre 2026. Quand un écran ne ressemble pas à ce qui
est écrit ici, dis-le moi plutôt que de chercher : c'est le document qui a vieilli.

---

## A. omnipass — ce qui débloque la mise en production

### A0. Ce qui est déjà fait, et qu'il ne faut pas refaire

En lisant `~/OmniAd/omnipass/A-FAIRE.md` j'ai trouvé que **le compte machine existe déjà**, et qu'il
est **partagé**. Le plan gratuit d'Auth0 ne te laisse pas créer une application de plus, donc omnipass
a changé sa conception : un seul compte machine sert plusieurs applications, et c'est **l'audience du
jeton relayé** — qui est signée — qui dit laquelle appelle.

Son `Client ID` est `tkSxRukHoCBTTNd616lsiF8Fqb7RpQbv`, il est déjà autorisé sur
`https://api.omnipass.app`, et il n'est pas secret. **Tu n'as donc aucune application à créer.** Il
reste trois choses, dont deux qui tiennent en un copier-coller.

### A1. Le jeton GitHub pour installer le paquet — _5 minutes_

Deux besoins différents, et il ne faut pas les confondre.

**A1a. Pour ma machine (c'est ce qui me bloque aujourd'hui).**

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

**A1b. Pour la CI, qui n'a besoin d'aucun jeton.** Les deux dépôts sont dans la même organisation,
donc le `GITHUB_TOKEN` d'Actions suffit — à condition d'autoriser le dépôt à lire le paquet :

1. va sur **github.com/orgs/MultiSearchAd/packages** ;
2. clique **`omnipass-client`** ;
3. colonne de droite → **Package settings** ;
4. section **Manage Actions access** → **Add repository** → choisis **`omnipotent`**, rôle **Read**.

C'est le point 9.2 de l'`A-FAIRE.md` d'omnipass, et il attendait que le paquet soit publié — c'est
fait depuis le 2026-10-26.

### A2. Les deux API Auth0 d'Omnipotent — _10 minutes_

Celles-là n'existent pas encore, et il en faut deux : une pour l'API REST, une pour le serveur MCP
(D42). Une **API** n'est pas une **application** : le plan gratuit ne les limite pas comme les
applications, donc ça devrait passer.

1. **manage.auth0.com**, choisis le tenant partagé avec multi-search ;
2. menu de gauche → **Applications** → **APIs** → **Create API** ;
3. l'API REST : **Name** `Omnipotent REST`, **Identifier** `https://api.omnipotent.app`,
   **Signing Algorithm** `RS256` → **Create** ;
4. recommence pour le MCP : **Name** `Omnipotent MCP`, **Identifier** = **exactement l'URL `/mcp` de
   l'API**, par exemple `https://api.omnipotent.app/mcp`, **RS256** → **Create** ;
5. sur l'API MCP : onglet **Settings** → active **Allow Offline Access** ; onglet **Permissions** →
   ajoute la permission `mcp:use` avec pour description `Use the MCP server`.

**Les deux identifiants doivent différer** : l'application refuse de démarrer s'ils sont égaux, et ce
garde-fou existe parce qu'un jeton MCP ne doit jamais ouvrir l'API REST.

**Ce que tu me donnes dans le chat** : les deux `Identifier`. Ils ne sont pas secrets.

### A3. Autoriser le compte machine, et déclarer Omnipotent chez omnipass — _5 minutes + une demande_

Le compte machine est déjà autorisé sur l'API d'omnipass (A0). Il reste le chemin inverse : omnipass
doit **connaître nos audiences**, sans quoi il refuse le jeton que nous lui relayons — c'est ce qui
empêche une application de relayer le jeton d'une autre, et ça s'applique à nous.

1. **manage.auth0.com** → **Applications** → **Applications** → l'application machine partagée
   (`tkSxRukHoCBTTNd616lsiF8Fqb7RpQbv`) → onglet **Settings** ;
2. copie le **Client Secret** (l'œil ou le bouton de copie). **Ne me le donne pas** : il va dans notre
   Secrets Manager, à l'étape A4 ;
3. puis **demande à la session omnipass** d'ajouter Omnipotent à son registre
   (`backend/config/default.json`) avec les deux audiences de l'étape A2 et notre URL de front. Son
   propre document le dit : « Omnipotent s'y ajoutera quand il sera en ligne : trois lignes de
   configuration et un déploiement. »

### A4. Le secret dans notre Secrets Manager — _2 minutes_

En local, le plus simple est `backend/.env`, qui est ignoré par git :

```sh
cd ~/OmniAd/omnipotent/backend
printf 'OMNIPASS_CLIENT_ID=tkSxRukHoCBTTNd616lsiF8Fqb7RpQbv\n' >> .env
```

Et le secret, **jamais dans `.env` d'un environnement partagé ni dans le chat** : en production il va
dans le conteneur que Terraform a déjà créé, `omnipotent/prod/omnipass/client-secret`. La commande
viendra avec le premier `apply` ; en local, je te donnerai la forme exacte quand le client sera
installé.

---

## B. Google Ads — une seule démarche pour les deux produits

**Décision du 2026-10-27** : Omnipotent réutilise les accès de multi-search. Mais ils n'existent pas
encore : la section 7 de `~/OmniAd/multi-search/A-FAIRE.md` est entièrement à cocher. Ce qui suit est
donc à faire **une fois**, et sert les deux.

**Deux choses ont changé chez Google en septembre 2026, et elles changent le chemin** :

- **le developer token n'existe plus** comme unité de droits. L'en-tête est ignoré par les serveurs, et
  les releases attendues au premier semestre 2027 le **refuseront**. Nous ne l'envoyons pas ;
- **la demande d'accès a déménagé** : elle ne se fait plus dans le Centre d'API du MCC mais sur la page
  **Google Ads API** de la **console Google Cloud**. Le niveau d'accès appartient au **projet Cloud**
  qui possède le compte de service.

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

### B4. Les deux MCC — _30 minutes, et il faut deux comptes Google différents_

**Le MCC de production** :

1. **ads.google.com/home/tools/manager-accounts** → **Créer un compte administrateur** ;
2. choisis **Gérer les comptes d'autres personnes**, renseigne pays, devise et fuseau ;
3. **note le customer id** affiché en haut (10 chiffres). Il **n'est pas secret** — donne-le moi.

**Le MCC de test**, avec un **autre compte Google** (Google refuse qu'un même compte ait les deux) :

4. déconnecte-toi, ou ouvre une fenêtre privée, et refais 1 à 3 avec le second compte ;
5. dans ce MCC de test → **Comptes** → **+** → **Créer un compte** : ce sera notre compte client de
   test. Les comptes de test **ne diffusent pas d'annonces** et ne dépensent rien, mais l'API s'y
   comporte comme en vrai ;
6. **note les deux customer id** (le MCC de test et le compte client de test).

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

## Ce que tu me donnes dans le chat, en une fois

Rien de secret là-dedans :

- les deux `Identifier` des API Auth0 d'Omnipotent (A2) ;
- le customer id du **MCC de production** (B4) ;
- le customer id du **MCC de test** et celui du **compte client de test** (B4) ;
- le customer id du compte **Keyword Planner** (B7) ;
- les quatre **limites du compte** (B9).

Et tu me dis quand A1a est fait, sans me donner le jeton.
