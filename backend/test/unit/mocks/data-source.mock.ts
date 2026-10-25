import { DataSource } from 'typeorm';

/**
 * Jest mock of the TypeORM repository methods the services use.
 *
 * `create` returns a shallow copy of its input and `save` resolves with the
 * entity it received, so "create then save" flows return what was built.
 */
export type RepositoryMock = {
  find: jest.Mock;
  findBy: jest.Mock;
  findOne: jest.Mock;
  findOneBy: jest.Mock;
  findAndCount: jest.Mock;
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
 * Every method but `query` and `getRepository` takes the entity class as first argument, like TypeORM's.
 */
export type EntityManagerMock = {
  find: jest.Mock;
  findOne: jest.Mock;
  findOneBy: jest.Mock;
  existsBy: jest.Mock;
  count: jest.Mock;
  countBy: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  softDelete: jest.Mock;
  query: jest.Mock;
  getRepository: jest.Mock;
};

/** A fake data source plus handles on its repositories and transaction manager. */
export type DataSourceMock = {
  /** Pass this where a `DataSource` is expected. */
  dataSource: DataSource;
  /** Repository mock of an entity class (created on first access, then reused). */
  repository: (entity: unknown) => RepositoryMock;
  /** Entity manager handed to `dataSource.transaction(callback)`. */
  manager: EntityManagerMock;
  /** Raw jest mocks of the data source itself. */
  mocks: { getRepository: jest.Mock; transaction: jest.Mock; query: jest.Mock };
};

/**
 * Build a repository mock with neutral defaults (nothing found, saves echo their input).
 *
 * @returns The repository mock
 */
export function createRepositoryMock(): RepositoryMock {
  return {
    find: jest.fn().mockResolvedValue([]),
    findBy: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findOneBy: jest.fn().mockResolvedValue(null),
    findAndCount: jest.fn().mockResolvedValue([[], 0]),
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
 * @returns The fake and handles to configure and assert on it
 *
 * @example
 * ```typescript
 * const db: DataSourceMock = createDataSourceMock();
 * db.repository(SeatEntity).findOneBy.mockResolvedValue(seatRow);
 * const service: SeatService = new SeatService(db.dataSource, access);
 * ```
 */
export function createDataSourceMock(): DataSourceMock {
  const repositories = new Map<unknown, RepositoryMock>();
  const repository: (entity: unknown) => RepositoryMock = (entity: unknown): RepositoryMock => {
    if (!repositories.has(entity)) repositories.set(entity, createRepositoryMock());
    return repositories.get(entity)!;
  };

  const manager: EntityManagerMock = {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    findOneBy: jest.fn().mockResolvedValue(null),
    existsBy: jest.fn().mockResolvedValue(false),
    count: jest.fn().mockResolvedValue(0),
    countBy: jest.fn().mockResolvedValue(0),
    create: jest.fn((_entity: unknown, data: object): object => ({ ...data })),
    save: jest.fn(async (entity: object): Promise<object> => ({ id: 'generated-id', ...entity })),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
    softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
    // Locks and raw statements answer no row.
    query: jest.fn().mockResolvedValue([]),
    // The repositories of a transaction are those of the data source.
    getRepository: jest.fn((entity: unknown): RepositoryMock => repository(entity)),
  };

  const mocks: DataSourceMock['mocks'] = {
    getRepository: jest.fn((entity: unknown): RepositoryMock => repository(entity)),
    transaction: jest.fn(async (callback: (manager: EntityManagerMock) => Promise<unknown>): Promise<unknown> =>
      callback(manager)
    ),
    query: jest.fn().mockResolvedValue([]),
  };

  return { dataSource: mocks as unknown as DataSource, repository, manager, mocks };
}
