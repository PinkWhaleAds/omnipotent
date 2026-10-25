import { applyLabelFilter, runBulk, toOrder } from '@src/services/crud.helpers';
import { BulkResult } from '@src/types/crud.types';
import { createDataSourceMock, createQueryBuilderMock, DataSourceMock } from '@test/unit/mocks/data-source.mock';
import { httpError } from '@utils';

describe('Unit::Services::CrudHelpers', () => {
  describe('runBulk', () => {
    let db: DataSourceMock;

    beforeEach((): void => {
      db = createDataSourceMock();
    });

    it('should run an atomic bulk in one transaction, in the order the items were sent', async (): Promise<void> => {
      const result: BulkResult<string> = await runBulk(
        db.dataSource,
        'atomic',
        ['a', 'b'],
        async (item, index) => `${index}:${item}`
      );

      expect(result).toEqual({ items: ['0:a', '1:b'], failed: [] });
      expect(db.mocks.transaction).toHaveBeenCalledTimes(1);
    });

    it('should cancel a whole atomic bulk on the first failure, answering its own error', async (): Promise<void> => {
      await expect(
        runBulk(db.dataSource, 'atomic', ['a', 'b'], async (item: string) => {
          if (item === 'b') throw httpError(409, 'Taken', { code: 'advertiser_name_taken', params: { name: 'b' } });
          return item;
        })
      ).rejects.toMatchObject({ statusCode: 409, errorCode: 'advertiser_name_taken' });
    });

    it('should give each item of a partial bulk its own transaction, and report the failures', async (): Promise<void> => {
      const result: BulkResult<string> = await runBulk(db.dataSource, 'partial', ['a', 'b', 'c'], async (item) => {
        if (item === 'b') throw httpError(404, 'Not found', { code: 'advertiser_not_found' });
        return item;
      });

      expect(result).toEqual({
        items: ['a', 'c'],
        failed: [{ index: 1, code: 'advertiser_not_found', params: {}, message: 'Not found' }],
      });
      expect(db.mocks.transaction).toHaveBeenCalledTimes(3);
    });

    it('should not report a failure the caller cannot act on: it fails the whole request', async (): Promise<void> => {
      const unexpected: Error = new Error('connection lost');

      await expect(
        runBulk(db.dataSource, 'partial', ['a'], async (): Promise<string> => {
          throw unexpected;
        })
      ).rejects.toBe(unexpected);
    });

    it('should not report a 5xx per item either', async (): Promise<void> => {
      await expect(
        runBulk(db.dataSource, 'partial', ['a'], async (): Promise<string> => {
          throw httpError(503, 'omnipass is unavailable', { code: 'tenancy_unavailable' });
        })
      ).rejects.toMatchObject({ statusCode: 503 });
    });

    it('should not report a 4xx carrying no stable code', async (): Promise<void> => {
      const coded: Error = Object.assign(new Error('Refused'), { statusCode: 400 });

      await expect(
        runBulk(db.dataSource, 'partial', ['a'], async (): Promise<string> => {
          throw coded;
        })
      ).rejects.toBe(coded);
    });
  });

  describe('toOrder', () => {
    it('should end every order by the primary key', (): void => {
      expect(toOrder('name', 'asc')).toEqual({ name: 'ASC', id: 'ASC' });
      expect(toOrder('createdAt', 'desc')).toEqual({ createdAt: 'DESC', id: 'DESC' });
    });

    it('should not repeat the primary key when it is the sort itself', (): void => {
      expect(toOrder('id', 'desc')).toEqual({ id: 'DESC' });
    });
  });

  describe('applyLabelFilter', () => {
    it('should leave a query alone when no Label was asked for', (): void => {
      const builder: ReturnType<typeof createQueryBuilderMock> = createQueryBuilderMock('advertiser');

      expect(applyLabelFilter(builder as never, 'advertiser', undefined, 'any')).toBe(builder);
      expect(applyLabelFilter(builder as never, 'advertiser', [], 'any')).toBe(builder);
      expect(builder.andWhere).not.toHaveBeenCalled();
    });

    it('should match at least one of the Labels in `any` mode', (): void => {
      const builder: ReturnType<typeof createQueryBuilderMock> = createQueryBuilderMock('advertiser');

      applyLabelFilter(builder as never, 'advertiser', ['one', 'two'], 'any');

      const [sql, parameters]: [string, object] = builder.andWhere.mock.calls[0] as [string, object];
      expect(sql).toContain('EXISTS');
      expect(sql).toContain('assignment.resource_id = advertiser.id');
      expect(sql).not.toContain('HAVING');
      expect(parameters).toEqual({ labelResourceType: 'advertiser', labelIds: ['one', 'two'], labelCount: 2 });
    });

    it('should demand every Label in `all` mode, counting the distinct ones matched', (): void => {
      const builder: ReturnType<typeof createQueryBuilderMock> = createQueryBuilderMock('advertiser');

      applyLabelFilter(builder as never, 'advertiser', ['one', 'two'], 'all');

      expect(builder.andWhere.mock.calls[0][0]).toContain('HAVING COUNT(DISTINCT assignment.label_id) = :labelCount');
    });
  });
});
