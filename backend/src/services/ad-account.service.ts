import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource, EntityManager, IsNull, Repository, SelectQueryBuilder } from 'typeorm';

import { AdAccountEntity, AdvertiserAdAccountEntity } from '@src/database/entities';
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
  SetAdAccountCredentialsBody,
  SetAdAccountStatusBody,
  UpdateAdAccountBody,
  UpdateAdvertiserAccountBody,
} from '@src/types';
import { escapeLike, httpError, toPage, toSkipTake, withoutAccents, withoutAccentsSql } from '@utils';
import { AccessService } from './access.service';
import { toOrder } from './crud.helpers';
import { SecretStore } from './secret-store.service';

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

/** Where the secret of an account lives, by its id: a name, which is all Postgres ever keeps. */
function secretNameOf(id: string): string {
  return `omnipotent/ad-account/${id}`;
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
 * Three things make this service unlike the others (`docs/phase-7.md`):
 *
 * - **a secret never lands in Postgres**: `SecretStore` holds the value, the row holds the name, and
 *   nothing reads it back;
 * - **the lifecycle is a table**, not a set of verbs: one method applies it, and the job of the
 *   platform phases will apply the same one;
 * - **connecting and crediting an account ask for `admin`**, since a credential is the most sensitive
 *   thing in the API and it is worth the whole Organization; linking a brand to a connected account
 *   stays `manager`, being a campaign decision.
 */
export class AdAccountService {
  /**
   * Create the service.
   *
   * @param dataSource - Application database
   * @param access - Permission checks
   * @param secrets - Where the credentials live
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: AccessService,
    private readonly secrets: SecretStore
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
   * Connect an account, which arrives waiting for the client's answer.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param body - Platform, identifier, name, currency, timezone and scope
   * @returns The connected account, `pending`
   * @throws Error with status 403 without the admin role, 409 when this Organization already has it
   */
  public async connect(actor: AuthContext, organizationId: string, body: ConnectAdAccountBody): Promise<AdAccount> {
    await this.access.assertOrganizationRole(actor, organizationId, 'admin');
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
          name: body.name,
          currency: body.currency,
          timezone: body.timezone,
          status: 'pending',
          statusReason: 'link_requested',
          scope: body.scope ?? {},
          secretName: null,
        })
      );
      return toAdAccount(created);
    });
  }

  /**
   * Change the name, the timezone or the scope of an account.
   *
   * Neither the platform, nor the identifier, nor the **currency** can change: the amounts already
   * pushed are expressed in it (`docs/phase-7.md` § 4).
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The account
   * @param body - Fields to change
   * @returns The updated account
   * @throws Error with status 403 without the admin role, 404 when absent
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
      if (body.name !== undefined) account.name = body.name;
      if (body.timezone !== undefined) account.timezone = body.timezone;
      if (body.scope !== undefined) account.scope = body.scope;
      return toAdAccount(await manager.save(AdAccountEntity, account));
    });
  }

  /**
   * Apply a transition of the lifecycle.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The account
   * @param body - Where it goes, and why
   * @returns The account in its new state
   * @throws Error with status 403 without the admin role, 404 when absent, 400 when the table does
   *   not name the passage
   */
  public async setStatus(
    actor: AuthContext,
    organizationId: string,
    id: string,
    body: SetAdAccountStatusBody
  ): Promise<AdAccount> {
    await this.access.assertOrganizationRole(actor, organizationId, 'admin');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<AdAccount> => {
      const account: AdAccountEntity = await this.findOrFail(manager, organizationId, id);
      if (!TRANSITIONS[account.status].includes(body.status)) {
        throw httpError(400, `An account cannot go from ${account.status} to ${body.status}`, {
          code: 'ad_account_transition_invalid',
          params: { from: account.status, to: body.status },
        });
      }
      const statusReason: AdAccountStatusReason | null = body.reason ?? null;
      await manager.update(AdAccountEntity, { id: account.id }, { status: body.status, statusReason });
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
    await this.dataSource.manager.update(AdAccountEntity, { id: account.id }, { secretName });
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
    const deletedAt = new Date();
    await this.dataSource.manager.update(AdAccountEntity, { id: account.id }, { secretName: null, deletedAt });
    return { id: account.id, deletedAt: deletedAt.toISOString() };
  }

  /**
   * Reconnect a disconnected account.
   *
   * It comes back **without credentials** and `pending`: the secret was erased on the way out, and an
   * access nobody re-granted is not an access.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The account
   * @returns Its id, with `deletedAt` back to `null`
   * @throws Error with status 403 without the admin role, 404 when absent, 409 when it is connected
   */
  public async restore(actor: AuthContext, organizationId: string, id: string): Promise<DeletionResult> {
    await this.access.assertOrganizationRole(actor, organizationId, 'admin');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<DeletionResult> => {
      const account: AdAccountEntity = await this.findOrFail(manager, organizationId, id, { deleted: true });
      if (!account.deletedAt) {
        throw httpError(409, 'This account is not disconnected', { code: 'ad_account_not_deleted' });
      }
      await manager.update(
        AdAccountEntity,
        { id: account.id },
        { deletedAt: null, status: 'pending', statusReason: 'link_requested' }
      );
      return { id: account.id, deletedAt: null };
    });
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
   *   it cannot be used, 409 when the brand already has one for that platform and currency
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
      const taken: boolean = await manager.exists(AdvertiserAdAccountEntity, {
        where: {
          advertiserId,
          platform: account.platform,
          currency: account.currency,
          deletedAt: IsNull(),
        },
      });
      if (taken) {
        throw httpError(409, 'This brand already buys on an account of that platform in that currency', {
          code: 'advertiser_account_exists',
          params: { platform: account.platform, currency: account.currency },
        });
      }
      const created: AdvertiserAdAccountEntity = await manager.save(
        AdvertiserAdAccountEntity,
        manager.create(AdvertiserAdAccountEntity, {
          organizationId,
          advertiserId,
          platform: account.platform,
          currency: account.currency,
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
