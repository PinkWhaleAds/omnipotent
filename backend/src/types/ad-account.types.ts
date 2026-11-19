import { z } from 'zod';

import { paginatedSchema } from './api.types';
import { listQuerySchema } from './crud.types';
import { platformSchema } from './platform.types';

/** Fields a list of ad accounts may be sorted on; the first is the default. */
export const AD_ACCOUNT_SORTABLE_FIELDS = ['name', 'createdAt', 'updatedAt'] as const;

/**
 * Where a connected account stands (`../../CADRAGE.md` § 12).
 *
 * A connected account is not a usable account: most platforms ask the client to accept the access
 * first. `pending` is waiting for them, `active` is usable, `invalid` is anything that stopped it.
 */
export const adAccountStatusSchema = z.enum(['pending', 'active', 'invalid']);

/** TypeScript type inferred from {@link adAccountStatusSchema}. */
export type AdAccountStatus = z.infer<typeof adAccountStatusSchema>;

/**
 * Why an account is not `active`, with a **stable code** the front translates.
 *
 * `link_requested` is the only reason of a `pending` account; the others say what ended the access.
 * `manager_account` is an account that turned out, once accepted, to be itself a manager account,
 * which runs no campaign (`docs/phase-10.md` § 4.6).
 */
export const adAccountStatusReasonSchema = z.enum([
  'link_requested',
  'link_declined',
  'link_expired',
  'link_revoked',
  'credentials_rejected',
  'manager_account',
]);

/** TypeScript type inferred from {@link adAccountStatusReasonSchema}. */
export type AdAccountStatusReason = z.infer<typeof adAccountStatusReasonSchema>;

/** ISO 4217 code of the currency a platform account is bought in. Only the shape is checked. */
const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'A currency is an ISO 4217 code, e.g. EUR');

/** IANA timezone the days of the platform are counted in, checked against what this runtime knows. */
const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((zone: string): boolean => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown IANA timezone');

/** An identifier a platform gives: a customer id, a partner id, an advertiser id. */
const externalIdSchema = z.string().trim().min(1).max(128);

/**
 * What a platform requires **above** the account itself: a DV360 partner, an Amazon profile.
 *
 * A flat record of scalars, because what goes in it belongs to each platform and the model does not
 * pretend to know it: the phase of a platform declares in its registry what it reads here, and
 * refuses what it misses (`../../CADRAGE.md` § 12).
 */
export const adAccountScopeSchema = z.record(z.string().min(1).max(64), z.union([z.string().max(256), z.number()]));

/** TypeScript type inferred from {@link adAccountScopeSchema}. */
export type AdAccountScope = z.infer<typeof adAccountScopeSchema>;

/**
 * Zod schema of a platform account as returned by the API.
 *
 * @property id - Account id
 * @property organizationId - Organization owning it, an opaque uuid from omnipass
 * @property platform - The platform it lives on
 * @property externalId - Its identifier there
 * @property name - What an interface shows
 * @property currency - ISO 4217; the pacing and the exchange rates depend on it, and it never changes.
 *   `null` while an account linked to our manager account waits for its client: it is **read** there
 *   at the acceptance, never declared (`docs/phase-10.md` § 4.4)
 * @property timezone - IANA timezone the platform counts its days in; `null` like the currency
 * @property status - Where the access stands
 * @property statusReason - Why, when it is not `active`
 * @property scope - What the platform requires above the account
 * @property hasCredentials - Whether a secret is stored for it; **the value is never answered**
 * @property createdAt - Creation date (ISO 8601)
 * @property updatedAt - Last update date (ISO 8601)
 * @property deletedAt - Disconnection date (ISO 8601), `null` while it lives
 */
export const adAccountSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  platform: platformSchema,
  externalId: z.string(),
  name: z.string().nullable(),
  currency: z.string().nullable(),
  timezone: z.string().nullable(),
  status: adAccountStatusSchema,
  statusReason: adAccountStatusReasonSchema.nullable(),
  scope: adAccountScopeSchema,
  hasCredentials: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  deletedAt: z.iso.datetime().nullable(),
});

/** TypeScript type inferred from {@link adAccountSchema}. */
export type AdAccount = z.infer<typeof adAccountSchema>;

/** Zod schema of a page of platform accounts. */
export const adAccountPageSchema = paginatedSchema(adAccountSchema);

/**
 * Zod schema of the querystring listing the accounts of an Organization.
 *
 * @property platform - Only the accounts of that platform
 * @property status - Only the accounts in that state
 */
export const listAdAccountsQuerySchema = listQuerySchema(AD_ACCOUNT_SORTABLE_FIELDS)
  .omit({ labelIds: true, labelMode: true })
  .extend({
    platform: platformSchema.optional(),
    status: adAccountStatusSchema.optional(),
  });

/** TypeScript type inferred from {@link listAdAccountsQuerySchema}, after defaults apply. */
export type ListAdAccountsQuery = z.infer<typeof listAdAccountsQuerySchema>;

/**
 * Zod schema of the body connecting an account.
 *
 * Two ways, decided by the platform's adapter rather than by the body (`docs/phase-10.md` § 4.4):
 *
 * - a platform whose accounts link to **our** manager account (`manager_link`) takes the reference
 *   alone — the name, the currency and the timezone are **read** there, and declaring one is refused;
 * - any other declares all three, as in phase 7, and the account waits for its client's answer,
 *   which `PUT /ad-accounts/:id/status` records (`docs/phase-7.md` § 3).
 *
 * Hence three optional fields here, whose presence the service checks.
 *
 * @property platform - The platform
 * @property externalId - Its identifier there; for a `manager_link` platform, the account as the
 *   client reads it in the platform's interface (a Google customer id, dashes allowed)
 * @property name - What an interface shows; declared only where the platform does not give it
 * @property currency - ISO 4217; it never changes afterwards; declared likewise
 * @property timezone - IANA timezone; declared likewise
 * @property scope - What the platform requires above the account
 */
