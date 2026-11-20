# Scénarios

Des scripts qui jouent un parcours complet contre l'API locale, appel après appel, et racontent dans
la console ce qui se passe. Ils remplacent les pas-à-pas à cliquer dans le Swagger : on les relance
autant qu'on veut, et chaque étape dit ce qu'elle a créé.

Ils ne sont pas des tests : ils parlent à la vraie API, et à travers elle aux vraies plateformes.

## Avant de lancer un scénario

1. L'API tourne en local : `pnpm start:dev` dans `backend/`, les migrations passées
   (`pnpm migration:run`).
2. Les réglages sont **en tête de chaque script**, dans `CONFIG`. Ceux que tu laisses vides te sont
   demandés au lancement. Le **jeton reste toujours vide** dans le fichier : il est demandé sans
   s'afficher, et ne se commite donc jamais. Pour l'avoir : dans le Swagger
   (`http://localhost:3002/documentation`), clique sur _Authorize_, connecte-toi, exécute n'importe
   quelle route, et copie dans la boîte _Curl_ ce qui suit `Authorization: Bearer `. Il expire au bout
   de quelques heures : quand l'API répond 401, refais-le.

## `campagne-google.mjs` — une campagne Google à 10 €

Les preuves du lot 3a (`backend/docs/phase-10.md` § 8.6), aux règles du § 1 : **10 € au total**,
lancée **puis mise en pause aussitôt**.

```sh
node scenarios/campagne-google.mjs
```

Ses réglages : l'API, l'Organization — vide, le script lit les tiennes sur `GET /me` et demande
laquelle quand il y en a plusieurs —, la marque — vide, de même parmi celles de l'Organization —, le **vrai site** de la marque, que Google
examine, les mots-clés, et s'il faut lancer — vide, la question est posée une fois la preview propre.

Il relie la marque au compte Google connecté, crée la campagne (une semaine, départ demain à 9 h),
son levier Search avec un lien annexe et deux accroches, un AdGroup en CPC manuel à 0,50 €, le
ciblage France et 20 km autour de Paris, des mots-clés, un logo carré, deux annonces et leurs Lines,
puis lit la preview. S'il lance, il met en pause aussitôt, suit la synchronisation et affiche ce que
Google a créé.
