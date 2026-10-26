import { PlatformCallEntity } from '@src/database/entities';
import PlatformCallJournalPlugin, {
  PlatformCallJournal,
  PlatformCallRecord,
} from '@src/services/platform-call.service';
import { AccessServiceMock, buildServiceApp, createAccessMock } from '@test/unit/mocks/access.mock';
import { createDataSourceMock, DataSourceMock } from '@test/unit/mocks/data-source.mock';

/**
 * One call, as the journal receives it.
 *
 * @param overrides - What this case declares
 * @returns The record
 */
function call(overrides: Partial<PlatformCallRecord> = {}): PlatformCallRecord {
  return {
    platform: 'hawk',
    adAccountId: 'ff000000-0000-4000-8000-000000000001',
    method: 'POST',
    path: '/v1/orders',
    statusCode: 200,
    durationMs: 120,
    requestId: 'r-1',
    error: null,
    operations: 1,
    ...overrides,
  };
}

describe('Unit::Services::PlatformCallJournal', () => {
  let db: DataSourceMock;
  let journal: PlatformCallJournal;

  beforeEach((): void => {
    jest.clearAllMocks();
    db = createDataSourceMock();
    journal = new PlatformCallJournal(db.dataSource);
  });

  it('should record one line per call', async (): Promise<void> => {
    db.repository(PlatformCallEntity).insert.mockResolvedValue({});

    journal.record(call());
    await Promise.resolve();

    expect(db.repository(PlatformCallEntity).insert).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'hawk', method: 'POST', path: '/v1/orders', operations: 1 })
    );
  });

  it('should cut a path and a request id to what the columns hold', async (): Promise<void> => {
    db.repository(PlatformCallEntity).insert.mockResolvedValue({});

    journal.record(call({ path: '/'.padEnd(600, 'a'), requestId: 'r'.repeat(200) }));
    await Promise.resolve();

    const [recorded]: [{ path: string; requestId: string | null }] = db.repository(PlatformCallEntity).insert.mock
      .calls[0] as [{ path: string; requestId: string | null }];
    expect(recorded.path).toHaveLength(512);
    expect(recorded.requestId).toHaveLength(128);
  });

  it('should keep a missing request id missing', async (): Promise<void> => {
    db.repository(PlatformCallEntity).insert.mockResolvedValue({});

    journal.record(call({ requestId: null }));
    await Promise.resolve();

    expect(db.repository(PlatformCallEntity).insert).toHaveBeenCalledWith(expect.objectContaining({ requestId: null }));
  });

  it('should never fail the call it describes', async (): Promise<void> => {
    db.repository(PlatformCallEntity).insert.mockRejectedValue(new Error('table is gone'));

    // A journal that can break a sync is worse than no journal.
    expect((): void => journal.record(call())).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  describe('PlatformCallJournalPlugin', () => {
    it('should decorate the instance', async (): Promise<void> => {
      const access: AccessServiceMock = createAccessMock();
      const app = await buildServiceApp([PlatformCallJournalPlugin], { db, access });

      expect(app.platformCallJournal).toBeInstanceOf(PlatformCallJournal);
      await app.close();
    });
  });
});
