# Runbook des accès — clic par clic

Écrit le 2026-10-27 pour Lorin. Chaque section est une suite d'écrans, dans l'ordre, avec ce qu'il
faut en rapporter et où le mettre. `A-FAIRE.md` dit **quoi** ; ce document dit **comment**.

**La règle des secrets, qui ne bouge jamais** : une clé, un mot de passe, un jeton ou un fichier de
clé ne passe **jamais** par le chat. Il va dans `backend/.env` (ignoré par git) ou dans Secrets
Manager. Les identifiants non secrets — un `client_id`, un customer id, un numéro de compte — peuvent
m'être donnés dans le chat.

**Et une précision que le 2026-11-17 a rendue nécessaire, deux fois** : « par le chat » inclut **un
fichier ouvert dans l'éditeur**. L'extension VS Code m'envoie automatiquement ta sélection, donc un
secret collé dans un fichier puis sélectionné m'arrive exactement comme si tu me l'avais écrit — même
si le fichier est ignoré par git, même si tu le supprimes ensuite. Un secret se tape **directement
dans le terminal** :

```sh
read -rs SECRET && printf 'NOM_DE_LA_VARIABLE=%s\n' "$SECRET" >> .env && unset SECRET
```

`read -rs` n'affiche rien, ne laisse rien dans l'historique du shell, et ne passe pas par un fichier
que je puisse lire. Un secret qui est quand même passé par là est **à considérer comme perdu** : on le
fait tourner, et on ne discute pas. C'est ce qu'on a fait pour le Client Secret du compte machine
Auth0, le 2026-11-17.

Les libellés d'interface sont ceux de la fin octobre 2026. Quand un écran ne ressemble pas à ce qui
est écrit ici, dis-le moi plutôt que de chercher : c'est le document qui a vieilli.

**Repris le 2026-11-14**, après trois changements de ton côté : un **nouveau tenant Auth0**, un
**compte gestionnaire Google** et un **compte gestionnaire Microsoft**. Le premier rend caduque une
partie de ce qui était fait — A0 dit quoi exactement —, le deuxième raccourcit la partie B, et le
troisième ouvre une partie C qui n'existait pas.

**Repris le 2026-11-17, et c'est la partie A qui se referme.** Toute la section A était en attente de
toi ; elle ne l'est plus, sauf une étape qui attend du code. Ce qui a bougé ce jour-là, dans l'ordre
où ça s'est produit :

| Ce qui a changé                                        | Où c'est écrit |
| ------------------------------------------------------ | -------------- |
| L'audience REST devient **commune aux trois produits** | A0             |
| Le paquet devient `@pinkwhaleads/omnipass-client`      | A1a            |
| Le dépôt déménage chez `PinkWhaleAds`                  | A1b, A6        |
| Les adresses de retour de la SPA sont posées           | A2             |
| Notre entrée de registre est complète                  | A3             |
| Le secret est dans le magasin, en local                | A4             |
| **Le chemin relayé a tourné pour de vrai**             | A5             |
| Le bouchon de tenancy est supprimé                     | A4, A6         |

**Ce qui reste de la partie A, et rien d'autre** : l'API MCP d'Auth0 (A2, point 2), qui attend qu'on
serve vraiment un `/mcp` ; et le secret dans le Secrets Manager de l'environnement de test (A4), le
jour où cet environnement monte. Les parties B et C, elles, sont intactes : c'est là qu'est tout ce
qui bloque encore le développement.

**Repris le 2026-11-18, et ce sont les parties B et C qui se montent.** Tu as fait Google et
Microsoft en une matinée ; plus rien ne bloque l'écriture du code. Ce qui a bougé ce jour-là :

| Ce qui a changé                                                                 | Où c'est écrit |
| ------------------------------------------------------------------------------- | -------------- |
| Le projet Cloud, le compte de service et son accès au MCC                       | B1 → B5        |
| **Une étape manquait** : le client OAuth de l'inviteur                          | B5b, nouvelle  |
| Basic obtenu, **Standard demandé**                                              | B6             |
| Le developer token, l'application Entra, l'utilisateur de service               | C1 → C3        |
| Les secrets **vivent sur AWS** (`omnipotent/dev/`), une commande les rapatrie   | A4, B0         |
| **Deux corrections** : ne pas supprimer la clé téléchargée, et la commande d'A4 | A4, B0         |

Les identifiants reçus sont dans `A-FAIRE.md` § 2. Ce qui reste : les deux **consentements** (B8 et
C3), qui attendent leurs commandes, puis B7 et B9, qui ne sont pas urgents. Et pour une machine
neuve, `docs/nouveau-poste.md` dit tout ce qui ne voyage pas avec le dépôt.

---

## A. omnipass — ce qui débloque la mise en production

### A0. Ce que le nouveau tenant rend caduc

Tu as créé un **nouveau tenant Auth0**, et tout le monde y déménage — omnipass, multi-search,
Omnipotent. C'est la seule façon que ça marche, et ce n'est pas un choix de confort : omnipass
vérifie la **signature** du jeton que nous lui relayons avec le JWKS du **tenant partagé** (son
`backend/docs/plan.md` § 14). Deux tenants, et chaque jeton relayé est refusé — Omnipotent ne pourrait
résoudre aucun appelant.

**omnipass a déménagé le premier, le 2026-11-14**, et c'est donc chez lui que tout se crée :

