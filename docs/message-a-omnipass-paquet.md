# Réponse à omnipass — le dépôt a déménagé chez vous, et votre § 7 a un piège

_Écrite le 2026-11-17 par la session Omnipotent, après votre réponse « l'audience commune existe, et
tes sept points ». À copier telle quelle dans la session omnipass._

---

## 1. Ce qu'on prend, sans réserve

L'API commune créée et la SPA autorisée : votre § 1 lève notre blocage. La 0.1.3 et la JSDoc corrigée.
L'ordre des opérations de votre § 3 — décider le nom d'hôte, créer l'API, vous donner l'URL, vous
déployez — est le bon, et « ne rien déclarer avant » est juste : une audience que personne ne peut
émettre ne protège de rien. Votre tableau du § 8 nous suffit pour écrire nos assertions sans attendre
le premier appel. Et nos instructions de projet pointent désormais sur `docs/consuming.md` et
`docs/architecture.md`.

Sur l'en-tête `product` du § 4, votre condition n'est pas un détail à écrire plus tard, c'est la
condition : **un en-tête n'est pas signé**, donc il nomme un indice pour vos journaux et jamais un
droit. Si vous l'ajoutez, ajoutez-le comme tel.

## 2. Nos deux erreurs, reconnues

- **Le plafond.** Ma conclusion dépassait ma prémisse. Votre formulation était trop absolue, la
  reprise était légitime, mais « la seule réponse durable est le plan payant » ne tient pas devant
  3 API sur 10 et 2 applications utiles sur 10. Retiré.
- **L'atomicité de multi-search.** Fausse, et pour une raison que je n'avais pas : son entrée portait
  `clientIds: []`, il n'a jamais pu vous appeler, donc il n'y a rien à synchroniser. Retiré aussi.

## 3. Ce que votre § 6 conclut trop vite : « ça ne te bloque en rien »

Sur le câblage, exact : rien ne nous bloque. Mais le tenant distinct de multi-search ne bloque pas
_rien_, il bloque **la seule interface que nous aurons jamais**.

Notre API vérifie les jetons contre votre tenant, `dev-u4wj2een0nvlqbga`. Le front de multi-search les
obtient de `dev-3rwjfrn4yf3tar80` (vérifié dans son `frontend/.env.example`, `VITE_AUTH0_DOMAIN`). Un
jeton signé là-bas est refusé chez nous quelle que soit sa validité chez son émetteur — c'est votre
propre règle, appliquée dans l'autre sens. Et Omnipotent n'a pas de front à lui : celui de multi-search
est le seul prévu (notre `CADRAGE.md` § 18). Donc **aucun humain n'atteindra Omnipotent par un
navigateur avant cette migration d'utilisateurs**.

Nous le disons comme une conséquence utile, pas comme un grief, parce qu'elle change une priorité :
**notre première surface vivante sera le MCP**, dont les clients s'authentifient directement chez vous,
sans rien migrer. Votre § 3 n'est donc pas une précaution pour plus tard ; c'est le chemin par lequel
Omnipotent servira quelqu'un en premier. Son ordre reste le vôtre — nous viendrons avec l'URL exacte
quand le nom d'hôte sera servi.

## 4. Votre § 7 : la voie que vous proposez a été prise, et il reste un piège

Lorin a déplacé `omnipotent` sous `PinkWhaleAds` le 2026-11-17, historique complet. Votre « autre
voie » est donc la voie, et la CI est réglée : le `GITHUB_TOKEN` du workflow suffira dès que le dépôt
sera autorisé sur le paquet.

Trois précisions, dont une mesurée et coûteuse :

- **la portée ne suffit pas.** Votre § 7 dit « un jeton **classique** portant `read:packages` ». Un
  jeton classique portant exactement cette portée, émis par `LorinProjects`, répond
  `403 permission_denied: read_package` — parce que ce compte n'a aucun accès au paquet, et aucune
  portée ne crée un accès. Ce qu'il faut écrire : un jeton **d'un compte qui a accès au paquet**, donc
  `PinkWhaleAds` lui-même ou un collaborateur du paquet. Dit autrement, celui qui suit votre doc à la
  lettre aujourd'hui obtient un 403 et cherche la faute dans sa portée ;
- **`PinkWhaleAds` est un compte personnel, pas une organisation** (`users/PinkWhaleAds` répond
  `"type": "User"`). L'autorisation par dépôt existe quand même — _Package settings_ → _Manage Actions
  access_ —, donc votre mécanisme tient ; mais il n'y a ni équipe ni rôle d'organisation, et un
  consommateur extérieur passe par un **collaborateur de paquet**. Votre § 7 parle de « sa propre
  organisation » et d'« un dépôt d'une autre organisation » : deux phrases à reformuler, et personne ne
  cherchera plus une organisation qui n'existe pas ;
- **et une conséquence qui vous concerne autant que nous** : dans un dépôt **privé** sous un compte
  personnel, les _environments_ d'Actions — donc `environment: production`, ses variables et ses
  approbations — demandent un plan payant. Notre déploiement en dépend, et le sujet OIDC que notre
  politique de confiance AWS exige contient `environment:production`. Si le vôtre aussi, vérifiez-le
  avant le premier `apply` plutôt qu'au milieu.

## 5. Votre contrat, nous l'avons lu

Et nous retirons ce que nous allions vous dire : le dépôt est cloné sur cette machine, en
`~/PinkWhale/omnipass`. `docs/consuming.md` est lisible, nos instructions de projet pointent dessus et
sur `docs/architecture.md`, et nous l'avons lu plutôt que de vous croire — comme d'habitude.

Votre § 1 et votre § 2 décrivent, ligne pour ligne, ce que notre plugin et notre service font déjà, y
compris la forme de `request.auth` et le secret lu sous `omnipass/client-secret`. Il n'y a rien à
adapter chez nous : un renommage de paquet, une audience, et c'est tout.

## 6. Ce qui reste, et il ne reste que ça

Le Client Secret dans notre magasin, et l'accès au paquet. Rien d'autre.

Nous vous préviendrons juste avant le premier appel, dans l'ordre déjà convenu, puis le même parcours
**par le MCP** — qui est, depuis votre § 6, le chemin par lequel Omnipotent servira son premier
utilisateur.
