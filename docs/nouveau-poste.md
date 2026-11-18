# Reprendre Omnipotent sur un nouveau poste

Écrit le **2026-11-18**, avant un changement de machine. Ce document dit ce que `git clone` apporte,
ce qu'il n'apporte pas, et comment refaire le reste, étape par étape.

**Ce que le clone apporte** : tout le code, toute la documentation, le handover
(`docs/handover-reprise.md`), `A-FAIRE.md`, le runbook des accès et les identifiants non secrets.

**Ce qu'il n'apporte pas**, parce que rien de tout cela n'est dans git :

- les **secrets** — ils vivent dans le magasin local (moto), qui ne garde rien sur disque ;
- tes **clés** : la clé SSH du compte `PinkWhaleAds` et le jeton GitHub qui installe le paquet
  d'omnipass ;
- le fichier `backend/.env`, qui se recrée en une commande ;
- les **outils** de la machine ;
- la **mémoire de Claude** et ta préférence globale sur les commits, qui restent sur l'ancien poste.

---

## 0. Avant de quitter l'ancien poste

**Vérifie que tout est poussé.** Dans `~/PinkWhale/omnipotent`, `git status` doit répondre
`Your branch is up to date with 'origin/main'`. Même vérification dans `~/PinkWhale/omnipass` si tu
y as travaillé.

**Range dans ton gestionnaire de mots de passe** chacune de ces valeurs. Ce sont des secrets : ils ne
passent ni par le chat ni par un fichier du dépôt.

| Secret                                         | Si tu l'as perdu                                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Client Secret du compte machine omnipass       | Auth0 → Applications → l'application machine partagée (Client ID `wyPvM8…`) → Settings → afficher le secret. **Ne le fais pas tourner** sans prévenir omnipass : le compte est partagé |
| Fichier JSON de la clé du compte de service Google | Irrécupérable : crée une nouvelle clé (console Cloud → IAM → Comptes de service → Clés), puis supprime l'ancienne |
| Client secret du client OAuth Google (inviteur) | Google ne le réaffiche pas : ajoute un nouveau secret au même client (Google Auth Platform → Clients)      |
| Client secret de l'application Entra (colonne « Value ») | Azure ne le réaffiche pas : crée-en un nouveau (App registrations → l'application → Certificates & secrets) |
| Developer token Microsoft                      | Visible dans ads.microsoft.com → Paramètres → Developer settings                                          |
| Jeton GitHub de `~/.npmrc`                     | Irrécupérable : crée-en un nouveau (§ 4)                                                                   |
| Clé SSH `~/.ssh/id_ed25519_pinkwhale`          | Crée-en une nouvelle (§ 2)                                                                                 |

**Et deux valeurs non secrètes qui ne sont pas dans le dépôt** :

- l'**adresse de l'utilisateur de service Microsoft** (le compte outlook.com dédié). Le dépôt est
  public, et publier l'adresse de connexion d'un Super Admin, c'est dire quel compte attaquer. Tu la
  donneras à la session qui écrira la commande de consentement ;
- le contenu de l'onglet **`Untitled-1`** de VS Code, s'il est encore ouvert : il n'est enregistré
  nulle part.

## 1. Les outils

Sur Windows, tout se fait dans **WSL2** (Ubuntu), comme sur l'ancien poste : les chemins de ce
document sont ceux de Linux.

