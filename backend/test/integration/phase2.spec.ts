import { DataSource, QueryFailedError } from 'typeorm';

import { AdvertiserEntity, LabelAssignmentEntity, LabelEntity } from '@src/database/entities';
import { connectIntegrationDatabase, truncateAll } from './database.utils';

/**
 * What only a real PostgreSQL can prove about the schema of phase 2: the partial unique indexes, the
 * polymorphic assignment table, and the SQL of the label filter.
 */
describe('Integration::Phase2', () => {
  const ORGANIZATION = 'c0000000-0000-4000-8000-000000000001';
  const OTHER_ORGANIZATION = 'c0000000-0000-4000-8000-000000000002';
  let dataSource: DataSource;

  /**
   * Insert an Advertiser directly, bypassing the service.
   *
   * @param name - Its name
   * @param organizationId - Its Organization
   * @returns Its id
   */
  async function insertAdvertiser(name: string, organizationId: string = ORGANIZATION): Promise<string> {
    const saved: AdvertiserEntity = await dataSource
      .getRepository(AdvertiserEntity)
      .save(dataSource.getRepository(AdvertiserEntity).create({ organizationId, name, websiteUrl: null }));
    return saved.id;
  }

  /**
   * Insert a Label directly.
   *
   * @param name - Its name
   * @param organizationId - Its Organization
   * @returns Its id
   */
  async function insertLabel(name: string, organizationId: string = ORGANIZATION): Promise<string> {
    const saved: LabelEntity = await dataSource
      .getRepository(LabelEntity)
      .save(dataSource.getRepository(LabelEntity).create({ organizationId, name, color: '#1f6feb' }));
    return saved.id;
  }

  beforeAll(async (): Promise<void> => {
    dataSource = await connectIntegrationDatabase();
  });

  afterAll(async (): Promise<void> => {
    await dataSource.destroy();
  });

  beforeEach(async (): Promise<void> => {
    await truncateAll(dataSource);
  });

  describe('the partial unique index on the name', () => {
    it('should refuse two live resources of the same name in one Organization', async (): Promise<void> => {
      await insertAdvertiser('Maison Lune');

      await expect(insertAdvertiser('Maison Lune')).rejects.toBeInstanceOf(QueryFailedError);
    });

    it('should allow the same name in another Organization', async (): Promise<void> => {
      await insertAdvertiser('Maison Lune');

      await expect(insertAdvertiser('Maison Lune', OTHER_ORGANIZATION)).resolves.toEqual(expect.any(String));
    });

    it('should free the name once the resource is deleted, and refuse the restoration that would clash', async (): Promise<void> => {
      const first: string = await insertAdvertiser('Maison Lune');
      await dataSource.getRepository(AdvertiserEntity).update({ id: first }, { deletedAt: new Date() });

      // The name is free again: this is what lets a brand be deleted and recreated.
      const second: string = await insertAdvertiser('Maison Lune');
      expect(second).not.toBe(first);

      // And restoring the first one would now clash, which is why the service checks before it restores.
      await expect(
        dataSource.getRepository(AdvertiserEntity).update({ id: first }, { deletedAt: null })
      ).rejects.toBeInstanceOf(QueryFailedError);
    });

    it('should hold for labels too', async (): Promise<void> => {
      await insertLabel('Q1');

      await expect(insertLabel('Q1')).rejects.toBeInstanceOf(QueryFailedError);
      await expect(insertLabel('Q1', OTHER_ORGANIZATION)).resolves.toEqual(expect.any(String));
    });
  });

  describe('the polymorphic assignment table', () => {
    it('should refuse the same label twice on the same resource', async (): Promise<void> => {
      const [labelId, resourceId] = [await insertLabel('Q1'), await insertAdvertiser('Maison Lune')];
      const repository = dataSource.getRepository(LabelAssignmentEntity);
      await repository.insert({ labelId, resourceType: 'advertiser', resourceId });

      await expect(repository.insert({ labelId, resourceType: 'advertiser', resourceId })).rejects.toBeInstanceOf(
        QueryFailedError
      );
    });

    it('should keep an assignment whose resource disappeared, and not break on it', async (): Promise<void> => {
      // No foreign key leaves this table (D39): an orphan assignment is harmless.
      const labelId: string = await insertLabel('Q1');
      await dataSource
        .getRepository(LabelAssignmentEntity)
        .insert({ labelId, resourceType: 'advertiser', resourceId: '11111111-1111-4111-8111-111111111111' });

      await expect(dataSource.getRepository(LabelAssignmentEntity).countBy({ labelId })).resolves.toBe(1);
    });
  });

  describe('the SQL of the label filter', () => {
    /**
     * Run the `EXISTS` of `applyLabelFilter` by hand, which is the only way to prove the `all` mode:
     * a `HAVING` without `GROUP BY` treats the whole subquery as one group.
     *
     * @param labelIds - The labels asked for
     * @param mode - How they combine
     * @returns The names that matched, sorted
     */
    async function filter(labelIds: string[], mode: 'any' | 'all'): Promise<string[]> {
      const having: string = mode === 'all' ? 'HAVING COUNT(DISTINCT assignment.label_id) = :labelCount' : '';
      const rows: { name: string }[] = await dataSource
        .createQueryBuilder()
        .select('advertiser.name', 'name')
        .from('advertisers', 'advertiser')
        .where(
          `EXISTS (
             SELECT 1 FROM label_assignments assignment
              WHERE assignment.resource_type = 'advertiser'
                AND assignment.resource_id = advertiser.id
                AND assignment.label_id IN (:...labelIds)
              ${having}
           )`,
          { labelIds, labelCount: labelIds.length }
        )
        .orderBy('advertiser.name', 'ASC')
        .getRawMany();
      return rows.map((row: { name: string }): string => row.name);
    }

    it('should match any of the labels, or all of them', async (): Promise<void> => {
      const [q1, q2] = [await insertLabel('Q1'), await insertLabel('Q2')];
      const [both, onlyQ1, none] = [
        await insertAdvertiser('Both'),
        await insertAdvertiser('Only Q1'),
        await insertAdvertiser('None'),
      ];
      await dataSource.getRepository(LabelAssignmentEntity).insert([
        { labelId: q1, resourceType: 'advertiser', resourceId: both },
        { labelId: q2, resourceType: 'advertiser', resourceId: both },
        { labelId: q1, resourceType: 'advertiser', resourceId: onlyQ1 },
      ]);

      expect(await filter([q1, q2], 'any')).toEqual(['Both', 'Only Q1']);
      expect(await filter([q1, q2], 'all')).toEqual(['Both']);
      expect(await filter([q1], 'all')).toEqual(['Both', 'Only Q1']);
      expect(none).toEqual(expect.any(String));
    });
  });

  describe('the search without case nor accents', () => {
    it('should find a name whatever its accents and its case', async (): Promise<void> => {
      await insertAdvertiser('Herbéa Noël');

      for (const search of ['herbea', 'HERBÉA', 'noel', 'Noël']) {
        const rows: { name: string }[] = await dataSource
          .createQueryBuilder()
          .select('advertiser.name', 'name')
          .from('advertisers', 'advertiser')
          .where(`regexp_replace(normalize(advertiser.name, NFD), '[\\u0300-\\u036f]', '', 'g') ILIKE :search`, {
            search: `%${search.normalize('NFD').replace(/[̀-ͯ]/g, '')}%`,
          })
          .getRawMany();
        expect(rows.map((row: { name: string }): string => row.name)).toEqual(['Herbéa Noël']);
      }
    });
  });
});
