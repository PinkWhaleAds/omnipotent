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
