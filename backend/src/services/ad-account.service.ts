import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource, EntityManager, In, IsNull, Not, Repository, SelectQueryBuilder } from 'typeorm';

import { adAccountConfig, AdAccountConfig } from '@configs';
import { AdAccountEntity, AdvertiserAdAccountEntity } from '@src/database/entities';
import {
  ADAPTERS,
  adapterOf,
  hasAdapterFor,
  LinkedAccountInfo,
  LinkStatus,
  PlatformAdapter,
  PlatformError,
} from '@src/platforms/platform-adapter';
import {
  AdAccount,
  AdAccountStatus,
  AdAccountStatusReason,
  AdvertiserAdAccount,
  AuthContext,
  ConnectAdAccountBody,
  DeletionResult,
  LinkAdvertiserAccountBody,
  ListAdAccountsQuery,
  Paginated,
  Platform,
  SetAdAccountCredentialsBody,
  SetAdAccountStatusBody,
  UpdateAdAccountBody,
  UpdateAdvertiserAccountBody,
} from '@src/types';
import {
  escapeLike,
  httpError,
  Logger,
  LoggerBuilder,
  toPage,
  toSkipTake,
  withoutAccents,
  withoutAccentsSql,
} from '@utils';
import { AccessService } from './access.service';
import { toOrder } from './crud.helpers';
import { SecretStore } from './secret-store.service';
import { markAccountDirty } from './sync.helpers';

/** One day, in milliseconds. */
const DAY_IN_MS = 86_400_000;

/** The PostgreSQL code of a unique violation: a concurrent connection took the row first. */
const UNIQUE_VIOLATION = '23505';

/**
 * The transitions the lifecycle of a link allows (`docs/phase-7.md` § 3).
 *
 * A passage this table does not name is a **400**, not a silent state: an account that went from
 * `invalid` to `active` without a new request would be an access nobody granted.
 */
const TRANSITIONS: Readonly<Record<AdAccountStatus, readonly AdAccountStatus[]>> = {
  pending: ['active', 'invalid'],
  active: ['invalid'],
  invalid: ['pending'],
};

/** The fields a `manager_link` platform gives, and which nobody declares there. */
const READ_FIELDS = ['name', 'currency', 'timezone'] as const;

/**
 * An adapter of a platform whose accounts link to our manager account, with the whole link.
 */
type LinkAdapter = PlatformAdapter &
  Required<Pick<PlatformAdapter, 'referenceOf' | 'requestLink' | 'linkStatuses' | 'cancelLink' | 'readLinkedAccount'>>;

/**
 * What an account takes from the platform once its client accepted.
 */
type AcceptedFields = Pick<
  AdAccountEntity,
  'externalId' | 'name' | 'currency' | 'timezone' | 'status' | 'statusReason'
>;

/** Where the secret of an account lives, by its id: a name, which is all Postgres ever keeps. */
function secretNameOf(id: string): string {
  return `omnipotent/ad-account/${id}`;
}

/**
 * Refuse a passage the lifecycle does not name.
 *
 * @param from - Where the account stands
 * @param to - Where it is asked to go
 * @throws Error with status 400 coded `ad_account_transition_invalid`
 */
function assertTransition(from: AdAccountStatus, to: AdAccountStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw httpError(400, `An account cannot go from ${from} to ${to}`, {
      code: 'ad_account_transition_invalid',
      params: { from, to },
    });
  }
}

/**
 * The adapter that links the accounts of a platform to our manager account, if it has one.
 *
 * @param platform - The platform
 * @returns Its adapter, or `null` for a platform with none, or whose accounts bring their own secret
 * @throws Error with status 500 coded `sync_adapter_missing` for an adapter that says it links
 *   accounts and does not implement the link — our own gap, never the caller's
 */
function linkAdapterOf(platform: Platform): LinkAdapter | null {
  if (!hasAdapterFor(platform)) return null;
  const adapter: PlatformAdapter = adapterOf(platform);
  if (adapter.connection !== 'manager_link') return null;
  if (
    !adapter.referenceOf ||
    !adapter.requestLink ||
    !adapter.linkStatuses ||
    !adapter.cancelLink ||
    !adapter.readLinkedAccount
  ) {
    throw httpError(500, `The ${platform} adapter links accounts but does not implement the link`, {
      code: 'sync_adapter_missing',
      params: { platform },
    });
  }
  return adapter as LinkAdapter;
}

/**
 * The answer to a platform call that failed while connecting an account.
 *
 * - **our own credentials** (`ownCredentials`): the client can do nothing, an operator must act —
 *   502 `platform_credentials_failed`;
 * - **temporary**: the platform did not answer, or asked to wait — 503 `platform_unavailable`;
 * - **a refusal**: the platform said no, with our code when we worded it, else
 *   400 `ad_account_link_refused` naming the platform's own code.
 *
 * @param error - What the call threw
 * @returns The error to throw; anything but a `PlatformError` goes through untouched
 */