| Ce qui est désormais vrai                  | Valeur                              |
| ------------------------------------------ | ----------------------------------- |
| Le tenant                                  | `dev-u4wj2een0nvlqbga.eu.auth0.com` |
| L'URL d'omnipass                           | `https://omnipass.pinkwhale.co`     |
| Son audience REST (inchangée)              | `https://api.omnipass.app`          |
| **Notre audience REST, commune aux trois** | `https://api.pinkwhale.app`         |
| L'application navigateur (SPA) partagée    | `7E8vA7Svbz317jd5zDrOw8zrmiCLPuRn`  |
| Le compte machine partagé                  | `wyPvM8SDC6ZSYwzOUJSHDIGhYn4YQ1kY`  |
| Le domaine du groupe                       | `pinkwhale.co`                      |

Le groupe ayant changé de domaine, **D52 est amendée** : notre nom d'hôte de production est
`omnipotent.pinkwhale.co`, et l'identifiant de l'API MCP de production suit. L'audience REST, elle, ne
bouge pas — une audience est un nom, pas une adresse, exactement comme omnipass garde
`https://api.omnipass.app` en servant sur `omnipass.pinkwhale.co`.

**Les valeurs d'avant ne valent plus rien. Ne les recolle nulle part :**

| Valeur morte                        | Ce qu'elle était                               | Morte depuis |
| ----------------------------------- | ---------------------------------------------- | ------------ |
| `dev-3rwjfrn4yf3tar80.eu.auth0.com` | le domaine du tenant                           | 2026-11-14   |
| `tkSxRukHoCBTTNd616lsiF8Fqb7RpQbv`  | le compte machine partagé vers omnipass        | 2026-11-14   |
| `qUq67lX2piWp4RJSNlSMqOtW51Y2VHBy`  | l'application navigateur (SPA) de multi-search | 2026-11-14   |
| L'API `Omnipotent REST`             | créée et vérifiée le 2026-10-27, sur l'ancien  | 2026-11-14   |
| `https://api.omnipotent.app`        | notre audience REST **propre**                 | 2026-11-17   |
| `@omnilor/omnipass-client`          | le nom du paquet avant le déménagement         | 2026-11-17   |

Je les ai retirées d'`A-FAIRE.md` : une valeur morte qui traîne dans un document est pire qu'une
valeur absente, parce qu'elle se recopie sans qu'on se demande d'où elle vient.

**Ce qui n'est pas perdu** : le travail de compréhension. Les pièges restent les mêmes — la section
`User-delegated access` qu'on oublie, l'identifiant d'API MCP qui doit être l'URL exacte du `/mcp`
servi, l'Action post-login sans laquelle aucune première connexion n'aboutit. Le pas à pas ci-dessous
les intègre, dans l'ordre.

**Et une bonne nouvelle** : un tenant neuf repart avec son budget d'entités intact — **10
applications _et_ 10 API**, plafonds distincts (omnipass a corrigé notre lecture commune le
2026-11-17 : les API comptent aussi). Le compte tient largement à trois produits, puisque le compte
machine est partagé et que chaque produit n'apporte que son front et ses API. Ce qui fera déborder un
jour n'est pas l'audience par produit : c'est une API MCP **par produit et par environnement**, API
locales comprises. Ce jour-là, la réponse est le plan payant — pas le sacrifice de la provenance
signée.

### A1. Le jeton GitHub pour installer le paquet — _fait, et vérifié par la CI_

Deux besoins différents, et il ne faut pas les confondre. **Les deux sont réglés** — A1a le
2026-11-17, A1b le même jour. Je garde le pas à pas quand même : ce jeton est à 90 jours, donc il
mourra vers le **2027-02-15**, et le jour où la CI ou `pnpm install` échouera sur le paquet, c'est ici
qu'il faudra revenir.

**A1a. Pour ma machine — fait, et la première tentative a échoué.**

Tu ne trouves pas `~/.npmrc` parce qu'**il n'existe pas par défaut** : npm le crée à la demande, et
c'est à nous de l'écrire. Ce n'est pas un fichier du projet, c'est un fichier de ton compte
utilisateur.

1. va sur **github.com**, clique ta photo en haut à droite → **Settings** ;
2. tout en bas du menu de gauche → **Developer settings** ;
3. **Personal access tokens** → **Tokens (classic)**. **Il faut un jeton « classic »** : GitHub
   Packages ne prend pas encore les jetons « fine-grained » pour npm ;
4. **Generate new token** → **Generate new token (classic)** ;
5. **Note** : `omnipotent-packages` ; **Expiration** : 90 jours ;
6. **et c'est le piège : connecte-toi avec le compte `PinkWhaleAds`**, pas avec `LorinProjects`. Le
   jeton porte les droits de **son compte**, et le paquet appartient à `PinkWhaleAds` ;
7. dans la liste des scopes, coche **`read:packages`** seulement. Rien d'autre — pas besoin de
   `repo` pour lire un paquet ;
8. **Generate token**, et **copie le jeton** : GitHub ne te le remontrera plus.

Puis, dans un terminal, **une seule commande** (remplace `ghp_xxx` par le jeton) :

```sh
printf '//npm.pkg.github.com/:_authToken=%s\n' 'ghp_xxx' >> ~/.npmrc
```

Le fichier est créé s'il n'existe pas. **Ne me donne pas le jeton** : la commande ci-dessus suffit, et
je vérifierai seulement que `pnpm install` récupère le paquet.

