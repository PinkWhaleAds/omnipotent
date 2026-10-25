import { FastifyInstance } from 'fastify';

import { KeywordEntity, TargetingGroupEntity } from '@src/database/entities';
import KeywordServicePlugin, { KeywordService, toKeyword } from '@src/services/keyword.service';
import { BulkResult, Keyword, Paginated } from '@src/types';
import { AccessServiceMock, buildServiceApp, createAccessMock } from '@test/unit/mocks/access.mock';
import { IDS, JANE, NOW } from '@test/unit/mocks/auth.fixtures';
import { createDataSourceMock, DataSourceMock, QueryBuilderMock } from '@test/unit/mocks/data-source.mock';
import { httpError } from '@utils';

/** The TargetingGroup the keywords hang from, and the campaign above it. */
const NODE_ID = 'f4000000-0000-4000-8000-000000000001';
const CAMPAIGN_ID = 'f1000000-0000-4000-8000-000000000001';

/** The keyword the specs work with. */
const KEYWORD_ID = 'fb000000-0000-4000-8000-000000000001';

/**
 * The node the keywords hang from: a Search TargetingGroup, since only Search buys words.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function node(overrides: Partial<TargetingGroupEntity> = {}): TargetingGroupEntity {
  return {
    id: NODE_ID,
    organizationId: IDS.organization,
    campaignId: CAMPAIGN_ID,
    lever: 'search',
    deletedAt: null,
    ...overrides,
  } as unknown as TargetingGroupEntity;
}

/**
 * A keyword row.
 *
 * @param overrides - Columns to change
 * @returns The row
 */
