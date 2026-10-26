import { EntityManager, EntityTarget, FindOperator, ObjectLiteral } from 'typeorm';

/**
 * An in-memory stand-in for the `EntityManager` of the campaign tree.
 *
 * The mechanics of the tree walk four levels, filter on `In([...])` and on a deletion instant, and
 * mutate rows — asserting on jest mocks would say which calls were made, never whether the subtree
 * ended up right. This fake holds rows per entity and answers the few operations those mechanics
 * use, so a spec states the tree it starts from and reads the tree it ends with.
 *
 * It implements only what is needed: `find`, `findOne`, `insert`, `delete`, `update`, `query` and
 * `transaction`, plus the query runner the campaign lock takes. Anything else belongs in
 * `data-source.mock.ts`, which mocks calls rather than behaviour.
 */
export type TreeStore = {
  /** Pass this where an `EntityManager` is expected. */
  manager: EntityManager;
  /** Pass this where a `DataSource` is expected; its transaction hands out the same manager. */
  dataSource: { transaction: jest.Mock; manager: EntityManager; createQueryRunner: jest.Mock };
  /** Raw SQL, which no fake can run: a spec that goes through it says what it answers. */
  query: jest.Mock;
  /** What `pg_try_advisory_lock` answers; `false` makes a spec act as a second worker. */
  setLocked: (locked: boolean) => void;
  /** The rows of one entity, live and deleted alike. */
  rows: (entity: EntityTarget<ObjectLiteral>) => ObjectLiteral[];
  /** Add rows to an entity. */
  seed: (entity: EntityTarget<ObjectLiteral>, rows: ObjectLiteral[]) => void;
};

/**
 * Whether a row's column matches one condition of a `where`.
 *
 * @param value - What the row holds
 * @param condition - What the query asks for: a value, a date, or a find operator
 * @returns Whether it matches
 */
function matches(value: unknown, condition: unknown): boolean {
  if (condition instanceof FindOperator) {
    const expected: unknown = condition.value;
    if (condition.type === 'in') return (expected as unknown[]).some((one: unknown): boolean => matches(value, one));
    if (condition.type === 'isNull') return value === null || value === undefined;
    if (condition.type === 'not') return !matches(value, expected);
    // The comparisons the synchronization reads a backlog with: a null is never due.
    if (condition.type === 'lessThanOrEqual') return ordinal(value) !== null && ordinal(value)! <= ordinal(expected)!;
    if (condition.type === 'lessThan') return ordinal(value) !== null && ordinal(value)! < ordinal(expected)!;
    if (condition.type === 'moreThanOrEqual') return ordinal(value) !== null && ordinal(value)! >= ordinal(expected)!;
    if (condition.type === 'moreThan') return ordinal(value) !== null && ordinal(value)! > ordinal(expected)!;
    return matches(value, expected);
  }
  if (condition instanceof Date) return value instanceof Date && value.getTime() === condition.getTime();
  return value === condition;
}

/**
 * A value as a comparison reads it: a date becomes its instant, a number stays itself.
 *
 * @param value - What the row holds, or what the query asks for
 * @returns The comparable number, or `null` for something no comparison is true of
 */
function ordinal(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return null;
}

/**
 * Whether a row matches a `where`, which TypeORM also accepts as a list of alternatives.
 *
 * @param row - The row
 * @param where - One set of conditions, or several read as a disjunction
 * @returns Whether it matches
 */
function matchesWhere(row: ObjectLiteral, where: ObjectLiteral | ObjectLiteral[]): boolean {
  if (Array.isArray(where)) return where.some((one: ObjectLiteral): boolean => matchesWhere(row, one));
  return Object.entries(where).every(([column, condition]: [string, unknown]): boolean =>
    matches(row[column], condition)
  );
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
  const query: jest.Mock = jest.fn(async (): Promise<unknown[]> => []);
  let locked = true;
  const rows = (entity: EntityTarget<ObjectLiteral>): ObjectLiteral[] => {
    if (!tables.has(entity)) tables.set(entity, []);
    return tables.get(entity) as ObjectLiteral[];
  };

  const select = (
    entity: EntityTarget<ObjectLiteral>,
    options?: { where?: ObjectLiteral | ObjectLiteral[]; withDeleted?: boolean; order?: ObjectLiteral }
  ): ObjectLiteral[] => {
    const where: ObjectLiteral | ObjectLiteral[] = options?.where ?? {};
    return rows(entity).filter((row: ObjectLiteral): boolean => {
      if (options?.withDeleted !== true && 'deletedAt' in row && row.deletedAt !== null) return false;
      return matchesWhere(row, where);
    });
  };

  // Copies, like TypeORM hydrating rows: a service that mutates what it read must not reach into the
  // table, or a spec would pass on an aliasing the real driver does not have.
  const copies = (rows: ObjectLiteral[]): ObjectLiteral[] =>
    rows.map((row: ObjectLiteral): ObjectLiteral => ({ ...row }));

  const manager = {
    find: jest.fn(async (entity: EntityTarget<ObjectLiteral>, options?: ObjectLiteral): Promise<ObjectLiteral[]> =>
      copies(select(entity, options))
    ),
    findOne: jest.fn(
      async (entity: EntityTarget<ObjectLiteral>, options?: ObjectLiteral): Promise<ObjectLiteral | null> =>
        copies(select(entity, options))[0] ?? null
    ),
    insert: jest.fn(
      async (
        entity: EntityTarget<ObjectLiteral>,
        inserted: ObjectLiteral | ObjectLiteral[]
      ): Promise<ObjectLiteral> => {
        const added: ObjectLiteral[] = Array.isArray(inserted) ? inserted : [inserted];
        rows(entity).push(...added.map((row: ObjectLiteral): ObjectLiteral => ({ ...row })));
        return { identifiers: added.map((): ObjectLiteral => ({})) };
      }
    ),
    delete: jest.fn(
      async (entity: EntityTarget<ObjectLiteral>, where: ObjectLiteral): Promise<{ affected: number }> => {
        const kept: ObjectLiteral[] = rows(entity).filter((row: ObjectLiteral): boolean => !matchesWhere(row, where));
        const removed: number = rows(entity).length - kept.length;
        tables.set(entity, kept);
        return { affected: removed };
      }
    ),
    update: jest.fn(
      async (
        entity: EntityTarget<ObjectLiteral>,
        where: ObjectLiteral,
        patch: ObjectLiteral
      ): Promise<{ affected: number }> => {
        const touched: ObjectLiteral[] = rows(entity).filter((row: ObjectLiteral): boolean => matchesWhere(row, where));
        for (const row of touched) Object.assign(row, patch);
        return { affected: touched.length };
      }
    ),
    query,
  } as unknown as EntityManager;

  return {
    manager,
    query,
    setLocked: (next: boolean): void => {
      locked = next;
    },
    dataSource: {
      transaction: jest.fn(async (body: (manager: EntityManager) => Promise<unknown>): Promise<unknown> =>
        body(manager)
      ),
      manager,
      // The campaign lock of D46: a runner that answers `pg_try_advisory_lock` and nothing else.
      createQueryRunner: jest.fn(() => ({
        connect: jest.fn(async (): Promise<void> => undefined),
        release: jest.fn(async (): Promise<void> => undefined),
        query: jest.fn(async (sql: string): Promise<unknown> =>
          sql.includes('pg_try_advisory_lock') ? [{ locked }] : []
        ),
      })),
    },
    rows,
    seed: (entity: EntityTarget<ObjectLiteral>, seeded: ObjectLiteral[]): void => {
      rows(entity).push(...seeded);
    },
  };
}
