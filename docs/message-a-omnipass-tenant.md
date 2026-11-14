# Message à la session omnipass — le tenant Auth0 a changé

_Écrit le 2026-11-14 par la session Omnipotent. À copier tel quel dans la session omnipass._

---

Lorin a créé un **nouveau tenant Auth0** le 2026-11-14, et il a tranché : **tout le monde y
déménage** — omnipass, multi-search, Omnipotent.

Ce n'est pas une préférence, c'est votre propre règle qui l'impose : `backend/docs/plan.md` § 14 dit
qu'omnipass vérifie la **signature** du jeton relayé avec le JWKS du **tenant partagé**. Deux tenants,
et chaque jeton qu'un consommateur vous relaie est refusé. Il n'y a donc pas de déménagement partiel
possible.

## Ce qui est mort, et qu'il ne faut pas recopier

Ces valeurs sont enregistrées dans votre `A-FAIRE.md` et dans votre configuration ; elles ne valent
plus rien :

| Valeur                               | Ce qu'elle était                         |
| ------------------------------------ | ---------------------------------------- |
| `dev-3rwjfrn4yf3tar80.eu.auth0.com`  | le domaine du tenant                     |
| `tkSxRukHoCBTTNd616lsiF8Fqb7RpQbv`   | le compte machine partagé                |
| `qUq67lX2piWp4RJSNlSMqOtW51Y2VHBy`   | l'application navigateur de multi-search |

Nous avons retiré les nôtres de notre `A-FAIRE.md` le même jour. Une valeur morte qui traîne dans un
document est pire qu'une valeur absente : elle se recopie sans qu'on se demande d'où elle vient.

## Ce qu'il y a à refaire de votre côté

Dans cet ordre, parce que la première bloque tout le reste :

1. **L'Action post-login**, qui ajoute l'adresse e-mail aux access tokens sous l'espace de noms
   `https://omnilor/`. Sans elle, **aucune première connexion n'aboutit**, pour aucun produit. C'est
   le point 3 de votre `A-FAIRE.md`, et vous êtes les seuls à en avoir le code.
2. Votre **API REST** (`https://api.omnipass.app`) et votre **API MCP par environnement** — l'API MCP
   de l'environnement de test portait l'adresse CloudFront de cet environnement, elle est donc à
   recréer avec la même règle : l'identifiant est l'URL exacte du `/mcp` servi.
3. Votre **compte machine**, et l'autorisation du nôtre sur votre API (voir la question ci-dessous).
4. L'**application navigateur** listée dans le `User-delegated access` de chacune de vos API. C'est la
   leçon que vous aviez payée en mise en service ; elle vaut à nouveau sur un tenant neuf.
5. Votre **configuration** : `AUTH0_DOMAIN` dans `.env`, `.env.example`, votre infrastructure et vos
   variables de déploiement.
6. Le **registre des consommateurs**, où Omnipotent s'ajoute (ci-dessous).

## Ce que nous faisons de notre côté

Nous créons l'application navigateur `Omnilor Web` (une seule pour les deux fronts), nos trois API —
`https://api.omnipotent.app`, `http://localhost:3002/mcp`, `https://omnipotent.omnilor.com/mcp` — et
notre compte machine. Le détail clic par clic est dans notre `docs/runbook-acces.md` § A2, si ça vous
sert pour le vôtre.

**Ce que nous vous demandons**, et qui n'a pas changé : ajoutez Omnipotent à votre registre
(`backend/config/default.json`) avec nos deux audiences de production — `https://api.omnipotent.app`
et `https://omnipotent.omnilor.com/mcp` — et notre URL de front, qui est celle de multi-search
(`https://app.omnilor.com`) puisque c'est son front qui nous consommera après la bascule.

## Une question, parce que le budget d'entités est neuf

Sur l'ancien tenant, le plan gratuit avait épuisé les applications, et vous aviez changé votre
conception pour qu'**un seul compte machine** serve plusieurs produits — l'audience signée du jeton
relayé disant lequel appelle.

Un tenant neuf repart avec dix applications et dix API. Nous proposons donc que **chaque produit ait
son propre compte machine** : son `client_id` nomme l'appelant dans vos journaux, et une rotation de
secret n'affecte qu'un produit. Votre conception le permet déjà, puisqu'elle ne s'appuie pas sur
l'identité du compte mais sur l'audience.

Si vous préférez garder le compte partagé, dites-le : nous prendrons le vôtre, et nous n'en créerons
pas.

**À garder en tête quand même** : dix places se remplissent vite à trois produits qui ont chacun une
API REST et une API MCP **par environnement**. Le plafond reviendra, et la seule réponse durable est
le plan payant.
