import { DataSource, QueryFailedError, Repository } from 'typeorm';

import { AdAccountEntity, AdvertiserAdAccountEntity, AdvertiserEntity } from '@src/database/entities';
import { connectIntegrationDatabase, truncateAll } from './database.utils';

/**
 * What only a real PostgreSQL can prove about the schema of phase 7: an Organization connects a given
 * account **once**, it may connect **several accounts of one platform**, and a brand buys on one
 * account per platform and per currency (`docs/phase-7.md` § 1 and § 8).
 */
describe('Integration::Phase7', () => {
  const ORGANIZATION = 'c0000000-0000-4000-8000-000000000001';
  const OTHER_ORGANIZATION = 'c0000000-0000-4000-8000-000000000002';
  let dataSource: DataSource;

  /**
   * Connect an account.
   *
   * @param organizationId - Whose Organization
   * @param externalId - Its identifier on the platform
   * @param currency - What it buys in
   * @returns The row
   */
  async function connect(organizationId: string, externalId: string, currency = 'EUR'): Promise<AdAccountEntity> {
    const accounts: Repository<AdAccountEntity> = dataSource.getRepository(AdAccountEntity);
    return accounts.save(
      accounts.create({
        organizationId,
        platform: 'dv360',
        externalId,
        name: `DV360 ${externalId}`,
        currency,
        timezone: 'Europe/Paris',
        status: 'pending',
        statusReason: 'link_requested',
        scope: { partnerId: '987' },
        secretName: null,
      })
    );
  }

  /**
   * Insert a brand.
   *
   * @param name - Its name
   * @returns Its id
   */
  async function insertAdvertiser(name: string): Promise<string> {
    const advertisers: Repository<AdvertiserEntity> = dataSource.getRepository(AdvertiserEntity);
    const saved: AdvertiserEntity = await advertisers.save(
      advertisers.create({ organizationId: ORGANIZATION, name, websiteUrl: null })
    );
    return saved.id;
  }

  /**
   * Link a brand to an account.
   *
   * @param advertiserId - The brand
   * @param account - The account it buys on
   * @returns The row
   */
  async function link(advertiserId: string, account: AdAccountEntity): Promise<AdvertiserAdAccountEntity> {
    const links: Repository<AdvertiserAdAccountEntity> = dataSource.getRepository(AdvertiserAdAccountEntity);
    return links.save(
      links.create({
        organizationId: ORGANIZATION,
        advertiserId,
        platform: account.platform,
        currency: account.currency,
        adAccountId: account.id,
        externalAdvertiserId: '555',
      })
    );
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

  it('should refuse the same account twice on one Organization', async (): Promise<void> => {
    await connect(ORGANIZATION, '123456');

    await expect(connect(ORGANIZATION, '123456')).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('should let several accounts of one platform live together', async (): Promise<void> => {
    // What the `DspConnection` of MBP forbade, and had to be fixed in a hurry: several advertisers,
    // several currencies (`../../CADRAGE.md` § 12).
    await connect(ORGANIZATION, '123456', 'EUR');
    await connect(ORGANIZATION, '654321', 'USD');

    await expect(dataSource.getRepository(AdAccountEntity).count()).resolves.toBe(2);
  });

  it('should let another Organization connect the same account', async (): Promise<void> => {
    await connect(ORGANIZATION, '123456');

    await expect(connect(OTHER_ORGANIZATION, '123456')).resolves.toMatchObject({
      organizationId: OTHER_ORGANIZATION,
    });
  });

  it('should free the identifier of a disconnected account', async (): Promise<void> => {
    const account: AdAccountEntity = await connect(ORGANIZATION, '123456');
    await dataSource.getRepository(AdAccountEntity).update({ id: account.id }, { deletedAt: new Date() });

    await expect(connect(ORGANIZATION, '123456')).resolves.toMatchObject({ externalId: '123456' });
  });

  it('should hold one account per brand, platform and currency', async (): Promise<void> => {
    const advertiserId: string = await insertAdvertiser('Herbéa');
    const euros: AdAccountEntity = await connect(ORGANIZATION, '123456', 'EUR');
    const dollars: AdAccountEntity = await connect(ORGANIZATION, '654321', 'USD');
    const first: AdvertiserAdAccountEntity = await link(advertiserId, euros);

    // Another account in the same currency is refused…
    const twin: AdAccountEntity = await connect(ORGANIZATION, '999999', 'EUR');
    await expect(link(advertiserId, twin)).rejects.toBeInstanceOf(QueryFailedError);
    // …another currency is fine, and so is another brand.
    await expect(link(advertiserId, dollars)).resolves.toMatchObject({ currency: 'USD' });
    await expect(link(await insertAdvertiser('Autre marque'), euros)).resolves.toMatchObject({ currency: 'EUR' });

    // And the pair frees itself when the link is undone.
    await dataSource.getRepository(AdvertiserAdAccountEntity).update({ id: first.id }, { deletedAt: new Date() });
    await expect(link(advertiserId, twin)).resolves.toMatchObject({ adAccountId: twin.id });
  });

  it('should keep no credential in the schema, only the name of a secret', async (): Promise<void> => {
    const columns: { column_name: string }[] = await dataSource.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'ad_accounts'`
    );
    const names: string[] = columns.map((column: { column_name: string }): string => column.column_name);

    expect(names).toContain('secret_name');
    expect(names.filter((name: string): boolean => /secret_value|token|api_key|password/.test(name))).toEqual([]);
  });
});
