import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource, EntityManager, ObjectLiteral } from 'typeorm';

import { LineEntity } from '@src/database/entities';
import { Paginated } from '@src/types/api.types';
import { AuthContext } from '@src/types/auth.types';
import { BulkIdsBody, BulkResult, DeletionResult, SetLabelsBody } from '@src/types/crud.types';
import { LabelSummary } from '@src/types/label.types';
import { Lever } from '@src/types/lever.types';
import {
  BulkCreateLinesBody,
  BulkUpdateLinesBody,
  CreateLineBody,
  Line,
  ListLinesQuery,
  UpdateLineBody,
} from '@src/types/line.types';
import { toPage } from '@utils';
import { AccessService } from './access.service';
import { runBulk } from './crud.helpers';
import { assertDistinctIds, LabelService } from './label.service';
import { deleteNode, findNodeOrFail, listNodes, normalizeNodeWrite, restoreNode } from './node.helpers';
import { budgetBlockOf, TreeNodeRow } from './tree.helpers';

/** The level this service owns. */
const LEVEL = 'line' as const;

/**
 * Map a Line row to its API shape.
 *
 * @param entity - The row
 * @param budget - Its budget, resolved at read time
 * @param labels - The Labels posted on it
 * @returns The API representation
 */
export function toLine(entity: LineEntity, budget: Line['budget'], labels: LabelSummary[] = []): Line {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    campaignId: entity.campaignId,
    targetingGroupId: entity.targetingGroupId,
    lever: entity.lever,
    name: entity.name,
    status: entity.status,
    landingPageUrl: entity.landingPageUrl,
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
 * Manages the Lines of a TargetingGroup: the level that carries **all the targeting** (D14), and
 * the real bidding object of the platforms — a Google ad group, a DV360 line item, a Meta ad set.
 *
 * It has **no window**: a TargetingGroup is a targeting applied, not a period of delivery. Of the
 * bidding it holds only the **amount**, the strategy staying on the AdGroup, which is the object the
 * platforms carry a budget on (L3). The targeting dimensions arrive with their own phase.
 */
export class LineService {
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
   * List the Lines of a TargetingGroup.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param targetingGroupId - The TargetingGroup
   * @param query - Page, sort, search, label filter, and whether the deleted ones are listed
   * @returns A page of AdGroups
   * @throws Error with status 404 when the caller cannot see the Organization or the TargetingGroup
   */
  public async list(
    actor: AuthContext,
    organizationId: string,
    targetingGroupId: string,
    query: ListLinesQuery
  ): Promise<Paginated<Line>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    await findNodeOrFail(this.dataSource.manager, 'targeting_group', organizationId, targetingGroupId, {
      deleted: true,
    });

    const [rows, total]: [TreeNodeRow[], number] = await listNodes(
      this.dataSource,
      LEVEL,
      { organizationId, parentId: targetingGroupId },
      query,
      'name'
    );
    return toPage(await this.toApi(this.dataSource.manager, rows as LineEntity[]), total, query);
  }

  /**
   * Read one AdGroup.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Line
   * @returns The Line, with its budget resolved and its Labels
   * @throws Error with status 404 when the caller cannot see it
   */
  public async get(actor: AuthContext, organizationId: string, id: string): Promise<Line> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    const row: TreeNodeRow = await findNodeOrFail(this.dataSource.manager, LEVEL, organizationId, id, {
      deleted: true,
    });
    const [line]: Line[] = await this.toApi(this.dataSource.manager, [row as LineEntity]);
    return line;
  }

  /**
   * Create a Line under a TargetingGroup.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param targetingGroupId - The TargetingGroup
   * @param body - What the caller sent
   * @returns The created AdGroup
   * @throws Error with status 403 without the manager role, 404 on an unknown TargetingGroup or Label, 400 on
   *   an objective, a strategy, a platform or a field its lever refuses
   */
  public async create(
    actor: AuthContext,
    organizationId: string,
    targetingGroupId: string,
    body: CreateLineBody
  ): Promise<Line> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction((manager: EntityManager): Promise<Line> =>
      this.createOne(manager, organizationId, targetingGroupId, body)
    );
  }

  /**
   * Change a Line. A field left out is left alone.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Line
   * @param body - Fields to change
   * @returns The updated AdGroup
   * @throws Error with status 403 without the manager role, 404 when absent, 400 on a refused field
   */
  public async update(actor: AuthContext, organizationId: string, id: string, body: UpdateLineBody): Promise<Line> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction((manager: EntityManager): Promise<Line> =>
      this.updateOne(manager, organizationId, id, body)
    );
  }

  /**
   * Soft-delete a Line (D19).
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Line
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
   * Restore a Line and the subtree its deletion took with it.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Line
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
   * Post a set of Labels on a Line, replacing what it carried.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Line
   * @param body - The complete list of Label ids
   * @returns The Line, with the Labels it now carries
   * @throws Error with status 403 without the manager role, 404 when the Line or a Label is absent
   */
  public async setLabels(actor: AuthContext, organizationId: string, id: string, body: SetLabelsBody): Promise<Line> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<Line> => {
      const row: TreeNodeRow = await findNodeOrFail(manager, LEVEL, organizationId, id);
      const posted: LabelSummary[] = await this.labels.setOn(manager, organizationId, LEVEL, row.id, body.labelIds);
      return toLine(row as LineEntity, await budgetBlockOf(manager, LEVEL, row), posted);
    });
  }

  /**
   * Create several Lines under one TargetingGroup, atomically or item by item.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param targetingGroupId - The TargetingGroup
   * @param body - The mode and the items
   * @returns What was created, and what was not
   * @throws Error with status 403 without the manager role, or the first failure in `atomic` mode
   */
  public async bulkCreate(
    actor: AuthContext,
    organizationId: string,
    targetingGroupId: string,
    body: BulkCreateLinesBody
  ): Promise<BulkResult<Line>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return runBulk(this.dataSource, body.mode, body.items, (item: CreateLineBody, _index, manager: EntityManager) =>
      this.createOne(manager, organizationId, targetingGroupId, item)
    );
  }

  /**
   * Change several Lines, atomically or item by item.
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
    body: BulkUpdateLinesBody
  ): Promise<BulkResult<Line>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    assertDistinctIds(body.items.map((item: { id: string }): string => item.id));
    return runBulk(this.dataSource, body.mode, body.items, ({ id, ...changes }, _index, manager: EntityManager) =>
      this.updateOne(manager, organizationId, id, changes)
    );
  }

  /**
   * Soft-delete several Lines, each with its subtree.
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
   * Restore several Lines, each with the subtree its deletion took.
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
   * @param targetingGroupId - The TargetingGroup
   * @param body - What the caller sent
   * @returns The created AdGroup
   * @throws Error with status 404 on an unknown TargetingGroup or Label, 400 on a refused field
   */
  private async createOne(
    manager: EntityManager,
    organizationId: string,
    targetingGroupId: string,
    body: CreateLineBody
  ): Promise<Line> {
    const parent: TreeNodeRow = await findNodeOrFail(manager, 'targeting_group', organizationId, targetingGroupId);
    const lever: Lever = parent.lever as Lever;

    const columns: ObjectLiteral = await normalizeNodeWrite(
      manager,
      {
        level: LEVEL,
        levers: [lever],
        parentId: targetingGroupId,
        nodeId: null,
      },
      body
    );
    const created: LineEntity = await manager.save(
      LineEntity,
      manager.create(LineEntity, {
        organizationId,
        campaignId: parent.campaignId as string,
        targetingGroupId,
        lever,
        name: body.name,
        landingPageUrl: body.landingPageUrl ?? null,
        ...columns,
      })
    );
    const posted: LabelSummary[] = body.labelIds?.length
      ? await this.labels.setOn(manager, organizationId, LEVEL, created.id, body.labelIds)
      : [];
    return toLine(created, await budgetBlockOf(manager, LEVEL, created as TreeNodeRow), posted);
  }

  /**
   * Change one AdGroup inside a transaction.
   *
   * @param manager - The transaction
   * @param organizationId - The Organization
   * @param id - The Line
   * @param body - Fields to change
   * @returns The updated AdGroup
   * @throws Error with status 404 when absent, 400 on a refused field
   */
  private async updateOne(
    manager: EntityManager,
    organizationId: string,
    id: string,
    body: UpdateLineBody
  ): Promise<Line> {
    const current: TreeNodeRow = await findNodeOrFail(manager, LEVEL, organizationId, id);
    const lever: Lever = current.lever as Lever;

    const columns: ObjectLiteral = await normalizeNodeWrite(
      manager,
      {
        level: LEVEL,
        levers: [lever],
        parentId: current.targetingGroupId as string,
        nodeId: id,
        current,
      },
      body
    );
    const saved: LineEntity = await manager.save(LineEntity, {
      ...(current as LineEntity),
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.landingPageUrl === undefined ? {} : { landingPageUrl: body.landingPageUrl }),
      ...columns,
    });
    const [updated]: Line[] = await this.toApi(manager, [saved]);
    return updated;
  }

  /**
   * The API shapes of several Lines, each with its resolved budget and its Labels.
   *
   * @param manager - Where to read
   * @param rows - The rows
   * @returns Their API shapes, in the same order
   */
  private async toApi(manager: EntityManager, rows: LineEntity[]): Promise<Line[]> {
    const byResource: Map<string, LabelSummary[]> = await this.labels.summariesOf(
      manager,
      LEVEL,
      rows.map((row: LineEntity): string => row.id)
    );
    const lines: Line[] = [];
    for (const row of rows) {
      lines.push(toLine(row, await budgetBlockOf(manager, LEVEL, row as TreeNodeRow), byResource.get(row.id) ?? []));
    }
    return lines;
  }
}

/**
 * Fastify plugin that decorates the instance with an {@link LineService}.
 *
 * Depends on `DatabasePlugin`, `AccessServicePlugin` and `LabelServicePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function lineServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('lineService', new LineService(fastify.db, fastify.accessService, fastify.labelService));
}

export default fastifyPlugin(lineServicePlugin, {
  name: 'LineServicePlugin',
  dependencies: ['DatabasePlugin', 'AccessServicePlugin', 'LabelServicePlugin'],
});
