# Scénarios

Des scripts qui jouent un parcours complet contre l'API locale, appel après appel, et racontent dans
la console ce qui se passe. Ils remplacent les pas-à-pas à cliquer dans le Swagger : on les relance
autant qu'on veut, et chaque étape dit ce qu'elle a créé.

Ils ne sont pas des tests : ils parlent à la vraie API, et à travers elle aux vraies plateformes.

## Avant de lancer un scénario

1. L'API tourne en local : `pnpm start:dev` dans `backend/`, les migrations passées
   (`pnpm migration:run`). **Et un worker à côté**, qui traite les jobs — la synchronisation vers les
   plateformes en est un : `APP_PORT=3012 pnpm start:worker`, dans `backend/` aussi. L'API ne fait que
   les mettre en file ; sans worker, une campagne lancée reste « pending » et rien ne part.
2. **Tes réglages vont dans `scenarios/config.local.mjs`**, que git ignore : ton Organization, et si tu
   veux ton jeton. **Jamais dans le script lui-même** : il est commité, et le dépôt est public. Ce que
   tu laisses vide est demandé au lancement, le jeton sans s'afficher.

   ```js
   export default { organizationId: '…', token: '' };
   ```

   Ton jeton : dans le Swagger (`http://localhost:3002/documentation`), clique sur _Authorize_,
   connecte-toi, exécute n'importe quelle route, et copie dans la boîte _Curl_ ce qui suit
   `Authorization: Bearer `. Il expire au bout de vingt-quatre heures.

## `campagne-google.mjs` — une campagne Google à 10 €

Les preuves du lot 3a (`backend/docs/phase-10.md` § 8.6), aux règles du § 1 : **10 € au total**,
lancée **puis mise en pause aussitôt**.

```sh
node scenarios/campagne-google.mjs
```

Ses réglages : l'API, l'Organization — vide, le script lit les tiennes sur `GET /me` et demande
laquelle quand il y en a plusieurs —, la marque — vide, il prend celle de l'Organization, demande
laquelle quand il y en a plusieurs, et **en crée une** quand il n'y en a aucune —, la page où mènent
les annonces — vide, le site de la marque —, les mots-clés, et s'il faut lancer — vide, la question est
posée une fois la preview propre.

Il relie la marque au compte Google connecté, crée la campagne (une semaine, départ demain à 9 h),
son levier Search avec un lien annexe et deux accroches, un AdGroup en CPC manuel à 0,50 €, le
ciblage France et 20 km autour de Paris, des mots-clés, un logo carré, deux annonces et leurs Lines,
puis lit la preview. S'il lance, il met en pause aussitôt, suit la synchronisation et affiche ce que
Google a créé.

## `campagne-google-preuves.mjs` — les preuves qui suivent

Les autres preuves du lot 3a, sur une campagne que `campagne-google.mjs` a lancée et mise en pause :

1. **une modification** — un mot-clé ajouté : chez Google, seul ce changement part, une opération ;
2. **rien n'a changé** — une synchro demandée à la main : **aucun appel** à Google ;
3. **un AdGroup ajouté après le lancement** : en pause, absent de Google ; puis activé, et présent ;
4. **une erreur provoquée** — un pays que Google ne cible pas — remontée avec son code, puis réparée.

```sh
node scenarios/campagne-google-preuves.mjs
```

Chaque preuve affiche les appels faits à Google pendant sa synchro, lus dans le journal
(`GET /ad-accounts/:id/platform-calls`), le numéro du compte masqué. Tout reste en pause chez Google.
Reste à relever à la main les limites d'objets du compte Google (`A-FAIRE.md` § 5).

## `campagne-google-verdicts.mjs` — ce que Google a fait des annonces

La preuve du lot 3b (`backend/docs/phase-10.md` § 8.8), sur une campagne que `campagne-google.mjs` a
lancée. Elle ne change rien : elle lit le verdict de chaque annonce — **en examen**, **approuvée**,
**limitée** (approuvée, montrée à moins de monde) ou **refusée**, avec les raisons de Google telles
qu'il les écrit — de deux façons :

1. dans le statut de plateforme de la campagne (`GET /campaigns/:id/platform-status`), avec l'heure de
   la dernière lecture ;
2. créa par créa (`GET /creatives/:id/lines`), chaque Line avec son verdict par plateforme.

```sh
node scenarios/campagne-google-verdicts.mjs
```

Les verdicts sont lus par le job `review.poll`, **toutes les dix minutes, dans un worker** : sans
worker, aucun n'est jamais lu. Une annonce d'une campagne en pause reste peut-être en examen : si elle
l'est encore le lendemain, c'est que Google n'examine pas une annonce en pause.

## `campagne-google-lieux.mjs` — une ville et un code postal chez Google

La preuve du lot 3c (`backend/docs/phase-10.md` § 8.9), sur une campagne que `campagne-google.mjs` a
lancée :

1. il cherche une ville et un code postal dans le référentiel des lieux (`GET /geo/locations`) —
   `Paris` et `75001` par défaut, à changer dans `config.local.mjs` (`city`, `postalCode`, `country`) ;
2. il réenregistre le rayon du TargetingGroup avec son pays, que D57 exige ;
3. il pose la ville et le code postal dans `location`, par leur seul identifiant, et affiche ce que
   l'API en a complété ;
4. il lit la preview, puis attend la synchro et affiche les appels faits à Google.

```sh
node scenarios/campagne-google-lieux.mjs
```

Le référentiel est importé **par le worker, à son démarrage, quand il est vide** : la première fois,
relance le worker et attends une minute — le fichier de Google pèse quelques dizaines de mégaoctets.
Puis vérifie dans Google Ads, dans les paramètres de la campagne, ses zones géographiques : la ville,
le code postal et le rayon, et plus la France entière.
