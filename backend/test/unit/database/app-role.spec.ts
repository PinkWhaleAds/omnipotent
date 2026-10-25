import { AppRoleOptions, ensureAppRole, SqlRunner } from '@src/database/app-role';

/**
 * What the fake database answers.
 *
 * @property currentUser - The connected user
 * @property roleExists - Whether the application role exists
 * @property rdsIam - Whether the `rds_iam` role exists (RDS)
 * @property schemaOwner - Owner of the queue schema, null when it does not exist
 * @property relations - Relations of the queue schema not owned by the role
 * @property sequences - Standalone sequences not owned by the role
 * @property routines - Functions not owned by the role
 * @property types - Types not owned by the role
 */
type FakeDatabase = {
  currentUser: string;
  roleExists: boolean;
  rdsIam: boolean;
  schemaOwner: string | null;
  relations: { name: string; kind: string }[];
  sequences: { name: string }[];
  routines: { name: string }[];
  types: { name: string }[];
};

/** A runner answering the catalog queries of {@link ensureAppRole} and recording the other statements. */
function fakeRunner(database: FakeDatabase): { runner: SqlRunner; statements: string[]; query: jest.Mock } {
  const statements: string[] = [];
  const query: jest.Mock = jest.fn(async (sql: string): Promise<unknown> => {
    if (sql.startsWith('SELECT current_user')) return [{ name: database.currentUser }];
    if (sql.includes('FROM pg_roles WHERE rolname = $1')) return database.roleExists ? [{ '?column?': 1 }] : [];
    if (sql.includes("rolname = 'rds_iam'")) return database.rdsIam ? [{ '?column?': 1 }] : [];
    if (sql.startsWith('SELECT quote_ident(current_database())')) return [{ name: '"omnipotent"' }];
    if (sql.includes('FROM pg_namespace WHERE nspname')) {
      return database.schemaOwner === null ? [] : [{ owner: database.schemaOwner }];
    }
    if (sql.includes("c.relkind IN ('r'")) return database.relations;
    if (sql.includes("c.relkind = 'S'")) return database.sequences;
    if (sql.includes('FROM pg_proc')) return database.routines;
    if (sql.includes('FROM pg_type')) return database.types;
    statements.push(sql);
    return [];
  });
  return { runner: { query }, statements, query };
}

describe('Unit::Database::AppRole', () => {
  const OPTIONS: AppRoleOptions = { user: 'omnipotent_app', queueSchema: 'pgboss' };

  const FRESH: FakeDatabase = {
    currentUser: 'omnipotent',
    roleExists: false,
    rdsIam: false,
    schemaOwner: null,
    relations: [],
    sequences: [],
    routines: [],
    types: [],
  };

  const PUBLIC_GRANTS: string[] = [
    'GRANT CONNECT, TEMPORARY ON DATABASE "omnipotent" TO "omnipotent_app"',
    'GRANT USAGE ON SCHEMA public TO "omnipotent_app"',
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "omnipotent_app"',
    'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO "omnipotent_app"',
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "omnipotent_app"',
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO "omnipotent_app"',
  ];

  it('should create the role, grant it the rows of the application tables and give it a new queue schema', async (): Promise<void> => {
    const { runner, statements } = fakeRunner(FRESH);

    await ensureAppRole(runner, OPTIONS);

    expect(statements).toEqual([
      'CREATE ROLE "omnipotent_app" LOGIN',
      'GRANT "omnipotent_app" TO CURRENT_USER',
      ...PUBLIC_GRANTS,
      'CREATE SCHEMA "pgboss" AUTHORIZATION "omnipotent_app"',
      'REVOKE "omnipotent_app" FROM CURRENT_USER',
    ]);
  });

  it('should keep an existing role, and let it sign in with IAM tokens on RDS', async (): Promise<void> => {
    const { runner, statements } = fakeRunner({
      ...FRESH,
      roleExists: true,
      rdsIam: true,
      schemaOwner: 'omnipotent_app',
    });

    await ensureAppRole(runner, OPTIONS);

    expect(statements).toEqual([
      'GRANT "omnipotent_app" TO CURRENT_USER',
      'GRANT rds_iam TO "omnipotent_app"',
      ...PUBLIC_GRANTS,
      'REVOKE "omnipotent_app" FROM CURRENT_USER',
    ]);
  });

  it('should give the role a queue schema and the objects the master user created in it', async (): Promise<void> => {
    const { runner, statements, query } = fakeRunner({
      ...FRESH,
      roleExists: true,
      schemaOwner: 'omnipotent',
      relations: [
        { name: 'pgboss.job', kind: 'p' },
        { name: 'pgboss.version', kind: 'r' },
      ],
      sequences: [{ name: 'pgboss.counter' }],
      routines: [{ name: 'pgboss.create_queue(text,jsonb)' }],
      types: [{ name: 'pgboss.job_state' }],
    });

    await ensureAppRole(runner, OPTIONS);

    expect(statements.slice(1 + PUBLIC_GRANTS.length)).toEqual([
      'ALTER SCHEMA "pgboss" OWNER TO "omnipotent_app"',
      'ALTER TABLE pgboss.job OWNER TO "omnipotent_app"',
      'ALTER TABLE pgboss.version OWNER TO "omnipotent_app"',
      'ALTER SEQUENCE pgboss.counter OWNER TO "omnipotent_app"',
      'ALTER ROUTINE pgboss.create_queue(text,jsonb) OWNER TO "omnipotent_app"',
      'ALTER TYPE pgboss.job_state OWNER TO "omnipotent_app"',
      'REVOKE "omnipotent_app" FROM CURRENT_USER',
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM pg_proc'), ['pgboss', 'omnipotent_app']);
  });

  it('should only hand over the objects of a schema the role already owns', async (): Promise<void> => {
    const { runner, statements } = fakeRunner({
      ...FRESH,
      roleExists: true,
      schemaOwner: 'omnipotent_app',
      relations: [{ name: 'pgboss.job', kind: 'p' }],
    });

    await ensureAppRole(runner, OPTIONS);

    expect(statements.slice(1 + PUBLIC_GRANTS.length)).toEqual([
      'ALTER TABLE pgboss.job OWNER TO "omnipotent_app"',
      'REVOKE "omnipotent_app" FROM CURRENT_USER',
    ]);
  });

  it('should refuse a role name that is not a plain identifier', async (): Promise<void> => {
    const { runner, query } = fakeRunner(FRESH);

    await expect(ensureAppRole(runner, { ...OPTIONS, user: 'app"; DROP TABLE users; --' })).rejects.toThrow(
      'is not a plain PostgreSQL identifier'
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('should refuse a queue schema that is not a plain identifier', async (): Promise<void> => {
    const { runner, query } = fakeRunner(FRESH);

    await expect(ensureAppRole(runner, { ...OPTIONS, queueSchema: 'Pg Boss' })).rejects.toThrow(
      'is not a plain PostgreSQL identifier'
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('should refuse to manage the connected user itself', async (): Promise<void> => {
    const { runner, statements } = fakeRunner({ ...FRESH, currentUser: 'omnipotent_app' });

    await expect(ensureAppRole(runner, OPTIONS)).rejects.toThrow('must not be the connected user');
    expect(statements).toEqual([]);
  });
});