**Comment savoir en une commande si le jeton est le bon** — c'est le contrôle qui a manqué le
2026-11-17 et qui aurait économisé une demi-heure :

```sh
npm whoami --registry=https://npm.pkg.github.com
```

Il doit répondre **`PinkWhaleAds`**. S'il répond autre chose, le jeton appartient au mauvais compte et
le paquet restera illisible, quelle que soit sa portée.

**Deux refus différents, et ils se ressemblent assez pour coûter du temps chacun.** Les deux sont des
`403 permission_denied`, et la différence est dans la fin du message :

| Message                           | Ce qui cloche                               | La réparation                |
| --------------------------------- | ------------------------------------------- | ---------------------------- |
| `…does not match expected scopes` | jeton « fine-grained » (`github_pat_…`)     | un jeton **classic**         |
| `…read_package`                   | jeton d'un compte qui ne voit pas le paquet | le compte **`PinkWhaleAds`** |

Le premier a été vérifié le 2026-10-27 : la documentation de GitHub est explicite, ce registre
n'accepte qu'un **personal access token (classic)** pour npm. Le second a été vérifié le 2026-11-17,
et c'est lui qui m'a trompé : le jeton était bien « classic » et portait bien `read:packages`, mais
`npm whoami` répondait `LorinProjects` alors que le paquet est publié par `PinkWhaleAds`. **Une portée
ne crée pas un droit** — elle autorise un jeton à exercer un droit que son compte possède déjà. C'est
pour ça que les étapes 6 et 7 ci-dessus sont dans cet ordre.

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

**A1b. Pour la CI, qui n'a besoin d'aucun jeton — réglé, et c'est la CI qui le dit.** Depuis le
déménagement du 2026-11-17, le paquet et notre dépôt appartiennent au **même compte**,
`PinkWhaleAds` : le `GITHUB_TOKEN` d'Actions suffit, et les trois jobs du workflow `backend` ne font
rien d'autre que l'écrire dans le `.npmrc` du runner.

**Mesuré sur les vraies exécutions**, et c'est la preuve qui compte :

| Exécution du workflow `backend` | Commit    | Résultat  | Ce qu'elle installait            |
| ------------------------------- | --------- | --------- | -------------------------------- |
| avant 18:19 UTC                 | `7bddc93` | ❌ échec  | `@omnilor/omnipass-client`, mort |
| 18:19 UTC                       | `79ff615` | ✅ succès | `@pinkwhaleads/omnipass-client`  |
| 19:00 UTC                       | `7ecbeff` | ✅ succès | idem, bouchon supprimé           |

Il n'y a donc **rien à cliquer** : le jeton d'Actions lit le paquet. Si un jour une exécution échoue à
l'installation, l'écran à vérifier est celui-ci — connecté comme `PinkWhaleAds`,
**github.com/PinkWhaleAds?tab=packages** → **`omnipass-client`** → **Package settings** → **Manage
Actions access**, où le dépôt `omnipotent` doit figurer en **Read**.

### A2. Monter le nouveau tenant — _fait, sauf l'API MCP qui attend du code_

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

1. **manage.auth0.com**, vérifie en haut à gauche que tu es bien sur le nouveau tenant,
   `dev-u4wj2een0nvlqbga.eu.auth0.com` ;
2. **Applications** → **Applications** → **Create Application** ;
3. **Name** : `PinkWhale` — c'est le nom qu'omnipass lui a donné le 2026-11-17, et le reste de ce
   document l'appelle comme ça ; type **Single Page Web Applications** → **Create** ;
4. onglet **Settings** → **Allowed Callback URLs** :
   `http://localhost:3002/documentation/static/oauth2-redirect.html` (le Swagger UI d'Omnipotent en
   local), plus celles de multi-search ; **Allowed Web Origins** : `http://localhost:3002`, plus
   celles de multi-search. Les listes sont séparées par des virgules ;
5. **Save Changes**, en bas de la page, et **note le `Client ID`** : non secret, donne-le moi.

> **✅ Fait le 2026-11-17.** omnipass a abandonné « une audience par produit » : les produits partagent
> **une seule** audience REST, `https://api.pinkwhale.app`, qu'omnipass a créée en y autorisant la SPA
> `PinkWhale` — `https://api.omnipotent.app` est abandonnée. **Tu n'as donc aucune API REST à créer.**
> Les deux `client_id` publics sont posés dans le dépôt : la SPA `7E8vA7Svbz317jd5zDrOw8zrmiCLPuRn` et
> le compte machine partagé `wyPvM8SDC6ZSYwzOUJSHDIGhYn4YQ1kY`.
>
> **Les adresses de retour du point 1 ci-dessus sont posées aussi** — pas parce que je les ai vues,
> mais parce que tu as obtenu un vrai jeton par le bouton _Authorize_ du Swagger local, le soir du
> 2026-11-17, et que c'est la seule chose dont elles commandent le fonctionnement. Si ce bouton
> retombe en panne un jour avec une erreur `Callback URL mismatch`, c'est le point 1 qu'il faut
> relire.
>
> **Ce qui reste, et une seule chose** : **notre API MCP**. Elle reste à nous, le protocole l'impose,
> mais elle se crée le jour où on sert vraiment un `/mcp`, avec l'URL exacte servie. Le tableau du
> point 2 est **en attente, pas à exécuter**.

