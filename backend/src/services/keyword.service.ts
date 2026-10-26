import { FastifyInstance } from 'fastify';
import fastifyPlugin from 'fastify-plugin';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';

import { KeywordEntity, TargetingGroupEntity } from '@src/database/entities';
import { assertKeywordsPermitted } from '@src/levers/lever-profiles';
import {
  AddKeywordsBody,
  AuthContext,
  BulkFailure,
  BulkResult,
  Keyword,
  KeywordRemoval,
  ListKeywordsQuery,
  MatchType,
  MAX_KEYWORD_WORDS,
  Paginated,
  UpdateKeywordBody,
} from '@src/types';
import { httpError, toPage, toSkipTake } from '@utils';
import { AccessService } from './access.service';
import { toBulkFailure, toOrder } from './crud.helpers';
import { markCampaignDirty } from './sync.helpers';

/** One keyword as the caller sent it, once its text is normalized. */
type NormalizedKeyword = { text: string; matchType: MatchType; negative: boolean };

/**
 * Map a keyword row to its API shape.
 *
 * @param entity - The row
 * @returns The API representation
 */
export function toKeyword(entity: KeywordEntity): Keyword {
  return {
    id: entity.id,
    targetingGroupId: entity.targetingGroupId,
    text: entity.text,
    matchType: entity.matchType,
    negative: entity.negative,
    createdAt: entity.createdAt.toISOString(),
  };
}

/**
 * The keywords of a TargetingGroup: the words a Search campaign buys, and those it refuses.
 *
 * They are rows and not a dimension of the targeting object because there are thousands of them
 * (`docs/phase-5.md` § 4), and posting them is **one** write however many there are: the texts are
 * judged in memory, the valid ones are inserted in a single statement that ignores the duplicates,
 * and the answer is read back. A transaction per keyword — what the reference bulk does for richer
 * resources — would be hundreds of round trips for a list pasted from a spreadsheet.
 *
 * Posting a keyword the node already carries is **not** a failure: the answer is the row as it
 * stands, so pasting the same list twice changes nothing.
 */
