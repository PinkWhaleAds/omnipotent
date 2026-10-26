import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource, EntityManager, ObjectLiteral } from 'typeorm';

import { TargetingGroupEntity } from '@src/database/entities';
import { Paginated } from '@src/types/api.types';
import { AuthContext } from '@src/types/auth.types';
import { BulkIdsBody, BulkResult, DeletionResult, SetLabelsBody } from '@src/types/crud.types';
import { LabelSummary } from '@src/types/label.types';
import { Lever } from '@src/types/lever.types';
import {
  BulkCreateTargetingGroupsBody,
  BulkUpdateTargetingGroupsBody,
  CreateTargetingGroupBody,
  ListTargetingGroupsQuery,
  TargetingGroup,
  UpdateTargetingGroupBody,
} from '@src/types/targeting-group.types';
import { toPage } from '@utils';
import { AccessService } from './access.service';
import { runBulk } from './crud.helpers';
import { assertDistinctIds, LabelService } from './label.service';
import { deleteNode, findNodeOrFail, listNodes, normalizeNodeWrite, restoreNode } from './node.helpers';
import { budgetBlockOf, TreeNodeRow } from './tree.helpers';

/** The level this service owns. */
const LEVEL = 'targeting_group' as const;

/**
 * Map a TargetingGroup row to its API shape.
 *
 * @param entity - The row
 * @param budget - Its budget, resolved at read time
 * @param labels - The Labels posted on it
 * @returns The API representation
 */
export function toTargetingGroup(
  entity: TargetingGroupEntity,
  budget: TargetingGroup['budget'],
  labels: LabelSummary[] = []
): TargetingGroup {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    campaignId: entity.campaignId,
    adGroupId: entity.adGroupId,
    lever: entity.lever,
    name: entity.name,
    status: entity.status,
    bidAmountCents: entity.bidAmountCents,
    budget,
    capping: entity.capping,
    labels,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
    deletedAt: entity.deletedAt?.toISOString() ?? null,
  };
}

/**
 * Manages the TargetingGroups of a TargetingGroup: the level that carries **all the targeting** (D14), and
 * the real bidding object of the platforms — a Google ad group, a DV360 line item, a Meta ad set.
 *
 * It has **no window**: a TargetingGroup is a targeting applied, not a period of delivery. Of the
 * bidding it holds only the **amount**, the strategy staying on the AdGroup, which is the object the
 * platforms carry a budget on (L3). The targeting dimensions arrive with their own phase.
 */
export class TargetingGroupService {
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
   * List the TargetingGroups of an AdGroup.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param adGroupId - The AdGroup
   * @param query - Page, sort, search, label filter, and whether the deleted ones are listed
   * @returns A page of AdGroups
   * @throws Error with status 404 when the caller cannot see the Organization or the AdGroup
   */
  public async list(
    actor: AuthContext,
    organizationId: string,
    adGroupId: string,
    query: ListTargetingGroupsQuery
  ): Promise<Paginated<TargetingGroup>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    await findNodeOrFail(this.dataSource.manager, 'ad_group', organizationId, adGroupId, { deleted: true });

