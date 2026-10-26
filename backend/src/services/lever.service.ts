import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource, EntityManager, ObjectLiteral } from 'typeorm';

import { LeverEntity } from '@src/database/entities';
import { assertFieldAllowedForLevers, assertPlatformEligible, profileOf } from '@src/levers/lever-profiles';
import { Paginated } from '@src/types/api.types';
import { AuthContext } from '@src/types/auth.types';
import { CampaignLever, CreateLeverBody, ListLeversQuery, UpdateLeverBody } from '@src/types/campaign-lever.types';
import { DeletionResult, SetLabelsBody } from '@src/types/crud.types';
import { LabelSummary } from '@src/types/label.types';
import { Lever, RuledField } from '@src/types/lever.types';
import { PlatformShare } from '@src/types/platform.types';
import { httpError, toPage } from '@utils';
import { AccessService } from './access.service';
import { assertSharesComplete } from './budget.helpers';
import { LabelService } from './label.service';
import { deleteNode, findNodeOrFail, listNodes, normalizeNodeWrite, restoreNode } from './node.helpers';
import { budgetBlockOf, TreeNodeRow } from './tree.helpers';

/** The level this service owns. */
const LEVEL = 'lever' as const;

/** PostgreSQL error code of a unique constraint violation. */
const UNIQUE_VIOLATION = '23505';

/** The fields a campaign carries that a lever's profile could forbid. */
const CAMPAIGN_FIELDS: RuledField[] = ['budget', 'dates', 'capping'];

/**
 * Map a Lever row to its API shape.
 *
 * @param entity - The row
 * @param budget - Its budget, resolved at read time
 * @param labels - The Labels posted on it
 * @returns The API representation
 */
export function toCampaignLever(
  entity: LeverEntity,
  budget: CampaignLever['budget'],
  labels: LabelSummary[] = []
): CampaignLever {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    campaignId: entity.campaignId,
    lever: entity.lever,
    status: entity.status,
    productsMode: entity.productsMode,
    platformShares: entity.platformShares,
    budget,
    startsOn: entity.startsOn,
    endsOn: entity.endsOn,
    capping: entity.capping,
    labels,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
    deletedAt: entity.deletedAt?.toISOString() ?? null,
  };
}

/**
 * Manages the Levers of a Campaign: one channel each, and the level that chooses **the platforms and
 * their shares** for everything below it.
 *
 * It has no bulk routes: a campaign carries at most one lever of each channel, so a lot of two
 * hundred would mean nothing (`docs/phase-3.md` § 7).
 *
 * Adding a lever is also the moment the campaign's own fields are checked against it: a campaign
 * carrying a capping cannot take a `search` lever, since no Search platform expresses one (L6).
 */
export class LeverService {
  /**
   * Create the service.
   *
   * @param dataSource - Application database
   * @param access - Permission checks
   * @param labels - Posting and reading the Labels of a resource
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: AccessService,
    private readonly labels: LabelService
  ) {}

  /**
   * List the Levers of a Campaign.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param campaignId - The Campaign
   * @param query - Page, sort, label filter, and whether the deleted ones are listed
   * @returns A page of Levers
   * @throws Error with status 404 when the caller cannot see the Organization or the Campaign
   */
  public async list(
    actor: AuthContext,
    organizationId: string,
    campaignId: string,
    query: ListLeversQuery
  ): Promise<Paginated<CampaignLever>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    await findNodeOrFail(this.dataSource.manager, 'campaign', organizationId, campaignId, { deleted: true });

