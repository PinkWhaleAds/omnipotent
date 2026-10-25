import { DataSource, QueryFailedError } from 'typeorm';

import {
  AdGroupEntity,
  AdvertiserEntity,
  CampaignEntity,
  KeywordEntity,
  LeverEntity,
  ListEntity,
  TargetingGroupEntity,
} from '@src/database/entities';
import { Targeting } from '@src/types';
import { connectIntegrationDatabase, truncateAll } from './database.utils';

/**
 * What only a real PostgreSQL can prove about the schema of phase 5: the **GIN** index answers which
 * TargetingGroups reference a list, a keyword is unique inside its node, and a list's name is unique
 * among the live ones of its kind (`docs/phase-5.md` § 3, § 4 and § 9).
 */
describe('Integration::Phase5', () => {
  const ORGANIZATION = 'c0000000-0000-4000-8000-000000000001';
  let dataSource: DataSource;
  let targetingGroupId: string;

  /**
   * Insert the chain a TargetingGroup needs — an Advertiser, a Campaign, a lever, an AdGroup — and
   * answer the id of a TargetingGroup targeting what was asked for.
   *
   * @param targeting - What the node targets
   * @returns Its id
   */
  async function insertNode(targeting: Targeting = {}): Promise<string> {
    const advertiser: AdvertiserEntity = await dataSource
      .getRepository(AdvertiserEntity)
      .save({ organizationId: ORGANIZATION, name: `Herbéa ${Math.random()}`, websiteUrl: null });
    const campaigns = dataSource.getRepository(CampaignEntity);
    const campaign: CampaignEntity = await campaigns.save(
      campaigns.create({
        organizationId: ORGANIZATION,
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
    const levers = dataSource.getRepository(LeverEntity);
    const lever: LeverEntity = await levers.save(
      levers.create({
        organizationId: ORGANIZATION,
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
    const adGroups = dataSource.getRepository(AdGroupEntity);
    const adGroup: AdGroupEntity = await adGroups.save(
      adGroups.create({
        organizationId: ORGANIZATION,
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
    const nodes = dataSource.getRepository(TargetingGroupEntity);
    const node: TargetingGroupEntity = await nodes.save(
      nodes.create({
        organizationId: ORGANIZATION,
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
    return node.id;
  }

  beforeAll(async (): Promise<void> => {
    dataSource = await connectIntegrationDatabase();
  });

  afterAll(async (): Promise<void> => {
    await dataSource.destroy();
  });

  beforeEach(async (): Promise<void> => {
    await truncateAll(dataSource);
    targetingGroupId = await insertNode();
  });

  it('should answer which TargetingGroups reference a list, through the GIN index', async (): Promise<void> => {
    const list: ListEntity = await dataSource
      .getRepository(ListEntity)
      .save(
        dataSource
          .getRepository(ListEntity)
          .create({ organizationId: ORGANIZATION, kind: 'app_site', name: 'Sites à exclure', items: [] })
      );
    const other: ListEntity = await dataSource
      .getRepository(ListEntity)
      .save(
        dataSource
          .getRepository(ListEntity)
          .create({ organizationId: ORGANIZATION, kind: 'app_site', name: 'Autres sites', items: [] })
      );
    const referencing: string = await insertNode({ app_site_lists: { include: [list.id], exclude: [] } });

    const found: { id: string }[] = await dataSource.query(
      `SELECT id FROM targeting_groups WHERE targeting @> $1::jsonb`,
      [JSON.stringify({ app_site_lists: { include: [list.id] } })]
    );
    const none: { id: string }[] = await dataSource.query(
      `SELECT id FROM targeting_groups WHERE targeting @> $1::jsonb`,
      [JSON.stringify({ app_site_lists: { include: [other.id] } })]
    );

    expect(found.map((row: { id: string }): string => row.id)).toEqual([referencing]);
    expect(none).toEqual([]);
  });

  it('should hold the index that serves that question', async (): Promise<void> => {
    const indexes: { indexdef: string }[] = await dataSource.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'targeting_groups' AND indexname = 'idx_targeting_groups_targeting'`
    );

    expect(indexes).toHaveLength(1);
    expect(indexes[0].indexdef).toContain('gin');
  });

  it('should store a targeting as an object, and answer it unchanged', async (): Promise<void> => {
    const targeting: Targeting = {
      country: { include: ['FR', 'BE'], exclude: [] },
      schedule: { windows: [{ day: 'monday', startHour: 9, endHour: 18 }], clock: 'campaign' },
    };
    const id: string = await insertNode(targeting);

    const node: TargetingGroupEntity | null = await dataSource
      .getRepository(TargetingGroupEntity)
      .findOne({ where: { id } });

    expect(node?.targeting).toEqual(targeting);
  });

  it('should hold one keyword per node, text, match type and polarity', async (): Promise<void> => {
    const keyword = {
      organizationId: ORGANIZATION,
      campaignId: (await dataSource.getRepository(TargetingGroupEntity).findOneByOrFail({ id: targetingGroupId }))
        .campaignId,
      targetingGroupId,
      text: 'chaussures de rando',
      matchType: 'exact' as const,
      negative: false,
    };
    const keywords = dataSource.getRepository(KeywordEntity);
    await keywords.save(keywords.create({ ...keyword }));

    // The same word with another match type is another keyword; the same triplet is refused.
    await keywords.save(keywords.create({ ...keyword, matchType: 'broad' }));
    await expect(keywords.save(keywords.create({ ...keyword }))).rejects.toBeInstanceOf(QueryFailedError);
    await expect(dataSource.getRepository(KeywordEntity).count()).resolves.toBe(2);
  });

  it('should free the name of a deleted list, and refuse it while it lives', async (): Promise<void> => {
    const list = { organizationId: ORGANIZATION, kind: 'app_site' as const, name: 'Sites à exclure', items: [] };
    const lists = dataSource.getRepository(ListEntity);
    const saved: ListEntity = await lists.save(lists.create({ ...list }));

    await expect(lists.save(lists.create({ ...list }))).rejects.toBeInstanceOf(QueryFailedError);
    // Another kind may carry the same name, and so may a new list once that one is deleted.
    await lists.save(lists.create({ ...list, kind: 'poi' }));
    await lists.update({ id: saved.id }, { deletedAt: new Date() });

    await expect(lists.save(lists.create({ ...list }))).resolves.toMatchObject({ name: 'Sites à exclure' });
  });
});
