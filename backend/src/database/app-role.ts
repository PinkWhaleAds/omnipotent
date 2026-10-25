/**
 * @module database/app-role
 *
 * The database role the API and the worker connect with, when it is not the master user
 * (`Database.appUser`, production: RDS IAM authentication). The migration step, connected as the
 * master user, creates it and grants it what the application needs, nothing more:
 *
 * - read and write the rows of the application tables (no DDL on `public`: only migrations change
 *   the schema), including the tables created by later migrations (default privileges);
 * - own the job queue schema: pg-boss creates and migrates it at start, and creates a partition per
 *   queue at run time, which only the owner of its tables may do.
 *
 * Every step is idempotent: it runs after the migrations of every deploy.
 */

/** Runs SQL: a TypeORM data source or entity manager. */
export type SqlRunner = { query: (sql: string, parameters?: unknown[]) => Promise<unknown> };

/**
 * What {@link ensureAppRole} sets up.
 *
 * @property user - The application role (created when missing)
 * @property queueSchema - The pg-boss schema it owns
 */
export type AppRoleOptions = { user: string; queueSchema: string };

/** A PostgreSQL identifier written as is: lower case letters, digits and underscores. */
const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Quote an identifier after checking its shape (it is interpolated into DDL).
 *
 * @param name - The identifier
 * @returns It in double quotes
 * @throws Error when it is not a plain identifier
 */
function quoted(name: string): string {
  if (!IDENTIFIER.test(name)) throw new Error(`"${name}" is not a plain PostgreSQL identifier`);
  return `"${name}"`;
}

/**
 * Run a query and read its rows.
 *
 * @param runner - Where to run it
 * @param sql - The query
 * @param parameters - Its parameters
 * @returns The rows
 */
async function rows<T>(runner: SqlRunner, sql: string, parameters: unknown[] = []): Promise<T[]> {
  return (await runner.query(sql, parameters)) as T[];
}

/**
 * Create the application role when missing and let the current (master) user act as it, which
 * PostgreSQL requires to create a schema for it or give it objects. That membership only lasts the
 * transaction: {@link ensureAppRole} revokes it at the end, as on RDS a member of the role inherits
 * its `rds_iam` and could no longer sign in with its password (the next migration would fail).
 *
 * @param runner - A connection of the master user
 * @param user - The role, quoted
 * @param name - The role, as stored
 */
async function ensureRole(runner: SqlRunner, user: string, name: string): Promise<void> {
  const [current] = await rows<{ name: string }>(runner, 'SELECT current_user AS name');
  if (current.name === name) throw new Error(`The application role ${name} must not be the connected user`);
  const existing = await rows<unknown>(runner, 'SELECT 1 FROM pg_roles WHERE rolname = $1', [name]);
  if (existing.length === 0) await runner.query(`CREATE ROLE ${user} LOGIN`);
  await runner.query(`GRANT ${user} TO CURRENT_USER`);
  // On RDS, rds_iam lets the role sign in with IAM tokens only (its password login is off).
  const iam = await rows<unknown>(runner, "SELECT 1 FROM pg_roles WHERE rolname = 'rds_iam'");
  if (iam.length > 0) await runner.query(`GRANT rds_iam TO ${user}`);
}

/**
 * Rows of the application tables: read and write, now and for the tables of later migrations.
 *
 * @param runner - A connection of the master user
 * @param user - The role, quoted
 */
