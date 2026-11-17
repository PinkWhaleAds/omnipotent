# CLAUDE.md

Guidance for Claude Code when working in this repository.

## The project

Omnipotent is a **multi-platform media buying API**: it runs advertising campaigns across the six
levers `search`, `dooh`, `audio`, `social`, `ctv_tvs` and `dac` from one interface. How many platforms
they cover is decided in `CADRAGE.md` §6 and moves (GAM left on D50): never hardcode the count.

`CADRAGE.md` is the reference of the project — the hierarchy, the budget algebra, the lever profiles,
the conventions and **every decision already taken** (D…, T…, and R… in `backend/docs/reporting.md`).
Read it before starting a phase, and never reopen a decision without saying so. `A-FAIRE.md` holds
what depends on Lorin (accounts, access, readings on a real account, product calls): add to it rather
than guessing.

The reference projects it draws from:

- **`~/OmniAd/multi-search`** — **ours**, and therefore freely reusable. It has 36 phases of hardened
  conventions; this repository's socle is a transcription of its own. Its front and back are frozen
  (D30).
- **`~/PinkWhale/omnipass`** — the identity and tenancy service, built in parallel (T1). It owns
  `User`, `Seat`, `Organization` and the memberships; **nothing here does**. Its repository is
  `PinkWhaleAds/omnipass`, under the GitHub account the group moved to on 2026-11-17, which a separate
  SSH key reaches (`git@github-pinkwhale:`). Its contract with this repository is `docs/consuming.md`
  (the wiring, the Auth0 prerequisites, the error table) and `docs/architecture.md` (the invariants),
  and it is binding: a signature that gets in the way is raised with Lorin, never adapted locally.
  `docs/message-socle-omnipotent.md`, which used to hold it, is deleted.
- **`~/OmniAd/mbp`** and `meta-dsp-lib` — **Azerion's**. They are read to understand, and **never
  copied** (D36).

Documentation in French, **code and JSDoc in English**.

## Layout

```
backend/        the API, the MCP server and the job workers (see backend/CLAUDE.md)
infra/          the AWS infrastructure in Terraform (see infra/README.md)
docs/           the framing documents (cadrage-*.md) and the handovers (handover-*.md)
```

A pnpm monorepo without a `frontend/`: Omnipotent has no front end of its own yet (CADRAGE §21), and
after the switch multi-search's front consumes it (§18).

## Where a thing belongs

The socle (`backend/src/{configs,constants,types,utils,plugins,server,services,database,jobs,mcp}`,
`backend/src/modules/{health,status,oauth}`) is what **would be identical in any Fastify project of
Omnilor**. Everything else belongs to a phase:

- a domain entity, its migration, its service, its routes and its MCP tools → the phase of that
  resource;
- what one advertising platform accepts → `backend/src/platforms/platform-rules.ts`, in the phase of
  that platform; the rest of the code **never tests a platform name**;
- a job → `backend/src/jobs/index.ts`, with the service it calls;
- a credential → a container declared in `infra/envs/prod/main.tf` (`module "secrets"`), its value
  put in Secrets Manager by hand, never through Terraform.

The tenancy is omnipass's, always: a table here holds `organizationId` and `userId` as **opaque
uuids**, with no foreign key across the two databases (T4), and omnipass is their only writer (T5).

## Identity and rights: omnipass owns them

`AccessService` (`backend/src/services/access.service.ts`) is the **only door to omnipass**, and its
interface is **the contract of the two projects**, frozen signature by signature:
`docs/consuming.md` of `PinkWhaleAds/omnipass`. Read it before touching anything on this path.
omnipass publishes `@pinkwhaleads/omnipass-client` with exactly these signatures, so wiring it replaces
one line and nothing in the domain.

What this repository **never** carries: a `User`, `Seat`, `Organization`, membership or invitation
entity; an `IdentityService`; a role model of its own. Resolving an Auth0 `sub` into a user needs
omnipass's `users` table, and omnipass is its only writer (T5).

The split on a request:

- the **token is verified here**, locally, against the tenant's public keys and for the route's
  audience;
- the **identity is resolved there**: the auth plugin calls `accessService.resolve(sub, token)` once,
  relaying the user's token so omnipass acts with **their** rights, never with the application's;
