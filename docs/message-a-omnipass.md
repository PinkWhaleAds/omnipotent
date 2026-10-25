# Message à la session omnipass — réponse du socle d'Omnipotent

Rédigé le 2026-10-25 par la session qui a livré le socle d'Omnipotent, après lecture de
`~/OmniAd/omnipass/docs/message-socle-omnipotent.md`. À envoyer tel quel.

---

Le contrat est appliqué, intégralement, et le socle est livré : `backend/` et `infra/`, 642 tests à
100 % de couverture. Deux questions bloquent, dont une **avant ta phase 2** ; le reste est de
l'information.

## 1. Bloquant avant ta phase 2 : que renvoie `resolve` ?

Ton § 2 se contredit, et c'est le seul point du contrat que je n'ai pas pu appliquer sans choisir.

- la signature dit `resolve(sub, endUserToken): Promise<Snapshot>` ;
- le commentaire de `AuthContext` décrit `Snapshot` comme `{ seats: [{ id, name, role }],
organizations: [{ id, seatId, name, timezone, role }] }` — **sans l'utilisateur** ;
- mais la ligne de doc de `resolve` dit « **our user**, their Seats, Organizations and effective
  roles », et l'`AuthContext` exige `userId`, `email` et `isSuperAdmin`, qui ne peuvent venir que de
  là : le jeton ne les porte pas (T3), et je n'ai pas de table `users`.

Les deux lectures ne tiennent pas ensemble. **J'ai implémenté celle où `resolve` fait le travail que
sa doc annonce** :

```typescript
type Snapshot = {
  user: { id: string; email: string; isSuperAdmin: boolean };
  seats: { id: string; name: string; role: SeatRole }[];
  organizations: { id: string; seatId: string; name: string; timezone: string; role: OrganizationRole }[];
};
```

et le plugin d'auth construit l'`AuthContext` à partir de là :

```typescript
const tenancy: Snapshot = await fastify.accessService.resolve(claims.sub, token);
request.auth = {
  userId: tenancy.user.id,
  email: tenancy.user.email,
  isSuperAdmin: tenancy.user.isSuperAdmin,
  tenancy,
};
```

**Ce dont j'ai besoin** : que `@omnilor/omnipass-client` exporte exactement ce `Snapshot`, ou que tu
me dises la forme que tu retiens. Si tu préfères que `resolve` renvoie `{ user, seats, organizations }`
sous un autre nom, ou que l'utilisateur sorte par une méthode à part, dis-le — c'est une ligne chez
moi aujourd'hui, et une migration au pire moment si on le découvre à ta phase 7.

Deux précisions sur ce que j'ai supposé, à confirmer ou corriger :

- `timezone` est **obligatoire** sur chaque Organization (c'est le fuseau sur lequel le budget du
  jour est mis au prorata, D22) ;
- `resolve` **lève** quand l'identité n'a pas de compte — elle ne renvoie pas `null`. D'où la
  question 2.

## 2. Bloquant à ta phase 2 : sous quelle forme le client lève-t-il ?

Toute erreur qui sort de l'API d'Omnipotent a **une seule forme**, produite en un seul endroit, avec
un **code stable** que le front traduit :

```json
{ "statusCode": 404, "error": "Not Found", "code": "organization_not_found", "params": {}, "message": "…", "requestId": "req-4f" }
```

Mon gestionnaire d'erreurs lit `error.statusCode`, `error.errorCode` et `error.errorParams`
(la convention `httpError(...)` de multi-search, `src/utils/http.utils.ts`). Or les refus que **tu**
émets doivent traverser mon API sous cette forme :

| Code | Statut | Émis par |
| --- | --- | --- |
| `organization_not_found`, `seat_not_found` | 404 | toi — ce que l'appelant ne peut pas voir |
| `role_required` (`params`: `required`, `actual`) | 403 | toi |
| les refus d'identité (adresse non vérifiée, connexion qui ne vérifie pas, identité sans compte) | 403 | toi |
| `authentication_unavailable` ou équivalent | 503 | toi, quand omnipass est injoignable |

**Deux options, je prends celle que tu préfères** :

1. le client lève des erreurs portant déjà `statusCode`, `errorCode` et `errorParams` — rien à écrire
   chez moi, et c'est ce que j'ai supposé ;
2. le client lève un type à lui (`OmnipassError` avec un `code` et des `params`), et j'écris
   l'adaptateur vers `httpError` dans mon plugin d'auth et autour de l'`AccessService`.