async function grantPublic(runner: SqlRunner, user: string): Promise<void> {
  const [database] = await rows<{ name: string }>(runner, 'SELECT quote_ident(current_database()) AS name');
  await runner.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${database.name} TO ${user}`);
  await runner.query(`GRANT USAGE ON SCHEMA public TO ${user}`);
  await runner.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${user}`);
  await runner.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${user}`);
  await runner.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${user}`
  );
  await runner.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${user}`);
}

/**
 * Give the queue schema and everything in it to the role. The schema exists before the API starts
 * (the role could not create it in the database); objects an earlier version created as the master
 * user (tables, sequences, functions, types) change hands.
 *
 * @param runner - A connection of the master user
 * @param user - The role, quoted
 * @param name - The role, as stored
 * @param schema - The queue schema, as stored (a plain identifier)
 */
async function ownQueueSchema(runner: SqlRunner, user: string, name: string, schema: string): Promise<void> {
  const qualifiedSchema = `"${schema}"`;
  const [found] = await rows<{ owner: string }>(
    runner,
    'SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = $1',
    [schema]
  );
  if (!found) {
    await runner.query(`CREATE SCHEMA ${qualifiedSchema} AUTHORIZATION ${user}`);
    return;
  }
  if (found.owner !== name) await runner.query(`ALTER SCHEMA ${qualifiedSchema} OWNER TO ${user}`);

  // Tables first: their identity and serial sequences follow them; the sequences left are standalone.
  const relations = await rows<{ name: string; kind: string }>(
    runner,
    `SELECT format('%I.%I', n.nspname, c.relname) AS name, c.relkind AS kind
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND pg_get_userbyid(c.relowner) <> $2
      ORDER BY c.relkind, c.relname`,
    [schema, name]
  );
  for (const relation of relations) await runner.query(`ALTER TABLE ${relation.name} OWNER TO ${user}`);

  const sequences = await rows<{ name: string }>(
    runner,
    `SELECT format('%I.%I', n.nspname, c.relname) AS name
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relkind = 'S' AND pg_get_userbyid(c.relowner) <> $2
      ORDER BY c.relname`,
    [schema, name]
  );
  for (const sequence of sequences) await runner.query(`ALTER SEQUENCE ${sequence.name} OWNER TO ${user}`);

  const routines = await rows<{ name: string }>(
    runner,
    `SELECT p.oid::regprocedure::text AS name
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = $1 AND pg_get_userbyid(p.proowner) <> $2
      ORDER BY 1`,
    [schema, name]
  );
  for (const routine of routines) await runner.query(`ALTER ROUTINE ${routine.name} OWNER TO ${user}`);

  // Enums, domains, ranges and standalone composite types (a table's row type follows the table,
  // an array type its element).
  const types = await rows<{ name: string }>(
    runner,
    `SELECT format('%I.%I', n.nspname, t.typname) AS name
       FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
       LEFT JOIN pg_class c ON c.oid = t.typrelid
      WHERE n.nspname = $1 AND pg_get_userbyid(t.typowner) <> $2
        AND (t.typtype IN ('e', 'd', 'r') OR (t.typtype = 'c' AND c.relkind = 'c'))
      ORDER BY 1`,
    [schema, name]
  );
  for (const type of types) await runner.query(`ALTER TYPE ${type.name} OWNER TO ${user}`);
}

/**
 * Create or update the application role: its login, its rights on the application tables, and the
 * ownership of the queue schema. Run as the master user, after the migrations, in a transaction: the master user is a
 * member of the role during it only (on RDS, a lasting membership would turn its password login off).
 *
 * @param runner - A connection of the master user
 * @param options - The role and the queue schema
 * @returns A promise that resolves once the role is ready
 * @throws Error when a name is not a plain identifier, or the role is the connected user
 *
 * @example
 * ```typescript
 * await dataSource.transaction((manager: EntityManager) => ensureAppRole(manager, { user: 'omnipotent_app', queueSchema: 'pgboss' }));
 * ```
 */
export async function ensureAppRole(runner: SqlRunner, options: AppRoleOptions): Promise<void> {
  const user: string = quoted(options.user);
  quoted(options.queueSchema);
  await ensureRole(runner, user, options.user);
  await grantPublic(runner, user);
  await ownQueueSchema(runner, user, options.user, options.queueSchema);
  // Only for this transaction: a lasting membership would hand the master user the role's rds_iam (password login off).
  await runner.query(`REVOKE ${user} FROM CURRENT_USER`);
}