- the snapshot it brings back (`Snapshot`: the user, their Seats, their Organizations, their roles)
  sits on `request.auth`, and **every `assert*` is pure computation** on it — a permission check
  costs no network call. No right travels in the token (T3).

The package is installed (phase 1) and `ACCESS_PROVIDER` picks the implementation: `omnipass` builds
the real client, reading its machine account's secret from the store. `local` is still there, and
still a **stub** rather than a tenancy — a fixed actor from the environment (`DEV_ACTOR_*`), `admin`
of every Organization, no membership read, a loud warning at startup — for a developer with no
omnipass at hand, and because omnipass has yet to declare our audiences in its registry. D43's guard
holds either way: with `NODE_ENV=prod` and anything but omnipass, startup **fails** through
`killProcess`. If a stub stops being enough for a phase, the answer is to resolve through omnipass,
**never** to add tables here.

Three rules that bind every later phase:

- **Writing the tenancy goes through the package**, never through an HTTP call written by hand:
  `client.tenancy.inviteOrganizationMember(...)`, `createOrganization(...)`, `acceptInvitation(...)`,
  one method per route. Each successful write invalidates the user in the local cache on its own. A
  hand-written call would skip that, so if you ever write one, call `invalidateUser` behind it.
- Those writes are authorised by the **relayed user's** role, never by the machine account: a machine
  caller has no Organization role, by construction.
- The errors omnipass raises are an `OmnipassError` carrying `statusCode`, `code`, `params` and the
  aliases `errorCode` / `errorParams` the error handler already reads: they cross the API **as they
  are**, with no adapter. They are catalogued in `backend/docs/error-codes.md`.

## The conventions, without discussion

They come from `CADRAGE.md` §19 and from `~/OmniAd/multi-search/backend/CLAUDE.md`, which
`backend/CLAUDE.md` transcribes. The short version:

- **Zod is the single source of truth** of every request and response shape, in
  `src/types/<resource>.types.ts`, turned into JSON Schema by `toJsonSchema(...)`.
- **Every input schema is strict** — `z.strictObject`, never `z.object` — for a body, a querystring,
  a param and an MCP tool's arguments. A field the route does not declare answers
  `validation_failed` (rule `additionalProperties`) rather than being dropped in silence:
  `?sort=name` instead of `?sortBy=name` would otherwise return a list sorted by default, a bug
  nobody sees. The exception is a **headers** schema, since a request carries many headers of its own.
- **controller / handler / schema**, for HTTP **and** for MCP. Never collapsed, never another kind of
  file.
- **One error shape**, built in one place, with a **stable code** and the values of its message.
- **Rights checked in the services**, never in a handler, so HTTP, MCP and jobs share the same rules.
  404 for what the caller cannot see, 403 for a role too low.
- Services return **API shapes**, never entities.
- **Migrations only**, never `synchronize`.
- Amounts in **integer cents** in every computation.
- **One process per container**, no `cluster`.
- **100 % unit test coverage**, and never a call to a platform in a test.

Decided and **waiting for the phase that needs them**, not in the socle: a connection pooler past a few
replicas (D44), a rate limiter shared between replicas, per platform, since the quotas are the whole
project's (D45), a per-campaign lock for the sync (D46), a jitter on the pacing refresh at local
midnight (D47) and a read replica for the reports (D48).

## Working in this repository

- A phase is delivered on its own and leaves the checks green: `pnpm install && pnpm build`,
  `pnpm test:cov` at 100 %, `pnpm lint:check`, `pnpm prettier:check`, `pnpm test:integration`, and
  `terraform fmt -check -recursive` + `terraform validate` + `terraform test` in `infra/`.
- The plan of the phases is `backend/docs/plan.md`; a phase has its own `backend/docs/phase-N.md`.
- Error codes are documented in `backend/docs/error-codes.md`: the web front end is in French and
  translates `code` + `params`, so a code is part of the contract.
- **Deduce nothing silently.** Present a deduction to Lorin, numbered, for validation.
- **Never write a count** of decisions, phases or platforms in a document or a comment: those numbers
  move, and a number written down goes stale without anyone seeing it.
