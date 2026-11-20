import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource, EntityManager, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';

import { AdvertiserEntity, CampaignEntity, LeverEntity } from '@src/database/entities';
import { Paginated } from '@src/types/api.types';
import { AuthContext } from '@src/types/auth.types';
import {
  BulkCreateCampaignsBody,
  BulkUpdateCampaignsBody,
  Campaign,
  CreateCampaignBody,
  ListCampaignsQuery,
  UpdateCampaignBody,
} from '@src/types/campaign.types';
import { BulkIdsBody, BulkResult, DeletionResult, SetLabelsBody } from '@src/types/crud.types';
import { LabelSummary } from '@src/types/label.types';
import { Lever } from '@src/types/lever.types';
import { escapeLike, httpError, toPage, toSkipTake, withoutAccents, withoutAccentsSql } from '@utils';
import { AccessService } from './access.service';
import { applyLabelFilter, runBulk, toOrder } from './crud.helpers';
import { assertDistinctIds, LabelService } from './label.service';
import { deleteNode, findNodeOrFail, normalizeNodeWrite, restoreNode } from './node.helpers';
import { nextAppointment, startInstant } from './pacing.helpers';
import { budgetBlockOf, TreeNodeRow } from './tree.helpers';

/** The level this service owns, as the profiles and the label assignments name it. */
const LEVEL = 'campaign' as const;

/**
 * Map a Campaign row to its API shape.
 *
 * @param entity - The row
 * @param budget - Its budget, resolved at read time
 * @param labels - The Labels posted on it
 * @returns The API representation
 */
export function toCampaign(entity: CampaignEntity, budget: Campaign['budget'], labels: LabelSummary[] = []): Campaign {
  return {
    id: entity.id,
    organizationId: entity.organizationId,
    advertiserId: entity.advertiserId,
    name: entity.name,
    status: entity.status,
    currency: entity.currency,
    timezone: entity.timezone,
    startsOn: entity.startsOn,
    startTime: entity.startTime ?? null,
    endsOn: entity.endsOn,
    budget,
    capping: entity.capping ?? [],
    insertionOrderNumber: entity.insertionOrderNumber,
    containsPoliticalAdvertising: entity.containsPoliticalAdvertising,
    labels,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
    deletedAt: entity.deletedAt?.toISOString() ?? null,
  };
}

/**
 * Manages the Campaigns of an Advertiser: the root of the tree, and the only level where the budget,
 * the dates and the currency are mandatory.
 *
 * It is also the only level above the channels, which is why its own fields are checked against
 * **every lever it carries** (`src/levers/lever-profiles.ts`): a capping written here would apply to
 * a Search lever too, and no Search platform can express one.
 *
 * Viewers read; managers create, change, delete, restore and label. The lifecycle — `draft`,
 * `preview`, `launch` — belongs to its own phase; what is here is the node.
 */
export class CampaignService {
  /**
   * Create the service.
   *
   * @param dataSource - Application database
   * @param access - Permission checks
   * @param labels - Posting and reading the Labels of a resource
   * @param now - Current time, injectable so a test owns the clock
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: AccessService,
    private readonly labels: LabelService,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * List the Campaigns of an Advertiser.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param advertiserId - The Advertiser
   * @param query - Page, sort, search, label filter, and whether the deleted ones are listed
   * @returns A page of Campaigns
   * @throws Error with status 404 when the caller cannot see the Organization or the Advertiser
   */
  public async list(
    actor: AuthContext,
    organizationId: string,
    advertiserId: string,
    query: ListCampaignsQuery
  ): Promise<Paginated<Campaign>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    await this.assertAdvertiser(this.dataSource.manager, organizationId, advertiserId);

    const builder: SelectQueryBuilder<CampaignEntity> = this.repository()
      .createQueryBuilder(LEVEL)
      .withDeleted()
      .where('campaign.organization_id = :organizationId', { organizationId })
      .andWhere('campaign.advertiser_id = :advertiserId', { advertiserId });
    if (!query.includeDeleted) builder.andWhere('campaign.deleted_at IS NULL');
    if (query.search) {
      builder.andWhere(`${withoutAccentsSql('campaign.name')} ILIKE :search`, {
        search: `%${escapeLike(withoutAccents(query.search))}%`,
      });
    }
    applyLabelFilter(builder, LEVEL, query.labelIds, query.labelMode);