function keyword(overrides: Partial<KeywordEntity> = {}): KeywordEntity {
  return {
    id: KEYWORD_ID,
    organizationId: IDS.organization,
    campaignId: CAMPAIGN_ID,
    targetingGroupId: NODE_ID,
    text: 'chaussures de rando',
    matchType: 'broad',
    negative: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as unknown as KeywordEntity;
}

describe('Unit::Services::KeywordService', () => {
  let db: DataSourceMock;
  let access: AccessServiceMock;
  let service: KeywordService;

  beforeEach((): void => {
    jest.clearAllMocks();
    db = createDataSourceMock();
    access = createAccessMock();
    service = new KeywordService(db.dataSource, access as never);
    db.manager.findOne.mockResolvedValue(node());
  });

  describe('list', () => {
    it('should answer a page of the keywords of the node, oldest first', async (): Promise<void> => {
      db.manager.findAndCount.mockResolvedValue([[keyword()], 1]);

      const page: Paginated<Keyword> = await service.list(JANE, IDS.organization, NODE_ID, { page: 1, limit: 50 });

      expect(page.items).toEqual([toKeyword(keyword())]);
      expect(db.manager.findAndCount).toHaveBeenCalledWith(KeywordEntity, {
        where: { organizationId: IDS.organization, targetingGroupId: NODE_ID },
        order: { createdAt: 'ASC', id: 'ASC' },
        skip: 0,
        take: 50,
      });
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'viewer');
    });

    it('should filter on the polarity when the caller asked for one', async (): Promise<void> => {
      await service.list(JANE, IDS.organization, NODE_ID, { page: 1, limit: 50, negative: true });

      expect(db.manager.findAndCount).toHaveBeenCalledWith(
        KeywordEntity,
        expect.objectContaining({
          where: { organizationId: IDS.organization, targetingGroupId: NODE_ID, negative: true },
        })
      );
    });

    it('should not find the keywords of a node it cannot see', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(service.list(JANE, IDS.organization, NODE_ID, { page: 1, limit: 50 })).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'targeting_group_not_found',
      });
    });
  });

  describe('add', () => {
    it('should normalize the texts, and insert them ignoring the duplicates', async (): Promise<void> => {
      const builder: QueryBuilderMock = db.builder();
      db.manager.find.mockResolvedValue([keyword({ text: 'chaussures de rando', matchType: 'exact' })]);

      const result: BulkResult<Keyword> = await service.add(JANE, IDS.organization, NODE_ID, {
        mode: 'atomic',
        keywords: [{ text: '  Chaussures   DE Rando ', matchType: 'exact', negative: false }],
      });

      expect(builder.values).toHaveBeenCalledWith([
        {
          organizationId: IDS.organization,
          campaignId: CAMPAIGN_ID,
          targetingGroupId: NODE_ID,
          text: 'chaussures de rando',
          matchType: 'exact',
          negative: false,
        },
      ]);
      expect(builder.orIgnore).toHaveBeenCalled();
      expect(result).toEqual({ items: [toKeyword(keyword({ matchType: 'exact' }))], failed: [] });
      expect(access.assertOrganizationRole).toHaveBeenCalledWith(JANE, IDS.organization, 'manager');
    });

    it('should answer a keyword the node already carries rather than refusing it', async (): Promise<void> => {
      db.manager.find.mockResolvedValue([keyword()]);

      const result: BulkResult<Keyword> = await service.add(JANE, IDS.organization, NODE_ID, {
        mode: 'atomic',
        keywords: [
          { text: 'chaussures de rando', matchType: 'broad', negative: false },
          { text: 'chaussures de rando', matchType: 'broad', negative: false },
        ],
      });

      // The same line twice is one keyword, answered once.
      expect(result.items).toHaveLength(1);
      expect(result.failed).toEqual([]);
    });

    it('should report a text that holds too many words, and keep the others, in partial mode', async (): Promise<void> => {
      db.manager.find.mockResolvedValue([keyword()]);

      const result: BulkResult<Keyword> = await service.add(JANE, IDS.organization, NODE_ID, {
        mode: 'partial',
        keywords: [
          { text: 'un deux trois quatre cinq six sept huit neuf dix onze', matchType: 'broad', negative: false },
          { text: 'chaussures de rando', matchType: 'broad', negative: false },
        ],
      });

      expect(result.items).toHaveLength(1);
      expect(result.failed).toEqual([
        {
          index: 0,
          code: 'keyword_text_invalid',
          params: expect.objectContaining({ words: 11, max: 10 }),
          message: expect.any(String),
        },
      ]);
    });

    it('should refuse the whole request on the first refused text in atomic mode', async (): Promise<void> => {
      await expect(
        service.add(JANE, IDS.organization, NODE_ID, {
          mode: 'atomic',
          keywords: [
            { text: 'un deux trois quatre cinq six sept huit neuf dix onze', matchType: 'broad', negative: false },
          ],
        })
      ).rejects.toMatchObject({ statusCode: 400, errorCode: 'keyword_text_invalid' });
      expect(db.builder().execute).not.toHaveBeenCalled();
    });

    it('should insert nothing when every text was refused', async (): Promise<void> => {
      const result: BulkResult<Keyword> = await service.add(JANE, IDS.organization, NODE_ID, {
        mode: 'partial',
        keywords: [
          { text: 'un deux trois quatre cinq six sept huit neuf dix onze', matchType: 'broad', negative: false },
        ],
      });

      expect(result).toEqual({ items: [], failed: [expect.objectContaining({ index: 0 })] });
      expect(db.builder().execute).not.toHaveBeenCalled();
      expect(db.manager.find).not.toHaveBeenCalled();
    });

    it('should leave out a line the store does not answer for', async (): Promise<void> => {
      // A row the read-back does not find is left out rather than invented: items then says what the
      // node really carries.
      db.manager.find.mockResolvedValue([]);

      const result: BulkResult<Keyword> = await service.add(JANE, IDS.organization, NODE_ID, {
        mode: 'atomic',
        keywords: [{ text: 'chaussures de rando', matchType: 'broad', negative: false }],
      });

      expect(result.items).toEqual([]);
    });

    it('should refuse keywords on a lever that buys none', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(node({ lever: 'dooh' }));

      await expect(
        service.add(JANE, IDS.organization, NODE_ID, {
          mode: 'atomic',
          keywords: [{ text: 'chaussures', matchType: 'broad', negative: false }],
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        errorCode: 'keywords_not_permitted',
        errorParams: { lever: 'dooh' },
      });
    });

    it('should rethrow a failure that carries no code, whatever the mode', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(node());
      const builder: QueryBuilderMock = db.builder();
      builder.execute.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.add(JANE, IDS.organization, NODE_ID, {
          mode: 'partial',
          keywords: [{ text: 'chaussures', matchType: 'broad', negative: false }],
        })
      ).rejects.toThrow('connection lost');
    });
  });

  describe('update', () => {
    it('should change the match type and the polarity', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValueOnce(keyword()).mockResolvedValueOnce(null);

      const changed: Keyword = await service.update(JANE, IDS.organization, KEYWORD_ID, {
        matchType: 'exact',
        negative: true,
      });

      expect(db.manager.update).toHaveBeenCalledWith(
        KeywordEntity,
        { id: KEYWORD_ID },
        { matchType: 'exact', negative: true }
      );
      expect(changed).toMatchObject({ matchType: 'exact', negative: true });
    });

    it('should keep what the caller left out', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValueOnce(keyword({ matchType: 'phrase' })).mockResolvedValueOnce(null);

      const changed: Keyword = await service.update(JANE, IDS.organization, KEYWORD_ID, { negative: true });

      expect(changed).toMatchObject({ matchType: 'phrase', negative: true });
    });

    it('should refuse a change that would duplicate another keyword of the node', async (): Promise<void> => {
      db.manager.findOne
        .mockResolvedValueOnce(keyword())
        .mockResolvedValueOnce(keyword({ id: 'fb000000-0000-4000-8000-000000000002', matchType: 'exact' }));

      await expect(service.update(JANE, IDS.organization, KEYWORD_ID, { matchType: 'exact' })).rejects.toMatchObject({
        statusCode: 409,
        errorCode: 'keyword_already_exists',
      });
      expect(db.manager.update).not.toHaveBeenCalled();
    });

    it('should accept a change that finds only the keyword itself', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValueOnce(keyword()).mockResolvedValueOnce(keyword());

      await expect(service.update(JANE, IDS.organization, KEYWORD_ID, { negative: false })).resolves.toMatchObject({
        id: KEYWORD_ID,
      });
    });

    it('should not find a keyword of another Organization', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(service.update(JANE, IDS.organization, KEYWORD_ID, { negative: true })).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'keyword_not_found',
      });
    });
  });

  describe('remove', () => {
    it('should delete the keyword for good', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(keyword());

      await expect(service.remove(JANE, IDS.organization, KEYWORD_ID)).resolves.toEqual({
        id: KEYWORD_ID,
        deleted: true,
      });
      expect(db.manager.delete).toHaveBeenCalledWith(KeywordEntity, { id: KEYWORD_ID });
    });

    it('should not find a keyword that is already gone', async (): Promise<void> => {
      db.manager.findOne.mockResolvedValue(null);

      await expect(service.remove(JANE, IDS.organization, KEYWORD_ID)).rejects.toMatchObject({
        statusCode: 404,
        errorCode: 'keyword_not_found',
      });
    });
  });

  describe('refusals of the access service', () => {
    it('should relay a refusal of the role, before reading anything', async (): Promise<void> => {
      access.assertOrganizationRole.mockRejectedValue(httpError(403, 'Requires the manager role'));

      await expect(service.remove(JANE, IDS.organization, KEYWORD_ID)).rejects.toMatchObject({ statusCode: 403 });
      expect(db.mocks.transaction).not.toHaveBeenCalled();
    });
  });

  describe('KeywordServicePlugin', () => {
    it('should decorate the instance with a KeywordService wired to its dependencies', async (): Promise<void> => {
      const app: FastifyInstance = await buildServiceApp([KeywordServicePlugin], { db, access });
      db.manager.findAndCount.mockResolvedValue([[keyword()], 1]);

      expect(app.keywordService).toBeInstanceOf(KeywordService);
      await expect(
        app.keywordService.list(JANE, IDS.organization, NODE_ID, { page: 1, limit: 50 })
      ).resolves.toMatchObject({ total: 1 });

      await app.close();
    });
  });
});
