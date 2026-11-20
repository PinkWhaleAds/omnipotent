# Reprendre Omnipotent sur un nouveau poste

Écrit le **2026-11-18**, avant un changement de machine.

**L'idée** : tout ce qui est secret vit sur **AWS**, dans Secrets Manager, sous `omnipotent/dev/` — les
clés Google et Microsoft, le secret d'omnipass, le jeton qui installe le paquet d'omnipass. Sur une
machine neuve, il suffit donc des outils, du profil AWS et d'un clone : **une commande fait le
reste**.

Ce que le clone apporte : le code, la documentation, le handover (`docs/handover-reprise.md`),
`A-FAIRE.md` et les identifiants non secrets. Ce qu'il n'apporte pas, et que ce document refait : les
outils, le profil AWS, la clé SSH, et ta préférence globale pour Claude Code.

---

## 0. Avant de quitter l'ancien poste

- **Vérifie que tout est poussé** : dans `~/PinkWhale/omnipotent`, `git status` doit répondre
  `Your branch is up to date with 'origin/main'`. Même chose dans `~/PinkWhale/omnipass` si tu y as
  travaillé.
- **Les secrets sont déjà sur AWS** : la synchronisation y a envoyé le 2026-11-18 tout ce que ce poste
  avait. Pour le vérifier, dans `backend/` : `pnpm secrets:seed` doit répondre `up to date` partout.
- **L'onglet `Untitled-1`** de VS Code : tout ce qu'il contenait est maintenant dans `A-FAIRE.md` § 2.
  Tu peux le fermer sans l'enregistrer.

**Une chose à emporter à la main : les sources d'Azerion** (`~/OmniAd/mbp`, avec `mbp-api` et
`meta-dsp-lib`). Elles ne servent qu'aux phases des DSP, bien plus tard, mais elles **ne se reclonent
pas** : le GitLab d'Azerion ne répondait plus depuis l'ancien poste le 2026-11-18. Et elles ne vont
**ni sur GitHub ni sur AWS** : c'est le code d'Azerion, lu en vertu d'un accord (`CADRAGE.md` § 2), et
une copie sur nos serveurs sortirait de cet accord. Elles passent d'un poste à l'autre directement,
avec tes clés SSH :

```sh
cd ~ && tar czf transfert.tgz --exclude=node_modules .ssh OmniAd/mbp
```

Copie `transfert.tgz` sur une clé USB, puis, sur le nouveau poste :

```sh
cd ~ && tar xzf /chemin/vers/transfert.tgz && chmod 700 ~/.ssh && chmod 600 ~/.ssh/*
```

**L'archive contient tes clés privées** : garde la clé USB sur toi, ne la dépose sur aucun service en
ligne, et efface l'archive une fois extraite. Avec `~/.ssh` recopié, le § 3 se réduit à sa
vérification.

Et une chose qui n'est nulle part, volontairement : l'**adresse de l'utilisateur de service
Microsoft** (le compte outlook.com dédié, que tu connais). Elle n'est pas dans le dépôt parce qu'il
est public.

## 1. Les outils

Sur Windows, tout se fait dans **WSL2** (Ubuntu), comme sur l'ancien poste.

