import { DataSource } from 'typeorm';

/**
 * Jest mock of the TypeORM repository methods the services use.
 *
 * `create` returns a shallow copy of its input and `save` resolves with the
 * entity it received, so "create then save" flows return what was built.
 */
export type RepositoryMock = {
  createQueryBuilder: jest.Mock;
  find: jest.Mock;
  findBy: jest.Mock;
  findOne: jest.Mock;
  findOneBy: jest.Mock;
  findAndCount: jest.Mock;
  exists: jest.Mock;
  existsBy: jest.Mock;
  count: jest.Mock;
  countBy: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  insert: jest.Mock;
  upsert: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  softDelete: jest.Mock;
};

/**
 * Jest mock of the `EntityManager` methods used inside transactions.
 * Every method but `query`, `getRepository` and `createQueryBuilder` takes the entity class as first
 * argument, like TypeORM's.
 */
export type EntityManagerMock = {
  createQueryBuilder: jest.Mock;
  find: jest.Mock;
  findAndCount: jest.Mock;
  findOne: jest.Mock;
  findOneBy: jest.Mock;
  exists: jest.Mock;
  existsBy: jest.Mock;
  count: jest.Mock;
  countBy: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  insert: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  softDelete: jest.Mock;
  query: jest.Mock;
  getRepository: jest.Mock;
};

/**
 * Jest mock of a TypeORM query builder: every clause returns the builder, so the chain a service
 * writes works — a select as well as an insert — and every terminal method answers nothing found.
 *
 * `alias` is the one `createQueryBuilder(alias)` was given, which the SQL of a service reads
 * (see `applyLabelFilter`).
 */
export type QueryBuilderMock = {
  alias: string;
  select: jest.Mock;
  from: jest.Mock;
  insert: jest.Mock;
  into: jest.Mock;
  values: jest.Mock;
  orIgnore: jest.Mock;
  execute: jest.Mock;
  innerJoinAndMapOne: jest.Mock;
  withDeleted: jest.Mock;
  innerJoin: jest.Mock;
  leftJoin: jest.Mock;
  where: jest.Mock;
  andWhere: jest.Mock;
  orderBy: jest.Mock;
  addOrderBy: jest.Mock;
  skip: jest.Mock;
  take: jest.Mock;
  limit: jest.Mock;
  getOne: jest.Mock;
  getMany: jest.Mock;
  getManyAndCount: jest.Mock;
  getRawMany: jest.Mock;
  getCount: jest.Mock;
};

/** A fake data source plus handles on its repositories, its manager and its query builders. */
export type DataSourceMock = {
  /** Pass this where a `DataSource` is expected. */
  dataSource: DataSource;
  /** Repository mock of an entity class (created on first access, then reused). */
  repository: (entity: unknown) => RepositoryMock;
  /** Entity manager handed to `dataSource.transaction(callback)`, and `dataSource.manager`. */
  manager: EntityManagerMock;
  /**
   * Query builder mock of an alias (created on first access, then reused), whatever asked for it:
   * configure it before calling the service, and the service gets the same one.
   */
  builder: (alias?: string) => QueryBuilderMock;
  /** Raw jest mocks of the data source itself. */
  mocks: {
    getRepository: jest.Mock;
    transaction: jest.Mock;
    query: jest.Mock;
    createQueryBuilder: jest.Mock;
    createQueryRunner: jest.Mock;
  };
  /**
   * The query runner every `createQueryRunner()` hands out: its `query` answers `pg_try_advisory_lock`
   * with the lock held (D46) — `{ locked: false }` makes a spec act as a second worker — and nothing else.
   */
  runner: { connect: jest.Mock; release: jest.Mock; query: jest.Mock };
};

/**
 * Build a query builder mock: the clauses chain, the terminals answer nothing.
 *
 * @param alias - The alias `createQueryBuilder` was called with
 * @returns The builder mock
 *
 * @example
 * ```typescript
 * const builder: QueryBuilderMock = createQueryBuilderMock('advertiser');
 * builder.getManyAndCount.mockResolvedValue([[row], 1]);
 * ```
 */
export function createQueryBuilderMock(alias = ''): QueryBuilderMock {
  const builder: Partial<QueryBuilderMock> = { alias };
  const clauses: string[] = [
    'select',
    'from',
    'insert',
    'into',
    'values',
    'orIgnore',
    'innerJoinAndMapOne',
    'innerJoin',
    'leftJoin',
    'withDeleted',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'skip',
    'take',
    'limit',
  ];
  for (const clause of clauses) {
    (builder as Record<string, jest.Mock>)[clause] = jest.fn((): Partial<QueryBuilderMock> => builder);
  }
  builder.execute = jest.fn().mockResolvedValue({ identifiers: [], raw: [] });
  builder.getOne = jest.fn().mockResolvedValue(null);
  builder.getMany = jest.fn().mockResolvedValue([]);
  builder.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
  builder.getRawMany = jest.fn().mockResolvedValue([]);
  builder.getCount = jest.fn().mockResolvedValue(0);
  return builder as QueryBuilderMock;
}