    const { skip, take } = toSkipTake(query);
    for (const [field, direction] of Object.entries(toOrder(query.sortBy, query.sortOrder))) {
      builder.addOrderBy(`campaign.${field}`, direction);
    }
    const [rows, total]: [CampaignEntity[], number] = await builder.skip(skip).take(take).getManyAndCount();
    return toPage(await this.toApi(this.dataSource.manager, rows), total, query);
  }

  /**
   * Read one Campaign.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Campaign
   * @returns The Campaign, with its budget resolved and its Labels
   * @throws Error with status 404 when the caller cannot see it
   */
  public async get(actor: AuthContext, organizationId: string, id: string): Promise<Campaign> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    const row: TreeNodeRow = await findNodeOrFail(this.dataSource.manager, LEVEL, organizationId, id, {
      deleted: true,
    });
    const [campaign]: Campaign[] = await this.toApi(this.dataSource.manager, [row as CampaignEntity]);
    return campaign;
  }

  /**
   * Create a Campaign under an Advertiser.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param advertiserId - The Advertiser it runs for
   * @param body - Name, currency, window, budget, and the rest
   * @returns The created Campaign
   * @throws Error with status 403 without the manager role, 404 on an unknown Advertiser or Label,
   *   400 when the window is reversed
   */
  public async create(
    actor: AuthContext,
    organizationId: string,
    advertiserId: string,
    body: CreateCampaignBody
  ): Promise<Campaign> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction((manager: EntityManager): Promise<Campaign> =>
      this.createOne(manager, organizationId, advertiserId, body)
    );
  }

  /**
   * Change a Campaign. A field left out is left alone.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Campaign
   * @param body - Fields to change
   * @returns The updated Campaign
   * @throws Error with status 403 without the manager role, 404 when absent, 400 on a refused field
   */
  public async update(
    actor: AuthContext,
    organizationId: string,
    id: string,
    body: UpdateCampaignBody
  ): Promise<Campaign> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction((manager: EntityManager): Promise<Campaign> =>
      this.updateOne(manager, organizationId, id, body)
    );
  }

  /**
   * Soft-delete a Campaign **and its whole subtree** (D19).
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Campaign
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
   * Restore a Campaign and the subtree its deletion took with it.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Campaign
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
   * Post a set of Labels on a Campaign, replacing what it carried.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The Campaign
   * @param body - The complete list of Label ids
   * @returns The Campaign, with the Labels it now carries
   * @throws Error with status 403 without the manager role, 404 when the Campaign or a Label is absent
   */
  public async setLabels(
    actor: AuthContext,
    organizationId: string,
    id: string,
    body: SetLabelsBody
  ): Promise<Campaign> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<Campaign> => {
      const row: TreeNodeRow = await findNodeOrFail(manager, LEVEL, organizationId, id);
      const posted: LabelSummary[] = await this.labels.setOn(manager, organizationId, LEVEL, row.id, body.labelIds);
      return toCampaign(row as CampaignEntity, await budgetBlockOf(manager, LEVEL, row), posted);
    });
  }

  /**
   * Create several Campaigns under one Advertiser, atomically or item by item.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param advertiserId - The Advertiser
   * @param body - The mode and the items
   * @returns What was created, and what was not
   * @throws Error with status 403 without the manager role, or the first failure in `atomic` mode
   */
  public async bulkCreate(
    actor: AuthContext,
    organizationId: string,
    advertiserId: string,
    body: BulkCreateCampaignsBody
  ): Promise<BulkResult<Campaign>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return runBulk(this.dataSource, body.mode, body.items, (item: CreateCampaignBody, _index, manager: EntityManager) =>
      this.createOne(manager, organizationId, advertiserId, item)
    );
  }

  /**
   * Change several Campaigns, atomically or item by item.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param body - The mode and the items, each naming the Campaign it changes
   * @returns What was changed, and what was not
   * @throws Error with status 403 without the manager role, 400 on a duplicated id
   */
  public async bulkUpdate(
    actor: AuthContext,
    organizationId: string,
    body: BulkUpdateCampaignsBody
  ): Promise<BulkResult<Campaign>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    assertDistinctIds(body.items.map((item: { id: string }): string => item.id));
    return runBulk(this.dataSource, body.mode, body.items, ({ id, ...changes }, _index, manager: EntityManager) =>
      this.updateOne(manager, organizationId, id, changes)
    );
  }

  /**
   * Soft-delete several Campaigns, each with its subtree.
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
   * Restore several Campaigns, each with the subtree its deletion took.
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
   * Repository of the Campaigns table.
   *
   * @returns The repository
   */
  private repository(): Repository<CampaignEntity> {
    return this.dataSource.getRepository(CampaignEntity);
  }

  /**
   * Create one Campaign inside a transaction.
   *
   * @param manager - The transaction
   * @param organizationId - The Organization
   * @param advertiserId - The Advertiser
   * @param body - What the caller sent
   * @returns The created Campaign
   * @throws Error with status 404 on an unknown Advertiser or Label, 400 on a refused field
   */
  private async createOne(
    manager: EntityManager,
    organizationId: string,
    advertiserId: string,
    body: CreateCampaignBody
  ): Promise<Campaign> {
    await this.assertAdvertiser(manager, organizationId, advertiserId);
    // A campaign is born without a lever, so there is no profile to refuse anything yet; the lever
    // that would refuse a field checks the campaign's own values when it is added.
    const columns: ObjectLiteral = await normalizeNodeWrite(
      manager,
      { level: LEVEL, levers: [], parentId: null, nodeId: null },
      body
    );

    const created: CampaignEntity = await manager.save(
      CampaignEntity,
      manager.create(CampaignEntity, {
        organizationId,
        advertiserId,
        name: body.name,
        currency: body.currency,
        timezone: body.timezone ?? null,
        startTime: body.startTime ?? null,
        insertionOrderNumber: body.insertionOrderNumber ?? null,
        containsPoliticalAdvertising: body.containsPoliticalAdvertising,
        capping: body.capping ?? null,
        ...columns,
      })
    );
    const posted: LabelSummary[] = body.labelIds?.length
      ? await this.labels.setOn(manager, organizationId, LEVEL, created.id, body.labelIds)
      : [];
    return toCampaign(created, await budgetBlockOf(manager, LEVEL, created as TreeNodeRow), posted);
  }

  /**
   * Change one Campaign inside a transaction.
   *
   * @param manager - The transaction
   * @param organizationId - The Organization
   * @param id - The Campaign
   * @param body - Fields to change
   * @returns The updated Campaign
   * @throws Error with status 404 when absent, 400 on a refused field
   */
  private async updateOne(
    manager: EntityManager,
    organizationId: string,
    id: string,
    body: UpdateCampaignBody
  ): Promise<Campaign> {
    const current: TreeNodeRow = await findNodeOrFail(manager, LEVEL, organizationId, id);
    // A draft may say yes — the preview is what then refuses to launch it (D53). A campaign that is
    // already out there may not: the platforms hold our declaration that it carries no political
    // advertising, and flipping the field here would leave them with a statement we no longer make.
    // Stopping a live campaign because of a late declaration is a feature of its own, not a silent
    // consequence of a PATCH.
    if (body.containsPoliticalAdvertising === true && (current as CampaignEntity).status !== 'draft') {
      throw httpError(400, 'A launched campaign cannot be declared as political advertising', {
        code: 'campaign_political_advertising_unsupported',
        params: { status: (current as CampaignEntity).status },
      });
    }
    const columns: ObjectLiteral = await normalizeNodeWrite(
      manager,
      { level: LEVEL, levers: await this.leversOf(manager, id), parentId: null, nodeId: id, current, campaignId: id },
      body
    );
    const appointment: Date | null = this.movedStart(current as CampaignEntity, body);

    const saved: CampaignEntity = await manager.save(CampaignEntity, {
      ...(current as CampaignEntity),
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.startTime === undefined ? {} : { startTime: body.startTime }),
      ...(appointment === null ? {} : { nextPacingAt: appointment }),
      ...(body.timezone === undefined ? {} : { timezone: body.timezone }),
      ...(body.insertionOrderNumber === undefined ? {} : { insertionOrderNumber: body.insertionOrderNumber }),
      ...(body.containsPoliticalAdvertising === undefined
        ? {}
        : { containsPoliticalAdvertising: body.containsPoliticalAdvertising }),
      ...columns,
    });
    const [campaign]: Campaign[] = await this.toApi(manager, [saved]);
    return campaign;
  }

  /**
   * Check a move of a launched campaign's start, and say when it must next be looked at.
   *
   * A draft moves freely. A launched campaign moves its first day and its start time **only while
   * they are to come**, and only to a moment still to come: the platforms hold it paused until then,
   * and its appointment is brought forward to wake it at the new start (`docs/phase-10.md` § 8.4,
   * point 3).
   *
   * @param current - The campaign as it is
   * @param body - What the caller sent
   * @returns Its next appointment when the start moves on a launched campaign, `null` otherwise
   * @throws Error with status 400 coded `campaign_start_reached` once the start has passed, or
   *   `campaign_start_past` for a new start already gone
   */
  private movedStart(current: CampaignEntity, body: UpdateCampaignBody): Date | null {
    const startsOn: string = body.startsOn ?? current.startsOn;
    const startTime: string | null = body.startTime === undefined ? current.startTime : body.startTime;
    if (current.status === 'draft' || (startsOn === current.startsOn && startTime === current.startTime)) return null;

    // A launched campaign has its timezone frozen.
    const timezone: string = current.timezone as string;
    const now: number = this.now();
    if (startInstant(current.startsOn, current.startTime, timezone) <= now) {
      throw httpError(400, 'This campaign has already started: its start cannot move any more', {
        code: 'campaign_start_reached',
        params: { startsOn: current.startsOn, startTime: current.startTime },
      });
    }
    const start: number = startInstant(startsOn, startTime, timezone);
    if (start <= now) {
      throw httpError(400, 'A launched campaign cannot be moved to a start already gone', {
        code: 'campaign_start_past',
        params: { startsOn, startTime },
      });
    }
    return nextAppointment(current.nextPacingAt as Date, start, now);
  }

  /**
   * The channels the Campaign already carries, which its own fields are checked against.
   *
   * @param manager - Where to read
   * @param campaignId - The Campaign
   * @returns Its levers, without duplicates
   */
  private async leversOf(manager: EntityManager, campaignId: string): Promise<Lever[]> {
    const rows: { lever: Lever }[] = await manager.find(LeverEntity, {
      where: { campaignId },
      select: { lever: true },
    });
    return [...new Set(rows.map((row: { lever: Lever }): Lever => row.lever))];
  }

  /**
   * Refuse an Advertiser that does not live in this Organization.
   *
   * Read directly rather than through `AdvertiserService`, which would check the role a second time
   * for the same request; the Organization has already been asserted by the caller of this method.
   *
   * @param manager - Where to read
   * @param organizationId - The Organization
   * @param advertiserId - The Advertiser
   * @returns Nothing
   * @throws Error with status 404 coded `advertiser_not_found`
   */
  private async assertAdvertiser(manager: EntityManager, organizationId: string, advertiserId: string): Promise<void> {
    const exists: boolean = await manager.exists(AdvertiserEntity, {
      where: { id: advertiserId, organizationId },
    });
    if (!exists) throw httpError(404, 'Advertiser not found', { code: 'advertiser_not_found' });
  }

  /**
   * The API shapes of several Campaigns, each with its resolved budget and its Labels.
   *
   * @param manager - Where to read
   * @param rows - The rows
   * @returns Their API shapes, in the same order
   */
  private async toApi(manager: EntityManager, rows: CampaignEntity[]): Promise<Campaign[]> {
    const byResource: Map<string, LabelSummary[]> = await this.labels.summariesOf(
      manager,
      LEVEL,
      rows.map((row: CampaignEntity): string => row.id)
    );
    const campaigns: Campaign[] = [];
    for (const row of rows) {
      campaigns.push(
        toCampaign(row, await budgetBlockOf(manager, LEVEL, row as TreeNodeRow), byResource.get(row.id) ?? [])
      );
    }
    return campaigns;
  }
}

/**
 * Fastify plugin that decorates the instance with a {@link CampaignService}.
 *
 * Depends on `DatabasePlugin`, `AccessServicePlugin` and `LabelServicePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function campaignServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('campaignService', new CampaignService(fastify.db, fastify.accessService, fastify.labelService));
}

export default fastifyPlugin(campaignServicePlugin, {
  name: 'CampaignServicePlugin',
  dependencies: ['DatabasePlugin', 'AccessServicePlugin', 'LabelServicePlugin'],
});