| Outil      | Version                                                    | Pour quoi                                 |
| ---------- | ---------------------------------------------------------- | ----------------------------------------- |
| Git        | récente                                                    | tout                                      |
| Docker     | Docker Desktop avec l'intégration WSL, ou Docker Engine    | PostgreSQL, le stockage, le magasin local |
| Node       | **22.12 ou plus** (22.23 sur l'ancien poste)               | le backend                                |
| pnpm       | 10, par `corepack enable`                                  | le backend                                |
| AWS CLI    | v2                                                         | les secrets                               |
| Python 3   | n'importe laquelle                                         | les scripts de mise en route              |
| Terraform  | 1.16 ou plus                                               | seulement pour `infra/`                   |

## 2. Le profil AWS `omnilor` — c'est lui qui ouvre tout

C'est par lui que la mise en route va chercher les secrets. Vérifie qu'il répond :

```sh
aws sts get-caller-identity --profile omnilor
```

La réponse doit contenir `"Account": "903305161052"`.

- **Si ça répond** : rien à faire.
- **Si le profil n'existe pas** : recopie les sections `[omnilor]` de `~/.aws/credentials` et
  `[profile omnilor]` de `~/.aws/config` depuis l'ancien poste.
- **Si ton profil s'appelle autrement** sur ce poste : garde-le, et préfixe les commandes du § 5 par
  `AWS_SEED_PROFILE=<son nom>`.

Le profil `default` de l'ancien poste portait des clés mortes : ne t'y fie pas.

## 3. La clé SSH de `PinkWhaleAds`

Elle sert à **pousser** sur `omnipotent` et `omnipass`. Si tu as recopié `~/.ssh` avec l'archive du
§ 0, elle est déjà là : passe directement à la vérification. Sinon, crée-la :

```sh
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_pinkwhale -C pinkwhale
cat ~/.ssh/id_ed25519_pinkwhale.pub
```

Copie la ligne affichée dans GitHub, **connecté en `PinkWhaleAds`** : photo en haut à droite →
Settings → SSH and GPG keys → New SSH key.

Ajoute ce bloc à `~/.ssh/config` — exactement celui de l'ancien poste :

```text
Host github-pinkwhale
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_pinkwhale
  IdentitiesOnly yes
```

**Vérification** : `ssh -T git@github-pinkwhale` doit répondre `Hi PinkWhaleAds!`.

Ton **compte GitHub habituel**, celui qui a accès à `MultiSearchAd/multi-search`, passe par
`github.com` avec sa propre clé, comme sur l'ancien poste.

Et l'identité de tes commits, la même qu'avant :

```sh
git config --global user.name "Lorin"
git config --global user.email "16312152+LorinProjects@users.noreply.github.com"
```

## 4. Cloner les dépôts, aux mêmes chemins

Les documents citent les autres dépôts **par leur chemin** : garde les mêmes.

```sh
mkdir -p ~/PinkWhale ~/OmniAd
git clone git@github-pinkwhale:PinkWhaleAds/omnipotent.git ~/PinkWhale/omnipotent
git clone git@github-pinkwhale:PinkWhaleAds/omnipass.git   ~/PinkWhale/omnipass
git clone git@github.com:MultiSearchAd/multi-search.git     ~/OmniAd/multi-search
```

**multi-search est indispensable** : les adapters Google et Microsoft se transcrivent de son code. Les
sources d'Azerion (`~/OmniAd/mbp`) arrivent par l'archive du § 0, au même chemin.

## 5. Une commande

**Toujours depuis `backend/`** : à la racine du dépôt il n'y a pas de `package.json`, et pnpm répond
`ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`.

```sh
cd ~/PinkWhale/omnipotent/backend
corepack enable
pnpm setup:dev
pnpm start:dev        # puis http://localhost:3002/documentation
```

`pnpm setup:dev` fait, dans l'ordre :

1. **les secrets** : il les rapatrie d'AWS dans le magasin local (moto), et écrit dans `~/.npmrc` le
   jeton qui installe le paquet d'omnipass. Il démarre moto s'il ne tourne pas ;
2. **les dépendances** : `pnpm install` ;
3. **`.env`** : copié de `.env.example` s'il n'existe pas, et gardé sinon ;
4. **les conteneurs** : PostgreSQL, le stockage S3, le magasin de secrets ;
5. **le schéma** : les migrations.

Il ne te pose **aucune question**, sauf pour un secret qu'il ne trouve ni sur AWS ni sur la machine.
Il n'affiche jamais une valeur, seulement des noms.

**À relancer chaque fois que l'API refuse de démarrer après un redémarrage** du poste ou un
`docker compose down` : le magasin local garde tout en mémoire, et repart vide. Le symptôme est
`ResourceNotFoundException: Secrets Manager can't find the specified secret`, qui accuse AWS à tort.
`pnpm secrets:seed` seul suffit aussi.

### Remplacer un secret

Quand une valeur change — un jeton qui expire, un secret qu'on fait tourner —, une commande la
redemande et la remplace sur AWS **et** sur la machine :

```sh
pnpm secrets:seed set <nom>
```

| `<nom>`                      | Ce que c'est                                                 | Quand le remplacer                          |
| ---------------------------- | ------------------------------------------------------------ | ------------------------------------------- |
| `github/npm-token`           | le jeton GitHub de `~/.npmrc` (runbook A1a)                  | il expire vers le **2027-02-15**            |
| `microsoft-ads/app`          | l'application Entra et le developer token                    | à l'expiration du client secret Entra       |
| `google-ads/service-account` | la clé JSON du compte de service                             | si elle est révoquée                        |
| `google-ads/inviter`         | le client OAuth de l'inviteur Google                         | si on le recrée                             |
| `omnipass/client-secret`     | le secret du compte machine omnipass                         | quand omnipass le fait tourner              |

Les **consentements** Google et Microsoft s'écrivent sur la machine, par `pnpm google:connect` et
`pnpm microsoft:connect`, et `pnpm secrets:seed` les envoie sur AWS : c'est la valeur la plus récente
qui gagne, des deux côtés. Le jeton Microsoft (`microsoft-ads/oauth`) **change à chaque
renouvellement** : l'API réécrit le nouveau dans le magasin local, et le prochain `pnpm secrets:seed`
l'envoie à son tour.

## 6. Claude Code

- **Recrée ta préférence globale** : le fichier `~/.claude/CLAUDE.md` de l'ancien poste contient une
  ligne, `- never add co auth message in git`. Sans lui, une session ajoute une ligne de co-auteur à
  ses commits.
- **La mémoire de Claude reste sur l'ancien poste.** Rien d'important ne s'y perd : les règles de
  travail sont dans le handover, les identifiants dans `A-FAIRE.md`.
- **Premier message à la nouvelle session** : « lis `docs/handover-reprise.md`, on reprend ». Dis-lui
  aussi **combien de RAM** a le nouveau poste : jest y lance un worker par cœur, et l'ancien poste
  tombait avec ses 15 Go.

## 7. Si ça coince

| Ce que tu vois                                                     | Ce que ça veut dire, et quoi faire                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND`                              | Tu es à la racine du dépôt : `cd backend`                            |
| `AWS does not answer with the profile "omnilor"`                   | Le profil AWS manque ou a un autre nom : § 2                         |
| `pnpm install` échoue en 401 ou 403 sur `@pinkwhaleads/omnipass-client` | Le jeton GitHub a expiré : crée-en un (runbook A1a), puis `pnpm secrets:seed set github/npm-token` |
| `ResourceNotFoundException: Secrets Manager can't find…` au démarrage | Le magasin local s'est vidé : `pnpm secrets:seed`                  |
| `OMNIPASS::TOKEN_FAILED` dans les journaux de l'API                | Le secret d'omnipass a tourné : `pnpm secrets:seed set omnipass/client-secret` |
| `Permission denied (publickey)` en poussant                        | La clé SSH n'est pas dans GitHub, ou pas sur le bon compte : § 3     |

## 8. La liste de contrôle

- [ ] `aws sts get-caller-identity --profile omnilor` répond le compte `903305161052`
- [ ] `ssh -T git@github-pinkwhale` répond `Hi PinkWhaleAds!`
- [ ] Les trois dépôts sont clonés aux mêmes chemins
- [ ] `pnpm setup:dev` finit sur `Ready`
- [ ] `pnpm start:dev` démarre, et http://localhost:3002/readyz répond `ok`
- [ ] `~/.claude/CLAUDE.md` est recréé
