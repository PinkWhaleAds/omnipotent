import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource, FindOptionsWhere } from 'typeorm';

import { AdGroupEntity, AdvertiserEntity, CampaignEntity, ConversionGoalEntity } from '@src/database/entities';
import {
  AuthContext,
  ConversionGoal,
  ConversionValueMode,
  CreateConversionGoalBody,
  ListConversionGoalsQuery,
  Paginated,
  UpdateConversionGoalBody,
} from '@src/types';
import { httpError, toPage, toSkipTake } from '@utils';
import { AccessService } from './access.service';

/** Asks for the conversion tracking of an Advertiser to be set up soon (a `conversion.setup` job). */
export interface TrackingScheduler {
  /**
   * Ask for a setup of an Advertiser's tracking and goals on its accounts.
   *
   * @param advertiserId - The Advertiser
   * @returns A promise that resolves once the request is queued
   */
  request(advertiserId: string): Promise<void>;
}

/** How a goal is valued, as stored. */
type GoalValue = Pick<ConversionGoalEntity, 'valueMode' | 'defaultValueCents' | 'currency'>;

/** Statuses of a campaign whose platforms bid. */
const LAUNCHED_STATUSES: readonly CampaignEntity['status'][] = ['active', 'paused'];

/**
 * Map a conversion goal row to its API shape.
 *
 * @param entity - The row
 * @returns The API representation
 */
