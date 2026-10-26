import { createHash } from 'node:crypto';

import { DataSource, QueryFailedError, Repository } from 'typeorm';

import {
  AssetEntity,
  CreativeEntity,
  CreativeVersionAssetEntity,
  CreativeVersionEntity,
  LineEntity,
} from '@src/database/entities';
import { connectIntegrationDatabase, seedTree, SeededTree, truncateAll } from './database.utils';

/**
 * What only a real PostgreSQL can prove about the schema of phase 6: an asset is **deduplicated per
 * Advertiser**, an asset a version uses **cannot be deleted outright**, a version is unique inside
 * its creative, and the same creative does not deliver twice on the same targeting
 * (`docs/phase-6.md` § 2, § 6 and § 9).
 */
describe('Integration::Phase6', () => {
  const ORGANIZATION = 'c0000000-0000-4000-8000-000000000001';
  let dataSource: DataSource;
  let tree: SeededTree;

  /**
   * Put an asset in a library.
   *
   * @param advertiserId - Whose library
   * @param content - The bytes it stands for; the same content gives the same fingerprint
   * @param fileName - Its name
   * @returns The row
   */
  async function insertAsset(advertiserId: string, content: string, fileName = 'banniere.png'): Promise<AssetEntity> {
    const assets: Repository<AssetEntity> = dataSource.getRepository(AssetEntity);
    return assets.save(
      assets.create({
        organizationId: ORGANIZATION,
        advertiserId,
        fileName,
        kind: 'image',
        mimeType: 'image/png',
        sizeBytes: content.length,
        width: 300,
        height: 250,
        durationMs: null,
        fingerprint: createHash('sha256').update(content).digest('hex'),
        provenance: 'uploaded',
        aiGenerationId: null,
        storageKey: `${ORGANIZATION}/${advertiserId}/${fileName}`,
      })
    );
  }

  /**
   * Create a creative with one version, and link an asset to it.
   *
   * @param assetId - The asset the version uses
   * @returns The creative and its version
   */
  async function insertCreative(
    assetId: string
  ): Promise<{ creative: CreativeEntity; version: CreativeVersionEntity }> {
    const creatives: Repository<CreativeEntity> = dataSource.getRepository(CreativeEntity);
    const creative: CreativeEntity = await creatives.save(
      creatives.create({
        organizationId: ORGANIZATION,
        advertiserId: tree.advertiserId,
        name: `Bannière ${assetId}`,
        format: 'display',
        subtype: 'image',
        iabCategories: [],
        iabTaxonomyVersion: null,
        clickThroughUrl: null,
        activeVersionId: null,
      })
    );
    const versions: Repository<CreativeVersionEntity> = dataSource.getRepository(CreativeVersionEntity);
    const version: CreativeVersionEntity = await versions.save(
      versions.create({
        organizationId: ORGANIZATION,
        creativeId: creative.id,
        version: 1,
        payload: { altText: 'Bannière' },
        trackers: [],
      })
    );
    const links: Repository<CreativeVersionAssetEntity> = dataSource.getRepository(CreativeVersionAssetEntity);
    await links.save(links.create({ versionId: version.id, assetId, role: 'image' }));
    await creatives.update({ id: creative.id }, { activeVersionId: version.id });
    return { creative, version };
  }

  beforeAll(async (): Promise<void> => {
    dataSource = await connectIntegrationDatabase();
  });

  afterAll(async (): Promise<void> => {
    await dataSource.destroy();
  });

  beforeEach(async (): Promise<void> => {
    await truncateAll(dataSource);
    tree = await seedTree(dataSource, ORGANIZATION);
  });

  it('should hold one asset per Advertiser and per fingerprint, among the living ones', async (): Promise<void> => {
    await insertAsset(tree.advertiserId, 'les mêmes octets');

    await expect(insertAsset(tree.advertiserId, 'les mêmes octets', 'copie.png')).rejects.toBeInstanceOf(
      QueryFailedError
    );
  });

  it('should let another Advertiser hold the same file, as its own asset', async (): Promise<void> => {
    const other: SeededTree = await seedTree(dataSource, ORGANIZATION);
    await insertAsset(tree.advertiserId, 'les mêmes octets');

    await expect(insertAsset(other.advertiserId, 'les mêmes octets')).resolves.toMatchObject({
      advertiserId: other.advertiserId,
    });
  });

  it('should free the fingerprint of a deleted asset', async (): Promise<void> => {
    const asset: AssetEntity = await insertAsset(tree.advertiserId, 'les mêmes octets');
    await dataSource.getRepository(AssetEntity).update({ id: asset.id }, { deletedAt: new Date() });

    await expect(insertAsset(tree.advertiserId, 'les mêmes octets')).resolves.toMatchObject({
      fingerprint: asset.fingerprint,
    });
  });

  it('should refuse to delete the row of an asset a version uses, whatever the code does', async (): Promise<void> => {
    const asset: AssetEntity = await insertAsset(tree.advertiserId, 'des octets');
    await insertCreative(asset.id);

    // The service answers 409 before trying; the foreign key is what makes that promise true.
    await expect(dataSource.getRepository(AssetEntity).delete({ id: asset.id })).rejects.toBeInstanceOf(
      QueryFailedError
    );
  });

  it('should take the links of a version when the version goes', async (): Promise<void> => {
    const asset: AssetEntity = await insertAsset(tree.advertiserId, 'des octets');
    const { version } = await insertCreative(asset.id);

    await dataSource.getRepository(CreativeVersionEntity).delete({ id: version.id });

    await expect(dataSource.getRepository(CreativeVersionAssetEntity).count()).resolves.toBe(0);
    // The asset survives its creative: it is a resource of its own, not an attachment.
    await expect(dataSource.getRepository(AssetEntity).count()).resolves.toBe(1);
  });

  it('should hold one version per number inside a creative', async (): Promise<void> => {
    const asset: AssetEntity = await insertAsset(tree.advertiserId, 'des octets');
    const { creative } = await insertCreative(asset.id);
    const versions: Repository<CreativeVersionEntity> = dataSource.getRepository(CreativeVersionEntity);

    await expect(
      versions.save(
        versions.create({
          organizationId: ORGANIZATION,
          creativeId: creative.id,
          version: 1,
          payload: {},
          trackers: [],
        })
      )
    ).rejects.toBeInstanceOf(QueryFailedError);
    await expect(
      versions.save(
        versions.create({
          organizationId: ORGANIZATION,
          creativeId: creative.id,
          version: 2,
          payload: {},
          trackers: [],
        })
      )
    ).resolves.toMatchObject({ version: 2 });
  });

  it('should refuse the same creative twice on one TargetingGroup, among the living Lines', async (): Promise<void> => {
    const asset: AssetEntity = await insertAsset(tree.advertiserId, 'des octets');
    const { creative } = await insertCreative(asset.id);
    const lines: Repository<LineEntity> = dataSource.getRepository(LineEntity);
    const line = {
      organizationId: ORGANIZATION,
      campaignId: tree.campaignId,
      targetingGroupId: tree.targetingGroupId,
      lever: 'dac' as const,
      name: 'Bannière',
      status: 'active' as const,
      creativeId: creative.id,
      trackers: null,
      landingPageUrl: null,
      budgetCents: null,
      budgetVolume: null,
      budgetVolumeUnit: null,
      startsOn: null,
      endsOn: null,
      capping: null,
    };
    const first: LineEntity = await lines.save(lines.create(line));

    await expect(lines.save(lines.create({ ...line, name: 'Doublon' }))).rejects.toBeInstanceOf(QueryFailedError);
    // Two Lines without a creative are fine: the uniqueness only looks at those that carry one.
    await expect(lines.save(lines.create({ ...line, name: 'Sans créa', creativeId: null }))).resolves.toMatchObject({
      creativeId: null,
    });
    await expect(lines.save(lines.create({ ...line, name: 'Sans créa 2', creativeId: null }))).resolves.toMatchObject({
      creativeId: null,
    });

    // And the pair frees itself when the Line is deleted.
    await lines.update({ id: first.id }, { deletedAt: new Date() });
    await expect(lines.save(lines.create({ ...line, name: 'Reprise' }))).resolves.toMatchObject({
      creativeId: creative.id,
    });
  });
});