| Outil      | Version                                   | Pour quoi                                            |
| ---------- | ----------------------------------------- | ---------------------------------------------------- |
| Git        | récente                                   | tout                                                 |
| Docker     | Docker Desktop avec l'intégration WSL, ou Docker Engine dans WSL | PostgreSQL, le stockage S3 et le magasin de secrets |
| Node       | **22.12 ou plus** (22.23 sur l'ancien poste) | le backend                                       |
| pnpm       | 10, par `corepack enable`                 | le backend                                           |
| AWS CLI    | v2                                        | le magasin de secrets local, et la production       |
| Python 3   | n'importe laquelle                        | la commande `pnpm secrets:seed`                      |
| Terraform  | 1.16 ou plus                              | seulement pour `infra/`                              |

## 2. Les accès GitHub

Deux comptes GitHub, donc deux clés SSH :

- **`PinkWhaleAds`** porte `omnipotent` et `omnipass`. Il passe par l'alias **`github-pinkwhale`** ;
- **ton compte habituel**, celui qui a accès à `MultiSearchAd/multi-search`, passe par `github.com`
  normalement.

Pour `PinkWhaleAds`, recopie la clé de l'ancien poste (de façon sûre, puis `chmod 600`), ou
crée-en une :

```sh
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_pinkwhale -C pinkwhale
cat ~/.ssh/id_ed25519_pinkwhale.pub
```

Copie la ligne affichée dans GitHub, **connecté en `PinkWhaleAds`** : photo en haut à droite →
Settings → SSH and GPG keys → New SSH key.

Puis ajoute ce bloc à `~/.ssh/config` — c'est exactement celui de l'ancien poste :

```text
Host github-pinkwhale
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_pinkwhale
  IdentitiesOnly yes
```

**Vérification** : `ssh -T git@github-pinkwhale` doit répondre `Hi PinkWhaleAds!`.

Et l'identité de tes commits, la même qu'avant :

```sh
git config --global user.name "Lorin"
git config --global user.email "16312152+LorinProjects@users.noreply.github.com"
```

## 3. Cloner les dépôts, aux mêmes chemins

Les documents citent les autres dépôts **par leur chemin** (`~/PinkWhale/omnipass`,
`~/OmniAd/multi-search`) : garde les mêmes, sinon ces renvois mènent nulle part.

```sh
mkdir -p ~/PinkWhale ~/OmniAd
git clone git@github-pinkwhale:PinkWhaleAds/omnipotent.git ~/PinkWhale/omnipotent
git clone git@github-pinkwhale:PinkWhaleAds/omnipass.git   ~/PinkWhale/omnipass
git clone git@github.com:MultiSearchAd/multi-search.git     ~/OmniAd/multi-search
```

**multi-search est indispensable** pour la suite : les adapters Google et Microsoft se transcrivent de
son code.

Les sources d'Azerion (`~/OmniAd/mbp`, avec `meta-dsp-lib`) ne servent qu'aux phases des DSP, bien plus
tard. Recopie le dossier depuis l'ancien poste le moment venu.

## 4. Le jeton qui installe le paquet d'omnipass

Sans lui, `pnpm install` échoue sur `@pinkwhaleads/omnipass-client` avec un 401 ou un 403. Le paquet
est privé, sur le registre de GitHub.

Recopie `~/.npmrc` depuis l'ancien poste, ou crée un nouveau jeton : le pas à pas est dans
`docs/runbook-acces.md`, **A1a** — un jeton « classic », créé **connecté en `PinkWhaleAds`**, avec le
seul scope `read:packages`. Puis, sans que le jeton apparaisse à l'écran ni dans l'historique :

```sh
read -rs -p 'Jeton GitHub (read:packages) : ' T && echo
printf '//npm.pkg.github.com/:_authToken=%s\n' "$T" >> ~/.npmrc && chmod 600 ~/.npmrc && unset T
```

Le jeton expire au bout de 90 jours. Celui de l'ancien poste meurt vers le 2027-02-15.

## 5. Le backend

```sh
cd ~/PinkWhale/omnipotent/backend
corepack enable
pnpm install
cp .env.example .env                      # les valeurs de développement y sont déjà
docker compose up -d postgres rustfs moto
pnpm migration:run
pnpm secrets:seed                         # pose les secrets, voir ci-dessous
pnpm start:dev                            # API sur http://localhost:3002, Swagger sur /documentation
```

### `pnpm secrets:seed`

La commande demande chaque secret **sans l'afficher**, et une réponse vide le saute. Prépare ton
gestionnaire de mots de passe :

| Ce qu'elle demande                                   | Ce que tu donnes                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| 1. omnipass — Client secret                          | le Client Secret du compte machine                                    |
| 2. Google Ads — Path of the .json file               | le chemin du fichier de clé, par exemple `/mnt/c/Users/<toi>/Downloads/<fichier>.json` |
| 3. Google Ads — Client ID, puis Client secret        | le client OAuth « Application de bureau » de l'inviteur. Le Client ID est dans `A-FAIRE.md` § 2 |
| 4. Microsoft — Application (client) ID, Client secret, Developer token | l'application Entra et le developer token          |

Elle refuse d'écrire ailleurs que dans le magasin local, ne remplace un secret déjà posé que sur un
oui, et finit en listant les noms posés — jamais les valeurs. Une fois le fichier de clé Google posé,
tu peux le supprimer du disque, **pas** de ton gestionnaire.

**À refaire chaque fois que moto redémarre** — `docker compose down`, `docker compose stop`, ou un
redémarrage du poste : moto garde tout en mémoire, et repart vide. Le symptôme est un démarrage qui
échoue sur `ResourceNotFoundException: Secrets Manager can't find the specified secret`, qui accuse
AWS à tort. C'est arrivé entre le 2026-11-17 et le 2026-11-18 : le secret d'omnipass avait disparu.

**Les consentements** (Google pour l'inviteur, Microsoft pour l'utilisateur de service) s'ajouteront
au magasin plus tard, chacun par sa propre commande, une fois le code écrit. Comme le reste, ils
disparaissent avec moto et se refont en une minute.

### Vérifier

- `curl -s http://localhost:3002/readyz` répond prêt ;
- http://localhost:3002/documentation affiche Swagger.

## 6. AWS — seulement pour la production

Rien de ce qui précède n'en a besoin. Pour agir sur le vrai AWS, il faut le **profil `omnilor`** :
recopie sa section de `~/.aws/config` et de `~/.aws/credentials` depuis l'ancien poste, ou recrée-le
avec `aws configure --profile omnilor`.

Le piège connu : le profil `default` de l'ancien poste porte des clés mortes et répond
`UnrecognizedClientException`, qui ressemble à un problème de droits sans en être un. Passe toujours
`--profile omnilor`.

## 7. Claude Code

- **Recrée ta préférence globale** : le fichier `~/.claude/CLAUDE.md` de l'ancien poste contient une
  ligne, `- never add co auth message in git`. Sans lui, une session ajoute une ligne de co-auteur à
  ses commits.
- **La mémoire de Claude reste sur l'ancien poste.** Rien d'important ne s'y perd : les règles de
  travail sont dans le handover, les identifiants dans `A-FAIRE.md`, sauf l'adresse de l'utilisateur
  de service Microsoft (§ 0).
- **Premier message à la nouvelle session** : « lis `docs/handover-reprise.md`, on reprend ». Dis-lui
  aussi **combien de RAM** a le nouveau poste : jest y lance un worker par cœur, et l'ancien poste
  tombait avec ses 15 Go.

## 8. La liste de contrôle

- [ ] `ssh -T git@github-pinkwhale` répond `Hi PinkWhaleAds!`
- [ ] Les trois dépôts sont clonés aux mêmes chemins
- [ ] `pnpm install` passe, paquet d'omnipass compris
- [ ] `pnpm secrets:seed` liste `omnipass/client-secret`, `google-ads/service-account`,
      `google-ads/inviter` et `microsoft-ads/app`
- [ ] `pnpm start:dev` démarre, et `/readyz` répond
- [ ] `~/.claude/CLAUDE.md` est recréé