/**
 * Build a repository mock with neutral defaults (nothing found, saves echo their input).
 *
 * @param builder - Where its query builders come from; its own by default
 * @returns The repository mock
 */
export function createRepositoryMock(
  builder: (alias?: string) => QueryBuilderMock = createQueryBuilderMock
): RepositoryMock {
  return {
    createQueryBuilder: jest.fn((alias?: string): QueryBuilderMock => builder(alias)),
    find: jest.fn().mockResolvedValue([]),
    findBy: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findOneBy: jest.fn().mockResolvedValue(null),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    exists: jest.fn().mockResolvedValue(false),
    existsBy: jest.fn().mockResolvedValue(false),
    count: jest.fn().mockResolvedValue(0),
    countBy: jest.fn().mockResolvedValue(0),
    create: jest.fn((data: object): object => ({ ...data })),
    save: jest.fn(async (entity: object): Promise<object> => entity),
    insert: jest.fn().mockResolvedValue({ identifiers: [] }),
    upsert: jest.fn().mockResolvedValue({ identifiers: [] }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
  };
}

/**
 * Build a fake TypeORM data source for service unit tests.
 *
 * The repositories, the manager and the query builders are memoized: a spec configures the one its
 * service will ask for, by entity class or by alias, before calling it.
 *
 * @returns The fake and handles to configure and assert on it
 *
 * @example
 * ```typescript
 * const db: DataSourceMock = createDataSourceMock();
 * db.builder('advertiser').getManyAndCount.mockResolvedValue([[row], 1]);
 * const service: AdvertiserService = new AdvertiserService(db.dataSource, access, labels);
 * ```
 */
export function createDataSourceMock(): DataSourceMock {
  const builders = new Map<string, QueryBuilderMock>();
  const builder: (alias?: string) => QueryBuilderMock = (alias = ''): QueryBuilderMock => {
    if (!builders.has(alias)) builders.set(alias, createQueryBuilderMock(alias));
    return builders.get(alias)!;
  };

  const repositories = new Map<unknown, RepositoryMock>();
  const repository: (entity: unknown) => RepositoryMock = (entity: unknown): RepositoryMock => {
    if (!repositories.has(entity)) repositories.set(entity, createRepositoryMock(builder));
    return repositories.get(entity)!;
  };

  const manager: EntityManagerMock = {
    createQueryBuilder: jest.fn((_entity?: unknown, alias?: string): QueryBuilderMock => builder(alias)),
    find: jest.fn().mockResolvedValue([]),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
    findOne: jest.fn().mockResolvedValue(null),
    findOneBy: jest.fn().mockResolvedValue(null),
    exists: jest.fn().mockResolvedValue(false),
    existsBy: jest.fn().mockResolvedValue(false),
    count: jest.fn().mockResolvedValue(0),
    countBy: jest.fn().mockResolvedValue(0),
    create: jest.fn((_entity: unknown, data: object): object => ({ ...data })),
    save: jest.fn(async (_entity: unknown, row: object): Promise<object> => ({ id: 'generated-id', ...row })),
    insert: jest.fn().mockResolvedValue({ identifiers: [] }),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
    // Locks and raw statements answer no row.
    query: jest.fn().mockResolvedValue([]),
    // The repositories of a transaction are those of the data source.
    getRepository: jest.fn((entity: unknown): RepositoryMock => repository(entity)),
  };

  const runner: DataSourceMock['runner'] = {
    connect: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(async (sql: string): Promise<unknown[]> =>
      sql.includes('pg_try_advisory_lock') ? [{ locked: true }] : []
    ),
  };

  const mocks: DataSourceMock['mocks'] = {
    getRepository: jest.fn((entity: unknown): RepositoryMock => repository(entity)),
    transaction: jest.fn(async (callback: (manager: EntityManagerMock) => Promise<unknown>): Promise<unknown> =>
      callback(manager)
    ),
    query: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn((_entity?: unknown, alias?: string): QueryBuilderMock => builder(alias)),
    createQueryRunner: jest.fn(() => runner),
  };

  // `dataSource.manager` is what a service reads outside a transaction, as TypeORM's is.
  return { dataSource: { ...mocks, manager } as unknown as DataSource, repository, manager, builder, mocks, runner };
}
