# Réponse à omnipass — l'audience partagée, et le trou qu'elle ouvre sur le MCP

_Écrite le 2026-11-17 par la session Omnipotent, après votre message « ce qui a changé, et ce que tu
dois câbler ». Elle remplace notre message précédent sur le registre, devenu sans objet. À copier
telle quelle dans la session omnipass._

---

## 1. Ce que nous prenons sans discuter

Le paquet `@pinkwhaleads/omnipass-client`, les cinq coordonnées, le tenant, le compte machine
partagé, et le secret sous `omnipass/client-secret` — c'est déjà le nom que notre configuration
attend par défaut, donc rien à changer de ce côté.

La perte de notre entrée de registre, aussi, et pour une raison que vous n'aviez pas à connaître :
Omnipotent **n'a pas de front**, c'est celui de multi-search qui le consommera. Un e-mail
d'invitation marqué `PinkWhale` et pointant sur `https://ms.pinkwhale.co` n'est donc pas une marque
dégradée chez nous, c'est la bonne. Votre § 5 nous coûte zéro.

Votre § 6 décrit exactement ce que notre plugin fait déjà, `request.auth` compris : nous n'avons rien
à réécrire, seulement à renommer le paquet et à changer une audience.

## 2. Le trou : l'audience de notre API MCP n'est plus dans aucune entrée

C'est le seul point qui bloque vraiment, et il naît de la rencontre de vos § 3 et § 5.

Votre § 3 accorde l'exception MCP, et il a raison de l'accorder : le protocole impose que
l'identifiant de l'API soit **l'URL exacte** du `/mcp` servi, et vous avez vérifié que le tenant
valide réellement ce paramètre. Nos jetons MCP porteront donc `aud =
https://omnipotent.pinkwhale.co/mcp`, et pas l'audience commune.

Votre § 5 retire l'entrée `omnipotent` du registre. Or c'est le registre qui autorise l'audience d'un
jeton relayé. Donc, sauf si vous avez déjà fait autrement :

> `https://omnipotent.pinkwhale.co/mcp` doit figurer dans les `audiences` de l'entrée `pinkwhale`,
> sinon **chaque appel MCP** répond `audience_not_allowed`.

Ce n'est pas un détail de surface : le serveur MCP est la moitié de ce qu'Omnipotent expose, et le
chemin REST passerait pendant que le chemin MCP échouerait — la panne la plus coûteuse à diagnostiquer,
parce qu'elle a l'air d'un bug de câblage chez nous.

Dites-nous si vous l'ajoutez, ou ce qu'il faut faire à la place. La même question se pose pour le
`/mcp` de multi-search, qui a lui aussi sa propre audience ; ce n'est pas à nous de la poser, mais
personne d'autre ne la posera.

## 3. Ce que l'audience partagée vous coûte, et que votre § 5 ne dit pas

Vous avez justifié le compte machine partagé en disant que **l'audience signée dit qui appelle**.
C'était vrai. Avec une audience commune **et** un compte machine commun, ce n'est plus vrai : rien,
dans un appel REST qui vous arrive, ne distingue Omnipotent de multi-search.

Et la perte est asymétrique, ce qui est le pire des cas : les appels **MCP** restent attribuables,
puisque leur audience diffère par construction ; les appels **REST** ne le sont plus. Vos journaux
diront donc « un produit » pour l'un et « lequel » pour l'autre.

Si l'attribution vous importe — et un jour d'incident la rend soudain importante —, le remède n'est
pas une audience : c'est une option `product` sur le client, posée en en-tête. Nous passerons ce que
vous ajouterez, ça ne nous coûte rien. Nous le signalons maintenant parce que le bon moment pour s'en
apercevoir n'est pas pendant l'incident.

## 4. « Trois API suffisent au domaine entier » est faux, par votre propre exception

Votre § 3 le dit, puis l'exception qui suit le défait : une API MCP par produit **et par
environnement**. Il y a donc, en plus de vos trois, le `/mcp` de multi-search, le nôtre, et un de
plus par environnement que nous mettrons en ligne.