    const [rows, total]: [TreeNodeRow[], number] = await listNodes(
      this.dataSource,
      LEVEL,
      { organizationId, parentId: adGroupId },
      query,
      'name'
    );
    return toPage(await this.toApi(this.dataSource.manager, rows as TargetingGroupEntity[]), total, query);
  }

  /**
   * Read one AdGroup.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The TargetingGroup
   * @returns The TargetingGroup, with its budget resolved and its Labels
   * @throws Error with status 404 when the caller cannot see it
   */
  public async get(actor: AuthContext, organizationId: string, id: string): Promise<TargetingGroup> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    const row: TreeNodeRow = await findNodeOrFail(this.dataSource.manager, LEVEL, organizationId, id, {
      deleted: true,
    });
    const [targetingGroup]: TargetingGroup[] = await this.toApi(this.dataSource.manager, [row as TargetingGroupEntity]);
    return targetingGroup;
  }

  /**
   * Create a TargetingGroup under a TargetingGroup.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param adGroupId - The AdGroup
   * @param body - What the caller sent
   * @returns The created AdGroup
   * @throws Error with status 403 without the manager role, 404 on an unknown AdGroup or Label, 400 on
   *   an objective, a strategy, a platform or a field its lever refuses
   */
  public async create(
    actor: AuthContext,
    organizationId: string,
    adGroupId: string,
    body: CreateTargetingGroupBody
  ): Promise<TargetingGroup> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction((manager: EntityManager): Promise<TargetingGroup> =>
      this.createOne(manager, organizationId, adGroupId, body)
    );
  }

  /**
   * Change a TargetingGroup. A field left out is left alone.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The TargetingGroup
   * @param body - Fields to change
   * @returns The updated AdGroup
   * @throws Error with status 403 without the manager role, 404 when absent, 400 on a refused field
   */
  public async update(
    actor: AuthContext,
    organizationId: string,
    id: string,
    body: UpdateTargetingGroupBody
  ): Promise<TargetingGroup> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction((manager: EntityManager): Promise<TargetingGroup> =>
      this.updateOne(manager, organizationId, id, body)
    );
  }

  /**
   * Soft-delete a TargetingGroup **and its whole subtree** (D19).
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The TargetingGroup
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
   * Restore a TargetingGroup and the subtree its deletion took with it.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The TargetingGroup
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
   * Post a set of Labels on a TargetingGroup, replacing what it carried.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The TargetingGroup
   * @param body - The complete list of Label ids
   * @returns The TargetingGroup, with the Labels it now carries
   * @throws Error with status 403 without the manager role, 404 when the TargetingGroup or a Label is absent
   */
  public async setLabels(
    actor: AuthContext,
    organizationId: string,
    id: string,
    body: SetLabelsBody
  ): Promise<TargetingGroup> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<TargetingGroup> => {
      const row: TreeNodeRow = await findNodeOrFail(manager, LEVEL, organizationId, id);
      const posted: LabelSummary[] = await this.labels.setOn(manager, organizationId, LEVEL, row.id, body.labelIds);
      return toTargetingGroup(row as TargetingGroupEntity, await budgetBlockOf(manager, LEVEL, row), posted);
    });
  }

  /**
   * Create several TargetingGroups under one AdGroup, atomically or item by item.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param adGroupId - The AdGroup
   * @param body - The mode and the items
   * @returns What was created, and what was not
   * @throws Error with status 403 without the manager role, or the first failure in `atomic` mode
   */
  public async bulkCreate(
    actor: AuthContext,
    organizationId: string,
    adGroupId: string,
    body: BulkCreateTargetingGroupsBody
  ): Promise<BulkResult<TargetingGroup>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return runBulk(
      this.dataSource,
      body.mode,
      body.items,
      (item: CreateTargetingGroupBody, _index, manager: EntityManager) =>
        this.createOne(manager, organizationId, adGroupId, item)
    );
  }

  /**
   * Change several TargetingGroups, atomically or item by item.
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
    body: BulkUpdateTargetingGroupsBody
  ): Promise<BulkResult<TargetingGroup>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    assertDistinctIds(body.items.map((item: { id: string }): string => item.id));
    return runBulk(this.dataSource, body.mode, body.items, ({ id, ...changes }, _index, manager: EntityManager) =>
      this.updateOne(manager, organizationId, id, changes)
    );
  }

  /**
   * Soft-delete several TargetingGroups, each with its subtree.
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
   * Restore several TargetingGroups, each with the subtree its deletion took.
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
   * @param adGroupId - The AdGroup
   * @param body - What the caller sent
   * @returns The created AdGroup
   * @throws Error with status 404 on an unknown AdGroup or Label, 400 on a refused field
   */
  private async createOne(
    manager: EntityManager,
    organizationId: string,
    adGroupId: string,
    body: CreateTargetingGroupBody
  ): Promise<TargetingGroup> {
    const parent: TreeNodeRow = await findNodeOrFail(manager, 'ad_group', organizationId, adGroupId);
    const lever: Lever = parent.lever as Lever;

    const columns: ObjectLiteral = await normalizeNodeWrite(
      manager,
      {
        level: LEVEL,
        levers: [lever],
        parentId: adGroupId,
        nodeId: null,
        campaignId: parent.campaignId as string,
        // Its own amount, else its AdGroup's: that is the CPM a volume entry converts through.
        bidAmountCents: body.bidAmountCents ?? (parent.bidAmountCents as number | null),
      },
      body
    );
    const created: TargetingGroupEntity = await manager.save(
      TargetingGroupEntity,
      manager.create(TargetingGroupEntity, {
        organizationId,
        campaignId: parent.campaignId as string,
        adGroupId,
        lever,
        name: body.name,
        bidAmountCents: body.bidAmountCents ?? null,
        ...columns,
      })
    );
    const posted: LabelSummary[] = body.labelIds?.length
      ? await this.labels.setOn(manager, organizationId, LEVEL, created.id, body.labelIds)
      : [];
    return toTargetingGroup(created, await budgetBlockOf(manager, LEVEL, created as TreeNodeRow), posted);
  }

  /**
   * Change one AdGroup inside a transaction.
   *
   * @param manager - The transaction
   * @param organizationId - The Organization
   * @param id - The TargetingGroup
   * @param body - Fields to change
   * @returns The updated AdGroup
   * @throws Error with status 404 when absent, 400 on a refused field
   */
  private async updateOne(
    manager: EntityManager,
    organizationId: string,
    id: string,
    body: UpdateTargetingGroupBody
  ): Promise<TargetingGroup> {
    const current: TreeNodeRow = await findNodeOrFail(manager, LEVEL, organizationId, id);
    const lever: Lever = current.lever as Lever;
    const parent: TreeNodeRow = await findNodeOrFail(manager, 'ad_group', organizationId, current.adGroupId as string);

    const columns: ObjectLiteral = await normalizeNodeWrite(
      manager,
      {
        level: LEVEL,
        levers: [lever],
        parentId: current.adGroupId as string,
        nodeId: id,
        current,
        bidAmountCents:
          body.bidAmountCents ?? (current.bidAmountCents as number | null) ?? (parent.bidAmountCents as number | null),
      },
      body
    );
    const saved: TargetingGroupEntity = await manager.save(TargetingGroupEntity, {
      ...(current as TargetingGroupEntity),
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.bidAmountCents === undefined ? {} : { bidAmountCents: body.bidAmountCents }),
      ...columns,
    });
    const [updated]: TargetingGroup[] = await this.toApi(manager, [saved]);
    return updated;
  }

  /**
   * The API shapes of several TargetingGroups, each with its resolved budget and its Labels.
   *
   * @param manager - Where to read
   * @param rows - The rows
   * @returns Their API shapes, in the same order
   */
  private async toApi(manager: EntityManager, rows: TargetingGroupEntity[]): Promise<TargetingGroup[]> {
    const byResource: Map<string, LabelSummary[]> = await this.labels.summariesOf(
      manager,
      LEVEL,
      rows.map((row: TargetingGroupEntity): string => row.id)
    );
    const targetingGroups: TargetingGroup[] = [];
    for (const row of rows) {
      targetingGroups.push(
        toTargetingGroup(row, await budgetBlockOf(manager, LEVEL, row as TreeNodeRow), byResource.get(row.id) ?? [])
      );
    }
    return targetingGroups;
  }
}

/**
 * Fastify plugin that decorates the instance with an {@link TargetingGroupService}.
 *
 * Depends on `DatabasePlugin`, `AccessServicePlugin` and `LabelServicePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function targetingGroupServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate(
    'targetingGroupService',
    new TargetingGroupService(fastify.db, fastify.accessService, fastify.labelService)
  );
}

export default fastifyPlugin(targetingGroupServicePlugin, {
  name: 'TargetingGroupServicePlugin',
  dependencies: ['DatabasePlugin', 'AccessServicePlugin', 'LabelServicePlugin'],
});
