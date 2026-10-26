import { randomUUID } from 'node:crypto';

import { DataSource, Repository } from 'typeorm';

import { databaseConfig, DatabaseConfig } from '@configs/database.config';
import {
  AdGroupEntity,
  AdvertiserEntity,
  CampaignEntity,
  ENTITIES,
  LeverEntity,
  TargetingGroupEntity,
} from '@src/database/entities';
import { Targeting } from '@src/types';
import { createDataSource } from '@src/database/data-source';

/**
 * Connection settings of the throwaway integration database: the configured
 * server, with `_it` appended to the database name.
 */
export const INTEGRATION_DATABASE: DatabaseConfig = { ...databaseConfig, name: `${databaseConfig.name}_it` };

/**
 * Open a data source on the integration database and apply pending migrations.
 *
 * The schema is built only by the migrations, so the suite also proves they
 * produce what the entities expect.
 *
 * @returns An initialized data source; destroy it after use
 */
export async function connectIntegrationDatabase(): Promise<DataSource> {
  const dataSource: DataSource = createDataSource(INTEGRATION_DATABASE);
  await dataSource.initialize();
  await dataSource.runMigrations({ transaction: 'all' });
  return dataSource;
}

/**
 * Empty every application table, keeping the schema.
 *
 * The tables are those of the registered entities, so a phase that adds one does not have to list it
 * here; children are emptied with their parent (`CASCADE`).
 *
 * @param dataSource - Data source on the integration database
 * @returns A promise that resolves once the tables are empty
 */
export async function truncateAll(dataSource: DataSource): Promise<void> {
  if (ENTITIES.length === 0) return;
  const tables: string[] = ENTITIES.map(
    (entity: new () => unknown): string => `"${dataSource.getMetadata(entity).tableName}"`
  );
  await dataSource.query(`TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}

/** The ids of a seeded campaign tree, from the Advertiser down to the TargetingGroup. */
export type SeededTree = {
  /** The Advertiser the campaign runs for, and whose library the assets belong to. */
  advertiserId: string;
  /** Its campaign. */
  campaignId: string;
  /** Its lever. */
  leverId: string;
  /** Its AdGroup. */
  adGroupId: string;
  /** Its TargetingGroup, the level that carries the targeting. */
  targetingGroupId: string;
};

/**
 * Insert a whole campaign tree, so a spec can test what hangs from it.
 *
 * The chain is what the foreign keys of phase 3 require — an Advertiser, a campaign, a lever, an
 * AdGroup, a TargetingGroup — and it lives here rather than in each spec, two phases needing it.
 *
 * @param dataSource - Data source on the integration database
 * @param organizationId - The Organization everything belongs to
 * @param targeting - What the TargetingGroup targets, empty by default
 * @returns The ids of the tree
 *
 * @example
 * ```typescript
 * const tree: SeededTree = await seedTree(dataSource, ORGANIZATION);
 * ```
 */
export async function seedTree(
  dataSource: DataSource,
  organizationId: string,
  targeting: Targeting = {}
): Promise<SeededTree> {
  const advertisers: Repository<AdvertiserEntity> = dataSource.getRepository(AdvertiserEntity);
  const advertiser: AdvertiserEntity = await advertisers.save(
    advertisers.create({ organizationId, name: `Herbéa ${randomUUID()}`, websiteUrl: null })
  );
  const campaigns: Repository<CampaignEntity> = dataSource.getRepository(CampaignEntity);
  const campaign: CampaignEntity = await campaigns.save(
    campaigns.create({
      organizationId,
      advertiserId: advertiser.id,
      name: 'Automne',
      status: 'draft',
      currency: 'EUR',
      timezone: null,
      startsOn: '2027-01-01',
      endsOn: '2027-01-07',
      budgetCents: 70_000,
      budgetVolume: null,
      budgetVolumeUnit: null,
      capping: null,
      insertionOrderNumber: null,
    })
  );
  const levers: Repository<LeverEntity> = dataSource.getRepository(LeverEntity);
  const lever: LeverEntity = await levers.save(
    levers.create({
      organizationId,
      campaignId: campaign.id,
      lever: 'dac',
      status: 'active',
      productsMode: false,
      platformShares: [{ platform: 'dv360', shareBasisPoints: 10_000 }],
      budgetCents: null,
      budgetVolume: null,
      budgetVolumeUnit: null,
      startsOn: null,
      endsOn: null,
      capping: null,
    })
  );
  const adGroups: Repository<AdGroupEntity> = dataSource.getRepository(AdGroupEntity);
  const adGroup: AdGroupEntity = await adGroups.save(
    adGroups.create({
      organizationId,
      campaignId: campaign.id,
      leverId: lever.id,
      lever: 'dac',
      name: 'Grand Paris',
      status: 'active',
      objective: 'awareness',
      bidStrategy: 'fixed_cpm',
      bidAmountCents: null,
      platformShares: null,
      budgetCents: null,
      budgetVolume: null,
      budgetVolumeUnit: null,
      startsOn: null,
      endsOn: null,
      capping: null,
    })
  );
  const nodes: Repository<TargetingGroupEntity> = dataSource.getRepository(TargetingGroupEntity);
  const node: TargetingGroupEntity = await nodes.save(
    nodes.create({
      organizationId,
      campaignId: campaign.id,
      adGroupId: adGroup.id,
      lever: 'dac',
      name: 'Île-de-France',
      status: 'active',
      targeting,
      bidAmountCents: null,
      budgetCents: null,
      budgetVolume: null,
      budgetVolumeUnit: null,
      capping: null,
    })
  );
  return {
    advertiserId: advertiser.id,
    campaignId: campaign.id,
    leverId: lever.id,
    adGroupId: adGroup.id,
    targetingGroupId: node.id,
  };
}
