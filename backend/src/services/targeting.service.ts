import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';

import { ListEntity, TargetingGroupEntity } from '@src/database/entities';
import { assertDimensionPermitted, targetingDimensionsOf } from '@src/levers/lever-profiles';
import { allDimensions, listKindOf, parseTargeting } from '@src/targeting/dimensions';
import { AuthContext, ListKind, Targeting, TargetingDimension, TargetingResponse } from '@src/types';
import { httpError } from '@utils';
import { AccessService } from './access.service';

/**
 * The targeting of a TargetingGroup: one object, written atomically.
 *
 * Three doors, and they share everything but their payload: the whole object, one dimension, and the
 * removal of one. Every write goes through the same two judgements — the **lever profile** says
 * whether the dimension means anything at this level (a 400), and the **registry** says whether the
 * criteria hold (a 400) — so HTTP, MCP and a later job cannot disagree
 * (`docs/phase-5.md` § 1 and § 5).
 *
 * What a platform of that lever cannot express is **not** judged here: it is a preview warning, and
 * the campaign stays legitimate (L2).
 */
export class TargetingService {
  /**
   * Create the service.
   *
   * @param dataSource - Application database
   * @param access - Permission checks
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: AccessService
  ) {}

  /**
   * Read the targeting of a TargetingGroup.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param targetingGroupId - The node
   * @returns Its targeting, its lever, and what that lever permits
   * @throws Error with status 404 when the caller cannot see the node
   */
  public async get(actor: AuthContext, organizationId: string, targetingGroupId: string): Promise<TargetingResponse> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    const node: TargetingGroupEntity = await this.findOrFail(this.dataSource.manager, organizationId, targetingGroupId);
    return this.toResponse(node);
  }

  /**
   * Replace the whole targeting of a TargetingGroup.
   *
   * Atomic by nature: what the caller sends **is** the targeting afterwards, so dropping a dimension
   * is leaving it out. An empty object is valid — it restricts nothing.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param targetingGroupId - The node
   * @param targeting - The complete targeting
   * @returns Its targeting after the write
   * @throws Error with status 403 without the manager role, 404 when absent, 400 on a dimension the
   *   lever refuses, criteria that do not hold, or a list of the wrong kind
   */
  public async replace(
    actor: AuthContext,
    organizationId: string,
    targetingGroupId: string,
    targeting: Targeting
  ): Promise<TargetingResponse> {
    return this.write(actor, organizationId, targetingGroupId, async (node, manager) => {
      const parsed: Targeting = await this.validate(manager, organizationId, node, targeting);
      return parsed;
    });
  }

  /**
   * Post the criteria of one dimension, replacing what that dimension carried.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param targetingGroupId - The node
   * @param dimension - The dimension
   * @param criteria - Its criteria
   * @returns Its targeting after the write
   * @throws Error with status 403 without the manager role, 404 when absent, 400 on a dimension the
   *   lever refuses, criteria that do not hold, or a list of the wrong kind
   */
  public async setDimension(
    actor: AuthContext,
    organizationId: string,
    targetingGroupId: string,
    dimension: TargetingDimension,
    criteria: unknown
  ): Promise<TargetingResponse> {
    return this.write(actor, organizationId, targetingGroupId, async (node, manager) => {
      const one: Targeting = await this.validate(manager, organizationId, node, { [dimension]: criteria });
      return { ...node.targeting, ...one };
    });
  }

  /**
   * Drop one dimension from the targeting.
   *
   * Dropping a dimension it does not carry is **not** an error: the answer is the state asked for,
   * which is what makes a `DELETE` repeatable.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param targetingGroupId - The node
   * @param dimension - The dimension to drop
   * @returns Its targeting after the write
   * @throws Error with status 403 without the manager role, 404 when absent
   */
  public async removeDimension(
    actor: AuthContext,
    organizationId: string,
    targetingGroupId: string,
    dimension: TargetingDimension
  ): Promise<TargetingResponse> {
    return this.write(actor, organizationId, targetingGroupId, async (node) => {
      const kept: Targeting = { ...node.targeting };
      Reflect.deleteProperty(kept, dimension);
      return Promise.resolve(kept);
    });
  }

  /**
   * The TargetingGroups of an Organization whose targeting still references a list.
   *
   * Asked of the **registry** rather than of a join table: every dimension that points at lists is
   * tried, on both sides of its criteria, with a containment the GIN index serves
   * (`docs/phase-5.md` § 3). So a dimension added later is covered without touching this.
   *
   * @param manager - The transaction to read in
   * @param organizationId - The Organization
   * @param listId - The list
   * @returns The ids of the nodes referencing it
   *
   * @example
   * ```typescript
   * await targetingService.referencesOfList(manager, organizationId, listId);
   * ```
   */
  public async referencesOfList(manager: EntityManager, organizationId: string, listId: string): Promise<string[]> {
    const containments: string[] = allDimensions()
      .filter((dimension: TargetingDimension): boolean => listKindOf(dimension) !== null)
      .flatMap((dimension: TargetingDimension): string[] => [
        JSON.stringify({ [dimension]: { include: [listId] } }),
        JSON.stringify({ [dimension]: { exclude: [listId] } }),
      ]);
    const rows: { id: string }[] = await manager
      .createQueryBuilder(TargetingGroupEntity, 'node')
      .select('node.id', 'id')
      .where('node.organization_id = :organizationId', { organizationId })
      .andWhere('node.deleted_at IS NULL')
      .andWhere(
        containments
          .map((_: string, index: number): string => `node.targeting @> :containment${index}::jsonb`)
          .join(' OR '),
        Object.fromEntries(
          containments.map((containment: string, index: number): [string, string] => [
            `containment${index}`,
            containment,
          ])
        )
      )
      .getRawMany();
    return rows.map((row: { id: string }): string => row.id);
  }

  /**
   * Run a write: the manager role, the node, the shaping, and the store.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param targetingGroupId - The node
   * @param shape - What the targeting becomes
   * @returns Its targeting after the write
   */
  private async write(
    actor: AuthContext,
    organizationId: string,
    targetingGroupId: string,
    shape: (node: TargetingGroupEntity, manager: EntityManager) => Promise<Targeting>
  ): Promise<TargetingResponse> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<TargetingResponse> => {
      const node: TargetingGroupEntity = await this.findOrFail(manager, organizationId, targetingGroupId);
      const targeting: Targeting = await shape(node, manager);
      await manager.update(TargetingGroupEntity, { id: node.id }, { targeting });
      return this.toResponse({ ...node, targeting });
    });
  }

  /**
   * Judge a targeting: what the lever permits, what the registry accepts, and the lists it points at.
   *
   * @param manager - The transaction to read the lists in
   * @param organizationId - The Organization
   * @param node - The node being targeted
   * @param targeting - What the caller sent
   * @returns The criteria, parsed, with their defaults applied
   * @throws Error with status 400 on a dimension the lever refuses, criteria that do not hold, or a
   *   list absent or of the wrong kind
   */
  private async validate(
    manager: EntityManager,
    organizationId: string,
    node: TargetingGroupEntity,
    targeting: Targeting
  ): Promise<Targeting> {
    for (const dimension of Object.keys(targeting)) {
      assertDimensionPermitted(node.lever, dimension as TargetingDimension);
    }
    const parsed: Targeting = parseTargeting(targeting as Record<string, unknown>) as Targeting;
    await this.assertListsFit(manager, organizationId, parsed);
    return parsed;
  }

  /**
   * Refuse a list that does not exist, or that does not hold what the dimension expects.
   *
   * @param manager - The transaction to read in
   * @param organizationId - The Organization
   * @param targeting - The parsed targeting
   * @returns Nothing
   * @throws Error with status 404 when a list is absent, 400 coded `targeting_list_kind_mismatch`
   */
  private async assertListsFit(manager: EntityManager, organizationId: string, targeting: Targeting): Promise<void> {
    const wanted = new Map<string, ListKind>();
    for (const [dimension, criteria] of Object.entries(targeting)) {
      const kind: ListKind | null = listKindOf(dimension as TargetingDimension);
      if (kind === null) continue;
      const { include, exclude } = criteria as { include: string[]; exclude: string[] };
      for (const listId of [...include, ...exclude]) wanted.set(listId, kind);
    }
    if (wanted.size === 0) return;

    const rows: ListEntity[] = await manager.find(ListEntity, {
      where: { organizationId, id: In([...wanted.keys()]), deletedAt: IsNull() },
    });
    const kinds = new Map<string, ListKind>(rows.map((row: ListEntity): [string, ListKind] => [row.id, row.kind]));
    for (const [listId, expected] of wanted) {
      const kind: ListKind | undefined = kinds.get(listId);
      if (kind === undefined) {
        throw httpError(404, 'This list does not exist', { code: 'list_not_found', params: { listId } });
      }
      if (kind !== expected) {
        throw httpError(400, `This list holds ${kind} where the dimension expects ${expected}`, {
          code: 'targeting_list_kind_mismatch',
          params: { listId, kind, expected },
        });
      }
    }
  }

  /**
   * Find a TargetingGroup of the Organization, or answer 404.
   *
   * A deleted node is **not** found: its targeting is not something to read or write any more, and
   * the caller sees the same answer as for a node of another Organization.
   *
   * @param manager - The transaction to read in
   * @param organizationId - The Organization
   * @param id - The node
   * @returns The row
   * @throws Error with status 404 coded `targeting_group_not_found`
   */
  private async findOrFail(manager: EntityManager, organizationId: string, id: string): Promise<TargetingGroupEntity> {
    const node: TargetingGroupEntity | null = await manager.findOne(TargetingGroupEntity, {
      where: { id, organizationId, deletedAt: IsNull() },
    });
    if (!node) {
      throw httpError(404, 'This targeting group does not exist', { code: 'targeting_group_not_found' });
    }
    return node;
  }

  /**
   * Map a node to the answer of a targeting route.
   *
   * @param node - The row
   * @returns The API representation
   */
  private toResponse(node: TargetingGroupEntity): TargetingResponse {
    return {
      targetingGroupId: node.id,
      lever: node.lever,
      permittedDimensions: targetingDimensionsOf(node.lever),
      targeting: node.targeting,
    };
  }
}

/**
 * Fastify plugin that decorates the instance with a {@link TargetingService}.
 *
 * Depends on `DatabasePlugin` and `AccessServicePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function targetingServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('targetingService', new TargetingService(fastify.db, fastify.accessService));
}

export default fastifyPlugin(targetingServicePlugin, {
  name: 'TargetingServicePlugin',
  dependencies: ['DatabasePlugin', 'AccessServicePlugin'],
});