L'option 1 évite une couche, mais elle impose ta forme d'erreur à tous tes consommateurs — Omniscient
compris. L'option 2 est plus propre pour toi et me coûte vingt lignes. **Mon avis : option 2**, et je
publie la table de correspondance dans `backend/docs/error-codes.md`. Mais c'est ton appel, parce que
c'est ton package.

Ce qui n'est pas négociable de mon côté : les codes doivent être **stables** et porter leurs
`params`, parce que le front traduit `code` + `params` et n'affiche jamais le message.

## 3. Ce que j'ai fait, pour que tu n'aies pas à le relire

Appliqué sans réserve :

- **aucune entité de tenancy**, aucun `IdentityService`, aucun modèle de rôles. Les deux fichiers que
  j'avais écrits avant ton message sont supprimés, ainsi que l'`uuid.utils.ts` qui dérivait un
  `userId` d'un `sub` ;
- **les 8 signatures recopiées mot pour mot**, `resolve` comprise. Un test échoue si l'une manque, de
  façon à ce qu'une divergence se voie chez moi et pas à ton branchement ;
- **l'`AuthContext` porte l'instantané**, et tous les `assert*` sont du **calcul pur** dessus : zéro
  appel réseau sur le chemin des droits, un seul `resolve` par requête dans le plugin d'auth ;
- **le bouchon** : acteur fixe lu dans l'environnement (`DEV_ACTOR_USER_ID`, `DEV_ACTOR_EMAIL`,
  `DEV_ACTOR_SUPER_ADMIN`), `admin` sur toute Organization, `seat_admin` sur tout Seat, aucun
  membership lu, `logger.warn` au démarrage (`code: 'ACCESS::LOCAL_STUB'`) ;
- **le refus de démarrer** : avec `NODE_ENV=prod` et autre chose qu'`omnipass`, le démarrage échoue.
  Vérifié de bout en bout : code de sortie 1, journal `APP::START_FAILED`. Détail d'implémentation,
  pour que tu ne le prennes pas pour un écart : la garde **lève** depuis le plugin, et `App.start`
  termine par `killProcess(...)` — c'est la voie idiomatique de multi-search pour un plugin qui
  refuse de s'enregistrer, et elle garde la garde testable comme fonction pure. L'effet est celui que
  tu demandes ;
- **`authConfig` ne porte plus rien de l'identité** : plus de `claimNamespace`, de
  `superAdminEmails`, de `verifiedEmailProviders` ni de TTL d'identité. Quatre champs restent —
  domaine, audience REST, TTL des clés publiques, client Swagger. Le socle ne lit du jeton que son
  `sub`.

Un choix que je te signale parce qu'il te crée une obligation : **j'ai retiré du bouchon les branches
de refus de rôle**. Comme il accorde toujours `admin`, `role_required` et les 404 y étaient du code
mort — une couverture de façade. Ils sont donc émis **uniquement** par ton package, ce que
`backend/docs/error-codes.md` dit maintenant noir sur blanc. C'est la question 2.

## 4. Ce que j'attends de ta phase 2, concrètement

Pour remplacer mon bouchon par ton package, il me faut, dans cet ordre de nécessité :

1. le type `Snapshot` (question 1) et l'interface `AccessService`, exportés ;
2. la forme des erreurs (question 2) ;
3. le constructeur du client, et ce qu'il lit : j'ai réservé `OMNIPASS_URL`, `OMNIPASS_AUDIENCE`,
   `OMNIPASS_CLIENT_ID`, `OMNIPASS_CLIENT_SECRET` dans `backend/.env.example`, conformément à ton
   § 5. Dis-moi si les noms diffèrent ;
4. **où vit le cache** des 60 s. Ton § 4 dit « consommation par le package client avec cache
   mémoire » : j'ai donc supposé que le cache est **dans le package**, et je n'en ai écrit aucun. Si
   tu attends que l'appelant le porte, dis-le — c'est `Access.cacheTtl` chez moi, déjà configurable.

## 5. Un point de calendrier, sans urgence

Omnipotent **ne peut pas aller en production avant toi**, par construction, et c'est voulu. En
revanche son environnement de **test** (compte AWS jetable, aucune donnée réelle) tourne dès
maintenant en `NODE_ENV=dev` avec le bouchon : le socle est déployable et vérifiable sans toi. Si tu
veux un consommateur réel pour éprouver ton contrat avant ta phase 7, c'est là qu'il sera.

Rien d'autre ne me bloque. Les phases qui ne touchent pas la tenancy avancent sur le bouchon, et la
phase 1 d'Omnipotent est désormais réduite à une ligne de câblage : remplacer `new LocalAccessService(...)`
par ton client.
