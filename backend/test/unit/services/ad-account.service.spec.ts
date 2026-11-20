import { FastifyInstance } from 'fastify';

import { AdAccountEntity, AdvertiserAdAccountEntity } from '@src/database/entities';
import { ADAPTERS, LinkedAccountInfo, PlatformAdapter, PlatformError } from '@src/platforms/platform-adapter';
import AdAccountServicePlugin, { AdAccountService, toAdAccount } from '@src/services/ad-account.service';
import { AdAccount, AdvertiserAdAccount, ListAdAccountsQuery, Paginated, Platform } from '@src/types';
import { AccessServiceMock, buildServiceApp, createAccessMock } from '@test/unit/mocks/access.mock';
import { IDS, JANE, NOW, SUPER_ADMIN } from '@test/unit/mocks/auth.fixtures';
import { createDataSourceMock, DataSourceMock, QueryBuilderMock } from '@test/unit/mocks/data-source.mock';
import { httpError } from '@utils';

/** The ids the specs work with. */
const ACCOUNT_ID = 'ff000000-0000-4000-8000-000000000001';
const LINK_ID = 'ff000000-0000-4000-8000-000000000002';
const ADVERTISER_ID = IDS.advertiser;

/** Where the secret of that account lives: a name, which is all Postgres ever keeps. */
const SECRET_NAME = `omnipotent/ad-account/${ACCOUNT_ID}`;

/** Another Organization, which must never reach an account this one holds. */
const OTHER_ORGANIZATION = 'c0000000-0000-4000-8000-0000000000ff';

/** A Google customer id, as a linked account keeps it. */
const REFERENCE = '5550001111';

/** One day, in milliseconds. */
const DAY_IN_MS = 86_400_000;

/** The query a list route hands the service when the caller asked for nothing in particular. */
const DEFAULT_QUERY: ListAdAccountsQuery = {
  page: 1,
  limit: 50,
  sortBy: 'name',
  sortOrder: 'asc',
  includeDeleted: false,
};

/**
 * An account row.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function row(overrides: Partial<AdAccountEntity> = {}): AdAccountEntity {
  return {
    id: ACCOUNT_ID,
    organizationId: IDS.organization,
    platform: 'dv360',
    externalId: '123456',
    name: 'DV360 — Omnilor',
    currency: 'EUR',
    timezone: 'Europe/Paris',
    status: 'pending',
    statusReason: 'link_requested',
    scope: { partnerId: '987' },
    secretName: null,
    linkRef: null,
    linkRequestedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  } as unknown as AdAccountEntity;
}

/**
 * An account linked to our manager account, waiting for its client.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function linkedRow(overrides: Partial<AdAccountEntity> = {}): AdAccountEntity {
  return row({
    platform: 'google_ads',
    externalId: REFERENCE,
    name: null,
    currency: null,
    timezone: null,
    scope: {},
    linkRef: REFERENCE,
    linkRequestedAt: NOW,
    ...overrides,
  });
}

/** What Google answers about an account our manager account manages. */
const INFO: LinkedAccountInfo = {
  externalId: REFERENCE,
  name: 'Client immobilier',
  currency: 'EUR',
  timezone: 'Europe/Paris',
  manager: false,
};

/**
 * A failure of a platform call.
 *
 * @param options - What the engine reacts to, over a definitive refusal
 * @returns The error
 */
function failure(options: Partial<PlatformError['options']> = {}): PlatformError {
  return new PlatformError('google_ads', 'Refused', {
    statusCode: 400,
    retryable: false,
    invalidCredentials: false,
    requestId: null,
    ...options,
  });
}

/** A fake adapter of a platform whose accounts link to our manager account. */
type LinkAdapterMock = PlatformAdapter & {
  referenceOf: jest.Mock;
  requestLink: jest.Mock;
  linkStatuses: jest.Mock;
  cancelLink: jest.Mock;
  readLinkedAccount: jest.Mock;
};

