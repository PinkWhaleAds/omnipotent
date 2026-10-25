import { EntityManager, EntityTarget, FindOperator, ObjectLiteral } from 'typeorm';

/**
 * An in-memory stand-in for the `EntityManager` of the campaign tree.
 *
 * The mechanics of the tree walk four levels, filter on `In([...])` and on a deletion instant, and
 * mutate rows — asserting on jest mocks would say which calls were made, never whether the subtree
 * ended up right. This fake holds rows per entity and answers the few operations those mechanics
 * use, so a spec states the tree it starts from and reads the tree it ends with.
 *
 * It implements only what is needed: `find`, `findOne`, `update` and `transaction`. Anything else
 * belongs in `data-source.mock.ts`, which mocks calls rather than behaviour.
 */
export type TreeStore = {
  /** Pass this where an `EntityManager` is expected. */
  manager: EntityManager;
  /** Pass this where a `DataSource` is expected; its transaction hands out the same manager. */
  dataSource: { transaction: jest.Mock; manager: EntityManager };
  /** The rows of one entity, live and deleted alike. */
  rows: (entity: EntityTarget<ObjectLiteral>) => ObjectLiteral[];
  /** Add rows to an entity. */
  seed: (entity: EntityTarget<ObjectLiteral>, rows: ObjectLiteral[]) => void;
};

/**
 * Whether a row's column matches one condition of a `where`.
 *
 * @param value - What the row holds
 * @param condition - What the query asks for: a value, a date, or an `In([...])`
 * @returns Whether it matches
 */
function matches(value: unknown, condition: unknown): boolean {
  if (condition instanceof FindOperator) {
    const expected: unknown = condition.value;
    if (condition.type === 'in') return (expected as unknown[]).some((one: unknown): boolean => matches(value, one));
    if (condition.type === 'isNull') return value === null || value === undefined;
    return matches(value, expected);
  }
  if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
  return value === condition;
}

/**
 * Build the in-memory store.
 *
 * @returns The store, its manager and its data source
 *
 * @example
 * ```typescript
 * const store: TreeStore = createTreeStore();
 * store.seed(CampaignEntity, [{ id: 'c1', budgetCents: 100000, deletedAt: null }]);
 * await cascadeDelete(store.manager, 'campaign', 'c1', new Date());
 * ```
 */
export function createTreeStore(): TreeStore {
  const tables = new Map<unknown, ObjectLiteral[]>();
  const rows = (entity: EntityTarget<ObjectLiteral>): ObjectLiteral[] => {
    if (!tables.has(entity)) tables.set(entity, []);
    return tables.get(entity) as ObjectLiteral[];
  };

  const select = (
    entity: EntityTarget<ObjectLiteral>,
    options?: { where?: ObjectLiteral; withDeleted?: boolean; order?: ObjectLiteral }
  ): ObjectLiteral[] => {
    const where: ObjectLiteral = options?.where ?? {};
    return rows(entity).filter((row: ObjectLiteral): boolean => {
      if (options?.withDeleted !== true && 'deletedAt' in row && row.deletedAt !== null) return false;
      return Object.entries(where).every(([column, condition]: [string, unknown]): boolean =>
        matches(row[column], condition)
      );
    });
  };

  const manager = {
    find: jest.fn(async (entity: EntityTarget<ObjectLiteral>, options?: ObjectLiteral): Promise<ObjectLiteral[]> =>
      select(entity, options)
    ),
    findOne: jest.fn(
      async (entity: EntityTarget<ObjectLiteral>, options?: ObjectLiteral): Promise<ObjectLiteral | null> =>
        select(entity, options)[0] ?? null
    ),
    update: jest.fn(
      async (
        entity: EntityTarget<ObjectLiteral>,
        where: ObjectLiteral,
        patch: ObjectLiteral
      ): Promise<{ affected: number }> => {
        const touched: ObjectLiteral[] = rows(entity).filter((row: ObjectLiteral): boolean =>
          Object.entries(where).every(([column, condition]: [string, unknown]): boolean =>
            matches(row[column], condition)
          )
        );
        for (const row of touched) Object.assign(row, patch);
        return { affected: touched.length };
      }
    ),
  } as unknown as EntityManager;

  return {
    manager,
    dataSource: {
      transaction: jest.fn(async (body: (manager: EntityManager) => Promise<unknown>): Promise<unknown> =>
        body(manager)
      ),
      manager,
    },
    rows,
    seed: (entity: EntityTarget<ObjectLiteral>, seeded: ObjectLiteral[]): void => {
      rows(entity).push(...seeded);
    },
  };
}