export class KeywordService {
  /**
   * Create the service.
   *
   * @param dataSource - Application database
   * @param access - Permission checks
   */
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: AccessService
  ) {}

  /**
   * List the keywords of a TargetingGroup.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param targetingGroupId - The node
   * @param query - Page, and whether only the positive or only the negative ones are wanted
   * @returns A page of keywords, oldest first
   * @throws Error with status 404 when the caller cannot see the node
   */
  public async list(
    actor: AuthContext,
    organizationId: string,
    targetingGroupId: string,
    query: ListKeywordsQuery
  ): Promise<Paginated<Keyword>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'viewer');
    await this.nodeOrFail(this.dataSource.manager, organizationId, targetingGroupId);

    const [rows, total]: [KeywordEntity[], number] = await this.dataSource.manager.findAndCount(KeywordEntity, {
      where: {
        organizationId,
        targetingGroupId,
        ...(query.negative === undefined ? {} : { negative: query.negative }),
      },
      order: toOrder('createdAt', 'asc'),
      ...toSkipTake(query),
    });
    return toPage(rows.map(toKeyword), total, query);
  }

  /**
   * Post keywords on a TargetingGroup.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param targetingGroupId - The node
   * @param body - The mode, and the keywords
   * @returns What the node now carries for each line sent, and what was refused
   * @throws Error with status 403 without the manager role, 404 when the node is absent, 400 when the
   *   lever buys no keywords or — in `atomic` mode — when one text is refused
   */
  public async add(
    actor: AuthContext,
    organizationId: string,
    targetingGroupId: string,
    body: AddKeywordsBody
  ): Promise<BulkResult<Keyword>> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    const node: TargetingGroupEntity = await this.nodeOrFail(this.dataSource.manager, organizationId, targetingGroupId);
    assertKeywordsPermitted(node.lever);

    const wanted: NormalizedKeyword[] = [];
    const failed: BulkFailure[] = [];
    for (const [index, keyword] of body.keywords.entries()) {
      try {
        wanted.push({ ...keyword, text: this.normalize(keyword.text) });
      } catch (error: unknown) {
        if (body.mode === 'atomic') throw error;
        failed.push(toBulkFailure(error, index));
      }
    }

    if (wanted.length > 0) {
      // In one transaction with the dirty bit: a keyword that reached the table while its mark did
      // not would be a word nothing ever sends to a platform (`services/sync.helpers.ts`).
      await this.dataSource.transaction(async (manager: EntityManager): Promise<void> => {
        await manager
          .createQueryBuilder()
          .insert()
          .into(KeywordEntity)
          .values(
            wanted.map((keyword: NormalizedKeyword) => ({
              organizationId,
              campaignId: node.campaignId,
              targetingGroupId,
              ...keyword,
            }))
          )
          // A keyword the node already carries, or sent twice in the same request, is not a failure:
          // the unique index on (node, text, match type, polarity) absorbs it.
          .orIgnore()
          .execute();
        await markCampaignDirty(manager, node.campaignId);
      });
    }

    return { items: await this.readBack(organizationId, targetingGroupId, wanted), failed };
  }

  /**
   * Change the match type or the polarity of one keyword.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The keyword
   * @param body - What to change
   * @returns The keyword as it now stands
   * @throws Error with status 403 without the manager role, 404 when absent, 409 when the node
   *   already carries the same word with the shape asked for
   */
  public async update(
    actor: AuthContext,
    organizationId: string,
    id: string,
    body: UpdateKeywordBody
  ): Promise<Keyword> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<Keyword> => {
      const keyword: KeywordEntity = await this.findOrFail(manager, organizationId, id);
      const shaped: NormalizedKeyword = {
        text: keyword.text,
        matchType: body.matchType ?? keyword.matchType,
        negative: body.negative ?? keyword.negative,
      };
      const twin: KeywordEntity | null = await manager.findOne(KeywordEntity, {
        where: { targetingGroupId: keyword.targetingGroupId, ...shaped },
      });
      if (twin && twin.id !== keyword.id) {
        throw httpError(409, 'This targeting group already carries that keyword with that shape', {
          code: 'keyword_already_exists',
          params: { text: shaped.text, matchType: shaped.matchType, negative: shaped.negative },
        });
      }
      await manager.update(KeywordEntity, { id }, { matchType: shaped.matchType, negative: shaped.negative });
      await markCampaignDirty(manager, keyword.campaignId);
      return toKeyword({ ...keyword, ...shaped });
    });
  }

  /**
   * Remove one keyword, for good.
   *
   * @param actor - The caller
   * @param organizationId - The Organization
   * @param id - The keyword
   * @returns Its id, and that it is gone
   * @throws Error with status 403 without the manager role, 404 when absent
   */
  public async remove(actor: AuthContext, organizationId: string, id: string): Promise<KeywordRemoval> {
    await this.access.assertOrganizationRole(actor, organizationId, 'manager');
    return this.dataSource.transaction(async (manager: EntityManager): Promise<KeywordRemoval> => {
      const keyword: KeywordEntity = await this.findOrFail(manager, organizationId, id);
      await manager.delete(KeywordEntity, { id: keyword.id });
      await markCampaignDirty(manager, keyword.campaignId);
      return { id: keyword.id, deleted: true };
    });
  }

  /**
   * The rows the node carries for the lines that were sent, in the order they were sent.
   *
   * @param organizationId - The Organization
   * @param targetingGroupId - The node
   * @param wanted - The normalized keywords
   * @returns Their rows, the duplicates of one row answered once
   */
  private async readBack(
    organizationId: string,
    targetingGroupId: string,
    wanted: NormalizedKeyword[]
  ): Promise<Keyword[]> {
    if (wanted.length === 0) return [];
    const rows: KeywordEntity[] = await this.dataSource.manager.find(KeywordEntity, {
      where: {
        organizationId,
        targetingGroupId,
        text: In(wanted.map((keyword: NormalizedKeyword): string => keyword.text)),
      },
    });
    const byKey = new Map<string, KeywordEntity>(
      rows.map((row: KeywordEntity): [string, KeywordEntity] => [this.keyOf(row), row])
    );
    const answered = new Set<string>();
    const items: Keyword[] = [];
    for (const keyword of wanted) {
      const key: string = this.keyOf(keyword);
      const row: KeywordEntity | undefined = byKey.get(key);
      if (row === undefined || answered.has(key)) continue;
      answered.add(key);
      items.push(toKeyword(row));
    }
    return items;
  }

  /**
   * The identity of a keyword inside its node: the text, the match type and the polarity.
   *
   * @param keyword - The keyword or its row
   * @returns The key
   */
  private keyOf(keyword: NormalizedKeyword): string {
    return `${keyword.text}\u0000${keyword.matchType}\u0000${String(keyword.negative)}`;
  }

  /**
   * Normalize a keyword's text, and refuse what the platforms would refuse.
   *
   * Lower-cased with single spaces, as multi-search stores it: `Chaussures  DE Rando` and
   * `chaussures de rando` are the same keyword, and storing both would buy the same word twice.
   *
   * @param text - What the caller sent
   * @returns The normalized text
   * @throws Error with status 400 coded `keyword_text_invalid` when it holds too many words
   */
  private normalize(text: string): string {
    const normalized: string = text.trim().toLowerCase().replace(/\s+/g, ' ');
    const words: number = normalized.split(' ').length;
    if (words > MAX_KEYWORD_WORDS) {
      throw httpError(400, `A keyword holds at most ${MAX_KEYWORD_WORDS} words`, {
        code: 'keyword_text_invalid',
        params: { text: normalized, words, max: MAX_KEYWORD_WORDS },
      });
    }
    return normalized;
  }

  /**
   * Find a keyword of the Organization, or answer 404.
   *
   * @param manager - The transaction to read in
   * @param organizationId - The Organization
   * @param id - The keyword
   * @returns The row
   * @throws Error with status 404 coded `keyword_not_found`
   */
  private async findOrFail(manager: EntityManager, organizationId: string, id: string): Promise<KeywordEntity> {
    const keyword: KeywordEntity | null = await manager.findOne(KeywordEntity, { where: { id, organizationId } });
    if (!keyword) throw httpError(404, 'This keyword does not exist', { code: 'keyword_not_found' });
    return keyword;
  }

  /**
   * Find the TargetingGroup the keywords hang from, or answer 404.
   *
   * @param manager - The transaction to read in
   * @param organizationId - The Organization
   * @param id - The node
   * @returns The row
   * @throws Error with status 404 coded `targeting_group_not_found`
   */
  private async nodeOrFail(manager: EntityManager, organizationId: string, id: string): Promise<TargetingGroupEntity> {
    const node: TargetingGroupEntity | null = await manager.findOne(TargetingGroupEntity, {
      where: { id, organizationId, deletedAt: IsNull() },
    });
    if (!node) throw httpError(404, 'This targeting group does not exist', { code: 'targeting_group_not_found' });
    return node;
  }
}

/**
 * Fastify plugin that decorates the instance with a {@link KeywordService}.
 *
 * Depends on `DatabasePlugin` and `AccessServicePlugin`.
 *
 * @param fastify - The Fastify instance to decorate
 */
async function keywordServicePlugin(fastify: FastifyInstance): Promise<void> {
  fastify.decorate('keywordService', new KeywordService(fastify.db, fastify.accessService));
}

export default fastifyPlugin(keywordServicePlugin, {
  name: 'KeywordServicePlugin',
  dependencies: ['DatabasePlugin', 'AccessServicePlugin'],
});
