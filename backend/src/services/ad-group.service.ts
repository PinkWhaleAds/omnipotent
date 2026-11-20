import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource, EntityManager, ObjectLiteral } from 'typeorm';

import { AdGroupEntity } from '@src/database/entities';
import {
  assertBidStrategyPermitted,
  assertObjectivePermitted,
  assertPlatformEligible,
  assertSearchFieldPermitted,
  defaultBidStrategyOf,
  defaultObjectiveOf,
} from '@src/levers/lever-profiles';
import {
  AdGroup,
  BulkCreateAdGroupsBody,
  BulkUpdateAdGroupsBody,
  CreateAdGroupBody,
  ListAdGroupsQuery,
  UpdateAdGroupBody,
} from '@src/types/ad-group.types';
import { Paginated } from '@src/types/api.types';
import { AuthContext } from '@src/types/auth.types';
import { BulkIdsBody, BulkResult, DeletionResult, SetLabelsBody } from '@src/types/crud.types';
import { LabelSummary } from '@src/types/label.types';
import { BidStrategy, Lever, Objective } from '@src/types/lever.types';
import { PlatformShare } from '@src/types/platform.types';
import { toPage } from '@utils';
import { AccessService } from './access.service';
import { assertSharesComplete } from './budget.helpers';
import { runBulk } from './crud.helpers';
import { assertDistinctIds, LabelService } from './label.service';
import { deleteNode, findNodeOrFail, listNodes, normalizeNodeWrite, restoreNode } from './node.helpers';
import { budgetBlockOf, TreeNodeRow } from './tree.helpers';

/** The level this service owns. */
const LEVEL = 'ad_group' as const;

/**
 * Map an AdGroup row to its API shape.
 *
 * @param entity - The row
 * @param budget - Its budget, resolved at read time
 * @param labels - The Labels posted on it
 * @returns The API representation
 */
