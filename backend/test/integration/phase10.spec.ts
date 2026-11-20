import { DataSource, QueryFailedError, Repository } from 'typeorm';

import { AdAccountEntity } from '@src/database/entities';
import { connectIntegrationDatabase, truncateAll } from './database.utils';

/**
 * What only a real PostgreSQL can prove about the schema of phase 10: an account linked to **our**
 * manager account belongs to **one** Organization among the living rows, whichever it is — our
 * credentials reach every account so linked — and one waiting for its client has no name, currency
 * or timezone yet (`docs/phase-10.md` §§ 4.4 and 4.5).
 */
describe('Integration::Phase10', () => {
  const ORGANIZATION = 'c0000000-0000-4000-8000-000000000001';
  const OTHER_ORGANIZATION = 'c0000000-0000-4000-8000-000000000002';
  let dataSource: DataSource;

  /**
   * Connect an account the way a `manager_link` platform does: the reference alone, waiting.
   *
   * @param organizationId - Whose Organization
   * @param linkRef - Its reference, `null` for one declared by hand
   * @returns The row
   */
  async function connect(organizationId: string, linkRef: string | null): Promise<AdAccountEntity> {
    const accounts: Repository<AdAccountEntity> = dataSource.getRepository(AdAccountEntity);
    return accounts.save(
      accounts.create({
        organizationId,
        platform: 'google_ads',
        externalId: linkRef ?? '1234567890',
        name: null,
        currency: null,
        timezone: null,
        status: 'pending',
        statusReason: 'link_requested',
        scope: {},
        secretName: null,
        linkRef,
        linkRequestedAt: linkRef === null ? null : new Date(),
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

  it('should keep an account waiting for its client with no name, currency or timezone', async (): Promise<void> => {
    await expect(connect(ORGANIZATION, '5550001111')).resolves.toMatchObject({
      name: null,
      currency: null,
      timezone: null,
      linkRef: '5550001111',
    });
  });

  it('should refuse a linked account to a second Organization', async (): Promise<void> => {
    await connect(ORGANIZATION, '5550001111');

    // The index that phase 7 did not need: there, another Organization could connect the same
    // account, since each brought its own key.
    await expect(connect(OTHER_ORGANIZATION, '5550001111')).rejects.toBeInstanceOf(QueryFailedError);
  });

  it('should free a linked account once disconnected', async (): Promise<void> => {
    const account: AdAccountEntity = await connect(ORGANIZATION, '5550001111');
    await dataSource.getRepository(AdAccountEntity).update({ id: account.id }, { deletedAt: new Date() });

    await expect(connect(OTHER_ORGANIZATION, '5550001111')).resolves.toMatchObject({
      organizationId: OTHER_ORGANIZATION,
    });
  });

  it('should leave the accounts declared by hand out of it', async (): Promise<void> => {
    await connect(ORGANIZATION, null);

    await expect(connect(OTHER_ORGANIZATION, null)).resolves.toMatchObject({ linkRef: null });
  });
});