function platformFailure(error: unknown): unknown {
  if (!(error instanceof PlatformError)) return error;
  const { platform } = error;
  if (error.options.ownCredentials) {
    return httpError(
      502,
      `Omnipotent could not sign in to ${platform} with its own credentials: an operator must act`,
      {
        code: 'platform_credentials_failed',
        params: { platform },
        cause: error,
      }
    );
  }
  if (error.options.retryable) {
    return httpError(503, `${platform} did not answer: try again in a moment`, {
      code: 'platform_unavailable',
      params: { platform },
      cause: error,
    });
  }
  if (error.options.messageCode) {
    return httpError(400, error.message, {
      code: error.options.messageCode,
      params: error.options.messageParams ?? {},
      cause: error,
    });
  }
  return httpError(400, `${platform} refused the link: ${error.message}`, {
    code: 'ad_account_link_refused',
    params: { platform, reason: error.options.code ?? null },
    cause: error,
  });
}

/**
 * Map an account row to its API shape.
 *
 * `hasCredentials` is the **only** thing ever said about the secret: there is no route, no tool and
 * no field that answers its value (`../../CADRAGE.md` § 12).
 *
 * @param entity - The row
 * @returns The API representation
 */
export function toAdAccount(entity: AdAccountEntity): AdAccount {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    platform: entity.platform,
    externalId: entity.externalId,
    name: entity.name,
    currency: entity.currency,
    timezone: entity.timezone,
    status: entity.status,
    statusReason: entity.statusReason,
    scope: entity.scope,
    hasCredentials: entity.secretName !== null,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
    deletedAt: entity.deletedAt?.toISOString() ?? null,
  };
}

/**
 * Map a link row to its API shape.
 *
 * @param entity - The row
 * @returns The API representation
 */