**2. Les API.** Le chemin est le même pour chacune : **Applications** → **APIs** → **Create API** →
**Name**, **Identifier**, **Signing Algorithm** `RS256` → **Create**.

| Name              | Identifier                            | Réglages en plus                              |
| ----------------- | ------------------------------------- | --------------------------------------------- |
| `Omnipotent MCP`  | `https://omnipotent.pinkwhale.co/mcp` | _Allow Offline Access_ ; permission `mcp:use` |

**Une seule ligne dans ce tableau, et il en portait deux avant le 2026-11-17** : l'audience REST étant
devenue celle d'omnipass, il ne nous reste que le MCP à déclarer. J'avais aussi prévu une API MCP
**locale** (`http://localhost:3002/mcp`) pour exercer le MCP avec de vrais jetons sur ta machine. Elle
n'est pas nécessaire aujourd'hui, et c'est précisément ce genre d'API qui fera déborder le plafond :
on la créera le jour où on en aura besoin.

Trois choses à savoir sur ce tableau, et chacune a coûté une erreur à quelqu'un :

- **l'identifiant REST n'a pas besoin de résoudre.** `https://api.pinkwhale.app` est un nom, pas une
  adresse ; omnipass fait pareil avec `https://api.omnipass.app` tout en servant sur
  `omnipass.pinkwhale.co` ;
- **un identifiant MCP, si.** Il doit être **l'URL exacte** du `/mcp` servi, sans barre oblique
  finale, parce que le client l'envoie comme indicateur de ressource (RFC 8707). D'où une API **par
  environnement** : celle de l'environnement de test s'ajoutera avec son adresse CloudFront, le jour
  où il sera en ligne ;
- **les identifiants REST et MCP doivent différer.** L'application refuse de démarrer s'ils sont
  égaux : un jeton de client MCP ne doit jamais ouvrir toute l'API REST.

Les deux noms, `omnipotent.pinkwhale.co` et le port `3002`, sont tranchés (D52) et déjà posés dans le
code et l'infrastructure : tu n'as rien à en déduire.

**3. L'étape qu'on oublie, et qui fait échouer _avant_ la page de connexion.** Sur **chaque** API que
tu crées — donc, aujourd'hui, sur la seule qui reste à créer : section **`User-delegated access`** →
ajoute l'application **`PinkWhale`** (la SPA partagée). Sans ça, Auth0 refuse la demande de jeton et
son message ne dit pas pourquoi. C'est le point 8 de l'`A-FAIRE.md` d'omnipass, constaté chez eux sur
un vrai appel. Sur l'audience REST, omnipass l'a déjà fait.

**4. Le compte machine : il y en a _un_ pour tous les produits — créé le 2026-11-17.** Son
`client_id` est `wyPvM8SDC6ZSYwzOUJSHDIGhYn4YQ1kY`, son secret est dans le magasin (A4), et il a
obtenu son premier jeton pour de vrai le soir même (A5). Le pas à pas reste ici pour le jour où il
faudra le refaire — une rotation, un second tenant, un incident.

J'avais recommandé l'inverse — un compte par produit — et omnipass a corrigé le 2026-11-17, son propre
code à l'appui : « One machine account may serve several applications ». Le plan gratuit plafonne les
applications, donc les produits de PinkWhale en partagent **une**, et ce qui dit lequel appelle reste
l'**audience signée** du jeton relayé.

Ce qu'il faut créer, **une seule fois pour les trois produits** :

1. **Applications** → **Create Application** → **Name** `PinkWhale machine` → type **Machine to
   Machine Applications** → **Create** ;
2. autorise-la sur l'API REST d'omnipass, `https://api.omnipass.app`. **Attention à la section** : sur
   la page de cette API, c'est **`Client access`** — celle des machines — et **non**
   `User-delegated access`, qui est celle des navigateurs ;
3. son `Client ID` n'est pas secret : donne-le-moi, et donne-le à omnipass, qui le déclare dans
   l'entrée de registre de **chaque** produit ;
4. son **Client Secret** ne passe ni par le chat ni par un message : il va dans le magasin de secrets
   (A4).

**Ce que le partage coûte, pour que personne ne le découvre à la mauvaise heure** : une rotation du
secret touche **tous** les produits en même temps, et on ne peut pas révoquer l'accès d'un seul sans
révoquer les autres. C'est le prix assumé du plafond, et omnipass l'écrit noir sur blanc.

**Ce que tu me rapportes dans le chat** : plus rien pour l'instant. Les deux `client_id` sont posés, le
domaine du tenant est lu dans la configuration d'omnipass, et il n'y a pas d'API à créer avant qu'on
serve un `/mcp`. Ce jour-là, tu me diras « l'API MCP est créée », et c'est tout.

### A3. Notre entrée chez omnipass — _complète le 2026-11-17_

omnipass a écrit notre entrée dans son registre : nos audiences, et `https://ms.pinkwhale.co` comme
URL de front — le lien que porteront ses e-mails d'invitation pour nos utilisateurs.

Il y manquait la liste `clientIds`, vide, qui faisait répondre `application_unknown` à tout appel
relayé. **Elle est remplie** : le `client_id` du compte machine partagé y est, omnipass a déployé, et
l'appel relayé est passé le soir même (A5). Il n'y a plus rien à demander ici.

**Ce qui y manquera encore, le jour où ça comptera** : notre audience **MCP**, qu'omnipass devra
ajouter à la même entrée quand on servira un `/mcp` — et, si on veut exercer le MCP **local** contre
un vrai omnipass, l'API locale, à créer puis à lui déclarer. Les deux vont ensemble et aucune n'est
urgente.