export function toAdGroup(entity: AdGroupEntity, budget: AdGroup['budget'], labels: LabelSummary[] = []): AdGroup {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    campaignId: entity.campaignId,
    leverId: entity.leverId,
    lever: entity.lever,
    name: entity.name,
    status: entity.status,
    objective: entity.objective,
    bidStrategy: entity.bidStrategy,
    bidAmountCents: entity.bidAmountCents,
    platformShares: entity.platformShares,
    locationIntent: entity.locationIntent ?? null,
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
 * Manages the AdGroups of a Lever: the level that becomes **the budget-carrying object of the
 * platforms**, and therefore the one that holds the objective and the bidding strategy (L3, L4).
 *
 * Its lever's profile says which objectives and which strategies it may take, and gives the default
 * for each — so a node being written needs neither.
 */
export class AdGroupService {
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
   * List the AdGroups of a Lever.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param leverId - The Lever
   * @param query - Page, sort, search, label filter, and whether the deleted ones are listed
   * @returns A page of AdGroups
   * @throws Error with status 404 when the caller cannot see the Organization or the Lever
   */
  public async list(
    actor: AuthContext,
    organizationId: string,
    leverId: string,
    query: ListAdGroupsQuery
  ): Promise<Paginated<AdGroup>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    await findNodeOrFail(this.dataSource.manager, 'lever', organizationId, leverId, { deleted: true });

    const [rows, total]: [TreeNodeRow[], number] = await listNodes(
      this.dataSource,
      LEVEL,
      { organizationId, parentId: leverId },
      query,
      'name'
    );
    return toPage(await this.toApi(this.dataSource.manager, rows as AdGroupEntity[]), total, query);
  }

  /**
   * Read one AdGroup.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The AdGroup
   * @returns The AdGroup, with its budget resolved and its Labels
   * @throws Error with status 404 when the caller cannot see it
   */
  public async get(actor: AuthContext, organizationId: string, id: string): Promise<AdGroup> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    const row: TreeNodeRow = await findNodeOrFail(this.dataSource.manager, LEVEL, organizationId, id, {
      deleted: true,
    });
    const [adGroup]: AdGroup[] = await this.toApi(this.dataSource.manager, [row as AdGroupEntity]);
    return adGroup;
  }

  /**
   * Create an AdGroup under a Lever.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param leverId - The Lever
   * @param body - What the caller sent
   * @returns The created AdGroup
   * @throws Error with status 403 without the manager role, 404 on an unknown Lever or Label, 400 on
   *   an objective, a strategy, a platform or a field its lever refuses
   */
  public async create(
    actor: AuthContext,
    organizationId: string,
    leverId: string,
    body: CreateAdGroupBody
  ): Promise<AdGroup> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction((manager: EntityManager): Promise<AdGroup> =>
      this.createOne(manager, organizationId, leverId, body)
    );
  }

  /**
   * Change an AdGroup. A field left out is left alone.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The AdGroup
   * @param body - Fields to change
   * @returns The updated AdGroup
   * @throws Error with status 403 without the manager role, 404 when absent, 400 on a refused field
   */
  public async update(
    actor: AuthContext,
    organizationId: string,
    id: string,
    body: UpdateAdGroupBody
  ): Promise<AdGroup> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction((manager: EntityManager): Promise<AdGroup> =>
      this.updateOne(manager, organizationId, id, body)
    );
  }

  /**
   * Soft-delete an AdGroup **and its whole subtree** (D19).
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The AdGroup
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
   * Restore an AdGroup and the subtree its deletion took with it.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The AdGroup
   * @returns Its id, with `deletedAt` back to `null`
   * @throws Error with status 403 without the manager role, 404 when absent, 409 when it is not deleted
   */
  public async restore(actor: AuthContext, organizationId: string, id: string): Promise<DeletionResult> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction((manager: EntityManager): Promise<DeletionResult> =>
      restoreNode(manager, LEVEL, organizationId, id)
    );
  }

  /**
   * Post a set of Labels on an AdGroup, replacing what it carried.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The AdGroup
   * @param body - The complete list of Label ids
   * @returns The AdGroup, with the Labels it now carries
   * @throws Error with status 403 without the manager role, 404 when the AdGroup or a Label is absent
   */
  public async setLabels(
    actor: AuthContext,
    organizationId: string,
    id: string,
    body: SetLabelsBody
  ): Promise<AdGroup> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<AdGroup> => {
      const row: TreeNodeRow = await findNodeOrFail(manager, LEVEL, organizationId, id);
      const posted: LabelSummary[] = await this.labels.setOn(manager, organizationId, LEVEL, row.id, body.labelIds);
      return toAdGroup(row as AdGroupEntity, await budgetBlockOf(manager, LEVEL, row), posted);
    });
  }

  /**
   * Create several AdGroups under one Lever, atomically or item by item.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param leverId - The Lever
   * @param body - The mode and the items
   * @returns What was created, and what was not
   * @throws Error with status 403 without the manager role, or the first failure in `atomic` mode
   */
  public async bulkCreate(
    actor: AuthContext,
    organizationId: string,
    leverId: string,
    body: BulkCreateAdGroupsBody
  ): Promise<BulkResult<AdGroup>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return runBulk(this.dataSource, body.mode, body.items, (item: CreateAdGroupBody, _index, manager: EntityManager) =>
      this.createOne(manager, organizationId, leverId, item)
    );
  }

  /**
   * Change several AdGroups, atomically or item by item.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param body - The mode and the items, each naming the AdGroup it changes
   * @returns What was changed, and what was not
   * @throws Error with status 403 without the manager role, 400 on a duplicated id
   */
  public async bulkUpdate(
    actor: AuthContext,
    organizationId: string,
    body: BulkUpdateAdGroupsBody
  ): Promise<BulkResult<AdGroup>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    assertDistinctIds(body.items.map((item: { id: string }): string => item.id));
    return runBulk(this.dataSource, body.mode, body.items, ({ id, ...changes }, _index, manager: EntityManager) =>
      this.updateOne(manager, organizationId, id, changes)
    );
  }

  /**
   * Soft-delete several AdGroups, each with its subtree.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param body - The mode and the ids
   * @returns What was deleted, and what was not
   * @throws Error with status 403 without the manager role, 400 on a duplicated id
   */
  public async bulkDelete(
    actor: AuthContext,
    organizationId: string,
    body: BulkIdsBody
  ): Promise<BulkResult<DeletionResult>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    assertDistinctIds(body.ids);
    return runBulk(this.dataSource, body.mode, body.ids, (id: string, _index, manager: EntityManager) =>
      deleteNode(manager, LEVEL, organizationId, id)
    );
  }

  /**
   * Restore several AdGroups, each with the subtree its deletion took.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param body - The mode and the ids
   * @returns What was restored, and what was not
   * @throws Error with status 403 without the manager role, 400 on a duplicated id
   */
  public async bulkRestore(
    actor: AuthContext,
    organizationId: string,
    body: BulkIdsBody
  ): Promise<BulkResult<DeletionResult>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    assertDistinctIds(body.ids);
    return runBulk(this.dataSource, body.mode, body.ids, (id: string, _index, manager: EntityManager) =>
      restoreNode(manager, LEVEL, organizationId, id)
    );
  }

  /**
   * Create one AdGroup inside a transaction.
   *
   * @param manager - The transaction
   * @param organizationId - The Organization
   * @param leverId - The Lever
   * @param body - What the caller sent
   * @returns The created AdGroup
   * @throws Error with status 404 on an unknown Lever or Label, 400 on a refused field
   */
  private async createOne(
    manager: EntityManager,
    organizationId: string,
    leverId: string,
    body: CreateAdGroupBody
  ): Promise<AdGroup> {
    const parent: TreeNodeRow = await findNodeOrFail(manager, 'lever', organizationId, leverId);
    const lever: Lever = parent.lever as Lever;
    const objective: Objective = body.objective ?? defaultObjectiveOf(lever);
    const bidStrategy: BidStrategy = body.bidStrategy ?? defaultBidStrategyOf(lever);
    assertObjectivePermitted(lever, objective);
    assertBidStrategyPermitted(lever, bidStrategy);
    if (body.platformShares) this.assertKey(lever, body.platformShares);
    if (body.locationIntent != null) assertSearchFieldPermitted(lever, LEVEL, 'locationIntent');

    const columns: ObjectLiteral = await normalizeNodeWrite(
      manager,
      {
        level: LEVEL,
        levers: [lever],
        parentId: leverId,
        nodeId: null,
        campaignId: parent.campaignId as string,
        bidAmountCents: body.bidAmountCents ?? null,
      },
      body
    );
    const created: AdGroupEntity = await manager.save(
      AdGroupEntity,
      manager.create(AdGroupEntity, {
        organizationId,
        campaignId: parent.campaignId as string,
        leverId,
        lever,
        name: body.name,
        objective,
        bidStrategy,
        bidAmountCents: body.bidAmountCents ?? null,
        platformShares: body.platformShares ?? null,
        locationIntent: body.locationIntent ?? null,
        ...columns,
      })
    );
    const posted: LabelSummary[] = body.labelIds?.length
      ? await this.labels.setOn(manager, organizationId, LEVEL, created.id, body.labelIds)
      : [];
    return toAdGroup(created, await budgetBlockOf(manager, LEVEL, created as TreeNodeRow), posted);
  }

  /**
   * Change one AdGroup inside a transaction.
   *
   * @param manager - The transaction
   * @param organizationId - The Organization
   * @param id - The AdGroup
   * @param body - Fields to change
   * @returns The updated AdGroup
   * @throws Error with status 404 when absent, 400 on a refused field
   */
  private async updateOne(
    manager: EntityManager,
    organizationId: string,
    id: string,
    body: UpdateAdGroupBody
  ): Promise<AdGroup> {
    const current: TreeNodeRow = await findNodeOrFail(manager, LEVEL, organizationId, id);
    const lever: Lever = current.lever as Lever;
    if (body.objective !== undefined) assertObjectivePermitted(lever, body.objective);
    if (body.bidStrategy !== undefined) assertBidStrategyPermitted(lever, body.bidStrategy);
    if (body.platformShares) this.assertKey(lever, body.platformShares);
    if (body.locationIntent != null) assertSearchFieldPermitted(lever, LEVEL, 'locationIntent');

    const columns: ObjectLiteral = await normalizeNodeWrite(
      manager,
      {
        level: LEVEL,
        levers: [lever],
        parentId: current.leverId as string,
        nodeId: id,
        current,
        campaignId: current.campaignId as string,
        bidAmountCents: body.bidAmountCents ?? (current.bidAmountCents as number | null),
      },
      body
    );
    const saved: AdGroupEntity = await manager.save(AdGroupEntity, {
      ...(current as AdGroupEntity),
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.objective === undefined ? {} : { objective: body.objective }),
      ...(body.bidStrategy === undefined ? {} : { bidStrategy: body.bidStrategy }),
      ...(body.bidAmountCents === undefined ? {} : { bidAmountCents: body.bidAmountCents }),
      ...(body.platformShares === undefined ? {} : { platformShares: body.platformShares }),
      ...(body.locationIntent === undefined ? {} : { locationIntent: body.locationIntent }),
      ...columns,
    });
    const [updated]: AdGroup[] = await this.toApi(manager, [saved]);
    return updated;
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
   * The API shapes of several AdGroups, each with its resolved budget and its Labels.
   *
   * @param manager - Where to read
   * @param rows - The rows
   * @returns Their API shapes, in the same order
   */
  private async toApi(manager: EntityManager, rows: AdGroupEntity[]): Promise<AdGroup[]> {
    const byResource: Map<string, LabelSummary[]> = await this.labels.summariesOf(
      manager,
      LEVEL,
      rows.map((row: AdGroupEntity): string => row.id)
    );
    const adGroups: AdGroup[] = [];
    for (const row of rows) {
      adGroups.push(
        toAdGroup(row, await budgetBlockOf(manager, LEVEL, row as TreeNodeRow), byResource.get(row.id) ?? [])
      );
    }
    return adGroups;
  }
}

/**
 * Fastify plugin that decorates the instance with an {@link AdGroupService}.
 *
 * Depends on `DatabasePlugin`, `AccessServicePlugin` and `LabelServicePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function adGroupServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('adGroupService', new AdGroupService(fastify.db, fastify.accessService, fastify.labelService));
}

export default fastifyPlugin(adGroupServicePlugin, {
  name: 'AdGroupServicePlugin',
  dependencies: ['DatabasePlugin', 'AccessServicePlugin', 'LabelServicePlugin'],
});