export function toAdvertiserAdAccount(entity: AdvertiserAdAccountEntity): AdvertiserAdAccount {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    advertiserId: entity.advertiserId,
    platform: entity.platform,
    currency: entity.currency,
    adAccountId: entity.adAccountId,
    externalAdvertiserId: entity.externalAdvertiserId,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Manages the platform accounts of an Organization, and which account each brand buys on.
 *
 * Four things make this service unlike the others (`docs/phase-7.md`, `docs/phase-10.md` § 4):
 *
 * - **a secret never lands in Postgres**: `SecretStore` holds the value, the row holds the name, and
 *   nothing reads it back;
 * - **the lifecycle is a table**, not a set of verbs: one function applies it, for the route and for
 *   the job that follows the links alike;
 * - **an account linked to our manager account is the platform's word, not the caller's**: its name,
 *   currency and timezone are read there, its status follows the link, and it belongs to one
 *   Organization only — our credentials reach every account so linked;
 * - **connecting and crediting an account ask for `admin`**, since a credential is the most sensitive
 *   thing in the API and it is worth the whole Organization; linking a brand to a connected account
 *   stays `manager`, being a campaign decision.
 */
export class AdAccountService {
  /** Where the failures of the job that follows the links are told. */
  private readonly logger: Logger = LoggerBuilder.getChildLogger('AdAccountService');

  /**
   * Create the service.
   *
   * @param dataSource - Application database
   * @param access - Permission checks
   * @param secrets - Where the credentials live
   * @param config - How long an invitation waits for its answer
   * @param now - The clock, which the tests set
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: AccessService,
    private readonly secrets: SecretStore,
    private readonly config: AdAccountConfig = adAccountConfig,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * List the platform accounts of an Organization.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param query - Page, sort, search, platform, status, and whether the disconnected ones are listed
   * @returns A page of accounts
   * @throws Error with status 404 when the caller cannot see the Organization
   */
  public async list(
    actor: AuthContext,
    organizationId: string,
    query: ListAdAccountsQuery
  ): Promise<Paginated<AdAccount>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');

    const builder: SelectQueryBuilder<AdAccountEntity> = this.repository()
      .createQueryBuilder('account')
      .withDeleted()
      .where('account.organization_id = :organizationId', { organizationId });
    if (!query.includeDeleted) builder.andWhere('account.deleted_at IS NULL');
    if (query.platform) builder.andWhere('account.platform = :platform', { platform: query.platform });
    if (query.status) builder.andWhere('account.status = :status', { status: query.status });
    if (query.search) {
      builder.andWhere(`${withoutAccentsSql('account.name')} ILIKE :search`, {
        search: `%${escapeLike(withoutAccents(query.search))}%`,
      });
    }

    const { skip, take } = toSkipTake(query);
    for (const [field, direction] of Object.entries(toOrder(query.sortBy, query.sortOrder))) {
      builder.addOrderBy(`account.${field}`, direction);
    }
    const [rows, total]: [AdAccountEntity[], number] = await builder.skip(skip).take(take).getManyAndCount();
    return toPage(rows.map(toAdAccount), total, query);
  }

  /**
   * Read one account.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The account
   * @returns The account, and whether it carries credentials
   * @throws Error with status 404 when the caller cannot see it
   */
  public async get(actor: AuthContext, organizationId: string, id: string): Promise<AdAccount> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    return toAdAccount(await this.findOrFail(this.dataSource.manager, organizationId, id, { deleted: true }));
  }

  /**
   * Connect an account, the way its platform connects.
   *
   * - **Linked to our manager account** (`manager_link`): the reference alone; we invite it, unless
   *   our manager account already manages it, and it is then read at once (`docs/phase-10.md` § 4).
   * - **Any other platform**: declared, as in phase 7, and waiting for its client's answer.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param body - Platform and identifier; name, currency and timezone where the platform does not give them
   * @returns The connected account, `pending` — or `active`, for one our manager account already manages
   * @throws Error with status 403 without the admin role, 400 for a field missing or not to declare,
   *   409 when this or another Organization holds it, or when our manager account manages it for
   *   someone else, and the platform's refusals
   */
  public async connect(actor: AuthContext, organizationId: string, body: ConnectAdAccountBody): Promise<AdAccount> {
    await this.access.assertOrganizationRole(actor, organizationId, 'admin');
    const adapter: LinkAdapter | null = linkAdapterOf(body.platform);
    if (adapter) return this.connectLinked(actor, organizationId, body, adapter);

    const { name, currency, timezone } = body;
    if (name === undefined || currency === undefined || timezone === undefined) {
      const field: string = name === undefined ? 'name' : currency === undefined ? 'currency' : 'timezone';
      throw httpError(400, `A ${body.platform} account is declared with its ${field}`, {
        code: 'ad_account_field_required',
        params: { platform: body.platform, field },
      });
    }
    return this.dataSource.transaction(async (manager: EntityManager): Promise<AdAccount> => {
      const taken: boolean = await manager.exists(AdAccountEntity, {
        where: {
          organizationId,
          platform: body.platform,
          externalId: body.externalId,
          deletedAt: IsNull(),
        },
      });
      if (taken) {
        throw httpError(409, 'This Organization already has this account on this platform', {
          code: 'ad_account_already_connected',
          params: { platform: body.platform, externalId: body.externalId },
        });
      }
      const created: AdAccountEntity = await manager.save(
        AdAccountEntity,
        manager.create(AdAccountEntity, {
          organizationId,
          platform: body.platform,
          externalId: body.externalId,
          name,
          currency,
          timezone,
          status: 'pending',
          statusReason: 'link_requested',
          scope: body.scope ?? {},
          secretName: null,
          linkRef: null,
          linkRequestedAt: null,
        })
      );
      return toAdAccount(created);
    });
  }

  /**
   * Change the name, the timezone or the scope of an account.
   *
   * Neither the platform, nor the identifier, nor the **currency** can change: the amounts already
   * pushed are expressed in it (`docs/phase-7.md` § 4). And on an account linked to our manager
   * account, the name and the timezone are the platform's: only the scope is ours to change.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The account
   * @param body - Fields to change
   * @returns The updated account
   * @throws Error with status 403 without the admin role, 404 when absent, 400 for a field the
   *   platform gives
   */
  public async update(
    actor: AuthContext,
    organizationId: string,
    id: string,
    body: UpdateAdAccountBody
  ): Promise<AdAccount> {
    await this.access.assertOrganizationRole(actor, organizationId, 'admin');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<AdAccount> => {
      const account: AdAccountEntity = await this.findOrFail(manager, organizationId, id);
      if (account.linkRef !== null) {
        const field: string | undefined =
          body.name !== undefined ? 'name' : body.timezone !== undefined ? 'timezone' : undefined;
        if (field) throw this.fieldReadError(account.platform, field);
      }
      if (body.name !== undefined) account.name = body.name;
      if (body.timezone !== undefined) account.timezone = body.timezone;
      if (body.scope !== undefined) account.scope = body.scope;
      return toAdAccount(await manager.save(AdAccountEntity, account));
    });
  }

  /**
   * Apply a transition of the lifecycle.
   *
   * On an account linked to our manager account, the status is **the platform's**: the job that
   * follows the links moves it, and the only passage asked here is `invalid → pending`, which sends a
   * new invitation (`docs/phase-10.md` § 4.4).
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The account
   * @param body - Where it goes, and why
   * @returns The account in its new state
   * @throws Error with status 403 without the admin role, 404 when absent, 400 when the table does
   *   not name the passage, or when the platform holds the status
   */
  public async setStatus(
    actor: AuthContext,
    organizationId: string,
    id: string,
    body: SetAdAccountStatusBody
  ): Promise<AdAccount> {
    await this.access.assertOrganizationRole(actor, organizationId, 'admin');
    const found: AdAccountEntity = await this.findOrFail(this.dataSource.manager, organizationId, id);
    if (found.linkRef !== null) return this.relink(found, body);

    return this.dataSource.transaction(async (manager: EntityManager): Promise<AdAccount> => {
      const account: AdAccountEntity = await this.findOrFail(manager, organizationId, id);
      assertTransition(account.status, body.status);
      const statusReason: AdAccountStatusReason | null = body.reason ?? null;
      await manager.update(AdAccountEntity, { id: account.id }, { status: body.status, statusReason });
      // An access that was broken and is mended has units nobody has written since: they were
      // skipped while it was broken (`services/sync.helpers.ts`).
      await markAccountDirty(manager, account.id);
      return toAdAccount({ ...account, status: body.status, statusReason });
    });
  }

  /**
   * Store the credentials of an account.
   *
   * The **only** place a secret enters, and it leaves no trace: the value goes to `SecretStore`, the
   * row keeps its name, and the answer says `hasCredentials`. No MCP tool carries this
   * (`../../CADRAGE.md` § 12).
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The account
   * @param body - The secret
   * @returns The account, now carrying credentials
   * @throws Error with status 403 without the admin role, 404 when absent
   */
  public async setCredentials(
    actor: AuthContext,
    organizationId: string,
    id: string,
    body: SetAdAccountCredentialsBody
  ): Promise<AdAccount> {
    await this.access.assertOrganizationRole(actor, organizationId, 'admin');
    const account: AdAccountEntity = await this.findOrFail(this.dataSource.manager, organizationId, id);
    const secretName: string = secretNameOf(account.id);
    // The store first: a row naming a secret that does not exist would be worse than no row at all.
    await this.secrets.put(secretName, body.secret);
    await this.dataSource.transaction(async (manager: EntityManager): Promise<void> => {
      await manager.update(AdAccountEntity, { id: account.id }, { secretName });
      await markAccountDirty(manager, account.id);
    });
    return toAdAccount({ ...account, secretName });
  }

  /**
   * Erase the credentials of an account.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The account
   * @returns The account, carrying none
   * @throws Error with status 403 without the admin role, 404 when absent
   */
  public async deleteCredentials(actor: AuthContext, organizationId: string, id: string): Promise<AdAccount> {
    await this.access.assertOrganizationRole(actor, organizationId, 'admin');
    const account: AdAccountEntity = await this.findOrFail(this.dataSource.manager, organizationId, id);
    await this.forgetSecret(account);
    await this.dataSource.manager.update(AdAccountEntity, { id: account.id }, { secretName: null });
    return toAdAccount({ ...account, secretName: null });
  }

  /**
   * Disconnect an account, erasing its secret.
   *
   * The links of the brands are left alone: restoring the account brings them back, and a link
   * pointing at a disconnected account is something the preview refuses, not a broken row.
   *
   * An account still **invited** to our manager account has its invitation withdrawn; one whose link
   * is active keeps it — ending it is its client's to do, and that is what lets this Organization
   * connect it again without asking them twice (`docs/phase-10.md` § 4.5).
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The account
   * @returns Its id and when it was disconnected
   * @throws Error with status 403 without the admin role, 404 when absent
   */
  public async disconnect(actor: AuthContext, organizationId: string, id: string): Promise<DeletionResult> {
    await this.access.assertOrganizationRole(actor, organizationId, 'admin');
    const account: AdAccountEntity = await this.findOrFail(this.dataSource.manager, organizationId, id);
    await this.forgetSecret(account);
    if (account.linkRef !== null && account.status === 'pending')
      await this.withdrawInvitation(account, account.linkRef);
    const deletedAt = new Date(this.now());
    await this.dataSource.manager.update(AdAccountEntity, { id: account.id }, { secretName: null, deletedAt });
    return { id: account.id, deletedAt: deletedAt.toISOString() };
  }

  /**
   * Reconnect a disconnected account.
   *
   * It comes back **without credentials** and `pending`: the secret was erased on the way out, and an
   * access nobody re-granted is not an access. A linked account comes back only where its client's
   * consent still holds — no other Organization holding it, and this one the last to have held it —
   * and the job that follows the links reads where its link stands.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The account
   * @returns Its id, with `deletedAt` back to `null`
   * @throws Error with status 403 without the admin role, 404 when absent, 409 when it is connected,
   *   or when another Organization holds or last held it
   */
  public async restore(actor: AuthContext, organizationId: string, id: string): Promise<DeletionResult> {
    await this.access.assertOrganizationRole(actor, organizationId, 'admin');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<DeletionResult> => {
      const account: AdAccountEntity = await this.findOrFail(manager, organizationId, id, { deleted: true });
      if (!account.deletedAt) {
        throw httpError(409, 'This account is not disconnected', { code: 'ad_account_not_deleted' });
      }
      if (account.linkRef !== null) {
        await this.assertNotHeld(organizationId, account.platform, account.linkRef);
        await this.assertConsented(actor, organizationId, account.platform, account.linkRef);
      }
      await manager.update(
        AdAccountEntity,
        { id: account.id },
        {
          deletedAt: null,
          status: 'pending',
          statusReason: 'link_requested',
          ...(account.linkRef === null ? {} : { linkRequestedAt: new Date(this.now()) }),
        }
      );
      return { id: account.id, deletedAt: null };
    });
  }

  /**
   * Follow the link of every account invited to, or managed by, our manager accounts: the job
   * `account.links`, every fifteen minutes (`docs/phase-10.md` § 4.6).
   *
   * **One** read of the links per platform, whatever the number of accounts, and none at all for a
   * platform with no account to follow — the cost follows the work waiting, never the size of the
   * base (`../../CADRAGE.md` § 14). A failure is logged and left to the next pass: a platform that
   * does not answer leaves its accounts where they stand.
   *
   * @returns A promise that resolves once every platform was looked at
   */
  public async checkLinks(): Promise<void> {
    for (const platform of Object.keys(ADAPTERS) as Platform[]) {
      const adapter: LinkAdapter | null = linkAdapterOf(platform);
      if (!adapter) continue;
      const accounts: AdAccountEntity[] = await this.dataSource.manager.find(AdAccountEntity, {
        where: { platform, linkRef: Not(IsNull()), status: In(['pending', 'active']) },
      });
      if (accounts.length === 0) continue;

      let statuses: Map<string, LinkStatus>;
      try {
        statuses = await adapter.linkStatuses();
      } catch (error: unknown) {
        this.logger.warn('The links of a platform could not be read', { platform, error });
        continue;
      }
      for (const account of accounts) {
        const reference: string = account.linkRef as string;
        try {
          await this.followLink(adapter, account, reference, statuses.get(reference) ?? null);
        } catch (error: unknown) {
          this.logger.warn('The link of an account could not be followed', {
            adAccountId: account.id,
            platform,
            error,
          });
        }
      }
    }
  }

  /**
   * The accounts a brand buys on, one per platform and per currency.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param advertiserId - The brand
   * @returns Its links
   * @throws Error with status 404 when the caller cannot see the Organization
   */
  public async listForAdvertiser(
    actor: AuthContext,
    organizationId: string,
    advertiserId: string
  ): Promise<AdvertiserAdAccount[]> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    const rows: AdvertiserAdAccountEntity[] = await this.dataSource.manager.find(AdvertiserAdAccountEntity, {
      where: { organizationId, advertiserId, deletedAt: IsNull() },
      order: { platform: 'ASC', currency: 'ASC' },
    });
    return rows.map(toAdvertiserAdAccount);
  }

  /**
   * Link a brand to an account for the currency that account buys in.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param advertiserId - The brand
   * @param body - The account, and the brand's identity on the platform
   * @returns The link
   * @throws Error with status 403 without the manager role, 404 when the account is absent, 400 when
   *   it cannot be used or its currency is not known yet, 409 when the brand already has one for that
   *   platform and currency
   */
  public async link(
    actor: AuthContext,
    organizationId: string,
    advertiserId: string,
    body: LinkAdvertiserAccountBody
  ): Promise<AdvertiserAdAccount> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<AdvertiserAdAccount> => {
      const account: AdAccountEntity = await this.findOrFail(manager, organizationId, body.adAccountId);
      if (account.status === 'invalid') {
        throw httpError(400, 'This account cannot be used: its access is not valid', {
          code: 'ad_account_unusable',
          params: { status: account.status, statusReason: account.statusReason },
        });
      }
      const { currency } = account;
      if (currency === null) {
        throw httpError(400, 'This account has no currency yet: its client has not accepted the link', {
          code: 'ad_account_currency_unknown',
          params: { status: account.status },
        });
      }
      const taken: boolean = await manager.exists(AdvertiserAdAccountEntity, {
        where: {
          advertiserId,
          platform: account.platform,
          currency,
          deletedAt: IsNull(),
        },
      });
      if (taken) {
        throw httpError(409, 'This brand already buys on an account of that platform in that currency', {
          code: 'advertiser_account_exists',
          params: { platform: account.platform, currency },
        });
      }
      const created: AdvertiserAdAccountEntity = await manager.save(
        AdvertiserAdAccountEntity,
        manager.create(AdvertiserAdAccountEntity, {
          organizationId,
          advertiserId,
          platform: account.platform,
          currency,
          adAccountId: account.id,
          externalAdvertiserId: body.externalAdvertiserId,
        })
      );
      return toAdvertiserAdAccount(created);
    });
  }

  /**
   * Change the identity a brand has on a platform.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The link
   * @param body - The new identity
   * @returns The link
   * @throws Error with status 403 without the manager role, 404 when absent
   */
  public async updateLink(
    actor: AuthContext,
    organizationId: string,
    id: string,
    body: UpdateAdvertiserAccountBody
  ): Promise<AdvertiserAdAccount> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<AdvertiserAdAccount> => {
      const link: AdvertiserAdAccountEntity = await this.linkOrFail(manager, organizationId, id);
      await manager.update(
        AdvertiserAdAccountEntity,
        { id: link.id },
        { externalAdvertiserId: body.externalAdvertiserId }
      );
      return toAdvertiserAdAccount({ ...link, externalAdvertiserId: body.externalAdvertiserId });
    });
  }

  /**
   * Undo a link.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The link
   * @returns Its id and when it was undone
   * @throws Error with status 403 without the manager role, 404 when absent
   */
  public async unlink(actor: AuthContext, organizationId: string, id: string): Promise<DeletionResult> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<DeletionResult> => {
      const link: AdvertiserAdAccountEntity = await this.linkOrFail(manager, organizationId, id);
      const deletedAt = new Date();
      await manager.update(AdvertiserAdAccountEntity, { id: link.id }, { deletedAt });
      return { id: link.id, deletedAt: deletedAt.toISOString() };
    });
  }

  /**
   * Connect an account of a platform whose accounts link to our manager account.
   *
   * The order is what keeps it safe (`docs/phase-10.md` § 4.5): everything that can be refused
   * without the platform is refused first; the platform is then asked to link it — which sends
   * nothing when our manager account already manages it — and an account already managed is taken
   * only by a super-admin, or by the Organization that held it last.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param body - The platform and the reference, nothing to declare
   * @param adapter - The platform's adapter
   * @returns The account, `pending` once invited, `active` when already managed
   * @throws Error with status 400, 409, 502 or 503 (see {@link AdAccountService.connect})
   */
  private async connectLinked(
    actor: AuthContext,
    organizationId: string,
    body: ConnectAdAccountBody,
    adapter: LinkAdapter
  ): Promise<AdAccount> {
    const { platform } = body;
    const declared: string | undefined = READ_FIELDS.find((field): boolean => body[field] !== undefined);
    if (declared) throw this.fieldReadError(platform, declared);
    const reference: string | null = adapter.referenceOf(body.externalId);
    if (reference === null) {
      throw httpError(400, `${body.externalId} is not a ${platform} account reference`, {
        code: 'ad_account_reference_invalid',
        params: { platform, field: 'externalId' },
      });
    }
    await this.assertNotHeld(organizationId, platform, reference);

    const link: 'pending' | 'active' = await this.callPlatform(() => adapter.requestLink(reference, body.scope ?? {}));
    let fields: AcceptedFields = {
      externalId: reference,
      name: null,
      currency: null,
      timezone: null,
      status: 'pending',
      statusReason: 'link_requested',
    };
    if (link === 'active') {
      await this.assertConsented(actor, organizationId, platform, reference);
      fields = await this.acceptedFields(adapter, reference);
    }
    try {
      const created: AdAccountEntity = await this.dataSource.manager.save(
        AdAccountEntity,
        this.dataSource.manager.create(AdAccountEntity, {
          organizationId,
          platform,
          ...fields,
          scope: body.scope ?? {},
          secretName: null,
          linkRef: reference,
          linkRequestedAt: new Date(this.now()),
        })
      );
      return toAdAccount(created);
    } catch (error: unknown) {
      // Connected meanwhile, here or elsewhere: the unique indexes refused this row, so say which.
      if ((error as { code?: string }).code === UNIQUE_VIOLATION)
        await this.assertNotHeld(organizationId, platform, reference);
      throw error;
    }
  }

  /**
   * Send a new invitation for a linked account whose access ended — the only passage the caller asks
   * of one — and read it at once if our manager account manages it again.
   *
   * No consent to check: this Organization holds the row, so it is the last to have held it.
   *
   * @param account - The account
   * @param body - Where it is asked to go
   * @returns The account in its new state
   * @throws Error with status 400 coded `ad_account_status_read` for any other passage, 500 when the
   *   platform has no adapter any more, and the platform's refusals
   */
  private async relink(account: AdAccountEntity, body: SetAdAccountStatusBody): Promise<AdAccount> {
    if (account.status !== 'invalid' || body.status !== 'pending') {
      throw httpError(400, `The status of a ${account.platform} account follows the platform: it is not set by hand`, {
        code: 'ad_account_status_read',
        params: { platform: account.platform, to: body.status },
      });
    }
    const adapter: LinkAdapter | null = linkAdapterOf(account.platform);
    if (!adapter) {
      throw httpError(500, `No adapter implements ${account.platform}`, {
        code: 'sync_adapter_missing',
        params: { platform: account.platform },
      });
    }
    const reference: string = account.linkRef as string;
    const link: 'pending' | 'active' = await this.callPlatform(() => adapter.requestLink(reference, account.scope));
    const fields: Partial<AdAccountEntity> =
      link === 'active'
        ? await this.acceptedFields(adapter, reference, account.currency)
        : { status: 'pending', statusReason: 'link_requested' };
    const changed: Partial<AdAccountEntity> = { ...fields, linkRequestedAt: new Date(this.now()) };
    await this.dataSource.transaction(async (manager: EntityManager): Promise<void> => {
      await manager.update(AdAccountEntity, { id: account.id }, changed);
      await markAccountDirty(manager, account.id);
    });
    return toAdAccount({ ...account, ...changed });
  }

  /**
   * What an account takes from the platform once its client accepted, refusing a manager account.
   *
   * @param adapter - The platform's adapter
   * @param reference - The account
   * @param currency - The currency already known, which never changes: kept over what is read
   * @returns Its id, name, currency and timezone, `active`
   * @throws Error with status 400 coded `ad_account_manager` for a manager account, and the
   *   platform's refusals
   */
  private async acceptedFields(
    adapter: LinkAdapter,
    reference: string,
    currency: string | null = null
  ): Promise<AcceptedFields> {
    const info: LinkedAccountInfo = await this.callPlatform(() => adapter.readLinkedAccount(reference));
    if (info.manager) {
      throw httpError(400, `${reference} is a manager account: it runs no campaign`, {
        code: 'ad_account_manager',
        params: { platform: adapter.platform, reference },
      });
    }
    return {
      externalId: info.externalId,
      name: info.name,
      currency: currency ?? info.currency,
      timezone: info.timezone,
      status: 'active',
      statusReason: null,
    };
  }

  /**
   * Move one followed account to where its link stands (`docs/phase-10.md` § 2).
   *
   * @param adapter - The platform's adapter
   * @param account - The account, `pending` or `active`
   * @param reference - Its reference
   * @param status - Where the platform says its link stands, `null` when it does not list it
   * @returns A promise that resolves once moved, or left where it stands
   */
  private async followLink(
    adapter: LinkAdapter,
    account: AdAccountEntity,
    reference: string,
    status: LinkStatus | null
  ): Promise<void> {
    if (account.status === 'active') {
      if (status === 'ended' || status === 'refused')
        await this.moveTo(account, { status: 'invalid', statusReason: 'link_revoked' });
      return;
    }
    if (status === 'active') {
      const info: LinkedAccountInfo = await adapter.readLinkedAccount(reference);
      if (info.manager) {
        await this.moveTo(account, { status: 'invalid', statusReason: 'manager_account' });
        return;
      }
      await this.moveTo(account, {
        externalId: info.externalId,
        name: info.name,
        currency: account.currency ?? info.currency,
        timezone: info.timezone,
        status: 'active',
        statusReason: null,
      });
      return;
    }
    if (status === 'refused' || status === 'ended') {
      await this.moveTo(account, { status: 'invalid', statusReason: 'link_declined' });
      return;
    }
    if (status === 'expired') {
      // The platform gave the invitation up itself (Microsoft, after thirty days): nothing to withdraw.
      await this.moveTo(account, { status: 'invalid', statusReason: 'link_expired' });
      return;
    }
    const requestedAt: number = (account.linkRequestedAt ?? account.createdAt).getTime();
    if (requestedAt + this.config.linkRequestLifetimeDays * DAY_IN_MS <= this.now()) {
      // Google never ends an invitation on its own: we withdraw it, then give it up.
      await adapter.cancelLink(reference);
      await this.moveTo(account, { status: 'invalid', statusReason: 'link_expired' });
    }
  }

  /**
   * Apply a transition the job decided, through the same table as the route.
   *
   * @param account - The account
   * @param fields - Its new status, and what comes with it
   * @returns A promise that resolves once written
   */
  private async moveTo(
    account: AdAccountEntity,
    fields: Partial<AdAccountEntity> & Pick<AdAccountEntity, 'status' | 'statusReason'>
  ): Promise<void> {
    assertTransition(account.status, fields.status);
    await this.dataSource.transaction(async (manager: EntityManager): Promise<void> => {
      await manager.update(AdAccountEntity, { id: account.id }, fields);
      await markAccountDirty(manager, account.id);
    });
  }

  /**
   * Refuse an account a living row already holds: here, or in another Organization — an account
   * linked to our manager account belongs to one only, and the other is not named.
   *
   * @param organizationId - The Organization connecting it
   * @param platform - Its platform
   * @param reference - Its reference
   * @returns Nothing
   * @throws Error with status 409 coded `ad_account_already_connected` when this Organization holds
   *   it, `ad_account_linked_elsewhere` when another does
   */
  private async assertNotHeld(organizationId: string, platform: Platform, reference: string): Promise<void> {
    const holders: AdAccountEntity[] = await this.dataSource.manager.find(AdAccountEntity, {
      where: [
        { platform, linkRef: reference },
        { organizationId, platform, externalId: reference },
      ],
    });
    if (holders.some((holder: AdAccountEntity): boolean => holder.organizationId === organizationId)) {
      throw httpError(409, 'This Organization already has this account on this platform', {
        code: 'ad_account_already_connected',
        params: { platform, externalId: reference },
      });
    }
    if (holders.length > 0) {
      throw httpError(409, `This ${platform} account is connected in another Organization`, {
        code: 'ad_account_linked_elsewhere',
        params: { platform },
      });
    }
  }

  /**
   * Refuse to take our manager account already managing an account for the consent of its client,
   * but for a **super-admin** — who knows for which client our manager account manages it, and acts
   * for them — and for the Organization that held it last (Lorin's rule of 2026-11-19,
   * `docs/phase-10.md` § 4.5). Anyone else would use an account its client never gave them.
   *
   * @param actor - The caller
   * @param organizationId - The Organization connecting it
   * @param platform - Its platform
   * @param reference - Its reference
   * @returns Nothing
   * @throws Error with status 409 coded `ad_account_already_managed` otherwise
   */
  private async assertConsented(
    actor: AuthContext,
    organizationId: string,
    platform: Platform,
    reference: string
  ): Promise<void> {
    if (actor.isSuperAdmin) return;
    const last: AdAccountEntity | null = await this.dataSource.manager.findOne(AdAccountEntity, {
      where: { platform, linkRef: reference, deletedAt: Not(IsNull()) },
      withDeleted: true,
      order: { deletedAt: 'DESC' },
    });
    if (last?.organizationId === organizationId) return;
    throw httpError(
      409,
      `Our manager account already manages this ${platform} account, without its client granting it to this ` +
        'Organization: a super-admin connects it, or its client ends that link and accepts a new invitation',
      { code: 'ad_account_already_managed', params: { platform } }
    );
  }

  /**
   * Withdraw the pending invitation of an account being disconnected, without failing the
   * disconnection: an invitation left pending only lets its client accept something nobody holds,
   * which nobody can then take but a super-admin or this Organization.
   *
   * @param account - The account
   * @param reference - Its reference
   * @returns A promise that resolves once withdrawn, or the failure logged
   */
  private async withdrawInvitation(account: AdAccountEntity, reference: string): Promise<void> {
    const adapter: LinkAdapter | null = linkAdapterOf(account.platform);
    if (!adapter) return;
    try {
      await adapter.cancelLink(reference);
    } catch (error: unknown) {
      this.logger.warn('The invitation of a disconnected account could not be withdrawn', {
        adAccountId: account.id,
        platform: account.platform,
        error,
      });
    }
  }

  /**
   * Call a platform, turning its failure into the answer the caller gets.
   *
   * @param call - The call
   * @returns What it answered
   * @throws Error as {@link platformFailure} words it
   */
  private async callPlatform<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error: unknown) {
      throw platformFailure(error);
    }
  }

  /**
   * The refusal of a field the platform gives.
   *
   * @param platform - The platform
   * @param field - The field
   * @returns Error with status 400 coded `ad_account_field_read`
   */
  private fieldReadError(platform: Platform, field: string): Error {
    return httpError(400, `The ${field} of a ${platform} account is read from the platform, never declared`, {
      code: 'ad_account_field_read',
      params: { platform, field },
    });
  }

  /**
   * Repository of the accounts table.
   *
   * @returns The repository
   */
  private repository(): Repository<AdAccountEntity> {
    return this.dataSource.getRepository(AdAccountEntity);
  }

  /**
   * Forget the secret of an account, if it had one.
   *
   * @param account - The account
   * @returns Nothing
   */
  private async forgetSecret(account: AdAccountEntity): Promise<void> {
    if (account.secretName === null) return;
    await this.secrets.delete(account.secretName);
  }

  /**
   * Load an account of an Organization.
   *
   * @param manager - Where to read
   * @param organizationId - The Organization it must belong to
   * @param id - The account
   * @param options - Whether a disconnected account is accepted
   * @param options.deleted - `true` to also find a disconnected one
   * @returns The row
   * @throws Error with status 404 coded `ad_account_not_found`
   */
  private async findOrFail(
    manager: EntityManager,
    organizationId: string,
    id: string,
    options: { deleted?: boolean } = {}
  ): Promise<AdAccountEntity> {
    const account: AdAccountEntity | null = await manager.findOne(AdAccountEntity, {
      where: { id, organizationId },
      withDeleted: options.deleted === true,
    });
    if (!account) throw httpError(404, 'This platform account does not exist', { code: 'ad_account_not_found' });
    return account;
  }

  /**
   * Load a link of an Organization.
   *
   * @param manager - Where to read
   * @param organizationId - The Organization it must belong to
   * @param id - The link
   * @returns The row
   * @throws Error with status 404 coded `advertiser_account_not_found`
   */
  private async linkOrFail(
    manager: EntityManager,
    organizationId: string,
    id: string
  ): Promise<AdvertiserAdAccountEntity> {
    const link: AdvertiserAdAccountEntity | null = await manager.findOne(AdvertiserAdAccountEntity, {
      where: { id, organizationId, deletedAt: IsNull() },
    });
    if (!link) {
      throw httpError(404, 'This link does not exist', { code: 'advertiser_account_not_found' });
    }
    return link;
  }
}

/**
 * Fastify plugin that decorates the instance with an {@link AdAccountService}.
 *
 * Depends on `DatabasePlugin`, `AccessServicePlugin` and `SecretStorePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function adAccountServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('adAccountService', new AdAccountService(fastify.db, fastify.accessService, fastify.secretStore));
}

export default fastifyPlugin(adAccountServicePlugin, {
  name: 'AdAccountServicePlugin',
  dependencies: ['DatabasePlugin', 'AccessServicePlugin', 'SecretStorePlugin'],
});