### A4. Le secret dans notre magasin — _fait en local le 2026-11-17 ; reste la production_

C'est la section que je n'avais jamais terminée : elle promettait « je te donnerai la forme exacte
quand on branchera le vrai omnipass ». Il est branché, donc la voici.

**Ce qui va dans `backend/.env`, et ce qui n'y va pas.** Les valeurs non secrètes y vont en clair ; le
Client Secret du compte machine **n'y va jamais**, parce que le code ne le lit pas là — il le lit dans
le magasin de secrets, et seulement là.

```sh
cd ~/PinkWhale/omnipotent/backend
cp .env.example .env   # si ce n'est pas déjà fait : il porte les bonnes valeurs, commentées
```

**Et le secret, en local : dans moto, pas dans AWS.** C'est le piège de cette étape, et il m'a coûté
un démarrage raté le 2026-11-17 avec un message qui accuse AWS à tort
(`ResourceNotFoundException: Secrets Manager can't find the specified secret`). En développement,
`config/default.json` pointe le magasin vers **moto**, l'émulateur de la pile `compose`, sur le port
**9022** — pas vers le vrai Secrets Manager.

```sh
docker compose up -d postgres rustfs moto
pnpm secrets:seed
```

_Corrigé le 2026-11-18_ : la commande en quatre lignes qui était ici ne pouvait pas marcher telle
quelle — `read` pose une variable du shell que `python3` ne voit pas, faute d'`export`.
`pnpm secrets:seed` la remplace. Les valeurs de développement **vivent sur AWS**, sous
`omnipotent/dev/` (le secret d'omnipass y était déjà, depuis le 17) ; la commande les recopie dans
moto, et envoie sur AWS ce qui est plus récent sur le poste. Ce qu'il faut en savoir :

- **chaque valeur passe par un fichier temporaire**, jamais par un argument de commande, visible dans
  `ps` le temps de l'appel ;
- **rien ne s'affiche** à la saisie, et rien ne reste dans l'historique ;
- **moto garde tout en mémoire** : un `docker compose down`, un `stop` ou un redémarrage du poste
  le vide, et l'application refuse alors de démarrer. Ce n'est pas une panne, c'est la commande à
  refaire — c'est arrivé entre le 17 et le 18. Elle est aussi dans `backend/README.md`, pour qu'on la
  trouve en démarrant le projet.

**Et voir ce qu'il y a dans le magasin local**, quand on doute :

```sh
AWS_ACCESS_KEY_ID=local AWS_SECRET_ACCESS_KEY=local aws secretsmanager list-secrets \
  --endpoint-url http://localhost:9022 --region eu-north-1 --query 'SecretList[].Name'
```

**En production**, le secret va dans le conteneur que Terraform a déjà créé,
`omnipotent/prod/omnipass/client-secret`, et sa **valeur se pose à la main** — jamais par Terraform,
qui l'écrirait dans son état. La commande est la même sans `--endpoint-url`, et avec le profil AWS du
compte : `--profile omnilor`. Attention, le profil `default` de cette machine porte des **clés
mortes** et répond `UnrecognizedClientException` — c'est ce qui s'est produit le 2026-11-17.

**Ce qui reste, et c'est nouveau depuis la suppression du bouchon** : l'**environnement de test** a
besoin du même secret dans son propre Secrets Manager. Avant, il pouvait démarrer sans, avec
l'implémentation locale ; depuis le 2026-11-17 il n'y a plus qu'une implémentation, donc plus
d'échappatoire : **pas de secret, pas de démarrage**, et c'est voulu. Rien à faire tant que cet
environnement n'est pas monté.

### A5. Où en est omnipass — _et le premier appel relayé, qui a tourné_

**Le tenant est le sien, et les consommateurs y connectent leurs utilisateurs.** C'est la lecture que
je supposais, et c'est son code qui tranche : son `TokenVerifier` prend **un** domaine, donc un
émetteur, donc un JWKS — il n'y a pas de place pour une seconde source de signature. Il a corrigé les
quatre documents qui disaient encore « tenant partagé », son `CLAUDE.md` compris.

Fait de son côté : le déménagement complet (tenant, nom d'hôte `omnipass.pinkwhale.co`, expéditeur
`no-reply@mail.pinkwhale.co`, super-admin `admin@pinkwhale.co`), l'Action post-login, ses deux API,
notre entrée de registre, et le retrait du `client_id` mort de multi-search.

**Ce qu'il nous apprend et qui change notre plan** : le compte machine est **partagé** entre les
produits, et c'est toi qui le crées (A2, point 4). Son plafond : 10 applications **et** 10 API.

**Ce qu'il nous devait, et qui est payé : le chemin relayé n'avait jamais tourné en vrai**, ni sur
l'ancien tenant ni sur le nouveau — il était couvert par des tests unitaires, pas par l'usage. Notre
premier appel était donc son premier essai, et il proposait de regarder ses journaux en direct pour
qu'on ait le refus exact plutôt qu'un 403 à deviner.

**Il n'y a pas eu de refus. Le 2026-11-17 au soir, de bout en bout, du premier coup** :

| Ce qui a été appelé                                                  | Résultat                         |
| -------------------------------------------------------------------- | -------------------------------- |
| Le compte machine demande son jeton (`aud` d'omnipass)               | **200**, valable 24 h            |
| `POST /identity/resolve`, jeton de la personne en `X-End-User-Token` | **200**, instantané complet      |
| Une lecture dans une Organization où la personne a un rôle           | **200**                          |
| Une Organization qu'elle ne voit pas                                 | **404 `organization_not_found`** |

Le dernier est le plus instructif, et il n'est **pas venu d'omnipass** : le paquet l'a levé chez nous,
sur l'instantané en cache, sans appel réseau. Les journaux d'omnipass le confirment : ce soir-là, trois
`resolve`, tous en 200, et rien d'autre (sa lettre du 2026-11-17, détail dans
`backend/docs/phase-1.md` § 6). C'est la preuve que l'instantané est le **vrai**, puisque le bouchon
faisait de l'appelant un `admin` de **toute** Organization et aurait répondu 200. C'est aussi ce qui a
permis de supprimer le bouchon le même soir.

**Ce qui n'est toujours pas vérifié, et pourquoi** : le **403 `role_required`**, celui d'un rôle trop
faible. Ton compte est super-admin, et chez omnipass un super-admin est `admin` de toute Organization :
il ne peut pas se faire refuser. **N'essaie pas de te rétrograder** en retirant ton adresse de la liste
des super-admins : le drapeau ne se retire jamais, et rien ne changerait. Il faut une **deuxième
adresse** — un alias comme `admin+viewer@…` suffit. La recette, en trois gestes :

1. tu l'invites dans une Organization avec le rôle **`viewer`** — une adresse jamais invitée ne peut
   pas se connecter du tout (`user_not_invited`) ;
2. tu te connectes avec elle et tu acceptes l'invitation ;
3. tu appelles une action qui exige `manager` : la réponse attendue est 403 `role_required`, avec
   `params: { required, actual }`.

C'est la dernière case de la phase 1, et elle dépend de toi.

Le même déménagement attend **multi-search** : il n'est pas encore sur ce tenant, donc son chemin
relayé est hors service jusqu'à sa bascule — ce qu'omnipass assume, ce chemin n'ayant jamais servi en
production. Pour nous, ça a une conséquence qui dépasse le calendrier : le front de multi-search est
le **seul** front qui doit consommer Omnipotent (`CADRAGE.md` § 18, § 21), et il ne pourra pas avant
d'avoir basculé sur ce tenant. **Notre première surface vivante est donc le MCP**, pas une page web —
ce qui remet l'API MCP d'Auth0 (A2, point 2) sur le chemin critique plus tôt qu'il n'y paraît.

### A6. Trois faits d'exploitation, découverts le 2026-11-17

Aucun n'a de démarche associée ; ils sont ici parce qu'ils changent des conclusions écrites ailleurs.

**1. Le dépôt `PinkWhaleAds/omnipotent` est _public_.** Mesuré sur l'API GitHub
(`visibility: public`), pas supposé. Deux conséquences, dont une bonne :

- **les _environments_ d'Actions ne coûtent rien.** J'avais annoncé l'inverse — « il faudra le plan
  payant, ou une vraie organisation » — en croyant le dépôt privé. Les environnements protégés sont
  payants pour un dépôt **privé** d'un compte personnel ; dans un dépôt public ils sont gratuits.
  `deploy.yml` déclare `environment: production`, et le sujet OIDC auquel le rôle AWS fait confiance
  contient `environment:production` : **ça fonctionne tel quel**. Ma recommandation est retirée ;
- **le code source est lisible par tout le monde.** C'est une décision produit, pas une question
  technique, et je ne la tranche pas. Ce qu'il faut savoir pour la trancher : aucun secret n'est dans
  le dépôt — ils sont tous dans Secrets Manager ou dans `.env`, ignoré par git — et les `client_id`
  qui y figurent ne sont pas des secrets. Donc rien n'est **compromis** ; la question est seulement
  de savoir si on veut que le dépôt soit public.

**2. Le profil AWS de cette machine est `omnilor`, et `default` porte des clés mortes.** Toute
commande `aws` sans `--profile omnilor` répond `UnrecognizedClientException: The security token
included in the request is invalid`, qui ressemble à un problème de droits et n'en est pas un. Le
compte est le compte de **test**, `903305161052`, utilisateur `omnilor-deploy`.

**3. Les routes de campagne ne sont pas celles qu'on suppose.** Un `GET /campaigns` répond 404, et ce
n'est **pas** un trou d'authentification : la liste est `GET /advertisers/:id/campaigns` et l'unité
est `GET /campaigns/:id`. Vérifié : `GET /campaigns/<uuid>` sans jeton répond bien **401
`invalid_token`**. Je l'écris parce que j'ai cru dix minutes à une faille.

---

## B. Google Ads — une seule démarche pour les deux produits

**Décision du 2026-10-27** : Omnipotent réutilise les accès de multi-search, qui n'existaient pas
encore. Ce qui suit est donc à faire **une fois**, et sert les deux produits.

**Depuis le 2026-11-14, le compte gestionnaire (MCC) de production existe.** Reste celui de test, et
tout ce qui touche au projet Cloud.

**Le 2026-11-18, B1 → B6 sont faits**, avec l'étape B5b qui manquait : projet payant, API activée,
compte de service invité Administrateur du MCC de production, client OAuth de l'inviteur, accès Basic
obtenu et Standard demandé. Restent B7 et B9, pas urgents, B8 après notre code, et le **MCC de test**,
pas créé — à décider avant les preuves de la phase 10, qui sinon écrivent sur un vrai compte.

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
2. `pnpm secrets:seed` le pose dans le magasin local : la commande demande le chemin du fichier,
   vérifie que c'est bien une clé de compte de service, et n'en affiche que l'adresse ;

3. en production, le même secret s'appelle `omnipotent/prod/google-ads/service-account`, son conteneur
   est déclaré par Terraform à la phase 10, et sa valeur se pose à la main, jamais par Terraform ;
4. une fois posée, **tu peux supprimer le fichier** : `pnpm secrets:seed` en garde la valeur sur AWS,
   sous `omnipotent/dev/google-ads/service-account`, et la rapatrie sur n'importe quel poste.
   _Corrigé le 2026-11-18_ : ce document disait de supprimer le fichier alors que la seule copie vivait
   dans moto, qui oublie tout à chaque redémarrage. Une clé de compte de service ne s'expire pas toute
   seule : elle vaut jusqu'à ce qu'on la révoque.

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
La commande, depuis `backend/` : `pnpm secrets:seed set google-ads/service-account`, qui demande le
chemin du fichier et vérifie que c'est une clé (B0, point 2).

_Constaté le 2026-11-19_ : la clé rangée le 2026-11-18 n'était pas la clé mais **le chemin de son
fichier**, posé par l'ancienne commande A4, puis recopié sur AWS par la synchronisation. Le fichier
ayant été effacé, la clé est à refaire (`A-FAIRE.md` § 2). La synchronisation vérifie désormais la
forme de chaque valeur et n'en recopie plus une cassée. **Refaite le jour même, et vérifiée** : un jeton
obtenu, puis un vrai compte lu depuis notre MCC.

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

### B5b. Le client OAuth de l'inviteur — _10 minutes ; ajoutée le 2026-11-18, elle manquait_

B8 fait consentir un humain admin du MCC, et ce consentement passe par **un client OAuth à nous**, du
type « Application de bureau ». Sans lui, la commande de B8 n'a rien à présenter à Google. C'est
l'équivalent Google de l'application Entra de C2.

Sur la **console Google Cloud** :

1. menu ☰ → **API et services** → **Écran de consentement OAuth** ; Google l'appelle maintenant
   « Google Auth Platform » ;
2. type d'utilisateur : **Interne** s'il est proposé, sinon **Externe** ; nom de l'application :
   `Omnilor Ads` ;
3. si tu as choisi Externe : rubrique **Audience** → **Publier l'application**, pour passer « En
   production ». **En statut « Test », le jeton de l'inviteur expire au bout de 7 jours** ;
4. rubrique **Clients** → **Créer un client** → type **Application de bureau** → nom
   `omnipotent-inviter` → **Créer** ;
5. **note le Client ID** — non secret, donne-le moi ;
6. **copie le Client secret tout de suite** : Google ne le réaffiche plus. Il va dans le magasin par
   `pnpm secrets:seed`, qui le garde aussi sur AWS — jamais dans le chat.

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

### B8. Le consentement de l'humain inviteur — _5 minutes ; la commande existe depuis le 2026-11-20_

Google **refuse les invitations de lien manager venant d'un compte de service**. Il faut donc qu'un
humain administrateur du MCC consente une fois, et nous gardons son `refresh_token`. Sans lui, un
compte que notre MCC gère déjà se connecte quand même ; seul un compte à **inviter** est refusé, avec
`platform_credentials_failed`.

**Les gestes**, depuis `backend/`, la base et le magasin local démarrés (`pnpm setup:dev` le fait) :

1. `pnpm google:connect`. La commande lit le client OAuth de B5b dans le secret `google-ads/inviter`,
   donc elle ne te demande rien, et elle affiche une longue adresse qui commence par
   `https://accounts.google.com/` ;
2. ouvre cette adresse (Ctrl + clic dans le terminal de VS Code) et connecte-toi avec
   **`admin@pinkwhale.co`**, l'admin du MCC. Si Google dit que l'application n'est pas vérifiée, c'est
   normal pour un client « Application de bureau » à nous : **Paramètres avancés**, puis **Accéder
   à … (non sécurisé)** ;
3. coche l'accès à **Google Ads** s'il est proposé en case, puis **Continuer**. Le navigateur arrive sur
   une page `127.0.0.1` qui dit « Omnipotent can now send Google Ads invitations », et la commande
   s'arrête d'elle-même ;
4. `pnpm secrets:seed` : le jeton est écrit sur le poste, et c'est la synchronisation qui l'envoie sur
   AWS, la valeur la plus récente gagnant.

**Ce qui ne passe jamais par le chat** : ni le client secret, ni le jeton. La commande n'affiche que des
noms et l'adresse de la page de Google. **Si le navigateur ne trouve pas la page `127.0.0.1`** — le
poste est sous WSL, et la page tourne dedans —, dis-le-moi avant de recommencer : la commande attend
dix minutes, puis abandonne sans rien écrire.

À refaire **seulement** si Google refuse un jour le jeton (`invalid_grant`, par exemple après un
changement du mot de passe de l'admin) : la même commande, les mêmes gestes.

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

**Le 2026-11-18, C1 → C3 sont faits** : le developer token de production, accordé tout de suite ;
l'application Entra ; l'utilisateur de service, Super Admin avec la double authentification. Reste le
**consentement**, qui attend sa commande, et C4, pas monté.

**Ne transpose pas Google ici.** Chez Microsoft le **developer token existe toujours** et il est
**obligatoire** dans chaque appel (en-tête `DeveloperToken`) ; c'est chez Google qu'il a disparu en
septembre 2026. Et l'authentification est celle d'un **utilisateur**, pas d'un compte de service :
jeton OAuth Entra ID avec la portée `https://ads.microsoft.com/msads.manage` et `offline_access`.

Tout ce qui suit est tiré de l'étude sourcée de multi-search
(`~/PinkWhale/multi-search/backend/docs/platforms/microsoft-ads.md`), où chaque affirmation porte sa
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
3. **Redirect URI** : plateforme **Web**, `http://localhost:4102/microsoft/callback` — l'adresse
   de la commande de consentement, décalée comme les autres ports locaux d'Omnipotent (multi-search
   prend 4100). Pas une URI `…/nativeclient` : celle-là est réservée aux applications publiques ;
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

**Fait le 2026-11-18 avec un compte personnel Microsoft dédié** (outlook.com), pas avec
`admin@pinkwhale.co` : celui-ci se connecte à Microsoft Advertising par un **compte Google**, et
l'API exige une identité Microsoft. L'adresse n'est pas écrite ici, le dépôt étant public. Limite
assumée : un client dont la politique exige des comptes professionnels répondra
`PersonalIdentityNotAvailable` ; en changer ne demandera que de refaire le consentement.

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

### C5. Le consentement de l'utilisateur de service — _5 minutes ; la commande existe depuis le 2026-11-20_

C'est le consentement annoncé en C3. Il se donne **une fois**, puis l'API renouvelle le jeton toute
seule et le réécrit dans le magasin (`backend/docs/phase-11.md` § 2).

**Les gestes**, depuis `backend/`, la base et le magasin local démarrés (`pnpm setup:dev` le fait) :

1. `pnpm microsoft:connect`. La commande lit l'application Entra dans le secret `microsoft-ads/app`,
   donc elle ne te demande rien, et elle affiche une longue adresse qui commence par
   `https://login.microsoftonline.com/` ;
2. ouvre cette adresse (Ctrl + clic dans le terminal de VS Code) et connecte-toi avec **l'utilisateur
   de service**, le compte outlook.com dédié de C3 — **pas** `admin@pinkwhale.co`. Microsoft propose de
   choisir le compte : prends celui-là, et passe la double authentification ;
3. accepte les autorisations demandées par l'application. Le navigateur arrive sur une page
   `localhost:4102` qui dit « Omnipotent can now manage Microsoft Advertising », et la commande
   s'arrête d'elle-même en affichant **l'adresse du compte qui a consenti** : vérifie que c'est bien
   l'utilisateur de service ;
4. `pnpm secrets:seed` : le jeton est écrit sur le poste, et c'est la synchronisation qui l'envoie sur
   AWS, la valeur la plus récente gagnant.

**Ce qui ne passe jamais par le chat** : ni le client secret, ni les jetons. **Si le navigateur ne
trouve pas la page `localhost:4102`** — le poste est sous WSL —, dis-le-moi avant de recommencer : la
commande attend dix minutes, puis abandonne sans rien écrire.

À refaire **seulement** si Microsoft refuse un jour le jeton (`invalid_grant`, après un changement du
mot de passe de l'utilisateur de service, ou quatre-vingt-dix jours sans aucun appel) : la même
commande, les mêmes gestes.

## Ce que tu me donnes dans le chat, en une fois

Rien de secret là-dedans, et chaque ligne peut arriver seule : rien n'attend le lot complet.

**Auth0 : plus rien.** ✅ Tout est posé depuis le 2026-11-17 — le domaine du tenant, les deux
`client_id`, l'audience commune, le secret dans le magasin, l'entrée de registre. La seule chose qui
reviendra ici est « l'API MCP est créée », le jour où on servira un `/mcp`, et c'est moi qui te le
demanderai à ce moment-là.

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

**Et une chose qui n'est pas une valeur** : une **deuxième personne** dans omnipass, avec un rôle
`viewer`, pour vérifier le dernier cas de la phase 1 — le 403 d'un rôle trop faible (A5). Un compte
super-admin ne peut pas se le faire refuser, donc ce cas restera non vérifié tant qu'il n'y aura qu'un
compte.

**Ce qui ne passe jamais par ici** : la clé JSON du compte de service Google, le developer token et le
client secret Microsoft, le Client Secret du compte machine Auth0. Chacun a son chemin vers le magasin
de secrets, décrit à son étape — et « ici » inclut un fichier ouvert dans l'éditeur, comme le dit la
règle en tête de ce document.

---

## L'état, en un tableau

| Partie                       | État                                                                    |
| ---------------------------- | ----------------------------------------------------------------------- |
| **A. omnipass et Auth0**     | ✅ **close**, sauf l'API MCP (A2) qui attend qu'on serve un `/mcp`      |
| **B. Google Ads**            | ✅ B1 → B6 et B5b le 2026-11-18 ; restent B7, B8 (après le code), B9, et le MCC de test |
| **C. Microsoft Advertising** | ✅ C1 → C3 le 2026-11-18 ; restent le consentement (après le code) et C4   |

**Plus rien ne bloque le développement.** Ce qui reste de ton côté vient après le code — les deux
consentements — ou attend sa phase.