export const connectAdAccountBodySchema = z.strictObject({
  platform: platformSchema,
  externalId: externalIdSchema,
  name: z.string().trim().min(1).max(255).optional(),
  currency: currencySchema.optional(),
  timezone: timezoneSchema.optional(),
  scope: adAccountScopeSchema.optional(),
});

/** TypeScript type inferred from {@link connectAdAccountBodySchema}. */
export type ConnectAdAccountBody = z.infer<typeof connectAdAccountBodySchema>;

/**
 * Zod schema of the body updating an account.
 *
 * Neither the platform, nor the external id, nor the **currency** is here: the amounts already
 * pushed are expressed in it, and an account in another currency is another account
 * (`docs/phase-7.md` § 4).
 *
 * @property name - New name
 * @property timezone - New timezone
 * @property scope - The complete new scope
 */
export const updateAdAccountBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(255).optional(),
  timezone: timezoneSchema.optional(),
  scope: adAccountScopeSchema.optional(),
});

/** TypeScript type inferred from {@link updateAdAccountBodySchema}. */
export type UpdateAdAccountBody = z.infer<typeof updateAdAccountBodySchema>;

/**
 * Zod schema of the body applying a transition of the lifecycle.
 *
 * @property status - Where the account goes
 * @property reason - Why; required for anything but `active`
 */
export const setAdAccountStatusBodySchema = z
  .strictObject({
    status: adAccountStatusSchema,
    reason: adAccountStatusReasonSchema.optional(),
  })
  .refine(
    (body): boolean => (body.status === 'active') === (body.reason === undefined),
    'a reason is required by every state but active, and meaningless for it'
  );

/** TypeScript type inferred from {@link setAdAccountStatusBodySchema}. */
export type SetAdAccountStatusBody = z.infer<typeof setAdAccountStatusBodySchema>;

/**
 * Zod schema of the body posting the credentials of an account.
 *
 * The **only** place a secret enters the API, and it leaves no trace anywhere else: Postgres keeps
 * the name of the Secrets Manager entry, the answer says `hasCredentials`, and **no MCP tool carries
 * this body** (`../../CADRAGE.md` § 12, `docs/phase-7.md` § 2).
 *
 * @property secret - What the platform authenticates with: a refresh token, an API key, a key file
 */
export const setAdAccountCredentialsBodySchema = z.strictObject({
  secret: z.string().min(1).max(16_384),
});

/** TypeScript type inferred from {@link setAdAccountCredentialsBodySchema}. */
export type SetAdAccountCredentialsBody = z.infer<typeof setAdAccountCredentialsBodySchema>;

/**
 * Zod schema of the link between an Advertiser and an account, as returned by the API.
 *
 * @property id - Link id
 * @property organizationId - Organization owning it
 * @property advertiserId - The brand
 * @property platform - The platform, denormalized from the account
 * @property currency - The currency this link is for
 * @property adAccountId - The account it buys on
 * @property externalAdvertiserId - Its identity on the platform: DV360 advertiser, Meta ad account…
 * @property createdAt - Creation date (ISO 8601)
 * @property updatedAt - Last update date (ISO 8601)
 */
export const advertiserAdAccountSchema = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  advertiserId: z.uuid(),
  platform: platformSchema,
  currency: z.string(),
  adAccountId: z.uuid(),
  externalAdvertiserId: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** TypeScript type inferred from {@link advertiserAdAccountSchema}. */
export type AdvertiserAdAccount = z.infer<typeof advertiserAdAccountSchema>;

/** Zod schema of the answer listing the accounts of an Advertiser. */
export const advertiserAdAccountListSchema = z.object({
  items: z.array(advertiserAdAccountSchema),
});

/** TypeScript type inferred from {@link advertiserAdAccountListSchema}. */
export type AdvertiserAdAccountList = z.infer<typeof advertiserAdAccountListSchema>;

/**
 * Zod schema of the body linking an Advertiser to an account.
 *
 * The currency is **the account's**, not a choice: a link is `(advertiser, platform, currency)`, and
 * the account already says which currency it buys in (`docs/phase-7.md` § 5).
 *
 * @property adAccountId - The account the brand buys on
 * @property externalAdvertiserId - Its identity on the platform
 */
export const linkAdvertiserAccountBodySchema = z.strictObject({
  adAccountId: z.uuid(),
  externalAdvertiserId: externalIdSchema,
});

/** TypeScript type inferred from {@link linkAdvertiserAccountBodySchema}. */
export type LinkAdvertiserAccountBody = z.infer<typeof linkAdvertiserAccountBodySchema>;

/**
 * Zod schema of the body changing a link.
 *
 * @property externalAdvertiserId - The new identity on the platform
 */
export const updateAdvertiserAccountBodySchema = z.strictObject({
  externalAdvertiserId: externalIdSchema,
});

/** TypeScript type inferred from {@link updateAdvertiserAccountBodySchema}. */
export type UpdateAdvertiserAccountBody = z.infer<typeof updateAdvertiserAccountBodySchema>;
