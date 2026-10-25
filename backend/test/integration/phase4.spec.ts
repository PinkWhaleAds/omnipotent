import { DataSource, QueryFailedError } from 'typeorm';

import { BudgetDayEntity } from '@src/database/entities';
import { TreeLevel } from '@src/types';
import { connectIntegrationDatabase, truncateAll } from './database.utils';

/**
 * What only a real PostgreSQL can prove about the schema of phase 4: one day of one node is unique
 * over the five levels, the amount survives as an integer, and `0` is a value
 * (`docs/phase-4.md` § 1 and § 9).
 */
describe('Integration::Phase4', () => {
  const NODE = 'f1000000-0000-4000-8000-000000000001';
  let dataSource: DataSource;

  /**
   * Insert one day of a curve directly, bypassing the service.
   *
   * @param level - Level of the node
   * @param nodeId - The node
   * @param day - The day
   * @param cents - What it may spend
   * @returns A promise that resolves once the row is written
   */
  async function insertDay(level: TreeLevel, nodeId: string, day: string, cents: number): Promise<void> {
    await dataSource
      .getRepository(BudgetDayEntity)
      .save(dataSource.getRepository(BudgetDayEntity).create({ level, nodeId, day, cents, locked: false }));
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

  it('should hold one row per level, node and day', async (): Promise<void> => {
    await insertDay('campaign', NODE, '2027-01-01', 10_000);

    await expect(insertDay('campaign', NODE, '2027-01-01', 20_000)).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('should let two levels carry the same day, the id of a node belonging to its level', async (): Promise<void> => {
    await insertDay('campaign', NODE, '2027-01-01', 10_000);
    await insertDay('lever', NODE, '2027-01-01', 10_000);

    await expect(dataSource.getRepository(BudgetDayEntity).count()).resolves.toBe(2);
  });

  it('should read an amount back as an integer, and keep a day at zero', async (): Promise<void> => {
    await insertDay('ad_group', NODE, '2027-01-01', 1_234_567);
    await insertDay('ad_group', NODE, '2027-01-02', 0);

    const days: BudgetDayEntity[] = await dataSource
      .getRepository(BudgetDayEntity)
      .find({ where: { nodeId: NODE }, order: { day: 'ASC' } });

    expect(days.map((day: BudgetDayEntity): number => day.cents)).toEqual([1_234_567, 0]);
    expect(days[0].day).toBe('2027-01-01');
  });
});