export function toConversionGoal(entity: ConversionGoalEntity): ConversionGoal {
  return {
    id: entity.id,
    advertiserId: entity.advertiserId,
    key: entity.key,
    name: entity.name,
    category: entity.category,
    valueMode: entity.valueMode,
    defaultValueCents: entity.defaultValueCents,
    currency: entity.currency,
    counting: entity.counting,
    status: entity.status,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * The key of a goal as a platform naming its events after it reads it: `devis-pro` and `devis_pro` are
 * one there.
 *
 * @param key - The key of a goal
 * @returns The key, its dashes turned into underscores
 */
function eventKeyOf(key: string): string {
  return key.replace(/-/g, '_');
}

/**
 * Manages the conversion goals of the Advertisers: what their site sends with
 * `msq('conversion', { goal: '<key>' })`, set up at each platform by the tracking service (D58,
 * `docs/phase-10.md` § 8.10). Transcribed from multi-search.
 *
 * Viewers read; managers create, change and archive. A goal is never deleted. Every change asks for a
 * setup of the Advertiser's tracking.
 */
export class ConversionGoalService {
  /**
   * Create the service.
   *
   * @param dataSource - Application database
   * @param access - Permission checks
   * @param tracking - Asks for the setup of the Advertiser's tracking after a change
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: AccessService,
    private readonly tracking: TrackingScheduler
  ) {}

  /**
   * List the conversion goals of an Advertiser, oldest first.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param advertiserId - The Advertiser
   * @param query - Page and status filter
   * @returns A page of goals
   * @throws Error with status 404 coded `advertiser_not_found`
   */
  public async list(
    actor: AuthContext,
    organizationId: string,
    advertiserId: string,
    query: ListConversionGoalsQuery
  ): Promise<Paginated<ConversionGoal>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    await this.assertAdvertiser(organizationId, advertiserId);
    const where: FindOptionsWhere<ConversionGoalEntity> = { organizationId, advertiserId };
    if (query.status) where.status = query.status;
    const [rows, total]: [ConversionGoalEntity[], number] = await this.dataSource
      .getRepository(ConversionGoalEntity)
      .findAndCount({ where, order: { createdAt: 'ASC', id: 'ASC' }, ...toSkipTake(query) });
    return toPage(rows.map(toConversionGoal), total, query);
  }

  /**
   * Read a conversion goal.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The goal
   * @returns The goal
   * @throws Error with status 404 coded `conversion_goal_not_found`
   */
  public async get(actor: AuthContext, organizationId: string, id: string): Promise<ConversionGoal> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    return toConversionGoal(await this.goalOrFail(organizationId, id));
  }

  /**
   * Create a conversion goal, then ask for its setup at the platforms.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param advertiserId - The Advertiser
   * @param body - The goal
   * @returns The goal, `active`
   * @throws Error with status 404 coded `advertiser_not_found`, 400 for a value without currency or a
   *   fixed value without amount, 409 when the Advertiser already has a goal with that key, or with a
   *   key a platform would not tell apart (see {@link assertKeyFree})
   */
  public async create(
    actor: AuthContext,
    organizationId: string,
    advertiserId: string,
    body: CreateConversionGoalBody
  ): Promise<ConversionGoal> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    await this.assertAdvertiser(organizationId, advertiserId);
    const value: GoalValue = normalizeValue(body.valueMode, body.defaultValueCents ?? null, body.currency ?? null);
    await this.assertKeyFree(advertiserId, body.key);
    const repository = this.dataSource.getRepository(ConversionGoalEntity);
    const goal: ConversionGoalEntity = await repository.save(
      repository.create({
        organizationId,
        advertiserId,
        key: body.key,
        name: body.name,
        category: body.category,
        ...value,
        counting: body.counting,
        status: 'active',
      })
    );
    await this.tracking.request(advertiserId);
    return toConversionGoal(goal);
  }

  /**
   * Change a conversion goal — its key and category are fixed —, then ask for its setup at the
   * platforms. Archiving stops measuring it, and is refused while an AdGroup of a launched campaign
   * optimizes it.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The goal
   * @param body - Fields to change
   * @returns The goal
   * @throws Error with status 404 coded `conversion_goal_not_found`, 400 for a value without currency
   *   or a fixed value without amount, 409 coded `conversion_goal_optimized` when archiving a goal an
   *   AdGroup of a launched campaign optimizes
   */
  public async update(
    actor: AuthContext,
    organizationId: string,
    id: string,
    body: UpdateConversionGoalBody
  ): Promise<ConversionGoal> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    const goal: ConversionGoalEntity = await this.goalOrFail(organizationId, id);
    const value: GoalValue = normalizeValue(
      body.valueMode ?? goal.valueMode,
      body.defaultValueCents === undefined ? goal.defaultValueCents : body.defaultValueCents,
      body.currency === undefined ? goal.currency : body.currency
    );
    if (body.status === 'archived' && goal.status === 'active') await this.assertNotOptimized(goal);

    Object.assign(goal, {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.counting === undefined ? {} : { counting: body.counting }),
      ...(body.status === undefined ? {} : { status: body.status }),
      ...value,
    });
    const saved: ConversionGoalEntity = await this.dataSource.getRepository(ConversionGoalEntity).save(goal);
    await this.tracking.request(goal.advertiserId);
    return toConversionGoal(saved);
  }

  /**
   * Refuse an Advertiser the Organization does not have, or no longer has.
   *
   * @param organizationId - The Organization
   * @param advertiserId - The Advertiser
   * @returns Nothing
   * @throws Error with status 404 coded `advertiser_not_found`
   */
  private async assertAdvertiser(organizationId: string, advertiserId: string): Promise<void> {
    const exists: boolean = await this.dataSource.manager.exists(AdvertiserEntity, {
      where: { id: advertiserId, organizationId },
    });
    if (!exists) throw httpError(404, 'Advertiser not found', { code: 'advertiser_not_found' });
  }

  /**
   * Refuse a key another goal of the Advertiser has, archived ones included, or one a platform naming
   * its events after the keys would not tell apart (`devis-pro` and `devis_pro`): their conversions
   * would count for each other.
   *
   * @param advertiserId - The Advertiser
   * @param key - The key of the new goal
   * @returns Nothing
   * @throws Error with status 409 coded `conversion_goal_key_taken` for the same key,
   *   `conversion_goal_key_too_close` for a key a platform would not tell apart
   */
  private async assertKeyFree(advertiserId: string, key: string): Promise<void> {
    const existing: ConversionGoalEntity | undefined = (
      await this.dataSource
        .getRepository(ConversionGoalEntity)
        .find({ where: { advertiserId }, select: { id: true, key: true } })
    ).find((goal: ConversionGoalEntity): boolean => eventKeyOf(goal.key) === eventKeyOf(key));
    if (existing?.key === key) {
      throw httpError(409, `This Advertiser already has a conversion goal with the key '${key}'`, {
        code: 'conversion_goal_key_taken',
        params: { key },
      });
    }
    if (existing) {
      throw httpError(
        409,
        `The key '${key}' is too close to the key '${existing.key}' of another conversion goal of this Advertiser: ` +
          'a platform would not tell them apart',
        { code: 'conversion_goal_key_too_close', params: { key, existingKey: existing.key } }
      );
    }
  }

  /**
   * Refuse archiving a goal an AdGroup of a launched campaign optimizes: its platforms keep bidding for
   * it.
   *
   * @param goal - The goal
   * @returns Nothing
   * @throws Error with status 409 coded `conversion_goal_optimized`, naming the first such AdGroup
   */
  private async assertNotOptimized(goal: ConversionGoalEntity): Promise<void> {
    const rows: { adGroupId: string; adGroupName: string; campaignId: string; campaignName: string }[] =
      await this.dataSource
        .getRepository(AdGroupEntity)
        .createQueryBuilder('ad_group')
        .innerJoin(CampaignEntity, 'campaign', 'campaign.id = ad_group.campaign_id')
        .select([
          'ad_group.id AS "adGroupId"',
          'ad_group.name AS "adGroupName"',
          'campaign.id AS "campaignId"',
          'campaign.name AS "campaignName"',
        ])
        .where('ad_group.conversion_goal_id = :goalId', { goalId: goal.id })
        .andWhere('ad_group.bid_strategy = :strategy', { strategy: 'maximize_conversions' })
        .andWhere('campaign.status IN (:...statuses)', { statuses: LAUNCHED_STATUSES })
        .orderBy('campaign.name')
        .addOrderBy('ad_group.name')
        .limit(1)
        .getRawMany();
    const [first] = rows;
    if (first) {
      throw httpError(
        409,
        `The AdGroup '${first.adGroupName}' of the launched campaign '${first.campaignName}' optimizes this ` +
          'conversion goal: give it another goal or another strategy first',
        { code: 'conversion_goal_optimized', params: first }
      );
    }
  }

  /**
   * A conversion goal of the Organization.
   *
   * @param organizationId - The Organization
   * @param id - The goal
   * @returns The row
   * @throws Error with status 404 coded `conversion_goal_not_found`
   */
  private async goalOrFail(organizationId: string, id: string): Promise<ConversionGoalEntity> {
    const goal: ConversionGoalEntity | null = await this.dataSource
      .getRepository(ConversionGoalEntity)
      .findOneBy({ id, organizationId });
    if (!goal) throw httpError(404, 'Conversion goal not found', { code: 'conversion_goal_not_found' });
    return goal;
  }
}

