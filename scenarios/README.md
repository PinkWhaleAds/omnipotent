# Scénarios

Des scripts qui jouent un parcours complet contre l'API locale, appel après appel, et racontent dans
la console ce qui se passe. Ils remplacent les pas-à-pas à cliquer dans le Swagger : on les relance
autant qu'on veut, et chaque étape dit ce qu'elle a créé.

Ils ne sont pas des tests : ils parlent à la vraie API, et à travers elle aux vraies plateformes.

## Avant de lancer un scénario

1. L'API tourne en local : `pnpm start:dev` dans `backend/`, les migrations passées
   (`pnpm migration:run`).
2. Ton jeton, depuis le Swagger (`http://localhost:3002/documentation`) : clique sur _Authorize_,
   connecte-toi, exécute n'importe quelle route, et copie dans la boîte _Curl_ ce qui suit
   `Authorization: Bearer `. Puis, dans ton terminal — **jamais dans le chat** :

   ```sh
   read -rs OMNIPOTENT_TOKEN && export OMNIPOTENT_TOKEN
   ```

   colle, puis Entrée. Le jeton expire au bout de quelques heures : refais-le quand l'API répond 401.

3. Ton Organization : `export OMNIPOTENT_ORGANIZATION_ID=<son id>`, celui que tu mets dans
   l'en-tête `x-organization-id` du Swagger.

## `campagne-google.mjs` — une campagne Google à 10 €

Les preuves du lot 3a (`backend/docs/phase-10.md` § 8.6), aux règles du § 1 : **10 € au total**,
lancée **puis mise en pause aussitôt**.

```sh
export SCENARIO_SITE=https://…        # le vrai site de la marque : Google examine la page
node scenarios/campagne-google.mjs    # crée tout et lit la preview — rien ne part chez Google
node scenarios/campagne-google.mjs --lancer   # pareil, puis lance et met en pause aussitôt
```

Il relie la marque au compte Google connecté, crée la campagne (une semaine, départ demain à 9 h),
son levier Search avec un lien annexe et deux accroches, un AdGroup en CPC manuel à 0,50 €, le
ciblage France et 20 km autour de Paris, des mots-clés, un logo carré, deux annonces et leurs Lines,
puis lit la preview. Avec `--lancer`, il suit ensuite la synchronisation et affiche ce que Google a
créé.

Facultatif : `OMNIPOTENT_ADVERTISER_ID` quand l'Organization a plusieurs marques — le script les
liste —, `SCENARIO_MOTS_CLES` (séparés par des virgules), `OMNIPOTENT_URL` pour une autre API.