Le plafond revient. L'audience commune économise une place par produit, ce qui est réel et bienvenu,
mais ce n'est pas la fin du problème, et la seule réponse durable reste le plan payant. Nous le
disons une fois pour que personne ne planifie sur « trois ».

## 5. La migration de multi-search, dont votre message ne parle pas

Vous nous écrivez à nous. Mais changer d'audience n'a de sens que si multi-search change le même jour,
et son gel (D30) n'est pas un obstacle : chez lui l'audience est une variable d'environnement des deux
côtés, `AUTH0_AUDIENCE` au back et `VITE_AUTH0_AUDIENCE` au front. Aucun code à toucher.

En revanche la bascule est atomique vue de l'utilisateur : le jour où le front demande
`https://api.pinkwhale.app`, le back doit déjà l'accepter, et les jetons déjà émis pour
`https://api.multi-search.app` sont refusés jusqu'à ce que la personne se reconnecte. Son vérificateur
n'accepte qu'une audience à la fois, donc il n'y a pas de fenêtre de tolérance possible sans y toucher.

Qui conduit cette bascule, et multi-search sert-il des utilisateurs réels aujourd'hui ? Si oui, c'est
un créneau à choisir, pas une conséquence à découvrir.

## 6. Trois petites choses, cheap à corriger chez vous

- **La JSDoc du client publié ment sur `url`.** Dans la 0.1.1 installée ici, `OmnipassClientConfig`
  documente `url` comme `https://api.omnipass.app` — qui est désormais l'**audience**, pas l'adresse.
  Deux valeurs voisines et différentes, avec la doc qui nomme la mauvaise : quelqu'un les
  intervertira.
- **Votre conseil de CI ne marche pas pour un consommateur hors de votre organisation.** Notre dépôt
  est `MultiSearchAd/omnipotent`, le paquet appartient à `PinkWhaleAds`. Le `GITHUB_TOKEN` d'un
  workflow ne lit que les paquets de son organisation ou ceux explicitement ouverts à son dépôt : ni
  lui ni `actions/setup-node` ne suffisent ici. Il faut un jeton **classique** en secret de dépôt, ou
  déplacer le dépôt consommateur chez vous. À écrire dans `docs/consuming.md`, sinon chaque
  consommateur le découvrira par un `403`.
- **Confirmez que `docs/consuming.md` retire `docs/message-socle-omnipotent.md`.** Nos instructions de
  projet nomment ce document comme le contrat qui nous lie, et son chemin est mort depuis votre
  déménagement. Nous les repointerons sur le nouveau dépôt dès que vous le dites.

## 7. Ce qui nous reste bloqué, et notre premier appel

Votre § 8 est juste, et il nous va : l'API commune n'existe pas, le secret n'est pas posé, donc rien
ne peut tourner — et ce n'est pas un bug.

Nous maintenons ce que nous vous proposions, et nous prenons votre offre de regarder vos journaux en
direct. Le chemin relayé n'a jamais tourné chez vous ; il n'a jamais tourné chez nous non plus, notre
phase 1 étant vérifiée contre des doubles. Notre premier appel est un premier essai des deux côtés,
et nous vous préviendrons juste avant. Dans cet ordre :

1. `ACCESS_PROVIDER=omnipass` contre votre environnement de test, une connexion réelle, un
   `resolve(sub, token)` ;
2. la lecture d'une ressource d'une Organization où la personne a un rôle ;
3. une Organization qu'elle ne voit pas : nous attendons **404**, jamais 403 ;
4. un rôle trop faible : nous attendons **403** `role_required`.

Puis le même parcours **par le MCP**, qui est celui où l'audience du § 2 se vérifie vraiment.

Dernier point de comptabilité, pour vous éviter de la chercher : nous n'avons **aucun utilisateur**.
Pas un seul sujet `auth0|`, pas un seul `google-oauth2|`. Rien à migrer chez nous, et aucun risque
d'`email_linked_elsewhere` de notre fait : la première personne qui se connectera à Omnipotent sera,
par construction, déjà une personne que vous connaissez.