/**
 * Check how a goal is valued. A goal without value keeps neither amount nor currency.
 *
 * @param valueMode - How it is valued
 * @param defaultValueCents - Fixed value, or fallback of a dynamic one
 * @param currency - Currency of the value
 * @returns What to store
 * @throws Error with status 400 coded `conversion_goal_currency_required` for a value without currency,
 *   `conversion_goal_value_required` for a fixed value without amount
 */
function normalizeValue(
  valueMode: ConversionValueMode,
  defaultValueCents: number | null,
  currency: string | null
): GoalValue {
  if (valueMode === 'none') return { valueMode, defaultValueCents: null, currency: null };
  if (currency === null) {
    throw httpError(400, 'A conversion goal with a value needs a currency', {
      code: 'conversion_goal_currency_required',
      params: { valueMode },
    });
  }
  if (valueMode === 'fixed' && defaultValueCents === null) {
    throw httpError(400, 'A conversion goal with a fixed value needs a defaultValueCents', {
      code: 'conversion_goal_value_required',
      params: { valueMode },
    });
  }
  return { valueMode, defaultValueCents, currency };
}

/**
 * Fastify plugin that decorates the instance with a {@link ConversionGoalService}.
 *
 * Depends on `DatabasePlugin`, `AccessServicePlugin` and `TrackingServicePlugin` (its scheduler).
 *
 * @param fastify - The Fastify instance to decorate
 * @returns A promise that resolves once decorated
 */
async function conversionGoalServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate(
    'conversionGoalService',
    new ConversionGoalService(fastify.db, fastify.accessService, fastify.trackingScheduler)
  );
}

export default fastifyPlugin(conversionGoalServicePlugin, {
  name: 'ConversionGoalServicePlugin',
  dependencies: ['DatabasePlugin', 'AccessServicePlugin', 'TrackingServicePlugin'],
});