/**
 * A link row.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function linkRow(overrides: Partial<AdvertiserAdAccountEntity> = {}): AdvertiserAdAccountEntity {
  return {
    id: LINK_ID,
    organizationId: IDS.organization,
    advertiserId: ADVERTISER_ID,
    platform: 'dv360',
    currency: 'EUR',
    adAccountId: ACCOUNT_ID,
    externalAdvertiserId: '555',
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...overrides,
  } as unknown as AdvertiserAdAccountEntity;
}

describe('Unit::Services::AdAccountService', () => {
  let db: DataSourceMock;
  let access: AccessServiceMock;
  let secrets: { put: jest.Mock; get: jest.Mock; delete: jest.Mock };
  let service: AdAccountService;

  beforeEach((): void => {
    jest.clearAllMocks();
    db = createDataSourceMock();
    access = createAccessMock();
    secrets = { put: jest.fn().mockResolvedValue(undefined), get: jest.fn(), delete: jest.fn() };
    service = new AdAccountService(db.dataSource, access as never, secrets as never);
    db.manager.save.mockImplementation(async (_entity: unknown, saved: object): Promise<object> =>
      Promise.resolve({ id: ACCOUNT_ID, createdAt: NOW, updatedAt: NOW, deletedAt: null, ...saved })
    );
  });

  describe('list', () => {
    it('should answer the connected accounts of the Organization', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('account');
      builder.getManyAndCount.mockResolvedValue([[row()], 1]);

      const page: Paginated<AdAccount> = await service.list(JANE, IDS.organization, DEFAULT_QUERY);

      expect(page.items[0]).toEqual(toAdAccount(row()));
      expect(builder.andWhere).toHaveBeenCalledWith('account.deleted_at IS NULL');
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
    });

    it('should filter on the platform, the state and the name, and list the disconnected ones', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder('account');

      await service.list(JANE, IDS.organization, {
        ...DEFAULT_QUERY,
        platform: 'hawk',
        status: 'active',
        search: 'Omnilor',
        includeDeleted: true,
      });

      expect(builder.andWhere).toHaveBeenCalledWith('account.platform = :platform', { platform: 'hawk' });
      expect(builder.andWhere).toHaveBeenCalledWith('account.status = :status', { status: 'active' });
      expect(builder.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE'), { search: '%Omnilor%' });
      expect(builder.andWhere).not.toHaveBeenCalledWith('account.deleted_at IS NULL');
    });
  });

  describe('get', () => {
    it('should never say more about the secret than that there is one', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row({ secretName: SECRET_NAME }));

      const account: AdAccount = await service.get(JANE, IDS.organization, ACCOUNT_ID);

      expect(account.hasCredentials).toBe(true);
      expect(JSON.stringify(account)).not.toContain(SECRET_NAME);
      expect(secrets.get).not.toHaveBeenCalled();
    });

    it('should answer a disconnected account, saying when it was disconnected', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row({ deletedAt: NOW }));

      await expect(service.get(JANE, IDS.organization, ACCOUNT_ID)).resolves.toMatchObject({
        deletedAt: NOW.toISOString(),
      });
    });

    it('should not find an account of another Organization', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(service.get(JANE, IDS.organization, ACCOUNT_ID)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'ad_account_not_found',
      });
    });
  });

  describe('connect', () => {
    it('should connect an account waiting for the client, without credentials', async (): Promise<void> => {
      const connected: AdAccount = await service.connect(JANE, IDS.organization, {
        platform: 'dv360',
        externalId: '123456',
        name: 'DV360 — Omnilor',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        scope: { partnerId: '987' },
      });

      expect(connected).toMatchObject({
        status: 'pending',
        statusReason: 'link_requested',
        hasCredentials: false,
        scope: { partnerId: '987' },
      });
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'admin');
    });

    it('should default the scope to nothing at all', async (): Promise<void> => {
      const connected: AdAccount = await service.connect(JANE, IDS.organization, {
        platform: 'hawk',
        externalId: 'A1',
        name: 'Hawk',
        currency: 'EUR',
        timezone: 'Europe/Paris',
      });

      expect(connected.scope).toEqual({});
    });

    it('should refuse the same account twice on one Organization', async (): Promise<void> => {
      db.manager.exists.mockResolvedValue(true);

      await expect(
        service.connect(JANE, IDS.organization, {
          platform: 'dv360',
          externalId: '123456',
          name: 'DV360',
          currency: 'EUR',
          timezone: 'Europe/Paris',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'ad_account_already_connected',
        errorParams: { platform: 'dv360', externalId: '123456' },
      });
      expect(db.manager.save).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should change the name, the timezone and the scope', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row());

      const changed: AdAccount = await service.update(JANE, IDS.organization, ACCOUNT_ID, {
        name: 'DV360 — production',
        timezone: 'America/New_York',
        scope: { partnerId: '111' },
      });

      expect(changed).toMatchObject({
        name: 'DV360 — production',
        timezone: 'America/New_York',
        scope: { partnerId: '111' },
      });
    });

    it('should leave alone what the body does not carry', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row());

      await expect(service.update(JANE, IDS.organization, ACCOUNT_ID, {})).resolves.toMatchObject({
        name: 'DV360 — Omnilor',
        timezone: 'Europe/Paris',
      });
    });
  });

  describe('setStatus', () => {
    it('should accept every transition the table names', async (): Promise<void> => {
      const transitions: [AdAccountEntity['status'], AdAccountEntity['status'], string | undefined][] = [
        ['pending', 'active', undefined],
        ['pending', 'invalid', 'link_declined'],
        ['active', 'invalid', 'link_revoked'],
        ['invalid', 'pending', 'link_requested'],
      ];

      for (const [from, to, reason] of transitions) {
        db.manager.findOne.mockResolvedValue(row({ status: from }));

        const moved: AdAccount = await service.setStatus(JANE, IDS.organization, ACCOUNT_ID, {
          status: to,
          reason: reason as never,
        });

        expect({ from, to, status: moved.status, reason: moved.statusReason }).toEqual({
          from,
          to,
          status: to,
          reason: reason ?? null,
        });
      }
    });

    it('should refuse every passage the table does not name', async (): Promise<void> => {
      for (const [from, to] of [
        ['pending', 'pending'],
        ['active', 'active'],
        ['active', 'pending'],
        ['invalid', 'active'],
        ['invalid', 'invalid'],
      ] as const) {
        db.manager.findOne.mockResolvedValue(row({ status: from }));

        await expect(
          service.setStatus(JANE, IDS.organization, ACCOUNT_ID, {
            status: to,
            reason: to === 'active' ? undefined : 'link_revoked',
          })
        ).rejects.toMatchObject({
          statusCode: 400,
          errorCode: 'ad_account_transition_invalid',
          errorParams: { from, to },
        });
      }
      expect(db.manager.update).not.toHaveBeenCalled();
    });
  });

  describe('the credentials', () => {
    it('should put the secret in the store and keep only its name', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row());

      const credited: AdAccount = await service.setCredentials(JANE, IDS.organization, ACCOUNT_ID, {
        secret: 'ya29.a0AfH-very-secret',
      });

      expect(secrets.put).toHaveBeenCalledWith(SECRET_NAME, 'ya29.a0AfH-very-secret');
      expect(db.manager.update).toHaveBeenCalledWith(AdAccountEntity, { id: ACCOUNT_ID }, { secretName: SECRET_NAME });
      // Nothing written to the database carries the value, and nothing answered does either.
      expect(JSON.stringify(db.manager.update.mock.calls)).not.toContain('ya29');
      expect(JSON.stringify(credited)).not.toContain('ya29');
      expect(credited.hasCredentials).toBe(true);
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'admin');
    });

    it('should erase the secret, in the store as in the row', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row({ secretName: SECRET_NAME }));

      const bare: AdAccount = await service.deleteCredentials(JANE, IDS.organization, ACCOUNT_ID);

      expect(secrets.delete).toHaveBeenCalledWith(SECRET_NAME);
      expect(bare.hasCredentials).toBe(false);
    });

    it('should ask the store nothing when the account carries no secret', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row());

      await service.deleteCredentials(JANE, IDS.organization, ACCOUNT_ID);

      expect(secrets.delete).not.toHaveBeenCalled();
    });
  });

  describe('disconnect and restore', () => {
    it('should disconnect an account and erase its secret on the way out', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row({ secretName: SECRET_NAME }));

      await expect(service.disconnect(JANE, IDS.organization, ACCOUNT_ID)).resolves.toMatchObject({
        id: ACCOUNT_ID,
      });
      expect(secrets.delete).toHaveBeenCalledWith(SECRET_NAME);
      expect(db.manager.update).toHaveBeenCalledWith(
        AdAccountEntity,
        { id: ACCOUNT_ID },
        { secretName: null, deletedAt: expect.any(Date) }
      );
    });

    it('should bring an account back pending and without credentials', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row({ deletedAt: NOW, status: 'active', statusReason: null }));

      await expect(service.restore(JANE, IDS.organization, ACCOUNT_ID)).resolves.toEqual({
        id: ACCOUNT_ID,
        deletedAt: null,
      });
      expect(db.manager.update).toHaveBeenCalledWith(
        AdAccountEntity,
        { id: ACCOUNT_ID },
        { deletedAt: null, status: 'pending', statusReason: 'link_requested' }
      );
    });

    it('should refuse to restore an account that is connected', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row());

      await expect(service.restore(JANE, IDS.organization, ACCOUNT_ID)).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'ad_account_not_deleted',
      });
    });
  });

  describe('the links', () => {
    it('should answer the accounts a brand buys on', async (): Promise<void> => {
      db.manager.find.mockResolvedValue([linkRow()]);

      const links: AdvertiserAdAccount[] = await service.listForAdvertiser(JANE, IDS.organization, ADVERTISER_ID);

      expect(links).toEqual([expect.objectContaining({ id: LINK_ID, platform: 'dv360', currency: 'EUR' })]);
      expect(db.manager.find).toHaveBeenCalledWith(
        AdvertiserAdAccountEntity,
        expect.objectContaining({ order: { platform: 'ASC', currency: 'ASC' } })
      );
    });

    it('should take the platform and the currency from the account, not from the caller', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row({ status: 'active', statusReason: null, currency: 'USD' }));
      db.manager.save.mockImplementation(async (_entity: unknown, saved: object): Promise<object> =>
        Promise.resolve({ id: LINK_ID, createdAt: NOW, updatedAt: NOW, ...saved })
      );

      const link: AdvertiserAdAccount = await service.link(JANE, IDS.organization, ADVERTISER_ID, {
        adAccountId: ACCOUNT_ID,
        externalAdvertiserId: '555',
      });

      expect(link).toMatchObject({ platform: 'dv360', currency: 'USD', adAccountId: ACCOUNT_ID });
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'manager');
    });

    it('should refuse to link a brand to an account whose access ended', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row({ status: 'invalid', statusReason: 'link_revoked' }));

      await expect(
        service.link(JANE, IDS.organization, ADVERTISER_ID, {
          adAccountId: ACCOUNT_ID,
          externalAdvertiserId: '555',
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'ad_account_unusable',
        errorParams: { status: 'invalid', statusReason: 'link_revoked' },
      });
    });

    it('should refuse a second account for the same platform and currency', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(row({ status: 'active', statusReason: null }));
      db.manager.exists.mockResolvedValue(true);

      await expect(
        service.link(JANE, IDS.organization, ADVERTISER_ID, {
          adAccountId: ACCOUNT_ID,
          externalAdvertiserId: '555',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'advertiser_account_exists',
        errorParams: { platform: 'dv360', currency: 'EUR' },
      });
    });

    it('should change the identity of a brand, and undo a link', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(linkRow());

      await expect(
        service.updateLink(JANE, IDS.organization, LINK_ID, { externalAdvertiserId: '666' })
      ).resolves.toMatchObject({ externalAdvertiserId: '666' });
      await expect(service.unlink(JANE, IDS.organization, LINK_ID)).resolves.toMatchObject({ id: LINK_ID });
    });

    it('should not find a link of another Organization', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(service.unlink(JANE, IDS.organization, LINK_ID)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'advertiser_account_not_found',
      });
    });
  });

  describe('an account linked to our manager account', () => {
    /** The registry, writable, so a spec declares an adapter as a platform phase would. */
    const registry: Partial<Record<Platform, PlatformAdapter>> = ADAPTERS as Partial<Record<Platform, PlatformAdapter>>;
    let adapter: LinkAdapterMock;

    beforeEach((): void => {
      adapter = {
        platform: 'google_ads',
        connection: 'manager_link',
        apply: jest.fn(),
        referenceOf: jest.fn((input: string): string | null => {
          const digits: string = input.replaceAll('-', '');
          return /^\d{10}$/.test(digits) ? digits : null;
        }),
        requestLink: jest.fn().mockResolvedValue('pending'),
        linkStatuses: jest.fn().mockResolvedValue(new Map()),
        cancelLink: jest.fn().mockResolvedValue(undefined),
        readLinkedAccount: jest.fn().mockResolvedValue(INFO),
      };
      registry.google_ads = adapter;
      service = new AdAccountService(
        db.dataSource,
        access as never,
        secrets as never,
        { linkRequestLifetimeDays: 30 },
        (): number => NOW.getTime()
      );
    });

    afterEach((): void => {
      for (const platform of Object.keys(registry)) Reflect.deleteProperty(registry, platform);
    });

    describe('connect', () => {
      it('should invite the account and keep it waiting, with nothing read yet', async (): Promise<void> => {
        const connected: AdAccount = await service.connect(JANE, IDS.organization, {
          platform: 'google_ads',
          externalId: '555-000-1111',
        });

        expect(adapter.requestLink).toHaveBeenCalledWith(REFERENCE, {});
        expect(adapter.readLinkedAccount).not.toHaveBeenCalled();
        expect(connected).toMatchObject({
          externalId: REFERENCE,
          name: null,
          currency: null,
          timezone: null,
          status: 'pending',
          statusReason: 'link_requested',
          scope: {},
        });
        expect(db.manager.save).toHaveBeenCalledWith(
          AdAccountEntity,
          expect.objectContaining({ linkRef: REFERENCE, linkRequestedAt: NOW, secretName: null })
        );
      });

      it('should read at once, for a super-admin, an account our manager account already manages', async (): Promise<void> => {
        adapter.requestLink.mockResolvedValue('active');

        const connected: AdAccount = await service.connect(SUPER_ADMIN, IDS.organization, {
          platform: 'google_ads',
          externalId: REFERENCE,
          scope: { note: 'direct' },
        });

        expect(connected).toMatchObject({
          name: 'Client immobilier',
          currency: 'EUR',
          timezone: 'Europe/Paris',
          status: 'active',
          statusReason: null,
          scope: { note: 'direct' },
        });
        // A super-admin acts for the client: whoever held the account before does not matter.
        expect(db.manager.findOne).not.toHaveBeenCalled();
      });

      it('should let the Organization that held it last take it back', async (): Promise<void> => {
        adapter.requestLink.mockResolvedValue('active');
        db.manager.findOne.mockResolvedValue(linkedRow({ deletedAt: NOW }));

        await expect(
          service.connect(JANE, IDS.organization, { platform: 'google_ads', externalId: REFERENCE })
        ).resolves.toMatchObject({ status: 'active' });
      });

      it.each([
        ['no Organization ever held', null],
        ['another Organization held last', linkedRow({ organizationId: OTHER_ORGANIZATION, deletedAt: NOW })],
      ])(
        'should refuse an account our manager account manages and %s',
        async (_label: string, last: AdAccountEntity | null): Promise<void> => {
          adapter.requestLink.mockResolvedValue('active');
          db.manager.findOne.mockResolvedValue(last);

          // The admin of an Organization is a user among others: taking it would buy on a client's
          // account that granted this Organization nothing (Lorin's rule of 2026-11-19).
          await expect(
            service.connect(JANE, IDS.organization, { platform: 'google_ads', externalId: REFERENCE })
          ).rejects.toMatchObject({
            statusCode: 409,
            errorCode: 'ad_account_already_managed',
            errorParams: { platform: 'google_ads' },
          });
          expect(adapter.readLinkedAccount).not.toHaveBeenCalled();
          expect(db.manager.save).not.toHaveBeenCalled();
        }
      );

      it('should refuse a manager account, which runs no campaign', async (): Promise<void> => {
        adapter.requestLink.mockResolvedValue('active');
        adapter.readLinkedAccount.mockResolvedValue({ ...INFO, manager: true });

        await expect(
          service.connect(SUPER_ADMIN, IDS.organization, { platform: 'google_ads', externalId: REFERENCE })
        ).rejects.toMatchObject({
          statusCode: 400,
          errorCode: 'ad_account_manager',
          errorParams: { platform: 'google_ads', reference: REFERENCE },
        });
      });

      it.each(['name', 'currency', 'timezone'])(
        'should refuse a %s the platform gives, before calling it',
        async (field: string): Promise<void> => {
          const values: Record<string, string> = { name: 'Mine', currency: 'USD', timezone: 'Europe/Paris' };

          await expect(
            service.connect(JANE, IDS.organization, {
              platform: 'google_ads',
              externalId: REFERENCE,
              [field]: values[field],
            })
          ).rejects.toMatchObject({
            statusCode: 400,
            errorCode: 'ad_account_field_read',
            errorParams: { platform: 'google_ads', field },
          });
          expect(adapter.requestLink).not.toHaveBeenCalled();
        }
      );

      it('should refuse a reference that is not one', async (): Promise<void> => {
        await expect(
          service.connect(JANE, IDS.organization, { platform: 'google_ads', externalId: '555-000' })
        ).rejects.toMatchObject({
          statusCode: 400,
          errorCode: 'ad_account_reference_invalid',
          errorParams: { platform: 'google_ads', field: 'externalId' },
        });
        expect(adapter.requestLink).not.toHaveBeenCalled();
      });

      it('should refuse an account this Organization already holds', async (): Promise<void> => {
        db.manager.find.mockResolvedValue([linkedRow()]);

        await expect(
          service.connect(JANE, IDS.organization, { platform: 'google_ads', externalId: REFERENCE })
        ).rejects.toMatchObject({
          statusCode: 409,
          errorCode: 'ad_account_already_connected',
          errorParams: { platform: 'google_ads', externalId: REFERENCE },
        });
      });

      it('should refuse an account another Organization holds, without naming it', async (): Promise<void> => {
        db.manager.find.mockResolvedValue([linkedRow({ organizationId: OTHER_ORGANIZATION })]);

        await expect(
          service.connect(SUPER_ADMIN, IDS.organization, { platform: 'google_ads', externalId: REFERENCE })
        ).rejects.toMatchObject({
          statusCode: 409,
          errorCode: 'ad_account_linked_elsewhere',
          errorParams: { platform: 'google_ads' },
        });
        expect(adapter.requestLink).not.toHaveBeenCalled();
      });

      it.each([
        [
          'our own credentials',
          failure({ ownCredentials: true }),
          502,
          'platform_credentials_failed',
          { platform: 'google_ads' },
        ],
        [
          'a platform that did not answer',
          failure({ retryable: true }),
          503,
          'platform_unavailable',
          { platform: 'google_ads' },
        ],
        [
          'a refusal we worded',
          failure({ messageCode: 'google_ads_too_many_managers', messageParams: { limit: 5 } }),
          400,
          'google_ads_too_many_managers',
          { limit: 5 },
        ],
        [
          'a refusal we worded without values',
          failure({ messageCode: 'google_ads_refused' }),
          400,
          'google_ads_refused',
          {},
        ],
        [
          'a refusal of the platform',
          failure({ code: 'ALREADY_MANAGED_IN_HIERARCHY' }),
          400,
          'ad_account_link_refused',
          { platform: 'google_ads', reason: 'ALREADY_MANAGED_IN_HIERARCHY' },
        ],
        ['a refusal with no code', failure(), 400, 'ad_account_link_refused', { platform: 'google_ads', reason: null }],
      ])(
        'should answer %s with its own code',
        async (
          _label: string,
          error: PlatformError,
          statusCode: number,
          errorCode: string,
          errorParams: object
        ): Promise<void> => {
          adapter.requestLink.mockRejectedValue(error);

          await expect(
            service.connect(JANE, IDS.organization, { platform: 'google_ads', externalId: REFERENCE })
          ).rejects.toMatchObject({ statusCode, errorCode, errorParams });
          expect(db.manager.save).not.toHaveBeenCalled();
        }
      );

      it('should let through a failure that is not the platform', async (): Promise<void> => {
        const broken = new Error('No network');
        adapter.requestLink.mockRejectedValue(broken);

        await expect(
          service.connect(JANE, IDS.organization, { platform: 'google_ads', externalId: REFERENCE })
        ).rejects.toBe(broken);
      });

      it('should say who took the account meanwhile, when the unique index refused the row', async (): Promise<void> => {
        db.manager.find
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([linkedRow({ organizationId: OTHER_ORGANIZATION })]);
        db.manager.save.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));

        await expect(
          service.connect(JANE, IDS.organization, { platform: 'google_ads', externalId: REFERENCE })
        ).rejects.toMatchObject({ statusCode: 409, errorCode: 'ad_account_linked_elsewhere' });
      });

      it.each([
        ['a unique violation nobody explains', Object.assign(new Error('duplicate key'), { code: '23505' })],
        ['any other failure of the database', new Error('Connection lost')],
      ])('should let through %s', async (_label: string, error: Error): Promise<void> => {
        db.manager.save.mockRejectedValue(error);

        await expect(
          service.connect(JANE, IDS.organization, { platform: 'google_ads', externalId: REFERENCE })
        ).rejects.toBe(error);
      });

      it('should refuse an adapter that says it links accounts and does not implement the link', async (): Promise<void> => {
        registry.google_ads = { platform: 'google_ads', connection: 'manager_link', apply: jest.fn() };

        await expect(
          service.connect(JANE, IDS.organization, { platform: 'google_ads', externalId: REFERENCE })
        ).rejects.toMatchObject({
          statusCode: 500,
          errorCode: 'sync_adapter_missing',
          errorParams: { platform: 'google_ads' },
        });
      });

      it('should declare an account of a platform whose accounts bring their own secret', async (): Promise<void> => {
        registry.openai = { platform: 'openai', connection: 'account_secret', apply: jest.fn() };

        await expect(
          service.connect(JANE, IDS.organization, {
            platform: 'openai',
            externalId: 'org-1',
            name: 'OpenAI',
            currency: 'USD',
            timezone: 'UTC',
          })
        ).resolves.toMatchObject({ status: 'pending', currency: 'USD' });
      });

      it.each(['name', 'currency', 'timezone'])(
        'should refuse to declare an account without its %s',
        async (field: string): Promise<void> => {
          const body: Record<string, string> = {
            platform: 'dv360',
            externalId: '123456',
            name: 'DV360',
            currency: 'EUR',
            timezone: 'Europe/Paris',
          };
          Reflect.deleteProperty(body, field);

          await expect(service.connect(JANE, IDS.organization, body as never)).rejects.toMatchObject({
            statusCode: 400,
            errorCode: 'ad_account_field_required',
            errorParams: { platform: 'dv360', field },
          });
        }
      );
    });

    describe('update', () => {
      it.each(['name', 'timezone'])(
        'should refuse to change a %s the platform gives',
        async (field: string): Promise<void> => {
          db.manager.findOne.mockResolvedValue(linkedRow({ status: 'active' }));

          await expect(
            service.update(JANE, IDS.organization, ACCOUNT_ID, { [field]: field === 'name' ? 'Mine' : 'UTC' })
          ).rejects.toMatchObject({ statusCode: 400, errorCode: 'ad_account_field_read', errorParams: { field } });
        }
      );

      it('should change its scope, which is ours', async (): Promise<void> => {
        db.manager.findOne.mockResolvedValue(linkedRow({ status: 'active' }));

        await expect(
          service.update(JANE, IDS.organization, ACCOUNT_ID, { scope: { note: 'x' } })
        ).resolves.toMatchObject({ scope: { note: 'x' } });
      });
    });

    describe('setStatus', () => {
      it.each([
        ['pending', 'active'],
        ['pending', 'invalid'],
        ['active', 'invalid'],
      ] as const)(
        'should refuse to move it from %s to %s by hand: the platform holds its status',
        async (from: AdAccountEntity['status'], to: AdAccountEntity['status']): Promise<void> => {
          db.manager.findOne.mockResolvedValue(linkedRow({ status: from }));

          await expect(
            service.setStatus(JANE, IDS.organization, ACCOUNT_ID, {
              status: to,
              reason: to === 'active' ? undefined : 'link_revoked',
            })
          ).rejects.toMatchObject({
            statusCode: 400,
            errorCode: 'ad_account_status_read',
            errorParams: { platform: 'google_ads', to },
          });
          expect(db.manager.update).not.toHaveBeenCalled();
        }
      );

      it('should send a new invitation when an ended access is asked again', async (): Promise<void> => {
        db.manager.findOne.mockResolvedValue(linkedRow({ status: 'invalid', statusReason: 'link_revoked' }));

        const moved: AdAccount = await service.setStatus(JANE, IDS.organization, ACCOUNT_ID, {
          status: 'pending',
          reason: 'link_requested',
        });

        expect(adapter.requestLink).toHaveBeenCalledWith(REFERENCE, {});
        expect(moved).toMatchObject({ status: 'pending', statusReason: 'link_requested' });
        expect(db.manager.update).toHaveBeenCalledWith(
          AdAccountEntity,
          { id: ACCOUNT_ID },
          { status: 'pending', statusReason: 'link_requested', linkRequestedAt: NOW }
        );
      });

      it('should read it at once when our manager account manages it again, keeping its currency', async (): Promise<void> => {
        db.manager.findOne.mockResolvedValue(
          linkedRow({ status: 'invalid', statusReason: 'link_revoked', currency: 'USD', name: 'Old' })
        );
        adapter.requestLink.mockResolvedValue('active');

        const moved: AdAccount = await service.setStatus(JANE, IDS.organization, ACCOUNT_ID, {
          status: 'pending',
          reason: 'link_requested',
        });

        // A currency never changes: the amounts already pushed are expressed in it.
        expect(moved).toMatchObject({ status: 'active', name: 'Client immobilier', currency: 'USD' });
      });

      it('should refuse a manager account here too', async (): Promise<void> => {
        db.manager.findOne.mockResolvedValue(linkedRow({ status: 'invalid', statusReason: 'link_revoked' }));
        adapter.requestLink.mockResolvedValue('active');
        adapter.readLinkedAccount.mockResolvedValue({ ...INFO, manager: true });

        await expect(
          service.setStatus(JANE, IDS.organization, ACCOUNT_ID, { status: 'pending', reason: 'link_requested' })
        ).rejects.toMatchObject({ statusCode: 400, errorCode: 'ad_account_manager' });
      });

      it('should say so when the platform has no adapter any more', async (): Promise<void> => {
        Reflect.deleteProperty(registry, 'google_ads');
        db.manager.findOne.mockResolvedValue(linkedRow({ status: 'invalid', statusReason: 'link_revoked' }));

        await expect(
          service.setStatus(JANE, IDS.organization, ACCOUNT_ID, { status: 'pending', reason: 'link_requested' })
        ).rejects.toMatchObject({ statusCode: 500, errorCode: 'sync_adapter_missing' });
      });
    });

    describe('disconnect', () => {
      it('should withdraw the invitation of an account still waiting', async (): Promise<void> => {
        db.manager.findOne.mockResolvedValue(linkedRow());

        await service.disconnect(JANE, IDS.organization, ACCOUNT_ID);

        expect(adapter.cancelLink).toHaveBeenCalledWith(REFERENCE);
        expect(db.manager.update).toHaveBeenCalledWith(
          AdAccountEntity,
          { id: ACCOUNT_ID },
          { secretName: null, deletedAt: NOW }
        );
      });

      it('should disconnect it even when the invitation cannot be withdrawn', async (): Promise<void> => {
        db.manager.findOne.mockResolvedValue(linkedRow());
        adapter.cancelLink.mockRejectedValue(failure({ retryable: true }));

        await expect(service.disconnect(JANE, IDS.organization, ACCOUNT_ID)).resolves.toMatchObject({ id: ACCOUNT_ID });
      });

      it('should leave an active link in place: ending it is its client to do', async (): Promise<void> => {
        db.manager.findOne.mockResolvedValue(linkedRow({ status: 'active', statusReason: null }));

        await service.disconnect(JANE, IDS.organization, ACCOUNT_ID);

        expect(adapter.cancelLink).not.toHaveBeenCalled();
      });

      it('should disconnect it when the platform has no adapter any more', async (): Promise<void> => {
        Reflect.deleteProperty(registry, 'google_ads');
        db.manager.findOne.mockResolvedValue(linkedRow());

        await expect(service.disconnect(JANE, IDS.organization, ACCOUNT_ID)).resolves.toMatchObject({ id: ACCOUNT_ID });
      });
    });

    describe('restore', () => {
      it('should bring it back waiting, where the consent of its client still holds', async (): Promise<void> => {
        db.manager.findOne
          .mockResolvedValueOnce(linkedRow({ deletedAt: NOW, status: 'active', statusReason: null }))
          .mockResolvedValueOnce(linkedRow({ deletedAt: NOW }));

        await expect(service.restore(JANE, IDS.organization, ACCOUNT_ID)).resolves.toEqual({
          id: ACCOUNT_ID,
          deletedAt: null,
        });
        expect(db.manager.update).toHaveBeenCalledWith(
          AdAccountEntity,
          { id: ACCOUNT_ID },
          { deletedAt: null, status: 'pending', statusReason: 'link_requested', linkRequestedAt: NOW }
        );
      });

      it('should refuse it while another Organization holds it', async (): Promise<void> => {
        db.manager.findOne.mockResolvedValue(linkedRow({ deletedAt: NOW }));
        db.manager.find.mockResolvedValue([linkedRow({ id: 'other', organizationId: OTHER_ORGANIZATION })]);

        await expect(service.restore(JANE, IDS.organization, ACCOUNT_ID)).rejects.toMatchObject({
          statusCode: 409,
          errorCode: 'ad_account_linked_elsewhere',
        });
      });

      it('should refuse it when another Organization held it since', async (): Promise<void> => {
        db.manager.findOne
          .mockResolvedValueOnce(linkedRow({ deletedAt: NOW }))
          .mockResolvedValueOnce(linkedRow({ id: 'other', organizationId: OTHER_ORGANIZATION, deletedAt: NOW }));

        await expect(service.restore(JANE, IDS.organization, ACCOUNT_ID)).rejects.toMatchObject({
          statusCode: 409,
          errorCode: 'ad_account_already_managed',
        });
      });
    });

    describe('link', () => {
      it('should refuse to link a brand before the client accepted: there is no currency yet', async (): Promise<void> => {
        db.manager.findOne.mockResolvedValue(linkedRow());

        await expect(
          service.link(JANE, IDS.organization, ADVERTISER_ID, {
            adAccountId: ACCOUNT_ID,
            externalAdvertiserId: REFERENCE,
          })
        ).rejects.toMatchObject({
          statusCode: 400,
          errorCode: 'ad_account_currency_unknown',
          errorParams: { status: 'pending' },
        });
      });
    });

    describe('checkLinks', () => {
      /**
       * The accounts the job follows, and where Google says their links stand.
       *
       * @param accounts - The rows the job reads
       * @param statuses - The links, by reference
       */
      function follow(accounts: AdAccountEntity[], statuses: Record<string, string>): void {
        db.manager.find.mockResolvedValue(accounts);
        adapter.linkStatuses.mockResolvedValue(new Map(Object.entries(statuses)));
      }

      it('should read no link of a platform with no account to follow', async (): Promise<void> => {
        await service.checkLinks();

        expect(adapter.linkStatuses).not.toHaveBeenCalled();
      });

      it('should look only at the platforms whose accounts link to our manager account', async (): Promise<void> => {
        Reflect.deleteProperty(registry, 'google_ads');
        registry.openai = { platform: 'openai', connection: 'account_secret', apply: jest.fn() };

        await service.checkLinks();

        expect(db.manager.find).not.toHaveBeenCalled();
      });

      it('should read the links once, for every account of the platform', async (): Promise<void> => {
        follow([linkedRow({ id: 'a', linkRef: '1111111111' }), linkedRow({ id: 'b', linkRef: '2222222222' })], {});

        await service.checkLinks();

        expect(adapter.linkStatuses).toHaveBeenCalledTimes(1);
        expect(db.manager.update).not.toHaveBeenCalled();
      });

      it('should leave everything where it stands when the links cannot be read', async (): Promise<void> => {
        db.manager.find.mockResolvedValue([linkedRow()]);
        adapter.linkStatuses.mockRejectedValue(failure({ retryable: true }));

        await expect(service.checkLinks()).resolves.toBeUndefined();
        expect(db.manager.update).not.toHaveBeenCalled();
      });

      it('should read an accepted account and make it active', async (): Promise<void> => {
        follow([linkedRow()], { [REFERENCE]: 'active' });

        await service.checkLinks();

        expect(db.manager.update).toHaveBeenCalledWith(
          AdAccountEntity,
          { id: ACCOUNT_ID },
          {
            externalId: REFERENCE,
            name: 'Client immobilier',
            currency: 'EUR',
            timezone: 'Europe/Paris',
            status: 'active',
            statusReason: null,
          }
        );
      });

      it('should keep the currency an accepted account already had', async (): Promise<void> => {
        follow([linkedRow({ currency: 'USD' })], { [REFERENCE]: 'active' });

        await service.checkLinks();

        expect(db.manager.update).toHaveBeenCalledWith(
          AdAccountEntity,
          { id: ACCOUNT_ID },
          expect.objectContaining({ currency: 'USD', status: 'active' })
        );
      });

      it('should give up an accepted account that is itself a manager account', async (): Promise<void> => {
        follow([linkedRow()], { [REFERENCE]: 'active' });
        adapter.readLinkedAccount.mockResolvedValue({ ...INFO, manager: true });

        await service.checkLinks();

        expect(db.manager.update).toHaveBeenCalledWith(
          AdAccountEntity,
          { id: ACCOUNT_ID },
          { status: 'invalid', statusReason: 'manager_account' }
        );
      });

      it('should say an invitation the platform gave up itself expired', async (): Promise<void> => {
        follow([linkedRow()], { [REFERENCE]: 'expired' });

        await service.checkLinks();

        expect(adapter.cancelLink).not.toHaveBeenCalled();
        expect(db.manager.update).toHaveBeenCalledWith(
          AdAccountEntity,
          { id: ACCOUNT_ID },
          { status: 'invalid', statusReason: 'link_expired' }
        );
      });

      it.each(['refused', 'ended'])(
        'should give up a waiting account whose link was %s',
        async (status: string): Promise<void> => {
          follow([linkedRow()], { [REFERENCE]: status });

          await service.checkLinks();

          expect(db.manager.update).toHaveBeenCalledWith(
            AdAccountEntity,
            { id: ACCOUNT_ID },
            { status: 'invalid', statusReason: 'link_declined' }
          );
        }
      );

      it.each([
        ['still waiting', 'pending'],
        ['not listed at all', undefined],
      ])(
        'should let an invitation %s wait out its thirty days',
        async (_label: string, status?: string): Promise<void> => {
          follow(
            [linkedRow({ linkRequestedAt: new Date(NOW.getTime() - 29 * DAY_IN_MS) })],
            status ? { [REFERENCE]: status } : {}
          );

          await service.checkLinks();

          expect(adapter.cancelLink).not.toHaveBeenCalled();
          expect(db.manager.update).not.toHaveBeenCalled();
        }
      );

      it('should withdraw an invitation past its thirty days, then give the account up', async (): Promise<void> => {
        follow([linkedRow({ linkRequestedAt: new Date(NOW.getTime() - 30 * DAY_IN_MS) })], { [REFERENCE]: 'pending' });

        await service.checkLinks();

        expect(adapter.cancelLink).toHaveBeenCalledWith(REFERENCE);
        expect(db.manager.update).toHaveBeenCalledWith(
          AdAccountEntity,
          { id: ACCOUNT_ID },
          { status: 'invalid', statusReason: 'link_expired' }
        );
      });

      it('should count from the connection when no invitation date was kept', async (): Promise<void> => {
        follow([linkedRow({ linkRequestedAt: null, createdAt: new Date(NOW.getTime() - 31 * DAY_IN_MS) })], {});

        await service.checkLinks();

        expect(adapter.cancelLink).toHaveBeenCalledWith(REFERENCE);
      });

      it.each(['ended', 'refused'])(
        'should give up an active account whose link was %s',
        async (status: string): Promise<void> => {
          follow([linkedRow({ status: 'active', statusReason: null, currency: 'EUR' })], { [REFERENCE]: status });

          await service.checkLinks();

          expect(db.manager.update).toHaveBeenCalledWith(
            AdAccountEntity,
            { id: ACCOUNT_ID },
            { status: 'invalid', statusReason: 'link_revoked' }
          );
        }
      );

      it.each([
        ['still active', 'active'],
        ['not listed', undefined],
      ])(
        'should leave alone an active account whose link is %s',
        async (_label: string, status?: string): Promise<void> => {
          follow([linkedRow({ status: 'active', statusReason: null })], status ? { [REFERENCE]: status } : {});

          await service.checkLinks();

          expect(db.manager.update).not.toHaveBeenCalled();
        }
      );

      it('should go on with the other accounts when one cannot be followed', async (): Promise<void> => {
        follow([linkedRow({ id: 'a', linkRef: '1111111111' }), linkedRow({ id: 'b', linkRef: '2222222222' })], {
          '1111111111': 'active',
          '2222222222': 'refused',
        });
        adapter.readLinkedAccount.mockRejectedValue(failure({ retryable: true }));

        await service.checkLinks();

        expect(db.manager.update).toHaveBeenCalledWith(
          AdAccountEntity,
          { id: 'b' },
          { status: 'invalid', statusReason: 'link_declined' }
        );
      });
    });
  });

  describe('refusals of the access service', () => {
    it('should relay a refusal of the role, before touching the store', async (): Promise<void> => {
      access.assertOrganizationRole.mockRejectedValue(httpError(403, 'Requires the admin role'));

      await expect(service.setCredentials(JANE, IDS.organization, ACCOUNT_ID, { secret: 'x' })).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(secrets.put).not.toHaveBeenCalled();
    });
  });

  describe('AdAccountServicePlugin', () => {
    it('should decorate the instance with an AdAccountService wired to its dependencies', async (): Promise<void> => {
      const app: FastifyInstance = await buildServiceApp([AdAccountServicePlugin], { db, access, secrets });
      db.manager.findOne.mockResolvedValue(row());

      expect(app.adAccountService).toBeInstanceOf(AdAccountService);
      await expect(app.adAccountService.get(JANE, IDS.organization, ACCOUNT_ID)).resolves.toMatchObject({
        id: ACCOUNT_ID,
      });

      await app.close();
    });
  });
});