    const [rows, total]: [TreeNodeRow[], number] = await listNodes(
      this.dataSource,
      LEVEL,
      { organizationId, parentId: campaignId },
      { ...query, search: undefined },
      null
    );
    return toPage(await this.toApi(this.dataSource.manager, rows as LeverEntity[]), total, query);
  }

  /**
   * Read one Lever.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Lever
   * @returns The Lever, with its budget resolved and its Labels
   * @throws Error with status 404 when the caller cannot see it
   */
  public async get(actor: AuthContext, organizationId: string, id: string): Promise<CampaignLever> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    const row: TreeNodeRow = await findNodeOrFail(this.dataSource.manager, LEVEL, organizationId, id, {
      deleted: true,
    });
    const [lever]: CampaignLever[] = await this.toApi(this.dataSource.manager, [row as LeverEntity]);
    return lever;
  }

  /**
   * Add a Lever to a Campaign.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param campaignId - The Campaign
   * @param body - The channel, its platforms and their shares, and what it carries
   * @returns The created Lever
   * @throws Error with status 403 without the manager role, 404 on an unknown Campaign or Label,
   *   409 when the campaign already carries that channel, 400 on an ineligible platform, a broken
   *   distribution key, a Products mode the channel refuses, or a field it cannot express
   */
  public async create(
    actor: AuthContext,
    organizationId: string,
    campaignId: string,
    body: CreateLeverBody
  ): Promise<CampaignLever> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<CampaignLever> => {
      const campaign: TreeNodeRow = await findNodeOrFail(manager, 'campaign', organizationId, campaignId);
      this.assertKey(body.lever, body.platformShares);
      this.assertProductsMode(body.lever, body.productsMode === true);
      this.assertCampaignExpressible(body.lever, campaign);

      const columns: ObjectLiteral = await normalizeNodeWrite(
        manager,
        { level: LEVEL, levers: [body.lever], parentId: campaignId, nodeId: null, campaignId },
        body
      );
      const created: LeverEntity = await this.save(
        manager,
        manager.create(LeverEntity, {
          organizationId,
          campaignId,
          lever: body.lever,
          platformShares: body.platformShares,
          productsMode: body.productsMode === true,
          ...columns,
        }),
        body.lever
      );
      const posted: LabelSummary[] = body.labelIds?.length
        ? await this.labels.setOn(manager, organizationId, LEVEL, created.id, body.labelIds)
        : [];
      return toCampaignLever(created, await budgetBlockOf(manager, LEVEL, created as TreeNodeRow), posted);
    });
  }

  /**
   * Change a Lever. Its channel is not changeable: that would be another lever.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Lever
   * @param body - Fields to change
   * @returns The updated Lever
   * @throws Error with status 403 without the manager role, 404 when absent, 400 on a refused field
   */
  public async update(
    actor: AuthContext,
    organizationId: string,
    id: string,
    body: UpdateLeverBody
  ): Promise<CampaignLever> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<CampaignLever> => {
      const current: TreeNodeRow = await findNodeOrFail(manager, LEVEL, organizationId, id);
      const lever: Lever = current.lever as Lever;
      if (body.platformShares) this.assertKey(lever, body.platformShares);
      if (body.productsMode !== undefined) this.assertProductsMode(lever, body.productsMode);

      const columns: ObjectLiteral = await normalizeNodeWrite(
        manager,
        { level: LEVEL, levers: [lever], parentId: current.campaignId as string, nodeId: id, current },
        body
      );
      const saved: LeverEntity = await manager.save(LeverEntity, {
        ...(current as LeverEntity),
        ...(body.platformShares === undefined ? {} : { platformShares: body.platformShares }),
        ...(body.productsMode === undefined ? {} : { productsMode: body.productsMode }),
        ...columns,
      });
      const [updated]: CampaignLever[] = await this.toApi(manager, [saved]);
      return updated;
    });
  }

  /**
   * Soft-delete a Lever **and its whole subtree** (D19). Its channel is free again.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Lever
   * @returns Its id and when it was deleted
   * @throws Error with status 403 without the manager role, 404 when absent
   */
  public async delete(actor: AuthContext, organizationId: string, id: string): Promise<DeletionResult> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction((manager: EntityManager): Promise<DeletionResult> =>
      deleteNode(manager, LEVEL, organizationId, id)
    );
  }

  /**
   * Restore a Lever and the subtree its deletion took with it.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Lever
   * @returns Its id, with `deletedAt` back to `null`
   * @throws Error with status 403 without the manager role, 404 when absent, 409 when it is not
   *   deleted, 409 when its channel was taken again meanwhile
   */
  public async restore(actor: AuthContext, organizationId: string, id: string): Promise<DeletionResult> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<DeletionResult> => {
      const node: TreeNodeRow = await findNodeOrFail(manager, LEVEL, organizationId, id, { deleted: true });
      await this.assertChannelFree(manager, node.campaignId as string, node.lever as Lever);
      return restoreNode(manager, LEVEL, organizationId, id);
    });
  }

  /**
   * Post a set of Labels on a Lever, replacing what it carried.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Lever
   * @param body - The complete list of Label ids
   * @returns The Lever, with the Labels it now carries
   * @throws Error with status 403 without the manager role, 404 when the Lever or a Label is absent
   */
  public async setLabels(
    actor: AuthContext,
    organizationId: string,
    id: string,
    body: SetLabelsBody
  ): Promise<CampaignLever> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<CampaignLever> => {
      const row: TreeNodeRow = await findNodeOrFail(manager, LEVEL, organizationId, id);
      const posted: LabelSummary[] = await this.labels.setOn(manager, organizationId, LEVEL, row.id, body.labelIds);
      return toCampaignLever(row as LeverEntity, await budgetBlockOf(manager, LEVEL, row), posted);
    });
  }

  /**
   * Refuse a distribution key the channel cannot serve.
   *
   * @param lever - The channel
   * @param shares - The platforms and their shares
   * @returns Nothing
   * @throws Error with status 400 coded `platform_not_eligible`, `platform_share_duplicated` or
   *   `platform_shares_invalid`
   */
  private assertKey(lever: Lever, shares: PlatformShare[]): void {
    for (const share of shares) assertPlatformEligible(lever, share.platform);
    assertSharesComplete(shares);
  }

  /**
   * Refuse a Products mode on a channel that has no Products mode (L13, L14).
   *
   * @param lever - The channel
   * @param wanted - Whether the caller asked for it
   * @returns Nothing
   * @throws Error with status 400 coded `products_mode_not_permitted`
   */
  private assertProductsMode(lever: Lever, wanted: boolean): void {
    if (!wanted || profileOf(lever).productsModePermitted) return;
    throw httpError(400, `The ${lever} lever has no Products mode`, {
      code: 'products_mode_not_permitted',
      params: { lever },
    });
  }

  /**
   * Refuse a channel that could not express what its campaign already carries.
   *
   * A capping written on a campaign applies to every lever it carries, so adding a `search` lever to
   * a capped campaign would store a value no Search platform can express (L6). The refusal names the
   * field, so the user knows what to move or clear.
   *
   * @param lever - The channel being added
   * @param campaign - The campaign it is added to
   * @returns Nothing
   * @throws Error with status 400 coded `lever_field_forbidden`
   */
  private assertCampaignExpressible(lever: Lever, campaign: TreeNodeRow): void {
    const carried: Record<RuledField, boolean> = {
      // A campaign always carries a budget and a window: both are mandatory columns, and every
      // profile requires them at that level. Only the capping is optional, hence only it is read.
      budget: true,
      dates: true,
      capping: campaign.capping != null,
    };
    for (const field of CAMPAIGN_FIELDS) {
      assertFieldAllowedForLevers([lever], 'campaign', field, carried[field]);
    }
  }

  /**
   * Refuse restoring a Lever whose channel was taken again while it was deleted.
   *
   * The unique index is partial, so the database would accept two live levers of the same channel
   * only if one of them were deleted; this is the clean 409 instead of a constraint violation.
   *
   * @param manager - The transaction
   * @param campaignId - The Campaign
   * @param lever - The channel
   * @returns Nothing
   * @throws Error with status 409 coded `lever_already_exists`
   */
  private async assertChannelFree(manager: EntityManager, campaignId: string, lever: Lever): Promise<void> {
    const taken: boolean = await manager.exists(LeverEntity, { where: { campaignId, lever } });
    if (!taken) return;
    throw httpError(409, `This campaign already carries its ${lever} lever`, {
      code: 'lever_already_exists',
      params: { lever },
    });
  }

  /**
   * Save a Lever, turning a lost race on its channel into the same 409 as the check before it.
   *
   * @param manager - The transaction
   * @param lever - The row to save
   * @param channel - The channel being written, for the message
   * @returns The saved row
   * @throws Error with status 409 coded `lever_already_exists`
   */
  private async save(manager: EntityManager, lever: LeverEntity, channel: Lever): Promise<LeverEntity> {
    try {
      return await manager.save(LeverEntity, lever);
    } catch (error: unknown) {
      if ((error as { code?: string }).code !== UNIQUE_VIOLATION) throw error;
      throw httpError(409, `This campaign already carries its ${channel} lever`, {
        code: 'lever_already_exists',
        params: { lever: channel },
        cause: error,
      });
    }
  }

  /**
   * The API shapes of several Levers, each with its resolved budget and its Labels.
   *
   * @param manager - Where to read
   * @param rows - The rows
   * @returns Their API shapes, in the same order
   */
  private async toApi(manager: EntityManager, rows: LeverEntity[]): Promise<CampaignLever[]> {
    const byResource: Map<string, LabelSummary[]> = await this.labels.summariesOf(
      manager,
      LEVEL,
      rows.map((row: LeverEntity): string => row.id)
    );
    const levers: CampaignLever[] = [];
    for (const row of rows) {
      levers.push(
        toCampaignLever(row, await budgetBlockOf(manager, LEVEL, row as TreeNodeRow), byResource.get(row.id) ?? [])
      );
    }
    return levers;
  }
}

/**
 * Fastify plugin that decorates the instance with a {@link LeverService}.
 *
 * Depends on `DatabasePlugin`, `AccessServicePlugin` and `LabelServicePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function leverServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('leverService', new LeverService(fastify.db, fastify.accessService, fastify.labelService));
}

export default fastifyPlugin(leverServicePlugin, {
  name: 'LeverServicePlugin',
  dependencies: ['DatabasePlugin', 'AccessServicePlugin', 'LabelServicePlugin'],
});
